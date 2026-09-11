"""The three-stage orchestration.

Every stage reports progress through an optional `on_event` callback. Nothing in Phase 1
needs that -- the CLI could just print -- but it means the FastAPI layer in Phase 2 can
stream these same events over SSE without this file changing, and the 3D scene in Phase 4
can drive avatar animations off them.
"""

from __future__ import annotations

import asyncio
import random
import time
from typing import Awaitable, Callable

from . import prompts, storage, synthesis, usage
from .config import (
    CHAIRMAN,
    seat_by_id,
    CHAIRMAN_MAX_TOKENS,
    OPINION_MAX_TOKENS,
    REVIEW_MAX_TOKENS,
    SEATS,
    Seat,
)
from .providers import BUDGET, ModelReply, call_model
from .ranking import anonymise, borda, parse_ranking

EventHandler = Callable[[dict], Awaitable[None] | None]


async def _emit(on_event: EventHandler | None, event_type: str, **payload) -> None:
    if on_event is None:
        return
    result = on_event({"type": event_type, "t": time.time(), **payload})
    if asyncio.iscoroutine(result):
        await result


FAKE_OPINION = (
    "This is a dry-run response from {label}. It exists so the pipeline can be exercised "
    "end to end without spending a single API request."
)
FAKE_REVIEW = (
    "Response A is clear but shallow. Response B has the strongest reasoning. "
    "Response C repeats itself.\n\nRANKING: {ranking}"
)
# The fake verdict carries the same structured sections a real Chairman emits, so a dry
# run exercises the comparison table, the conflicts and the follow-ups too. An offline
# mode that only covers half the interface is an offline mode you stop trusting.
FAKE_VERDICT = """This is a dry-run verdict. No models were called.

The council broadly agreed, with one dissent worth noting, and the reasoning below is
placeholder text standing in for a real synthesis.

===POSITIONS===
A: Argues for the conservative option on reliability grounds
B: Argues for the faster option, accepting more risk
C: Says it depends on constraints not stated in the question
D: Agrees with A but for different reasons

===DISAGREEMENT===
Whether speed of iteration outweighs long-term maintenance cost
Whether the question can be answered without more context

===FOLLOW-UPS===
What would change your recommendation?
How much does this decision cost to reverse later?
Which option is easier to hire for?"""


def _delta_hooks(on_event, seat_id: str, stage: str):
    """Build the (on_delta, on_reset) pair that turns streamed text into events.

    seat_reset tells a consumer to throw away what it has shown for this seat: the
    attempt that produced it failed, and a retry or a fallback model is starting over.
    """
    if on_event is None:
        return None, None

    async def on_delta(piece: str) -> None:
        await _emit(on_event, "seat_token", seat=seat_id, stage=stage, text=piece)

    async def on_reset() -> None:
        await _emit(on_event, "seat_reset", seat=seat_id, stage=stage)

    return on_delta, on_reset


async def _opinion(
    seat: Seat, question: str, use_cache: bool, dry_run: bool, on_event, stream: bool,
    history=(),
) -> ModelReply:
    await _emit(on_event, "seat_started", seat=seat.id, stage="opinions")

    if dry_run:
        await asyncio.sleep(random.uniform(0.2, 0.9))  # so the concurrency is visible
        reply = ModelReply(seat.id, FAKE_OPINION.format(label=seat.label))
    else:
        cached = storage.cache_get(question, seat.model) if use_cache else None
        if cached is not None:
            reply = ModelReply(seat.id, cached)
            await _emit(on_event, "cache_hit", seat=seat.id)
        else:
            on_delta, on_reset = _delta_hooks(on_event, seat.id, "opinions") if stream else (None, None)
            reply = await call_model(
                seat, prompts.opinion_messages(question, history), OPINION_MAX_TOKENS,
                on_delta=on_delta, on_reset=on_reset,
            )
            if use_cache and reply.ok:
                storage.cache_put(question, seat.model, reply.text)

    await _emit(
        on_event, "seat_finished",
        seat=seat.id, stage="opinions", ok=reply.ok, error=reply.error, text=reply.text,
    )
    return reply


