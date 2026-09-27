"""All pipeline constants. No magic numbers elsewhere."""
import sys
from pathlib import Path

# Windows consoles default to cp1252; libraries (e.g. torch.onnx) print emoji.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# --- Paths ---------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW_DIR = DATA / "raw"
CARDS_DIR = DATA / "cards"
CARDS_CSV = CARDS_DIR / "cards.csv"
IMAGES_DIR = CARDS_DIR / "images"
IMAGE_OVERRIDES_DIR = CARDS_DIR / "image_overrides"
LOOKALIKE_REPORT = CARDS_DIR / "lookalikes.json"
PRICES_DIR = DATA / "prices"
PRICES_CSV = PRICES_DIR / "prices.csv"
UNMATCHED_CSV = PRICES_DIR / "unmatched.csv"
MANUAL_OVERRIDES_CSV = PRICES_DIR / "manual_overrides.csv"
EVAL_DIR = DATA / "eval"
APP_PUBLIC = ROOT / "app" / "public"
APP_DATA = APP_PUBLIC / "data"
APP_IMAGES = APP_DATA / "images"
APP_MODEL = APP_PUBLIC / "models" / "embedder.onnx"
APP_PARITY = APP_PUBLIC / "fixtures" / "parity"
OUT_DIR = ROOT / "pipeline" / "out"
FINETUNED_WEIGHTS = OUT_DIR / "finetune" / "best.pt"  # used by model.load_embedder when present

# --- Sources -------------------------------------------------------------
CARD_SOURCE = "riftcodex"          # riftcodex (default) | riot | gallery
RIFTCODEX_BASE = "https://api.riftcodex.com"
RIFTCODEX_PAGE_SIZE = 100
# Pool = what can come out of a standard booster pack (human, 2026-09-25).
# Add new booster sets here when they release. Starter (OGS), PR and JDG promos are out.
DEMO_SETS = ["OGN", "SFD", "UNL", "VEN"]
NEXUS_NIGHT_SET = "OPP"            # Nexus Night promos: the untagged OPP printings (no "(Metal)", etc.)
PROMO_SETS = {"PR", "JDG", "OPP"}  # printings from these sets get variant=promo
INCLUDE_ALL_PRINTINGS = False      # off: other printings (metal, judge, starter) can't be pulled from boosters

PRICE_PROVIDER = "tcgcsv"
TCGCSV_ROOT = "https://tcgcsv.com"
TCGCSV_BASE = f"{TCGCSV_ROOT}/tcgplayer"
TCGCSV_CATEGORY_ID = 89            # Riftbound; verified 2026-09-25 via /tcgplayer/categories
PRICE_MAX_REQUESTS = 20
PRICE_FIELDS = ["marketPrice", "midPrice", "lowPrice"]  # fallback order
TCGCSV_NORMAL_SUBTYPE = "Normal"
TCGCSV_FOIL_SUBTYPE = "Foil"

# --- HTTP etiquette ------------------------------------------------------
MIN_REQUEST_INTERVAL_S = 0.1
MAX_RETRIES = 5
BACKOFF_BASE_S = 1.0
REQUEST_TIMEOUT_S = 30
USER_AGENT = "RiftPulls/0.1"
CONTACT = "anjoelocalderon@gmail.com"  # appended to the User-Agent (H1)

# --- Images --------------------------------------------------------------
MIN_IMAGE_HEIGHT = 600             # warn below this
PHASH_SAME_MAX_DIST = 4            # pHash Hamming distance ≤ this → "same picture"

# --- Model / embeddings (Phase 1) ----------------------------------------
INPUT_W, INPUT_H = 224, 320        # portrait, close to card ratio, both divisible by 32
BACKBONE = "mobilenetv3_large_100" # timm name; pretrained, num_classes=0
STANDARDIZE_INPUT = True           # per-image channel standardization inside the model (colour-cast invariance)
AUG_PER_IMAGE = 8
# v2 (2026-09-26), matched to real eval photos: card ~65–100% of the box, backlit, colour cast, hand.
AUG_CARD_SCALE = (0.65, 1.0)       # card height as a fraction of the guide box
AUG_PERSPECTIVE = (0.0, 0.035)     # max corner jitter as a fraction of width/height
AUG_ROTATE_DEG = 12
AUG_HAND_P = 0.6
AUG_GAMMA = (0.8, 2.2)             # >1 darkens: backlit card
AUG_EXPOSURE = (0.5, 1.3)
AUG_CAST = (0.65, 1.3)             # per-channel gain
AUG_VEIL_P = 0.6
AUG_VEIL = (0.05, 0.4)             # haze strength
AUG_GLARE_P = 0.5
AUG_GLARE_OPACITY = (0.15, 0.5)
AUG_JPEG_QUALITY = (50, 91)        # [low, high)
SEED = 1234
LAYOUT_W, LAYOUT_H = 56, 80        # edge-map size = 224×320 box-averaged 4×4 (exact, no resampler)
LAYOUT_GRID = (4, 5)               # cols, rows → 20 tiles of 14×16 pixels
LAYOUT_MIN_MEAN = 1e-3             # edge-map mean floor (near-blank image guard)
LAYOUT_TILE_EPS = 1e-3             # tile norm below this = no edges (normalized units; real edges ~1+)
EMBED_WEIGHT, LAYOUT_WEIGHT = 0.5, 0.5  # §6.4 combined score (PLAN EMBED_W/LAYOUT_W; renamed: LAYOUT_W is the map width) (initial; calibrated in Phase 3, mirror in app config.ts)
ONNX_OPSET = 18                     # torch 2.14 exporter minimum; asking for 17 logs a failed down-conversion traceback
ONNX_PARITY_MIN_COS = 0.999
EMBED_WARN_MB = 25
UI_IMAGE_W, UI_IMAGE_H = 372, 520  # price-card UI images (JPEG), half the 744×1039 source
UI_IMAGE_QUALITY = 85
PARITY_COUNT = 5
