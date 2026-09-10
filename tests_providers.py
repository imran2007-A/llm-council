"""Checks on the failure-handling policy, with no network involved.

The retry rules only matter when providers misbehave, which is exactly when it's hardest
to test by hand. These pin the behaviour down.

Run: python tests_providers.py
"""

from council import providers
from council.config import Seat

failures = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}\n    got  {got!r}\n    want {want!r}")


seat = Seat("s", "Seat", "google", "primary",
            fallbacks=(("google", "alt1"), ("groq", "cross-provider")))
P, A1, X = ("google", "primary"), ("google", "alt1"), ("groq", "cross-provider")


# --- candidate ordering -----------------------------------------------------
providers._degraded.clear()
check("a cross-provider fallback is a normal candidate",
      seat.candidates()[-1], X)
check("no health info: declared order",
      providers._ordered_candidates(seat), [P, A1, X])

providers._degraded.clear()
providers._degraded.add(P)
check("degraded primary demoted, not dropped",
      providers._ordered_candidates(seat), [A1, X, P])

providers._degraded.clear()
providers._degraded.update({P, A1})
check("two degraded, order preserved within each group",
      providers._ordered_candidates(seat), [X, P, A1])

providers._degraded.clear()
providers._degraded.update({P, A1, X})
check("all degraded: still try everything in declared order",
      providers._ordered_candidates(seat), [P, A1, X])

providers._degraded.clear()
providers._degraded.add(("openrouter", "some-other-seats-model"))
check("unrelated degraded model is ignored",
      providers._ordered_candidates(seat), [P, A1, X])

providers._degraded.clear()


# --- status code classification ---------------------------------------------
# A code must land in exactly one bucket, or the handler order decides behaviour
# by accident rather than by design.
buckets = {
    "fatal": providers.FATAL_FOR_MODEL,
    "capacity": providers.CAPACITY,
    "ratelimit": providers.RATE_LIMIT,
    "transient": providers.TRANSIENT,
}
for a_name, a in buckets.items():
    for b_name, b in buckets.items():
        if a_name < b_name:
            check(f"{a_name} and {b_name} must not overlap", a & b, set())

check("404 is fatal, not retryable", 404 in providers.FATAL_FOR_MODEL, True)
check("503 is capacity, so we switch models", 503 in providers.CAPACITY, True)
check("429 is rate limit, so we wait", 429 in providers.RATE_LIMIT, True)
check("429 is not treated as capacity", 429 in providers.CAPACITY, False)
check("capacity attempts are capped low", providers.CAPACITY_ATTEMPTS <= 2, True)


# --- Retry-After parsing -----------------------------------------------------
class FakeResponse:
    def __init__(self, value):
        self.headers = {"retry-after": value} if value is not None else {}


class FakeError:
    def __init__(self, value):
        self.response = FakeResponse(value)


check("plain seconds", providers._retry_after(FakeError("5")), 5.0)
check("fractional seconds", providers._retry_after(FakeError("2.5")), 2.5)
check("absurd value is capped", providers._retry_after(FakeError("9999")), 30.0)
check("negative is clamped to zero", providers._retry_after(FakeError("-3")), 0.0)
check("http-date form gives up cleanly",
      providers._retry_after(FakeError("Wed, 21 Oct 2026 07:28:00 GMT")), None)
check("absent header", providers._retry_after(FakeError(None)), None)
check("no response attribute at all", providers._retry_after(object()), None)


if failures:
    print(f"{len(failures)} FAILED\n")
    print("\n".join(failures))
    raise SystemExit(1)
print("all provider-policy tests passed")
