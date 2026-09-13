"""FastAPI wrapper around the council.

The council package is untouched by this file. It already emits typed events through a
callback; this server just forwards them to browsers over Server-Sent Events.

    uvicorn server:app --reload
    open http://127.0.0.1:8000/docs
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from contextlib import suppress

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field

from council import storage, usage
from council.config import CHAIRMAN, PROVIDERS, SEATS
from council.council import ask_dissenter, run_council
from council.providers import BUDGET

app = FastAPI(title="LLM Council", version="2.0")

# The Vite dev server runs on a different port, so the browser treats it as cross-origin.
# In production the React build is served by this same app, so no origins are needed --
# set CORS_ORIGINS (comma separated) only if you host the frontend somewhere else.
_default_origins = "http://localhost:5173,http://127.0.0.1:5173"
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Run:
    """One council session, and everyone currently watching it.

    Events are kept, not just broadcast. A browser that connects late -- or reconnects
    after a dropped connection -- gets the whole history first and then joins live, so it
    never sees a half-run with the beginning missing.
    """

    def __init__(self, run_id: str, question: str) -> None:
        self.id = run_id
        self.question = question
        self.events: list[dict] = []
        self.subscribers: set[asyncio.Queue] = set()
        self.finished = asyncio.Event()
        self.transcript: dict | None = None
        self.conversation_id: str | None = None
        self.task: asyncio.Task | None = None

    def publish(self, event: dict) -> None:
        self.events.append(event)
        for queue in list(self.subscribers):
            queue.put_nowait(event)

    async def stream(self):
        """Replay what has happened, then follow along live."""
        queue: asyncio.Queue = asyncio.Queue()
        cursor = len(self.events)
        for event in self.events[:cursor]:
            yield event
        self.subscribers.add(queue)
        try:
            # Anything published between the replay and the subscribe is already in the
            # queue, so nothing is lost in that gap.
            while True:
                if self.finished.is_set() and queue.empty():
                    return
                try:
                    yield await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield {"type": "heartbeat", "t": time.time()}
        finally:
            self.subscribers.discard(queue)


RUNS: dict[str, Run] = {}


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    cache: bool = False
    dry_run: bool = False
    seats: int | None = Field(default=None, ge=1, le=len(SEATS))
    # Omit to start a fresh conversation; pass an id to continue one, and the council
    # gets the earlier questions and verdicts as context.
    conversation_id: str | None = None


@app.get("/api/config")
def get_config() -> dict:
    """What the council looks like, so a UI can lay out seats before asking anything."""
    return {
        "seats": [
            {"id": s.id, "label": s.label, "provider": s.provider,
             "model": s.model, "blurb": s.blurb}
            for s in SEATS
        ],
        "chairman": {
            "id": CHAIRMAN.id, "label": CHAIRMAN.label,
            "provider": CHAIRMAN.provider, "model": CHAIRMAN.model,
            "blurb": CHAIRMAN.blurb,
        },
        "providers": {
            name: {"rpm": p.rpm, "rpd": p.rpd} for name, p in PROVIDERS.items()
        },
        "budget_used": dict(BUDGET.calls),
    }


@app.post("/api/council")
async def start_council(req: AskRequest) -> dict:
    """Start a run and return immediately. Watch it at /api/council/{id}/stream."""
    run_id = time.strftime("%Y%m%d-%H%M%S")
    while run_id in RUNS:  # two runs inside the same second
        run_id += "b"

    conversation_id = req.conversation_id or storage.new_conversation_id()
    run = Run(run_id, req.question)
    run.conversation_id = conversation_id
    RUNS[run_id] = run
    seats = SEATS[: req.seats] if req.seats else SEATS

    async def execute() -> None:
        try:
            run.transcript = await run_council(
                req.question,
                seats=seats,
                use_cache=req.cache,
                dry_run=req.dry_run,
                conversation_id=conversation_id,
                on_event=run.publish,
                stream=True,
            )
        except Exception as e:  # a bug here must still close the stream
            run.publish({"type": "run_failed", "t": time.time(),
                         "error": f"{type(e).__name__}: {e}"})
        finally:
            run.finished.set()
            # Wake every listener so none sits waiting on an already-finished run.
            for queue in list(run.subscribers):
                queue.put_nowait({"type": "stream_end", "t": time.time()})

    # Held so the task is not garbage collected mid-run.
    run.task = asyncio.create_task(execute())
    return {"run_id": run_id, "conversation_id": conversation_id}


@app.get("/api/council/{run_id}/stream")
async def stream_run(run_id: str) -> StreamingResponse:
    run = RUNS.get(run_id)
    if run is None:
        raise HTTPException(404, f"No run {run_id}")

    async def sse():
        with suppress(asyncio.CancelledError):  # the browser navigating away is normal
            async for event in run.stream():
                if event["type"] == "stream_end":
                    break
                # SSE frame: a named event plus one JSON data line.
                yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
            yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # stops nginx-style proxies buffering the stream
        },
    )


@app.get("/api/council/{run_id}")
def get_run(run_id: str) -> dict:
    """The finished transcript, or the events so far if it's still going."""
    run = RUNS.get(run_id)
    if run is None:
        with suppress(FileNotFoundError):
            return storage.load_transcript(run_id)
        raise HTTPException(404, f"No run {run_id}")
    if run.transcript is not None:
        return run.transcript
    return {"run_id": run_id, "question": run.question,
            "running": True, "events": run.events}


