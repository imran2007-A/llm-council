# LLM Council

Ask one question. Four different LLMs answer it independently, then anonymously review and
rank each other's answers, then a Chairman model synthesises the final verdict.

Runs entirely on free tiers. No credit card, no cost.

```
Stage 1  ->  four models answer, concurrently, in isolation
Stage 2  ->  each model critiques and ranks all four answers, identities hidden
Stage 3  ->  the Chairman reads everything and delivers the verdict
```

Three ways to use it: a terminal CLI, a dependency-free web page, and a React app with a
3D council table.

---

## Running it (Windows)

Double-click one of these in the project folder:

| | |
|---|---|
| `council.cmd` | The real thing. Each question spends roughly 9-11 of the 50 free daily requests. |
| `council-demo.cmd` | Canned answers, zero API requests. The whole interface, safe to leave open. |

One process does everything: the FastAPI server also serves the built interface, so there
is no second window and Node is not needed to run it. Closing the window stops the server.

The first launch builds the interface once (that step does need Node). After that it
starts in a couple of seconds.

To put it on the desktop or taskbar: right-click `council.cmd` -> **Show more options** ->
**Send to** -> **Desktop (create shortcut)**. Pin that shortcut to the taskbar or Start if
you want it one click away.

---

## The council

| Seat | Provider | Model |
|---|---|---|
| 1 | OpenRouter | `nvidia/nemotron-3-super-120b-a12b:free` |
| 2 | Groq | `openai/gpt-oss-120b` |
| 3 | Groq | `qwen/qwen3.8-27b` |
| 4 | Google AI Studio | `gemini-3.8-flash` |
| Chairman | Groq | `openai/gpt-oss-120b` |

Four different model lineages on purpose — a council of near-identical models just agrees
with itself. Edit `council/config.py` to swap a seat; it's one line.

Three providers rather than one, for two reasons. **Diversity**, and **request budget**:
OpenRouter's free tier allows 50 requests a day (1,000 once $10 of credit has ever been
purchased) and one council question costs about nine. Groq (1,000/day) and Google
(1,500/day) supply the headroom.

Every seat has a fallback chain that can **cross providers**, so a saturated provider
degrades the council instead of breaking it.

> Model rosters change constantly, and a model listed in a provider's `/models` can still
> be refused for your account. Run `python check_keys.py` to see what yours can reach.

---

## Setup

Three free API keys, no credit card on any:

1. OpenRouter — <https://openrouter.ai/settings/keys>
2. Groq — <https://console.groq.com/keys>
3. Google AI Studio — <https://aistudio.google.com/apikey>

```bash
cp .env.example .env          # paste your three keys in; .env is git-ignored
python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate elsewhere
pip install -r requirements.txt
python check_keys.py          # 5 tiny requests, confirms every seat is reachable
```

> Google's free tier may use your prompts to improve their models. Don't send anything private.

---

## Using it

### Terminal

```bash
python cli.py "Should I learn Rust or go deeper on Python?"
```

| Flag | What it does |
|---|---|
| `--dry-run` | All three stages with fake responses. Zero API calls. |
| `--cache` | Reuse stage-1 answers for a question already asked, so you can iterate on the review and chairman prompts without re-spending four requests. |
| `--new` | Start a conversation and print its id. |
| `-c ID` | Continue a conversation — the council remembers earlier turns. |
| `--conversations` | List conversations. |
| `--usage` | Requests used today against each free-tier limit. |
| `--seats N` | Smaller council while developing. |
| `--replay ID` | Re-print a saved transcript. |
| `--list` | List saved runs. |

### Web

```bash
uvicorn server:app --reload
```

- <http://127.0.0.1:8000> — the React app (once built), else the simple client
- <http://127.0.0.1:8000/simple/> — the dependency-free single page, always available
- <http://127.0.0.1:8000/docs> — API explorer

### React app

```bash
cd web
npm install
npm run dev      # http://localhost:5173, proxies /api to port 8000
npm run build    # emits ../static_web, which the server picks up automatically
```

