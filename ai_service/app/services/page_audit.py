"""Design audit for AI-composed catalogue pages.

The composer's output was only ever checked for SAFETY (allowlisted component
types, scrubbed URLs, sanitized HTML) — never for whether the page is any good.
Every quality defect this year was caught by a human opening the published page:
sections that rendered as blank bands, a ctaBanner with no button, a hero with
an empty image slot, a productPageOffer bound to no product page. None of those
need a model to spot; they are decidable from the JSON.

This module is that decision. It is deliberately DETERMINISTIC — no LLM, no
scoring, no taste. Every rule here describes a defect that would be visible to a
visitor, so a finding can be handed straight to a repair pass without a human
adjudicating it first. Judgement calls (is the copy good? does this match the
reference?) are out of scope on purpose: a rule that is sometimes wrong would
teach the repair pass to damage correct pages.

Severity:
  fix  — a visitor sees something broken or empty; worth spending a repair call.
  warn — worth telling the admin, not worth an automatic edit.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

# Components whose entire purpose is their list: an empty one renders as a
# titled band with nothing under it. Deliberately excludes lists that are
# legitimately optional (heroSection.statChips, trustChip.avatars,
# courseCatalog.filtersConfig, contactForm.fields, columnLayout.slots) and
# lists whose component still renders meaningfully when empty.
_LIST_PROPS: Dict[str, str] = {
    "featureGrid": "features",
    "statsHighlights": "stats",
    "testimonialSection": "testimonials",
    "faqSection": "faqs",
    "pricingTable": "plans",
    "teamSection": "members",
    "imageGallery": "images",
    "tabsAccordion": "items",
    "logoCloud": "logos",
    "detailBlocks": "blocks",
    "stepsProcess": "steps",
    "marquee": "items",
    "announcementFeed": "announcements",
}

# Anything that asks a visitor to act. A landing page without one of these has
# no way to convert, which is the whole reason the page exists.
_CONVERSION_TYPES = {
    "ctaBanner", "leadForm", "contactForm", "newsletterSignup",
    "courseCatalog", "productPageOffer", "folderBrowser", "learningPath", "pricingTable", "bookCatalogue",
}
_CONVERSION_ACTIONS = {"openLeadCollection", "openAudienceForm", "enroll", "enrol"}

# Commerce surfaces that must not appear on a page the brief called informational.
_COMMERCE_TYPES = {"courseCatalog", "cartComponent", "pricingTable", "buyRentSection", "bookCatalogue"}

_PLACEHOLDER_RE = re.compile(
    r"lorem ipsum|your (?:text|title|heading|content) here|add your |replace this|"
    r"\btodo\b|\btbd\b|placeholder|example\.com|description here|xxx+",
    re.IGNORECASE,
)
# Emoji ranges, used only where the component has a real iconName field.
_EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF⬀-⯿️]"
)
_HEX_LITERAL_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")
_RGB_LITERAL_RE = re.compile(r"\brgba?\s*\(\s*\d")

# Components that carry an iconName field, so an emoji in `icon` is the wrong
# choice rather than the intended one. marquee is EXCLUDED — its icons are
# emoji by design (see the schema catalog's example props).
_ICON_NAME_TYPES = {"featureGrid": "features", "stepsProcess": "steps", "tabsAccordion": "items"}

_HEADING_KEYS = ("title", "headerText", "heading", "headline")


def _issue(code: str, severity: str, message: str, hint: str, component_id: Optional[str] = None) -> Dict[str, Any]:
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "hint": hint,
        **({"component_id": component_id} if component_id else {}),
    }


def _walk(components: List[Any]):
    """Yield every component, descending into columnLayout slots."""
    for comp in components or []:
        if not isinstance(comp, dict):
            continue
        yield comp
        slots = (comp.get("props") or {}).get("slots")
        if isinstance(slots, list):
            for slot in slots:
                if isinstance(slot, list):
                    yield from _walk(slot)


def _strings(node: Any, out: List[str], depth: int = 0) -> None:
    if depth > 6:
        return
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, dict):
        for v in node.values():
            _strings(v, out, depth + 1)
    elif isinstance(node, list):
        for v in node:
            _strings(v, out, depth + 1)


# Keys whose STRING values are data, not words a visitor reads: ids, links,
# colours, enum tokens. The learner's i18n uses the same rule (catalogue-i18n.ts:
# "keys ending in Color / Image / Mode … are never translated"). Only the plain
# string under such a key is skipped: an object or list under it (a link's
# label, an image's alt, a button under `secondaryAction`) is still read.
_NON_TEXT_KEY_RE = re.compile(
    r"^(?:id|ids|url|urls|route|target|href|link|src|image|images|icon|iconName|code|codes|slug|slugs|"
    r"color|colour|param|mode|variant|style|layout|kind|action|placement|showWhen)$"
    r"|[a-z0-9](?:Id|Ids|Url|Urls|Route|Target|Href|Link|Src|Image|Images|Icon|IconName|Code|Codes|Slug|Slugs|"
    r"Color|Colour|Param|Mode|Variant|Style|Layout|Kind|Action|Placement)$"
)


def text_values(node: Any, out: List[str], depth: int = 0, data: bool = False) -> None:
    """Like ``_strings`` but only the values a visitor reads (fidelity review).

    ``data``: the strings directly under this node sit under a data key."""
    if depth > 6 or node is None:
        return
    if isinstance(node, str):
        if not data:
            out.append(node)
    elif isinstance(node, dict):
        for k, v in node.items():
            text_values(v, out, depth + 1, isinstance(k, str) and bool(_NON_TEXT_KEY_RE.search(k)))
    elif isinstance(node, list):
        for v in node:
            text_values(v, out, depth + 1, data)


def _heading_of(props: Dict[str, Any]) -> Optional[str]:
    for key in _HEADING_KEYS:
        val = props.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    left = props.get("left")
    if isinstance(left, dict) and isinstance(left.get("title"), str) and left["title"].strip():
        return left["title"].strip()
    return None


def _relative_luminance(hex_color: str) -> Optional[float]:
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", hex_color.strip())
    if not m:
        return None
    r, g, b = (int(m.group(1)[i:i + 2], 16) / 255 for i in (0, 2, 4))

    def _lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def _contrast_ratio(fg: str, bg: str) -> Optional[float]:
    lf, lb = _relative_luminance(fg), _relative_luminance(bg)
    if lf is None or lb is None:
        return None
    hi, lo = max(lf, lb), min(lf, lb)
    return (hi + 0.05) / (lo + 0.05)


#: Codes of sections bound to no live data (product page / folder library).
UNBOUND_CODES = frozenset({"offer-unbound", "folders-unbound", "path-unbound"})


def bind_hint(code: str, component_id: Optional[str], list_mode: Optional[bool] = None,
              page_route: Optional[str] = None) -> Optional[str]:
    """
    The fix for an unbound section when the caller can edit the site (the
    assistant / MCP ``website_edit`` tool): bind it, never remove it — the
    design put it there. None for any other code.
    """
    sid = component_id or "<section id>"
    where = f", page_route='{page_route}'" if page_route else ""
    call = "website_edit(action='bind_data'" + where + ", section_id='" + sid + "', data_kind='{kind}', data_id=<{what}>)"
    library = call.format(kind="folderLibrary", what="a folder library id from website(action='context') folder_libraries")
    product = call.format(kind="productPage", what="a product page code from website(action='context')")
    if code == "offer-unbound":
        hint = product
    elif code == "folders-unbound":
        hint = library
    elif code == "path-unbound":
        hint = library if list_mode else product if list_mode is False else f"{library} (list mode) or {product}"
    else:
        return None
    return (f"Bind it with {hint}. Do not remove the section. If no suitable one exists, ask the admin to "
            "create it (Folders / Product pages in the dashboard) and leave the section in place.")


def audit_component(comp: Dict[str, Any], can_bind: bool = False, page_route: Optional[str] = None,
                    *, fidelity: bool = False) -> List[Dict[str, Any]]:
    """Defects decidable from ONE component, with no page context.

    Split out of audit_page so the section-variants endpoint can reject a bad
    alternative before the admin is asked to choose it — offering someone three
    options one of which renders blank is worse than offering two.

    ``can_bind``: the caller can bind live data (website_edit bind_data), so an
    unbound section's hint says how instead of "remove this component"
    (``page_route``: the page it is on, named in that hint).

    ``fidelity`` (a page built from a design): placeholder copy is looked for
    only in the text a visitor reads, not in ids, links or enum tokens."""
    issues: List[Dict[str, Any]] = []
    if not isinstance(comp, dict):
        return issues
    ctype = comp.get("type")
    cid = comp.get("id")
    props = comp.get("props") if isinstance(comp.get("props"), dict) else {}

    # 1. A list component with nothing in it renders as a blank band.
    list_key = _LIST_PROPS.get(ctype or "")
    if list_key is not None:
        items = props.get(list_key)
        if not isinstance(items, list) or not items:
            issues.append(_issue(
                "empty-section", "fix",
                f"'{ctype}' has an empty '{list_key}' list, so it renders as a blank band.",
                f"Fill props.{list_key} with real items drawn from the brief, or remove the component.",
                cid,
            ))

    # 2. A product offer bound to no product page shows nothing to visitors.
    if ctype == "productPageOffer" and not str(props.get("productPageCode") or "").strip():
        issues.append(_issue(
            "offer-unbound", "fix",
            "'productPageOffer' has no productPageCode, so the section is invisible to visitors.",
            bind_hint("offer-unbound", cid, page_route=page_route) if can_bind else
            "Remove this component — only an admin can pick the product page, so it cannot be "
            "generated. Use courseCatalog if the page needs a live listing.",
            cid,
        ))

    # 2b. Same for a folder browser with no library: the folders are the admin's.
    if ctype == "folderBrowser" and not str(props.get("libraryId") or "").strip():
        issues.append(_issue(
            "folders-unbound", "fix",
            "'folderBrowser' has no libraryId, so the section is invisible to visitors.",
            bind_hint("folders-unbound", cid, page_route=page_route) if can_bind else
            "Remove this component — only an admin can pick the folder library, so it cannot be "
            "generated. Use courseCatalog if the page needs a live listing.",
            cid,
        ))

    # 2c. A learning path bound to no product page (single) or library (list).
    if ctype == "learningPath":
        list_mode = str(props.get("mode") or "single") == "list"
        bound = str((props.get("libraryId") if list_mode else props.get("productPageCode")) or "").strip()
        if not bound:
            issues.append(_issue(
                "path-unbound", "fix",
                "'learningPath' has no " + ("libraryId" if list_mode else "productPageCode") + ", so the section is invisible to visitors.",
                bind_hint("path-unbound", cid, list_mode, page_route=page_route) if can_bind else
                "Remove this component — only an admin can pick the product page or folder library, so it cannot be generated.",
                cid,
            ))

    # 3. ctaBanner's renderer reads {heading, subheading, button}; without
    #    them it paints an empty coloured band.
    if ctype == "ctaBanner":
        button = props.get("button") if isinstance(props.get("button"), dict) else {}
        if not str(props.get("heading") or "").strip():
            issues.append(_issue("cta-no-heading", "fix",
                                 "'ctaBanner' has no heading — it renders as an empty coloured band.",
                                 "Set props.heading (and props.subheading) to a real call to action.", cid))
        if not str(button.get("text") or "").strip():
            issues.append(_issue("cta-no-button", "fix",
                                 "'ctaBanner' has no button text, so there is nothing to click.",
                                 "Set props.button {enabled:true, text, action, target}.", cid))

    # 4. A hero with no headline is the worst possible first impression.
    if ctype == "heroSection":
        left = props.get("left") if isinstance(props.get("left"), dict) else {}
        if not str(left.get("title") or props.get("title") or "").strip():
            issues.append(_issue("hero-no-headline", "fix",
                                 "The hero has no headline.",
                                 "Set props.left.title to a specific, benefit-led headline.", cid))
        right = props.get("right") if isinstance(props.get("right"), dict) else {}
        layout = str(props.get("layout") or "").lower()
        collage = right.get("imageCollage")
        if layout in ("split", "image-right", "image-left") and not str(right.get("image") or "").strip() \
                and not (isinstance(collage, list) and collage):
            issues.append(_issue(
                "hero-split-no-image", "fix",
                "The hero uses a split layout but has no image, so half the fold is empty.",
                "Either provide right.image from the supplied images, or switch props.layout to "
                "'centered' so the copy owns the full width.",
                cid,
            ))

    # 5. Emoji where the component has a real icon library field.
    icon_list_key = _ICON_NAME_TYPES.get(ctype or "")
    if icon_list_key:
        for item in (props.get(icon_list_key) or []):
            if not isinstance(item, dict):
                continue
            if not str(item.get("iconName") or "").strip() and _EMOJI_RE.search(str(item.get("icon") or "")):
                issues.append(_issue(
                    "emoji-icon", "fix",
                    f"'{ctype}' uses an emoji icon instead of the icon library.",
                    "Set iconName on each item (GraduationCap, Rocket, Target, Trophy, ShieldCheck, …) "
                    "and clear the emoji `icon` field.",
                    cid,
                ))
                break

    # 6. htmlBlock must re-theme and must be responsive (both are in the
    #    doctrine the model was given, and both are silent failures).
    if ctype == "htmlBlock":
        css = str(props.get("css") or "")
        if css and (_HEX_LITERAL_RE.search(css) or _RGB_LITERAL_RE.search(css)):
            issues.append(_issue(
                "html-hardcoded-color", "fix",
                "The custom HTML section hardcodes colours, so it will not follow the site theme.",
                "Replace every literal colour in props.css with theme variables: var(--primary-500), "
                "var(--catalogue-text-primary), var(--catalogue-bg), var(--catalogue-border).",
                cid,
            ))
        if css and "@media" not in css:
            issues.append(_issue(
                "html-not-responsive", "warn",
                "The custom HTML section has no mobile rules.",
                "Add an @media (max-width: 640px) block to props.css.",
                cid,
            ))

    # 7. Author-set colours that cannot be read. The threshold is WCAG AA for
    #    normal text (4.5:1), not the large-text 3.0:1 this started at — these
    #    components carry body copy, and a real generation shipped white on
    #    #4a90e2 at 3.29:1, which cleared the old bar while still failing AA.
    fg, bg = props.get("textColor"), props.get("backgroundColor")
    if isinstance(fg, str) and isinstance(bg, str):
        ratio = _contrast_ratio(fg, bg)
        if ratio is not None and ratio < 4.5:
            issues.append(_issue(
                "low-contrast", "fix",
                f"Text and background on '{ctype}' are too close to read (contrast {ratio:.1f}:1, "
                "below the 4.5:1 minimum for body text).",
                "Darken or lighten textColor until it clears 4.5:1 against backgroundColor, or drop both "
                "and let the theme decide.",
                cid,
            ))

    # 8. Placeholder copy that was never replaced.
    found: List[str] = []
    (text_values if fidelity else _strings)(props, found)
    for text in found:
        if _PLACEHOLDER_RE.search(text):
            issues.append(_issue(
                "placeholder-copy", "fix",
                f"'{ctype}' still contains placeholder text: \"{text.strip()[:60]}\".",
                "Replace it with real copy about this institute, drawn from the brief.",
                cid,
            ))
            break

    return issues


def audit_design_compare(compare: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Issues from website(action='compare') — the render measured against the design image
    itself, so section coverage and colours are exact rather than a vision pass's guesses."""
    issues: List[Dict[str, Any]] = []
    if not isinstance(compare, dict):
        return issues
    for miss in compare.get("missing_sections") or []:
        if not isinstance(miss, dict):
            continue
        hint = ((miss.get("hints") or [{}])[0] or {}).get("suggestion") or "Add a section for it."
        issues.append(_issue(
            "reference-section-missing", "fix",
            f"The design has '{miss.get('design_section')}' ({miss.get('design_height')}px, mostly "
            f"{miss.get('design_color')}) with no counterpart on the page.",
            hint,
        ))
    for sec in compare.get("sections") or []:
        if not isinstance(sec, dict):
            continue
        cid = sec.get("section_id") or None
        if sec.get("extra"):
            issues.append(_issue(
                "reference-section-extra", "warn",
                f"'{cid}' has no counterpart in the design.",
                "Remove it, or move it to where the design has it.", cid,
            ))
            continue
        for hint in sec.get("hints") or []:
            path = str((hint or {}).get("prop_path") or "")
            if path.endswith("backgroundColor"):
                issues.append(_issue("reference-colour-ignored", "warn", str(hint.get("suggestion")),
                                     f"Set {path} to \"{sec.get('design_color')}\".", cid))
        if sec.get("missing_text"):
            issues.append(_issue(
                "reference-text-missing", "warn",
                f"'{cid}' lacks design text: " + "; ".join(f'"{t[:60]}"' for t in sec["missing_text"][:4]) + ".",
                "Add it where the block has a prop for it (heading, button, item) — see this section's hints.", cid,
            ))
    return issues


