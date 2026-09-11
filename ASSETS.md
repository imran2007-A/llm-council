# Asset credits

Everything in `web/public/models/` is **CC0 / public domain** — free for any use,
commercial included, with no attribution required. Credited here anyway.

| Asset | Source | Licence |
|---|---|---|
| `chair/ArmChair_01*` | [Poly Haven](https://polyhaven.com/a/ArmChair_01) | CC0 |
| `seat-nemotron.glb` (Suit, m) | Quaternius — Modular Characters | CC0 |
| `seat-gptoss.glb` (Suit, f) | Quaternius — Modular Characters | CC0 |
| `seat-qwen.glb` (Formal, f) | Quaternius — Modular Characters | CC0 |
| `seat-gemini.glb` (Casual, m) | Quaternius — Modular Characters | CC0 |
| `seat-chairman.glb` (King) | Quaternius — Modular Characters | CC0 |

Fonts are Cormorant Garamond and Inter, both SIL Open Font License, loaded from
Google Fonts.

## Still to come from the project owner

- App logo / wordmark (`.svg` preferred)
- Five per-seat emblems (square `.svg`) — original designs, not company logos
- Optionally, Ready Player Me avatars to replace the CC0 characters:
  drop them in as `seat-<id>.glb` and they are picked up automatically.

## Swapping the characters

`web/src/three/Avatar.tsx` has one constant, `AVATAR_STYLE`:

- `"gltf"` — the loaded models (current)
- `"figure"` — simple procedural figures, no files needed
- `"abstract"` — floating geometric forms

The seated pose is applied in code by `web/src/three/seated.ts`, which aims each bone
rather than rotating by fixed angles, so a replacement rig with different conventions
still sits down correctly.