async def _review(
    seat: Seat, question: str, anon, dry_run: bool, on_event, stream: bool, history=()
) -> ModelReply:
    await _emit(on_event, "seat_started", seat=seat.id, stage="review")

    if dry_run:
        await asyncio.sleep(random.uniform(0.2, 0.9))
        shuffled = list(anon.labels)
        random.shuffle(shuffled)
        reply = ModelReply(seat.id, FAKE_REVIEW.format(ranking=" > ".join(shuffled)))
    else:
        on_delta, on_reset = _delta_hooks(on_event, seat.id, "review") if stream else (None, None)
        reply = await call_model(
            seat,
            prompts.review_messages(question, anon.blocks, anon.labels, history),
            REVIEW_MAX_TOKENS,
            temperature=0.3,  # judging wants less creativity than answering
            on_delta=on_delta, on_reset=on_reset,
        )

    await _emit(
        on_event, "seat_finished",
        seat=seat.id, stage="review", ok=reply.ok, error=reply.error, text=reply.text,
    )
    return reply


async def run_council(
    question: str,
    seats: list[Seat] | None = None,
    chairman: Seat = CHAIRMAN,
    use_cache: bool = False,
    dry_run: bool = False,
    conversation_id: str | None = None,
    on_event: EventHandler | None = None,
    stream: bool = False,
) -> dict:
    seats = seats or SEATS
    run_id = time.strftime("%Y%m%d-%H%M%S")

    # Earlier turns in this conversation, if any. Only the questions and the Chairman's
    # verdicts carry forward -- see prompts.history_block for why.
    history = []
    if conversation_id:
        history = storage.load_conversation(conversation_id).get("turns", [])
    started = time.time()
    transcript: dict = {
        "run_id": run_id,
        "question": question,
        "dry_run": dry_run,
        "conversation_id": conversation_id,
        "turn": len(history) + 1,
        "seats": [
            {"id": s.id, "label": s.label, "provider": s.provider, "model": s.model}
            for s in seats
        ],
        "chairman": {"id": chairman.id, "label": chairman.label, "model": chairman.model},
    }

    # ---- Stage 1: independent first opinions, all at once -------------------
    await _emit(on_event, "stage_changed", stage="opinions")
    results = await asyncio.gather(
        *(_opinion(s, question, use_cache, dry_run, on_event, stream, history) for s in seats),
        return_exceptions=True,
    )
    # return_exceptions=True means one seat blowing up in an unexpected way still
    # cannot take the whole council down with it.
    opinions: list[ModelReply] = []
    for seat, r in zip(seats, results):
        if isinstance(r, BaseException):
            opinions.append(ModelReply(seat.id, "", error=f"{type(r).__name__}: {r}"))
        else:
            opinions.append(r)

    transcript["opinions"] = [
        {"seat": r.seat_id, "ok": r.ok, "text": r.text, "error": r.error,
         "model_used": r.model_used, "elapsed": round(r.elapsed, 2)}
        for r in opinions
    ]

    answered = [r for r in opinions if r.ok]
    if not answered:
        transcript["error"] = "Every council seat failed. Check your API keys in .env."
        transcript["elapsed"] = round(time.time() - started, 2)
        await _emit(on_event, "run_finished", ok=False)
        transcript["path"] = str(storage.save_transcript(transcript))
        return transcript

    # ---- Stage 2: anonymous peer review ------------------------------------
    anon = anonymise([(r.seat_id, r.text) for r in answered])
    transcript["anonymisation"] = anon.label_to_seat

    aggregate: list[tuple[str, int]] = []
    if len(answered) < 2:
        # Nothing to compare against; skip straight to synthesis.
        transcript["reviews"] = []
        transcript["ranking"] = []
        transcript["skipped_review"] = "only one seat answered"
    else:
        await _emit(on_event, "stage_changed", stage="review")
        reviewer_seats = [s for s in seats if any(r.seat_id == s.id for r in answered)]
        review_results = await asyncio.gather(
            *(_review(s, question, anon, dry_run, on_event, stream, history) for s in reviewer_seats),
            return_exceptions=True,
        )

        reviews = []
        rankings: list[list[str]] = []
        for seat, r in zip(reviewer_seats, review_results):
            if isinstance(r, BaseException):
                r = ModelReply(seat.id, "", error=f"{type(r).__name__}: {r}")
            ranking = parse_ranking(r.text, anon.labels) if r.ok else None
            if ranking:
                rankings.append(ranking)
            reviews.append({
                "seat": seat.id,
                "ok": r.ok,
                "text": r.text,
                "error": r.error,
                "ranking_labels": ranking,
                "ranking_seats": [anon.seat(lb) for lb in ranking] if ranking else None,
            })

        transcript["reviews"] = reviews
        aggregate = borda(rankings, anon.labels)
        transcript["ranking"] = [
            {"label": label, "seat": anon.seat(label), "score": score}
            for label, score in aggregate
        ]
        transcript["rankings_submitted"] = len(rankings)
        await _emit(on_event, "review_finished", ranking=transcript["ranking"])

    # ---- Stage 3: the Chairman's verdict -----------------------------------
    await _emit(on_event, "stage_changed", stage="chairman")
    await _emit(on_event, "seat_started", seat=chairman.id, stage="chairman")

    if aggregate:
        ranking_text = "\n".join(
            f"{i + 1}. Response {label} (Borda score {score})"
            for i, (label, score) in enumerate(aggregate)
        )
    else:
        ranking_text = "No usable rankings were submitted; weigh the responses yourself."

    if dry_run:
        verdict = ModelReply(chairman.id, FAKE_VERDICT)
    else:
        on_delta, on_reset = _delta_hooks(on_event, chairman.id, "chairman") if stream else (None, None)
        verdict = await call_model(
            chairman,
            prompts.chairman_messages(question, anon.blocks, ranking_text, history),
            CHAIRMAN_MAX_TOKENS,
            temperature=0.4,
            on_delta=on_delta, on_reset=on_reset,
        )

    await _emit(
        on_event, "seat_finished",
        seat=chairman.id, stage="chairman", ok=verdict.ok, error=verdict.error,
        text=verdict.text,
    )

    # The Chairman's reply carries the verdict plus the comparison table, the points of
    # conflict and the follow-up questions. Split them apart before anything is shown.
    parsed = synthesis.parse(verdict.text) if verdict.ok else synthesis.Synthesis()
    extras = parsed.resolve(anon.label_to_seat)

    transcript["verdict"] = {
        "ok": verdict.ok,
        "text": extras["verdict"] or verdict.text,
        "error": verdict.error,
    }
    transcript["positions"] = extras["positions"]
    transcript["disagreement"] = extras["disagreement"]
    transcript["followups"] = extras["followups"]

    await _emit(
        on_event, "synthesis_ready",
        positions=extras["positions"],
        disagreement=extras["disagreement"],
        followups=extras["followups"],
        verdict=extras["verdict"] or verdict.text,
    )
    transcript["elapsed"] = round(time.time() - started, 2)
    usage.flush()
    transcript["budget"] = {
        "calls": dict(BUDGET.calls), "retries": BUDGET.retries, "total": BUDGET.total(),
        "today": usage.report(),
    }

    if conversation_id and verdict.ok:
        storage.append_turn(
            conversation_id, question, transcript["verdict"]["text"], run_id
        )

    await _emit(on_event, "run_finished", ok=verdict.ok,
                conversation_id=conversation_id)
    transcript["path"] = str(storage.save_transcript(transcript))
    return transcript


