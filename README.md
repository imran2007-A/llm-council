# LLM Council

Ask one question. Four different LLMs answer it independently, then anonymously review and
rank each other's answers, then a Chairman model synthesises the final verdict.

Runs entirely on free tiers. No credit card, no cost.

```
Stage 1  ->  four models answer, concurrently, in isolation
Stage 2  ->  each model critiques and ranks all four answers, identities hidden
Stage 3  ->  the Chairman reads everything and delivers the verdict
```

## The council

| Seat | Provider | Model |
|---|---|---|
| 1 | OpenRouter | `nvidia/nemotron-3-super-120b-a12b:free` |
| 2 | Groq | `llama-3.3-70b-versatile` |
| 3 | Groq | `openai/gpt-oss-120b` |
| 4 | Google AI Studio | `gemini-2.5-flash` |
| Chairman | Google AI Studio | `gemini-2.5-flash` |

Four different model lineages on purpose — a council of four near-identical models just
agrees with itself. Edit `council/config.py` to swap a seat; it's one line.

Three providers rather than one for two reasons: diversity, and request budget. OpenRouter's
free tier allows **50 requests/day** (until $10 of credit has ever been purchased, which
raises it to 1,000). One council question costs ~9 requests. Spreading across Groq
(1,000/day) and Google (1,500/day) is what makes this usable day to day.

## Setup

Get three free API keys — none require a credit card:

1. OpenRouter — <https://openrouter.ai> → Keys
2. Groq — <https://console.groq.com> → API Keys
3. Google AI Studio — <https://aistudio.google.com/apikey>

Then:

```bash
cp .env.example .env      # paste your three keys into .env
python -m venv .venv
.venv/Scripts/activate    # Windows;  source .venv/bin/activate elsewhere
pip install -r requirements.txt
```

> Google's free tier may use your prompts to improve their models. Don't send anything private.

## Usage

```bash
python cli.py "Should I learn Rust or go deeper on Python?"
```

| Flag | What it does |
|---|---|
| `--dry-run` | Runs all three stages with fake responses. Zero API calls. |
| `--cache` | Reuses stage-1 answers for a question you've already asked, so you can iterate on the review and chairman prompts without re-spending four requests each time. |
| `--seats 2` | Smaller council while developing. |
| `--replay RUN_ID` | Re-prints a saved transcript. |
| `--list` | Lists saved runs. |

Every run writes a full JSON transcript to `data/runs/`. Each run prints its request count
against each provider's daily limit when it finishes.

## How it holds up

- **A dead seat doesn't kill the council.** Each model call is isolated; failures come back as
  a result with an error on it, never an exception. Three models answering is still a council.
- **Rate limits are retried,** with exponential backoff plus jitter so four seats hitting a 429
  at once don't retry in lockstep.
- **Anonymisation is shuffled,** not just relabelled. Without the shuffle, "Response A" would
  always be the same seat and any positional bias in reviewers would skew every run identically.
- **Ranking parsing degrades** through three formats before giving up, because free models
  ignore output instructions constantly. A reviewer that submits nothing usable is simply
  excluded from the aggregate rather than crashing the run.
- **Rankings aggregate by Borda count,** which handles partial rankings and breaks ties
  deterministically.

```bash
python tests_ranking.py    # covers the parsing and aggregation edge cases
```

## Where this is going

Phase 1 (this) is the terminal version. Next:

- **Phase 2** — FastAPI wrapping the same `council/` package, streaming stage events over SSE.
- **Phase 3** — React UI: four seat cards filling in concurrently, ranking table, streaming verdict.
- **Phase 4** — a 3D council table (react-three-fiber): an avatar per model, animating as it
  speaks, driven by the same event stream.

`council/council.py` already emits typed events (`stage_changed`, `seat_started`,
`seat_finished`, `review_finished`, `run_finished`) through an optional callback. The CLI
prints them; the web server will stream them; the 3D avatars will animate off them. That's why
those phases don't require rewriting this one.
