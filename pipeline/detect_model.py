"""Card detector (PLAN.md §5.7): full frame → 4 card corners + "card present".

One card per frame, so corner keypoints instead of general object detection. MobileNetV3 features
at strides 8/16/32 → light top-down fusion at stride 8 → 4 corner heatmaps → soft-argmax (DSNT,
in-graph, sub-pixel) → corners in 0–1. A pooled head gives the present logit.
The browser supplies RGB floats in [0, 1], shape [1, 3, DETECT_H, DETECT_W]; normalization is baked in.
"""
from __future__ import annotations

import timm
import torch
from torch import nn
from torch.nn import functional as F

import config


class CardDetector(nn.Module):
    def __init__(self, pretrained: bool = True, width: int = 64):
        super().__init__()
        self.backbone = timm.create_model(config.BACKBONE, pretrained=pretrained, features_only=True, out_indices=(2, 3, 4))
        chans = self.backbone.feature_info.channels()  # strides 8, 16, 32
        self.lateral = nn.ModuleList(nn.Conv2d(c, width, 1) for c in chans)
        self.smooth = nn.Sequential(
            nn.Conv2d(width, width, 3, padding=1), nn.BatchNorm2d(width), nn.ReLU(inplace=True),
            nn.Conv2d(width, width, 3, padding=1), nn.BatchNorm2d(width), nn.ReLU(inplace=True),
        )
        self.heat = nn.Conv2d(width, 4, 1)
        self.present = nn.Sequential(nn.Linear(chans[-1] + width, 128), nn.ReLU(inplace=True), nn.Linear(128, 1))
        self.register_buffer("mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    def features(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """Returns (heatmap logits [N,4,h,w] at stride 8, present logit [N])."""
        f8, f16, f32 = self.backbone((x - self.mean) / self.std)
        p = self.lateral[2](f32)
        p = self.lateral[1](f16) + F.interpolate(p, size=f16.shape[-2:], mode="nearest")
        p = self.lateral[0](f8) + F.interpolate(p, size=f8.shape[-2:], mode="nearest")
        p = self.smooth(p)
        pooled = torch.cat([f32.mean(dim=(2, 3)), p.amax(dim=(2, 3))], dim=1)
        return self.heat(p), self.present(pooled).squeeze(1)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """x: [N,3,H,W] in [0,1] → (present logit [N], corners [N,4,2] in 0–1 (x, y))."""
        heat, present = self.features(x)
        return present, soft_argmax(heat)


def soft_argmax(heat: torch.Tensor) -> torch.Tensor:
    """[N,K,h,w] logits → expected cell-centre position [N,K,2] as fractions of the map (0–1)."""
    n, k, h, w = heat.shape
    prob = heat.flatten(2).softmax(-1).view(n, k, h, w)
    xs = (torch.arange(w, dtype=heat.dtype, device=heat.device) + 0.5) / w
    ys = (torch.arange(h, dtype=heat.dtype, device=heat.device) + 0.5) / h
    x = (prob.sum(2) * xs).sum(-1)
    y = (prob.sum(3) * ys).sum(-1)
    return torch.stack([x, y], dim=-1)


def gaussian_targets(corners: torch.Tensor, h: int, w: int, sigma: float) -> torch.Tensor:
    """[N,4,2] in 0–1 → normalized Gaussian heatmaps [N,4,h,w] (sigma in cells), for the regularizer."""
    xs = (torch.arange(w, dtype=corners.dtype, device=corners.device) + 0.5) / w
    ys = (torch.arange(h, dtype=corners.dtype, device=corners.device) + 0.5) / h
    dx = (xs.view(1, 1, 1, w) - corners[..., 0, None, None]) * w
    dy = (ys.view(1, 1, h, 1) - corners[..., 1, None, None]) * h
    g = torch.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
    return g / g.flatten(2).sum(-1).clamp_min(1e-12)[..., None, None]


def detector_loss(model: CardDetector, x: torch.Tensor, corners: torch.Tensor, present: torch.Tensor,
                  sigma: float = config.DETECT_SIGMA) -> tuple[torch.Tensor, dict]:
    """BCE(present) + on positives: L1(corners, in card-height-ish units) + JS(heatmap ‖ Gaussian)."""
    heat, logit = model.features(x)
    bce = F.binary_cross_entropy_with_logits(logit, present)
    pos = present > 0.5
    if pos.any():
        pred = soft_argmax(heat[pos])
        # Scale x by the map aspect so an error of one pixel costs the same horizontally and vertically.
        scale = torch.tensor([heat.shape[-1] / heat.shape[-2], 1.0], device=x.device)
        l1 = ((pred - corners[pos]).abs() * scale).mean()
        h, w = heat.shape[-2:]
        p = heat[pos].flatten(2).softmax(-1)
        q = gaussian_targets(corners[pos], h, w, sigma).flatten(2)
        m = 0.5 * (p + q)
        js = 0.5 * ((p * (p.clamp_min(1e-12) / m.clamp_min(1e-12)).log()).sum(-1)
                    + (q * (q.clamp_min(1e-12) / m.clamp_min(1e-12)).log()).sum(-1)).mean()
    else:
        l1 = js = torch.zeros((), device=x.device)
    loss = bce + 10.0 * l1 + js
    return loss, {"bce": bce.item(), "l1": l1.item(), "js": js.item()}


def load_detector(weights=config.DETECT_WEIGHTS, pretrained: bool = False) -> CardDetector:
    model = CardDetector(pretrained=pretrained)
    model.load_state_dict(torch.load(weights, map_location="cpu"))
    return model.eval()
