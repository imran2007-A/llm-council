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
    transcript["path"] = str(path)  # recorded before writing, so replays can show it
    path.write_text(json.dumps(transcript, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def load_transcript(run_id: str) -> dict:
    return json.loads((RUNS / f"{run_id}.json").read_text(encoding="utf-8"))


def list_runs() -> list[str]:
    _ensure()
    return sorted(p.stem for p in RUNS.glob("*.json"))


# --- conversations ----------------------------------------------------------
# A conversation is an ordered list of turns. Each turn keeps the question and the
# Chairman's verdict -- the council's shared memory -- plus the run_id, so the full
# transcript with every opinion and review is always one lookup away.

CONVERSATIONS = DATA / "conversations"


def _ensure_conversations() -> None:
    CONVERSATIONS.mkdir(parents=True, exist_ok=True)


def conversation_path(conversation_id: str) -> Path:
    # Guard against a crafted id escaping the data directory.
    safe = "".join(c for c in conversation_id if c.isalnum() or c in "-_")
    return CONVERSATIONS / f"{safe}.json"


def new_conversation_id() -> str:
    return "c" + time.strftime("%Y%m%d-%H%M%S")


def load_conversation(conversation_id: str) -> dict:
    _ensure_conversations()
    path = conversation_path(conversation_id)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"id": conversation_id, "created": time.time(), "turns": []}


def save_conversation(conversation: dict) -> Path:
    _ensure_conversations()
    path = conversation_path(conversation["id"])
    path.write_text(json.dumps(conversation, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def append_turn(conversation_id: str, question: str, verdict: str, run_id: str) -> dict:
    conversation = load_conversation(conversation_id)
    conversation.setdefault("turns", []).append({
        "run_id": run_id,
        "question": question,
        "verdict": verdict,
        "ts": time.time(),
    })
    # The first question makes a natural title.
    if not conversation.get("title"):
        conversation["title"] = question[:80]
    conversation["updated"] = time.time()
    save_conversation(conversation)
    return conversation


def list_conversations() -> list[dict]:
    """Newest first, with just enough for a sidebar."""
    _ensure_conversations()
    out = []
    for path in CONVERSATIONS.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        out.append({
            "id": data.get("id", path.stem),
            "title": data.get("title") or "(untitled)",
            "turns": len(data.get("turns", [])),
            "updated": data.get("updated", data.get("created", 0)),
        })
    return sorted(out, key=lambda c: -c["updated"])
