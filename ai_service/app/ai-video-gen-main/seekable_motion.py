"""Keep a shot's motion inside what the frame-stepped renderer can actually see.

The renderer does not play a shot. It seeks `gsap.globalTimeline` to a timestamp
and screenshots. Motion driven by wall-clock time is therefore invisible to it:
the frame looks correct in a browser and renders frozen, with no error anywhere.

Measured on a shipped 31-shot film, 13 shots lost their animation this way:

    9  registered their tweens inside a DOMContentLoaded / load handler
    2  used SVG SMIL (<animate>)
    1  used CSS `animation:`
    1  used setTimeout

The load-handler case dominates and is the least obvious: a shot is injected into
a shadow root AFTER document load has already fired, so the handler never runs —
nothing animates, and elements stay at whatever initial state they were given
(usually opacity:0, so they simply never appear).

That one is repairable without regenerating: re-dispatch the events after the
shot is injected and the handlers run, registering their tweens on the global
timeline in time to be seeked. The others cannot be repaired mechanically — a
CSS keyframe animation has no GSAP equivalent to rewrite it into — so they are
reported for regeneration instead.
"""

from __future__ import annotations

import re
from typing import Dict, List

__all__ = [
    "READY_KICK",
    "unseekable_techniques",
    "needs_ready_kick",
    "apply_ready_kick",
    "is_fully_seekable",
    "dash_bomb_targets",
    "defuse_dash_bombs",
]

# Appended to a shot whose tweens are registered in a load handler. Runs at
# inject time, so the handler fires and its tweens land on the global timeline.
READY_KICK = (
    '<script id="vx-ready-kick">'
    "/* The shot is injected into a shadow root AFTER document load has fired, so"
    "   tweens registered in a DOMContentLoaded/load handler are never created and"
    "   the frame renders frozen. Re-dispatch both so those handlers run now. */"
    'try{document.dispatchEvent(new Event("DOMContentLoaded"));'
    'window.dispatchEvent(new Event("load"));}catch(e){}'
    "</script>"
)

_LOAD_HANDLER = re.compile(
    r"""DOMContentLoaded|window\.onload|addEventListener\(\s*['"]load['"]""",
)

# Each pattern is matched against the shot BODY only — the shared preamble
# legitimately contains CSS animations for its own helper classes, and flagging
# those would report every shot as broken.
_PATTERNS: Dict[str, re.Pattern] = {
    "css-animation": re.compile(r"animation\s*:"),
    "css-keyframes": re.compile(r"@keyframes"),
    "svg-smil": re.compile(r"<animate(?:Transform|Motion)?[\s>]"),
    "timer": re.compile(r"\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\("),
}


_STYLE_RUN = re.compile(r"\s*(?:<!--.*?-->\s*)*<style\b[^>]*>.*?</style>", re.S)


def _body(html: str) -> str:
    """The shot's own markup, with the shared preamble stripped.

    The preamble is the CONTIGUOUS run of <style> blocks (and comments) at the
    top of the document — not "everything up to the last </style>", which was
    the first attempt and silently swallowed a shot's own inline <style>, hiding
    exactly the @keyframes this module exists to catch.
    """
    i = 0
    marker = html.find("<!--vx-preamble-->")
    if marker != -1:
        i = marker + len("<!--vx-preamble-->")
    while True:
        m = _STYLE_RUN.match(html, i)
        if not m:
            break
        i = m.end()
    return html[i:]


def unseekable_techniques(html: str) -> List[str]:
    """Motion in this shot the renderer cannot seek and will drop.

    A load handler is deliberately NOT reported once the ready-kick is present:
    that combination is seekable, and reporting it would send a repaired shot
    into a pointless regeneration.
    """
    if not html:
        return []
    body = _body(html)
    found = [name for name, pat in _PATTERNS.items() if pat.search(body)]
    if _LOAD_HANDLER.search(html) and "vx-ready-kick" not in html:
        found.append("load-handler")
    return sorted(found)


def needs_ready_kick(html: str) -> bool:
    return bool(html) and bool(_LOAD_HANDLER.search(html)) and "vx-ready-kick" not in html


_BODY_CLOSE = re.compile(r"</body>", re.I)