class DissentRequest(BaseModel):
    """Omit seat to ask whoever the council ranked last."""
    seat: str | None = None
    dry_run: bool = False


@app.post("/api/council/{run_id}/dissent")
async def dissent(run_id: str, req: DissentRequest) -> dict:
    """Ask a member to defend the answer its peers marked down. Costs one request."""
    run = RUNS.get(run_id)
    transcript = run.transcript if run else None
    if transcript is None:
        with suppress(FileNotFoundError):
            transcript = storage.load_transcript(run_id)
    if transcript is None:
        raise HTTPException(404, f"No finished run {run_id}")
    return await ask_dissenter(transcript, seat_id=req.seat, dry_run=req.dry_run)


@app.get("/api/runs")
def list_runs() -> dict:
    return {"runs": storage.list_runs()}


@app.get("/api/conversations")
def list_conversations() -> dict:
    return {"conversations": storage.list_conversations()}


@app.get("/api/conversations/{conversation_id}")
def get_conversation(conversation_id: str) -> dict:
    conversation = storage.load_conversation(conversation_id)
    if not conversation.get("turns"):
        raise HTTPException(404, f"No conversation {conversation_id}")
    return conversation


@app.get("/api/usage")
def get_usage() -> dict:
    """Today's request spend per provider, plus recent history for a chart."""
    return {"today": usage.report(), "history": usage.history()}


# Static mounts go last so they never shadow an /api route.
#
# Two clients exist on purpose: the built React app when it has been compiled, and the
# dependency-free single page as a fallback that always works without a Node toolchain.
ROOT = Path(__file__).resolve().parent
REACT_BUILD = ROOT / "static_web"
SIMPLE_CLIENT = ROOT / "static"

# Without this, a bare /simple falls through to the root mount below and 404s, because
# the root mount matches "/simple" as a missing file inside its own directory.
@app.get("/simple", include_in_schema=False)
def simple_client_redirect() -> RedirectResponse:
    return RedirectResponse("/simple/")


# The simple client keeps its own prefix so both stay reachable.
app.mount("/simple", StaticFiles(directory=SIMPLE_CLIENT, html=True), name="simple")

# Vite emits absolute /assets/... URLs, so the React build has to own the root for those
# to resolve. Until `npm run build` has been run, the root serves the simple client
# instead -- the API is fully usable with no Node toolchain installed.
app.mount(
    "/",
    StaticFiles(directory=REACT_BUILD if REACT_BUILD.is_dir() else SIMPLE_CLIENT, html=True),
    name="root",
)
