"""One async client factory and one call_model() for every provider."""

from __future__ import annotations

import asyncio
import os
import random
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from dotenv import load_dotenv
from openai import AsyncOpenAI, APIStatusError, APITimeoutError, APIConnectionError

from . import usage
from .config import MAX_RETRIES, PROVIDERS, REQUEST_TIMEOUT, SEAT_DEADLINE, Seat

load_dotenv()

_clients: dict[str, AsyncOpenAI] = {}


class MissingKey(RuntimeError):
    pass


@dataclass
class Budget:
    """Counts requests per provider so a run can report what it spent."""
    calls: dict[str, int] = field(default_factory=dict)
    retries: int = 0

    def spend(self, provider: str) -> None:
        self.calls[provider] = self.calls.get(provider, 0) + 1
        usage.record(provider)  # persisted daily total, survives process restarts

    def total(self) -> int:
        return sum(self.calls.values())


BUDGET = Budget()


def get_client(provider_name: str) -> AsyncOpenAI:
    if provider_name in _clients:
        return _clients[provider_name]
    provider = PROVIDERS[provider_name]
    key = os.getenv(provider.env_key, "").strip()
    if not key:
        raise MissingKey(
            f"{provider.env_key} is not set. Copy .env.example to .env and add your "
            f"{provider.name} key."
        )
    client = AsyncOpenAI(
        base_url=provider.base_url,
        api_key=key,
        timeout=REQUEST_TIMEOUT,
        max_retries=0,  # we do our own backoff so we can count and log retries
    )
    _clients[provider_name] = client
    return client


@dataclass
class ModelReply:
    seat_id: str
    text: str
    error: str | None = None
    elapsed: float = 0.0
    model_used: str | None = None     # which candidate answered, if a fallback was needed
    provider_used: str | None = None  # and on which provider, which may not be the seat's

    @property
    def ok(self) -> bool:
        return self.error is None and bool(self.text.strip())


# How a failure should be handled depends on what kind of failure it is. Treating them
# all alike is what made one overloaded Google model cost 21 requests and 231 seconds.
#
#   fatal     - this model is gone, forbidden, or wants money. Switch model immediately.
#   capacity  - this model is overloaded (503). Waiting does not help; a sibling model
#               probably has capacity. One quick retry, then switch.
#   ratelimit - we are going too fast (429). A sibling model shares the same quota, so
#               switching is pointless. Wait, honouring Retry-After if the server sent one.
#   transient - a hiccup. Retry with normal backoff.
FATAL_FOR_MODEL = {400, 401, 402, 403, 404, 422}
CAPACITY = {503, 529}
RATE_LIMIT = {429}
TRANSIENT = {408, 409, 500, 502, 504}

CAPACITY_ATTEMPTS = 2  # then move to the fallback rather than keep waiting

# Models that just failed for a reason that will still be true a second from now
# (overloaded, retired, forbidden). Shared across seats on purpose: when the Gemini seat
# discovers gemini-3.8-flash is overloaded, the Chairman should not rediscover it the hard
# way. Cleared on success, so a model that recovers comes straight back into rotation.
# In-process only -- the CLI forgets between runs, the Phase 2 server will not.
_degraded: set[tuple[str, str]] = set()


def _ordered_candidates(seat: Seat) -> list[tuple[str, str]]:
    """Seat's (provider, model) candidates, known-bad ones moved to the back, never dropped.

    Demoted rather than removed: if every candidate is degraded we still try them all,
    because a stale health note is a worse outcome than one wasted request.
    """
    candidates = list(seat.candidates())
    healthy = [c for c in candidates if c not in _degraded]
    if not healthy:
        return candidates
    return healthy + [c for c in candidates if c in _degraded]


def _retry_after(exc: APIStatusError) -> float | None:
    """Honour a Retry-After header. Guessing beats it only when the server stays silent."""
    try:
        raw = exc.response.headers.get("retry-after")
    except AttributeError:
        return None
    if not raw:
        return None
    try:
        return max(0.0, min(float(raw), 30.0))  # ignore absurd values
    except ValueError:
        return None  # HTTP-date form; not worth parsing for our purposes


class Throttle:
    """Per-provider admission control: bounded concurrency plus a minimum start interval.

    Free tiers are usually capped on tokens per minute rather than requests per minute, so
    the damage comes from several large streams overlapping. Letting a provider run one or
    two calls at a time turns a 429 that costs a whole council seat into a few seconds of
    waiting. Seats on *different* providers still run fully in parallel.
    """

    def __init__(self) -> None:
        self._gates: dict[str, tuple[asyncio.Semaphore, asyncio.Lock]] = {}
        self._last_start: dict[str, float] = {}

    def _gate(self, provider: str) -> tuple[asyncio.Semaphore, asyncio.Lock]:
        # Built lazily: asyncio primitives must be created inside a running loop.
        if provider not in self._gates:
            limit = max(1, PROVIDERS[provider].max_concurrent)
            self._gates[provider] = (asyncio.Semaphore(limit), asyncio.Lock())
        return self._gates[provider]

    @asynccontextmanager
    async def slot(self, provider: str):
        semaphore, lock = self._gate(provider)
        async with semaphore:
            interval = PROVIDERS[provider].min_interval
            if interval > 0:
                # The lock makes the spacing check atomic, so two waiters released at the
                # same moment cannot both decide it is their turn.
                async with lock:
                    loop = asyncio.get_event_loop()
                    gap = loop.time() - self._last_start.get(provider, -1e9)
                    if gap < interval:
                        await asyncio.sleep(interval - gap)
                    self._last_start[provider] = loop.time()
            yield


