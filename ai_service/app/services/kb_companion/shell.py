"""The visual side of a companion lesson card: sanitize the model's HTML
fragment, put the knowledge base's real figures in, and wrap it in the shell
document the learner app renders in a sandboxed iframe.

Pure functions only (no DB, no network) so every guardrail here is unit-tested.

Why fragments + a shell instead of whole pages
----------------------------------------------
The model writes only the creative inner part of a card using a small component
kit (``vk-*`` classes). The shell owns the typography, colour, spacing, the
flip-card mechanics and the Content-Security-Policy. So:

* every card looks like it belongs to the same lesson, whatever the model did;
* the institute's accent colour is applied at SERVE time, so re-theming never
  needs a recompile;
* the flip card is correct by construction (the HTML-document generator shipped
  collapsed flip cards when the model wrote the layout itself);
* the model never sees an image URL, so it cannot invent one.
"""
from __future__ import annotations

import html as html_lib
import re
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

# ── figure tags ──────────────────────────────────────────────────────────────

# The model is shown figures as [F1], [F2]… and writes <img data-kb-fig="F2">.
_FIG_IMG_RE = re.compile(
    r"<img\b[^>]*?\bdata-kb-fig\s*=\s*[\"']?\s*(F\d{1,3})\s*[\"']?[^>]*>",
    re.IGNORECASE,
)
_ANY_IMG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_SRC_RE = re.compile(r"\bsrc\s*=\s*([\"'])(.*?)\1", re.IGNORECASE | re.DOTALL)

# Tags that have no business in a lesson card. Removed with their content where
# they have content; <script src> goes too (inline scripts may stay: the frame is
# sandboxed without allow-same-origin and the CSP blocks every network fetch).
_BLOCK_TAGS = ("iframe", "object", "embed", "form", "frame", "frameset", "applet", "audio", "video", "noscript")
_VOID_TAGS = ("link", "meta", "base", "input", "source", "track")
_FENCE_RE = re.compile(r"^\s*```(?:html|HTML)?\s*\n?([\s\S]*?)\n?```\s*$")
_BODY_RE = re.compile(r"<body\b[^>]*>([\s\S]*?)</body>", re.IGNORECASE)
_EXTERNAL_SCRIPT_RE = re.compile(r"<script\b[^>]*\bsrc\s*=[^>]*>[\s\S]*?</script\s*>", re.IGNORECASE)
_EVENT_URL_RE = re.compile(r"\b(href|src|action|formaction|xlink:href)\s*=\s*([\"'])\s*javascript:[^\"']*\2", re.IGNORECASE)
_CSS_URL_RE = re.compile(r"url\(\s*([\"']?)(https?:)?//[^)]*\)", re.IGNORECASE)
_IMPORT_RE = re.compile(r"@import[^;]*;", re.IGNORECASE)
_HEAD_BITS_RE = re.compile(r"</?(?:html|head|body)\b[^>]*>|<!doctype[^>]*>|<title\b[^>]*>[\s\S]*?</title\s*>", re.IGNORECASE)

MAX_FRAGMENT_CHARS = 60_000


def figure_label(index: int) -> str:
    """Opaque tag for the index-th figure offered to the model (0-based)."""
    return f"F{index + 1}"


def strip_fence(text: str) -> str:
    m = _FENCE_RE.match(text or "")
    return m.group(1) if m else (text or "")


def _figure_markup(fig: Dict, citation_page: Optional[int]) -> str:
    src = html_lib.escape(fig.get("image_url") or "", quote=True)
    caption = (fig.get("caption") or "").strip()
    alt = html_lib.escape((fig.get("alt_text") or caption or "Figure from your book")[:300], quote=True)
    page = fig.get("page_number") or citation_page
    cap_bits = []
    if caption:
        cap_bits.append(html_lib.escape(caption[:300]))
    if page:
        cap_bits.append(f'<span class="vk-cite">p. {int(page)}</span>')
    figcaption = f"<figcaption>{' '.join(cap_bits)}</figcaption>" if cap_bits else ""
    return f'<figure class="vk-figure"><img src="{src}" alt="{alt}" loading="lazy">{figcaption}</figure>'


