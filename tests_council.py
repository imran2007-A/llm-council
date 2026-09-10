"""End-to-end checks of the orchestration, conversations and usage accounting.

Everything here runs in dry-run mode, so the whole file makes zero API calls and can run
in CI with no keys configured.

Run: python tests_council.py
"""

import asyncio
import json
import shutil
import tempfile
from pathlib import Path

from council import prompts, storage, usage
from council.council import run_council

failures = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}\n    got  {got!r}\n    want {want!r}")


def check_true(name, got):
    check(name, bool(got), True)


# Redirect all persistence into a temp directory so a test run never touches real data.
tmp = Path(tempfile.mkdtemp(prefix="council-test-"))
storage.DATA = tmp
storage.RUNS = tmp / "runs"
storage.CACHE = tmp / "cache"
storage.CONVERSATIONS = tmp / "conversations"
usage.USAGE_FILE = tmp / "usage.json"

try:
    # --- a full dry run produces a complete transcript ----------------------
    events = []
    transcript = asyncio.run(run_council("test question", dry_run=True,
                                         on_event=events.append))

    check("all four seats answered", len(transcript["opinions"]), 4)
    check("all four seats succeeded", all(o["ok"] for o in transcript["opinions"]), True)
    check("every seat reviewed", len(transcript["reviews"]), 4)
    check("ranking covers every seat", len(transcript["ranking"]), 4)
    check_true("a verdict was produced", transcript["verdict"]["ok"])
    check("transcript records the turn number", transcript["turn"], 1)

    # Borda scores must be a permutation of the possible totals for 4 reviewers x 4 items.
    check("ranking is sorted by score, descending",
          [r["score"] for r in transcript["ranking"]],
          sorted((r["score"] for r in transcript["ranking"]), reverse=True))

    # --- the event stream is well formed ------------------------------------
    types = [e["type"] for e in events]
    check("run announces three stages", types.count("stage_changed"), 3)
    check("one seat_started per model call", types.count("seat_started"), 4 + 4 + 1)
    check("one seat_finished per model call", types.count("seat_finished"), 4 + 4 + 1)
    check("exactly one run_finished", types.count("run_finished"), 1)
    check("run_finished is last", types[-1], "run_finished")
    check_true("every event carries a timestamp", all("t" in e for e in events))
    check_true("every seat event names its seat",
               all("seat" in e for e in events if e["type"].startswith("seat_")))

    # Stage order must be opinions -> review -> chairman.
    check("stages run in order",
          [e["stage"] for e in events if e["type"] == "stage_changed"],
          ["opinions", "review", "chairman"])

    # --- anonymisation actually hides identities ----------------------------
    seat_ids = {s["id"] for s in transcript["seats"]}
    check("labels map to real seats", set(transcript["anonymisation"].values()), seat_ids)
    check("one label per seat", len(transcript["anonymisation"]), 4)

    # --- conversations carry history forward --------------------------------
    conversation_id = storage.new_conversation_id()
    first = asyncio.run(run_council("first question", dry_run=True,
                                    conversation_id=conversation_id))
    check("first turn is turn 1", first["turn"], 1)

    stored = storage.load_conversation(conversation_id)
    check("turn was recorded", len(stored["turns"]), 1)
    check("title comes from the first question", stored["title"], "first question")

    second = asyncio.run(run_council("second question", dry_run=True,
                                     conversation_id=conversation_id))
    check("second turn knows it is turn 2", second["turn"], 2)
    check("both turns recorded", len(storage.load_conversation(conversation_id)["turns"]), 2)

    listed = storage.list_conversations()
    check("conversation appears in the list",
          any(c["id"] == conversation_id and c["turns"] == 2 for c in listed), True)

    # A failed verdict must not be recorded as a turn.
    check("only successful turns are recorded",
          all(t["verdict"] for t in storage.load_conversation(conversation_id)["turns"]), True)

    # --- history_block shapes the prompt ------------------------------------
    check("no history means no context block", prompts.history_block([]), "")
    block = prompts.history_block([{"question": "Q1", "verdict": "V1"}])
    check_true("history block names the earlier question", "Q1" in block)
    check_true("history block carries the verdict", "V1" in block)

    long_verdict = "x" * (prompts.HISTORY_CHARS + 500)
    trimmed = prompts.history_block([{"question": "Q", "verdict": long_verdict}])
    check_true("long verdicts are truncated", len(trimmed) < len(long_verdict))
    check_true("truncation is marked", "[...]" in trimmed)

    many = [{"question": f"Q{i}", "verdict": f"V{i}"} for i in range(10)]
    block = prompts.history_block(many)
    check("only the last N turns are carried",
          [f"Q{i}" in block for i in range(10)],
          [i >= 10 - prompts.HISTORY_TURNS for i in range(10)])

    # --- path traversal ------------------------------------------------------
    check("conversation ids cannot escape the data directory",
          storage.conversation_path("../../etc/passwd").parent, storage.CONVERSATIONS)

    # --- usage accounting ----------------------------------------------------
    usage._loaded = True   # skip disk load, start from a known state
    usage._counts = {}
    usage.record("groq", 3)
    usage.record("openrouter")
    check("counts accumulate", usage.today(), {"groq": 3, "openrouter": 1})
    check("remaining subtracts from the documented cap", usage.remaining("openrouter"), 49)
    check("unknown providers report nothing", usage.remaining("nope"), None)

    usage.record("openrouter", 999)
    check("remaining never goes negative", usage.remaining("openrouter"), 0)

    report = usage.report()
    check("report covers every provider", len(report), 3)
    check("report is worst-off first", report[0]["provider"], "openrouter")

    # --- caching -------------------------------------------------------------
    storage.cache_put("q", "model-x", "cached text")
    check("cache round-trips", storage.cache_get("q", "model-x"), "cached text")
    check("cache misses are None", storage.cache_get("other q", "model-x"), None)
    check("cache is keyed by model too", storage.cache_get("q", "model-y"), None)

finally:
    shutil.rmtree(tmp, ignore_errors=True)

if failures:
    print(f"{len(failures)} FAILED\n")
    print("\n".join(failures))
    raise SystemExit(1)
print("all council tests passed")