THROTTLE = Throttle()

DeltaHandler = Callable[[str], Awaitable[None] | None]
ResetHandler = Callable[[], Awaitable[None] | None]


async def _fire(handler, *args) -> None:
    if handler is None:
        return
    result = handler(*args)
    if asyncio.iscoroutine(result):
        await result


async def _stream_completion(
    client: AsyncOpenAI,
    model: str,
    messages: list[dict],
    max_tokens: int,
    temperature: float,
    on_delta: DeltaHandler,
) -> str:
    """Stream a completion, handing each text fragment to on_delta as it arrives.

    The caller is told about deltas optimistically. If this attempt then fails and we
    retry, the caller is responsible for discarding what it already showed -- which is why
    council.py emits a seat_reset event rather than letting a UI keep half an answer.
    """
    parts: list[str] = []
    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        stream=True,
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        piece = chunk.choices[0].delta.content or ""
        if piece:
            parts.append(piece)
            result = on_delta(piece)
            if asyncio.iscoroutine(result):
                await result
    return "".join(parts)


async def _try_one_model(
    provider: str,
    model: str,
    messages: list[dict],
    max_tokens: int,
    temperature: float,
    deadline: float,
    on_delta: DeltaHandler | None = None,
    on_reset: ResetHandler | None = None,
) -> tuple[str | None, str]:
    """Attempt a single model. Returns (text, error) -- exactly one is set.

    `deadline` is an absolute event-loop time. We stop rather than blow through it, so one
    unhealthy provider cannot hold the whole council hostage.
    """
    loop = asyncio.get_event_loop()
    last_error = "unknown error"
    max_attempts = MAX_RETRIES

    attempt = 0
    while attempt < max_attempts:
        if loop.time() >= deadline:
            return None, f"{last_error} (deadline reached)"

        try:
            client = get_client(provider)
        except MissingKey as e:
            return None, str(e)

        wait = None
        streamed = False

        def _note_delta(piece: str):
            nonlocal streamed
            streamed = True
            return on_delta(piece) if on_delta else None

        try:
            async with THROTTLE.slot(provider):
                BUDGET.spend(provider)
                if on_delta is not None:
                    text = (await _stream_completion(
                        client, model, messages, max_tokens, temperature, _note_delta
                    )).strip()
                else:
                    resp = await client.chat.completions.create(
                        model=model,
                        messages=messages,
                        max_tokens=max_tokens,
                        temperature=temperature,
                    )
                    text = (resp.choices[0].message.content or "").strip()
            if text:
                _degraded.discard((provider, model))  # it works again
                return text, ""
            # Reasoning models can spend their whole budget thinking and return nothing.
            last_error = "empty response (model may have used all tokens on reasoning)"

        except APIStatusError as e:
            status = e.status_code
            last_error = f"HTTP {status}"
            if status in FATAL_FOR_MODEL:
                _degraded.add((provider, model))
                return None, last_error
            if status in CAPACITY:
                # Cap attempts on an overloaded model, then let the caller try a sibling.
                _degraded.add((provider, model))
                max_attempts = min(max_attempts, CAPACITY_ATTEMPTS)
                wait = _retry_after(e) or 1.5
            elif status in RATE_LIMIT:
                wait = _retry_after(e) or (2 ** attempt) + random.uniform(0, 0.75)
            elif status not in TRANSIENT:
                return None, last_error
        except (APITimeoutError, APIConnectionError) as e:
            last_error = type(e).__name__
        except Exception as e:  # malformed payloads and other provider oddities
            last_error = f"{type(e).__name__}: {e}"

        # This attempt failed. Anything already streamed to the caller is now garbage.
        if streamed:
            await _fire(on_reset)

        attempt += 1
        if attempt < max_attempts:
            BUDGET.retries += 1
            # Jitter everywhere, so several seats retrying at once don't all hammer the
            # same provider on the same tick.
            delay = wait if wait is not None else (2 ** (attempt - 1)) + random.uniform(0, 0.75)
            # Never sleep past the deadline.
            delay = min(delay, max(0.0, deadline - loop.time()))
            await asyncio.sleep(delay)

    return None, last_error


async def call_model(
    seat: Seat,
    messages: list[dict],
    max_tokens: int,
    temperature: float = 0.7,
    on_delta: DeltaHandler | None = None,
    on_reset: ResetHandler | None = None,
) -> ModelReply:
    """Call one seat, walking its fallback chain. Never raises.

    A failed seat comes back as a ModelReply with .error set. Isolating failure here is
    what lets a council of four survive one dead provider.
    """
    loop = asyncio.get_event_loop()
    started = loop.time()
    deadline = started + SEAT_DEADLINE
    errors: list[str] = []

    for provider, model in _ordered_candidates(seat):
        if loop.time() >= deadline:
            errors.append(f"{model}: skipped (seat deadline reached)")
            break
        text, error = await _try_one_model(
            provider, model, messages, max_tokens, temperature, deadline,
            on_delta, on_reset,
        )
        if text is not None:
            return ModelReply(
                seat.id, text, elapsed=loop.time() - started,
                model_used=model, provider_used=provider,
            )
        errors.append(f"{model}: {error}")
        # A missing key rules out this provider, not the whole chain -- a candidate on a
        # different provider may still answer, so keep going.

    # Report the primary model's failure first -- that's the one worth fixing.
    summary = errors[0].split(": ", 1)[-1] if errors else "unknown error"
    if len(errors) > 1:
        summary += f" (+{len(errors) - 1} fallback{'s' if len(errors) > 2 else ''} also failed)"
    return ModelReply(seat.id, "", error=summary, elapsed=loop.time() - started)
