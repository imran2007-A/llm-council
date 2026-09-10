"""One async client factory and one call_model() for every provider."""

from __future__ import annotations

import asyncio
import os
import random
from dataclasses import dataclass, field

from dotenv import load_dotenv
from openai import AsyncOpenAI, APIStatusError, APITimeoutError, APIConnectionError

from .config import MAX_RETRIES, PROVIDERS, REQUEST_TIMEOUT, Seat

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
    model_used: str | None = None  # which candidate answered, if a fallback was needed

    @property
    def ok(self) -> bool:
        return self.error is None and bool(self.text.strip())


# Worth another attempt at the same model: rate limits and transient provider faults.
RETRYABLE = {408, 409, 429, 500, 502, 503, 504}
# No point retrying the same model: it is gone, forbidden, or wants money.
FATAL_FOR_MODEL = {400, 401, 402, 403, 404}


async def _try_one_model(
    seat: Seat, model: str, messages: list[dict], max_tokens: int, temperature: float
) -> tuple[str | None, str]:
    """Attempt a single model with backoff. Returns (text, error) -- exactly one is set."""
    last_error = "unknown error"

    for attempt in range(MAX_RETRIES):
        try:
            client = get_client(seat.provider)
        except MissingKey as e:
            return None, str(e)

        try:
            BUDGET.spend(seat.provider)
            resp = await client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            text = (resp.choices[0].message.content or "").strip()
            if text:
                return text, ""
            # Reasoning models can spend their whole budget thinking and return nothing.
            last_error = "empty response (model may have used all tokens on reasoning)"

        except APIStatusError as e:
            last_error = f"HTTP {e.status_code}"
            if e.status_code in FATAL_FOR_MODEL:
                return None, last_error  # move straight to the next candidate
            if e.status_code not in RETRYABLE:
                return None, last_error
        except (APITimeoutError, APIConnectionError) as e:
            last_error = type(e).__name__
        except Exception as e:  # malformed payloads and other provider oddities
            last_error = f"{type(e).__name__}: {e}"

        if attempt < MAX_RETRIES - 1:
            BUDGET.retries += 1
            # Exponential backoff with jitter, so several seats retrying at once
            # don't all hammer the same provider on the same tick.
            await asyncio.sleep((2 ** attempt) + random.uniform(0, 0.75))

    return None, last_error


async def call_model(
    seat: Seat,
    messages: list[dict],
    max_tokens: int,
    temperature: float = 0.7,
) -> ModelReply:
    """Call one seat, walking its fallback chain. Never raises.

    A failed seat comes back as a ModelReply with .error set. Isolating failure here is
    what lets a council of four survive one dead provider.
    """
    loop = asyncio.get_event_loop()
    started = loop.time()
    errors: list[str] = []

    for model in seat.candidates():
        text, error = await _try_one_model(seat, model, messages, max_tokens, temperature)
        if text is not None:
            return ModelReply(
                seat.id, text, elapsed=loop.time() - started, model_used=model
            )
        errors.append(f"{model}: {error}")
        if "is not set" in error:
            break  # missing key: no candidate on this provider can work

    # Report the primary model's failure first -- that's the one worth fixing.
    summary = errors[0].split(": ", 1)[-1] if errors else "unknown error"
    if len(errors) > 1:
        summary += f" (+{len(errors) - 1} fallback{'s' if len(errors) > 2 else ''} also failed)"
    return ModelReply(seat.id, "", error=summary, elapsed=loop.time() - started)
