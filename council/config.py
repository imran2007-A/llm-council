"""Who sits on the council, and how to reach them.

Every provider here speaks the OpenAI chat-completions wire format, so the whole
multi-provider setup costs us one base_url and one env var per provider.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Provider:
    name: str
    base_url: str
    env_key: str
    # Free-tier ceilings, for the budget report at the end of a run.
    rpm: int
    rpd: int


PROVIDERS = {
    "openrouter": Provider(
        name="openrouter",
        base_url="https://openrouter.ai/api/v1",
        env_key="OPENROUTER_API_KEY",
        rpm=20,
        rpd=50,  # 1000 once $10 of credit has ever been purchased
    ),
    "groq": Provider(
        name="groq",
        base_url="https://api.groq.com/openai/v1",
        env_key="GROQ_API_KEY",
        rpm=30,
        rpd=1000,
    ),
    "google": Provider(
        name="google",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        env_key="GOOGLE_API_KEY",
        rpm=15,
        rpd=1500,
    ),
}


@dataclass(frozen=True)
class Seat:
    id: str          # stable key used in transcripts and (later) 3D avatar bindings
    label: str       # what a human sees
    provider: str
    model: str
    # Tried in order if `model` is overloaded or retired. Free endpoints return 503
    # under load, and retrying a busy model harder doesn't help -- a sibling model does.
    fallbacks: tuple[str, ...] = ()

    def candidates(self) -> tuple[str, ...]:
        return (self.model, *self.fallbacks)


# Four seats, four different model lineages. Swapping a seat is a one-line edit.
#
# Verified live against each provider on 2026-09-10. Two notes for when these break,
# because they will:
#   - Groq no longer serves any Llama chat model; Qwen and GPT-OSS are what's left.
#   - Google lists gemini-2.5-flash in /models but refuses it for accounts created after
#     it was retired ("no longer available to new users"). Listed does not mean callable.
# Run `python check_keys.py` to find out which seats your account can actually reach.
GEMINI_FALLBACKS = ("gemini-flash-latest", "gemini-3.6-flash", "gemini-3.1-flash-lite")

SEATS = [
    Seat("nemotron", "Nemotron 3 Super 120B", "openrouter", "nvidia/nemotron-3-super-120b-a12b:free",
         fallbacks=("nvidia/nemotron-3-ultra-550b-a55b:free",)),
    Seat("gptoss",   "GPT-OSS 120B",          "groq",       "openai/gpt-oss-120b",
         fallbacks=("openai/gpt-oss-20b",)),
    Seat("qwen",     "Qwen 3.8 27B",          "groq",       "qwen/qwen3.8-27b",
         fallbacks=("qwen/qwen3.6-27b",)),
    Seat("gemini",   "Gemini 3.8 Flash",      "google",     "gemini-3.8-flash",
         fallbacks=GEMINI_FALLBACKS),
]

CHAIRMAN = Seat("chairman", "Chairman (Gemini 3.8 Flash)", "google", "gemini-3.8-flash",
                fallbacks=GEMINI_FALLBACKS)

# Generation settings
OPINION_MAX_TOKENS = 900
REVIEW_MAX_TOKENS = 700
CHAIRMAN_MAX_TOKENS = 1200
REQUEST_TIMEOUT = 120.0
MAX_RETRIES = 3


def seat_by_id(seat_id: str) -> Seat | None:
    for s in SEATS:
        if s.id == seat_id:
            return s
    return CHAIRMAN if CHAIRMAN.id == seat_id else None
