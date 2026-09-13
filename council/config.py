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
    # How many calls we let run against this provider at once.
    #
    # The binding limit on a free tier is usually tokens per minute, not requests. Two
    # seats on Groq each streaming a 2000-token answer at the same moment blew its TPM
    # cap and got one seat 429'd out of the council entirely. Serialising a provider's
    # calls costs a few seconds and buys back a whole council member.
    max_concurrent: int = 4
    # Minimum gap between starting two calls on this provider, to stay under the RPM cap
    # and to stop a burst arriving as one spike.
    min_interval: float = 0.0


PROVIDERS = {
    "openrouter": Provider(
        name="openrouter",
        base_url="https://openrouter.ai/api/v1",
        env_key="OPENROUTER_API_KEY",
        rpm=20,
        rpd=50,  # 1000 once $10 of credit has ever been purchased
        max_concurrent=2,
        min_interval=3.0,  # 20/min
    ),
    "groq": Provider(
        name="groq",
        base_url="https://api.groq.com/openai/v1",
        env_key="GROQ_API_KEY",
        rpm=30,
        rpd=1000,
        max_concurrent=1,  # TPM is the real cap here; one at a time keeps seats alive
        min_interval=2.0,
    ),
    "google": Provider(
        name="google",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        env_key="GOOGLE_API_KEY",
        rpm=15,
        rpd=1500,
        max_concurrent=2,
        min_interval=4.0,  # 15/min
    ),
}


@dataclass(frozen=True)
class Seat:
    id: str          # stable key used in transcripts and (later) 3D avatar bindings
    label: str       # what a human sees
    provider: str
    model: str
    # Two sentences on who this member is, shown when you click their emblem at the
    # table. Lives here rather than in the frontend because the seat roster is already
    # the one place a member is described, and a second list in TypeScript would drift
    # from it the first time a model is swapped out.
    blurb: str = ""
    # Tried in order if the primary is overloaded or retired, as (provider, model) pairs.
    # Crossing providers matters: when Google is saturated, every Gemini model is
    # saturated, so a same-provider fallback chain just fails four times more slowly.
    fallbacks: tuple[tuple[str, str], ...] = ()

    def candidates(self) -> tuple[tuple[str, str], ...]:
        return ((self.provider, self.model), *self.fallbacks)


# Four seats, four different model lineages. Swapping a seat is a one-line edit.
#
# Verified live against each provider on 2026-09-10. Two notes for when these break,
# because they will:
#   - Groq no longer serves any Llama chat model; Qwen and GPT-OSS are what's left.
#   - Google lists gemini-2.5-flash in /models but refuses it for accounts created after
#     it was retired ("no longer available to new users"). Listed does not mean callable.
# Run `python check_keys.py` to find out which seats your account can actually reach.
GEMINI_FALLBACKS = (
    ("google", "gemini-flash-latest"),
    ("google", "gemini-3.6-flash"),
    ("google", "gemini-3.1-flash-lite"),
    ("groq", "openai/gpt-oss-120b"),  # last resort: leave Google entirely
)

SEATS = [
    Seat("nemotron", "Nemotron 3 Super 120B", "openrouter", "nvidia/nemotron-3-super-120b-a12b:free",
         blurb="Nvidia's open-weight flagship, and the largest model this council can "
               "reach for free. Reasons at length and tends to hedge rather than commit.",
         fallbacks=(("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"),)),
    Seat("gptoss",   "GPT-OSS 120B",          "groq",       "openai/gpt-oss-120b",
         blurb="OpenAI's open-weight release, served by Groq and answering faster than "
               "anything else at the table. Structured, direct, rarely hedges.",
         fallbacks=(("groq", "openai/gpt-oss-20b"),)),
    Seat("qwen",     "Qwen 3.8 27B",          "groq",       "qwen/qwen3.8-27b",
         blurb="Alibaba's open-weight model, the smallest voice here. Strong on code and "
               "reasoning, and the most willing to disagree with the rest of the room.",
         fallbacks=(("groq", "qwen/qwen3.6-27b"),
                    ("openrouter", "nvidia/nemotron-3-super-120b-a12b:free"))),
    Seat("gemini",   "Gemini 3.8 Flash",      "google",     "gemini-3.8-flash",
         blurb="Google's fast frontier model, and the only closed-weight member. Broad "
               "general knowledge, and the most likely to ask what you actually meant.",
         fallbacks=GEMINI_FALLBACKS),
]

# The Chairman runs last and cannot be skipped -- if it fails, the whole run has nothing to
# show. Measured 2026-09-10: Google's free tier was saturated, costing ~7 requests and 25-160s
# per call, while Groq answered in under a second. Reliability beats prose quality for the one
# step that has no fallback position, so the chair sits on Groq with Gemini behind it.
CHAIRMAN = Seat("chairman", "Chairman (GPT-OSS 120B)", "groq", "openai/gpt-oss-120b",
                blurb="Reads every answer and every ranking, then writes the verdict. It "
                      "never votes -- a chair that scores the debate it is judging is not "
                      "a chair.",
                fallbacks=(("google", "gemini-3.8-flash"),
                           ("google", "gemini-flash-latest"),
                           ("groq", "qwen/qwen3.8-27b")))

# Generation settings.
# These were originally 900/700/1200 and every stage was visibly truncating: reviewers
# complained the answers "cut off mid-sentence", and one reviewer's ranking line was
# clipped off entirely. Free models are free -- output tokens are the wrong thing to
# economise on. The daily request count is the real budget, not tokens per request.
OPINION_MAX_TOKENS = 2000
REVIEW_MAX_TOKENS = 1600
CHAIRMAN_MAX_TOKENS = 3000
# The review and chairman prompts quote every council answer back. Four answers at
# OPINION_MAX_TOKENS each, plus conversation history, grew the chairman's request past
# Groq's size limit on the second turn of a conversation and got an HTTP 413. Quoting a
# bounded slice of each answer keeps the prompt flat no matter how long the conversation
# or how verbose the models get.
MAX_RESPONSE_CHARS = 4500

REQUEST_TIMEOUT = 120.0
MAX_RETRIES = 3
# Hard ceiling on how long one seat may spend across all its retries and fallbacks.
# Without this, a single overloaded provider stalls the whole council: one run spent
# 231s and 21 requests on one seat before this existed.
SEAT_DEADLINE = 75.0


def seat_by_id(seat_id: str) -> Seat | None:
    for s in SEATS:
        if s.id == seat_id:
            return s
    return CHAIRMAN if CHAIRMAN.id == seat_id else None
