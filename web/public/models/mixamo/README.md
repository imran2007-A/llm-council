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

## Known problem: FBX in the bundle

Loading FBX through the app's bundle proved unreliable in testing -- the same build
would parse a file on one reload and silently produce nothing on the next. The same
file parses correctly in 713ms when three and FBXLoader are loaded straight from a CDN,
which points at how the loader's dependencies are bundled rather than at the file.

**If the characters do not appear, convert them to glTF instead.** Drop the `.glb`
files in `web/public/models/` as `seat-<id>.glb` and set `AVATAR_STYLE = "gltf"` in
`web/src/three/Avatar.tsx` -- that path is known to work, and is what the CC0
characters already use. Free converters:

- <https://products.aspose.app/3d/conversion/fbx-to-glb>
- Blender: File → Import → FBX, then File → Export → glTF 2.0

## Size

Mixamo characters are 3-8 MB each. Five of them plus clips is 20-40 MB, downloaded
when the scene first opens. Converting to `.glb` typically cuts that by more than half.