def sanitize_fragment(
    raw: str,
    figures: Dict[str, Dict],
    *,
    citation_page: Optional[int] = None,
) -> Tuple[str, List[str]]:
    """Clean one model-written card fragment.

    `figures` maps the opaque labels offered to the model ("F1"…) to KB figure
    rows ({image_url, caption, alt_text, page_number}). Returns (html, used
    labels). Every <img> that is not one of those figures is removed — the model
    has no way to know a real URL, so any other src is invented.
    """
    text = strip_fence(raw or "").strip()
    body = _BODY_RE.search(text)
    if body:
        # Keep <style> blocks from the head: models often put the card's CSS there.
        styles = "".join(re.findall(r"<style\b[^>]*>[\s\S]*?</style\s*>", text[: body.start()], re.IGNORECASE))
        text = styles + body.group(1)
    text = _HEAD_BITS_RE.sub("", text)
    text = _EXTERNAL_SCRIPT_RE.sub("", text)
    for tag in _BLOCK_TAGS:
        text = re.sub(rf"<{tag}\b[^>]*>[\s\S]*?</{tag}\s*>", "", text, flags=re.IGNORECASE)
        text = re.sub(rf"<{tag}\b[^>]*/?>", "", text, flags=re.IGNORECASE)
    for tag in _VOID_TAGS:
        text = re.sub(rf"<{tag}\b[^>]*/?>", "", text, flags=re.IGNORECASE)
    text = _EVENT_URL_RE.sub("", text)
    text = _IMPORT_RE.sub("", text)
    text = _CSS_URL_RE.sub("none", text)

    used: List[str] = []

    def _fig(m: re.Match) -> str:
        label = m.group(1).upper()
        fig = figures.get(label)
        if not fig or not fig.get("image_url"):
            return ""
        if label in used:
            # One figure, one appearance: a repeated image reads as a glitch.
            return ""
        used.append(label)
        return _figure_markup(fig, citation_page)

    text = _FIG_IMG_RE.sub(_fig, text)

    allowed_srcs = {f.get("image_url") for f in figures.values() if f.get("image_url")}

    def _other_img(m: re.Match) -> str:
        tag = m.group(0)
        src = _SRC_RE.search(tag)
        value = (src.group(2).strip() if src else "")
        if value in allowed_srcs or value.startswith("data:image/"):
            return tag
        return ""

    text = _ANY_IMG_RE.sub(_other_img, text)
    return text[:MAX_FRAGMENT_CHARS].strip(), used


def fallback_fragment(title: str, brief: str, figure: Optional[Dict] = None, citation_page: Optional[int] = None) -> str:
    """A plain but decent card when the render call failed twice: the lesson
    must never show a hole."""
    fig = _figure_markup(figure, citation_page) if figure and figure.get("image_url") else ""
    points = [p.strip(" -•\t") for p in re.split(r"(?<=[.!?])\s+|\n+", brief or "") if p.strip(" -•\t")]
    items = "".join(f"<li>{html_lib.escape(p)}</li>" for p in points[:6])
    return (
        f'<div class="vk-card"><h2 class="vk-title">{html_lib.escape(title or "")}</h2>'
        f'{fig}<ul class="vk-points">{items}</ul></div>'
    )


# ── the shell ────────────────────────────────────────────────────────────────

_DEFAULT_ACCENT = "#4f46e5"
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist"
_MATH_HINT_RE = re.compile(r"\$[^$\n]+\$|\\\(|\\\[")


def safe_accent(color: Optional[str]) -> str:
    return color if color and _HEX_RE.match(color) else _DEFAULT_ACCENT


def image_origins(urls: Iterable[str]) -> List[str]:
    out: List[str] = []
    for u in urls:
        try:
            p = urlparse(u)
        except ValueError:
            continue
        if p.scheme == "https" and p.netloc:
            origin = f"https://{p.netloc}"
            if origin not in out:
                out.append(origin)
    return out


def _csp(img_origins: Sequence[str]) -> str:
    imgs = " ".join(["data:", "blob:", *img_origins])
    return (
        "default-src 'none'; "
        f"img-src {imgs}; "
        "style-src 'unsafe-inline' https://cdn.jsdelivr.net; "
        "font-src data: https://cdn.jsdelivr.net; "
        "script-src 'unsafe-inline' https://cdn.jsdelivr.net; "
        "connect-src 'none'; form-action 'none'; media-src 'none'; frame-src 'none'"
    )


