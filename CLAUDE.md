# CLAUDE.md — LLM Council

Notes for a session picking this project up cold. Structure, history, and tests are readable
from the repo; this file is for what they *don't* say.

## What this is

One question goes to four LLMs. They answer independently, then anonymously review and rank
each other, then a Chairman model synthesises a verdict. The interface is a 3D council chamber:
a walnut table, a seat per model, emblems hovering above each.

## Hard constraints — these shaped nearly every decision

- **$0 budget. Free tiers only. Nothing that requires a payment, ever.**
- **OpenRouter free tier is 50 requests/day.** One question costs ~9–11 requests, so roughly
  five real questions a day. This is the binding constraint on the whole project — it is why
  `?dry=1` exists, why the Chairman's comparison table reuses its *existing* response instead of
  making a second call, and why anything that adds a request needs to justify itself.
- The user supplies original artwork (logos, emblems) — those can't be fetched.
- No account creation on my side (Mixamo, Ready Player Me, etc.).

## Running it

Backend (FastAPI, serves the built frontend too). Use the venv's Python -- the
dependencies are not on the system interpreter, and `python run_tests.py` fails with
`ModuleNotFoundError: dotenv` if you forget:

```bash
./.venv/Scripts/python.exe -m uvicorn server:app --port 8000
```

**Do not rely on `--reload` on this machine.** It logs `WatchFiles detected changes...
Reloading...` and then keeps serving the old code: the reloader spawns its worker through
multiprocessing, the old worker is orphaned rather than replaced, and it survives even a
kill of the parent. This has now cost two separate debugging sessions -- the first spent
chasing "broken" tabulate data, the second convinced a dry-run fixture edit had not taken
effect when the file, the import and an in-process run of the same function all proved it
had.

**After any change under `council/` or to `server.py`, restart the server explicitly**,
and confirm the port is actually free before starting the new one:

```bash
powershell "Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue"
```

The frontend does not have this problem: Vite's HMR is reliable here.

Frontend dev server, Vite on **5173** (CORS in `server.py` allows exactly this origin):

```bash
cd web && npm run dev
```

Python tests — four suites, all pure, no network:

```bash
python run_tests.py
```

### `?dry=1` — use this constantly

Appending `?dry=1` to the URL runs the entire flow against canned responses with **zero API
calls**. Every piece of interface work should be done this way. It is a URL flag rather than a
visible toggle deliberately: it's a development tool, and against a 50/day ceiling it needs to
be effortless to reach.

## Architecture

```
council/        pure orchestration — no web, no CLI. Emits typed events via a callback.
cli.py          terminal interface over council/
server.py       FastAPI + SSE over the same council/
web/            React 19 + Vite + @react-three/fiber
```

The event callback is the load-bearing decision. CLI, then the SSE server, then the 3D avatars
were each added **without changing the layer beneath**. Keep it that way: if a new interface
needs data, it should arrive as a new event, not as a special case inside `council/`.

| File | Holds |
|---|---|
| `council/config.py` | Seats, providers, fallback chains, throttles, token limits |
| `council/providers.py` | The one `call_model()`; failure classification; throttling |
| `council/ranking.py` | Anonymisation, ranking parsing, Borda count |
| `council/synthesis.py` | Parses the Chairman's structured trailing sections |
| `web/src/App.tsx` | Phase orchestration — the flow is a state machine here |
| `web/src/three/CouncilScene.tsx` | Scene, camera rig, seat layout |
| `web/src/theme.ts` | The single palette. Written onto `:root` by `applyTheme()` at boot |

### Providers

Three providers (OpenRouter, Groq, Google AI Studio), all speaking the OpenAI chat-completions
wire format — so there is **one** `call_model()` parameterised by `base_url` and key. No
per-provider SDKs, no adapter classes. This is what makes multi-provider cost almost nothing in
complexity, and it's worth preserving when adding a fourth.

**Model IDs churn constantly.** Groq dropped every Llama model mid-build; `gemini-2.5-flash`
became unavailable to new users. If a seat starts failing, probe the live `/models` endpoint
before assuming a code bug. Swapping a seat is a one-line edit in `config.py`.

### Failure classification — do not flatten this

`providers.py` sorts failures by *kind*, not by "did it fail":

```python
FATAL_FOR_MODEL = {400, 401, 402, 403, 404, 413, 422, 431}
CAPACITY = {503, 529}; RATE_LIMIT = {429}; TRANSIENT = {408, 409, 500, 502, 504}
```

