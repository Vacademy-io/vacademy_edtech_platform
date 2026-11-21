"""
Compact, model-facing views of a catalogue (website) JSON.

A catalogue is the JSON the website builder edits and the learner app renders:

    {"globalSettings": {...}, "pages": [{"id", "route", "title", "seo", "components": [...]}]}

It can be megabytes (imported HTML sites), so nothing here ever hands the raw
blob back. Instead these helpers answer the questions an AI assistant is asked:

  * what is on this page, in order, and where does each block's DATA come from
    (which campaign a form feeds, which courses a strip shows);
  * where are the lead-capture surfaces and are they wired to a campaign;
  * what would the dashboard warn about before publishing.

Pure functions, no I/O — the tool executors fetch, these summarise. The publish
checks and component labels are ports of
``frontend-admin-dashboard/src/routes/manage-pages/-utils/{publish-checks,component-labels}.ts``;
change one, change the other.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, Iterator, List, Optional, Tuple
from urllib.parse import quote

# ── labels (port of component-labels.ts) ────────────────────────────────
COMPONENT_LABELS: Dict[str, str] = {
    "header": "Header",
    "footer": "Footer",
    "heroSection": "Hero Section",
    "detailBlocks": "Program Blocks",
    "featureGrid": "Feature Grid",
    "courseCatalog": "Course Catalog",
    "bookCatalogue": "Book Catalogue",
    "productPageOffer": "Product Page Offer",
    "folderBrowser": "Folder Browser",
    "learningPath": "Learning Path",
    "productCourseGrid": "Course Grid (full catalogue)",
    "mediaShowcase": "Media Showcase",
    "courseShowcase": "Course showcase",
    "statsHighlights": "Stats",
    "testimonialSection": "Testimonials",
    "cartComponent": "Cart",
    "buyRentSection": "Buy / Rent",
    "policyRenderer": "Policy",
    "courseDetails": "Course Details",
    "bookDetails": "Book Details",
    "faqSection": "FAQ",
    "videoEmbed": "Video Embed",
    "documentViewer": "Document Viewer",
    "ctaBanner": "CTA Banner",
    "pricingTable": "Pricing Table",
    "contactForm": "Contact Form",
    "leadForm": "Lead Form",
    "teamSection": "Team",
    "announcementFeed": "Announcements",
    "jobOpenings": "Job Openings",
    "imageGallery": "Image Gallery",
    "columnLayout": "Column Layout",
    "htmlBlock": "Custom HTML",
    "htmlPage": "HTML Page",
    "newsletterSignup": "Newsletter Signup",
    "stepsProcess": "Steps / Process",
    "logoCloud": "Logo Cloud",
    "tabsAccordion": "Tabs / Accordion",
    "mapEmbed": "Map Embed",
    "countdownTimer": "Countdown Timer",
    "textBlock": "Text Block",
    "imageBlock": "Image Block",
    "buttonBlock": "Button",
    "sectionHeading": "Section Heading",
    "trustChip": "Trust Chip",
    "marquee": "Marquee",
    "spacer": "Spacer",
}

#: Blocks whose content comes from live institute data rather than authored props.
LIVE_DATA_TYPES = frozenset({
    "courseCatalog", "productCourseGrid", "courseShowcase", "productPageOffer", "folderBrowser", "learningPath",
    "courseDetails", "bookCatalogue", "bookDetails", "announcementFeed", "leadForm",
})

#: Blocks that capture a visitor's details.
CAPTURE_TYPES = frozenset({"leadForm", "contactForm", "newsletterSignup"})


def job_slug(text: Any) -> str:
    """A jobOpenings job's URL slug: "Educator Vacancy (NEET)" -> "educator-vacancy-neet".

    Letters, marks and digits of any script are kept, every other run becomes
    one "-". Mirrors slugifyJobTitle in the learner's -utils/job-openings.ts
    (and the editor's jobs/job-templates.ts): a job's page lives at
    /<page>/<slug>, so all three must agree."""
    s = unicodedata.normalize("NFKC", str(text or "")).lower()
    out: List[str] = []
    for ch in s:
        if unicodedata.category(ch)[:1] in ("L", "M", "N"):
            out.append(ch)
        elif not out or out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-")[:80].rstrip("-")


def component_label(comp_type: Any) -> str:
    """Friendly name for a component type, with a camelCase fallback."""
    t = str(comp_type or "")
    if t in COMPONENT_LABELS:
        return COMPONENT_LABELS[t]
    spaced = re.sub(r"([A-Z])", r" \1", t).strip()
    return spaced[:1].upper() + spaced[1:] if spaced else "Block"


# ── tree helpers ─────────────────────────────────────────────────────────
_TAG_RE = re.compile(r"<[^>]*>")
_WS_RE = re.compile(r"\s+")


def strip_html(value: Any, cap: int = 160) -> str:
    if not isinstance(value, str):
        return ""
    text = _WS_RE.sub(" ", _TAG_RE.sub(" ", value).replace("&nbsp;", " ")).strip()
    return text if len(text) <= cap else text[: cap - 1] + "…"


def walk_components(components: Any) -> Iterator[Dict[str, Any]]:
    """Every component in document order, descending into columnLayout slots."""
    for c in components or []:
        if not isinstance(c, dict):
            continue
        yield c
        slots = (c.get("props") or {}).get("slots")
        if isinstance(slots, list):
            for slot in slots:
                if isinstance(slot, list):
                    yield from walk_components(slot)


def _collect_strings(node: Any, out: List[str], depth: int = 0) -> None:
    if depth > 6 or node is None:
        return
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, list):
        for v in node:
            _collect_strings(v, out, depth + 1)
    elif isinstance(node, dict):
        for v in node.values():
            _collect_strings(v, out, depth + 1)


def heading_of(comp: Dict[str, Any]) -> str:
    """The one line an admin would use to point at this block."""
    p = comp.get("props") or {}
    for key in ("title", "heading", "headerText", "headline", "text"):
        v = p.get(key)
        if isinstance(v, str) and v.strip():
            return strip_html(v, 120)
    left = p.get("left") if isinstance(p.get("left"), dict) else {}
    for key in ("title", "subheading"):
        v = left.get(key)
        if isinstance(v, str) and v.strip():
            return strip_html(v, 120)
    if isinstance(p.get("content"), str):
        return strip_html(p["content"], 120)
    if comp.get("type") == "header" and isinstance(p.get("title"), str):
        return strip_html(p["title"], 120)
    return ""


# ── capture surfaces & data bindings ─────────────────────────────────────
_HTML_LEAD_HOOK_RE = re.compile(
    r"<(?:a|button)\b(?=[^>]*data-vacademy=[\"']lead-form[\"'])[^>]*>(?P<body>.*?)</(?:a|button)\s*>", re.I | re.S)
_HTML_AUDIENCE_RE = re.compile(r"data-audience=[\"']([^\"']*)[\"']", re.I)
_HTML_HEADING_RE = re.compile(r"<h[12]\b[^>]*>(.*?)</h[12]\s*>", re.I | re.S)
def _campaign_text(audience_id: Any, audience_name: Any, campaign_names: Optional[Dict[str, str]] = None) -> str:
    aid = str(audience_id or "").strip()
    if not aid:
        return "NO campaign selected"
    # Buttons and header links store only the id; the name comes from the
    # institute's campaign list when the caller supplies it.
    name = str(audience_name or "").strip() or str((campaign_names or {}).get(aid) or "").strip()
    return f'campaign "{name}" ({aid})' if name else f"campaign {aid}"


def capture_surfaces(comp: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Every place in ONE component that opens or embeds a lead-capture form.

    Returns ``{kind, path, label, audience_id, audience_name}`` per surface, where
    ``path`` is the prop path a write tool would set (e.g. ``props.audienceId``,
    ``props.left.buttons[0].audienceId``).
    """
    p = comp.get("props") or {}
    ctype = comp.get("type")
    out: List[Dict[str, Any]] = []

    if ctype == "htmlPage":
        # <a data-vacademy="lead-form" data-audience="…"> hooks inside the HTML.
        for i, m in enumerate(_HTML_LEAD_HOOK_RE.finditer(str(p.get("html") or ""))):
            tag = m.group(0)
            aud = _HTML_AUDIENCE_RE.search(tag)
            label = strip_html(m.group("body"), 40) or "Enquiry button"
            out.append({
                "kind": "html_hook", "path": f"html.lead-form[{i}]", "label": label,
                "audience_id": (aud.group(1) if aud else "").strip(), "audience_name": "", "required": True,
            })
        return out

    if ctype in CAPTURE_TYPES:
        out.append({
            "kind": "form_section",
            "path": "props.audienceId",
            "label": component_label(ctype),
            "audience_id": str(p.get("audienceId") or "").strip(),
            "audience_name": str(p.get("audienceName") or "").strip(),
            # contactForm / newsletterSignup fall back to the auto "website leads"
            # list; a leadForm renders nothing without a campaign.
            "required": ctype == "leadForm",
        })

    # Header "Enquire now"-style links that open a popup form.
    for i, link in enumerate(p.get("authLinks") or []):
        if isinstance(link, dict) and str(link.get("audienceId") or "").strip():
            out.append({
                "kind": "header_link", "path": f"props.authLinks[{i}].audienceId",
                "label": str(link.get("label") or "Header link"),
                "audience_id": str(link.get("audienceId") or "").strip(),
                "audience_name": "", "required": True,
            })

    # Buttons with action=openForm: hero (props.left.buttons[]), ctaBanner /
    # mediaShowcase / buttonBlock (props.button), plus a bare props.action.
    left = p.get("left") if isinstance(p.get("left"), dict) else {}
    for i, b in enumerate(left.get("buttons") or []):
        if isinstance(b, dict) and b.get("action") == "openForm":
            out.append({
                "kind": "button", "path": f"props.left.buttons[{i}].audienceId",
                "label": str(b.get("text") or b.get("label") or "Button"),
                "audience_id": str(b.get("audienceId") or "").strip(),
                "audience_name": "", "required": True,
            })
    button = p.get("button") if isinstance(p.get("button"), dict) else None
    if button and button.get("action") == "openForm":
        out.append({
            "kind": "button", "path": "props.button.audienceId",
            "label": str(button.get("text") or "Button"),
            "audience_id": str(button.get("audienceId") or "").strip(),
            "audience_name": "", "required": True,
        })
    if p.get("action") == "openForm" and ctype not in CAPTURE_TYPES:
        out.append({
            "kind": "button", "path": "props.audienceId",
            "label": str(p.get("text") or p.get("label") or component_label(ctype)),
            "audience_id": str(p.get("audienceId") or "").strip(),
            "audience_name": "", "required": True,
        })
    out.extend(_widget_capture_surfaces(comp))
    return out


def _band_secondary_button(comp: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """ctaBanner variant 'band' draws props.secondaryButton when it is enabled and has text."""
    p = comp.get("props") or {}
    b = p.get("secondaryButton")
    if comp.get("type") != "ctaBanner" or p.get("variant") != "band" or not isinstance(b, dict):
        return None
    return b if b.get("enabled", True) is not False and str(b.get("text") or "").strip() else None


def _widget_capture_surfaces(comp: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Forms inside the opt-in widgets: a band's second button, the brand
    footer's newsletter, a learning path's coming-soon steps and the catalogue's
    in-grid sections (spotlight button / steps, coming-soon shelf). A component
    that sets none of these props yields nothing, so older sites are unchanged.
    """
    p = comp.get("props") or {}
    ctype = comp.get("type")
    out: List[Dict[str, Any]] = []

    second = _band_secondary_button(comp)
    if second and second.get("action") == "openForm":
        out.append({
            "kind": "button", "path": "props.secondaryButton.audienceId",
            "label": str(second.get("text") or "Second button"),
            "audience_id": str(second.get("audienceId") or "").strip(),
            "audience_name": "", "required": True,
        })

    # Brand footer newsletter (renders when present and not enabled:false);
    # without a campaign it falls back to the auto list, like newsletterSignup.
    news = p.get("newsletter") if isinstance(p.get("newsletter"), dict) else None
    if ctype == "footer" and p.get("variant") == "brand" and news and news.get("enabled") is not False:
        out.append({
            "kind": "form_section", "path": "props.newsletter.audienceId", "name_path": "props.newsletter.audienceName",
            "label": "Footer newsletter",
            "audience_id": str(news.get("audienceId") or "").strip(),
            "audience_name": str(news.get("audienceName") or "").strip(), "required": False,
        })

    # learningPath: a coming-soon step's "Notify me" (inert without a campaign).
    if ctype == "learningPath":
        for i, extra in enumerate(p.get("pathExtras") or []):
            if not isinstance(extra, dict):
                continue
            for j, step in enumerate(extra.get("comingSoon") or []):
                if isinstance(step, dict) and str(step.get("title") or "").strip():
                    out.append({
                        "kind": "notify_step", "path": f"props.pathExtras[{i}].comingSoon[{j}].audienceId",
                        "label": f"Coming soon: {str(step['title']).strip()[:60]}",
                        "audience_id": str(step.get("audienceId") or "").strip(),
                        "audience_name": "", "required": False,
                    })

    # courseCatalog in-grid sections.
    if ctype == "courseCatalog":
        for i, section in enumerate(p.get("columnSections") or []):
            if not isinstance(section, dict):
                continue
            if section.get("kind") == "spotlight":
                for j, slide in enumerate(section.get("slides") or []):
                    if not isinstance(slide, dict):
                        continue
                    cta = slide.get("cta") if isinstance(slide.get("cta"), dict) else None
                    # An 'open-form' button with no campaign is not drawn at all.
                    if cta and cta.get("action") == "open-form":
                        out.append({
                            "kind": "button", "path": f"props.columnSections[{i}].slides[{j}].cta.audienceId",
                            "label": str(cta.get("label") or slide.get("title") or "Spotlight button"),
                            "audience_id": str(cta.get("audienceId") or "").strip(),
                            "audience_name": "", "required": True, "hidden_until_wired": True,
                        })
                    for k, step in enumerate(slide.get("steps") or []):
                        # A step is a form button only once it has a campaign; otherwise a link or text.
                        if isinstance(step, dict) and str(step.get("audienceId") or "").strip():
                            out.append({
                                "kind": "button", "path": f"props.columnSections[{i}].slides[{j}].steps[{k}].audienceId",
                                "label": str(step.get("title") or "Spotlight step"),
                                "audience_id": str(step["audienceId"]).strip(),
                                "audience_name": "", "required": False,
                            })
            elif section.get("kind") == "coming-soon":
                # Each card's "Notify me" uses ITS category's campaign in the
                # folder library, so there is no page prop to wire here.
                out.append({
                    "kind": "folder_notify", "path": "",
                    "label": str(section.get("title") or "Coming soon") + " (Notify me)",
                    "audience_id": "", "audience_name": "", "required": False,
                    "bound_in": "folder library: each coming-soon category's own campaign",
                })
    for s in out:
        if s["path"]:
            s["surface_path"] = s["path"]
    return out


def data_binding(comp: Dict[str, Any], campaign_names: Optional[Dict[str, str]] = None) -> Optional[str]:
    """Plain-language 'where this block's data comes from', or None for authored blocks."""
    p = comp.get("props") or {}
    t = comp.get("type")
    if t in ("courseCatalog", "productCourseGrid"):
        filters = [f.get("label") or f.get("field") for f in (p.get("filtersConfig") or []) if isinstance(f, dict)]
        extra = f", filters: {', '.join(map(str, filters))}" if filters and p.get("showFilters", True) else ""
        return f"every course in the institute (live){extra}"
    if t == "courseShowcase":
        source = str(p.get("source") or "newest")
        limit = p.get("limit")
        detail = {
            "newest": "newest courses",
            "onSale": "courses on sale",
            "tag": f'courses tagged "{p.get("tag") or ""}"',
            "picked": f"{len(p.get('courseIds') or [])} hand-picked courses",
            "comingSoon": "coming-soon courses",
        }.get(source, source)
        return f"{detail} (live){f', limit {limit}' if limit else ''}"
    if t == "productPageOffer":
        code = str(p.get("productPageCode") or "").strip()
        name = str(p.get("productPageName") or "").strip()
        if not code:
            return "product page: NONE selected (section hidden from visitors)"
        cart = ", multi-course basket ON" if p.get("enableCart") else ""
        return f'courses from product page "{name or code}" (code {code}, live){cart}'
    if t == "folderBrowser":
        lib = str(p.get("libraryId") or "").strip()
        name = str(p.get("libraryName") or "").strip()
        if not lib:
            return "folder library: NONE selected (section hidden from visitors)"
        start = " from a chosen folder" if str(p.get("rootFolderId") or "").strip() else ""
        return f'folders from library "{name or lib}"{start} (live; product pages inside show their courses)'
    if t == "learningPath":
        if str(p.get("mode") or "single") == "list":
            lib = str(p.get("libraryId") or "").strip()
            if not lib:
                return "learning paths: NO folder library selected (section hidden from visitors)"
            return f'learning paths from folder library "{str(p.get("libraryName") or lib)}" (live)'
        code = str(p.get("productPageCode") or "").strip()
        if not code:
            return "learning path: NO product page selected (section hidden from visitors)"
        return f'learning path = product page "{str(p.get("productPageName") or code)}" in step order (live)'
    if t == "courseDetails":
        return "the selected course's details (live)"
    if t in ("bookCatalogue", "bookDetails"):
        return "books for sale (live)"
    if t == "announcementFeed":
        return "latest announcements (live)"
    if t == "htmlPage":
        hooks = capture_surfaces(comp)
        if not hooks:
            return "static HTML page (no enquiry buttons)"
        return "static HTML page; " + "; ".join(
            f'"{h["label"]}" opens a form → {_campaign_text(h["audience_id"], "", campaign_names)}' for h in hooks[:4])
    if t in CAPTURE_TYPES:
        surfaces = capture_surfaces(comp)
        s = surfaces[0] if surfaces else {}
        text = _campaign_text(s.get("audience_id"), s.get("audience_name"), campaign_names)
        if t == "leadForm":
            return f"embeds {text}; fields come from that campaign"
        if not s.get("audience_id"):
            return "submits to the auto 'Course Catalogue Leads' list (no campaign chosen)"
        return f"submits to {text}"
    buttons = [s for s in capture_surfaces(comp) if s["kind"] != "form_section"]
    if buttons:
        return "; ".join(
            f'"{b["label"]}" opens a form → {_campaign_text(b["audience_id"], b["audience_name"], campaign_names)}'
            for b in buttons
        )
    return None


# ── page & site summaries ────────────────────────────────────────────────
_IMAGE_KEYS = {"image", "src", "logo", "avatar", "photo", "backgroundimage", "posterimage", "thumbnail"}
_LIST_KEYS = ("features", "stats", "testimonials", "faqs", "items", "steps", "members", "logos", "images", "blocks",
              "cards", "plans", "links", "navigation", "tabs", "jobs")


def _count_images(node: Any, depth: int = 0) -> int:
    if depth > 6:
        return 0
    if isinstance(node, dict):
        n = 0
        for k, v in node.items():
            if isinstance(v, str) and k.lower() in _IMAGE_KEYS and v.startswith("http"):
                n += 1
            else:
                n += _count_images(v, depth + 1)
        return n
    if isinstance(node, list):
        return sum(_count_images(v, depth + 1) for v in node)
    return 0


def visual_summary(comp: Dict[str, Any]) -> str:
    """
    One line saying what a section LOOKS like — what an admin describes when
    they point at a screenshot: "orange band, full width, 3 cards, 1 image".
    """
    p = comp.get("props") or {}
    style = comp.get("style") if isinstance(comp.get("style"), dict) else {}
    bits: List[str] = []
    bg = style.get("backgroundColor") or p.get("backgroundColor")
    layers = style.get("backgroundLayers")
    if isinstance(layers, list) and layers:
        bits.append("gradient band")
    elif isinstance(bg, str) and bg.strip():
        bits.append(f"band {bg.strip().upper()}")
    else:
        bits.append("plain background")
    layout = p.get("layout") if isinstance(p.get("layout"), str) else None
    if layout:
        bits.append(f"layout {layout}")
    width = (style.get("layout") or {}).get("width") if isinstance(style.get("layout"), dict) else None
    if width:
        bits.append(f"{width} width")
    if p.get("columns"):
        bits.append(f"{p['columns']} columns")
    for key in _LIST_KEYS:
        v = p.get(key)
        if isinstance(v, list) and v:
            bits.append(f"{len(v)} {key}")
            break
    imgs = _count_images(p)
    if imgs:
        bits.append(f"{imgs} image{'s' if imgs > 1 else ''}")
    buttons = []
    left = p.get("left") if isinstance(p.get("left"), dict) else {}
    for b in (list(left.get("buttons") or []) + ([left["button"]] if isinstance(left.get("button"), dict) else [])
              + ([p["button"]] if isinstance(p.get("button"), dict) else [])):
        if isinstance(b, dict) and (b.get("text") or b.get("label")):
            buttons.append(str(b.get("text") or b.get("label")))
    if buttons:
        bits.append("buttons: " + " / ".join(f'"{b}"' for b in buttons[:3]))
    if style.get("ornaments"):
        bits.append("ornaments")
    if style.get("dividers"):
        bits.append("shaped edges")
    if style.get("minHeight"):
        bits.append(f"min height {style['minHeight']}")
    return ", ".join(bits)


def summarize_component(comp: Dict[str, Any], include_copy: bool = False, copy_cap: int = 400,
                        campaign_names: Optional[Dict[str, str]] = None, position: Optional[int] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "id": comp.get("id"),
        "type": comp.get("type"),
        "label": component_label(comp.get("type")),
    }
    if position is not None:
        out["position"] = position
    if comp.get("enabled") is False:
        out["enabled"] = False
    heading = heading_of(comp)
    if heading:
        out["heading"] = heading
    binding = data_binding(comp, campaign_names)
    if binding:
        out["data_binding"] = binding
    if comp.get("type") != "htmlPage":
        out["looks"] = visual_summary(comp)
    if comp.get("anchorId"):
        out["anchor"] = f"#{comp['anchorId']}"
    if comp.get("type") == "htmlPage":
        p = comp.get("props") or {}
        html = str(p.get("html") or "")
        out["html_bytes"] = len(html)
        out["css_bytes"] = len(str(p.get("css") or ""))
        out["headings"] = [strip_html(h, 80) for h in _HTML_HEADING_RE.findall(html)[:6]]
        if not out.get("heading") and out["headings"]:
            out["heading"] = out["headings"][0]
        return out   # never dump the HTML itself, even with include_copy
    if include_copy:
        strings: List[str] = []
        _collect_strings(comp.get("props") or {}, strings)
        # Keep prose, drop ids/urls/colours/enums. Cap the total so a page with
        # a pasted brochure cannot flood the context.
        prose = [strip_html(s, copy_cap) for s in strings
                 if len(s) > 24 and not re.match(r"^(#|https?:|[a-z0-9-]+$)", s.strip(), re.I)]
        if prose:
            joined: List[str] = []
            budget = copy_cap * 3
            for s in prose:
                if budget <= 0:
                    joined.append("…")
                    break
                joined.append(s)
                budget -= len(s)
            out["copy"] = joined
    return out


def summarize_page(page: Dict[str, Any], include_copy: bool = False,
                   campaign_names: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    comps = [summarize_component(c, include_copy, campaign_names=campaign_names, position=i + 1)
             for i, c in enumerate(walk_components(page.get("components")))]
    seo = page.get("seo") or {}
    out: Dict[str, Any] = {
        "id": page.get("id"),
        "route": page.get("route"),
        "title": page.get("title"),
        "section_count": len(comps),
        "sections": comps,
    }
    if seo.get("metaTitle") or seo.get("metaDescription"):
        out["seo"] = {k: v for k, v in {"meta_title": seo.get("metaTitle"),
                                        "meta_description": seo.get("metaDescription")}.items() if v}
    if page.get("hideSiteChrome"):
        out["hide_site_chrome"] = True
    return out


def summarize_global_settings(gs: Dict[str, Any]) -> Dict[str, Any]:
    gs = gs if isinstance(gs, dict) else {}
    theme = gs.get("theme") or {}
    fonts = gs.get("fonts") or {}
    lead = gs.get("leadCollection") or {}
    out: Dict[str, Any] = {
        "mode": gs.get("mode"),
        "theme": {k: v for k, v in {
            "preset": theme.get("preset"),
            "primary_color": theme.get("primaryColor"),
            "border_radius": theme.get("borderRadius"),
            "heading_scale": theme.get("headingScale"),
            "atmosphere": theme.get("atmosphere"),
        }.items() if v},
        "fonts": {k: v for k, v in {"body": fonts.get("family"), "heading": fonts.get("headingFamily")}.items() if v}
        if fonts.get("enabled", True) else {},
        "audience": gs.get("audience"),
        "motion": (gs.get("motion") or {}).get("personality"),
        "site_wide_lead_popup": {
            "enabled": bool(lead.get("enabled")),
            "mandatory": bool(lead.get("mandatory")),
        } if lead else None,
        "payment_enabled": bool((gs.get("payment") or {}).get("enabled")),
        "course_finder_enabled": bool((gs.get("courseFinder") or {}).get("enabled")),
    }
    if isinstance(gs.get("brandProfile"), dict):
        out["brand_profile"] = gs["brandProfile"]
    out.update(_design_settings_summary(gs, theme))
    return {k: v for k, v in out.items() if v not in (None, {}, "")}


def _design_settings_summary(gs: Dict[str, Any], theme: Dict[str, Any]) -> Dict[str, Any]:
    """
    The opt-in settings a design-led site carries (palette, content width,
    course formats / languages, naming, site cart, languages) — only the ones
    the site actually has, so a site without them summarises exactly as before.
    """
    out: Dict[str, Any] = {}
    palette = theme.get("palette") if isinstance(theme, dict) else None
    if isinstance(palette, dict) and palette:
        out["palette"] = palette
    if isinstance(theme, dict) and theme.get("contentMaxWidth"):
        out["content_max_width"] = theme["contentMaxWidth"]
    formats = gs.get("courseFormats")
    if isinstance(formats, dict) and formats:
        order = [str(k).lower() for k in gs.get("courseFormatOrder") or [] if isinstance(k, str)]
        keys = sorted(formats, key=lambda k: order.index(str(k).lower()) if str(k).lower() in order else len(order))
        out["course_formats"] = [{k2: v2 for k2, v2 in {
            "key": k, "label": (formats[k] or {}).get("label") if isinstance(formats[k], dict) else None,
            "levels": (formats[k] or {}).get("levels") if isinstance(formats[k], dict) else None,
            "tags": (formats[k] or {}).get("tags") if isinstance(formats[k], dict) else None,
        }.items() if v2} for k in keys][:20]
    langs = gs.get("courseLanguages")
    if isinstance(langs, dict) and langs:
        out["course_languages"] = {k: v for k, v in {
            "enabled": bool(langs.get("enabled")),
            "languages": [str(l.get("code")) for l in langs.get("languages") or [] if isinstance(l, dict)] or None,
            "version_groups": len(langs.get("versionGroups") or []) or None,
        }.items() if v is not None}
    naming = gs.get("naming")
    if isinstance(naming, dict) and naming:
        out["naming"] = {k: v for k, v in naming.items() if isinstance(v, str) and v}
    cart = gs.get("siteCart")
    if isinstance(cart, dict) and cart:
        out["site_cart"] = {k: v for k, v in {
            "enabled": bool(cart.get("enabled")),
            "store_product_page_code": cart.get("storeProductPageCode"),
            "store_product_page_name": cart.get("storeProductPageName"),
        }.items() if v not in (None, "")}
    i18n = gs.get("i18n")
    if isinstance(i18n, dict) and i18n:
        strings = i18n.get("strings") if isinstance(i18n.get("strings"), dict) else {}
        out["languages"] = {
            "enabled": bool(i18n.get("enabled")),
            "base": str(i18n.get("defaultLocale") or "en"),
            "offered": [str(l.get("code")) for l in i18n.get("locales") or [] if isinstance(l, dict) and l.get("code")],
            "translations": {k: len(v) for k, v in strings.items() if isinstance(v, dict)},
        }
    return out


def find_page(config: Dict[str, Any], route_or_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Page by route (leading slash optional, case-insensitive) or by id; first page when blank."""
    pages = [p for p in (config.get("pages") or []) if isinstance(p, dict)]
    if not pages:
        return None
    key = str(route_or_id or "").strip()
    if not key:
        return pages[0]
    norm = key.lstrip("/").lower()
    for p in pages:
        if str(p.get("route") or "").lstrip("/").lower() == norm or str(p.get("id") or "") == key:
            return p
    return None


def find_component(page: Dict[str, Any], component_id: str) -> Optional[Dict[str, Any]]:
    for c in walk_components(page.get("components")):
        if str(c.get("id") or "") == str(component_id):
            return c
    return None


def _walk_strings(node: Any, path: str, out: List[Tuple[str, str]], depth: int = 0) -> None:
    if depth > 7 or node is None:
        return
    if isinstance(node, str):
        out.append((path, node))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _walk_strings(v, f"{path}[{i}]", out, depth + 1)
    elif isinstance(node, dict):
        for k, v in node.items():
            if k == "slots":
                continue
            _walk_strings(v, f"{path}.{k}" if path else k, out, depth + 1)


def find_text(config: Dict[str, Any], query: str, page_route: Optional[str] = None, limit: int = 12) -> List[Dict[str, Any]]:
    """
    Where does this text appear? Case-insensitive search over every string prop
    on every section, returning the exact prop path an `update` op would patch.
    This is how "the button that says Book a demo" becomes a precise edit.
    """
    q = str(query or "").strip().lower()
    if not q:
        return []
    hits: List[Dict[str, Any]] = []
    for page in config.get("pages") or []:
        if not isinstance(page, dict):
            continue
        if page_route and str(page.get("route") or "").lstrip("/").lower() != str(page_route).lstrip("/").lower():
            continue
        for pos, comp in enumerate(walk_components(page.get("components")), start=1):
            strings: List[Tuple[str, str]] = []
            _walk_strings(comp.get("props") or {}, "props", strings)
            for path, value in strings:
                text = strip_html(value, 100000)
                idx = text.lower().find(q)
                if idx == -1:
                    continue
                start = max(0, idx - 40)
                snippet = text[start: idx + len(q) + 60]
                hits.append({
                    "page_route": page.get("route"), "section_id": comp.get("id"), "position": pos,
                    "type": comp.get("type"), "label": component_label(comp.get("type")),
                    "path": path, "snippet": ("…" if start else "") + snippet + ("…" if idx + len(q) + 60 < len(text) else ""),
                    "is_html": bool(_TAG_RE.search(value)),
                })
                if len(hits) >= limit:
                    return hits
    return hits


def collect_capture_surfaces(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every lead-capture surface across the site, with its page and section."""
    out: List[Dict[str, Any]] = []
    # Site chrome (globalSettings.layout): the brand footer's newsletter. Its
    # section_id is the slot link_lead_form takes ('footer'), and it shows on
    # every page.
    layout = (config.get("globalSettings") or {}).get("layout")
    footer = layout.get("footer") if isinstance(layout, dict) else None
    if isinstance(footer, dict) and footer.get("enabled", True) is not False:
        for s in _widget_capture_surfaces(footer):
            out.append({
                "page_route": None, "page_title": "Every page (site footer)", "section_id": "footer",
                "section_type": "footer", "section_label": component_label("footer"), **s,
            })
    for page in config.get("pages") or []:
        if not isinstance(page, dict):
            continue
        for comp in walk_components(page.get("components")):
            for s in capture_surfaces(comp):
                out.append({
                    "page_route": page.get("route"),
                    "page_title": page.get("title"),
                    "section_id": comp.get("id"),
                    "section_type": comp.get("type"),
                    "section_label": component_label(comp.get("type")),
                    **s,
                })
    return out


# ── publish checks (port of publish-checks.ts) ───────────────────────────
PLACEHOLDER_PATTERNS = [re.compile(p, re.I) for p in (
    r"lorem ipsum",
    r"\byour (?:institute|company|school) name\b",
    r"\breplace (?:this|with)\b",
    r"\bplaceholder\b",
    r"\bexample\.com\b",
    r"\bnew program\b",
    r"\bsecond program\b",
    r"\bdetail (?:one|two)\b",
    r"\bwho can join\b",
)]

_EXTERNAL_LINK_RE = re.compile(r"^(https?:|mailto:|tel:|#)")
_BUILTIN_ROUTES = {"login", "signup", "get-started", "getstarted"}


def run_publish_checks(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    The dashboard's pre-publish pass. WARNS, never blocks — the admin stays in charge.

    Each issue: ``{severity: error|warning, title, fix, page_route?, page_id?, component_id?}``.
    Errors first, then warnings, stable within group.
    """
    issues: List[Dict[str, Any]] = []
    pages = [p for p in (config.get("pages") or []) if isinstance(p, dict)]
    routes = {str(p.get("route") or "").lstrip("/").lower() for p in pages}

    for page in pages:
        page_name = page.get("title") or page.get("route") or "Untitled page"
        ctx = {"page_id": page.get("id"), "page_route": page.get("route"), "page_name": page_name}

        if not str((page.get("seo") or {}).get("metaDescription") or "").strip():
            issues.append({
                "severity": "warning",
                "title": f"“{page_name}” has no meta description",
                "fix": "Add one under the page's SEO settings. It becomes the text under your link on Google and in WhatsApp previews.",
                **ctx,
            })

        for c in walk_components(page.get("components")):
            p = c.get("props") or {}
            cctx = {**ctx, "component_id": c.get("id")}
            # Capture surfaces wired to nothing: a bare action, the single
            # `button` (CTA banner, media showcase…) and each hero button.
            form_buttons: List[Dict[str, Any]] = [{"action": p.get("action"), "audienceId": p.get("audienceId")}]
            if isinstance(p.get("button"), dict):
                form_buttons.append(p["button"])
            if _band_secondary_button(c):
                form_buttons.append(p["secondaryButton"])
            left = p.get("left") if isinstance(p.get("left"), dict) else {}
            form_buttons.extend(b for b in (left.get("buttons") or []) if isinstance(b, dict))
            if any(b.get("action") == "openForm" and not str(b.get("audienceId") or "").strip() for b in form_buttons):
                issues.append({
                    "severity": "error",
                    "title": "A button opens a form but no campaign is selected",
                    "fix": "Pick a campaign for it, or change the button back to a link. Right now it does nothing when tapped.",
                    **cctx,
                })
            # A catalogue spotlight 'open-form' button without a campaign is not drawn at all.
            unwired_spotlight = False
            for section in (p.get("columnSections") or []) if c.get("type") == "courseCatalog" else []:
                for slide in (section.get("slides") or []) if isinstance(section, dict) and section.get("kind") == "spotlight" else []:
                    cta = slide.get("cta") if isinstance(slide, dict) and isinstance(slide.get("cta"), dict) else {}
                    if cta.get("action") == "open-form" and not str(cta.get("audienceId") or "").strip():
                        unwired_spotlight = True
            if unwired_spotlight:
                issues.append({
                    "severity": "error",
                    "title": "A spotlight button opens a form but no campaign is selected",
                    "fix": "Pick a campaign for it, or change it to a link. Until then the button is hidden from visitors.",
                    **cctx,
                })
            if c.get("type") == "htmlPage":
                unwired = [h for h in capture_surfaces(c) if not h["audience_id"]]
                if unwired:
                    issues.append({
                        "severity": "error",
                        "title": "An HTML page button opens a form but no campaign is selected",
                        "fix": f"“{unwired[0]['label']}” has data-vacademy=\"lead-form\" with no data-audience. Wire it with link_lead_form or set the campaign id in the HTML.",
                        **cctx,
                    })
            if c.get("type") == "leadForm" and not str(p.get("audienceId") or "").strip():
                issues.append({
                    "severity": "error",
                    "title": "A Lead Form section has no campaign selected",
                    "fix": "Choose a campaign so its fields render — the section is invisible to visitors until then.",
                    **cctx,
                })
            if c.get("type") == "productPageOffer" and not str(p.get("productPageCode") or "").strip():
                issues.append({
                    "severity": "error",
                    "title": "A course section has no product page selected",
                    "fix": "Pick a product page in its properties, or remove the section. It is hidden from visitors as-is.",
                    **cctx,
                })
            if c.get("type") == "learningPath":
                list_mode = str(p.get("mode") or "single") == "list"
                bound = str((p.get("libraryId") if list_mode else p.get("productPageCode")) or "").strip()
                if not bound:
                    issues.append({
                        "severity": "error",
                        "title": "A Learning Path section has no " + ("folder library" if list_mode else "product page") + " selected",
                        "fix": "Pick one in its properties, or remove the section. It is hidden from visitors as-is.",
                        **cctx,
                    })
            if c.get("type") == "folderBrowser" and not str(p.get("libraryId") or "").strip():
                issues.append({
                    "severity": "error",
                    "title": "A Folder Browser section has no folder library selected",
                    "fix": "Pick a library in its properties (or create one with the Folders button), or remove the section. It is hidden from visitors as-is.",
                    **cctx,
                })

            for link in list(p.get("navLinks") or []) + list(p.get("authLinks") or []):
                if not isinstance(link, dict):
                    continue
                raw = str(link.get("route") or "").lstrip("/").lower()
                if not raw or _EXTERNAL_LINK_RE.match(raw) or raw in _BUILTIN_ROUTES:
                    continue
                if str(link.get("audienceId") or "").strip():
                    continue
                if raw not in routes:
                    issues.append({
                        "severity": "warning",
                        "title": f"Menu link “{link.get('label') or raw}” points to a page that doesn’t exist",
                        "fix": f"Nothing on this site has the address “{raw}”. Fix the link or create that page.",
                        **cctx,
                    })

            strings: List[str] = []
            _collect_strings(p, strings)
            hit = next((s for s in strings if len(s) < 400 and any(r.search(s) for r in PLACEHOLDER_PATTERNS)), None)
            if hit:
                short = hit[:60] + ("…" if len(hit) > 60 else "")
                issues.append({
                    "severity": "warning",
                    "title": "Placeholder text is still on the page",
                    "fix": f"“{short}” looks like sample copy. Replace it with your own words.",
                    **cctx,
                })

    tracking = (config.get("globalSettings") or {}).get("tracking") or {}
    if not (tracking.get("ga4MeasurementId") or tracking.get("metaPixelId") or tracking.get("gtmId")):
        issues.append({
            "severity": "warning",
            "title": "No analytics connected",
            "fix": "Add a Google Analytics or Meta Pixel ID in Global Settings → Tracking to see where your enquiries come from.",
        })

    return sorted(issues, key=lambda i: 0 if i["severity"] == "error" else 1)


# ── URLs ─────────────────────────────────────────────────────────────────
def learner_site_url(tag_name: str, learner_portal_base_url: Optional[str], fallback_origin: str) -> Optional[str]:
    """Public URL of one catalogue site, mirroring the dashboard's getCatalogueSiteUrl.

    None when neither a portal base nor a fallback origin is given — the caller
    then tells the admin the institute has no learner domain rather than
    inventing a link to a host that serves another institute."""
    base = (learner_portal_base_url or "").strip() or (fallback_origin or "").strip()
    if not base:
        return None
    base = base.rstrip("/")
    if not base.startswith("http"):
        base = f"https://{base}"
    return f"{base}/{quote(tag_name, safe='')}"


def editor_url(admin_dashboard_url: str, tag_name: str, page_route: Optional[str] = None,
               section_id: Optional[str] = None) -> str:
    url = f"{admin_dashboard_url.rstrip('/')}/manage-pages/editor/{quote(tag_name, safe='')}"
    qs = []
    if page_route:
        qs.append(f"page={quote(str(page_route).lstrip('/'), safe='')}")
    if section_id:
        qs.append(f"section={quote(str(section_id), safe='')}")
    return url + (f"?{'&'.join(qs)}" if qs else "")


__all__ = [
    "COMPONENT_LABELS", "LIVE_DATA_TYPES", "CAPTURE_TYPES",
    "component_label", "strip_html", "walk_components", "heading_of",
    "capture_surfaces", "data_binding", "summarize_component", "summarize_page",
    "summarize_global_settings", "find_page", "find_component",
    "collect_capture_surfaces", "run_publish_checks", "learner_site_url", "editor_url",
    "visual_summary", "find_text",
]
