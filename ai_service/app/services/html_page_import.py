"""Import a hand-authored / AI-authored HTML page into the catalogue.

Institutes increasingly build a page in ChatGPT or Claude and arrive with a
standalone bundle. Converting that into typed components loses the design; the
section-level htmlBlock escape hatch is too strict to hold a whole page (30KB,
no <svg>, no <style>, url() stripped). This is the page-level contract:
deliberately more permissive than htmlBlock, deliberately still not a browser.

TIER 1 — inline, rendered in a shadow root, NO SCRIPTS.
Chosen over a sandboxed iframe because a marketing page has to stay indexable
and keep the site's header/footer. Scripts are the price; for the pages this
targets they are usually decorative (progress state, nav highlighting), and
anything genuinely interactive belongs in a typed component that can reach the
CRM anyway.

Everything removed is REPORTED rather than silently dropped — a paste that
renders wrong otherwise looks like our bug.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

# A whole page needs far more room than a section.
MAX_PAGE_HTML = 200_000
MAX_PAGE_CSS = 150_000

# htmlBlock's tag set plus what a real page needs: SVG (AI-authored pages are
# full of inline icons), <main>, and the media/figure family.
_SVG_TAGS = {
    "svg", "path", "g", "defs", "circle", "ellipse", "rect", "line", "polyline",
    "polygon", "text", "tspan", "title", "desc", "use", "symbol", "mask",
    "clipPath", "linearGradient", "radialGradient", "stop", "pattern", "filter",
    "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix",
}
# del/ins/strike: see the note on _CUSTOM_HTML_TAGS in routers/page_builder.py
# — nh3 keeps a disallowed tag's children, so a missing <del> silently degrades
# a struck price to plain text and kills the `del { … }` rule that styles it.
PAGE_HTML_TAGS = {
    "a", "article", "aside", "b", "blockquote", "br", "button", "caption",
    "cite", "code", "dd", "del", "div", "dl", "dt", "em", "figcaption",
    "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
    "i", "img", "ins", "li", "main", "mark", "nav", "ol", "p", "pre", "s",
    "section", "small", "span", "strike", "strong", "sub", "sup", "table",
    "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul",
} | _SVG_TAGS

_SVG_ATTRS = {
    "viewbox", "viewBox", "d", "fill", "stroke", "stroke-width", "stroke-linecap",
    "stroke-linejoin", "stroke-dasharray", "cx", "cy", "r", "rx", "ry", "x", "y",
    "x1", "y1", "x2", "y2", "points", "transform", "opacity", "fill-opacity",
    "stroke-opacity", "offset", "stop-color", "stop-opacity", "gradientUnits",
    "xmlns", "preserveAspectRatio", "clip-path", "mask", "filter", "fill-rule",
    "clip-rule", "text-anchor", "font-size", "font-family", "font-weight",
}
PAGE_HTML_ATTRS: Dict[str, set] = {
    "*": {"class", "id", "style", "title", "role", "aria-label", "aria-hidden",
          "aria-labelledby", "data-vacademy", "data-audience", "data-course",
          # The hook OBJECTS. Allowing data-vacademy without these kept the
          # verb and stripped the target, so every rewritten link became inert.
          "data-route", "data-target", "data-href"} | _SVG_ATTRS,
    "a": {"href", "target", "name"},
    "img": {"src", "alt", "width", "height", "loading", "decoding"},
    "time": {"datetime"},
    "th": {"colspan", "rowspan", "scope"},
    "td": {"colspan", "rowspan"},
}

_SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script\s*>", re.I | re.S)
_STYLE_RE = re.compile(r"<style\b[^>]*>(.*?)</style\s*>", re.I | re.S)
_LINK_CSS_RE = re.compile(r'<link\b[^>]*rel=["\']?stylesheet["\']?[^>]*>', re.I)
_HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)
_BODY_RE = re.compile(r"<body\b[^>]*>(.*)</body\s*>", re.I | re.S)
_CSS_IMPORT_RE = re.compile(r"@import\b[^;]*;", re.I)
_CSS_URL_RE = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", re.I)
_BANNED_CSS_RE = re.compile(r"expression\s*\(|(?<![\w-])behavior\s*:|-moz-binding|javascript\s*:", re.I)
_SRC_RE = re.compile(r'(<img\b[^>]*?\bsrc=["\'])([^"\']*)(["\'])', re.I)
_ANCHOR_RE = re.compile(r'<a\b([^>]*?)\bhref=["\']([^"\']*)["\']([^>]*)>', re.I)
_REMOTE_RE = re.compile(r"^(https?:)?//", re.I)


def _is_local_asset(url: str) -> bool:
    """A path that only resolves inside the uploaded bundle."""
    u = (url or "").strip()
    if not u or u.startswith("#") or u.startswith("data:"):
        return False
    return not _REMOTE_RE.match(u) and not u.startswith("mailto:") and not u.startswith("tel:")


def import_html_page(
    raw: str, asset_map: Optional[Dict[str, str]] = None
) -> Tuple[str, str, Dict[str, Any]]:
    """Split a pasted page into (html, css, report).

    asset_map maps a bundle-relative path ("assets/logo.png") to the https URL
    it was re-hosted at. Anything unmapped is reported, not guessed."""
    asset_map = asset_map or {}
    report: Dict[str, Any] = {
        "scripts_removed": 0, "stylesheets_inlined": 0, "external_stylesheets": [],
        "assets_rewritten": 0, "assets_missing": [], "css_imports_removed": 0,
        "css_urls_dropped": 0, "truncated": [], "interactive_removed": {},
    }

    html = raw or ""

    # 1. Scripts. Counted, then gone — Tier 1 has no JS.
    html, n = _SCRIPT_RE.subn("", html)
    report["scripts_removed"] = n

    # 2. <style> blocks move to the css prop; the tag itself is not allowed
    #    through the sanitizer, so leaving them inline would lose the styling.
    css_parts: List[str] = []
    for m in _STYLE_RE.finditer(html):
        css_parts.append(m.group(1))
    html = _STYLE_RE.sub("", html)
    report["stylesheets_inlined"] = len(css_parts)

    # 3. External stylesheets can't be fetched at render time. Report them so
    #    the admin knows to paste that CSS in (or that a font link was lost).
    for m in _LINK_CSS_RE.finditer(html):
        href = _HREF_RE.search(m.group(0))
        if href:
            report["external_stylesheets"].append(href.group(1))
    html = _LINK_CSS_RE.sub("", html)

    # 4. Body only — <head>, <html>, <meta> are the site's job.
    body = _BODY_RE.search(html)
    if body:
        html = body.group(1)

    # 5. Rewrite image sources to their re-hosted URLs.
    def _fix_src(m: "re.Match[str]") -> str:
        url = m.group(2)
        if not _is_local_asset(url):
            return m.group(0)
        mapped = asset_map.get(url) or asset_map.get(url.lstrip("./"))
        if mapped:
            report["assets_rewritten"] += 1
            return f"{m.group(1)}{mapped}{m.group(3)}"
        if url not in report["assets_missing"]:
            report["assets_missing"].append(url)
        return f"{m.group(1)}{m.group(3)}"

    html = _SRC_RE.sub(_fix_src, html)

    # 5b. Links -> hooks the renderer can act on (see rewrite_links).
    html = rewrite_links(html, report)

    # 6. Interactive elements. Tier 1 has no JS and no form target, so a
    #    checkbox that never saves is worse than no checkbox — they are removed
    #    by the allowlist. Count them FIRST so the admin is told what to
    #    replace: a lead form for enquiries, a course activity for exercises.
    #    (Measured on a real bundle: a 30-day course's day page loses exactly
    #    its practice checkboxes and reflection box, and no words of content.)
    for tag in ("input", "textarea", "select", "form", "label"):
        n_tag = len(re.findall(r"<%s\b" % tag, html, re.I))
        if n_tag:
            report["interactive_removed"][tag] = n_tag

    css = "\n".join(css_parts)
    css, n_imp = _CSS_IMPORT_RE.subn("", css)
    report["css_imports_removed"] = n_imp

    def _fix_css_url(m: "re.Match[str]") -> str:
        url = m.group(1)
        if _is_local_asset(url):
            mapped = asset_map.get(url) or asset_map.get(url.lstrip("./"))
            if mapped:
                report["assets_rewritten"] += 1
                return f"url('{mapped}')"
            if url not in report["assets_missing"]:
                report["assets_missing"].append(url)
            report["css_urls_dropped"] += 1
            return "none"
        return m.group(0)

    css = _CSS_URL_RE.sub(_fix_css_url, css)
    css = _BANNED_CSS_RE.sub("", css).replace("</", " ")

    if len(html) > MAX_PAGE_HTML:
        html = html[:MAX_PAGE_HTML]
        report["truncated"].append("html")
    if len(css) > MAX_PAGE_CSS:
        css = css[:MAX_PAGE_CSS]
        report["truncated"].append("css")

    return html.strip(), css.strip(), report


def sanitize_page_html(html: str) -> Tuple[str, bool]:
    """Final allowlist pass. Returns (clean, used_nh3)."""
    try:
        import nh3

        return nh3.clean(
            html,
            tags=PAGE_HTML_TAGS,
            attributes=PAGE_HTML_ATTRS,
            url_schemes={"https", "mailto", "tel"},
            link_rel="noopener noreferrer",
        ), True
    except ImportError:
        return re.sub(r"<[^>]*>", "", html), False


# ─── Link bridge ─────────────────────────────────────────────────────────────
#
# A pasted page's links do not work as written, and each fails differently:
#
#   href="#section"   survives, then does NOTHING — fragment navigation cannot
#                     see ids inside a shadow root.
#   href="start/"     survives, resolves against the browser's base rather than
#                     the catalogue route, and leaves the site.
#   href="http://…"   has its href STRIPPED by the scheme allowlist, leaving a
#                     dead <a> with no indication anything was lost.
#   <button>          keeps no attributes, so it can never do anything.
#
# So links are rewritten at import time into a small attribute vocabulary the
# renderer binds at runtime with one delegated click handler. Authors can also
# write these by hand, which is how a pasted button reaches our lead capture or
# checkout — the thing that makes hosting here worth more than a static host.

_ROUTE_HOOK = 'data-vacademy="route" data-route="%s"'
_SCROLL_HOOK = 'data-vacademy="scroll" data-target="%s"'

# Values are interpolated into double-quoted attributes. Without escaping, an
# href like  x" style="position:fixed;width:100vw  closes the attribute and
# injects a NEW one that the allowlist then happily keeps — a full-viewport
# overlay built out of a link. Found in review, before anything rendered it.
_UNSAFE_ATTR_RE = re.compile(r"[\"'<>`]")
_UNSAFE_SLUG_RE = re.compile(r"[^A-Za-z0-9/_-]")


def _attr(value: str) -> str:
    """Safe to place inside a double-quoted attribute."""
    return _UNSAFE_ATTR_RE.sub("", value or "")


def _slug(value: str) -> str:
    """Route / anchor ids are slugs; anything else cannot be legitimate."""
    return _UNSAFE_SLUG_RE.sub("", value or "")


def normalise_route(href: str) -> str:
    """A bundle-relative link -> a catalogue page route ('' means home)."""
    r = (href or "").strip().split("?")[0].split("#")[0]
    r = re.sub(r"^\.{1,2}/", "", r)
    while r.startswith("../"):
        r = r[3:]
    r = r.lstrip("./").lstrip("/").rstrip("/")
    if r.endswith(".html"):
        r = r[:-5]
    if r in ("index", "."):
        r = ""
    return r


def rewrite_links(html: str, report: Dict[str, Any]) -> str:
    """Convert plain anchors into hooks the renderer can act on.

    Parsed, not regexed. A regex rewrite re-emits the surrounding attributes as
    text, which turns a perfectly safe single-quoted href — <a href='x" style="
    position:fixed;width:100vw'> — into TWO attributes and hands the allowlist a
    full-viewport overlay. The original markup was harmless; the rewrite created
    the injection. BeautifulSoup handles attributes structurally and quotes its
    own output, so the class of bug cannot occur."""
    counts = {"internal": 0, "anchors": 0, "external": 0, "http_upgraded": 0}
    try:
        from bs4 import BeautifulSoup
    except ImportError:  # never silently pass links through unrewritten
        report["links_not_rewritten"] = True
        return html

    soup = BeautifulSoup(html, "html.parser")
    for a in soup.find_all("a"):
        href = (a.get("href") or "").strip()
        if href.startswith("#") and len(href) > 1:
            target = _slug(href[1:])
            a["href"] = f"#{target}"
            a["data-vacademy"] = "scroll"
            a["data-target"] = target
            counts["anchors"] += 1
        elif href.lower().startswith("http://"):
            # nh3 allows https only, so an http link would lose its href
            # entirely. Upgrading beats silently deleting it.
            a["href"] = "https://" + href[7:]
            counts["http_upgraded"] += 1
        elif _REMOTE_RE.match(href) or href.startswith(("mailto:", "tel:")):
            counts["external"] += 1
        elif not href or href.lower().startswith("javascript:"):
            if a.has_attr("href"):
                del a["href"]
        else:
            a["data-vacademy"] = "route"
            a["data-route"] = _slug(normalise_route(href))
            counts["internal"] += 1

    out = str(soup)
    report["links"] = {k: v for k, v in counts.items() if v}
    # A button with no hook is inert — worth telling the admin.
    inert = len(re.findall(r"<button\b(?![^>]*data-vacademy)", out, re.I))
    if inert:
        report["inert_buttons"] = inert
    return out
