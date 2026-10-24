"""
The ``website_edit`` tool — DRAFT-ONLY changes to the institute's websites for
the Assistant and the MCP server.

One tool with an ``action`` argument, its own settings toggle ("Website: edit
drafts", off by default), and two rules that make it safe and cheap to hand to
an AI app:

* **nothing here reaches a visitor** — every action saves a DRAFT revision the
  admin reviews and publishes in Manage Pages (``discard_draft`` is the undo);
* **no model runs inside** — the connected LLM composes the page JSON itself
  (it holds the whole interview; see ``website(action="schema")`` for the
  contract), and this tool only validates, audits and persists. No credits.

Actions
    create_page       a page the caller composed → sanitised, audited, saved as a draft
    create_site       several pages + theme + header/footer → a NEW draft site
    update_page       insert / update / remove / move ops on an existing page
    set_layout        the site's header and footer
    add_section       one block with default content (no composition needed)
    set_theme         colours, fonts, radius, atmosphere, motion, palette, content width
    set_catalog_settings  course formats, course languages + version groups, naming, site cart
    set_translations  another language's dictionary (globalSettings.i18n.strings)
    bind_data         point a section / the header mega menu at a folder library, folder or product page
    set_courses       which courses a course block shows
    link_lead_form    point a form / popup button at a lead campaign
    set_seo           meta title / description of a page
    import_image      bring a public https image into the media library
    discard_draft     drop the draft, back to what is published
    request_publish   is the draft ready? publish checks + data audit + review + diff vs live +
                      stale-draft verdict + editor link — READ-ONLY, it never publishes (with the
                      website_publish capability on, a ready draft also gets a confirm token for it)

Validation is the AI website builder's own (``sanitize_component``,
``_sanitize_page``, ``_sanitize_ops``, ``page_audit``) — the deterministic half
of that feature, without its composer.
"""
from __future__ import annotations

import asyncio
import copy
import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple


from .assistant_tool_registry import ToolContext, ToolSpec, _admin_core_json
from .catalogue_summary import (
    capture_surfaces,
    component_label,
    find_component,
    find_page,
    run_publish_checks,
    strip_html,
    summarize_component,
    summarize_global_settings,
    summarize_page,
)
from .website_data import (
    NO_PORTAL_DOMAIN_NOTE,
    _err,
    _is_error,
    get_campaign,
    list_folder_libraries,
    load_courses,
    load_library_folders,
    load_product_pages,
    load_site,
    resolve_tag,
    site_editor_url,
    site_url,
)

logger = logging.getLogger(__name__)

WEBSITE_EDIT_TOOL_NAME = "website_edit"
WEBSITE_EDIT_GROUP_KEY = "website_builder_edits"

WEBSITE_EDIT_ACTIONS = (
    "create_page", "create_site", "add_html_page", "update_page", "set_layout", "add_section", "set_theme",
    "set_site_settings", "set_courses", "link_lead_form", "set_seo", "import_image", "discard_draft",
    "set_catalog_settings", "set_translations", "bind_data", "request_publish",
)

THEME_PRESETS = ("default", "ocean", "forest", "sunset", "midnight", "rose", "violet", "amber", "slate")
DESIGN_LANGUAGES = (
    "editorial-serif", "swiss-minimal", "bold-modern", "dark-tech",
    "warm-community", "corporate-trust", "directory-reference",
)
PAGE_TYPES = ("homepage", "courses", "course-landing", "about", "admissions", "contact", "catalog")
DESIGN_SOURCE_KINDS = ("figma", "screenshot", "url", "other")
IMAGE_KINDS = ("logo", "photo", "banner", "inspiration")
BORDER_RADII = ("sharp", "rounded", "pill")
HEADING_SCALES = ("compact", "default", "large", "display")
ATMOSPHERES = ("flat", "soft", "mesh", "aurora")
MOTIONS = ("none", "calm", "balanced", "dynamic")

#: Font label → CSS stack (mirror of catalogue-fonts.ts). Unknown labels fall
#: back to a sans stack rather than an invalid font-family.
FONT_STACKS: Dict[str, str] = {
    "Inter": "Inter, sans-serif", "Roboto": "Roboto, sans-serif", "Open Sans": '"Open Sans", sans-serif',
    "Poppins": "Poppins, sans-serif", "Lato": "Lato, sans-serif", "Montserrat": "Montserrat, sans-serif",
    "Mulish": "Mulish, sans-serif", "Figtree": "Figtree, sans-serif", "Outfit": "Outfit, sans-serif",
    "Nunito": "Nunito, sans-serif", "Space Grotesk": '"Space Grotesk", sans-serif', "Rubik": "Rubik, sans-serif",
    "Quicksand": "Quicksand, sans-serif", "Baloo 2": '"Baloo 2", sans-serif',
    "Playfair Display": '"Playfair Display", serif', "Fraunces": "Fraunces, serif",
    "Newsreader": "Newsreader, serif", "Lora": "Lora, serif",
    # Devanagari faces for Hindi / Marathi sites.
    "Noto Sans Devanagari": '"Noto Sans Devanagari", sans-serif', "Mukta": "Mukta, sans-serif",
    "Hind": "Hind, sans-serif", "Noto Serif Devanagari": '"Noto Serif Devanagari", serif',
    "Tiro Devanagari Hindi": '"Tiro Devanagari Hindi", serif',
}

#: globalSettings.theme.palette — the named colours of a design-led site (mirror
#: of learner -utils/catalogue-palette.ts PALETTE_KEYS). Opt-in: a site without
#: a palette renders exactly as before.
PALETTE_KEYS = (
    "text", "body", "muted", "muted2", "primary", "gold", "accent", "olive", "cream", "canvas",
    "sand", "border", "borderStrong", "accentOnDark", "bodyOnDark", "outline",
)
#: globalSettings.theme.contentMaxWidth — content column in px, gutters excluded
#: (resolveContentMaxWidth: an integer 320–2400, anything else is ignored).
CONTENT_WIDTH_MIN, CONTENT_WIDTH_MAX = 320, 2400

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_HEX3_RE = re.compile(r"^#[0-9a-fA-F]{3}$")
_SLUG_RE = re.compile(r"[^a-z0-9-]+")
_MAX_OPS = 40

#: A fresh site's global settings — the dashboard's default template, minus the
#: sample header/footer (the composer supplies those when a theme is proposed).
DEFAULT_GLOBAL_SETTINGS: Dict[str, Any] = {
    "courseCatalogeType": {"enabled": False, "value": "Course"},
    "mode": "light",
    "theme": {"preset": "default", "borderRadius": "rounded"},
    "fonts": {"enabled": True, "family": "Inter, sans-serif"},
    "compactness": "medium",
    "audience": "all",
    "leadCollection": {
        "enabled": False, "mandatory": False, "inviteLink": None,
        "formStyle": {"type": "single", "showProgress": False, "progressType": "bar", "transition": "slide"},
        "fields": [],
    },
    "enrquiry": {"enabled": True, "requirePayment": False},
    "payment": {"enabled": True, "provider": "razorpay", "fields": ["fullName", "email", "phone"]},
}


# ──────────────────────────────────────────────────────────────────────────
# Schema
# ──────────────────────────────────────────────────────────────────────────
_THEME_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "description": "Colours and type. Omit a field to leave it unchanged.",
    "properties": {
        "preset": {"type": "string", "enum": list(THEME_PRESETS)},
        "primary_color": {"type": "string", "description": "Brand hex, e.g. #1D4ED8."},
        "mode": {"type": "string", "enum": ["light", "dark"]},
        "fonts": {"type": "object", "properties": {
            "body": {"type": "string", "description": "Font name from the choices, e.g. Poppins."},
            "heading": {"type": "string"},
        }},
        "border_radius": {"type": "string", "enum": list(BORDER_RADII)},
        "heading_scale": {"type": "string", "enum": list(HEADING_SCALES)},
        "atmosphere": {"type": "string", "enum": list(ATMOSPHERES)},
        "atmosphere_intensity": {"type": "string", "enum": ["subtle", "medium", "bold"]},
        "motion": {"type": "string", "enum": list(MOTIONS)},
        "palette": {
            "type": "object",
            "description": (
                "Exact named colours from a design (e.g. a Figma file), each #rrggbb; null removes one. "
                "Merged into the site's palette key by key. Add apply_to_tokens: true to also re-colour the "
                "shared text/background/border tokens (light mode). Keys: " + ", ".join(PALETTE_KEYS) + "."
            ),
            "properties": {
                **{k: {"type": ["string", "null"]} for k in PALETTE_KEYS},
                "apply_to_tokens": {"type": "boolean"},
            },
        },
        "content_max_width": {
            "type": ["integer", "null"],
            "description": f"Content column width in px, gutters excluded ({CONTENT_WIDTH_MIN}–{CONTENT_WIDTH_MAX}), "
                           "e.g. 1152 for a 1440 frame with 144 px margins. null returns to the default width.",
        },
    },
}

_SITE_SETTINGS_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "description": "Site-wide behaviour and search settings (globalSettings), apart from the theme.",
    "properties": {
        "sticky_header": {"type": "boolean"},
        "back_to_top": {"type": "boolean"},
        "compactness": {"type": "string", "enum": ["small", "medium", "large"], "description": "Section density."},
        "audience": {"type": "string", "enum": ["children", "adults", "all"]},
        "lead_popup": {"type": "object", "description": "Site-wide lead-capture popup.", "properties": {
            "enabled": {"type": "boolean"}, "mandatory": {"type": "boolean"}}},
        "seo": {"type": "object", "description": "Site-level SEO (page titles/descriptions live on each page).", "properties": {
            "keywords": {"type": "array", "items": {"type": "string"}},
            "google_site_verification": {"type": "string"},
            "organization": {"type": "object", "properties": {
                "name": {"type": "string"}, "legal_name": {"type": "string"}, "description": {"type": "string"},
                "founder": {"type": "string"}, "founding_date": {"type": "string"}, "email": {"type": "string"},
                "telephone": {"type": "string"}, "address": {"type": "string"}, "logo": {"type": "string"},
                "same_as": {"type": "array", "items": {"type": "string"}}}},
        }},
    },
}

_CATALOG_SETTINGS_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "description": (
        "Catalogue-wide settings (globalSettings). Maps merge key by key (null removes a key); lists replace. "
        "Course ids and product page codes ONLY from website(action='context')."
    ),
    "properties": {
        "course_formats": {"type": "object", "description": (
            "{slug key: {label, levels?: [level names], tags?: [course tags]} | null} — at most 20. A course "
            "shows a format when it has the tag 'format-<key>', one of `tags`, or its level is one of `levels`."),
            "additionalProperties": {"type": ["object", "null"], "properties": {
                "label": {"type": "string"}, "levels": {"type": "array", "items": {"type": "string"}},
                "tags": {"type": "array", "items": {"type": "string"}}}}},
        "course_format_order": {"type": "array", "items": {"type": "string"}, "description": "Format keys in display order."},
        "course_languages": {"type": "object", "properties": {
            "enabled": {"type": "boolean", "description": "Fold a course's language versions into one card with language chips."},
            "languages": {"type": "array", "items": {"type": "object", "properties": {
                "code": {"type": "string"}, "label": {"type": "string"}, "chip": {"type": "string"},
                "match": {"type": "array", "items": {"type": "string"}}}, "required": ["code", "label"]}},
            "version_groups": {"type": "array", "items": {"type": "array", "items": {"type": "string"}},
                               "description": "[[course id, course id], …] — separate courses that are the same course in different languages (max 100 groups). [] clears."},
        }},
        "naming": {"type": "object", "description": "The catalogue's own words, e.g. {level: 'Format'}.", "properties": {
            k: {"type": ["string", "null"]} for k in ("level", "level_plural", "course", "course_plural", "session", "session_plural")}},
        "site_cart": {"type": "object", "properties": {
            "enabled": {"type": "boolean"},
            "store_product_page_code": {"type": "string", "description": "The product page whose checkout takes the whole cart."}},
            "required": ["enabled"]},
    },
}

_COMPONENT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "description": "One section, per website(action='schema'): {id (kebab-case, unique), type, enabled: true, props, style?}.",
    "properties": {
        "id": {"type": "string"}, "type": {"type": "string"}, "enabled": {"type": "boolean"},
        "props": {"type": "object"}, "style": {"type": "object"}, "anchorId": {"type": "string"},
    },
    "required": ["id", "type", "props"],
}

_DESIGN_SOURCE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "description": (
        "The design a page reproduces (a Figma frame, a screenshot, a site): create_page / create_site (site-wide, "
        "or per page inside `pages[]` when each page is its own frame), update_page (set it on an existing page, or "
        "{clear: true} to go back to standard review). Review then runs in FIDELITY mode — the design wins over the "
        "generic quality rules. Only kind, node and frame name are saved on the page (the published site is public): "
        "the link and file key are not stored. Never put an access token here."
    ),
    "properties": {
        "kind": {"type": "string", "enum": list(DESIGN_SOURCE_KINDS)},
        "url": {"type": "string", "description": "https link to the design, e.g. a figma.com/design/<file>/…?node-id=1-2 URL."},
        "node_id": {"type": "string", "description": "Figma frame/node id, e.g. '1:247'."},
        "frame": {"type": "string", "description": "Frame or screen name in the design."},
        "clear": {"type": "boolean", "description": "update_page: true removes the page's design source."},
    },
}

_PAGE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "description": "A page you composed. Get the component contract from website(action='schema') first.",
    "properties": {
        "route": {"type": "string", "description": "URL path segment, e.g. 'home', 'admissions'."},
        "title": {"type": "string"},
        "seo": {"type": "object", "properties": {"metaTitle": {"type": "string"}, "metaDescription": {"type": "string"}}},
        "components": {"type": "array", "items": _COMPONENT_SCHEMA},
        "design_source": _DESIGN_SOURCE_SCHEMA,
    },
    "required": ["route", "components"],
}

_OP_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "description": (
        "One edit: {op:'insert', component, afterId|null} · {op:'update', id, propsPatch?, stylePatch?} · "
        "{op:'remove', id} · {op:'move', id, afterId|null}. Add a short `note` saying what it does."
    ),
    "properties": {
        "op": {"type": "string", "enum": ["insert", "update", "remove", "move"]},
        "id": {"type": "string"}, "afterId": {"type": ["string", "null"]},
        "component": _COMPONENT_SCHEMA, "propsPatch": {"type": "object"}, "stylePatch": {"type": "object"},
        "note": {"type": "string"},
    },
    "required": ["op"],
}

WEBSITE_EDIT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": WEBSITE_EDIT_TOOL_NAME,
        "description": (
            "Change the institute's websites. EVERY change is saved as a DRAFT the admin reviews and "
            "publishes in the dashboard — nothing goes live from here, and nothing here calls a model: "
            "YOU compose the content. Before composing, run website(action='brief_checklist') and "
            "website(action='schema'). Pick an `action`:\n"
            "- create_page (tag_name OR new_site_name, page, page_type?, theme?, design_source?): validate, audit "
            "and save a page you composed. Returns issues to fix (resubmit with update_page) and the editor_url. "
            "Pass design_source when the page reproduces a design (Figma, screenshot): review then judges it in "
            "fidelity mode.\n"
            "- create_site (new_site_name, pages, theme?, site_settings?, header?, footer?, design_source?): a whole "
            "NEW draft site. A page that is its own frame can carry pages[].design_source.\n"
            "- add_html_page (tag_name OR new_site_name, route, html, css?, title?, seo?, hide_site_chrome?, "
            "replace_existing?): a STATIC page you write as HTML + CSS (a full document or just the body) — "
            "for pages the block types cannot express, or when the admin hands you HTML. Scripts are removed; "
            "<style> moves into css; images must be institute media; links become site hooks. See "
            "website(action='schema').html_page_contract.\n"
            "- update_page (tag_name, page_route, ops, design_source?): insert / update / remove / move sections you "
            "author. design_source sets (or {clear: true} removes) the design an existing page reproduces.\n"
            "- set_layout (tag_name, header?, footer?): the site's header and footer components.\n"
            "- add_section (tag_name, page_route, section_type, after_section_id?, props?): insert one block "
            "with default content.\n"
            "- set_theme (tag_name, theme): colours, fonts, radius, atmosphere, motion, and for a design "
            "(Figma) the exact named palette and the content width.\n"
            "- set_catalog_settings (tag_name, catalog_settings): course formats (label + the level names / "
            "tags that mean each), their order, course languages + version groups (the same course in "
            "two languages as ONE card; course ids from website(action='context')), naming (e.g. the Level "
            "filter called 'Format'), and the site-wide cart's store product page.\n"
            "- set_translations (tag_name, locale, strings, enable?, locale_label?): merge translations into "
            "the site's dictionary for `locale` — {exact source text from website(action='strings'): "
            "translation}; null removes one; a translation equal to its source keeps the text as is. "
            "enable=true offers the language on the site.\n"
            "- bind_data (tag_name, section_id | 'header', data_kind, data_id, page_route?, path?, nav_index?, "
            "library_id?): bind live data instead of removing a section the audit flags as unbound — a "
            "folder library (folderBrowser, learningPath list, courseCatalog stream tabs, header mega menu), "
            "a folder (folderBrowser start folder, learningPath folder) or a product page code "
            "(learningPath, productPageOffer). Ids are checked against the institute's own data: library ids "
            "from website(action='context') folder_libraries, folder ids from website(action='context', "
            "library_id=…), product page codes from website(action='context'). Without page_route the section is "
            "found on whichever page has it.\n"
            "- set_site_settings (tag_name, site_settings): sticky header, back-to-top, density, audience, "
            "site-wide lead popup, site-level SEO (keywords, organization).\n"
            "- set_courses (tag_name, page_route, section_id, source: all|showcase|product_page, mode?, "
            "course_ids?, limit?, product_page_code?): which courses a course block shows.\n"
            "- link_lead_form (tag_name, page_route, section_id, audience_id, surface_path?): send a form or popup "
            "button's enquiries to a lead campaign. Ids ONLY from website(action='context') / audience_forms. "
            "section_id 'header' / 'footer' (no page_route) targets the site chrome, e.g. the footer newsletter. "
            "surface_path (from website(lead_summary)) wires just that one form when a section has several.\n"
            "- set_seo (tag_name, page_route, meta_title?, meta_description?).\n"
            "- import_image (url | urls (max 16) | data_base64 + file_name, kind, caption?): copy a public https "
            "image (up to 25 MB; big ones are downscaled to WebP, 2400 px) or a base64 file (up to 10 MB) into "
            "the media library so it can be placed. Returns url + sha256; the same file imported twice returns "
            "the copy already hosted. Figma MCP asset links (https://www.figma.com/api/mcp/asset/…) expire in "
            "7 days — import them in the same session. SVGs are sanitised. Images on pages must come from "
            "list_media or import_image — never invent URLs.\n"
            "- discard_draft (tag_name): throw the draft away — the undo for everything above.\n"
            "- request_publish (tag_name, library_id?): the hand-over check when you think the draft is done. "
            "Runs the pre-publish checks, the data audit and the review (fidelity mode for pages from a design) "
            "and returns ready + blockers, what publishing would change on the live site (diff_vs_live; first_publish "
            "for a site never published), a stale-draft verdict and editor_url. It NEVER publishes: the admin presses Publish in the editor "
            "(or, when the website_publish tool is enabled and the draft is ready, publish_confirm carries the "
            "single-use token website_publish needs after the admin says yes).\n"
            "Every result carries editor_url: tell the admin to review and publish there."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(WEBSITE_EDIT_ACTIONS)},
                "tag_name": {"type": "string", "description": "Existing site (from website list)."},
                "new_site_name": {"type": "string", "description": "create_page / create_site: name for a NEW site; becomes its URL path."},
                "page_route": {"type": "string"},
                "section_id": {"type": "string", "description": "A section id from website(get_page)."},
                "page": _PAGE_SCHEMA,
                "pages": {"type": "array", "items": _PAGE_SCHEMA, "description": "create_site: the pages, in navigation order."},
                "page_type": {"type": "string", "enum": list(PAGE_TYPES), "description": "create_page: which archetype the page follows (drives the audit)."},
                "design_source": _DESIGN_SOURCE_SCHEMA,
                "surface_path": {"type": "string", "description": "link_lead_form: one form's prop path from website(lead_summary), e.g. 'props.newsletter.audienceId'."},
                "ops": {"type": "array", "items": _OP_SCHEMA},
                "header": _COMPONENT_SCHEMA,
                "footer": _COMPONENT_SCHEMA,
                "route": {"type": "string", "description": "add_html_page: URL path segment for the new page."},
                "title": {"type": "string", "description": "add_html_page: page title (defaults to the HTML <title>/<h1>)."},
                "html": {"type": "string", "description": "add_html_page: the page's HTML — a full document or the body markup. Max 200 KB."},
                "css": {"type": "string", "description": "add_html_page: extra stylesheet (in addition to any <style> in html). Max 150 KB."},
                "seo": {"type": "object", "properties": {"metaTitle": {"type": "string"}, "metaDescription": {"type": "string"}}},
                "hide_site_chrome": {"type": "boolean", "description": "add_html_page: hide the site header/footer on this page (default true — a pasted page usually brings its own)."},
                "replace_existing": {"type": "boolean", "description": "add_html_page: overwrite a page that already has this route (only if it is an HTML page)."},
                "theme": _THEME_SCHEMA,
                "site_settings": _SITE_SETTINGS_SCHEMA,
                "section_type": {"type": "string", "description": "Block type, e.g. testimonialSection, faqSection, courseShowcase, leadForm."},
                "after_section_id": {"type": "string"},
                "props": {"type": "object", "description": "add_section: prop overrides for the new block."},
                "url": {"type": "string", "description": "import_image: public https image URL (incl. Figma MCP asset links)."},
                "urls": {"type": "array", "items": {"type": "string"}, "description": "import_image: several public https image URLs at once (max 16)."},
                "data_base64": {"type": "string", "description": "import_image: the image file itself, base64 or a data: URL (max 10 MB) — for local files / design exports."},
                "file_name": {"type": "string", "description": "import_image with data_base64: the file's name (for the media library)."},
                "kind": {"type": "string", "enum": list(IMAGE_KINDS)},
                "caption": {"type": "string"},
                "source": {"type": "string", "enum": ["all", "showcase", "product_page"]},
                "mode": {"type": "string", "enum": ["newest", "onSale", "tag", "picked", "comingSoon"], "description": "set_courses showcase mode."},
                "tag": {"type": "string", "description": "set_courses mode=tag: the course tag."},
                "limit": {"type": "integer"},
                "product_page_code": {"type": "string"},
                "audience_id": {"type": "string"},
                "meta_title": {"type": "string"},
                "meta_description": {"type": "string"},
                "catalog_settings": _CATALOG_SETTINGS_SCHEMA,
                "locale": {"type": "string", "description": "set_translations: the language, e.g. 'hi'."},
                "strings": {"type": "object", "additionalProperties": {"type": ["string", "null"]},
                            "description": "set_translations: {exact source text: translation | null}."},
                "enable": {"type": "boolean", "description": "set_translations: true offers the language on the site (switcher on); false turns the switcher off."},
                "locale_label": {"type": "string", "description": "set_translations: what the language switcher shows, e.g. 'हिन्दी'."},
                "data_kind": {"type": "string", "enum": ["folderLibrary", "folder", "productPage"], "description": "bind_data: what to bind."},
                "data_id": {"type": "string", "description": "bind_data: the library id, folder id or product page CODE (from website(action='context'))."},
                "nav_index": {"type": "integer", "description": "bind_data on the header: which navigation item (0-based) becomes the mega menu."},
                "path": {"type": "string", "description": "bind_data: an explicit prop path for the id inside an object the section already has, e.g. columnSections[1].productPageCode; on a featured learning path, featured.code or pathExtras[i].code (data_kind='productPage')."},
                "library_id": {"type": "string", "description": "bind_data data_kind=folder: the folder's library when the section has none yet. request_publish: the library the data audit checks folders in."},
            },
            "required": ["action"],
        },
    },
}


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────
def _require(args: Dict[str, Any], action: str, *names: str) -> Optional[Dict[str, Any]]:
    missing = [n for n in names if args.get(n) in (None, "", [], {})]
    if missing:
        return _err("missing_argument", action=action, needs=missing)
    return None