async def ask_dissenter(
    transcript: dict,
    seat_id: str | None = None,
    dry_run: bool = False,
) -> dict:
    """Let the lowest-ranked member defend the answer its peers marked down.

    One request, deliberately. This is the thing a single chatbot structurally cannot do:
    the model is not asked to reconsider in the abstract, it is shown the conclusion the
    room reached and asked whether it still disagrees.
    """
    ranking = transcript.get("ranking") or []
    if seat_id is None:
        if not ranking:
            return {"ok": False, "error": "Nothing was ranked, so nobody came last."}
        seat_id = ranking[-1]["seat"]

    seat = seat_by_id(seat_id)
    own = next(
        (o["text"] for o in transcript.get("opinions", []) if o["seat"] == seat_id and o["ok"]),
        "",
    )
    if seat is None or not own:
        return {"ok": False, "error": f"No answer on record for {seat_id}."}

    if dry_run:
        return {
            "ok": True,
            "seat": seat_id,
            "text": "This is a dry-run dissent. The member stands by its answer, "
                    "and believes the others underweighted the cost of being wrong.",
        }

    reply = await call_model(
        seat,
        prompts.dissent_messages(
            transcript.get("question", ""), own, transcript.get("verdict", {}).get("text", "")
        ),
        REVIEW_MAX_TOKENS,
        temperature=0.6,
    )
    usage.flush()
    return {
        "ok": reply.ok,
        "seat": seat_id,
        "text": reply.text,
        "error": reply.error,
    }
