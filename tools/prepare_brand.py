"""Turn the generated brand PNGs into assets the interface can actually use.

The images arrive as ~1240px white-on-black JPEG-ish PNGs, roughly 400 kB each. They are
displayed at 24-48px and need to be tinted to each seat's colour, so three things happen
here:

  * the black background becomes transparent, using luminance as the alpha channel, which
    keeps the anti-aliased edges instead of hard-keying them into a jagged mask
  * the artwork is trimmed to its own bounds and re-centred on a square, because several
    were generated slightly off-centre
  * everything is downscaled and re-encoded, taking the set from ~2.5 MB to a few tens of kB

Re-run any time the source art changes:

    python tools/prepare_brand.py
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "web" / "public" / "Brand"
OUT = ROOT / "web" / "public" / "brand"

# Whatever the files happen to be called, mapped to the seat ids in council/config.py.
# Matching is done on a normalised name so a stray capital or trailing space cannot break
# the build -- one of these really did arrive as "Nemotron .png".
MAPPING = {
    "applogo": "logo",
    "nemotron": "emblem-nemotron",
    "openai": "emblem-gptoss",
    "qwen": "emblem-qwen",
    "gemini": "emblem-gemini",
    "chairman": "emblem-chairman",
}

SIZE = 256
PADDING = 0.08  # fraction of the canvas left clear around the artwork


def normalise(name: str) -> str:
    return "".join(c for c in name.lower() if c.isalnum())


def prepare(src: Path, dest: Path) -> tuple[int, int]:
    image = Image.open(src).convert("L")  # luminance: white artwork, black ground

    # Trim to the artwork's own bounding box. Several were generated off-centre, and a
    # logo that is 6% left of centre reads as a mistake even when nobody can say why.
    bbox = image.point(lambda v: 255 if v > 24 else 0).getbbox()
    if bbox:
        image = image.crop(bbox)

    # Fit inside a square with even padding, preserving aspect ratio.
    inner = int(SIZE * (1 - PADDING * 2))
    image.thumbnail((inner, inner), Image.LANCZOS)

    canvas = Image.new("L", (SIZE, SIZE), 0)
    canvas.paste(image, ((SIZE - image.width) // 2, (SIZE - image.height) // 2))

    # White stays white; luminance becomes alpha. Soft edges survive, so the emblem can be
    # tinted to any seat colour without a halo.
    out = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
    out.putalpha(canvas)

    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG", optimize=True)
    return src.stat().st_size, dest.stat().st_size


def main() -> int:
    if not SOURCE.is_dir():
        print(f"No source art at {SOURCE}")
        return 1

    found = {normalise(p.stem): p for p in SOURCE.glob("*.png")}
    missing = [k for k in MAPPING if k not in found]
    if missing:
        print(f"Missing source art for: {', '.join(missing)}")

    total_before = total_after = 0
    for key, out_name in MAPPING.items():
        src = found.get(key)
        if src is None:
            continue
        before, after = prepare(src, OUT / f"{out_name}.png")
        total_before += before
        total_after += after
        print(f"  {src.name:20} -> {out_name}.png  {before // 1024:>5} kB -> {after // 1024:>3} kB")

    print(f"\ntotal {total_before // 1024} kB -> {total_after // 1024} kB")

    # The originals are kept, but out of the way: everything under web/public is copied
    # verbatim into the build, so leaving 2.5 MB of source art there ships it to users.
    archive = ROOT / "brand-source"
    if SOURCE.resolve() != OUT.resolve():
        archive.mkdir(exist_ok=True)
        for p in SOURCE.glob("*"):
            shutil.move(str(p), archive / p.name.strip())
        SOURCE.rmdir()
        print(f"originals moved to {archive.relative_to(ROOT)}/ so they are not shipped")

    return 0


if __name__ == "__main__":
    sys.exit(main())
