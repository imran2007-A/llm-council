"""Daily request accounting, persisted across runs.

The CLI is a fresh process every time, so an in-memory counter can only ever describe
one run. OpenRouter's free tier allows 50 requests a day and a four-seat council costs
about nine, so "how many do I have left today" is a question worth answering accurately.

Counts requests, not tokens: requests are what the free tiers ration.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from .config import PROVIDERS

ROOT = Path(__file__).resolve().parent.parent
USAGE_FILE = ROOT / "data" / "usage.json"

# Keep a bounded history: enough to see a trend, not enough to grow forever.
KEEP_DAYS = 30

_today = date.today().isoformat()
_counts: dict[str, dict[str, int]] = {}
_dirty = False
_loaded = False


def _load() -> None:
    global _counts, _loaded
    if _loaded:
        return
    _loaded = True
    try:
        _counts = json.loads(USAGE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        # A corrupt or missing usage file must never stop a council from running.
        _counts = {}
    if not isinstance(_counts, dict):
        _counts = {}


def record(provider: str, n: int = 1) -> None:
    """Count a request. Cheap: memory only, written out by flush()."""
    global _dirty
    _load()
    _counts.setdefault(_today, {})
    _counts[_today][provider] = _counts[_today].get(provider, 0) + n
    _dirty = True


def flush() -> None:
    """Write counts to disk. Called at the end of a run."""
    global _dirty
    if not _dirty:
        return
    _load()
    for day in sorted(_counts)[:-KEEP_DAYS] if len(_counts) > KEEP_DAYS else []:
        _counts.pop(day, None)
    try:
        USAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
        USAGE_FILE.write_text(json.dumps(_counts, indent=2, sort_keys=True), encoding="utf-8")
        _dirty = False
    except OSError:
        pass  # losing a usage count is not worth failing a run over


def today() -> dict[str, int]:
    _load()
    return dict(_counts.get(_today, {}))


def remaining(provider: str) -> int | None:
    """Requests left today against this provider's documented daily cap.

    None when we have no cap on record. Can read as 0 while the real quota still has room:
    the cap is what the provider documents, and OpenRouter's rises from 50 to 1000 once
    any credit has been purchased. Treat it as a warning line, not gospel.
    """
    provider_config = PROVIDERS.get(provider)
    if provider_config is None:
        return None
    return max(0, provider_config.rpd - today().get(provider, 0))


def report() -> list[dict]:
    """Per-provider usage for display, worst-off provider first."""
    used = today()
    rows = []
    for name, provider_config in PROVIDERS.items():
        spent = used.get(name, 0)
        rows.append({
            "provider": name,
            "used": spent,
            "limit": provider_config.rpd,
            "remaining": max(0, provider_config.rpd - spent),
            "fraction": spent / provider_config.rpd if provider_config.rpd else 0.0,
        })
    return sorted(rows, key=lambda r: -r["fraction"])


def history(days: int = 14) -> dict[str, dict[str, int]]:
    _load()
    return {day: dict(counts) for day, counts in sorted(_counts.items())[-days:]}
