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


# Four seats, four different model lineages. Swapping a seat is a one-line edit.
SEATS = [
    Seat("nemotron", "Nemotron 3 Super 120B", "openrouter", "nvidia/nemotron-3-super-120b-a12b:free"),
    Seat("llama",    "Llama 3.3 70B",         "groq",       "llama-3.3-70b-versatile"),
    Seat("gptoss",   "GPT-OSS 120B",          "groq",       "openai/gpt-oss-120b"),
    Seat("gemini",   "Gemini 2.5 Flash",      "google",     "gemini-2.5-flash"),
]

CHAIRMAN = Seat("chairman", "Chairman (Gemini 2.5 Flash)", "google", "gemini-2.5-flash")

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
