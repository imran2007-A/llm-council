"""Transcripts and the stage-1 response cache.

The cache exists because OpenRouter's free tier allows 50 requests a day. Without it,
iterating on the review prompt would re-spend four opinion requests every single run.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RUNS = DATA / "runs"
CACHE = DATA / "cache"


def _ensure() -> None:
    RUNS.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)


def cache_key(question: str, model: str) -> str:
    digest = hashlib.sha256(f"{model}\x00{question}".encode("utf-8")).hexdigest()
    return digest[:24]


def cache_get(question: str, model: str) -> str | None:
    _ensure()
    path = CACHE / f"{cache_key(question, model)}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))["text"]
    except (json.JSONDecodeError, KeyError, OSError):
        return None


def cache_put(question: str, model: str, text: str) -> None:
    _ensure()
    path = CACHE / f"{cache_key(question, model)}.json"
    path.write_text(
        json.dumps({"model": model, "question": question, "text": text}, indent=2),
        encoding="utf-8",
    )


def save_transcript(transcript: dict) -> Path:
    """One JSON file per run. The web UI and the 3D scene will replay these for free."""
    _ensure()
    run_id = transcript.get("run_id") or time.strftime("%Y%m%d-%H%M%S")
    path = RUNS / f"{run_id}.json"
    path.write_text(json.dumps(transcript, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def load_transcript(run_id: str) -> dict:
    return json.loads((RUNS / f"{run_id}.json").read_text(encoding="utf-8"))


def list_runs() -> list[str]:
    _ensure()
    return sorted(p.stem for p in RUNS.glob("*.json"))