Retrying a 404 forever is pointless; not retrying a 503 throws away a working seat. Treating
them uniformly once cost 21 requests and 231 seconds for a run that now takes 72. **A status
code in no bucket at all is a silent bug** — that's how the 413 on conversation turn 2 slipped
through. When adding a code, put it in a bucket.

### Ranking survives truncation by structure, not by budget

Reviews must emit `RANKING:` on the **first** line. Free models get truncated; when the ranking
sat at the end, truncation ate the vote and only 2 of 4 rankings parsed. Raising the token limit
would have been a guess. Putting the vote first means truncation can only cost the prose.

## Frontend specifics

### Three.js traps hit in this project — all silent, all expensive

- **`Object3D.clone()` does not clone skeletons.** Use `SkeletonUtils.clone`. All five characters
  ended up sharing one rig at the origin. I then made the identical mistake a second time in a
  different file by not carrying the fix across.
- **`Box3.setFromObject` lies about skinned meshes.** It reported 0.004 units and scaled the
  characters ~430× off-screen. Measure from the head bone's world position instead.
- **glTF strips dots from bone names** (`UpperArm.L` → `UpperArmL`), via
  `PropertyBinding.sanitizeNodeName`. Match bone names normalised.
- Camera fit is real frustum maths, not a tuned multiplier:
  `halfH = atan(tan(halfV) * aspect)`, `distance = R / tan(halfAngle)`. A hand-tuned factor did
  not survive a fresh load. And a narrow screen needs a **wider lens**, not just more distance —
  correcting distance alone put the camera 27 units back and made the room a speck.

### Known-unresolved: characters don't render reliably

`AVATAR_MODE = "abstract"` in `web/src/avatars.ts` because the Mixamo/GLB path is intermittent
in both FBX and GLB. Already ruled out: the files themselves (they parse fine from a CDN in
713ms), glTF generally (the armchair loads every time), skeleton cloning, and queue stalls.
Whatever it is, it's elsewhere. The abstract avatars are the shipping path, not a placeholder
waiting on a five-minute fix.

### Accessibility decisions that must not regress

- Panels use **`inert`**, not `aria-hidden`. `aria-hidden` hides from the accessibility tree
  while leaving elements *focusable* — a keyboard user landed on controls a screen reader
  announced as nothing. Measured before/after: 9 of 9 controls reachable → 1 of 9.
- `.centre-trigger` is a real DOM button over the table centre, with `pointer-events: none` so
  the raycast mesh still handles the mouse. Without it there was **no keyboard path to start**.
- One `role="status" aria-live="polite"` region narrates stage changes and seat completions.
  A multi-minute run with four concurrent workers otherwise announces nothing at all.
- Reduced motion must not delete the only signal that something is happening. A blanket
  `transition-duration: 0.01ms !important` on `*` silently killed the working-state spinner.

### Accepted, not bugs

- `clipped-overflow-container` on `.sheet` — deliberate, and scoped to the closed state. It is
  what stops the off-canvas drawer giving a 375px phone a 750px sideways scroll.
- `content-hidden-at-rest` — all panels live in the DOM and are revealed by phase. Conditional
  mounting would break the closing transitions.

## Verification lessons

**When a measurement contradicts a screenshot, trust the screenshot.** In this repo specifically:
console capture returns "no logs" on this page, the network panel accumulates across reloads,
and `document.body.dataset` probes reported a component unmounted while its own debug marker was
visibly on screen.

Also: scanning static source is not scanning the rendered page. A "clean" static scan sat
alongside seven findings on the live DOM.

**Motion has never been watched in real time by anyone.** Every visual check so far has been a
single-frame screenshot. The formation sequence, ring sweeps, camera push and hover transitions
are unverified in motion — only the user can close that.

## Untested

- "Ask the dissenter" and the follow-up chips — dry-run only, never against live models.
- Safari and Firefox — never opened.

## Housekeeping

- `.env` holds three API keys and is git-ignored. Keep it that way.
- Every run writes a full JSON transcript under `data/` — the interface can be developed against
  saved transcripts at zero API cost.
- `.impeccable/critique/` holds a persisted critique snapshot that `/impeccable polish` reads as
  its backlog.
- Remote: `github.com/imran2007-A/llm-council` (private). `gh` CLI is installed and authenticated.