SHELL_CSS = """
:root{--vk-accent:%(accent)s;--vk-ink:#1f2937;--vk-muted:#6b7280;--vk-line:#e5e7eb;--vk-soft:color-mix(in srgb,var(--vk-accent) 9%%,#fff);--vk-soft2:color-mix(in srgb,var(--vk-accent) 16%%,#fff);--vk-r:16px}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent}
body{font:16px/1.6 "Inter","Segoe UI",system-ui,-apple-system,"Noto Sans","Noto Sans Devanagari","Noto Sans Kannada","Tunga",sans-serif;color:var(--vk-ink);padding:4px 2px 12px;overflow-wrap:break-word}
h1,h2,h3{line-height:1.25;margin:.2em 0 .5em;color:#111827}
h1{font-size:1.6rem}h2{font-size:1.3rem}h3{font-size:1.08rem}
p{margin:.45em 0}
img,svg{max-width:100%%;height:auto}
.vk-card{display:block}
.vk-title{font-size:1.35rem;font-weight:700}
.vk-hero{border-radius:var(--vk-r);padding:22px 20px;background:linear-gradient(135deg,var(--vk-soft2),#fff 70%%);border:1px solid var(--vk-line)}
.vk-hero .vk-emoji{font-size:2.4rem;line-height:1}
.vk-lead{font-size:1.08rem;color:#374151}
.vk-callout{border-radius:12px;padding:12px 14px;margin:12px 0;background:var(--vk-soft);border-left:4px solid var(--vk-accent)}
.vk-callout.tip{background:#ecfdf5;border-color:#10b981}
.vk-callout.warn{background:#fff7ed;border-color:#f97316}
.vk-callout.key{background:#eef2ff;border-color:#6366f1}
.vk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:12px 0}
.vk-tile{border:1px solid var(--vk-line);border-radius:14px;padding:14px;background:#fff}
.vk-tile .vk-icon{font-size:1.7rem;display:block;margin-bottom:6px}
.vk-tile h3{margin:.1em 0 .3em;font-size:1rem}
.vk-chip{display:inline-block;padding:3px 10px;margin:3px 4px 3px 0;border-radius:999px;background:var(--vk-soft2);color:#111827;font-size:.85rem;font-weight:600}
.vk-table{width:100%%;border-collapse:separate;border-spacing:0;margin:12px 0;border:1px solid var(--vk-line);border-radius:12px;overflow:hidden;font-size:.95rem}
.vk-table th{background:var(--vk-soft2);text-align:left;font-weight:700}
.vk-table th,.vk-table td{padding:9px 12px;border-bottom:1px solid var(--vk-line);vertical-align:top}
.vk-table tr:last-child td{border-bottom:0}
.vk-table tr:nth-child(even) td{background:#fafafa}
.vk-steps{list-style:none;counter-reset:vk;padding:0;margin:12px 0}
.vk-steps>li{counter-increment:vk;position:relative;padding:10px 12px 10px 52px;margin:8px 0;border:1px solid var(--vk-line);border-radius:12px;background:#fff}
.vk-steps>li::before{content:counter(vk);position:absolute;left:12px;top:10px;width:28px;height:28px;border-radius:50%%;background:var(--vk-accent);color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:.9rem}
.vk-compare{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:12px 0}
.vk-compare>*{border-radius:14px;padding:14px;border:1px solid var(--vk-line);background:#fff}
.vk-compare>*:first-child{border-top:4px solid var(--vk-accent)}
.vk-compare>*:nth-child(2){border-top:4px solid #f59e0b}
.vk-figure{margin:12px 0;text-align:center}
.vk-figure img{border-radius:12px;border:1px solid var(--vk-line);background:#fff;max-height:420px;object-fit:contain}
.vk-figure figcaption{font-size:.85rem;color:var(--vk-muted);margin-top:6px}
.vk-cite{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;background:#f3f4f6;color:var(--vk-muted);font-size:.75rem}
.vk-formula{font-size:1.15rem;text-align:center;padding:14px;border-radius:12px;background:#f9fafb;border:1px dashed var(--vk-line);margin:12px 0}
.vk-example{border-radius:14px;padding:14px;margin:12px 0;border:1px solid var(--vk-line);background:linear-gradient(180deg,#fffbeb,#fff)}
.vk-example>strong:first-child{display:block;color:#b45309;margin-bottom:4px}
.vk-big{font-size:2.2rem;font-weight:800;color:var(--vk-accent);line-height:1.1}
.vk-timeline{list-style:none;margin:12px 0;padding:0 0 0 18px;border-left:3px solid var(--vk-soft2)}
.vk-timeline>li{position:relative;margin:0 0 12px;padding-left:10px}
.vk-timeline>li::before{content:"";position:absolute;left:-27px;top:6px;width:14px;height:14px;border-radius:50%%;background:var(--vk-accent);border:3px solid #fff;box-shadow:0 0 0 2px var(--vk-soft2)}
.vk-points{padding-left:1.2em}.vk-points li{margin:.3em 0}
details.vk-reveal{border:1px solid var(--vk-line);border-radius:12px;padding:10px 14px;margin:10px 0;background:#fff}
details.vk-reveal>summary{cursor:pointer;font-weight:600;color:var(--vk-accent)}
.vk-flips{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:12px 0}
.vk-flip{display:grid;width:100%%;min-height:140px;cursor:pointer;perspective:900px;outline:none}
.vk-flip>.vk-front,.vk-flip>.vk-back{grid-area:1/1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:16px;border-radius:14px;backface-visibility:hidden;-webkit-backface-visibility:hidden;transition:transform .5s ease}
.vk-flip>.vk-front{background:linear-gradient(135deg,var(--vk-accent),color-mix(in srgb,var(--vk-accent) 70%%,#000));color:#fff;font-weight:700}
.vk-flip>.vk-back{background:#fff;border:1px solid var(--vk-line);transform:rotateY(180deg)}
.vk-flip.is-flipped>.vk-front{transform:rotateY(-180deg)}
.vk-flip.is-flipped>.vk-back{transform:rotateY(0)}
.vk-flip .vk-hint{font-size:.72rem;opacity:.8;font-weight:500;margin-top:8px}
@media (max-width:480px){body{font-size:15px}h1{font-size:1.35rem}.vk-hero{padding:16px 14px}}
@media (prefers-reduced-motion:reduce){.vk-flip>*{transition:none}}
"""