def audit_reference_fidelity(
    page: Dict[str, Any],
    global_settings: Optional[Dict[str, Any]],
    inspiration: Dict[str, Any],
    theme_locked: bool = False,
    compare: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Did the page actually adopt the reference design it was given?

    audit_component answers "is this broken". Nothing answered "does this look
    like the thing the admin showed us", so the only detector was the admin
    opening the page and saying no — which is exactly how the last three rounds
    went. These checks are the mechanical part of that judgement: a sampled
    colour that never made it into the theme, a section role in the blueprint
    with no counterpart on the page, an `avoid` treatment used anyway. They are
    not taste; each one is a specific instruction that was handed over and
    dropped.

    ``compare``: a website(action='compare') result for this page; its exact
    section and colour findings are added (``audit_design_compare``).
    """
    issues: List[Dict[str, Any]] = audit_design_compare(compare) if compare else []
    if not isinstance(inspiration, dict) or not inspiration:
        return issues

    theme = (global_settings or {}).get("theme") if isinstance(global_settings, dict) else {}
    theme = theme if isinstance(theme, dict) else {}
    palette = inspiration.get("palette") if isinstance(inspiration.get("palette"), dict) else {}

    # theme_locked: the site keeps its own theme and the reference contributes
    # layout only — demanding its colour or canvas here would send the repair
    # pass to paint them back on. Section coverage still applies.
    want_primary = "" if theme_locked else str(palette.get("primary") or "").lower()
    got_primary = str(theme.get("primaryColor") or "").lower()
    if want_primary and got_primary and want_primary != got_primary:
        issues.append(_issue(
            "reference-colour-ignored", "warn",
            f"The reference's brand colour is {want_primary} but the page uses {got_primary}.",
            f"Set globalSettings.theme.primaryColor to \"{want_primary}\".",
        ))

    want_bg = "" if theme_locked else str(palette.get("background") or "").lower()
    if want_bg and want_bg not in ("#ffffff", "#fefefe") and not page.get("backgroundColor"):
        issues.append(_issue(
            "reference-canvas-ignored", "fix",
            f"The reference sits on {want_bg}, but this page is on the default white canvas.",
            f"Set page.backgroundColor to \"{want_bg}\".",
        ))

    # Section coverage. Roles the blueprint listed that have no plausible
    # counterpart on the page — the failure that produced a directory with no
    # social proof and no founder section from a reference that had both.
    role_components: Dict[str, set] = {
        "hero": {"heroSection"},
        "logos": {"logoCloud", "marquee"},
        "features": {"featureGrid", "detailBlocks", "tabsAccordion"},
        "stats": {"statsHighlights", "trustChip"},
        "steps": {"stepsProcess"},
        "courses": {"courseCatalog", "featureGrid", "detailBlocks", "productPageOffer", "folderBrowser", "learningPath", "bookCatalogue"},
        "testimonials": {"testimonialSection"},
        "faq": {"tabsAccordion", "faqSection"},
        "cta": {"ctaBanner", "leadForm", "contactForm", "newsletterSignup"},
        "gallery": {"imageGallery", "mediaShowcase"},
        "team": {"teamSection", "mediaShowcase"},
        "pricing": {"pricingTable"},
        "contact": {"contactForm", "leadForm", "mapEmbed"},
        "about": {"textBlock", "mediaShowcase", "columnLayout", "detailBlocks"},
        "video": {"videoEmbed", "mediaShowcase"},
    }
    present = {c.get("type") for c in _walk(page.get("components") or [])}
    sections = inspiration.get("sections") if isinstance(inspiration.get("sections"), list) else []
    missing: List[str] = []
    for entry in sections:
        if not isinstance(entry, dict):
            continue
        role = str(entry.get("role") or "").lower()
        allowed = role_components.get(role)
        if allowed and not (allowed & present) and role not in missing:
            missing.append(role)
    if missing:
        # Advisory: the institute may simply have no content for a band (real
        # testimonials cannot be invented, and should not be).
        issues.append(_issue(
            "reference-section-missing", "warn",
            "The reference has " + ", ".join(missing) + " but the page has no equivalent section.",
            "Add it if the brief supplies real content for it — never invent quotes, names or "
            "statistics to fill one.",
        ))

    # Treatments the reference explicitly rules out.
    avoid = inspiration.get("avoid") if isinstance(inspiration.get("avoid"), list) else []
    avoid_text = " ".join(str(a).lower() for a in avoid)
    if avoid_text:
        used_gradient = any(
            isinstance((c.get("style") or {}).get("backgroundLayers"), list)
            and (c.get("style") or {}).get("backgroundLayers")
            for c in _walk(page.get("components") or [])
        )
        if used_gradient and "gradient" in avoid_text:
            issues.append(_issue(
                "reference-avoid-violated", "warn",
                "The reference avoids gradients, but a section uses a gradient background layer.",
                "Replace style.backgroundLayers with a flat backgroundColor.",
            ))
        blurred = any(
            o.get("preset") in ("glow-orb", "blob")
            for c in _walk(page.get("components") or [])
            for o in ((c.get("style") or {}).get("ornaments") or [])
        )
        if blurred and ("gradient" in avoid_text or "glow" in avoid_text or "shadow" in avoid_text):
            issues.append(_issue(
                "reference-avoid-violated", "warn",
                "The reference avoids soft/blurred decoration, but the page uses glow-orb or blob ornaments.",
                "Use the 'circles-playful' or 'circles-corner' ornament preset, or no ornament at all.",
            ))

    return issues


def audit_page(
    page: Dict[str, Any],
    global_settings: Optional[Dict[str, Any]] = None,
    *,
    page_type: str = "homepage",
    info_only: bool = False,
    inspiration: Optional[Dict[str, Any]] = None,
    fidelity: bool = False,
    can_bind: bool = False,
) -> List[Dict[str, Any]]:
    """Return the visible defects in a composed page, worst kind first.

    ``fidelity``: the page reproduces a design (page meta ``designSource``),
    so the length advice is dropped and a heading a design deliberately
    repeats on learningPath sections (a featured path, then "more paths" —
    adjacent or not; every section sharing the heading must be a learningPath)
    is not a duplicate. Every defect a visitor would see still counts.

    ``can_bind``: see audit_component (the in-product composer leaves it off).
    """
    issues: List[Dict[str, Any]] = []
    components = [c for c in _walk(page.get("components") or [])]
    if not components:
        return [_issue("empty-page", "fix", "The page has no components at all.",
                       "Compose the page again from the brief.")]

    types = [c.get("type") for c in components]
    headings: Dict[str, List[str]] = {}

    heading_types: Dict[str, set] = {}
    for comp in components:
        issues.extend(audit_component(comp, can_bind=can_bind, page_route=page.get("route") if can_bind else None,
                                      fidelity=fidelity))
        props = comp.get("props") if isinstance(comp.get("props"), dict) else {}
        heading = _heading_of(props)
        if heading:
            key = re.sub(r"\W+", " ", heading.lower()).strip()
            headings.setdefault(key, []).append(comp.get("id") or comp.get("type") or "?")
            heading_types.setdefault(key, set()).add(comp.get("type"))

    # 9. The same heading twice reads as a bug, not a design.
    for text, ids in headings.items():
        if fidelity and heading_types.get(text) == {"learningPath"}:
            continue
        if len(ids) > 1 and len(text) > 3:
            issues.append(_issue(
                "duplicate-heading", "fix",
                f"The heading \"{text}\" appears on {len(ids)} sections ({', '.join(ids[:3])}).",
                "Give each section its own heading, or drop the repeated one.",
            ))

    # 10. Commerce on a page the brief said was informational.
    if info_only:
        offenders = sorted({t for t in types if t in _COMMERCE_TYPES})
        if offenders:
            issues.append(_issue(
                "commerce-on-info-page", "fix",
                f"This page is informational but contains {', '.join(offenders)}.",
                "Remove the pricing/enrolment components — the brief asked for information only.",
            ))

    # 11. Nothing to act on. Not applicable to reference pages, which exist to
    #     inform; the archetype rules already forbid commerce there.
    elif page_type not in ("courses", "policy"):
        has_conversion = any(t in _CONVERSION_TYPES for t in types)
        if not has_conversion:
            actions: List[str] = []
            for comp in components:
                _strings((comp.get("props") or {}).get("buttons") or (comp.get("props") or {}).get("button"), actions)
            has_conversion = any(a in _CONVERSION_ACTIONS for a in actions)
        if not has_conversion:
            issues.append(_issue(
                "no-conversion", "fix",
                "The page gives a visitor nothing to do — no CTA, form or catalogue.",
                "Add a ctaBanner near the end, or a leadForm if the page should capture enquiries.",
            ))

    # 12. A reference design that opens on content must not be given a hero.
    ref_sections = (inspiration or {}).get("sections")
    if isinstance(ref_sections, list) and ref_sections:
        roles = [str(s.get("role") or "") for s in ref_sections if isinstance(s, dict)]
        if "hero" not in roles and "heroSection" in types:
            issues.append(_issue(
                "hero-against-reference", "warn",
                "The reference design opens straight into content, but this page opens with a hero.",
                "Drop the heroSection and lead with the first content section, as the reference does.",
            ))

    # 13. Length. Advisory only — the archetype governs the real target.
    #     Not in fidelity mode: the design decides how long the page is.
    top_level = len(page.get("components") or [])
    if not fidelity and top_level < 4:
        issues.append(_issue("too-short", "warn", f"Only {top_level} sections — the page will feel thin.",
                             "Add sections the brief supports."))
    elif not fidelity and top_level > 16:
        issues.append(_issue("too-long", "warn", f"{top_level} sections is more than a visitor will scroll.",
                             "Merge or drop the weakest sections."))

    order = {"fix": 0, "warn": 1}
    return sorted(issues, key=lambda i: order.get(i["severity"], 2))
