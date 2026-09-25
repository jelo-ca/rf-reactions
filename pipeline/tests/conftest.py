import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Tests never touch the network."""
    import requests

    def boom(*a, **k):
        raise AssertionError("network access in tests")

    monkeypatch.setattr(requests.Session, "get", boom)
