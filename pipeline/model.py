"""Backbone + wrapper with preprocessing baked in (PLAN.md §4.3).

The browser only supplies RGB floats in [0, 1], shape [1, 3, 320, 224]; ImageNet
normalization and L2 normalization happen inside the graph, identically everywhere.
"""
from __future__ import annotations

import timm
import torch
from torch import nn

import config


class Embedder(nn.Module):
    def __init__(self, pretrained: bool = True):
        super().__init__()
        self.backbone = timm.create_model(config.BACKBONE, pretrained=pretrained, num_classes=0)
        self.register_buffer("mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # x: [N,3,320,224] float32 in [0,1]
        x = (x - self.mean) / self.std
        f = self.backbone(x)
        return nn.functional.normalize(f, dim=1)


def load_embedder() -> Embedder:
    torch.manual_seed(config.SEED)
    return Embedder().eval()