def _slugify(name: str) -> str:
    slug = _SLUG_RE.sub("-", str(name or "").strip().lower()).strip("-")
    return slug[:60] or "site"


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _institute_name(ctx: ToolContext) -> Optional[str]:
    from sqlalchemy import text
    try:
        row = ctx.db.execute(text("SELECT name FROM institutes WHERE id = :id"), {"id": ctx.principal.institute_id}).first()
        return row[0] if row and row[0] else None
    except Exception:  # noqa: BLE001
        return None


_FIGMA_NODE_RE = re.compile(r"^\d+[:-]\d+$")
_FIGMA_FILE_RE = re.compile(r"^/(?:design|file|proto|board|make)/([A-Za-z0-9]{10,64})(?:/|$)")


def clean_design_source(raw: Any) -> Optional[Dict[str, Any]]:
    """
    ``design_source`` → what is kept in ``page.meta.designSource``: kind, an
    https link with every query parameter except Figma's ``node-id`` dropped
    (no credentials, share tokens or tracking survive), the Figma file key and
    node, a frame name. Anything unusable → None (the page is reviewed as before).
    """
    from urllib.parse import parse_qs, urlsplit, urlunsplit
    if isinstance(raw, str):
        raw = {"url": raw}
    if not isinstance(raw, dict):
        return None
    out: Dict[str, Any] = {}
    url = str(raw.get("url") or "").strip()
    figma = False
    node = str(raw.get("node_id") or raw.get("nodeId") or "").strip()
    if url and len(url) <= 2000:
        try:
            parts = urlsplit(url)
            host = (parts.hostname or "").lower()
            port = f":{parts.port}" if parts.port and parts.port != 443 else ""
        except ValueError:
            parts, host, port = None, "", ""
        if parts is not None and parts.scheme == "https" and host:
            figma = host == "figma.com" or host.endswith(".figma.com")
            query = ""
            if figma:
                node_q = (parse_qs(parts.query).get("node-id") or [""])[0]
                node = node or node_q
                query = f"node-id={node_q}" if _FIGMA_NODE_RE.match(node_q) else ""
                m = _FIGMA_FILE_RE.match(parts.path or "")
                if m:
                    out["fileKey"] = m.group(1)
            out["url"] = urlunsplit(("https", host + port, parts.path, query, ""))
    kind = str(raw.get("kind") or "").strip().lower()
    out["kind"] = kind if kind in DESIGN_SOURCE_KINDS else ("figma" if figma else ("url" if out.get("url") else "other"))
    if _FIGMA_NODE_RE.match(node):
        out["nodeId"] = node.replace("-", ":")
    frame = strip_html(raw.get("frame"), 120)
    if frame:
        out["frame"] = frame
    if not (out.get("url") or out.get("nodeId") or out.get("frame") or kind in DESIGN_SOURCE_KINDS):
        return None
    return out


#: What ``page.meta.designSource`` keeps. A published site's catalogue JSON is
#: served without login, so the link and the Figma file key (enough to open a
#: file shared "anyone with the link") never go into the page — the caller
#: already has them, and the tool result echoes them back.
_STORED_DESIGN_KEYS = ("kind", "nodeId", "frame")
DESIGN_SOURCE_NOTE = ("Saved on the page: the design kind, node and frame name only (it switches review to fidelity "
                      "mode). The link and file key are NOT stored — the published site is public — so keep them "
                      "for any later comparison.")


def stored_design_source(design_source: Dict[str, Any]) -> Dict[str, Any]:
    return {k: design_source[k] for k in _STORED_DESIGN_KEYS if design_source.get(k)}


def _with_design_meta(page: Dict[str, Any], design_source: Optional[Dict[str, Any]], page_type: Optional[str],
                      default_type: str) -> None:
    """Record the design and the page type it was built as, so review keeps judging it in that mode."""
    if not design_source:
        return
    from .page_quality import content_page_type
    pt = page_type if page_type in PAGE_TYPES else (content_page_type(page) or default_type)
    meta = page.get("meta") if isinstance(page.get("meta"), dict) else {}
    page["meta"] = {**meta, "designSource": stored_design_source(design_source), "pageType": pt}


def _audit_issues(audit: List[Dict[str, Any]], fidelity: bool) -> List[Dict[str, Any]]:
    """page_audit issues as design_issues. See page_quality.audit_kind: a ``fix``
    is an error in fidelity mode only (standard mode reports what it always has)."""
    from .page_quality import audit_kind
    return [{"severity": "error" if audit_kind(i, fidelity) == "fix" else "warning", "code": i.get("code"),
             "message": i.get("message"), "fix": i.get("hint"), "component_id": i.get("component_id")}
            for i in audit]


def _course_snapshot(courses: List[Dict[str, Any]], only_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    wanted = set(only_ids or [])
    out = []
    for c in courses:
        if wanted and c.get("id") not in wanted and not wanted.intersection(c.get("package_session_ids") or []):
            continue
        out.append({k: v for k, v in {
            "name": c.get("name"),
            "price": f"{c.get('currency') or ''} {c.get('price')}".strip() if c.get("price") else None,
            "level": c.get("level"),
            "tags": [c["session"]] if c.get("session") else None,
        }.items() if v})
    return out[:40]


def theme_to_global_patch(theme: Dict[str, Any]) -> Dict[str, Any]:
    """
    A ``theme`` argument (or a brand kit) → the ``globalSettings`` patch the
    renderers consume. Port of the dashboard's ``brandKitToGlobalPatch`` plus the
    direct fields an admin names in conversation. Unknown values are dropped,
    never written.
    """
    theme = theme if isinstance(theme, dict) else {}
    # Accept a brand kit's own field names too.
    preset = theme.get("preset") or theme.get("themePreset")
    primary = theme.get("primary_color") or theme.get("primaryColor")
    radius = theme.get("border_radius") or theme.get("borderRadius")
    scale = theme.get("heading_scale") or theme.get("headingScale")
    atmosphere = theme.get("atmosphere")
    motion = theme.get("motion")
    fonts_in = theme.get("fonts") if isinstance(theme.get("fonts"), dict) else {}
    body_font = fonts_in.get("body") or theme.get("fontFamily")
    heading_font = fonts_in.get("heading") or theme.get("headingFontFamily")

    patch: Dict[str, Any] = {}
    t: Dict[str, Any] = {}
    if preset in THEME_PRESETS:
        t["preset"] = preset
    if isinstance(primary, str) and _HEX_RE.match(primary):
        t["primaryColor"] = primary.upper()
    elif preset:
        # A new palette without an exact colour must clear a stale override,
        # otherwise the preset never visibly takes effect (same rule as the
        # dashboard's brandKitToGlobalPatch).
        t["primaryColor"] = None
    if radius in BORDER_RADII:
        t["borderRadius"] = radius
    if scale in HEADING_SCALES:
        t["headingScale"] = scale
    intensity = theme.get("atmosphere_intensity")
    intensity = intensity if intensity in ("subtle", "medium", "bold") else None
    if isinstance(atmosphere, str) and atmosphere in ATMOSPHERES:
        t["atmosphere"] = {"canvas": atmosphere, "intensity": intensity or "medium"}
    elif isinstance(atmosphere, dict) and atmosphere.get("canvas") in ATMOSPHERES:
        t["atmosphere"] = {"canvas": atmosphere["canvas"], "intensity": intensity or atmosphere.get("intensity") or "medium"}
    palette = _palette_patch(theme.get("palette"))
    if palette:
        t["palette"] = palette
    width_in = _first_present(theme, "content_max_width", "contentMaxWidth")
    if width_in is not _MISSING:
        width = _content_width(width_in)
        if width is not None or width_in is None:
            t["contentMaxWidth"] = width     # None clears it (merge_global_settings drops the key)
    if t:
        patch["theme"] = t
    if theme.get("mode") in ("light", "dark"):
        patch["mode"] = theme["mode"]
    if motion in MOTIONS:
        patch["motion"] = {"personality": motion}
    if body_font or heading_font:
        body_stack = _font_stack(body_font) or "Inter, sans-serif"
        fonts: Dict[str, Any] = {"enabled": True, "family": body_stack}
        head_stack = _font_stack(heading_font)
        if head_stack and head_stack != body_stack:
            fonts["headingFamily"] = head_stack
        patch["fonts"] = fonts
    return patch


def _font_stack(label: Any) -> Optional[str]:
    if not isinstance(label, str) or not label.strip():
        return None
    name = label.strip()
    if name in FONT_STACKS:
        return FONT_STACKS[name]
    # Already a CSS stack, or a label in different casing.
    for k, v in FONT_STACKS.items():
        if k.lower() == name.lower() or v == name:
            return v
    return None


_MISSING = object()


def _first_present(d: Dict[str, Any], *keys: str) -> Any:
    """The value of the first key present in ``d`` (None counts), else ``_MISSING``."""
    for k in keys:
        if k in d:
            return d[k]
    return _MISSING


def _hex6(value: Any) -> Optional[str]:
    """#rgb / #rrggbb → #RRGGBB (the case set_theme stores primaryColor in); None for anything else."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if _HEX3_RE.match(v):
        v = "#" + "".join(c * 2 for c in v[1:])
    return v.upper() if _HEX_RE.match(v) else None


def _content_width(value: Any) -> Optional[int]:
    """An integer content width inside the renderer's range, else None (never clamped: a wrong width is refused)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != int(value):
        return None
    px = int(value)
    return px if CONTENT_WIDTH_MIN <= px <= CONTENT_WIDTH_MAX else None


def _palette_patch(raw: Any) -> Dict[str, Any]:
    """
    A ``palette`` argument → the ``theme.palette`` patch: known keys with a hex
    value (None removes that colour), plus ``applyToTokens``. Anything else is
    dropped here; ``theme_problems`` names it for the caller.
    """
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Any] = {}
    for key in PALETTE_KEYS:
        if key not in raw:
            continue
        if raw[key] is None:
            out[key] = None
        elif (hex_ := _hex6(raw[key])) is not None:
            out[key] = hex_
    apply = _first_present(raw, "apply_to_tokens", "applyToTokens")
    if isinstance(apply, bool):
        out["applyToTokens"] = apply
    elif apply is None:
        out["applyToTokens"] = None
    return out


def theme_problems(theme: Any) -> List[str]:
    """
    What in a ``theme`` argument's palette / content width cannot be stored — so
    a design's exact colours are never silently half-applied. Empty when fine.
    """
    if not isinstance(theme, dict):
        return []
    problems: List[str] = []
    palette = theme.get("palette")
    if palette is not None and not isinstance(palette, dict):
        problems.append("palette must be an object of named #rrggbb colours.")
    elif isinstance(palette, dict):
        allowed = set(PALETTE_KEYS) | {"apply_to_tokens", "applyToTokens"}
        unknown = sorted(k for k in palette if k not in allowed)
        if unknown:
            problems.append(f"Unknown palette key(s) {unknown}; the palette has exactly: {list(PALETTE_KEYS)} "
                            "(+ apply_to_tokens).")
        bad = sorted(k for k in PALETTE_KEYS if k in palette and palette[k] is not None and _hex6(palette[k]) is None)
        if bad:
            problems.append(f"palette {bad} must be hex colours like #883000.")
        apply = _first_present(palette, "apply_to_tokens", "applyToTokens")
        if apply is not _MISSING and apply is not None and not isinstance(apply, bool):
            problems.append("palette.apply_to_tokens must be true or false.")
    width = _first_present(theme, "content_max_width", "contentMaxWidth")
    if width is not _MISSING and width is not None and _content_width(width) is None:
        problems.append(f"content_max_width must be a whole number of px from {CONTENT_WIDTH_MIN} to {CONTENT_WIDTH_MAX}.")
    return problems