def apply_ready_kick(html: str) -> str:
    """Repair the load-handler case. Idempotent; leaves anything else alone.

    The kick must land INSIDE <body> when the shot is a full document: the
    render harness keeps only the body's inner HTML of such a shot, so a kick
    appended after </html> is discarded and the shot renders frozen exactly as
    it did before the "repair". Measured on a shipped 31-shot film, 8 kicked
    frames were silently dropped this way and the closing shot rendered blank.
    """
    if not needs_ready_kick(html):
        return html
    m = _BODY_CLOSE.search(html)
    if m:
        return html[: m.start()] + READY_KICK + html[m.start() :]
    return html + READY_KICK


def is_fully_seekable(html: str) -> bool:
    return not unseekable_techniques(apply_ready_kick(html))


# ---------------------------------------------------------------------------
# Dash-array bombs
#
# `gsap.from(el, {strokeDasharray: 2000, ...})` animates TOWARD the element's
# natural value. For a path that declares no stroke-dasharray that value is 0,
# so the dash array sweeps 2000 → 0 and, near the end, the browser is asked to
# draw an unbounded number of dashes along the path. The rasteriser stops
# responding and the renderer's screenshot call times out, which fails the whole
# job — not just the shot.
#
# It is intermittent in the worst way: the frame stepper samples every 1/30s, so
# whether a sample lands inside the pathological window depends on the shot's
# start time. A film rendered fine for weeks, then a 0.28s shift upstream moved a
# sample into the window and every render died at that frame.
#
# The repair keeps the dash array constant and animates only the offset, which is
# the standard line-draw and looks identical.
# ---------------------------------------------------------------------------

_DASH_TWEEN = re.compile(
    r"\.from\(\s*'(#[\w-]+)'\s*,\s*\{([^{}]*?strokeDasharray\s*:\s*([\d.]+)[^{}]*?)\}\s*,\s*([\d.]+)\s*\)"
)
_TWEEN_CONFIG_KEYS = ("duration", "ease", "delay", "repeat", "yoyo", "stagger")


def _declares_dasharray(html: str, element_id: str) -> bool:
    # Either quote style: LLM output is not consistent about it, and guessing wrong
    # means either rewriting a correct animation or leaving a bomb armed.
    tag = re.search(r"""<[^>]*\bid\s*=\s*["']%s["'][^>]*>""" % re.escape(element_id), html)
    return bool(tag and "stroke-dasharray" in tag.group(0))


def _split_tween_vars(vars_text: str):
    """(strokeDashoffset value, [config fragments]) from a tween object body."""
    offset = None
    config: List[str] = []
    for part in (p.strip() for p in re.split(r",(?![^()]*\))", vars_text) if p.strip()):
        key = part.split(":", 1)[0].strip().strip("\"'")
        if key == "strokeDashoffset":
            offset = part.split(":", 1)[1].strip()
        elif key in _TWEEN_CONFIG_KEYS:
            config.append(part)
    return offset, config


def dash_bomb_targets(html: str) -> List[str]:
    """Element ids whose dash array is animated toward zero."""
    if not html:
        return []
    return [
        m.group(1)
        for m in _DASH_TWEEN.finditer(html)
        if not _declares_dasharray(html, m.group(1)[1:])
    ]


def defuse_dash_bombs(html: str) -> str:
    """Hold the dash array constant and animate only the offset. Idempotent."""
    if not html:
        return html
    out: List[str] = []
    last = 0
    changed = False
    for m in _DASH_TWEEN.finditer(html):
        selector, vars_text, dash, position = m.group(1), m.group(2), m.group(3), m.group(4)
        if _declares_dasharray(html, selector[1:]):
            continue
        offset, config = _split_tween_vars(vars_text)
        if offset is None:
            offset = dash
        tail = (", " + ", ".join(config)) if config else ""
        out.append(html[last:m.start()])
        out.append(
            ".fromTo('%s', {strokeDasharray:%s, strokeDashoffset:%s}, "
            "{strokeDasharray:%s, strokeDashoffset:0%s}, %s)"
            % (selector, dash, offset, dash, tail, position)
        )
        last = m.end()
        changed = True
    if not changed:
        return html
    out.append(html[last:])
    return "".join(out)
