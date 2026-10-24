"""
Opinionated quality review of a composed page: is it BEAUTIFUL, not just valid?

The builder's ``page_audit`` catches what is broken (contrast, empty page, a
split hero with no image). This layer adds taste — the things a designer
flags on a first pass — and turns everything into one score the connected
model can iterate against: fix the ``fix`` items, then the ``warn`` items,
until the score clears the bar.

Pure functions over the page JSON. Every rule states the fix in the words an
``update_page`` op needs, because the reader is a model that will act on it.

Two modes:

* **standard** — the landing-page doctrine above, for pages composed from an
  interview;
* **fidelity** — the page reproduces a design (its meta carries
  ``designSource``, or the caller asks for it). The design wins: the taste
  rules (how many sections, a separate hero, proof, closing CTA, bands, styles)
  are dropped, and only what a visitor would see as BROKEN still counts —
  blank bands, unbound data, empty CTAs, contrast, placeholder copy, forms.
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, FrozenSet, List, Optional, Tuple

from .catalogue_summary import CAPTURE_TYPES, heading_of, strip_html, walk_components
from .page_audit import text_values

#: Sections that count as "proof" / "conversion" on a landing page.
PROOF_TYPES = frozenset({"statsHighlights", "testimonialSection", "logoCloud", "trustChip"})
CONVERSION_TYPES = frozenset({"ctaBanner", "leadForm", "contactForm", "newsletterSignup", "pricingTable",
                              "courseCatalog", "courseShowcase", "productCourseGrid", "productPageOffer",
                              "folderBrowser", "learningPath"})
BAND_TYPES = frozenset({"heroSection", "ctaBanner", "statsHighlights", "logoCloud", "marquee", "trustChip", "spacer"})

_PLACEHOLDER_RE = re.compile(
    r"lorem ipsum|\byour (?:institute|company|school) name\b|\bplaceholder\b|\bexample\.com\b|\bcoming soon\b|"
    r"\bwelcome to our platform\b|\bmy platform\b|\bdescription here\b|\bwrite your content here\b|\bnew program\b", re.I)
# Fidelity mode: real copy in a design says "Coming soon" (a launch shelf, a
# notify-me row), so that phrase is not placeholder copy there.
_FIDELITY_PLACEHOLDER_RE = re.compile(
    r"lorem ipsum|\byour (?:institute|company|school) name\b|\bplaceholder\b|\bexample\.com\b|"
    r"\bwelcome to our platform\b|\bmy platform\b|\bdescription here\b|\bwrite your content here\b|\bnew program\b", re.I)
_HEX_RE = re.compile(r"^#([0-9a-fA-F]{6})$")

SCORE_BAR = 85

#: Page types the review knows. ``catalog`` = a page a course catalogue owns
#: (its own hero, streams, sidebar): a directory, not a landing page.
REVIEW_PAGE_TYPES = ("homepage", "courses", "course-landing", "about", "admissions", "contact", "catalog")

#: Taste rules a faithful design may break (fidelity mode drops them): the
#: number of sections, a separate hero / proof / closing CTA, band rhythm,
#: styling, hero copy length and decoration.
FIDELITY_SKIPPED_CODES = frozenset({
    "too-few-sections", "too-many-sections", "too-short", "too-long", "no-hero", "hero-not-first", "no-proof",
    "weak-ending", "adjacent-twins", "same-band", "flat-page", "all-bands", "unstyled", "hero-headline-long",
    "hero-sub-long", "hero-too-many-ctas", "hero-no-image", "hero-no-eyebrow", "no-heading", "grid-count",
    "wall-of-text", "too-many-colours", "hero-against-reference",
})
#: Still worth telling the admin in fidelity mode, never a reason to change the design.
FIDELITY_ADVISORY_CODES = frozenset({"no-conversion", "hero-no-cta"})

# How the new widgets count in the review: the design-pattern registry's
# `reviewAs` (frontend …/-ai/design-patterns.ts, exported into the schema
# catalog). A pattern whose propPath is a top-level prop (`props.hero`) is a
# switchable part of its component; one whose propPath is `props` is the
# component itself. When the part is live (enabled, stats present) stays here.
_CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "catalogue_schema_catalog.json"
#: Used when the catalog cannot be read: what the registry said when this was written.
_FALLBACK_PARTS: Dict[str, Tuple[Tuple[str, FrozenSet[str]], ...]] = {
    "courseCatalog": (("hero", frozenset({"hero", "proof"})),),
}
_PROP_PATH_RE = re.compile(r"^props\.([A-Za-z0-9_]+)$")


@lru_cache(maxsize=1)
def _review_roles() -> Tuple[Dict[str, Tuple[Tuple[str, FrozenSet[str]], ...]], Dict[str, FrozenSet[str]]]:
    """(component type → ((part prop, roles), …), component type → roles of the whole component)."""
    try:
        with open(_CATALOG_PATH, "r", encoding="utf-8") as fh:
            patterns = json.load(fh).get("patterns") or []
    except Exception as exc:  # noqa: BLE001 — review must not fail on a missing export
        logging.getLogger(__name__).warning("pattern registry unreadable, using built-in review roles: %s", exc)
        return _FALLBACK_PARTS, {}
    parts: Dict[str, Dict[str, set]] = {}
    whole: Dict[str, set] = {}
    for p in patterns:
        if not isinstance(p, dict) or not isinstance(p.get("component"), str):
            continue
        roles = {r for r in p.get("reviewAs") or [] if isinstance(r, str)}
        path = str(p.get("propPath") or "").strip()
        if path == "props":
            whole.setdefault(p["component"], set()).update(roles)
        elif (m := _PROP_PATH_RE.match(path)) and roles:
            parts.setdefault(p["component"], {}).setdefault(m.group(1), set()).update(roles)
    return ({t: tuple((k, frozenset(r)) for k, r in ps.items()) for t, ps in parts.items()},
            {t: frozenset(r) for t, r in whole.items()})


def _live_part(comp: Dict[str, Any], role: str) -> Optional[Dict[str, Any]]:
    """The first switched-on part of ``comp`` the registry says reviews as ``role``."""
    props = comp.get("props") if isinstance(comp.get("props"), dict) else {}
    for key, roles in _review_roles()[0].get(str(comp.get("type") or ""), ()):
        part = props.get(key)
        if role in roles and isinstance(part, dict) and part.get("enabled") is True:
            return part
    return None


def _catalog_hero(comp: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """courseCatalog.hero when switched on: the catalogue owns the fold."""
    if comp.get("type") != "courseCatalog":
        return None
    return _live_part(comp, "hero")


def _reviews_as_hero(comp: Dict[str, Any]) -> bool:
    # heroSection in every variant (editorial included); a catalogue with its hero on.
    return (comp.get("type") == "heroSection" or "hero" in _review_roles()[1].get(str(comp.get("type") or ""), ())
            or _live_part(comp, "hero") is not None)


def _reviews_as_proof(comp: Dict[str, Any]) -> bool:
    """A proof section, or a catalogue hero showing live stats (course and stream counts)."""
    if comp.get("type") in PROOF_TYPES:
        return True
    part = _live_part(comp, "proof")
    return bool(part and isinstance(part.get("stats"), list) and part["stats"])


def design_source_of(page: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """``page.meta.designSource`` — set by website_edit create_page / create_site(design_source=…)."""
    meta = page.get("meta") if isinstance(page, dict) else None
    ds = meta.get("designSource") if isinstance(meta, dict) else None
    return ds if isinstance(ds, dict) and ds else None


def content_page_type(page: Dict[str, Any]) -> Optional[str]:
    """
    The page type the CONTENT says, or None to keep the caller's guess. Only
    the new widgets decide anything here, so pages without them are reviewed
    exactly as before: a page whose first section is a course catalogue with
    its own hero is a ``catalog``.
    """
    top = [c for c in (page.get("components") or []) if isinstance(c, dict) and c.get("enabled", True) is not False]
    if top and _catalog_hero(top[0]) is not None:
        return "catalog"
    return None


def review_mode(page: Dict[str, Any], page_type: Optional[str] = None,
                fidelity: Optional[bool] = None) -> Tuple[Optional[str], bool]:
    """
    ``(page_type, fidelity)`` for a page: explicit arguments win; then the
    mode the page was created in (meta.designSource / meta.pageType); then
    what the content says. ``page_type`` None = keep the caller's default.
    """
    ds = design_source_of(page)
    meta = page.get("meta") if isinstance(page.get("meta"), dict) else {}
    if page_type not in REVIEW_PAGE_TYPES:
        page_type = None
        if ds and meta.get("pageType") in REVIEW_PAGE_TYPES:
            page_type = meta["pageType"]
        page_type = page_type or content_page_type(page)
    return page_type, (bool(ds) if fidelity is None else bool(fidelity))


def _issue(code: str, kind: str, message: str, fix: str, component_id: Optional[str] = None, weight: int = 5) -> Dict[str, Any]:
    out = {"code": code, "kind": kind, "severity": "error" if kind == "fix" else "warning", "message": message, "fix": fix, "weight": weight}
    if component_id:
        out["component_id"] = component_id
    return out


def _strings_of(node: Any, out: List[str], depth: int = 0) -> None:
    if depth > 6 or node is None:
        return
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, list):
        for v in node:
            _strings_of(v, out, depth + 1)
    elif isinstance(node, dict):
        for v in node.values():
            _strings_of(v, out, depth + 1)


def _words(text: Any) -> int:
    return len(strip_html(text, 100000).split()) if isinstance(text, str) else 0


def _hero_of(components: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    return next((c for c in components if _reviews_as_hero(c)), None)


def _bg_of(comp: Dict[str, Any]) -> str:
    style = comp.get("style") if isinstance(comp.get("style"), dict) else {}
    p = comp.get("props") or {}
    if isinstance(style.get("backgroundLayers"), list) and style["backgroundLayers"]:
        return "gradient"
    return str(style.get("backgroundColor") or p.get("backgroundColor") or "").strip().upper()


def _accent_colours(page: Dict[str, Any], global_settings: Optional[Dict[str, Any]]) -> set:
    theme = ((global_settings or {}).get("theme") or {})
    primary = str(theme.get("primaryColor") or "").upper()
    colours: set = set()
    for c in walk_components(page.get("components")):
        for src in (c.get("style") or {}, c.get("props") or {}):
            for key in ("backgroundColor", "textColor", "accentColor", "color"):
                v = src.get(key) if isinstance(src, dict) else None
                if isinstance(v, str) and _HEX_RE.match(v.strip()):
                    hexv = v.strip().upper()
                    if hexv in ("#FFFFFF", "#000000", primary) or _is_neutral(hexv):
                        continue
                    colours.add(hexv)
    return colours


def _is_neutral(hexv: str) -> bool:
    m = _HEX_RE.match(hexv)
    if not m:
        return False
    r, g, b = (int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4))
    return max(r, g, b) - min(r, g, b) < 24   # greys / near-whites / near-blacks


def review_page(page: Dict[str, Any], global_settings: Optional[Dict[str, Any]] = None,
                page_type: str = "homepage", fidelity: bool = False) -> Dict[str, Any]:
    """
    ``{score, bar, issues, summary}`` for one page. Score starts at 100 and
    loses each issue's weight; ``fix`` items weigh more than ``warn`` items.
    ``fidelity``: the page reproduces a design — see the module docstring.
    """
    out = _review_page(page, global_settings, page_type, fidelity)
    return _fidelity_filter(out) if fidelity else out


def _fidelity_filter(out: Dict[str, Any]) -> Dict[str, Any]:
    issues = []
    for i in out["issues"]:
        if i["code"] in FIDELITY_SKIPPED_CODES:
            continue
        if i["code"] in FIDELITY_ADVISORY_CODES and i["kind"] == "fix":
            i = {**i, "kind": "warn", "severity": "warning", "weight": min(i["weight"], 4)}
        issues.append(i)
    return {**_finish(issues, out["summary"]), "mode": "fidelity"}


def _review_page(page: Dict[str, Any], global_settings: Optional[Dict[str, Any]],
                 page_type: str, fidelity: bool) -> Dict[str, Any]:
    comps = [c for c in walk_components(page.get("components"))]
    top = [c for c in (page.get("components") or []) if isinstance(c, dict)]
    types = [c.get("type") for c in comps]
    issues: List[Dict[str, Any]] = []
    is_html = any(t == "htmlPage" for t in types)
    landing = page_type in ("homepage", "course-landing", "admissions")

    if not comps:
        return {"score": 0, "bar": SCORE_BAR, "issues": [_issue("empty", "fix", "The page has no sections.", "Compose the page.", weight=100)], "summary": "empty"}
    if is_html:
        html = str((comps[0].get("props") or {}).get("html") or "")
        if len(strip_html(html, 10**7)) < 200:
            issues.append(_issue("html-thin", "warn", "The HTML page has very little text.", "Add real content — headings, paragraphs, a call to action.", comps[0].get("id"), 15))
        return _finish(issues, "html page")

    # ── structure ────────────────────────────────────────────────────────
    n = len(top)
    if landing and n < 5:
        issues.append(_issue("too-few-sections", "fix", f"Only {n} sections — a landing page needs 6–12 (hero → proof → what you get → how it works → social proof → CTA).",
                             "Insert the missing sections with update_page ops.", weight=15))
    elif n > 14:
        issues.append(_issue("too-many-sections", "warn", f"{n} sections — long pages lose readers.", "Merge or remove the weakest sections.", weight=5))

    hero = _hero_of(comps)
    if landing and hero is None:
        issues.append(_issue("no-hero", "fix", "No hero section — nothing owns the fold.", "Insert a heroSection at position 1 with a headline, one-line subheading and one or two buttons.", weight=15))
    if hero is not None and top and top[0] is not hero and top[0].get("type") not in ("sectionHeading",):
        issues.append(_issue("hero-not-first", "warn", "The hero is not the first section.", "Move the heroSection to the top (op move, afterId null).", hero.get("id"), 6))

    if landing and not any(_reviews_as_proof(c) for c in comps):
        issues.append(_issue("no-proof", "fix", "No proof section (stats, testimonials, logos).", "Insert a statsHighlights with 3–4 real numbers, or a testimonialSection, after the hero.", weight=10))
    if landing and not any(t in CONVERSION_TYPES for t in types):
        issues.append(_issue("no-conversion", "fix", "Nothing for the visitor to do — no CTA, form or course list.", "Insert a ctaBanner near the end and a leadForm, or a course block.", weight=12))
    if landing and hero is not None and top and top[-1].get("type") not in ("ctaBanner", "leadForm", "contactForm", "footer"):
        issues.append(_issue("weak-ending", "warn", f"The page ends on a {top[-1].get('type')} — pages should close with a call to action.", "Move a ctaBanner or leadForm to the end.", top[-1].get("id"), 5))

    # ── rhythm ───────────────────────────────────────────────────────────
    for a, b in zip(top, top[1:]):
        if a.get("type") == b.get("type") and a.get("type") not in ("sectionHeading", "spacer", "textBlock"):
            issues.append(_issue("adjacent-twins", "warn", f"Two {a.get('type')} sections back to back.", "Vary the section type, or merge them.", b.get("id"), 5))
        if _bg_of(a) and _bg_of(a) == _bg_of(b) and a.get("type") in BAND_TYPES and b.get("type") in BAND_TYPES:
            issues.append(_issue("same-band", "warn", "Two coloured bands with the same colour in a row.", "Give one of them a different background or none.", b.get("id"), 4))
    banded = sum(1 for c in top if _bg_of(c))
    if n >= 5 and banded == 0:
        issues.append(_issue("flat-page", "warn", "Every section sits on the same white background — the page reads as a template.",
                             "Give the hero, the proof strip and the closing CTA a style.backgroundColor or backgroundLayers; keep the rest plain.", weight=10))
    if n >= 5 and banded >= n - 1:
        issues.append(_issue("all-bands", "warn", "Almost every section is a coloured band.", "Let 40–60% of sections sit on the plain page background.", weight=6))
    styled = sum(1 for c in top if isinstance(c.get("style"), dict) and c["style"])
    if n >= 5 and styled == 0:
        issues.append(_issue("unstyled", "warn", "No section carries a style — spacing, widths and atmosphere are all defaults.",
                             "Set style.layout.width and paddings on key sections; add an ornament or divider to the hero or CTA (see style_schema).", weight=8))

    # ── hero quality ─────────────────────────────────────────────────────
    # A catalogue hero owns the fold for the structure rules above, but every
    # heroSection is still checked on its own: a catalogue hero must not hide
    # an empty or half-empty hero further down. Standard mode checks the first
    # heroSection (as it always has); fidelity mode checks each of them.
    for c in comps:
        catalog_hero = _catalog_hero(c)
        if catalog_hero is not None and not str(catalog_hero.get("title") or "").strip():
            issues.append(_issue("hero-no-headline", "fix", "The catalogue hero has no headline.", "Set props.hero.title.", c.get("id"), 10))
    hero_sections = [c for c in comps if c.get("type") == "heroSection"]
    for hero in hero_sections if fidelity else hero_sections[:1]:
        p = hero.get("props") or {}
        left = p.get("left") if isinstance(p.get("left"), dict) else {}
        title = left.get("title") or p.get("title") or ""
        sub = left.get("subheading") or left.get("description") or ""
        if _words(title) > 10:
            issues.append(_issue("hero-headline-long", "warn", f"Hero headline is {_words(title)} words.", "Cut it to ≤ 10 words; move detail into the subheading.", hero.get("id"), 6))
        if not title:
            issues.append(_issue("hero-no-headline", "fix", "The hero has no headline.", "Set props.left.title.", hero.get("id"), 10))
        if _words(sub) > 45:
            issues.append(_issue("hero-sub-long", "warn", "Hero subheading is a paragraph.", "Cut to ≤ 30 words.", hero.get("id"), 4))
        buttons = [b for b in (left.get("buttons") or []) if isinstance(b, dict)]
        if not buttons and not (isinstance(left.get("button"), dict) or isinstance(p.get("button"), dict)):
            issues.append(_issue("hero-no-cta", "fix", "The hero has no button.", "Add props.left.buttons: one primary (enquire / apply) and optionally one secondary (see courses).", hero.get("id"), 8))
        if len(buttons) > 2:
            issues.append(_issue("hero-too-many-ctas", "warn", f"{len(buttons)} hero buttons.", "Keep one primary and one secondary.", hero.get("id"), 4))
        right = p.get("right") if isinstance(p.get("right"), dict) else {}
        has_image = bool(str(right.get("image") or "").startswith("http")) or bool(str((p.get("backgroundImage") or "")).startswith("http"))
        if not has_image and p.get("layout") == "split":
            issues.append(_issue("hero-split-no-image", "fix", "Split hero with no image leaves half the fold empty.", "Set props.layout to 'centered' (or place an institute photo in props.right.image).", hero.get("id"), 8))
        if not has_image and page_type == "homepage":
            issues.append(_issue("hero-no-image", "warn", "The hero has no photo.", "If the institute has a campus/class photo (list_media / import_image), put it in props.right.image with layout 'split'.", hero.get("id"), 5))
        if not p.get("eyebrow") and landing:
            issues.append(_issue("hero-no-eyebrow", "warn", "No eyebrow above the headline.", "Add props.eyebrow {text: a short badge like 'Admissions open 2027', style: 'badge'}.", hero.get("id"), 3))

    # ── content quality ──────────────────────────────────────────────────
    for c in comps:
        p = c.get("props") or {}
        t = c.get("type")
        if t in ("sectionHeading", "spacer", "htmlPage", "header", "footer") or t in CAPTURE_TYPES:
            pass
        elif t not in ("courseCatalog", "productCourseGrid", "productPageOffer", "courseShowcase", "imageBlock", "buttonBlock", "mapEmbed", "videoEmbed", "documentViewer", "announcementFeed", "marquee", "trustChip") and not heading_of(c):
            issues.append(_issue("no-heading", "warn", f"{t} has no heading.", "Give it a short heading so the page scans.", c.get("id"), 3))
        for key in ("features", "stats", "steps"):
            items = p.get(key)
            if isinstance(items, list) and items:
                if key == "features" and len(items) not in (3, 4, 6):
                    issues.append(_issue("grid-count", "warn", f"{len(items)} feature cards — grids read best with 3, 4 or 6.", "Add or drop a card.", c.get("id"), 3))
                if key == "stats":
                    weak = [s for s in items if isinstance(s, dict) and not re.search(r"\d", str(s.get("value") or ""))]
                    if weak:
                        issues.append(_issue("stats-no-numbers", "fix", "A stats strip without numbers is decoration.", "Use real figures from the interview (years, selections, learners).", c.get("id"), 6))
        blob: List[str] = []
        (text_values if fidelity else _strings_of)(p, blob)
        if (_FIDELITY_PLACEHOLDER_RE if fidelity else _PLACEHOLDER_RE).search(" ".join(blob)):
            issues.append(_issue("placeholder-copy", "fix", "Template or placeholder copy is still on the page.", "Replace it with the institute's own words.", c.get("id"), 8))
        if t == "textBlock" and _words(p.get("content")) > 220:
            issues.append(_issue("wall-of-text", "warn", "A very long text block.", "Split into a sectionHeading + featureGrid/detailBlocks, or cut it.", c.get("id"), 4))
        if t == "testimonialSection":
            quotes = [q for q in (p.get("testimonials") or []) if isinstance(q, dict)]
            if not quotes:
                issues.append(_issue("empty-testimonials", "fix", "Testimonials section with no quotes.", "Add 2–3 real quotes with names, or remove the section.", c.get("id"), 8))

    # ── palette ──────────────────────────────────────────────────────────
    accents = _accent_colours(page, global_settings)
    if len(accents) >= 3:
        issues.append(_issue("too-many-colours", "warn", f"{len(accents)} accent colours besides the theme's primary on one page.", "Use the theme's primary plus at most one or two tints.", weight=6))

    return _finish(issues, f"{n} sections, {banded} bands, {styled} styled")


def _finish(issues: List[Dict[str, Any]], summary: str) -> Dict[str, Any]:
    score = max(0, 100 - sum(i["weight"] for i in issues))
    issues.sort(key=lambda i: (0 if i["kind"] == "fix" else 1, -i["weight"]))
    return {
        "score": score,
        "bar": SCORE_BAR,
        "passes": score >= SCORE_BAR and not any(i["kind"] == "fix" for i in issues),
        "issues": issues,
        "summary": summary,
    }


def audit_kind(issue: Dict[str, Any], fidelity: bool) -> str:
    """
    ``fix`` / ``warn`` for one ``page_audit`` issue. Audit issues carry
    ``severity`` ('fix' | 'warn'), not ``kind``, so standard mode has always
    merged them as warnings (kept as is: its verdicts must not move). Fidelity
    mode drops most of the review's own fix items, which leaves the audit as
    its correctness gate — there an audit ``fix`` is a fix.
    """
    if issue.get("kind") == "fix" or (fidelity and issue.get("severity") == "fix"):
        return "fix"
    return "warn"


def review_with_audit(page: Dict[str, Any], global_settings: Optional[Dict[str, Any]], page_type: str,
                      fidelity: bool = False) -> Dict[str, Any]:
    """Beauty review merged with the builder's defect audit (deduplicated by code)."""
    out = _review_page(page, global_settings, page_type, fidelity)
    try:
        from .page_audit import audit_page
        # Standard mode keeps its historic dedupe (by code, against the review's own items). Fidelity
        # mode dedupes per section: the audit is its main correctness gate, so
        # a second broken section must not hide behind the first one's code.
        def _key(code: str, component_id: Any) -> Any:
            return (code, component_id) if fidelity else code

        seen = {_key(i["code"], i.get("component_id")) for i in out["issues"]}
        for i in audit_page(page, global_settings, page_type=page_type or "homepage", fidelity=fidelity):
            code = str(i.get("code") or "")
            if _key(code, i.get("component_id")) in seen:
                continue
            kind = audit_kind(i, fidelity)
            out["issues"].append(_issue(code, kind, str(i.get("message") or ""), str(i.get("hint") or ""), i.get("component_id"), 8 if kind == "fix" else 4))
    except Exception:  # noqa: BLE001 — the beauty review stands on its own
        pass
    if fidelity:
        return _fidelity_filter(out)
    return _finish(out["issues"], out["summary"])


__all__ = ["review_page", "review_with_audit", "review_mode", "audit_kind", "content_page_type", "design_source_of",
           "SCORE_BAR", "REVIEW_PAGE_TYPES", "FIDELITY_SKIPPED_CODES"]