def _merge_theme(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    """theme patch over theme, with ``palette`` merged key by key (None removes a colour)."""
    merged = {**base, **patch}
    if isinstance(patch.get("palette"), dict):
        old = base.get("palette") if isinstance(base.get("palette"), dict) else {}
        palette = {k: v for k, v in {**old, **patch["palette"]}.items() if v is not None}
        if any(k in palette for k in PALETTE_KEYS):
            merged["palette"] = palette
        else:
            merged.pop("palette", None)   # no colour left: applyToTokens alone means nothing
    return merged


_SEO_ORG_KEYS = {"name": "name", "legal_name": "legalName", "description": "description", "founder": "founder",
                 "founding_date": "foundingDate", "email": "email", "telephone": "telephone", "address": "address",
                 "logo": "logo", "same_as": "sameAs"}


def site_settings_to_global_patch(settings_in: Dict[str, Any]) -> Dict[str, Any]:
    """``site_settings`` argument → globalSettings patch (only recognised values; nothing invented)."""
    si = settings_in if isinstance(settings_in, dict) else {}
    patch: Dict[str, Any] = {}
    if isinstance(si.get("sticky_header"), bool):
        patch["stickyHeader"] = si["sticky_header"]
    if isinstance(si.get("back_to_top"), bool):
        patch["backToTop"] = si["back_to_top"]
    if si.get("compactness") in ("small", "medium", "large"):
        patch["compactness"] = si["compactness"]
    if si.get("audience") in ("children", "adults", "all"):
        patch["audience"] = si["audience"]
    popup = si.get("lead_popup")
    if isinstance(popup, dict):
        lc = {k: bool(popup[k]) for k in ("enabled", "mandatory") if isinstance(popup.get(k), bool)}
        if lc:
            patch["leadCollection"] = lc
    seo = si.get("seo")
    if isinstance(seo, dict):
        out: Dict[str, Any] = {}
        if isinstance(seo.get("keywords"), list):
            out["keywords"] = [str(k)[:60] for k in seo["keywords"] if isinstance(k, str)][:30]
        if isinstance(seo.get("google_site_verification"), str):
            out["googleSiteVerification"] = seo["google_site_verification"][:200]
        org = seo.get("organization")
        if isinstance(org, dict):
            o = {_SEO_ORG_KEYS[k]: v for k, v in org.items() if k in _SEO_ORG_KEYS and v not in (None, "")}
            if "sameAs" in o and not isinstance(o["sameAs"], list):
                o.pop("sameAs")
            if "logo" in o and not _is_institute_asset(o["logo"]):
                o.pop("logo")
            if o:
                out["organization"] = o
        if out:
            patch["seo"] = out
    return patch


def merge_global_settings(gs: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    """
    One level of object merge (theme/fonts/motion), like the editor's
    updateGlobalSettings + applyOps — except ``theme.palette``, which merges
    one level deeper so setting one colour never drops the other fifteen.
    """
    out = copy.deepcopy(gs) if isinstance(gs, dict) else {}
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            merged = _merge_theme(out[k], v) if k == "theme" else {**out[k], **v}
            out[k] = {kk: vv for kk, vv in merged.items() if vv is not None}
        elif v is None:
            out.pop(k, None)
        else:
            out[k] = v
    return out


# ── copilot ops (port of applyOps in ai-page-service.ts) ────────────────
def _merge_patch(base: Any, patch: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base or {})
    for k, v in patch.items():
        if v is None:
            out.pop(k, None)
        else:
            out[k] = v
    return out


def _patch_by_id(components: List[Any], target: str, fn) -> Tuple[List[Any], bool]:
    hit = False
    out: List[Any] = []
    for c in components:
        if isinstance(c, dict) and c.get("id") == target:
            hit = True
            res = fn(c)
            if res is not None:
                out.append(res)
            continue
        slots = (c.get("props") or {}).get("slots") if isinstance(c, dict) else None
        if isinstance(slots, list):
            slot_hit = False
            new_slots = []
            for slot in slots:
                if isinstance(slot, list):
                    r, h = _patch_by_id(slot, target, fn)
                    slot_hit = slot_hit or h
                    new_slots.append(r)
                else:
                    new_slots.append(slot)
            if slot_hit:
                hit = True
                out.append({**c, "props": {**(c.get("props") or {}), "slots": new_slots}})
                continue
        out.append(c)
    return out, hit


def apply_ops(config: Dict[str, Any], page_id: str, ops: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Pure: returns a new config with the copilot's ops applied to one page."""
    clone = copy.deepcopy(config)
    page = next((p for p in clone.get("pages") or [] if isinstance(p, dict) and p.get("id") == page_id), None)
    if page is None:
        return clone
    comps: List[Any] = page.setdefault("components", [])
    for op in ops[:_MAX_OPS]:
        kind = op.get("op")
        if kind == "insert" and isinstance(op.get("component"), dict):
            comp = op["component"]
            after = op.get("afterId")
            if after is None:
                comps.insert(0, comp)
            else:
                idx = next((i for i, c in enumerate(comps) if isinstance(c, dict) and c.get("id") == after), -1)
                comps.insert(idx + 1 if idx >= 0 else len(comps), comp)
        elif kind == "update" and op.get("id"):
            def _upd(c, op=op):
                return {
                    **c,
                    "props": _merge_patch(c.get("props"), op["propsPatch"]) if isinstance(op.get("propsPatch"), dict) else c.get("props"),
                    "style": _merge_patch(c.get("style"), op["stylePatch"]) if isinstance(op.get("stylePatch"), dict) else c.get("style"),
                }
            comps, _ = _patch_by_id(comps, op["id"], _upd)
        elif kind == "remove" and op.get("id"):
            comps, _ = _patch_by_id(comps, op["id"], lambda c: None)
        elif kind == "move" and op.get("id"):
            idx = next((i for i, c in enumerate(comps) if isinstance(c, dict) and c.get("id") == op["id"]), -1)
            if idx == -1:
                continue
            moved = comps.pop(idx)
            after = op.get("afterId")
            if after is None:
                comps.insert(0, moved)
            else:
                a = next((i for i, c in enumerate(comps) if isinstance(c, dict) and c.get("id") == after), -1)
                comps.insert(a + 1 if a >= 0 else len(comps), moved)
        elif kind == "updateGlobalSettings" and isinstance(op.get("patch"), dict):
            gs = clone.setdefault("globalSettings", {})
            for k, v in op["patch"].items():
                if k == "theme" and isinstance(v, dict):
                    # Same as the dashboard's applyOps: palette merged key by key, and a
                    # palette left with no colour (applyToTokens alone) is dropped.
                    gs[k] = _merge_theme(gs[k] if isinstance(gs.get(k), dict) else {}, v)
                elif isinstance(v, dict) and isinstance(gs.get(k), dict):
                    gs[k] = {**gs[k], **v}
                else:
                    gs[k] = v
        page["components"] = comps
    page["components"] = comps
    return clone


def describe_ops(ops: List[Dict[str, Any]]) -> List[str]:
    """The diff card's plain-language lines."""
    lines = []
    for op in ops[:_MAX_OPS]:
        note = op.get("note")
        kind = op.get("op")
        if kind == "insert":
            comp = op.get("component") or {}
            lines.append(note or f"Added a {component_label(comp.get('type'))} section")
        elif kind == "update":
            lines.append(note or f"Updated section {op.get('id')}")
        elif kind == "remove":
            lines.append(note or f"Removed section {op.get('id')}")
        elif kind == "move":
            lines.append(note or f"Moved section {op.get('id')}")
        elif kind == "updateGlobalSettings":
            lines.append(note or "Updated site settings")
    return lines


# ── persistence ──────────────────────────────────────────────────────────
async def save_draft(ctx: ToolContext, catalogue_id: str, config: Dict[str, Any], source: str,
                     ai_run_id: Optional[str]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/course-catalogue/revision/save-draft",
        params={"catalogueId": catalogue_id},
        body={"catalogue_json": json.dumps(config, ensure_ascii=False, separators=(",", ":")), "source": source, "ai_run_id": ai_run_id},
        timeout=60.0,
    )
    if _is_error(data) or not isinstance(data, dict):
        return None, _err("save_failed", message="The draft could not be saved.")
    return data, None


async def create_site(ctx: ToolContext, tag_name: str, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/course-catalogue/create",
        params={"instituteId": ctx.principal.institute_id},
        body={"catalogues": [{
            "catalogue_json": json.dumps(config, ensure_ascii=False, separators=(",", ":")),
            "tag_name": tag_name, "status": "DRAFT", "source": "INTERNAL", "is_default": False,
        }]},
        timeout=60.0,
    )
    return None if _is_error(data) else (data if isinstance(data, dict) else {"ok": True})


def _result(ctx: ToolContext, site: Dict[str, Any], config: Dict[str, Any], revision: Optional[Dict[str, Any]],
            summary: str, page_route: Optional[str] = None, section_id: Optional[str] = None, **extra: Any) -> Dict[str, Any]:
    issues = run_publish_checks(config)
    quality = None
    if page_route:
        route = str(page_route).lstrip("/").lower()
        issues = [i for i in issues if not i.get("page_route") or str(i["page_route"]).lstrip("/").lower() == route]
        target = find_page(config, page_route)
        if target is not None and not any(c.get("type") == "htmlPage" for c in target.get("components") or []):
            from .page_quality import review_mode, review_page, review_with_audit
            # The mode the page was created in (meta.designSource → fidelity).
            # Fidelity drops most taste fixes, so the audit is its correctness
            # gate and is part of `quality` there; standard mode is unchanged.
            page_type, fidelity = review_mode(target, extra.pop("page_type", None))
            r = (review_with_audit if fidelity else review_page)(
                target, config.get("globalSettings"), page_type or "homepage", fidelity=fidelity)
            quality = {"score": r["score"], "bar": r["bar"], "passes": r["passes"],
                       "top_issues": [{k: v for k, v in i.items() if k != "weight"} for i in r["issues"][:6]]}
            if fidelity:
                quality["mode"] = "fidelity"
    live_url = site_url(ctx, site["tag_name"])
    out: Dict[str, Any] = {
        "tag_name": site["tag_name"],
        "summary_of_change": summary,
        "saved_as": "draft",
        "draft_revision_no": (revision or {}).get("revision_no"),
        "editor_url": site_editor_url(site["tag_name"], page_route, section_id, ctx=ctx),
        "live_url": live_url,
        "audit": {
            "errors": [{k: v for k, v in i.items() if k != "page_id"} for i in issues if i["severity"] == "error"][:8],
            "warnings": len([i for i in issues if i["severity"] == "warning"]),
        },
        "next": "Ask the admin to review the draft at editor_url and press Publish there; nothing is live yet.",
    }
    if page_route:
        out["page_route"] = page_route
    if quality is not None:
        out["quality"] = quality
    if live_url is None:
        out["live_url_note"] = NO_PORTAL_DOMAIN_NOTE
    out.update(extra)
    return out


def _unique_route(config: Dict[str, Any], wanted: str) -> str:
    routes = {str(p.get("route") or "") for p in config.get("pages") or [] if isinstance(p, dict)}
    route = wanted or "ai-page"
    n = 2
    while route in routes:
        route = f"{wanted}-{n}"
        n += 1
    return route


def _generated_page_to_page(gen: Dict[str, Any], config: Dict[str, Any], fallback_route: str) -> Dict[str, Any]:
    route = _unique_route(config, str(gen.get("route") or fallback_route))
    return {
        "id": gen.get("id") or _new_id("page"),
        "route": route,
        "title": gen.get("title") or None,
        "seo": gen.get("seo") or {},
        "components": gen.get("components") or [],
    }


def _stale_refusal(site: Optional[Dict[str, Any]], action: str) -> Optional[Dict[str, Any]]:
    """
    An edit on a site whose draft is older than live: building on the draft
    would carry it forward, and editing the published copy would silently
    overwrite the draft — so neither. The admin decides in the editor.
    """
    stale = (site or {}).get("stale_draft")
    if not stale:
        return None
    return _err(
        "stale_draft", action=action,
        message=(f"Website '{site['tag_name']}' has an unpublished draft (v{stale.get('draft_revision_no')}) that is "
                 f"older than the live site (v{stale.get('live_revision_no')}, changed {stale.get('live_updated_at')}). "
                 "Nothing was changed. Ask the admin to open editor_url and either discard the draft (use the live "
                 "site) or publish it deliberately; or, if the admin says the draft can go, call "
                 "website_edit(action='discard_draft') and retry."),
        editor_url=stale.get("editor_url"),
        draft_revision_no=stale.get("draft_revision_no"),
        live_revision_no=stale.get("live_revision_no"),
    )


async def _target_site(ctx: ToolContext, args: Dict[str, Any], action: str):
    """The site to change: an existing one, or None + error."""
    site, err = await load_site(ctx, args.get("tag_name"))
    if err:
        return None, {**err, "action": action}
    if refusal := _stale_refusal(site, action):
        return None, refusal
    return site, None


# ──────────────────────────────────────────────────────────────────────────
# Actions
# ──────────────────────────────────────────────────────────────────────────

def default_layout(institute_name: Optional[str], pages: List[Dict[str, Any]],
                   contact: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Header + footer for a NEW site, as the dashboard's default template seeds
    them (CreateCatalogueDialog → defaultTemplate.globalSettings.layout), so a
    site built by conversation has navigation and a footer from the start.
    """
    title = (institute_name or "").strip() or "My Platform"
    nav = [{"label": (p.get("title") or str(p.get("route") or "").replace("-", " ").title() or "Home")[:24],
            "route": p.get("route"), "openInSameTab": True} for p in pages[:6] if p.get("route")]
    contact = contact if isinstance(contact, dict) else {}
    footer_lines = [v for v in (contact.get("phone"), contact.get("email"), contact.get("address")) if v]
    return {
        "header": {
            "id": "header-1", "type": "header", "enabled": True,
            "props": {"logo": "", "title": title, "navigation": nav,
                      "authLinks": [{"label": "Login", "route": "login"}]},
        },
        "footer": {
            "id": "footer-1", "type": "footer", "enabled": True,
            "props": {
                "layout": "two-column",
                "leftSection": {"title": title, "text": " · ".join(footer_lines) or f"Welcome to {title}.", "socials": []},
                "rightSection": {"title": "Links", "links": [{"label": n["label"], "route": n["route"]} for n in nav]},
                "bottomNote": f"© {title}",
            },
        },
    }


def _example_props(section_type: str) -> Optional[Dict[str, Any]]:
    for c in _catalog().get("components") or []:
        if c.get("type") == section_type:
            return copy.deepcopy(c.get("exampleProps") or {})
    return None


# ── validation on top of the AI builder's own sanitisers ─────────────────
#: Blocks the editor offers that the composer's schema catalogue does not carry
#: (it lists what the AI may COMPOSE). Defaults mirror component-templates.ts;
#: `capabilities` is what website(action="schema") shows for them.
_EXTRA_COMPONENTS: List[Dict[str, Any]] = [
    {"type": "courseShowcase",
     "capabilities": "A strip of a FEW live courses: source newest | onSale | tag (with `tag`) | picked (with `courseIds`) "
                     "| comingSoon (courses the admin switched to Coming Soon — ribbon + Notify me lead button), "
                     "`limit` 1–12, layout row | grid. Prefer this over courseCatalog on a landing page; wire it later with "
                     "website_edit(set_courses).",
     "exampleProps": {"title": "New courses", "subtitle": "", "source": "newest", "tag": "", "courseIds": [],
                      "limit": 3, "layout": "row", "badgeText": "", "badgeTone": "hot"}},
    {"type": "productCourseGrid",
     "capabilities": "Every course in the institute as a plain grid (live data), with optional filters/search.",
     "exampleProps": {"title": "", "columns": 3, "layout": "grid", "showPrice": True, "showBadge": True, "showFilters": True}},
    {"type": "trustChip",
     "capabilities": "One line of reassurance — a certification, a count, a guarantee — with an icon name.",
     "exampleProps": {"text": "Trusted by 10,000+ learners", "icon": "ShieldCheck", "align": "center"}},
    {"type": "htmlPage",
     "capabilities": "A whole page authored as HTML + CSS, rendered in a shadow root with the site's theme tokens. "
                     "Use website_edit(add_html_page) rather than placing this in create_page; see html_page_contract.",
     "exampleProps": {"html": "", "css": ""}},
]


def authoring_catalog() -> Dict[str, Any]:
    """The composer's catalogue plus the editor-only blocks: what an authored page may contain."""
    from ..routers.page_builder import _load_catalog
    base = _load_catalog()
    known = {c.get("type") for c in base.get("components") or []}
    return {**base, "components": list(base.get("components") or []) + [c for c in _EXTRA_COMPONENTS if c["type"] not in known]}


_catalog = authoring_catalog


def _is_institute_asset(url: Any) -> bool:
    """Only media we host may be placed: our S3 bucket / CDN, or the media service."""
    if not isinstance(url, str) or not url.startswith("http"):
        return False
    from urllib.parse import urlparse
    from ..config import get_settings
    from .s3_url_utils import extract_s3_key
    st = get_settings()
    bucket = st.aws_bucket_name or getattr(st, "aws_s3_public_bucket", None)
    if bucket and extract_s3_key(url, bucket, st.cdn_public_base_url):
        return True
    host = (urlparse(url).hostname or "").lower()
    allowed_hosts = {h for h in ((urlparse(st.cdn_public_base_url or "").hostname or ""),
                                 (urlparse(st.media_server_base_url or "").hostname or "")) if h}
    # The media library serves through CloudFront in front of our buckets.
    return host in allowed_hosts or host.endswith(".amazonaws.com") or host.endswith(".cloudfront.net")


# Keys the sanitiser does NOT treat as image keys but whose institute URLs may
# still be placed: mediaShowcase media[].url / style.backgroundLayers[].url
# (checked by their own rules there). Everything else comes from the shared
# page_builder.is_image_key / is_image_list_key, so the allow-list can never
# drift from the stripper again (it did: `imageUrl` was stripped on every
# MCP-authored stream icon because only the stripper knew the key).
_EXTRA_IMAGE_PROP_KEYS = {"url"}


def _asset_urls_in(node: Any, out: set) -> set:
    """Every image-ish URL in a tree that is one of OUR assets (the allow-list for the sanitiser)."""
    from ..routers.page_builder import is_image_key, is_image_list_key
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, str) and (is_image_key(k) or str(k).lower() in _EXTRA_IMAGE_PROP_KEYS) and _is_institute_asset(v):
                out.add(v)
            elif isinstance(v, list) and is_image_list_key(k):
                out.update(u for u in v if isinstance(u, str) and _is_institute_asset(u))
                _asset_urls_in(v, out)
            else:
                _asset_urls_in(v, out)
    elif isinstance(node, list):
        for v in node:
            _asset_urls_in(v, out)
    return out


def finish_hero(page: Dict[str, Any], media: Optional[List[Dict[str, Any]]] = None) -> List[str]:
    """
    Deterministic polish the composer used to do: a split hero with no image
    either gets the first hero-worthy institute photo or falls back to a
    centered layout — never an empty half-fold. Returns notes.
    """
    notes: List[str] = []
    hero = next((c for c in page.get("components") or [] if isinstance(c, dict) and c.get("type") == "heroSection"), None)
    if hero is None:
        return notes
    p = hero.setdefault("props", {})
    right = p.get("right") if isinstance(p.get("right"), dict) else {}
    has_image = str(right.get("image") or "").startswith("http") or str(p.get("backgroundImage") or "").startswith("http")
    if has_image:
        return notes
    photo = next((m for m in media or [] if m.get("hero_worthy") and m.get("url") and m.get("kind_guess") != "logo"), None)
    if photo:
        p["right"] = {**right, "image": photo["url"], "alt": right.get("alt") or photo.get("name") or "campus"}
        if p.get("layout") not in ("split", "fullwidth"):
            p["layout"] = "split"
        notes.append(f"Placed the institute photo '{photo.get('name')}' in the hero.")
    elif p.get("layout") == "split":
        p["layout"] = "centered"
        notes.append("Hero had no image: switched to a centered layout so the fold is not half empty.")
    return notes


def _sanitize_authored_page(page: Dict[str, Any], page_type: str, global_settings: Optional[Dict[str, Any]],
                            fidelity: bool = False):
    """
    Run a caller-composed page through the builder's sanitiser and audit.

    Returns ``(clean_page, issues, warnings)`` or ``(None, issues, warnings)``
    when nothing usable survived. Unknown types, hostile HTML/CSS and foreign
    image URLs are stripped with a warning each; the audit says what a visitor
    would notice.
    """
    from ..routers.page_builder import (
        _MAX_HTML_BLOCKS_PER_PAGE, coerce_hex_color, resolve_dead_anchors, sanitize_component,
    )
    from ..services.page_audit import audit_page
    if not isinstance(page, dict) or not isinstance(page.get("components"), list):
        return None, [{"severity": "error", "code": "invalid_page", "message": "A page is {route, components:[…]}."}], []
    allowed = _asset_urls_in(page, set())
    allowed_types = {c["type"] for c in _catalog().get("components") or []}
    warnings: List[str] = []
    seen_ids: set = set()
    components: List[Dict[str, Any]] = []
    html_blocks = 0
    # The builder's per-component pass, minus its composer-only page rules: an
    # authored page may have ONE section (course-details templates do), and its
    # explicit paddings are intentional, not a model's over-tight rhythm.
    for original in page["components"]:
        if isinstance(original, dict) and original.get("type") == "htmlPage":
            props = original.get("props") if isinstance(original.get("props"), dict) else {}
            html_page, report = build_html_page(str(page.get("route") or "page"), props.get("html") or "", props.get("css"), None, None)
            if html_page is None:
                warnings.append("Dropped an htmlPage with no renderable HTML")
                continue
            comp = html_page["components"][0]
            comp["id"] = original.get("id") or comp["id"]
            if report.get("scripts_removed") or report.get("images_removed"):
                warnings.append(f"htmlPage '{comp['id']}': removed {report.get('scripts_removed', 0)} script(s), {report.get('images_removed', 0)} foreign image(s)")
            components.append(comp)
            continue
        cleaned = sanitize_component(original, allowed_types, False, seen_ids, allowed, warnings)
        if cleaned is None:
            continue
        if cleaned["type"] == "htmlBlock":
            html_blocks += 1
            if html_blocks > _MAX_HTML_BLOCKS_PER_PAGE:
                warnings.append(f"Dropped htmlBlock beyond the {_MAX_HTML_BLOCKS_PER_PAGE}-per-page cap")
                continue
        _restore_explicit_padding(original, cleaned, warnings)
        components.append(cleaned)
    if not components:
        return None, [{"severity": "error", "code": "empty_page",
                       "message": "No section survived validation — check the warnings and the schema."}], warnings
    resolve_dead_anchors(components, warnings)
    clean: Dict[str, Any] = {"id": page.get("id") or _new_id("page"), "components": components}
    page_bg = coerce_hex_color(page.get("backgroundColor"))
    if page_bg:
        clean["backgroundColor"] = page_bg
    if page.get("hideSiteChrome") is True:
        clean["hideSiteChrome"] = True
    clean["route"] = str(page.get("route") or clean.get("route") or "").strip("/ ") or "page"
    clean["title"] = page.get("title") or clean.get("title")
    seo = page.get("seo") if isinstance(page.get("seo"), dict) else {}
    clean["seo"] = {k: str(seo[k])[:170] for k in ("metaTitle", "metaDescription", "ogImage") if seo.get(k)}
    issues = _audit_issues(audit_page(clean, global_settings, page_type=page_type or "homepage", fidelity=fidelity,
                                      can_bind=True), fidelity)
    return clean, [i for i in issues if i["message"]], warnings


_PAD_KEYS = ("paddingTop", "paddingBottom")
_PAD_NOTE = "keeps the section's own vertical rhythm"


def _restore_explicit_padding(original: Any, cleaned: Dict[str, Any], warnings: List[str]) -> None:
    """The composer's small-padding rule does not apply to authored pages: put back what the author set."""
    style = original.get("style") if isinstance(original, dict) and isinstance(original.get("style"), dict) else {}
    restored = False
    for key in _PAD_KEYS:
        val = style.get(key)
        if isinstance(val, str) and re.fullmatch(r"\s*\d+(?:\.\d+)?px\s*", val) and key not in (cleaned.get("style") or {}):
            cleaned.setdefault("style", {})[key] = val.strip()
            restored = True
    if restored:
        warnings[:] = [w for w in warnings if _PAD_NOTE not in w or f"'{cleaned.get('type')}'" not in w]


# ── HTML pages (the builder's page-level contract: html_page_import) ────
HTML_PAGE_CONTRACT = (
    "An HTML page is ONE htmlPage section holding `html` (body markup; a full document is accepted — "
    "<head>, <script> and <link rel=stylesheet> are removed, <style> blocks move into `css`) and `css`. "
    "It renders in a shadow root: write self-contained CSS (`:root`/`body` selectors become the page "
    "host); the site's fonts/colours are NOT inherited, so set them. No JavaScript at all — nothing "
    "interactive except these hooks, which the site binds at runtime:\n"
    "  <a data-vacademy=\"route\" data-route=\"admissions\">  → another page of this site\n"
    "  <a data-vacademy=\"scroll\" data-target=\"faq\">        → scroll to id=faq\n"
    "  <a data-vacademy=\"lead-form\" data-audience=\"\">        → opens the enquiry form; leave data-audience "
    "empty and wire it with link_lead_form, or set an id from website(context)\n"
    "  <a data-vacademy=\"enrol\" data-course=\"<course id>\"> → enrol in a course\n"
    "  <a href=\"https://…\">                                → external link (http:// is upgraded)\n"
    "Plain relative links (about.html, /contact) are rewritten to route hooks automatically. Images: only "
    "institute media URLs (list_media / import_image); any other <img src> or CSS url() is removed. "
    "Forms/inputs are removed (no backend) — use the lead-form hook. Limits: 200 KB html, 150 KB css. "
    "hide_site_chrome defaults to true (your HTML usually brings its own nav/footer)."
)

_HTML_TITLE_RE = re.compile(r"<title\b[^>]*>(.*?)</title\s*>", re.I | re.S)
_HTML_H1_RE = re.compile(r"<h1\b[^>]*>(.*?)</h1\s*>", re.I | re.S)
_HTML_HEADING_RE = re.compile(r"<h[12]\b[^>]*>(.*?)</h[12]\s*>", re.I | re.S)
_HTML_LEAD_HOOK_RE = re.compile(r'data-vacademy=["\']lead-form["\']', re.I)


def _strip_foreign_images(html: str, report: Dict[str, Any]) -> str:
    """<img src> outside the institute's media → removed (structurally, via bs4)."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return html
    soup = BeautifulSoup(html, "html.parser")
    removed = 0
    for img in soup.find_all("img"):
        src = (img.get("src") or "").strip()
        if src and not _is_institute_asset(src):
            del img["src"]
            removed += 1
    for tag in soup.find_all(style=True):
        style = str(tag.get("style") or "")
        cleaned = _CSS_URL_LOCAL_RE.sub(lambda m: m.group(0) if _is_institute_asset(m.group(1)) else "none", style)
        if cleaned != style:
            tag["style"] = cleaned
            removed += 1
    if removed:
        report["images_removed"] = removed
    return str(soup)


_CSS_URL_LOCAL_RE = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", re.I)


def _scrub_css_urls(css: str, report: Dict[str, Any]) -> str:
    def _one(m):
        return m.group(0) if _is_institute_asset(m.group(1)) else "none"
    out = _CSS_URL_LOCAL_RE.sub(_one, css or "")
    dropped = len(_CSS_URL_LOCAL_RE.findall(css or "")) - len([u for u in _CSS_URL_LOCAL_RE.findall(out) if u != "none"])
    if dropped:
        report["css_urls_dropped"] = report.get("css_urls_dropped", 0) + dropped
    return out


def build_html_page(route: str, html: str, css: Optional[str], title: Optional[str], seo: Optional[Dict[str, Any]],
                    hide_site_chrome: bool = True) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """
    Author-supplied HTML/CSS → an htmlPage page, through the builder's page-level
    contract (scripts out, styles split, links → hooks, allowlist) plus this
    tool's asset rule (institute media only). Returns ``(page, report)``.
    """
    from .html_page_import import import_html_page, sanitize_page_html
    raw = str(html or "")
    title_m = _HTML_TITLE_RE.search(raw)
    body, split_css, report = import_html_page(raw)
    body = _strip_foreign_images(body, report)
    clean, used_nh3 = sanitize_page_html(body)
    if not used_nh3:
        report["sanitizer"] = "fallback"
    all_css = "\n".join(part for part in (split_css, str(css or "").strip()) if part)
    all_css = _scrub_css_urls(all_css, report)
    if not clean.strip():
        return None, report
    h1 = _HTML_H1_RE.search(clean)
    page_title = (title or "").strip() or (title_m and strip_html(title_m.group(1), 80)) or (h1 and strip_html(h1.group(1), 80)) or None
    seo = seo if isinstance(seo, dict) else {}
    page = {
        "id": _new_id("page"),
        "route": route,
        "title": page_title,
        "seo": {k: str(seo[k])[:170] for k in ("metaTitle", "metaDescription", "ogImage") if seo.get(k)},
        "hideSiteChrome": bool(hide_site_chrome),
        "components": [{"id": _new_id("htmlpage"), "type": "htmlPage", "enabled": True,
                        "props": {"html": clean, "css": all_css}}],
    }
    report["html_bytes"] = len(clean)
    report["css_bytes"] = len(all_css)
    report["lead_form_hooks"] = len(_HTML_LEAD_HOOK_RE.findall(clean))
    report["headings"] = [strip_html(h, 80) for h in _HTML_HEADING_RE.findall(clean)[:6]]
    return page, {k: v for k, v in report.items() if v not in (0, [], {}, None, False)}


async def _action_add_html_page(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if err := _require(args, "add_html_page", "route", "html"):
        return err
    route = _slugify(args["route"])
    site = None
    if args.get("tag_name"):
        site, err = await load_site(ctx, args["tag_name"])
        if err:
            return {**err, "action": "add_html_page"}
    elif not args.get("new_site_name"):
        tag, err = await resolve_tag(ctx, None)
        if tag:
            site, err = await load_site(ctx, tag)
        if site is None:
            return _err("missing_argument", action="add_html_page", needs=["tag_name or new_site_name"],
                        message=(err or {}).get("message"))
    if refusal := _stale_refusal(site, "add_html_page"):
        return refusal
    page, report = build_html_page(route, args["html"], args.get("css"), args.get("title"), args.get("seo"),
                                   args.get("hide_site_chrome", True) is not False)
    if page is None:
        return _err("invalid_html", message="Nothing renderable survived the HTML allowlist.", report=report)

    config = copy.deepcopy(site["config"]) if site else _new_site_config(None)
    existing = find_page(config, route)
    if existing is not None:
        is_html = any(c.get("type") == "htmlPage" for c in existing.get("components") or [])
        if args.get("replace_existing") and is_html:
            page["id"] = existing.get("id") or page["id"]
            config["pages"] = [page if p is existing else p for p in config["pages"]]
            summary = f"Replaced HTML page '{route}'."
        else:
            page["route"] = _unique_route(config, route)
            config.setdefault("pages", []).append(page)
            summary = f"Added HTML page '{page['route']}' (route '{route}' was taken)."
    else:
        config.setdefault("pages", []).append(page)
        summary = f"Added HTML page '{route}'."

    created = False
    if site is None:
        tag = _slugify(args["new_site_name"])
        config["globalSettings"]["layout"] = default_layout(_institute_name(ctx), config["pages"])
        if await create_site(ctx, tag, config) is None:
            return _err("create_failed", message=f"A site named '{tag}' could not be created (it may already exist).")
        site, err = await load_site(ctx, tag)
        if err:
            return err
        created = True
        summary = f"Created site '{tag}' with HTML page '{page['route']}'."
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    return _result(ctx, site, config, revision, summary, page["route"], page["components"][0]["id"],
                   created_site=created, import_report=report,
                   next=("Wire enquiry buttons with link_lead_form(section_id=<this section>) if data-audience was left empty; "
                         "images outside institute media were removed — use list_media / import_image."))


def _sanitize_authored_component(comp: Dict[str, Any], allow_chrome: bool, warnings: List[str]) -> Optional[Dict[str, Any]]:
    from ..routers.page_builder import sanitize_component
    allowed_types = {c["type"] for c in _catalog().get("components") or []} | {"header", "footer"}
    return sanitize_component(comp, allowed_types, allow_chrome, set(), _asset_urls_in(comp, set()), warnings)


def _sanitize_authored_ops(ops: List[Dict[str, Any]], page: Dict[str, Any]):
    """The builder's op sanitiser, fed the caller's ops instead of a model's."""
    from ..routers.page_builder import EditPageRequest, PageImage, _sanitize_ops
    allowed = _asset_urls_in(ops, set())
    req = EditPageRequest(page={"id": page.get("id"), "components": page.get("components") or []},
                          instruction="-", images=[PageImage(url=u) for u in sorted(allowed)])
    clean, _reply, warnings = _sanitize_ops(json.dumps({"ops": ops, "reply": ""}), req, _catalog())
    return clean, warnings


def _page_issues(config: Dict[str, Any], route: str) -> List[Dict[str, Any]]:
    """Publish checks for one page (the dashboard's), without ids the model cannot use."""
    r = str(route).lstrip("/").lower()
    return [{k: v for k, v in i.items() if k != "page_id"} for i in run_publish_checks(config)
            if not i.get("page_route") or str(i["page_route"]).lstrip("/").lower() == r]


def _new_site_config(theme: Optional[Dict[str, Any]], site_settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    config = {"version": "1.0", "globalSettings": copy.deepcopy(DEFAULT_GLOBAL_SETTINGS), "pages": []}
    if theme:
        config["globalSettings"] = merge_global_settings(config["globalSettings"], theme_to_global_patch(theme))
    if site_settings:
        config["globalSettings"] = merge_global_settings(config["globalSettings"], site_settings_to_global_patch(site_settings))
    return config


async def _action_create_page(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    page = args.get("page")
    if not isinstance(page, dict) or not isinstance(page.get("components"), list):
        return _err("missing_argument", action="create_page", needs=["page.components"],
                    hint="Compose the page per website(action='schema') first.")
    page_type = args.get("page_type") if args.get("page_type") in PAGE_TYPES else "homepage"
    theme = args.get("theme") if isinstance(args.get("theme"), dict) else None

    site = None
    if args.get("tag_name"):
        site, err = await load_site(ctx, args["tag_name"])
        if err:
            return {**err, "action": "create_page"}
    elif not args.get("new_site_name"):
        tag, err = await resolve_tag(ctx, None)
        if tag:
            site, err = await load_site(ctx, tag)
        if site is None:
            return _err("missing_argument", action="create_page", needs=["tag_name or new_site_name"],
                        message=(err or {}).get("message"))
    if refusal := _stale_refusal(site, "create_page"):
        return refusal

    site_settings = args.get("site_settings") if isinstance(args.get("site_settings"), dict) else None
    config = copy.deepcopy(site["config"]) if site else _new_site_config(theme, site_settings)
    if site and theme:
        config["globalSettings"] = merge_global_settings(config.get("globalSettings") or {}, theme_to_global_patch(theme))
    if site and site_settings:
        config["globalSettings"] = merge_global_settings(config.get("globalSettings") or {}, site_settings_to_global_patch(site_settings))
    design_source = clean_design_source(args.get("design_source") or page.get("design_source"))
    clean, issues, warnings = _sanitize_authored_page(page, page_type, config.get("globalSettings"), fidelity=bool(design_source))
    if clean is None:
        return _err("invalid_page", issues=issues, warnings=warnings[:12])
    _with_design_meta(clean, design_source, args.get("page_type"), page_type)
    warnings.extend(f"theme: {p} (left out)" for p in theme_problems(theme))
    from .assistant_tools_website import _load_media
    try:
        media = await _load_media(ctx, "any", 12)
    except Exception:  # noqa: BLE001
        media = []
    warnings.extend(finish_hero(clean, media))
    clean["id"] = clean.get("id") or _new_id("page")
    clean["route"] = _unique_route(config, clean["route"])
    config.setdefault("pages", []).append(clean)

    if site is None:
        tag = _slugify(args["new_site_name"])
        config["globalSettings"]["layout"] = default_layout(_institute_name(ctx), config["pages"])
        if await create_site(ctx, tag, config) is None:
            return _err("create_failed", message=f"A site named '{tag}' could not be created (it may already exist).")
        site, err = await load_site(ctx, tag)
        if err:
            return err
        created = True
    else:
        created = False
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    return _result(ctx, site, config, revision,
                   (f"Created site '{site['tag_name']}' with " if created else "Added ") +
                   f"page '{clean['route']}' ({len(clean['components'])} sections).",
                   clean["route"], created_site=created, page=summarize_page(clean),
                   page_type=(clean.get("meta") or {}).get("pageType") or page_type,
                   design_issues=issues[:20], warnings=warnings[:12],
                   **({"review_mode": "fidelity", "design_source": design_source,
                       "design_source_note": DESIGN_SOURCE_NOTE} if design_source else {}),
                   next="Fix the issues with update_page (ops), wire forms/courses with link_lead_form / set_courses, then ask the admin to review at editor_url.")


async def _action_create_site(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if err := _require(args, "create_site", "new_site_name", "pages"):
        return err
    pages_in = [p for p in args.get("pages") or [] if isinstance(p, dict)]
    if not pages_in:
        return _err("missing_argument", action="create_site", needs=["pages"])
    theme = args.get("theme") if isinstance(args.get("theme"), dict) else None
    config = _new_site_config(theme, args.get("site_settings") if isinstance(args.get("site_settings"), dict) else None)
    design_source = clean_design_source(args.get("design_source"))
    all_issues: Dict[str, Any] = {}
    all_warnings: List[str] = [f"theme: {p} (left out)" for p in theme_problems(theme)]
    page_sources: Dict[str, Dict[str, Any]] = {}
    for p in pages_in:
        page_type = "homepage" if not config["pages"] else "about"
        # A page may name its own frame (one design, several frames); else the site's design_source.
        page_source = clean_design_source(p.get("design_source")) or design_source
        clean, issues, warnings = _sanitize_authored_page(p, page_type, config["globalSettings"], fidelity=bool(page_source))
        all_warnings.extend(warnings)
        if clean is None:
            all_issues[str(p.get("route") or "?")] = issues
            continue
        _with_design_meta(clean, page_source, None, page_type)
        clean["id"] = clean.get("id") or _new_id("page")
        clean["route"] = _unique_route(config, clean["route"])
        config["pages"].append(clean)
        if page_source:
            page_sources[clean["route"]] = page_source
        if issues:
            all_issues[clean["route"]] = issues[:12]
    if not config["pages"]:
        return _err("invalid_page", issues=all_issues, warnings=all_warnings[:12])

    warnings: List[str] = []
    layout = default_layout(_institute_name(ctx), config["pages"])
    for key in ("header", "footer"):
        if isinstance(args.get(key), dict):
            cleaned = _sanitize_authored_component(args[key], True, warnings)
            if cleaned and cleaned.get("type") == key:
                layout[key] = cleaned
    config["globalSettings"]["layout"] = layout

    tag = _slugify(args["new_site_name"])
    if await create_site(ctx, tag, config) is None:
        return _err("create_failed", message=f"A site named '{tag}' could not be created (it may already exist).")
    site, err = await load_site(ctx, tag)
    if err:
        return err
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    return _result(ctx, site, config, revision,
                   f"Created site '{tag}' with {len(config['pages'])} pages: " + ", ".join(p["route"] for p in config["pages"]) + ".",
                   None, created_site=True,
                   pages=[{"route": p["route"], "sections": len(p["components"])} for p in config["pages"]],
                   design_issues=all_issues, warnings=(all_warnings + warnings)[:16],
                   **({"review_mode": "fidelity", "design_source": design_source or None,
                       "design_sources": page_sources, "design_source_note": DESIGN_SOURCE_NOTE} if page_sources else {}))


#: Explicit "clear" values only. None / "" mean "not given": clients that send every optional
#: parameter as null must not silently drop a page's design source.
_CLEAR_DESIGN_SOURCE = (False, "none", "clear")


def _set_page_design_source(config: Dict[str, Any], page: Dict[str, Any], raw: Any,
                            page_type: Optional[str]) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    """
    update_page(design_source=…) on an existing page: set it (the page is then
    reviewed in fidelity mode) or clear it ({clear: true} / false / 'none'). Returns
    (what changed, the cleaned design source) or (None, None) when unusable.
    """
    target = find_page(config, page.get("route"))
    if target is None:
        return None, None
    if (isinstance(raw, str) and raw.strip().lower() in _CLEAR_DESIGN_SOURCE) or raw is False \
            or (isinstance(raw, dict) and raw.get("clear") is True):
        meta = target.get("meta") if isinstance(target.get("meta"), dict) else {}
        meta = {k: v for k, v in meta.items() if k not in ("designSource", "pageType")}
        if meta:
            target["meta"] = meta
        else:
            target.pop("meta", None)
        return "design source cleared (standard review)", None
    ds = clean_design_source(raw)
    if not ds:
        return None, None
    pages = [p for p in config.get("pages") or [] if isinstance(p, dict)]
    # The type review would have guessed for this page (see website review).
    route = str(target.get("route") or "")
    guess = "homepage" if pages and pages[0] is target else ("course-landing" if "course" in route else "about")
    old_meta = target.get("meta") if isinstance(target.get("meta"), dict) else {}
    keep_type = old_meta.get("pageType") if old_meta.get("pageType") in PAGE_TYPES else None
    _with_design_meta(target, ds, page_type if page_type in PAGE_TYPES else keep_type, guess)
    return "design source set (fidelity review)", ds


async def _action_update_page(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    ops = args.get("ops")
    has_ops = isinstance(ops, list) and bool(ops)
    # null / "" / {} = not given (some clients send every optional parameter as null).
    set_design = args.get("design_source") not in (None, "", {})
    if not has_ops and not set_design:
        return _err("missing_argument", action="update_page", needs=["ops"],
                    hint="Or pass design_source to set or clear the design this page reproduces.")
    site, err = await _target_site(ctx, args, "update_page")
    if err:
        return err
    page = find_page(site["config"], args.get("page_route"))
    if page is None:
        return _err("unknown_page", available=[p.get("route") for p in site["config"].get("pages") or []])
    clean_ops: List[Dict[str, Any]] = []
    warnings: List[str] = []
    if has_ops:
        clean_ops, warnings = _sanitize_authored_ops([o for o in ops if isinstance(o, dict)][:_MAX_OPS], page)
        if not clean_ops:
            return _err("no_valid_ops", message="None of the ops could be applied.", warnings=warnings[:12])
        config = apply_ops(site["config"], page.get("id"), clean_ops)
    else:
        config = copy.deepcopy(site["config"])
    design_change, design_source = None, None
    if set_design:
        design_change, design_source = _set_page_design_source(config, page, args.get("design_source"), args.get("page_type"))
        if design_change is None:
            return _err("invalid_design_source",
                        message="design_source must be an https design link / {kind, url?, node_id?, frame?}, "
                                "or {clear: true} / 'none' to clear it.")
    new_page = find_page(config, page.get("route")) or page
    from ..services.page_audit import audit_page
    from .page_quality import review_mode
    page_type, fidelity = review_mode(new_page)
    issues = _audit_issues(audit_page(new_page, config.get("globalSettings"), page_type=page_type or "homepage",
                                      fidelity=fidelity, can_bind=True), fidelity)
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    changed = [f"{len(clean_ops)} change(s)"] if clean_ops else []
    if design_change:
        changed.append(design_change)
    extra: Dict[str, Any] = {}
    if design_change:
        extra["review_mode"] = "fidelity" if fidelity else "standard"
        if design_source:
            extra.update({"design_source": design_source, "design_source_note": DESIGN_SOURCE_NOTE})
    return _result(ctx, site, config, revision, f"Applied {' and '.join(changed)} to '{page.get('route')}'.",
                   page.get("route"), changes=describe_ops(clean_ops), page=summarize_page(new_page),
                   design_issues=issues[:20], warnings=warnings[:12], **extra)


async def _action_set_layout(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if not (isinstance(args.get("header"), dict) or isinstance(args.get("footer"), dict)):
        return _err("missing_argument", action="set_layout", needs=["header or footer"])
    site, err = await _target_site(ctx, args, "set_layout")
    if err:
        return err
    config = copy.deepcopy(site["config"])
    layout = dict((config.get("globalSettings") or {}).get("layout") or {})
    warnings: List[str] = []
    changed = []
    for key in ("header", "footer"):
        if isinstance(args.get(key), dict):
            comp = {**args[key], "type": key, "id": args[key].get("id") or f"{key}-1", "enabled": args[key].get("enabled", True)}
            cleaned = _sanitize_authored_component(comp, True, warnings)
            if cleaned:
                layout[key] = cleaned
                changed.append(key)
    if not changed:
        return _err("invalid_component", message="Neither header nor footer survived validation.", warnings=warnings[:12])
    config.setdefault("globalSettings", {})["layout"] = layout
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    return _result(ctx, site, config, revision, f"Updated the site's {' and '.join(changed)}.",
                   layout={k: summarize_component(v) for k, v in layout.items() if isinstance(v, dict)}, warnings=warnings[:12])


async def _action_add_section(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if err := _require(args, "add_section", "section_type"):
        return err
    section_type = str(args["section_type"])
    props = _example_props(section_type)
    if props is None:
        return _err("unknown_section_type", message=f"'{section_type}' is not a block type.",
                    hint="Use a type from the component catalogue, e.g. testimonialSection, faqSection, courseShowcase, leadForm.")
    site, err = await _target_site(ctx, args, "add_section")
    if err:
        return err
    config = copy.deepcopy(site["config"])
    page = find_page(config, args.get("page_route"))
    if page is None:
        return _err("unknown_page", available=[p.get("route") for p in config.get("pages") or []])
    # Wiring never comes from example props — a form pointing at a sample id
    # would look wired and be broken.
    for k in ("audienceId", "audienceName", "productPageCode", "productPageName"):
        if k in props:
            props[k] = ""
    overrides = args.get("props") if isinstance(args.get("props"), dict) else {}
    props.update({k: v for k, v in overrides.items() if k not in ("audienceId", "productPageCode")})
    comp = {"id": _new_id(section_type), "type": section_type, "enabled": True, "props": props}
    comps = page.setdefault("components", [])
    after = args.get("after_section_id")
    idx = next((i for i, c in enumerate(comps) if isinstance(c, dict) and c.get("id") == after), -1) if after else -1
    comps.insert(idx + 1 if idx >= 0 else len(comps), comp)
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    return _result(ctx, site, config, revision,
                   f"Added a {component_label(section_type)} section to '{page.get('route')}'.",
                   page.get("route"), comp["id"], section=summarize_component(comp),
                   hint="Use link_lead_form / set_courses to wire it, or edit_page to rewrite its content.")


async def _action_set_theme(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if err := _require(args, "set_theme", "theme"):
        return err
    accepted = {"preset": THEME_PRESETS, "primary_color": "#rrggbb", "mode": ["light", "dark"],
                "fonts": list(FONT_STACKS), "border_radius": BORDER_RADII,
                "heading_scale": HEADING_SCALES, "atmosphere": ATMOSPHERES, "motion": MOTIONS,
                "palette": list(PALETTE_KEYS) + ["apply_to_tokens"],
                "content_max_width": f"{CONTENT_WIDTH_MIN}-{CONTENT_WIDTH_MAX}"}
    if problems := theme_problems(args["theme"]):
        return _err("bad_request", message="Nothing was changed: " + " ".join(problems), problems=problems,
                    accepted=accepted)
    patch = theme_to_global_patch(args["theme"])
    if not patch:
        return _err("bad_request", message="Nothing in `theme` was a recognised setting.", accepted=accepted)
    site, err = await _target_site(ctx, args, "set_theme")
    if err:
        return err
    config = copy.deepcopy(site["config"])
    config["globalSettings"] = merge_global_settings(config.get("globalSettings") or {}, patch)
    if refusal := _palette_noop(patch, config["globalSettings"], accepted):
        return refusal
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    extra: Dict[str, Any] = {}
    if notes := _font_notes(config["globalSettings"]):
        extra["warnings"] = notes
    return _result(ctx, site, config, revision, "Updated the site's theme.",
                   settings=summarize_global_settings(config["globalSettings"]), **extra)


def _palette_noop(patch: Dict[str, Any], gs_after: Dict[str, Any], accepted: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    ``palette: {apply_to_tokens: true}`` on a site with no palette colours stores
    nothing (applyToTokens alone means nothing) — say so instead of reporting a
    theme change that did not happen.
    """
    palette = (patch.get("theme") or {}).get("palette")
    if not isinstance(palette, dict) or palette.get("applyToTokens") is not True:
        return None
    if any(palette.get(k) for k in PALETTE_KEYS) or isinstance((gs_after.get("theme") or {}).get("palette"), dict):
        return None
    return _err("bad_request", message=("Nothing was changed: this site has no palette colours, so apply_to_tokens has "
                                        "nothing to apply. Send the colours in the same call, e.g. palette: {primary: "
                                        "'#rrggbb', …, apply_to_tokens: true}."), accepted=accepted)


def _font_notes(gs: Dict[str, Any]) -> List[str]:
    """A separate heading font on a Devanagari site replaces the heading stack WITHOUT its Devanagari fallback."""
    i18n = gs.get("i18n") if isinstance(gs.get("i18n"), dict) else {}
    codes = {str(l.get("code") or "").lower() for l in i18n.get("locales") or [] if isinstance(l, dict)}
    codes.add(str(i18n.get("defaultLocale") or "").lower())
    heading = str((gs.get("fonts") or {}).get("headingFamily") or "")
    if codes & {"hi", "mr", "ne", "sa"} and heading and "devanagari" not in heading.lower():
        return [f"This site has a Devanagari language, and fonts.headingFamily ({heading}) has no Devanagari "
                "fallback — Hindi headings will fall back to a system face. Set only the body font "
                "(headings inherit it, with Noto Sans Devanagari added automatically)."]
    return []


async def _action_set_site_settings(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if err := _require(args, "set_site_settings", "site_settings"):
        return err
    patch = site_settings_to_global_patch(args["site_settings"])
    if not patch:
        return _err("bad_request", message="Nothing in `site_settings` was a recognised setting.")
    site, err = await _target_site(ctx, args, "set_site_settings")
    if err:
        return err
    config = copy.deepcopy(site["config"])
    config["globalSettings"] = merge_global_settings(config.get("globalSettings") or {}, patch)
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    return _result(ctx, site, config, revision, "Updated site settings: " + ", ".join(patch.keys()) + ".",
                   settings=summarize_global_settings(config["globalSettings"]))


_MAX_IMPORT_URLS = 16
_IMPORT_CONCURRENCY = 3
#: Images being validated in worker threads at once, across every request on
#: this pod. The memory-heavy part (decoding a source that must be shrunk) is
#: further limited to website_image_import.DECODE_SLOTS (1) inside the thread.
_IMPORT_SLOTS = asyncio.Semaphore(_IMPORT_CONCURRENCY)
_MEDIA_ORIGIN = "website_import_image"


def _figma_url_problem(url: str) -> Optional[str]:
    """Figma links that are NOT images get a useful refusal instead of a fetch.

    Only the remote Figma MCP's asset links (https://www.figma.com/api/mcp/asset/…)
    are files; a /design/ or /file/ link is the editor (a sign-in page to us), and
    the desktop MCP's http://localhost:3845/assets/… links live on the caller's
    machine."""
    from urllib.parse import urlsplit
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        port = parts.port
    except ValueError:
        return None
    if host in ("localhost", "127.0.0.1") and port == 3845:
        return ("That is a Figma desktop link on your own computer; this server cannot reach it. "
                "Send the file as data_base64 (with file_name) instead.")
    if host == "figma.com" or host.endswith(".figma.com"):
        if not parts.path.startswith("/api/mcp/asset/"):
            return ("That is a Figma page, not an image. Use the asset URLs from the Figma MCP "
                    "(https://www.figma.com/api/mcp/asset/…), or export the image and send it as data_base64.")
    return None


def _is_figma_asset(url: str) -> bool:
    from urllib.parse import urlsplit
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return (host == "figma.com" or host.endswith(".figma.com")) and parts.path.startswith("/api/mcp/asset/")


async def _action_import_image(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    raw_urls = [u for u in (args.get("urls") or []) if isinstance(u, str) and u.strip()]
    if args.get("data_base64") and (raw_urls or str(args.get("url") or "").strip()):
        # One source per call: silently ignoring one of them lost an image.
        return _err("bad_request", message="Send either url / urls or data_base64 (with file_name), not both — "
                                           "import the base64 file in its own call.")
    if raw_urls:
        urls = raw_urls[:_MAX_IMPORT_URLS]
        gate = asyncio.Semaphore(_IMPORT_CONCURRENCY)

        async def _one(u: str) -> Dict[str, Any]:
            async with gate:
                try:
                    res = await _import_one_image({**args, "url": u, "data_base64": None}, ctx)
                except Exception as exc:  # noqa: BLE001 — one bad file never loses the rest of the batch
                    logger.warning("import_image: %s failed: %r", u[:200], exc)
                    return {"error": "import_failed", "source": u,
                            "message": "This image could not be imported; the others were not affected."}
                return res if not res.get("error") else {**res, "source": u}

        results = await asyncio.gather(*[_one(u) for u in urls])
        out: Dict[str, Any] = {
            "imported": [r for r in results if not r.get("error")], "failed": [r for r in results if r.get("error")],
            "next": "Use the returned urls in the page (hero right.image, imageBlock, gallery).",
        }
        if len(raw_urls) > len(urls):
            out["skipped"] = raw_urls[len(urls):]
            out["note"] = f"At most {_MAX_IMPORT_URLS} images per call — send the skipped ones in another call."
        return out
    if not args.get("data_base64") and (err := _require(args, "import_image", "url")):
        return err
    return await _import_one_image(args, ctx)


async def _import_one_image(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    from .safe_http import SafeFetchError, safe_fetch
    from .website_image_import import (
        MAX_SOURCE_BYTES, ImageImportError, decode_base64_image, prepare_image,
    )

    source: Optional[str] = None
    declared = ""
    if args.get("data_base64"):
        try:
            raw = decode_base64_image(str(args["data_base64"]))
        except ImageImportError as exc:
            return _err(exc.code, message=exc.message)
        file_name = str(args.get("file_name") or "").strip()[:200] or None
    else:
        url = str(args.get("url") or "").strip()
        if not url.lower().startswith("https://"):
            return _err("bad_request", message=_figma_url_problem(url) or "Only https image URLs can be imported.")
        if problem := _figma_url_problem(url):
            return _err("bad_request", message=problem)
        try:
            fetched = await safe_fetch(url, max_bytes=MAX_SOURCE_BYTES, headers={"User-Agent": "VacademyImageImport/1.0"})
        except SafeFetchError as exc:
            if exc.code in ("blocked_host", "blocked_address", "bad_url"):
                return _err("bad_request", message="That address is not a public website." if exc.code != "bad_url" else exc.message)
            if exc.code == "too_large":
                return _err("too_large", message=f"Images over {MAX_SOURCE_BYTES // 1_000_000} MB cannot be imported.")
            logger.warning("import_image fetch failed for %s: %s", url[:200], exc.code)
            return _err("fetch_failed", message="The image could not be downloaded.")
        if fetched.status_code != 200 or not fetched.content:
            return _err("fetch_failed", message=f"The image could not be downloaded (HTTP {fetched.status_code}).")
        raw, declared, source, file_name = fetched.content, fetched.content_type, url, None

    kind = args.get("kind") if args.get("kind") in IMAGE_KINDS else "photo"
    try:
        async with _IMPORT_SLOTS:
            prepared = await asyncio.to_thread(prepare_image, raw, declared)
    except ImageImportError as exc:
        return _err(exc.code, message=exc.message)
    del raw

    # The same file imported again (a Figma asset re-read in a later session)
    # returns the copy we already host instead of storing a duplicate.
    existing = await asyncio.to_thread(_find_imported_media, ctx.principal.institute_id, prepared.sha256)
    if existing:
        stored, deduplicated = existing, True
    else:
        deduplicated = False
        try:
            from .s3_service import S3Service
            # Under the institute, so website(action='compare') can tell this institute's
            # imports from another's (it reads a reference image only from its own).
            key = f"page-builder/imports/{_s3_safe(ctx.principal.institute_id)}/{kind}-{uuid.uuid4().hex}.{prepared.ext}"
            stored = await asyncio.to_thread(
                S3Service().upload_file_content, prepared.data, f"{kind}.{prepared.ext}",
                s3_key=key, content_type=prepared.content_type,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("import_image upload failed: %s", exc)
            stored = None
        if not stored:
            return _err("upload_failed", message="The image was downloaded but could not be stored.")
        await asyncio.to_thread(_record_imported_media, ctx, stored, source, prepared, kind, args.get("caption"), file_name)

    out: Dict[str, Any] = {
        "url": stored, "source": source or (f"upload:{file_name}" if file_name else "upload"), "kind": kind,
        "caption": args.get("caption"), "bytes": len(prepared.data), "original_bytes": prepared.original_bytes,
        "sha256": prepared.sha256, "content_type": prepared.content_type,
        "width": prepared.width, "height": prepared.height,
        "next": "Use this url in the page JSON (hero right.image, imageBlock, gallery) or set_layout (header logo).",
    }
    if prepared.resized:
        out["resized"] = f"Downscaled to {prepared.width}x{prepared.height} WebP (from {prepared.original_bytes:,} bytes)."
    if deduplicated:
        out["deduplicated"] = True
    if source and _is_figma_asset(source):
        out["figma_asset"] = True
    return {k: v for k, v in out.items() if v is not None}


def _s3_safe(value: Any) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "", str(value or ""))[:64] or "unknown"


def _find_imported_media(institute_id: str, sha256: str) -> Optional[str]:
    """URL of an image this tool already imported for the institute with these exact source bytes."""
    try:
        from ..repositories.editor_media_asset_repository import EditorMediaAssetRepository
        row = EditorMediaAssetRepository().find_by_metadata(institute_id, origin=_MEDIA_ORIGIN, sha256=sha256)
        return row.url if row is not None and _is_institute_asset(row.url) else None
    except Exception as exc:  # noqa: BLE001 — the library is a convenience, never a reason to fail
        logger.info("import_image dedup lookup skipped: %s", exc)
        return None


def _record_imported_media(ctx: ToolContext, url: str, source: Optional[str], prepared: Any, kind: str,
                           caption: Any, file_name: Optional[str]) -> None:
    """Add the import to the institute's editor media library (best effort)."""
    try:
        from ..repositories.editor_media_asset_repository import EditorMediaAssetRepository
        EditorMediaAssetRepository().create(
            institute_id=ctx.principal.institute_id,
            url=url,
            kind="image",
            source="upload",
            source_url=source,
            width=prepared.width,
            height=prepared.height,
            created_by_user_id=ctx.principal.user_id,
            tags=["website", kind],
            metadata={
                "origin": _MEDIA_ORIGIN, "sha256": prepared.sha256, "content_type": prepared.content_type,
                "bytes": len(prepared.data), "original_bytes": prepared.original_bytes,
                **({"caption": str(caption)[:300]} if caption else {}),
                **({"file_name": file_name} if file_name else {}),
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("import_image media-library record skipped: %s", exc)


async def _action_set_courses(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if err := _require(args, "set_courses", "section_id", "source"):
        return err
    site, err = await _target_site(ctx, args, "set_courses")
    if err:
        return err
    config = copy.deepcopy(site["config"])
    page = find_page(config, args.get("page_route"))
    if page is None:
        return _err("unknown_page", available=[p.get("route") for p in config.get("pages") or []])
    comp = find_component(page, str(args["section_id"]))
    if comp is None:
        return _err("unknown_section", message="No section with that id on this page.")
    source = args["source"]
    props = comp.setdefault("props", {})
    if source == "all":
        comp["type"] = "courseCatalog" if comp.get("type") not in ("courseCatalog", "productCourseGrid") else comp["type"]
        props.setdefault("showFilters", True)
        summary = "shows every course in the institute (live)"
    elif source == "showcase":
        mode = args.get("mode") or "newest"
        if mode not in ("newest", "onSale", "tag", "picked", "comingSoon"):
            return _err("bad_request", message="mode must be newest, onSale, tag, picked or comingSoon.")
        ids = [str(i) for i in args.get("course_ids") or []]
        if mode == "picked":
            if not ids:
                return _err("missing_argument", needs=["course_ids"])
            all_courses = await load_courses(ctx, limit=200)
            known = {c.get("id") for c in all_courses}
            for c in all_courses:
                known.update(c.get("package_session_ids") or [])
            bad = [i for i in ids if i not in known]
            if bad:
                return _err("unknown_course", message="These course ids are not this institute's.", ids=bad,
                            hint="Take ids from website(action='context').")
        if mode == "tag" and not args.get("tag"):
            return _err("missing_argument", needs=["tag"])
        comp["type"] = "courseShowcase"
        props.update({"source": mode, "courseIds": ids if mode == "picked" else [], "tag": args.get("tag") or "",
                      "limit": max(1, min(int(args.get("limit") or 3), 12))})
        summary = f"shows {mode} courses (limit {props['limit']})"
    else:  # product_page
        code = str(args.get("product_page_code") or "").strip()
        if not code:
            return _err("missing_argument", needs=["product_page_code"])
        pages = await load_product_pages(ctx)
        match = next((p for p in pages if str(p.get("code") or "").lower() == code.lower()), None)
        if match is None:
            return _err("unknown_product_page", message="No product page with that code for this institute.",
                        available=[p.get("code") for p in pages][:20])
        comp["type"] = "productPageOffer"
        props.update({"productPageCode": match["code"], "productPageName": match.get("name") or ""})
        summary = f"shows courses from product page '{match.get('name') or match['code']}'"
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    return _result(ctx, site, config, revision, f"Section {comp['id']} now {summary}.",
                   page.get("route"), comp["id"], section=summarize_component(comp))


async def _action_link_lead_form(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if err := _require(args, "link_lead_form", "section_id", "audience_id"):
        return err
    audience_id = str(args["audience_id"]).strip()
    campaign = await get_campaign(ctx, audience_id)
    if campaign is None:
        return _err("unknown_campaign", message="No such lead campaign for this institute.",
                    hint="Take ids from website(action='context') or audience_forms(action='list').")
    if str(campaign.get("status") or "ACTIVE").upper() != "ACTIVE":
        return _err("campaign_inactive", message=f"Campaign '{campaign.get('campaign_name')}' is {campaign.get('status')}; only ACTIVE campaigns receive leads.")
    site, err = await _target_site(ctx, args, "link_lead_form")
    if err:
        return err
    config = copy.deepcopy(site["config"])
    section_id = str(args["section_id"]).strip()
    chrome = section_id in ("header", "footer")
    page = comp = None
    if args.get("page_route") or not chrome:
        # A named page is searched on its own: never a silent fall back to the site chrome.
        page = find_page(config, args.get("page_route"))
        if page is None:
            return _err("unknown_page", available=[p.get("route") for p in config.get("pages") or []])
        comp = find_component(page, section_id)
    else:
        # 'header' / 'footer' with no page_route: the site chrome in
        # globalSettings.layout; else (as before) a section with that id on the first page.
        layout = (config.get("globalSettings") or {}).get("layout")
        comp = layout.get(section_id) if isinstance(layout, dict) else None
        if not isinstance(comp, dict):
            page = find_page(config, None)
            comp = find_component(page, section_id) if page is not None else None
            if comp is None:
                return _err("unknown_section", message=f"This site has no {section_id} in its layout.")
    if comp is None:
        return _err("unknown_section", message="No section with that id on this page.")
    # Surfaces wired in the data (a folder library's categories) have no page prop to set.
    surfaces = [s for s in capture_surfaces(comp) if s.get("path")]
    surface_path = str(args.get("surface_path") or "").strip()
    if surface_path and comp.get("type") != "htmlPage":
        surfaces = [s for s in surfaces if s["path"] == surface_path]
        if not surfaces:
            return _err("unknown_surface", message="No form at that surface_path in this section.",
                        available=[s["path"] for s in capture_surfaces(comp) if s.get("path")],
                        hint="Take surface_path from website(action='lead_summary').")
    name = str(campaign.get("campaign_name") or "")
    props = comp.setdefault("props", {})
    if comp.get("type") == "htmlPage":
        html, n = _wire_html_lead_hooks(str(props.get("html") or ""), audience_id)
        if not n:
            return _err("not_a_form", message="This HTML page has no lead-form hook (<a data-vacademy=\"lead-form\">) to wire.")
        props["html"] = html
        wired = f"{n} lead-form hook(s)"
        surfaces = None
    elif not surfaces:
        # Not a capture block: make its primary button open the campaign's form,
        # the same choice the editor offers on hero / CTA buttons.
        button = props.get("button") if isinstance(props.get("button"), dict) else None
        if button is not None and page is not None:
            button.update({"action": "openForm", "audienceId": audience_id})
            wired = f"its button '{button.get('text') or ''}'"
        else:
            return _err("not_a_form", message=f"Section {comp.get('id') or section_id} ({component_label(comp.get('type'))}) has no form or button to wire.")
    elif surfaces:
        wired_labels = []
        for s in surfaces:
            _set_path(comp, s["path"], audience_id)
            if s.get("name_path"):
                _set_path(comp, s["name_path"], name)
            elif s["kind"] == "form_section":
                props["audienceName"] = name
            wired_labels.append(s["label"])
        wired = ", ".join(wired_labels)
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    if page is None:
        return _result(ctx, site, config, revision,
                       f"Site {section_id}: {wired} now sends enquiries to campaign '{name}'.",
                       None, None, campaign={"id": audience_id, "name": name}, section=summarize_component(comp))
    return _result(ctx, site, config, revision,
                   f"{component_label(comp.get('type'))} on '{page.get('route')}': {wired} now sends enquiries to campaign '{name}'.",
                   page.get("route"), comp["id"], campaign={"id": audience_id, "name": name})


def _wire_html_lead_hooks(html: str, audience_id: str) -> Tuple[str, int]:
    """Set data-audience on every lead-form hook in an HTML page. Structural (bs4), never regex-rewritten."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return html, 0
    soup = BeautifulSoup(html, "html.parser")
    n = 0
    for el in soup.find_all(attrs={"data-vacademy": "lead-form"}):
        el["data-audience"] = audience_id
        n += 1
    return (str(soup) if n else html), n


def _set_path(comp: Dict[str, Any], path: str, value: Any) -> None:
    """Set ``props.left.buttons[0].audienceId``-style paths produced by capture_surfaces."""
    node: Any = comp
    parts = re.findall(r"([A-Za-z_]+)|\[(\d+)\]", path)
    keys = [k or int(i) for k, i in parts]
    for k in keys[:-1]:
        node = node[k] if isinstance(k, int) else node.setdefault(k, {})
    last = keys[-1]
    if isinstance(last, int):
        node[last] = value
    else:
        node[last] = value


async def _action_set_seo(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if not (args.get("meta_title") or args.get("meta_description")):
        return _err("missing_argument", action="set_seo", needs=["meta_title or meta_description"])
    site, err = await _target_site(ctx, args, "set_seo")
    if err:
        return err
    config = copy.deepcopy(site["config"])
    page = find_page(config, args.get("page_route"))
    if page is None:
        return _err("unknown_page", available=[p.get("route") for p in config.get("pages") or []])
    seo = page.setdefault("seo", {}) if isinstance(page.get("seo"), dict) else {}
    page["seo"] = seo
    if args.get("meta_title"):
        seo["metaTitle"] = str(args["meta_title"])[:70]
    if args.get("meta_description"):
        seo["metaDescription"] = str(args["meta_description"])[:170]
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    return _result(ctx, site, config, revision, f"Updated SEO for '{page.get('route')}'.", page.get("route"),
                   seo={"meta_title": seo.get("metaTitle"), "meta_description": seo.get("metaDescription")})


async def _action_discard_draft(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    # Not _target_site: discarding is the way out of a stale draft.
    site, err = await load_site(ctx, args.get("tag_name"))
    if err:
        return {**err, "action": "discard_draft"}
    if not site["from_draft"] and not site.get("stale_draft"):
        return {"tag_name": site["tag_name"], "summary_of_change": "There was no draft to discard.", "saved_as": None}
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/course-catalogue/revision/discard-draft",
        params={"catalogueId": site["catalogue_id"]},
    )
    if _is_error(data) and data.get("status") not in (200, 204):
        return _err("discard_failed", message="The draft could not be discarded.")
    return {"tag_name": site["tag_name"], "summary_of_change": "Draft discarded; the site is back to its published version.",
            "editor_url": site_editor_url(site["tag_name"], ctx=ctx)}


# ── catalogue settings (formats, languages, naming, site cart) ───────────
_FORMAT_KEY_RE = re.compile(r"^[a-z0-9-]{1,32}$")
_LANG_CODE_RE = re.compile(r"^[a-z0-9-]{1,12}$")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_ANY_TAG_RE = re.compile(r"<[^>]*>")
_MAX_FORMATS = 20
_MAX_LANGUAGES = 8
_MAX_VERSION_GROUPS = 100
_MAX_GROUP_SIZE = 6
_NAMING_KEYS = {"level": "level", "level_plural": "levelPlural", "course": "course", "course_plural": "coursePlural",
                "session": "session", "session_plural": "sessionPlural"}
_CATALOG_SETTING_KEYS = ("course_formats", "course_format_order", "course_languages", "naming", "site_cart")


def _plain_text(value: Any, cap: int) -> Optional[str]:
    """One line of visitor text: markup and control characters removed, whitespace collapsed; None when empty."""
    if not isinstance(value, str):
        return None
    text = re.sub(r"\s+", " ", _CONTROL_RE.sub("", _ANY_TAG_RE.sub("", value))).strip()
    return text[:cap] if text else None


def _word_list(raw: Any, cap_items: int, cap_chars: int, no_commas: bool = False) -> Optional[List[str]]:
    """A list of short words (level names, tags, match words) or None when it is not one."""
    if not isinstance(raw, list) or len(raw) > cap_items:
        return None
    out: List[str] = []
    for item in raw:
        word = _plain_text(item, cap_chars)
        if word is None or (no_commas and "," in word):
            return None
        if word not in out:
            out.append(word)
    return out


def catalog_settings_patch(si: Any, gs: Dict[str, Any], course_ids: Optional[set],
                           product_pages: Optional[List[Dict[str, Any]]]) -> Tuple[Dict[str, Any], List[str], List[str]]:
    """
    ``catalog_settings`` argument → ``(globalSettings patch, problems, notes)``.

    Pure. Any problem refuses the whole change (nothing half-applied). Maps
    merge key by key and a null removes a key; lists replace. ``course_ids``
    (the institute's course ids) is needed only for version groups and
    ``product_pages`` only for the site cart — the caller loads them when asked.
    """
    si = si if isinstance(si, dict) else {}
    patch: Dict[str, Any] = {}
    problems: List[str] = [f"Unknown setting '{k}'." for k in si if k not in _CATALOG_SETTING_KEYS]
    notes: List[str] = []

    # course formats: key → {label, levels?, tags?} | null
    current_formats = gs.get("courseFormats") if isinstance(gs.get("courseFormats"), dict) else {}
    formats_after = {str(k).lower(): v for k, v in current_formats.items()}
    if "course_formats" in si:
        raw = si["course_formats"]
        if not isinstance(raw, dict) or not raw:
            problems.append("course_formats must be an object: {key: {label, levels?, tags?} | null}.")
        else:
            out: Dict[str, Any] = {}
            for key_in, fmt in raw.items():
                key = str(key_in).strip().lower()
                if not _FORMAT_KEY_RE.match(key):
                    problems.append(f"Format key '{key_in}' must be a slug (a-z, 0-9, -; at most 32).")
                    continue
                # The site renders format keys case-insensitively: a key saved as 'Ebook' (by hand
                # or an import) IS 'ebook', so it is removed / replaced whatever its case.
                for stored in current_formats:
                    if stored != key and str(stored).strip().lower() == key:
                        out[stored] = None
                if fmt is None:
                    out[key] = None
                    formats_after.pop(key, None)
                    continue
                label = _plain_text(fmt.get("label"), 60) if isinstance(fmt, dict) else None
                if label is None:
                    problems.append(f"Format '{key}' needs a label (the text visitors see, at most 60 characters).")
                    continue
                entry: Dict[str, Any] = {"label": label}
                for part, cap in (("levels", 60), ("tags", 191)):
                    if part not in fmt:
                        continue
                    words = _word_list(fmt[part], 20, cap, no_commas=(part == "tags"))
                    if words is None:
                        problems.append(f"Format '{key}'.{part} must be a list of at most 20 short texts"
                                        + (" without commas." if part == "tags" else "."))
                    elif words:
                        entry[part] = words
                out[key] = entry
                formats_after[key] = entry
            if len(formats_after) > _MAX_FORMATS:
                problems.append(f"A site has at most {_MAX_FORMATS} course formats ({len(formats_after)} after this change).")
            if out:
                patch["courseFormats"] = out
    if "course_format_order" in si:
        order = si["course_format_order"]
        if not isinstance(order, list) or len(order) > _MAX_FORMATS:
            problems.append(f"course_format_order must be a list of at most {_MAX_FORMATS} format keys.")
        else:
            keys = []
            for k in order:
                key = str(k).strip().lower()
                if key not in formats_after:
                    problems.append(f"course_format_order names '{k}', which is not one of the site's formats "
                                    f"({sorted(formats_after)}).")
                elif key not in keys:
                    keys.append(key)
            patch["courseFormatOrder"] = keys

    # course languages: {enabled?, languages?, version_groups?}
    if "course_languages" in si:
        raw = si["course_languages"]
        if not isinstance(raw, dict) or not raw:
            problems.append("course_languages must be an object: {enabled?, languages?, version_groups?}.")
        else:
            out = {}
            if "enabled" in raw:
                if isinstance(raw["enabled"], bool):
                    out["enabled"] = raw["enabled"]
                else:
                    problems.append("course_languages.enabled must be true or false.")
            if "languages" in raw:
                langs = raw["languages"]
                if not isinstance(langs, list) or not langs or len(langs) > _MAX_LANGUAGES:
                    problems.append(f"course_languages.languages must list 1–{_MAX_LANGUAGES} languages.")
                else:
                    clean_langs: List[Dict[str, Any]] = []
                    for i, lang in enumerate(langs):
                        lang = lang if isinstance(lang, dict) else {}
                        code = str(lang.get("code") or "").strip().lower()
                        label = _plain_text(lang.get("label"), 40)
                        if not _LANG_CODE_RE.match(code) or label is None:
                            problems.append(f"Language {i + 1} needs a code (a-z, 0-9, -, e.g. 'hi') and a label (e.g. 'Hindi').")
                            continue
                        if any(c["code"] == code for c in clean_langs):
                            problems.append(f"The language code '{code}' is used twice.")
                            continue
                        item: Dict[str, Any] = {"code": code, "label": label}
                        chip = _plain_text(lang.get("chip"), 8)
                        if chip:
                            item["chip"] = chip
                        if "match" in lang:
                            words = _word_list(lang["match"], 12, 40)
                            if words is None:
                                problems.append(f"Language '{code}'.match must be a list of at most 12 words.")
                            elif words:
                                item["match"] = words
                        clean_langs.append(item)
                    out["languages"] = clean_langs
            if "version_groups" in raw:
                groups = raw["version_groups"]
                if groups is None or groups == []:
                    out["versionGroups"] = None
                elif not isinstance(groups, list) or len(groups) > _MAX_VERSION_GROUPS:
                    problems.append(f"version_groups must be a list of at most {_MAX_VERSION_GROUPS} groups.")
                else:
                    seen: Dict[str, int] = {}
                    clean_groups: List[List[str]] = []
                    unknown: List[str] = []
                    for gi, group in enumerate(groups):
                        ids = [str(x).strip() for x in group] if isinstance(group, list) else []
                        if len(ids) < 2 or len(ids) > _MAX_GROUP_SIZE or len(set(ids)) != len(ids) or not all(ids):
                            problems.append(f"version_groups[{gi}] must list 2–{_MAX_GROUP_SIZE} different course ids "
                                            "(the same course in different languages).")
                            continue
                        for cid in ids:
                            if cid in seen:
                                problems.append(f"Course {cid} is in version_groups[{seen[cid]}] and [{gi}]; a course "
                                                "belongs to one group.")
                            seen[cid] = gi
                            if course_ids is not None and cid not in course_ids:
                                unknown.append(cid)
                        clean_groups.append(ids)
                    if unknown:
                        problems.append(f"These course ids are not this institute's: {unknown[:10]}. Take ids from "
                                        "website(action='context').")
                    out["versionGroups"] = clean_groups
                    current = gs.get("courseLanguages") if isinstance(gs.get("courseLanguages"), dict) else {}
                    if not out.get("enabled", current.get("enabled")):
                        notes.append("version_groups fold into one card only while course_languages.enabled is true.")
            if out:
                patch["courseLanguages"] = out

    # naming: the catalogue's own words ({level: 'Format'})
    if "naming" in si:
        raw = si["naming"]
        if not isinstance(raw, dict) or not raw:
            problems.append(f"naming must be an object with any of {sorted(_NAMING_KEYS)}.")
        else:
            out = {}
            for k, v in raw.items():
                key = _NAMING_KEYS.get(k) or (k if k in _NAMING_KEYS.values() else None)
                if key is None:
                    problems.append(f"Unknown naming key '{k}' (use {sorted(_NAMING_KEYS)}).")
                elif v is None:
                    out[key] = None
                elif (word := _plain_text(v, 40)) is None:
                    problems.append(f"naming.{k} must be a short text.")
                else:
                    out[key] = word
            if out:
                patch["naming"] = out

    # site cart: one cart for the whole site, checked out through a STORE product page
    if "site_cart" in si:
        raw = si["site_cart"]
        current = gs.get("siteCart") if isinstance(gs.get("siteCart"), dict) else {}
        if not isinstance(raw, dict) or not isinstance(raw.get("enabled"), bool):
            problems.append("site_cart must be {enabled: true|false, store_product_page_code?}.")
        elif raw["enabled"] is False:
            patch["siteCart"] = {"enabled": False}
        else:
            code = str(raw.get("store_product_page_code") or current.get("storeProductPageCode") or "").strip()
            match = next((p for p in product_pages or [] if str(p.get("code") or "").lower() == code.lower()), None) if code else None
            if not code:
                problems.append("site_cart needs store_product_page_code: the product page whose checkout takes the cart.")
            elif match is None:
                problems.append(f"No product page with code '{code}' for this institute. Take codes from website(action='context').")
            else:
                patch["siteCart"] = {"enabled": True, "storeProductPageCode": match["code"],
                                     "storeProductPageName": match.get("name") or ""}
                if str(match.get("status") or "ACTIVE").upper() != "ACTIVE":
                    notes.append(f"Product page '{match.get('name') or match['code']}' is {match.get('status')}: the cart's "
                                 "checkout works once an admin activates it.")
    if not si:
        problems.append("catalog_settings is empty.")
    return patch, problems, notes


_OWNED_COURSES_SQL = """
SELECT p.id FROM package p
JOIN package_institute pi ON pi.package_id = p.id
WHERE pi.institute_id = :inst AND p.id IN :ids AND p.status <> 'DELETED'
"""


def owned_course_ids(ctx: ToolContext, ids: set) -> Optional[set]:
    """
    Which of ``ids`` are this institute's courses (any status but deleted, listed
    in the learner catalogue or not) — the admin's view, not the public search.
    None when the lookup failed, so an outage is never reported as "not yours".
    """
    from sqlalchemy import bindparam, text
    wanted = sorted(i for i in ids if i)[: _MAX_VERSION_GROUPS * _MAX_GROUP_SIZE]
    if not wanted:
        return set()
    try:
        stmt = text(_OWNED_COURSES_SQL).bindparams(bindparam("ids", expanding=True))
        rows = ctx.db.execute(stmt, {"inst": ctx.principal.institute_id, "ids": wanted}).fetchall()
        return {str(r[0]) for r in rows}
    except Exception as exc:  # noqa: BLE001
        logger.warning("course ownership lookup failed: %s", exc)
        try:
            ctx.db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None


async def _action_set_catalog_settings(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if err := _require(args, "set_catalog_settings", "catalog_settings"):
        return err
    si = args["catalog_settings"]
    if not isinstance(si, dict):
        return _err("bad_request", message="catalog_settings must be an object.")
    site, err = await _target_site(ctx, args, "set_catalog_settings")
    if err:
        return err
    config = copy.deepcopy(site["config"])
    gs = config.get("globalSettings") or {}
    course_ids: Optional[set] = None
    groups = si["course_languages"].get("version_groups") if isinstance(si.get("course_languages"), dict) else None
    if groups:
        wanted = {str(x).strip() for g in groups if isinstance(g, list) for x in g}
        course_ids = owned_course_ids(ctx, wanted)
        if course_ids is None:
            return _err("fetch_failed", message="The institute's courses could not be checked right now; nothing was changed. Try again shortly.")
    pages = await load_product_pages(ctx) if isinstance(si.get("site_cart"), dict) and si["site_cart"].get("enabled") else None
    patch, problems, notes = catalog_settings_patch(si, gs, course_ids, pages)
    if problems:
        return _err("bad_request", message="Nothing was changed: " + " ".join(problems[:8]), problems=problems[:20])
    if not patch:
        return _err("bad_request", message="Nothing in `catalog_settings` was a recognised setting.")
    config["globalSettings"] = merge_global_settings(gs, patch)
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    extra: Dict[str, Any] = {"notes": notes} if notes else {}
    return _result(ctx, site, config, revision, "Updated catalogue settings: " + ", ".join(patch.keys()) + ".",
                   settings=summarize_global_settings(config["globalSettings"]), **extra)


# ── translations (globalSettings.i18n.strings[locale]) ───────────────────
_MAX_TRANSLATIONS = 3000
_MAX_TRANSLATION_BYTES = 120_000
_MAX_CHANGES_PER_CALL = 1500
#: Same as the dashboard's Translations panel (site-strings.ts DEFAULT_BATCH_LIMITS.maxStringChars):
#: a text it translates can be saved here too.
_MAX_SOURCE_CHARS = 30000
_MAX_TRANSLATION_CHARS = 30000
#: What the language switcher shows by default (admin i18n/locales.ts LOCALE_LABELS).
LOCALE_LABELS = {
    "en": "English", "ar": "العربية", "hi": "हिन्दी", "ta": "தமிழ்", "te": "తెలుగు", "bn": "বাংলা", "mr": "मराठी",
    "gu": "ગુજરાતી", "kn": "ಕನ್ನಡ", "ml": "മലയാളം", "pa": "ਪੰਜਾਬੀ", "or": "ଓଡ଼ିଆ", "as": "অসমীয়া", "es": "Español",
    "fr": "Français",
}


def _clean_translation(source: str, value: str) -> str:
    """A translation is text: markup is stripped unless the source itself is rich text (then nh3-sanitised)."""
    from ..routers.page_builder import _RICH_TEXT_RE, _sanitize_html
    value = _CONTROL_RE.sub("", value)
    if _RICH_TEXT_RE.search(source):
        return _sanitize_html(value)
    return _ANY_TAG_RE.sub("", value)


def merge_translations(current: Any, changes: Dict[Any, Any]) -> Tuple[Dict[str, str], Dict[str, Any]]:
    """
    Pure: ``changes`` (source → translation | null) merged into one locale's
    dictionary. null or "" removes an entry; a translation equal to its source
    keeps the text as is in that language (stored, so it stops counting as
    missing — the panel's "Same as base"). Nothing else is ever removed.
    """
    out: Dict[str, str] = {str(k): v for k, v in (current or {}).items() if isinstance(v, str)} if isinstance(current, dict) else {}
    report: Dict[str, Any] = {"added": 0, "updated": 0, "removed": 0, "kept_as_base": 0, "unchanged": 0, "skipped": []}
    for source, value in changes.items():
        if not isinstance(source, str) or not source.strip() or len(source) > _MAX_SOURCE_CHARS:
            report["skipped"].append({"source": str(source)[:80], "reason": "not a site text (empty or too long)"})
            continue
        if value is None or value == "":
            if source in out:
                del out[source]
                report["removed"] += 1
            continue
        if not isinstance(value, str):
            report["skipped"].append({"source": source[:80], "reason": "translation must be text"})
            continue
        clean = _clean_translation(source, value)
        if not clean.strip():
            report["skipped"].append({"source": source[:80], "reason": "nothing left after removing markup"})
            continue
        if len(clean) > _MAX_TRANSLATION_CHARS:
            report["skipped"].append({"source": source[:80], "reason": f"longer than {_MAX_TRANSLATION_CHARS} characters"})
            continue
        if out.get(source) == clean:
            report["unchanged"] += 1
            continue
        report["kept_as_base" if clean == source else ("updated" if source in out else "added")] += 1
        out[source] = clean
    return out, report


async def _action_set_translations(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    from .site_strings import base_locale_of, collect_site_strings, missing_translations
    if err := _require(args, "set_translations", "locale"):
        return err
    locale = str(args["locale"]).strip().lower()
    if not _LANG_CODE_RE.match(locale):
        return _err("bad_request", message="locale must be a language code such as 'hi' (a-z, 0-9, -).")
    changes = args.get("strings")
    if changes is None and args.get("enable") is None:
        return _err("missing_argument", action="set_translations", needs=["strings or enable"])
    changes = changes if changes is not None else {}
    if not isinstance(changes, dict):
        return _err("bad_request", message="strings must be an object: {exact source text: translation | null}.")
    if len(changes) > _MAX_CHANGES_PER_CALL:
        return _err("bad_request", message=f"Send at most {_MAX_CHANGES_PER_CALL} translations per call.")
    site, err = await _target_site(ctx, args, "set_translations")
    if err:
        return err
    config = copy.deepcopy(site["config"])
    gs = config.setdefault("globalSettings", {})
    i18n = copy.deepcopy(gs.get("i18n")) if isinstance(gs.get("i18n"), dict) else {}
    base = base_locale_of(i18n)
    if locale == base:
        return _err("base_locale", message=f"'{locale}' is this site's base language: its texts are edited on the pages.")
    strings_all = i18n.get("strings") if isinstance(i18n.get("strings"), dict) else {}
    current = strings_all.get(locale) if isinstance(strings_all.get(locale), dict) else {}
    merged, report = merge_translations(current, changes)
    size = len(json.dumps(merged, ensure_ascii=False).encode("utf-8"))
    # A dictionary built in the dashboard may already be past the caps: any change
    # that does not grow it (a removal, a shorter translation) is still allowed.
    grows = len(merged) > len(current) or size > len(json.dumps(current, ensure_ascii=False).encode("utf-8"))
    if (len(merged) > _MAX_TRANSLATIONS or size > _MAX_TRANSLATION_BYTES) and grows:
        return _err("too_large", message=(f"Nothing was changed: the '{locale}' dictionary would hold {len(merged)} texts "
                                          f"({size // 1000} KB); the limit is {_MAX_TRANSLATIONS} texts and "
                                          f"{_MAX_TRANSLATION_BYTES // 1000} KB."))
    i18n["strings"] = {**strings_all, locale: merged}
    enable = args.get("enable")
    if enable is True:
        i18n["enabled"] = True
        i18n.setdefault("defaultLocale", base)
        locales = [l for l in i18n.get("locales") or [] if isinstance(l, dict) and l.get("code")]
        codes = {str(l["code"]).lower() for l in locales}
        if base not in codes:
            locales.insert(0, {"code": base, "label": base.upper()})
        if locale not in codes:
            label = _plain_text(args.get("locale_label"), 20) or LOCALE_LABELS.get(locale) or locale.upper()
            locales.append({"code": locale, "label": label})
        i18n["locales"] = locales
    elif enable is False:
        i18n["enabled"] = False
    gs["i18n"] = i18n
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    sources = collect_site_strings(config)
    missing = missing_translations(sources, merged)
    on_site = set(sources)
    off_site = [s for s in changes if isinstance(s, str) and changes[s] and s not in on_site]
    offered = {str(l.get("code") or "").lower() for l in i18n.get("locales") or [] if isinstance(l, dict)}
    out_extra: Dict[str, Any] = {
        "changes": {k: v for k, v in report.items() if k != "skipped"},
        "coverage": {"locale": locale, "total_texts": len(sources), "untranslated": len(missing)},
    }
    if report["skipped"]:
        out_extra["skipped"] = report["skipped"][:20]
    if off_site:
        out_extra["not_in_page_texts"] = {
            "count": len(off_site), "examples": [s[:80] for s in off_site[:5]],
            "note": "Kept: the dictionary also translates live data (course names, folder titles). Check the "
                    "source spelling if these were meant to be page texts.",
        }
    if not i18n.get("enabled") or locale not in offered:
        out_extra["enable_hint"] = "Visitors cannot pick this language yet: call again with enable=true."
    return _result(ctx, site, config, revision,
                   f"Saved {report['added'] + report['updated'] + report['kept_as_base']} '{locale}' translation(s), "
                   f"removed {report['removed']}; {len(missing)} text(s) still untranslated.", **out_extra)


# ── bind live data (folder libraries, folders, product pages) ────────────
_BIND_KINDS = ("folderLibrary", "folder", "productPage")
_BIND_KEY = {"folderLibrary": "libraryId", "folder": ("rootFolderId", "folderId"), "productPage": "productPageCode"}
#: A learning path in list mode names its featured path and per-path extras by product page code.
_LP_CODE_PATH_RE = re.compile(r"^(featured|pathExtras\[\d+\])\.code$")


def _is_lp_code_path(comp: Dict[str, Any], kind: str, path: Optional[str]) -> bool:
    return bool(path) and kind == "productPage" and comp.get("type") == "learningPath" \
        and bool(_LP_CODE_PATH_RE.match(path))
_BIND_PATH_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\[\d{1,3}\]|\.[A-Za-z_][A-Za-z0-9_]*){0,7}$")


def _bind_target(comp: Dict[str, Any], kind: str, path: Optional[str], nav_index: Optional[int]) -> Tuple[Optional[str], Optional[str]]:
    """``(props path to the id, None)`` for a component and kind, or ``(None, reason)``."""
    ctype = comp.get("type")
    props = comp.get("props") if isinstance(comp.get("props"), dict) else {}
    keys = _BIND_KEY[kind] if isinstance(_BIND_KEY[kind], tuple) else (_BIND_KEY[kind],)
    if path:
        p = path[len("props."):] if path.startswith("props.") else path
        if _is_lp_code_path(comp, kind, p):
            return p, None                          # featured.code / pathExtras[i].code (list mode stays)
        if not _BIND_PATH_RE.match(p) or p.rsplit(".", 1)[-1] not in keys:
            return None, (f"path must be a prop path ending in {' or '.join(keys)} (e.g. columnSections[1].productPageCode)"
                          + (", or featured.code / pathExtras[i].code on a learning path." if kind == "productPage" else "."))
        return p, None
    if kind == "productPage" and ctype == "learningPath" and props.get("listLayout") == "featured":
        return None, ("This learning path lists its paths (featured layout): pass path='featured.code' for the "
                      "featured path or path='pathExtras[i].code' for a path's extras. Its layout is kept.")
    if ctype == "header":
        if kind != "folderLibrary":
            return None, "The header binds a folder library to a mega-menu item (data_kind='folderLibrary')."
        nav = props.get("navigation") if isinstance(props.get("navigation"), list) else []
        if nav_index is None:
            mega = [i for i, n in enumerate(nav) if isinstance(n, dict) and n.get("type") == "megaMenu"]
            if len(mega) != 1:
                return None, ("Pass nav_index: which navigation item becomes the mega menu ("
                              + ", ".join(f"{i}: {n.get('label')}" for i, n in enumerate(nav) if isinstance(n, dict)) + ").")
            nav_index = mega[0]
        if not (0 <= nav_index < len(nav)) or not isinstance(nav[nav_index], dict):
            return None, f"nav_index {nav_index} is not one of the header's {len(nav)} navigation items."
        return f"navigation[{nav_index}].megaMenu.libraryId", None
    targets = {
        ("folderLibrary", "folderBrowser"): "libraryId",
        ("folderLibrary", "learningPath"): "libraryId",
        ("folderLibrary", "courseCatalog"): "streams.libraryId",
        ("folder", "folderBrowser"): "rootFolderId",
        ("folder", "learningPath"): "folderId",
        ("productPage", "learningPath"): "productPageCode",
        ("productPage", "productPageOffer"): "productPageCode",
    }
    target = targets.get((kind, str(ctype)))
    if target is None:
        return None, (f"A {component_label(ctype)} section has no default place for a {kind}; pass `path` "
                      f"(a prop path ending in {' or '.join(keys)}).")
    return target, None


def _get_path(props: Dict[str, Any], path: str) -> Any:
    node: Any = props
    for k, i in re.findall(r"([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]", path):
        if k:
            node = node.get(k) if isinstance(node, dict) else None
        else:
            node = node[int(i)] if isinstance(node, list) and int(i) < len(node) else None
    return node


def _set_existing_path(props: Dict[str, Any], path: str, value: Any, create: bool = True) -> bool:
    """Set a props path; list items must exist, and objects on the way are created only when ``create``
    (the known binding places). False when it cannot be reached."""
    parts = [k or int(i) for k, i in re.findall(r"([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]", path)]
    node: Any = props
    for step, nxt in zip(parts[:-1], parts[1:]):
        if isinstance(step, int):
            if not isinstance(node, list) or step >= len(node) or not isinstance(node[step], (dict, list)):
                return False
            node = node[step]
        else:
            if not isinstance(node, dict):
                return False
            if not isinstance(node.get(step), (dict, list)):
                if isinstance(nxt, int) or not create:
                    return False
                node[step] = {}
            node = node[step]
    last = parts[-1]
    if isinstance(last, int) or not isinstance(node, dict):
        return False
    node[last] = value
    return True


#: Section types that show live data a binding feeds (listed when a section id is not found).
_BINDABLE_TYPES = ("folderBrowser", "learningPath", "courseCatalog", "productPageOffer")


def _find_bind_section(config: Dict[str, Any], section_id: str, page_route: Any):
    """``(page, component, None)`` for a section, or ``(None, None, error)``. Without ``page_route`` the
    section is looked for on every page; a page is asked for only when the id is on several."""
    pages = [p for p in config.get("pages") or [] if isinstance(p, dict)]
    if str(page_route or "").strip():
        page = find_page(config, page_route)
        if page is None:
            return None, None, _err("unknown_page", available=[p.get("route") for p in pages])
        comp = find_component(page, section_id)
        if comp is None:
            return None, None, _err("unknown_section", message=f"No section '{section_id}' on page '{page.get('route')}'.",
                                    sections=_bindable_sections(pages))
        return page, comp, None
    hits = [(p, c) for p in pages if (c := find_component(p, section_id)) is not None]
    if len(hits) == 1:
        return hits[0][0], hits[0][1], None
    if hits:
        return None, None, _err("ambiguous_section", message=f"Section '{section_id}' is on several pages: pass page_route.",
                                pages=[p.get("route") for p, _ in hits])
    return None, None, _err("unknown_section", message=f"No section '{section_id}' on any page of this site.",
                            sections=_bindable_sections(pages))


def _bindable_sections(pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    from .catalogue_summary import walk_components
    out = []
    for p in pages:
        for c in walk_components(p.get("components") or []):
            if isinstance(c, dict) and c.get("type") in _BINDABLE_TYPES:
                out.append({"page_route": p.get("route"), "section_id": c.get("id"), "type": c.get("type")})
    return out[:40]


async def _action_bind_data(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if err := _require(args, "bind_data", "section_id", "data_kind", "data_id"):
        return err
    kind = str(args["data_kind"])
    if kind not in _BIND_KINDS:
        return _err("bad_request", message=f"data_kind must be one of {list(_BIND_KINDS)}.")
    data_id = str(args["data_id"]).strip()
    nav_index = args.get("nav_index") if isinstance(args.get("nav_index"), int) and not isinstance(args.get("nav_index"), bool) else None
    path = str(args.get("path") or "").strip() or None
    site, err = await _target_site(ctx, args, "bind_data")
    if err:
        return err
    config = copy.deepcopy(site["config"])
    section_id = str(args["section_id"]).strip()
    page = None
    if section_id in ("header", "footer"):
        comp = ((config.get("globalSettings") or {}).get("layout") or {}).get(section_id)
        if not isinstance(comp, dict):
            return _err("unknown_section", message=f"This site has no {section_id}; create it with set_layout first.")
    else:
        page, comp, refusal = _find_bind_section(config, section_id, args.get("page_route"))
        if refusal:
            return refusal
    props = comp.setdefault("props", {})
    target, reason = _bind_target(comp, kind, path, nav_index)
    if target is None:
        return _err("no_target", message=reason)

    # Every id is checked against the institute's own data before anything is written.
    name_key = None
    name = ""
    library_id = None
    if kind == "folderLibrary":
        libraries = await list_folder_libraries(ctx)
        if libraries is None:
            return _err("fetch_failed", message="The institute's folder libraries could not be read; nothing was changed. Try again shortly.")
        lib = next((l for l in libraries if l["id"] == data_id), None)
        if lib is None:
            return _err("unknown_library", message="No folder library with that id for this institute.",
                        available=[{"id": l["id"], "name": l["name"]} for l in libraries][:20])
        name, name_key, library_id = lib["name"], "libraryName", lib["id"]
    elif kind == "folder":
        library_id = str(args.get("library_id") or "").strip() or None
        if library_id is None:
            holder = _get_path(props, target.rsplit(".", 1)[0]) if "." in target else props
            library_id = str(holder.get("libraryId") or "").strip() or None if isinstance(holder, dict) else None
        if not library_id:
            return _err("missing_argument", needs=["library_id"],
                        message="This section is not bound to a folder library yet: pass library_id (or bind the library first).")
        libraries = await list_folder_libraries(ctx)
        if libraries is None:
            return _err("fetch_failed", message="The institute's folder libraries could not be read; nothing was changed. Try again shortly.")
        lib = next((l for l in libraries if l["id"] == library_id), None)
        if lib is None:
            return _err("unknown_library", message="No folder library with that id for this institute.",
                        available=[{"id": l["id"], "name": l["name"]} for l in libraries][:20])
        folders = await load_library_folders(ctx, library_id)
        if folders is None:
            return _err("fetch_failed", message="The folder library could not be read.")
        folder = next((f for f in folders if f["id"] == data_id), None)
        if folder is None:
            return _err("unknown_folder", message="No folder with that id in this library.",
                        available=[{"id": f["id"], "title": f["title"], "depth": f["depth"]} for f in folders][:40])
        name = folder["title"]
    else:
        pages_ = await load_product_pages(ctx)
        match = next((p for p in pages_ if str(p.get("code") or "").lower() == data_id.lower()), None)
        if match is None:
            return _err("unknown_product_page", message="No product page with that code for this institute.",
                        available=[{"code": p.get("code"), "name": p.get("name")} for p in pages_][:20])
        data_id, name, name_key = match["code"], match.get("name") or "", "productPageName"

    changes: List[str] = []
    ctype = comp.get("type")
    container_path = target.rsplit(".", 1)[0] if "." in target else ""
    lp_code = _is_lp_code_path(comp, kind, target)
    if lp_code:
        name_key = None                     # featured / pathExtras items hold only the code
    before = _get_path(props, target)
    if not _set_existing_path(props, target, data_id, create=not path or lp_code):
        return _err("no_target", message=(f"props.{target} cannot be reached on this section: "
                                          + ("the object or list item it belongs to does not exist." if path
                                             else "a list item is missing.")))
    container = _get_path(props, container_path) if container_path else props
    if name_key and isinstance(container, dict):
        container[name_key] = name
    if kind == "folder" and isinstance(container, dict) and container.get("libraryId") != library_id:
        container["libraryId"] = library_id          # the folder's own library
        container["libraryName"] = lib["name"]
        changes.append(f"bound the section to library '{lib['name']}' too")
    # The settings that make the binding take effect, and the stale ones it replaces.
    if ctype == "header" and isinstance(container, dict):
        nav_item = _get_path(props, container_path.rsplit(".", 1)[0])
        if isinstance(nav_item, dict) and nav_item.get("type") != "megaMenu":
            nav_item["type"] = "megaMenu"
            changes.append("turned the navigation item into a mega menu")
    elif ctype == "courseCatalog" and target == "streams.libraryId" and isinstance(container, dict):
        container["source"] = "folderLibrary"
        container.setdefault("enabled", True)
    elif ctype == "learningPath" and kind in ("folderLibrary", "folder") and props.get("mode") != "list":
        props["mode"] = "list"
        changes.append("switched the learning path to list mode (paths from the library)")
    elif ctype == "learningPath" and kind == "productPage" and props.get("mode") == "list" and not lp_code \
            and props.get("listLayout") != "featured":
        props["mode"] = "single"
        changes.append("switched the learning path to a single path")
    if kind == "folderLibrary" and before not in (None, "", data_id) and isinstance(container, dict):
        for stale in ("rootFolderId", "folderId"):
            if container.get(stale):
                container[stale] = ""
                changes.append(f"cleared {stale} (it belonged to the previous library)")
    revision, err = await save_draft(ctx, site["catalogue_id"], config, "AI_COPILOT", None)
    if err:
        return err
    where = f"the {section_id}" if page is None else f"{component_label(ctype)} '{comp.get('id')}' on '{page.get('route')}'"
    return _result(ctx, site, config, revision,
                   f"Bound {kind} '{name or data_id}' to {where} (props.{target}).",
                   page.get("route") if page else None, comp.get("id") if page else None,
                   binding={"kind": kind, "id": data_id, "name": name or None, "prop": f"props.{target}"},
                   section=summarize_component(comp), **({"side_effects": changes} if changes else {}))


# ── request_publish (readiness only — never publishes) ───────────────────
_DIFF_CAP = 20


def _canon(value: Any) -> str:
    """JSON tree identity (key order and formatting do not count), like admin-core's sameJson."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)


def _keyed_sections(components: List[Any]) -> List[Tuple[Tuple[str, str, int], Dict[str, Any]]]:
    """
    ``[(key, section)]`` in page order. A section is keyed by its id, a section
    without one by its type; the n-th repeat of the same id (or the n-th
    id-less section of a type) gets n, so inserting a section never shifts the
    others' keys and duplicate ids are each compared with their own counterpart.
    """
    seen: Dict[Tuple[str, str], int] = {}
    out: List[Tuple[Tuple[str, str, int], Dict[str, Any]]] = []
    for comp in components or []:
        if not isinstance(comp, dict):
            continue
        cid = str(comp.get("id") or "")
        base = ("id", cid) if cid else ("type", str(comp.get("type") or ""))
        n = seen.get(base, 0)
        seen[base] = n + 1
        out.append(((base[0], base[1], n), comp))
    return out


def _section_ref(comp: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": comp.get("id"), "type": comp.get("type"), "label": component_label(comp.get("type"))}


def _diff_sections(live: List[Any], draft: List[Any]) -> Dict[str, Any]:
    lk, dk = _keyed_sections(live), _keyed_sections(draft)
    lc, dc = dict(lk), dict(dk)
    out: Dict[str, Any] = {
        "added": [_section_ref(c) for k, c in dk if k not in lc][:_DIFF_CAP],
        "removed": [_section_ref(c) for k, c in lk if k not in dc][:_DIFF_CAP],
        "changed": [_section_ref(c) for k, c in dk if k in lc and _canon(c) != _canon(lc[k])][:_DIFF_CAP],
    }
    common_live = [k for k, _ in lk if k in dc]
    common_draft = [k for k, _ in dk if k in lc]
    if common_live != common_draft:
        out["reordered"] = True
    out = {k: v for k, v in out.items() if v}
    if out and any(k[0] == "type" or k[2] for k, _ in lk + dk):
        out["matched_by"] = ("Sections without an id are matched by type and order, and repeated ids by order, "
                             "so a moved one may show as removed + added.")
    return out


def _match_pages(live: List[Dict[str, Any]], draft: List[Dict[str, Any]]):
    """Pairs (live, draft) by page id, then by route; unmatched ones are added / removed."""
    pairs: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    left = list(live)
    unmatched: List[Dict[str, Any]] = []
    for d in draft:
        m = next((l for l in left if d.get("id") and l.get("id") == d.get("id")), None)
        if m is None:
            unmatched.append(d)
        else:
            left.remove(m)
            pairs.append((m, d))
    added: List[Dict[str, Any]] = []
    for d in unmatched:
        m = next((l for l in left if str(l.get("route") or "") == str(d.get("route") or "")), None)
        if m is None:
            added.append(d)
        else:
            left.remove(m)
            pairs.append((m, d))
    return pairs, added, left


def _diff_global_settings(gl: Dict[str, Any], gd: Dict[str, Any]) -> Tuple[List[str], Dict[str, str], Dict[str, Any]]:
    settings: List[str] = []
    for key in sorted(set(gl) | set(gd)):
        if key in ("layout", "i18n") or _canon(gl.get(key)) == _canon(gd.get(key)):
            continue
        a, b = gl.get(key), gd.get(key)
        if isinstance(a, dict) and isinstance(b, dict):
            settings.extend(f"{key}.{k}" for k in sorted(set(a) | set(b)) if _canon(a.get(k)) != _canon(b.get(k)))
        else:
            settings.append(key)
    layout: Dict[str, str] = {}
    ll = gl.get("layout") if isinstance(gl.get("layout"), dict) else {}
    ld = gd.get("layout") if isinstance(gd.get("layout"), dict) else {}
    for key in sorted(set(ll) | set(ld)):
        a, b = ll.get(key), ld.get(key)
        if _canon(a) != _canon(b):
            layout[key] = "added" if not a else ("removed" if not b else "changed")
    translations: Dict[str, Any] = {}
    il = gl.get("i18n") if isinstance(gl.get("i18n"), dict) else {}
    idr = gd.get("i18n") if isinstance(gd.get("i18n"), dict) else {}
    sl = il.get("strings") if isinstance(il.get("strings"), dict) else {}
    sd = idr.get("strings") if isinstance(idr.get("strings"), dict) else {}
    for loc in sorted(set(sl) | set(sd)):
        a = sl.get(loc) if isinstance(sl.get(loc), dict) else {}
        b = sd.get(loc) if isinstance(sd.get(loc), dict) else {}
        counts = {"added": sum(1 for k in b if k not in a), "removed": sum(1 for k in a if k not in b),
                  "changed": sum(1 for k in b if k in a and a[k] != b[k])}
        if any(counts.values()):
            translations[loc] = {k: v for k, v in counts.items() if v}
    settings.extend(f"i18n.{k}" for k in sorted(set(il) | set(idr)) if k != "strings" and _canon(il.get(k)) != _canon(idr.get(k)))
    return settings, layout, translations


def diff_site_configs(live: Optional[Dict[str, Any]], draft: Dict[str, Any]) -> Dict[str, Any]:
    """
    What publishing ``draft`` changes on the live site, by page / section id
    and setting key — structure only, no copy. ``live`` None = nothing
    readable is live, so the whole draft is new.
    """
    if live is None:
        routes = [str(p.get("route") or "") for p in draft.get("pages") or [] if isinstance(p, dict)]
        return {"changed": True, "live_unreadable": True, "pages": {"added": routes[:_DIFF_CAP]},
                "summary": [f"The live version could not be read; the draft has {len(routes)} page(s)."]}
    if _canon(live) == _canon(draft):
        return {"changed": False, "summary": ["The draft is the same as the live site."]}
    lp = [p for p in live.get("pages") or [] if isinstance(p, dict)]
    dp = [p for p in draft.get("pages") or [] if isinstance(p, dict)]
    pairs, added, removed = _match_pages(lp, dp)
    summary: List[str] = []
    changed_pages: List[Dict[str, Any]] = []
    for lpage, dpage in pairs:
        if _canon(lpage) == _canon(dpage):
            continue
        entry: Dict[str, Any] = {"route": dpage.get("route")}
        if str(lpage.get("route") or "") != str(dpage.get("route") or ""):
            entry["renamed_from"] = lpage.get("route")
        fields = [k for k in sorted(set(lpage) | set(dpage)) if k not in ("components", "id", "route")
                  and _canon(lpage.get(k)) != _canon(dpage.get(k))]
        if fields:
            entry["page_fields"] = fields
        sections = _diff_sections(lpage.get("components") or [], dpage.get("components") or [])
        if sections:
            entry["sections"] = sections
        changed_pages.append(entry)
        parts = [f"{len(sections[k])} section(s) {k}" for k in ("added", "removed", "changed") if sections.get(k)]
        parts += ["sections reordered"] if sections.get("reordered") else []
        parts += [f"{', '.join(fields)} changed"] if fields else []
        parts += [f"renamed from '{entry['renamed_from']}'"] if "renamed_from" in entry else []
        summary.append(f"Page '{dpage.get('route')}': " + ("; ".join(parts) or "changed") + ".")
    if added:
        summary.append("New page(s): " + ", ".join(f"'{p.get('route')}'" for p in added[:_DIFF_CAP]) + ".")
    if removed:
        summary.append("Removed page(s): " + ", ".join(f"'{p.get('route')}'" for p in removed[:_DIFF_CAP]) + ".")
    live_of = {id(d): l for l, d in pairs}
    paired_live = {id(l) for l, _ in pairs}
    reordered = [id(l) for l in lp if id(l) in paired_live] != [id(live_of[id(d)]) for d in dp if id(d) in live_of]
    if reordered:
        summary.append("Page order changed.")
    gl = live.get("globalSettings") if isinstance(live.get("globalSettings"), dict) else {}
    gd = draft.get("globalSettings") if isinstance(draft.get("globalSettings"), dict) else {}
    settings, layout, translations = _diff_global_settings(gl, gd)
    if settings:
        summary.append("Site settings: " + ", ".join(settings[:_DIFF_CAP]) + ".")
    for part, what in layout.items():
        summary.append(f"Site {part} {what}.")
    for loc, counts in translations.items():
        summary.append(f"Translations ({loc}): " + ", ".join(f"{n} {k}" for k, n in counts.items()) + ".")
    other = [k for k in sorted(set(live) | set(draft)) if k not in ("pages", "globalSettings")
             and _canon(live.get(k)) != _canon(draft.get(k))]
    if other:
        summary.append("Other: " + ", ".join(other) + ".")
    out: Dict[str, Any] = {
        "changed": True,
        "pages": {k: v for k, v in {
            "added": [p.get("route") for p in added][:_DIFF_CAP],
            "removed": [p.get("route") for p in removed][:_DIFF_CAP],
            "changed": changed_pages[:_DIFF_CAP],
            "reordered": reordered,
        }.items() if v},
        "settings": settings[:40], "layout": layout, "translations": translations, "other": other,
        "summary": summary[:_DIFF_CAP + 8],
    }
    return {k: v for k, v in out.items() if v not in ([], {}, None)}


#: A DRAFT / INACTIVE catalogue: admin-core's public by-tag read (what the site's own link loads) serves
#: ACTIVE and DRAFT sites alike, but only an ACTIVE one can be the institute's default site.
SITE_NOT_ACTIVE_NOTE = ("The site's status is {status}, not ACTIVE. Publishing does not change that status: a DRAFT "
                        "site is still served at its own link (live_url) but cannot be the institute's default site, "
                        "and an INACTIVE one is not served. The admin can check the status in Manage Pages.")


def _first_publish_diff(diff: Dict[str, Any], draft: Dict[str, Any]) -> Dict[str, Any]:
    """
    ``diff_vs_live`` for a site that was never published (e.g. just made by
    create_site, whose starting JSON equals the draft): says so instead of
    "the draft is the same as the live site", so nobody is told to discard it.
    """
    routes = [str(p.get("route") or "") for p in draft.get("pages") or [] if isinstance(p, dict)]
    out = {**diff, "changed": True, "first_publish": True}
    lines = [f"Never published: publishing makes this draft ({len(routes)} page(s): "
             + ", ".join(f"'{r}'" for r in routes[:_DIFF_CAP]) + ") the site's first published version."]
    if not diff.get("changed"):
        out["pages"] = {"added": routes[:_DIFF_CAP]}
        lines.append("The site's link already serves the version it was created with, which equals this draft.")
    out["summary"] = lines + [line for line in diff.get("summary") or []
                              if line != "The draft is the same as the live site."]
    return out


#: What request_publish never does, said in every result so no caller reads "ready" as "live".
REQUEST_PUBLISH_NOTE = ("request_publish only checks the draft; it never publishes. The admin publishes by opening "
                        "editor_url and pressing Publish. Never tell the admin the site is live.")


def _publish_check_summary(issues: List[Dict[str, Any]]) -> Dict[str, Any]:
    errors = [{k: v for k, v in i.items() if k != "page_id"} for i in issues if i.get("severity") == "error"]
    return {"errors": errors[:10], "error_count": len(errors),
            "warning_count": sum(1 for i in issues if i.get("severity") == "warning")}


def _data_audit_summary(result: Dict[str, Any]) -> Dict[str, Any]:
    issues = [i for i in result.get("issues") or [] if isinstance(i, dict)]
    errors = [i for i in issues if i.get("severity") == "error"]
    return {k: v for k, v in {
        "summary": result.get("summary"),
        "errors": errors[:10],
        "warning_checks": sorted({str(i.get("check")) for i in issues if i.get("severity") == "warning"}),
        "truncated": result.get("truncated"),
    }.items() if v not in (None, [], {})}


async def _action_request_publish(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    """
    Readiness of the site's draft for the admin to publish: the dashboard's
    publish checks, the data audit, the review (each page in the mode it was
    built in — fidelity for a page from a design), what publishing changes on
    the live site, and the stale-draft verdict admin-core reports. Reads only:
    nothing here saves, publishes or discards anything.
    """
    from .assistant_tools_website import review_pages, site_data_audit
    site, err = await load_site(ctx, args.get("tag_name"), with_live=True)
    if err:
        return {**err, "action": "request_publish"}
    tag = site["tag_name"]
    editor = site_editor_url(tag, ctx=ctx)
    raw_revisions = site.get("revisions") or {}
    revisions = {k: v for k, v in raw_revisions.items() if v is not None}
    stale_flag = revisions.pop("live_changed_since_draft", None)
    out: Dict[str, Any] = {"tag_name": tag, "ready": False, "editor_url": editor, "live_url": site_url(ctx, tag),
                           "site_status": site.get("status"), **revisions}
    if out["live_url"] is None:
        out["live_url_note"] = NO_PORTAL_DOMAIN_NOTE
    not_active = str(site.get("status") or "").upper() not in ("", "ACTIVE")
    if not_active:
        out["site_status_note"] = SITE_NOT_ACTIVE_NOTE.format(status=site.get("status"))

    if site.get("draft_read_ok") is False:
        # A failed read is not "no draft": never tell the admin there is nothing unpublished.
        out.update({"verdict": "unknown",
                    "blockers": [{"code": "draft_unavailable",
                                  "message": ("The site's draft could not be read (the server did not answer), so "
                                              "it is unknown whether there are unpublished changes."),
                                  "fix": "Re-run request_publish in a moment; if it keeps failing, the admin checks editor_url."}],
                    "checks": "skipped: the draft could not be read",
                    "next": ("Tell the admin the readiness check could not read the draft and hand them editor_url; "
                             "do not say there are no unpublished changes."),
                    "note": REQUEST_PUBLISH_NOTE})
        return out

    stale = site.get("stale_draft")
    if stale:
        out.update({
            "verdict": "not_ready",
            "blockers": [{
                "code": "stale_draft",
                "message": (f"The draft (v{stale.get('draft_revision_no')}, started {stale.get('draft_started_at')}) is "
                            f"older than the live site (v{stale.get('live_revision_no')}, changed "
                            f"{stale.get('live_updated_at')}). Publishing it would undo the live changes made since."),
                "fix": ("The admin decides in the editor: discard the draft (website_edit(action='discard_draft') "
                        "when they say so) and redo the change on the live version, or review it and publish "
                        "deliberately."),
            }],
            "stale_draft": {k: v for k, v in stale.items() if k != "note"},
        })
        if site.get("draft_config") is not None:
            out["diff_vs_live"] = {**diff_site_configs(site.get("live_config"), site["draft_config"]),
                                   "note": ("Mixes the draft's own edits with the newer live changes publishing "
                                            "it would undo.")}
        out["checks"] = "skipped: the draft is older than the live site"
        out["next"] = ("Tell the admin the draft is older than the live site and hand them editor_url; do not edit "
                       "or call it ready until the draft is discarded or deliberately kept.")
        out["note"] = REQUEST_PUBLISH_NOTE
        return out

    # Never published: a site that is not ACTIVE with no published revision behind its draft — e.g. one
    # create_site just made (status DRAFT), whose starting JSON equals the draft. An ACTIVE site without a
    # revision predates revision history: its JSON is what visitors see, so it is diffed as before.
    first_publish = bool(site["from_draft"] and not_active and raw_revisions.get("live_revision_no") is None)
    if first_publish:
        out["first_publish"] = True

    if not site["from_draft"]:
        out.update({"verdict": "nothing_to_publish",
                    "blockers": [{"code": "no_draft", "message": "There is no unpublished draft: the live site "
                                  "already shows everything saved.", "fix": "Make the changes first (they save as a draft)."}],
                    "next": "Nothing to hand over — there are no unpublished changes.", "note": REQUEST_PUBLISH_NOTE})
        return out

    config = site["config"]
    diff = diff_site_configs(site.get("live_config"), config)
    if first_publish:
        diff = _first_publish_diff(diff, config)
    if not_active:
        diff["summary"] = [*(diff.get("summary") or []),
                           f"The site's status is {site.get('status')}, not ACTIVE (see site_status_note)."]
    out["diff_vs_live"] = diff
    if not diff.get("changed"):
        out.update({"verdict": "nothing_to_publish",
                    "blockers": [{"code": "no_changes", "message": "The draft is identical to the live site, so "
                                  "publishing it changes nothing.", "fix": "Discard the draft, or make the changes first."}],
                    "next": "Nothing to hand over — the draft equals the live site.", "note": REQUEST_PUBLISH_NOTE})
        return out

    blockers: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    if first_publish:
        warnings.append({"code": "first_publish",
                         "message": ("This site has never been published: pressing Publish in the editor makes this "
                                     "draft its first published version. Do not discard the draft.")})
    if not_active:
        warnings.append({"code": "site_not_active", "status": site.get("status"),
                         "message": SITE_NOT_ACTIVE_NOTE.format(status=site.get("status"))})
    out["live_changed_since_draft"] = stale_flag
    if stale_flag is None:
        warnings.append({"code": "stale_check_unavailable",
                         "message": ("The server did not say whether the live site changed after this draft was "
                                     "started; the admin should check the editor's warning before publishing.")})

    publish = _publish_check_summary(run_publish_checks(config))
    if publish["error_count"]:
        blockers.append({"code": "publish_check_errors", "count": publish["error_count"],
                         "message": f"{publish['error_count']} pre-publish check(s) fail (see checks.publish_checks).",
                         "fix": "Fix them with update_page / link_lead_form / set_courses / bind_data, then re-run."})
    if publish["warning_count"]:
        warnings.append({"code": "publish_check_warnings", "count": publish["warning_count"],
                         "message": "Pre-publish warnings; website(action='audit') lists them."})

    pages = [p for p in config.get("pages") or [] if isinstance(p, dict)]
    reviewed = review_pages(ctx, config.get("globalSettings") or {}, pages)
    failing: Dict[str, Any] = {}
    for route, entry in reviewed.items():
        if entry["passes"]:
            continue
        failing[route] = {"score": entry["score"], **({"mode": entry["mode"]} if entry.get("mode") else {}),
                          "fix_items": [i for i in entry["issues"] if i.get("kind") == "fix"][:4]}
    review = {"pages": {r: {k: v for k, v in e.items() if k in ("score", "passes", "mode", "page_type")}
                        for r, e in reviewed.items()},
              "bar": 85, "failing": failing}
    if failing:
        blockers.append({"code": "review_failed", "pages": sorted(failing),
                         "message": f"{len(failing)} page(s) do not pass review (see checks.review.failing).",
                         "fix": ("Fix the fix items with update_page and re-run website(action='review'); a page in "
                                 "fidelity mode follows its design — fix only what is broken.")})

    data: Dict[str, Any]
    try:
        audit = await site_data_audit(ctx, config, str(args.get("library_id") or "").strip() or None)
        data = _data_audit_summary(audit)
        n_err = int((audit.get("summary") or {}).get("error") or 0)
        if n_err:
            blockers.append({"code": "data_errors", "count": n_err,
                             "message": (f"{n_err} data problem(s) behind the site's widgets (courses, folders, "
                                         "product pages, gateways) — see checks.data_audit."),
                             "fix": ("Add the missing folders, course tags and product pages with catalog_data_edit "
                                     "(dry run first), and hand the admin the rest with the links given."
                                     if ctx.may_use("catalog_data_edit") else
                                     "The admin fixes these in the dashboard with the links given; this connection "
                                     "does not change that data.")})
        if (audit.get("summary") or {}).get("warning"):
            warnings.append({"code": "data_warnings", "count": audit["summary"]["warning"],
                             "message": "Data warnings; website(action='data_audit') lists them with links."})
    except Exception:  # noqa: BLE001 — a failed read is reported, never mistaken for a clean audit
        logger.exception("request_publish: data audit failed for %s", tag)
        data = {"error": "unavailable"}
        warnings.append({"code": "data_audit_unavailable",
                         "message": "The data audit could not run, so the data behind the widgets is unchecked; "
                                    "re-run website(action='data_audit')."})

    ready = not blockers
    out.update({
        "ready": ready,
        "verdict": "ready" if ready else "not_ready",
        "blockers": blockers,
        "warnings": warnings,
        "checks": {"publish_checks": publish, "review": review, "data_audit": data},
        "next": (("Ready: give the admin editor_url and diff_vs_live.summary, and ask them to review and press "
                  "Publish there." + (" It is the site's first publish." if first_publish else "")
                  + (" Mention site_status_note." if not_active else "")) if ready else
                 ("Not ready: fix the blockers you can (page edits) and re-run request_publish; hand the admin the "
                  "ones only they can fix (data, a stale draft) with their links. The admin may still publish "
                  "from editor_url.")),
        "note": REQUEST_PUBLISH_NOTE,
    })
    # A caller with the "Website: publish" capability also gets a single-use
    # confirm token for this exact draft when it is ready (website_publish).
    from .assistant_tools_website_publish import attach_publish_confirm
    attach_publish_confirm(ctx, site, out)
    return out



_ACTIONS = {
    "create_page": _action_create_page,
    "create_site": _action_create_site,
    "update_page": _action_update_page,
    "set_layout": _action_set_layout,
    "add_section": _action_add_section,
    "set_theme": _action_set_theme,
    "set_site_settings": _action_set_site_settings,
    "add_html_page": _action_add_html_page,
    "set_courses": _action_set_courses,
    "link_lead_form": _action_link_lead_form,
    "set_seo": _action_set_seo,
    "import_image": _action_import_image,
    "discard_draft": _action_discard_draft,
    "set_catalog_settings": _action_set_catalog_settings,
    "set_translations": _action_set_translations,
    "bind_data": _action_bind_data,
    "request_publish": _action_request_publish,
}


async def execute_website_edit(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(WEBSITE_EDIT_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


WEBSITE_EDIT_TOOLS: Dict[str, ToolSpec] = {
    WEBSITE_EDIT_TOOL_NAME: ToolSpec(
        name=WEBSITE_EDIT_TOOL_NAME,
        schema=WEBSITE_EDIT_SCHEMA,
        executor=execute_website_edit,
        required_permission=None,
        setting_key=WEBSITE_EDIT_GROUP_KEY,
        # Writes are never default-on: an admin opts a role in from settings.
        default_enabled=False,
        default_roles=None,
        phase=3,
        mode="WRITE",
    ),
}


def _register() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(WEBSITE_EDIT_TOOLS)
    GROUP_LABELS.update({WEBSITE_EDIT_GROUP_KEY: "Website: edit drafts"})


_register()

__all__ = [
    "WEBSITE_EDIT_TOOLS", "WEBSITE_EDIT_TOOL_NAME", "WEBSITE_EDIT_GROUP_KEY", "WEBSITE_EDIT_ACTIONS",
    "WEBSITE_EDIT_SCHEMA", "execute_website_edit", "apply_ops", "describe_ops",
    "theme_to_global_patch", "site_settings_to_global_patch", "merge_global_settings", "DEFAULT_GLOBAL_SETTINGS",
    "default_layout", "authoring_catalog", "build_html_page", "HTML_PAGE_CONTRACT", "finish_hero",
]