SHELL_JS = """
document.addEventListener('click',function(e){var f=e.target.closest&&e.target.closest('.vk-flip');if(f){f.classList.toggle('is-flipped');}});
document.addEventListener('keydown',function(e){if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('vk-flip')){e.preventDefault();e.target.classList.toggle('is-flipped');}});
Array.prototype.forEach.call(document.querySelectorAll('.vk-flip'),function(f){if(!f.hasAttribute('tabindex'))f.setAttribute('tabindex','0');f.setAttribute('role','button');});
"""


def wrap_card(fragment: str, *, accent: Optional[str] = None, lang: str = "en", title: str = "") -> str:
    """The full document for one card, as served to the learner app."""
    srcs = [m.group(2) for m in _SRC_RE.finditer(fragment or "")]
    csp = _csp(image_origins(s for s in srcs if s.startswith("https://")))
    katex = ""
    if _MATH_HINT_RE.search(fragment or ""):
        katex = (
            f'<link rel="stylesheet" href="{_KATEX}/katex.min.css">'
            f'<script defer src="{_KATEX}/katex.min.js"></script>'
            f'<script defer src="{_KATEX}/contrib/auto-render.min.js" '
            "onload=\"renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},"
            "{left:'$',right:'$',display:false},{left:'\\\\(',right:'\\\\)',display:false},"
            "{left:'\\\\[',right:'\\\\]',display:true}],throwOnError:false})\"></script>"
        )
    css = SHELL_CSS % {"accent": safe_accent(accent)}
    return (
        "<!DOCTYPE html>"
        f'<html lang="{html_lib.escape(lang or "en")}"><head><meta charset="utf-8">'
        f'<meta http-equiv="Content-Security-Policy" content="{html_lib.escape(csp, quote=True)}">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{html_lib.escape(title or 'Lesson')}</title>"
        f"<style>{css}</style>{katex}</head>"
        f"<body>{fragment}<script>{SHELL_JS}</script></body></html>"
    )


# ── what the model is told about the kit ─────────────────────────────────────

KIT_GUIDE = """COMPONENT KIT — the page already has these styles; USE THEM, do not restyle them:
- <div class="vk-hero"><div class="vk-emoji">🌿</div><h1>Title</h1><p class="vk-lead">one-line promise</p></div>
- <div class="vk-callout key|tip|warn">short highlighted idea</div>
- <div class="vk-grid"><div class="vk-tile"><span class="vk-icon">⚡</span><h3>Term</h3><p>one line</p></div>…</div>
- <table class="vk-table"><tr><th>…</th></tr><tr><td>…</td></tr></table>
- <ol class="vk-steps"><li><strong>Step name</strong> — what happens</li>…</ol>
- <div class="vk-compare"><div><h3>A</h3>…</div><div><h3>B</h3>…</div></div>
- <div class="vk-example"><strong>Example</strong> worked example, step by step</div>
- <div class="vk-formula">$E = mc^2$</div>   (LaTeX between $…$ is rendered)
- <span class="vk-chip">key term</span>
- <div class="vk-big">70%</div> for a striking number
- <ul class="vk-timeline"><li><strong>Stage</strong> …</li></ul>
- <details class="vk-reveal"><summary>Think first, then tap</summary>answer</details>
- <div class="vk-flips"><div class="vk-flip"><div class="vk-front">Question or term<span class="vk-hint">tap to flip</span></div><div class="vk-back">Answer</div></div>…</div>
- A figure FROM THE BOOK: write exactly <img data-kb-fig="F2"> where it should appear (the platform inserts the real image and its caption). Never write any other <img>, and never write an image URL.
- A diagram the book does not have: draw it as inline <svg viewBox="0 0 600 300"> with clear <text> labels, using fill="var(--vk-accent)" and soft pastel fills. Keep it simple and correct.
You may add a small <style> block for layout details and a small inline <script> for interaction. No external scripts, fonts, links or network calls."""
