"""hand_render.py — natural red-pen marks for the copy checker.

Drop-in drawing layer: every function takes a PIL RGBA image (the page) and
draws directly on it. Replace the current font-based text/tick calls in the
renderer with these.

Why the old output looked AI-generated:
  * text was a bold condensed print font, not handwriting
  * every glyph identical, perfectly horizontal baseline, uniform red
  * ticks were straight two-segment lines of constant width
  * the circled total was a clean ellipse

What this does instead (all seeded per copy, so one copy = one teacher):
  * handwriting font (Kalam by default - made for Indian hands - or Caveat)
  * per-glyph jitter: size, baseline, rotation, letter spacing
  * ink model: variable stroke width, slight pressure gaps, ballpoint red with
    small darkness variation, 2-3 px bleed
  * ticks/crosses/underlines/circle as wobbly Bezier strokes with pen lift
  * whole annotation slightly rotated (-3..+3 deg) like a hand that isn't square
    to the page
"""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_DIR = Path(__file__).parent / "fonts"   # bundled with the copy checker
DEFAULT_FONT = "Kalam.ttf"      # bundled; Caveat is an alternative if added to fonts/

INK = (214, 28, 40)                      # red ballpoint


class Pen:
    """One teacher, one pen. Create once per copy with a fixed seed."""

    def __init__(self, seed: int, font: str = DEFAULT_FONT, slant_deg: float | None = None):
        self.rng = random.Random(seed)
        self.font_path = str(FONT_DIR / font)
        self.slant = slant_deg if slant_deg is not None else self.rng.uniform(-3.0, 2.0)
        self.darkness = self.rng.uniform(0.85, 1.0)     # this pen's ink strength

    # ------------------------------------------------------------ ink helpers
    def _colour(self, alpha: float = 1.0) -> tuple[int, int, int, int]:
        d = self.darkness * self.rng.uniform(0.9, 1.0)
        r, g, b = INK
        return (int(r * (0.92 + 0.08 * d)), int(g * d), int(b * d), int(255 * alpha))

    def _stroke(self, layer: Image.Image, pts: list[tuple[float, float]], width: float) -> None:
        """Polyline with width that swells and thins along the stroke."""
        draw = ImageDraw.Draw(layer)
        n = len(pts)
        for i in range(n - 1):
            t = i / max(1, n - 2)
            w = width * (0.75 + 0.5 * math.sin(math.pi * t) + self.rng.uniform(-0.12, 0.12))
            if self.rng.random() < 0.006:         # rare pressure skip
                continue
            draw.line([pts[i], pts[i + 1]], fill=self._colour(), width=max(1, int(round(w))))
            draw.ellipse([pts[i][0] - w / 2, pts[i][1] - w / 2, pts[i][0] + w / 2, pts[i][1] + w / 2],
                         fill=self._colour())

    @staticmethod
    def _bezier(p0, p1, p2, p3, n=28):
        out = []
        for i in range(n + 1):
            t = i / n
            x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
            y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
            out.append((x, y))
        return out

    def _wobble(self, pts, amp):
        return [(x + self.rng.uniform(-amp, amp), y + self.rng.uniform(-amp, amp)) for x, y in pts]

    def _blit(self, page: Image.Image, layer: Image.Image, rotate_deg: float, at: tuple[int, int]) -> None:
        layer = layer.filter(ImageFilter.GaussianBlur(0.55))         # ink bleed
        if abs(rotate_deg) > 0.05:
            layer = layer.rotate(rotate_deg, resample=Image.BICUBIC, expand=True)
        page.alpha_composite(layer, dest=(int(at[0]), int(at[1])))

    # ------------------------------------------------------------- handwriting
    def text(self, page: Image.Image, xy: tuple[float, float], s: str, size: int) -> tuple[int, int]:
        """Write `s` with its baseline-left at xy. Returns (width, height) drawn."""
        base = ImageFont.truetype(self.font_path, size)
        pad = size
        # measure roughly
        est_w = int(base.getlength(s) * 1.15) + 2 * pad
        est_h = int(size * 1.6) + 2 * pad
        layer = Image.new("RGBA", (est_w, est_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        x = float(pad)
        y0 = float(pad + size * 0.2)
        drift = 0.0
        for ch in s:
            if ch == " ":
                x += base.getlength(" ") * self.rng.uniform(0.8, 1.3)
                continue
            gs = int(size * self.rng.uniform(0.94, 1.06))
            f = ImageFont.truetype(self.font_path, gs)
            drift += self.rng.uniform(-0.6, 0.6)
            drift = max(-size * 0.08, min(size * 0.08, drift))
            gy = y0 + drift + self.rng.uniform(-size * 0.03, size * 0.03)
            rot = self.rng.uniform(-4, 4)
            gw = int(f.getlength(ch)) + gs
            g = Image.new("RGBA", (gw + gs, gs * 2), (0, 0, 0, 0))
            gd = ImageDraw.Draw(g)
            col = self._colour(self.rng.uniform(0.86, 1.0))
            # two slightly offset passes = ballpoint stroke weight without a bold font
            gd.text((gs // 2, gs // 4), ch, font=f, fill=col)
            gd.text((gs // 2 + self.rng.uniform(0.3, 0.9), gs // 4 + self.rng.uniform(0.2, 0.7)), ch, font=f, fill=col)
            g = g.rotate(rot, resample=Image.BICUBIC)
            layer.alpha_composite(g, dest=(int(x - gs // 2), int(gy - gs // 4)))
            x += f.getlength(ch) * self.rng.uniform(0.96, 1.04) + self.rng.uniform(-0.5, 1.0)
        self._blit(page, layer, self.slant + self.rng.uniform(-1.0, 1.0), (xy[0] - pad, xy[1] - pad - size * 0.2))
        return int(x - pad), int(size * 1.2)

    # -------------------------------------------------------------- pen marks
    def tick(self, page: Image.Image, xy: tuple[float, float], h: float) -> None:
        """Tick with its bottom vertex near xy. h = tick height (~1.5x line height)."""
        pad = int(h)
        layer = Image.new("RGBA", (int(h * 2) + 2 * pad, int(h * 1.6) + 2 * pad), (0, 0, 0, 0))
        ox, oy = pad, pad + h * 1.2
        r = self.rng.uniform
        # short down-stroke, then long up-stroke that overshoots
        p0 = (ox + r(0, h * 0.1), oy - h * r(0.35, 0.5))
        p1 = (ox + h * r(0.15, 0.25), oy - h * r(0.05, 0.15))
        p2 = (ox + h * r(0.3, 0.4), oy + h * r(-0.02, 0.05))
        p3 = (ox + h * r(0.36, 0.44), oy)
        q1 = (ox + h * r(0.55, 0.7), oy - h * r(0.35, 0.5))
        q2 = (ox + h * r(0.9, 1.1), oy - h * r(0.8, 1.0))
        q3 = (ox + h * r(1.1, 1.35), oy - h * r(1.05, 1.25))
        pts = self._wobble(self._bezier(p0, p1, p2, p3, 12) + self._bezier(p3, q1, q2, q3, 26), h * 0.012)
        self._stroke(layer, pts, h * 0.075)
        self._blit(page, layer, r(-6, 6), (xy[0] - pad - h * 0.4, xy[1] - oy))

    def cross(self, page: Image.Image, xy: tuple[float, float], h: float) -> None:
        """Cross centred at xy, two separate strokes."""
        pad = int(h)
        layer = Image.new("RGBA", (int(h) + 2 * pad, int(h) + 2 * pad), (0, 0, 0, 0))
        r = self.rng.uniform
        c = (pad + h / 2, pad + h / 2)
        for ang in (r(35, 55), r(125, 145)):
            a = math.radians(ang)
            d = h * r(0.42, 0.55)
            p0 = (c[0] - d * math.cos(a), c[1] - d * math.sin(a))
            p3 = (c[0] + d * math.cos(a), c[1] + d * math.sin(a))
            p1 = (p0[0] * 0.66 + p3[0] * 0.34 + r(-h * 0.06, h * 0.06), p0[1] * 0.66 + p3[1] * 0.34 + r(-h * 0.06, h * 0.06))
            p2 = (p0[0] * 0.34 + p3[0] * 0.66 + r(-h * 0.06, h * 0.06), p0[1] * 0.34 + p3[1] * 0.66 + r(-h * 0.06, h * 0.06))
            self._stroke(layer, self._wobble(self._bezier(p0, p1, p2, p3, 18), h * 0.01), h * 0.09)
        self._blit(page, layer, r(-5, 5), (xy[0] - c[0], xy[1] - c[1]))

    def underline(self, page: Image.Image, x0: float, x1: float, y: float, lh: float) -> None:
        pad = int(lh)
        layer = Image.new("RGBA", (int(x1 - x0) + 2 * pad, 2 * pad), (0, 0, 0, 0))
        r = self.rng.uniform
        p0 = (pad, pad + r(-lh * 0.05, lh * 0.05))
        p3 = (pad + (x1 - x0) + r(-lh * 0.1, lh * 0.15), pad + r(-lh * 0.05, lh * 0.08))
        p1 = (pad + (x1 - x0) * 0.3, pad + r(-lh * 0.12, lh * 0.12))
        p2 = (pad + (x1 - x0) * 0.7, pad + r(-lh * 0.12, lh * 0.12))
        self._stroke(layer, self._wobble(self._bezier(p0, p1, p2, p3, 30), lh * 0.008), lh * 0.09)
        self._blit(page, layer, 0, (x0 - pad, y - pad))

    def strike(self, page: Image.Image, x0: float, x1: float, y: float, lh: float) -> None:
        """Strike-through a word: same as underline but through the x-height."""
        self.underline(page, x0, x1, y - lh * 0.35, lh)

    def circled_total(self, page: Image.Image, xy: tuple[float, float], s: str, size: int) -> None:
        """Big obtained/total with a hand-drawn loop around it. xy = text baseline-left."""
        w, h = self.text(page, xy, s, size)
        cx, cy = xy[0] + w / 2, xy[1] + h * 0.35
        rx, ry = w * 0.72 + size * 0.25, h * 0.95
        pad = int(size)
        layer = Image.new("RGBA", (int(rx * 2) + 2 * pad, int(ry * 2) + 2 * pad), (0, 0, 0, 0))
        c = (pad + rx, pad + ry)
        r = self.rng.uniform
        start = r(0.6, 1.4)                           # starts lower-right like a real loop
        pts = []
        n = 70
        for i in range(n + 1):
            t = start + 2 * math.pi * 1.06 * i / n     # 6% overlap at the end
            wob = 1 + 0.04 * math.sin(3 * t + start) + r(-0.015, 0.015)
            pts.append((c[0] + rx * wob * math.cos(t), c[1] + ry * wob * math.sin(t)))
        self._stroke(layer, pts, size * 0.075)
        self._blit(page, layer, r(-4, 4), (cx - c[0], cy - c[1]))


# ---------------------------------------------------------------- self-test
if __name__ == "__main__":
    # Fake ruled page to preview the marks.
    W, H, LH = 1400, 960, 48
    page = Image.new("RGBA", (W, H), (250, 247, 240, 255))
    d = ImageDraw.Draw(page)
    for y in range(120, H, LH):
        d.line([(0, y), (W, y)], fill=(170, 190, 215, 255), width=2)
    d.line([(150, 0), (150, H)], fill=(220, 120, 150, 255), width=3)
    pen = Pen(seed=42)
    pen.circled_total(page, (760, 40), "30/36", int(LH * 2.3))
    y = 120
    for i, (label, kind) in enumerate([("1/1", "tick"), ("0/1", "cross"), ("2/3", "tick"), ("0.5/1", "tick"), ("4/5", "tick")]):
        yy = y + i * LH * 3
        d.text((170, yy + 10), f"Ans. sample student line {i+1}", fill=(40, 40, 140, 255))
        if kind == "tick":
            pen.tick(page, (860, yy + LH * 0.95), LH * 1.5)
        else:
            pen.cross(page, (860, yy + LH * 0.5), LH * 1.4)
        pen.text(page, (1180, yy + LH * 0.95), label, int(LH * 1.4))
    pen.text(page, (170, 120 + LH * 1.95), "Well explained.", int(LH * 1.1))
    pen.text(page, (170, 264 + LH * 1.95), "Wrong option. Correct: (c)", int(LH * 1.1))
    pen.text(page, (170, 408 + LH * 1.95), "Nature of image not stated: real, inverted.", int(LH * 1.1))
    pen.underline(page, 200, 330, 552 + LH * 0.85, LH)
    pen.text(page, (170, 552 + LH * 1.95), "Reasoning not given.", int(LH * 1.1))
    page.convert("RGB").save("preview.png")
    print("wrote preview.png")
