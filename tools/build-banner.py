"""Builds the README banner and small bear icons from assets/avatar/*.png.

Run: python tools/build-banner.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "readme"
OUT.mkdir(parents=True, exist_ok=True)

BG = (8, 11, 16)
SURFACE = (17, 22, 31)
TEXT = (248, 250, 252)
MUTED = (148, 163, 184)
GREEN = (16, 185, 129)
BLUE = (56, 189, 248)
PURPLE = (168, 85, 247)

FONTS = Path("C:/Windows/Fonts")


def font(names, size):
    for name in names:
        path = FONTS / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def bear(name: str, size: int) -> Image.Image:
    im = Image.open(ROOT / "assets" / "avatar" / name).convert("RGBA")
    box = im.getbbox()
    if box:
        im = im.crop(box)
    im.thumbnail((size, size), Image.Resampling.NEAREST)
    return im


def banner() -> None:
    w, h = 1280, 420
    img = Image.new("RGB", (w, h), BG)

    # soft color glows behind the three bears, then a faint grid
    glow = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(glow)
    for cx, color in ((860, GREEN), (1010, BLUE), (1160, PURPLE)):
        d.ellipse((cx - 150, 60, cx + 150, 360), fill=tuple(int(c * 0.32) for c in color))
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    img = Image.blend(img, glow, 0.9)
    d = ImageDraw.Draw(img)
    for x in range(0, w, 40):
        d.line([(x, 0), (x, h)], fill=(14, 19, 27))
    for y in range(0, h, 40):
        d.line([(0, y), (w, y)], fill=(14, 19, 27))

    bold = ["segoeuib.ttf", "arialbd.ttf"]
    regular = ["segoeui.ttf", "arial.ttf"]
    mono = ["CascadiaMono.ttf", "consola.ttf", "cour.ttf"]

    d.text((72, 78), "BIG BEAR", font=font(bold, 92), fill=TEXT)
    d.text((72 + 425, 78 + 22), "DEV", font=font(regular, 64), fill=MUTED)
    d.text((72, 190), "ORCHESTRATOR", font=font(bold, 34), fill=GREEN)
    d.text((72, 246), "Code Smarter. Build Faster. Spend Less.", font=font(regular, 30), fill=TEXT)
    d.text((72, 296), "A Claude Code mod: model routing, task tracking,", font=font(regular, 22), fill=MUTED)
    d.text((72, 326), "token intelligence and usage limits, in one pane.", font=font(regular, 22), fill=MUTED)

    # tier pills
    px = 72
    for label, color in (("HAIKU", GREEN), ("SONNET", BLUE), ("OPUS", PURPLE)):
        f = font(bold, 18)
        tw = d.textlength(label, font=f)
        d.rounded_rectangle((px, 372, px + tw + 28, 402), radius=15, fill=color)
        d.text((px + 14, 376), label, font=f, fill=BG)
        px += tw + 28 + 10

    for cx, name in ((840, "idle.png"), (1010, "research.png"), (1180, "work.png")):
        im = bear(name, 200)
        img.paste(im, (cx - im.width // 2, 200 - im.height // 2 + 30), im)

    img.save(OUT / "banner.png", optimize=True)

    for name in ("idle", "research", "work"):
        im = bear(f"{name}.png", 240)
        im.save(OUT / f"bear-{name}.png", optimize=True)


if __name__ == "__main__":
    banner()
    for p in sorted(OUT.iterdir()):
        print(p.name, p.stat().st_size // 1024, "KB")