The 3D view is code-split, so three.js (~875 kB) only downloads if you open it.

---

## API

| Endpoint | What it does |
|---|---|
| `GET /api/config` | Council roster, so a UI can lay out seats before asking anything |
| `POST /api/council` | Starts a run; returns `run_id` and `conversation_id` |
| `GET /api/council/{id}/stream` | Server-Sent Events for that run, token by token |
| `GET /api/council/{id}` | Transcript, live or finished |
| `GET /api/runs` | Saved run ids |
| `GET /api/conversations` | Conversation list |
| `GET /api/conversations/{id}` | One conversation with all its turns |
| `GET /api/usage` | Today's request spend per provider, plus recent history |

### Events

`stage_changed`, `seat_started`, `seat_token`, `seat_reset`, `cache_hit`, `seat_finished`,
`review_finished`, `run_finished`, `run_failed`, `heartbeat`.

Every event names its seat, which is what lets the 3D avatars animate off the same stream
the cards use. `seat_reset` means **discard what you have shown for that seat** — the
attempt that produced it failed and a retry or fallback is starting over.

Late subscribers get the full event history before joining live, so opening the stream
after a run has started still shows the whole session.

---

## How it holds up

- **A dead seat doesn't kill the council.** Each model call is isolated; failures come back
  as a result with an error on it, never an exception. Three models answering is still a
  council.
- **Failures are handled by kind, not uniformly.** A 429 ("too fast") and a 503 ("this
  model is overloaded") need opposite responses — wait versus switch model. Treating them
  identically once cost 21 requests and 231 seconds for three answers.
- **Fallbacks cross providers.** A same-provider chain is useless when the whole provider
  is saturated; it just fails four times more slowly.
- **Providers are throttled.** Free tiers usually cap *tokens* per minute, so several large
  streams overlapping is what triggers a 429. Each provider has a concurrency limit and a
  minimum interval between calls.
- **Anonymisation is shuffled,** not just relabelled. Without the shuffle, "Response A"
  would always be the same seat, and any positional bias in reviewers would skew every run
  the same way.
- **The ranking comes first in each review,** not last. A truncated review still casts its
  vote. This was found the hard way: reviewers kept complaining answers "cut off
  mid-sentence" — which was them reporting a bug in the token limits.
- **Ranking parsing degrades** through three formats before giving up. A reviewer that
  submits nothing usable is excluded from the aggregate rather than crashing the run.
- **Rankings aggregate by Borda count,** which handles partial rankings and breaks ties
  deterministically.

```bash
python run_tests.py      # 3 suites, ~80 checks, no API keys needed
```

Everything is offline and dry-run, so CI runs it on every push with no secrets.

---

## Layout

```
council/          the whole engine, independent of any interface
  config.py       seats, providers, fallback chains, limits
  providers.py    one call_model() for every provider; retry, throttle, failover
  council.py      the three stages, emitting typed events
  prompts.py      the three prompts and conversation history
  ranking.py      anonymisation, ranking parsing, Borda count
  storage.py      transcripts, cache, conversations
  usage.py        persisted daily request accounting
cli.py            terminal interface
server.py         FastAPI + SSE
static/           dependency-free web client
web/              React + Vite + react-three-fiber
```

`council/` knows nothing about the CLI, the server or the browser. It emits events through
a callback; the CLI prints them, the server streams them, the avatars animate off them.
That's why adding each interface didn't require changing the one before it.

---

## Deploying

Local by default. To deploy:

```bash
docker build -t llm-council .
docker run -p 8000:8000 --env-file .env -v "$PWD/data:/app/data" llm-council
```

The image contains no secrets — keys arrive as environment variables. `PORT` and
`CORS_ORIGINS` are configurable. Mount `/app/data` to keep transcripts and conversations.

Anywhere that runs a container and holds a long-lived HTTP connection will work; SSE needs
streaming responses, so serverless platforms that buffer responses will not.

> Deploying puts your API keys on someone else's machine. They're free-tier keys, but they
> are still yours — rotate them if a host is ever compromised.
