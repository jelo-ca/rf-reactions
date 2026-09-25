"""All pipeline constants. No magic numbers elsewhere."""
from pathlib import Path

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
AUG_PER_IMAGE = 8
SEED = 1234
LAYOUT_W, LAYOUT_H = 56, 80        # edge-map size = 224×320 box-averaged 4×4 (exact, no resampler)
LAYOUT_GRID = (4, 5)               # cols, rows → 20 tiles of 14×16 pixels
