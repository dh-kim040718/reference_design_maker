"""Render the geometric R in public/brand.svg without system-font dependencies."""
from pathlib import Path

from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parents[1] / "frontend" / "public"


def render(size, *, maskable=False):
    scale = size * 4 / 40
    image = Image.new("RGBA", (size * 4, size * 4), "#252528" if maskable else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if not maskable:
        draw.rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=8 * scale, fill="#252528")
    points = []
    # Match the cubic curves and straight segments of brand.svg exactly.
    def line(x, y):
        points.append((x, y))
    def curve(x1, y1, x2, y2, x3, y3):
        x0, y0 = points[-1]
        for step in range(1, 33):
            t = step / 32
            u = 1 - t
            points.append((u**3*x0+3*u*u*t*x1+3*u*t*t*x2+t**3*x3,
                           u**3*y0+3*u*u*t*y1+3*u*t*t*y2+t**3*y3))
    line(12, 9); line(21, 9)
    curve(27, 9, 30, 12, 30, 17)
    curve(30, 21, 28, 23, 25, 24)
    for point in [(31, 32), (24, 32), (19, 25), (18, 25), (18, 32), (12, 32)]:
        line(*point)
    def polygon(color):
        factor = .8 if maskable else 1
        draw.polygon([(((x-20)*factor+20)*scale, ((y-20)*factor+20)*scale) for x, y in points], fill=color)
    polygon("white")
    points.clear()
    line(18, 14); line(18, 20); line(21, 20)
    curve(23, 20, 24, 19, 24, 17)
    curve(24, 15, 23, 14, 21, 14)
    polygon("#252528")
    return image.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    extension_icons = PUBLIC.parents[1] / "browser-extension" / "icons"
    extension_icons.mkdir(parents=True, exist_ok=True)
    for dimension in (16, 32, 48, 128):
        render(dimension).save(extension_icons / f"icon-{dimension}.png")
    for dimension in (192, 512):
        render(dimension).save(PUBLIC / f"icon-{dimension}.png")
    render(512, maskable=True).save(PUBLIC / "icon-maskable-512.png")
    print("Generated 192px, 512px and maskable app icons.")
