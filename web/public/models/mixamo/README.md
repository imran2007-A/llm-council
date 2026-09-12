# Mixamo characters

Drop files here to replace the abstract forms with real characters, then set
`AVATAR_MODE = "mixamo"` in `web/src/avatars.ts`.

## What to download

At <https://www.mixamo.com> (free, needs an Adobe account):

**Characters** — pick five, and for each use **Download → FBX Binary(.fbx), T-pose**:

    seat-nemotron.fbx
    seat-gptoss.fbx
    seat-qwen.fbx
    seat-gemini.fbx
    seat-chairman.fbx

**Animations** — search these, and for each use **Download → FBX Binary, Skin: Without Skin**:

| Search for | Save as |
|---|---|
| `Sitting Idle` | `anim-idle.fbx` |
| `Seated Talking` (or `Talking`) | `anim-talking.fbx` |
| `Thinking` | `anim-thinking.fbx` |

Then set `HAS_MIXAMO_CLIPS = true` as well. Every Mixamo rig shares bone names, so
the three clips drive all five characters.

Without the clips the characters are posed seated in code instead, which still looks
right; it simply does not breathe.

## Converting to GLB

The loader tries `seat-<id>.glb` before `seat-<id>.fbx`, so converting first is worth it.
There is a converter in this repo that runs locally and needs nothing installed:

    python tools/fbx2glb.py web/public/models/mixamo

It opens a page that parses each FBX with three.js and writes a `.glb` beside it. No
file leaves your machine.

**Size warning, measured rather than assumed:** a 3.68 MB Mixamo FBX became a 9.95 MB
GLB. glTF embeds textures uncompressed, so converting made it 2.7x *larger*, not smaller.
Five characters is therefore closer to 50 MB than 20 MB. If that matters, run the GLB
through `gltf-transform optimize` (Draco + WebP) afterwards.

## Status: not working yet

Character loading is **intermittent and unresolved**, in both FBX and GLB form. The same
build renders the characters on one reload and falls back to the abstract forms on the
next, with the files fetched successfully either way.

What has been ruled out:

- The files. A 3.6 MB Mixamo FBX parses in 713ms with three and FBXLoader loaded from a
  CDN: 119 bones, clip intact, correct dimensions.
- glTF loading generally. The armchair in `models/chair/` loads through the same bundle
  every time without fail.
- Skeleton cloning. `SkeletonUtils.clone` is used, which is required for skinned meshes;
  without it five seats share one rig at the world origin.
- Queue stalls. Loads are serialised and each has a 20s timeout, so one bad file cannot
  block the rest.

What remains suspect is the interaction between the module-level load cache and React's
mount lifecycle. Until it is fixed, `AVATAR_MODE` stays `"abstract"`.
