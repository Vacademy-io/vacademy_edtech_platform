"""
The design playbook an AI follows to rebuild a design (a Figma file, screenshots
or a live site) as a Vacademy website — served by website(action='playbook'),
the MCP prompt ``figma_to_site`` and the resource ``vacademy://playbook/{source}``.

It is the Brahm Varchas build (2026-10, the first Figma → site rebuild) written
down as steps with budgets and stop conditions, using ONLY actions that exist on
this server today. Nothing here reads institute data: the playbook is the same
for every caller, and its Figma → pattern table is generated from the
design-pattern registry's ``figmaCues`` (catalogue_schema_catalog.json, exported
from frontend-learner-dashboard-app/src/routes/$tagName/-ai/design-patterns.ts),
so a new pattern shows up here without editing this file.

Path A only: the caller reads the design with its OWN Figma MCP / vision. This
server never fetches Figma and stores no Figma credentials.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .figma_links import FIGMA_LINK_GUIDANCE_FOR_AI

PLAYBOOK_SOURCES = ("figma", "screenshot", "url")

#: Pattern components written with set_layout rather than as page sections.
_CHROME = ("header", "footer")

#: Which website_edit action writes a site-settings pattern (by id prefix).
_GLOBAL_WRITERS = {
    "global.palette": "website_edit(set_theme, theme.palette)",
    "global.contentMaxWidth": "website_edit(set_theme, theme.content_max_width)",
    "global.fonts": "website_edit(set_theme, theme.fonts)",
    "global.courseFormats": "website_edit(set_catalog_settings)",
    "global.courseLanguages": "website_edit(set_catalog_settings)",
    "global.naming": "website_edit(set_catalog_settings)",
    "global.siteCart": "website_edit(set_catalog_settings)",
    "global.i18n": "website_edit(set_translations, enable=true)",
}

#: How to send a page's Figma results: one document per call (design_import's description, its errors and this playbook).
FIGMA_SEND_STEPS = (
    "Send ONE Figma result per call — you re-type every argument, and a page's results (~100k characters each) do "
    "not fit one reply: first metadata_xml alone with upload_only=true (it returns an import_id), then each frame's "
    "design_code in its own call with that import_id and upload_only=true, and the LAST frame's call without "
    "upload_only to get the plan."
)

GROUND_RULES = (
    "The design wins on LOOKS; live data wins on FACTS. Never copy counts, prices or course names from the design: "
    "the widgets compute them live (the Figma said '24 courses', the live site showed 22).",
    "Use the existing blocks and their opt-in patterns first (website(action='patterns')), then the closest variant, "
    "then htmlBlock (static content only, at most 3 per page). Report every fallback with the design node it replaces; "
    "never claim parity you did not reach.",
    "Never invent ids or URLs: courses, product pages, folder libraries and campaigns come from website(action='context' "
    "| 'data_inventory') and audience_forms; images only from website_edit(import_image) or website(action='list_media').",
    "Every website_edit write is a DRAFT: the admin reviews it at the editor_url. Only website_publish (when enabled) "
    "makes a site live — after website_edit(request_publish), the admin's clear yes, and its confirm token. "
    "catalog_data_edit (when enabled) writes LIVE catalogue records: tags added to live courses show at once, so "
    "dry-run it and show the admin first.",
    "Ask the admin only what the design cannot answer (the data questions in brief_checklist with design_source). "
    "Pick sensible defaults for the rest, list them as DECISIONS and tell the admin — do not block on them.",
    "Build in the base language (English) only. Other languages go into the site dictionary with set_translations, "
    "never into the page props.",
)

_FIGMA_BUDGET = {
    "why": "Figma Starter / View seats allow about 6 Figma MCP calls a month; one full read of a file can use them all.",
    "plan": [
        "1 × get_metadata on the page (the layer tree with x/y/w/h for every node); save it — it can exceed 100k characters.",
        "design_import ENABLED: 1 × get_design_context per top-level page frame, with the screenshot excluded — it "
        "is where the colours and fonts come from (metadata alone gives none). Skip get_screenshot; take one for a "
        "frame you compare only if calls are left.",
        "design_import NOT enabled: 1 × get_screenshot per top-level frame you rebuild, and get_design_context only "
        "on an ambiguous CHILD section node (a whole frame is cut off at ~100k characters), screenshot excluded.",
        "get_variable_defs once if the file defines variables (cheaper than reading colours from code).",
    ],
    "stop": "Out of budget: continue from the screenshots / exports you have and say which sections were matched by eye.",
}

_FIGMA_STEPS: List[Dict[str, Any]] = [
    {
        "step": "discover",
        "do": [
            "Run whoami (Vacademy) and website(action='list') to see the institute's sites, drafts and stale drafts.",
            "Parse the link: the file key is the segment after /design/ (or /file/), the node id is ?node-id=1-288 → '1:288'.",
            "No Figma tools of your own (no get_metadata / get_screenshot)? Do not open the link in a browser or "
            "screenshot it — it shows Figma's sign-in page. Tell the admin: \"" + FIGMA_LINK_GUIDANCE_FOR_AI + "\" "
            "With their screenshots, follow website(action='playbook', source='screenshot').",
            "A 'you don't have edit access' error from Figma means a view-only file: ask the owner to share it as "
            "'can edit', or duplicate it to the connected account's drafts and use the copy's key.",
            "Decide with the admin: a NEW site (website_edit create_site) or new pages on an existing one. Never "
            "overwrite a live site's pages without being asked.",
        ],
        "tools": ["whoami", "website(list)"],
    },
    {
        "step": "read_design",
        "do": [
            "Spend the Figma budget below, in that order. Read any dev-notes frames: they state behaviour pixels cannot "
            "(what is sticky, what is live, what a click opens).",
            "Download every asset the frames use in this session (Figma asset URLs expire after 7 days) and import only "
            "the ones the pages need with website_edit(import_image) — up to 16 URLs per call; large PNGs are "
            "downscaled for you. Keep the returned urls: they are the ONLY image urls a page may use.",
            "If the design_import tool is enabled for this connection, send the raw get_metadata XML AND each page "
            "frame's get_design_context code to design_import(action='plan') — metadata alone gives no colours or "
            "fonts. " + FIGMA_SEND_STEPS + " It drafts the tokens, map_sections and data steps below for you. Check "
            "its output against those steps instead of redoing them by hand.",
        ],
        "tools": ["Figma get_metadata / get_screenshot / get_design_context (your own Figma MCP)", "website_edit(import_image)",
                  "design_import(plan) when enabled"],
    },
    {
        "step": "tokens",
        "do": [
            "Colours: count the hex values in the frames and give each a palette role (text, body, muted, primary, "
            "accent, cream, canvas, border…; website(action='patterns', ids=['global.palette']) lists the roles). "
            "Hex must be #rrggbb.",
            "Content width = the frame's content column (x 144–1296 in a 1440 frame → 1152).",
            "Fonts: the Latin family from the design; map Medium/Semibold to the weights the web font has. On a site with "
            "a Hindi (Devanagari) locale never set a separate heading font — it drops the Devanagari fallback.",
        ],
        "tools": ["website(patterns, ids=['global.palette','global.contentMaxWidth','global.fonts'])"],
    },
    {
        "step": "map_sections",
        "do": [
            "List each frame's top-level sections top to bottom (node id, y / height, fill, contents).",
            "Match each to a pattern with the figma_pattern_table below, then read the matches in full with "
            "website(action='patterns', ids=[…]) — minimal JSON, full JSON, the data it needs and its pitfalls.",
            "Several catalogue patterns combine into ONE courseCatalog section (deep-merge their minimal objects). "
            "Header and footer patterns are not page sections: they go through set_layout.",
            "No pattern fits: the closest block variant, then htmlBlock for static content — and add it to the gap list.",
        ],
        "tools": ["website(patterns)", "website(schema, section_types=[…])"],
    },
    {
        "step": "data",
        "do": [
            "Run website(action='data_inventory') and website(action='brief_checklist', design_source=…): diff what the "
            "patterns `require` (folder library, course tags, product pages, campaigns, languages) against what exists.",
            "Ask the admin ONLY the data questions (one at a time). The design already answers colours, fonts, look, "
            "logo and photos — do not ask for them.",
            "Data the institute does not have yet (stream folders, course tags, learning-path product pages, campaigns): "
            "if the catalog_data_edit tool is enabled for this connection, set it up with catalog_data_edit("
            "create_folder_library | upsert_folder_nodes | add_course_tags | create_product_page | sync_store) once the "
            "admin agrees — every action is a dry run first: show the admin the plan, then apply it with dry_run=false "
            "and the plan_token the dry run returned. New folders start HIDDEN, tags are only appended, product pages are created DRAFT; showing folders and "
            "activating product pages stay admin clicks. Otherwise the admin sets it up in the dashboard: hand over "
            "website(action='data_audit') — each item has a fix and a dashboard link. audience_forms_edit(create) can "
            "create a missing lead campaign when the admin agrees.",
        ],
        "tools": ["website(data_inventory)", "website(brief_checklist, design_source)", "website(data_audit)", "audience_forms",
                  "catalog_data_edit when enabled"],
    },
    {
        "step": "site_settings",
        "do": [
            "website_edit(set_theme): palette (+ apply_to_tokens only after a visual check), content_max_width, fonts.",
            "website_edit(set_catalog_settings): course formats and their order, course languages + version groups "
            "(one card per EN/HI pair), naming (e.g. the Level filter called 'Format'), the site cart's store page.",
            "website_edit(set_layout): header and footer from the header.* / footer.* patterns.",
        ],
        "tools": ["website_edit(set_theme)", "website_edit(set_catalog_settings)", "website_edit(set_layout)"],
    },
    {
        "step": "compose",
        "do": [
            "Write each page from the patterns' JSON with your own copy from the design, and save it with "
            "website_edit(create_site | create_page) passing design_source = {kind:'figma', url, node_id, frame}. "
            "That switches review to FIDELITY mode for the page.",
            "Leave every `bound` id path empty in the JSON; never paste an id into page props.",
        ],
        "tools": ["website_edit(create_site)", "website_edit(create_page)"],
    },
    {
        "step": "bind",
        "do": [
            "Bind live data with website_edit(bind_data) — stream tabs and the header mega menu to the folder library, "
            "learning paths to product pages — using ids from website(context | data_inventory).",
            "Wire every form and form button with website_edit(link_lead_form), including the header / footer surfaces "
            "(section_id 'header' | 'footer'). website(action='lead_summary') lists anything still unwired.",
        ],
        "tools": ["website_edit(bind_data)", "website_edit(link_lead_form)", "website(lead_summary)"],
    },
    {
        "step": "fidelity_loop",
        "do": [
            "website(action='preview', fidelity=true) renders the draft at 1440 with each section's box.",
            "website(action='compare', reference={asset_url | tiles}, …) against the frame screenshot you imported; pass "
            "the frame's sections from get_metadata to pair them. Fix the top hints with website_edit(update_page).",
            "At most 3 rounds at 1440, then once at 390 (mobile) and once per extra language (lang='hi').",
        ],
        "stop": "3 rounds without improvement on a section: stop, list it as a deviation with the reason.",
        "tools": ["website(preview)", "website(compare)", "website_edit(update_page)"],
    },
    {
        "step": "translations",
        "do": [
            "website(action='strings', locale='hi') lists the texts with no translation; translate them yourself and "
            "save with website_edit(set_translations). Repeat until it lists none.",
        ],
        "tools": ["website(strings)", "website_edit(set_translations)"],
    },
    {
        "step": "finish",
        "do": [
            "website(action='review') must pass in fidelity mode (score ≥ 85, no `fix` items), website(action='audit') "
            "and website(action='data_audit') must show no errors you can fix.",
            "Give the admin the editor_url, a score card (per-section similarity from compare, the deviations and gap "
            "list, the open data items) and the DECISIONS you took. The site is a draft until it is published: the admin "
            "publishes from the editor, or — only when website_publish is enabled — you do, after their clear yes.",
            "website_edit(request_publish) runs those checks in one call and gives the hand-over verdict, the diff "
            "against the live site and the editor link. It never publishes.",
        ],
        "tools": ["website(review)", "website(audit)", "website(data_audit)", "website_edit(request_publish)"],
    },
]

def _fidelity_loop_from(reference: str) -> Dict[str, Any]:
    """The Figma fidelity loop, for a source with no get_metadata (sections measured by eye, or omitted)."""
    loop = next(s for s in _FIGMA_STEPS if s["step"] == "fidelity_loop")
    do = list(loop["do"])
    do[1] = (
        f"website(action='compare', reference={{asset_url | tiles}}, …) against {reference}; pass sections you "
        "measured on it (top / height of each band) to pair them, or omit them. Fix the top hints with "
        "website_edit(update_page)."
    )
    return {**loop, "do": do}


def _shared(source_steps: tuple, reference: str) -> List[Dict[str, Any]]:
    return [
        _fidelity_loop_from(reference) if s["step"] == "fidelity_loop" else s
        for s in _FIGMA_STEPS if s["step"] in source_steps
    ]


_SCREENSHOT_STEPS: List[Dict[str, Any]] = [
    {
        "step": "collect",
        "do": [
            "Get the screenshots into the institute's media: images the admin uploaded (website(action='list_media')) "
            "or public image urls imported with website_edit(import_image). A tall page can be several tiles, top to bottom.",
            "Ask which page each screenshot is, and whether it is desktop or mobile.",
        ],
        "tools": ["website(list_media)", "website_edit(import_image)"],
    },
    *[s for s in _FIGMA_STEPS if s["step"] in ("tokens", "map_sections", "data", "site_settings")],
    {
        "step": "compose",
        "do": [
            "Write each page from the patterns' JSON and save it with website_edit(create_site | create_page) passing "
            "design_source = {kind:'screenshot', frame:'<which screenshot>'} — review then runs in FIDELITY mode.",
            "Text in a screenshot is the design's copy: type it, never import an image of text.",
        ],
        "tools": ["website_edit(create_site)", "website_edit(create_page)"],
    },
    *_shared(("bind", "fidelity_loop", "translations", "finish"), "the screenshot you imported"),
]

_URL_STEPS: List[Dict[str, Any]] = [
    {
        "step": "collect",
        "do": [
            "Look at the site with your own browsing / screenshot tool — this server fetches nothing on your behalf.",
            "A figma.com link is not a website (a browser shows Figma's sign-in page): use source='figma' with your "
            "own Figma tools, or tell the admin: \"" + FIGMA_LINK_GUIDANCE_FOR_AI + "\"",
            "Copy text and images ONLY from the institute's own site. For another brand's site take the structure and "
            "look, never its words, logos or photos.",
            "Save a screenshot of each page you rebuild into the institute's media (website_edit(import_image) of an "
            "image url) so compare has a reference.",
        ],
        "tools": ["website_edit(import_image)", "website(list_media)"],
    },
    *[s for s in _FIGMA_STEPS if s["step"] in ("tokens", "map_sections", "data", "site_settings")],
    {
        "step": "compose",
        "do": [
            "Write each page from the patterns' JSON and save it with website_edit(create_site | create_page) passing "
            "design_source = {kind:'url', url:'<the page you rebuild>'} — review then runs in FIDELITY mode.",
        ],
        "tools": ["website_edit(create_site)", "website_edit(create_page)"],
    },
    *_shared(("bind", "fidelity_loop", "translations", "finish"), "the screenshot of the page you imported"),
]

_STEPS = {"figma": _FIGMA_STEPS, "screenshot": _SCREENSHOT_STEPS, "url": _URL_STEPS}

_TITLES = {
    "figma": "Figma design → Vacademy website (draft)",
    "screenshot": "Design screenshots → Vacademy website (draft)",
    "url": "Existing website → Vacademy website (draft)",
}

#: What this server cannot do yet, so an AI never promises it.
NOT_AVAILABLE = (
    "No server-side Figma reads: read the file with your own Figma MCP. Without one, tell the admin: "
    + FIGMA_LINK_GUIDANCE_FOR_AI,
    "No publishing unless website_publish is enabled for this connection: otherwise the admin publishes the draft "
    "from the editor_url.",
    "No deleting, renaming, hiding or activating the institute's catalogue data (folder libraries, course tags, "
    "product pages) and no invite or payment-gateway changes: those stay admin clicks. Without catalog_data_edit "
    "enabled there are no catalogue data writes at all — website(action='data_audit') gives the admin the list with "
    "dashboard links.",
)

#: The questions a design leaves open — what brief_checklist asks when a design is given.
DESIGN_DATA_CHECKLIST: List[Dict[str, str]] = [
    {"step": "scope", "ask": "Which frames become which pages (and routes)? A new site, or new pages on an existing site?", "feeds": "create_site / create_page"},
    {"step": "streams", "ask": "Stream tabs, category filters or a mega menu in the design: which folder library holds those streams and categories (website(action='data_inventory'))?", "feeds": "bind_data folderLibrary"},
    {"step": "courses", "ask": "Which courses belong on the site, and is every one tagged with its stream / language / format (website(action='data_audit') lists the gaps)?", "feeds": "catalogue tags, set_courses"},
    {"step": "paths", "ask": "Learning paths or a featured path: which product page is each one?", "feeds": "bind_data productPage"},
    {"step": "forms", "ask": "Each form or form button in the design (notify me, newsletter, talk to us, enquire): which lead campaign should it feed — an existing one, or create one?", "feeds": "link_lead_form"},
    {"step": "languages", "ask": "Which languages does the site offer, and which courses are the same course in two languages (one card per pair)?", "feeds": "set_catalog_settings courseLanguages, set_translations"},
    {"step": "numbers", "ask": "Numbers in the design (course counts, prices) are shown LIVE from the data — confirm that is wanted, and whether prices are shown at all.", "feeds": "catalogue stats, price display"},
    {"step": "links", "ask": "Links the design leaves open: app store links, 'partner with us', 'about', policy pages — where does each go?", "feeds": "buttons, footer columns"},
]

DESIGN_INTERVIEW_RULES = (
    "A design was given: it already answers colours, fonts, look, logo, photos and the page structure — do NOT ask for "
    "them. Ask ONE data question at a time, only for what the design cannot answer, and skip anything already known "
    "below. Pick a default for anything the admin leaves open and list it as a decision. Then follow "
    "website(action='playbook', source=…)."
)


def _writer(pattern: Dict[str, Any]) -> str:
    component = str(pattern.get("component") or "")
    if component in _CHROME:
        return "website_edit(set_layout)"
    if component == "globalSettings":
        return _GLOBAL_WRITERS.get(str(pattern.get("id")), "site settings (Manage Pages → Settings)")
    return f"a {component} section: website_edit(create_page | update_page)"


def figma_pattern_table(catalog: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One row per registry pattern: the Figma cues that identify it, and what writes it."""
    rows: List[Dict[str, Any]] = []
    for p in catalog.get("patterns") or []:
        if not isinstance(p, dict) or not p.get("id"):
            continue
        cues = [c for c in p.get("figmaCues") or [] if isinstance(c, str) and c]
        if not cues:
            continue
        row = {"pattern": p["id"], "component": p.get("component"), "figma_cues": cues, "write_with": _writer(p)}
        if p.get("label"):
            row["label"] = p["label"]
        rows.append(row)
    return rows


def normalise_source(raw: Any) -> Optional[str]:
    value = str(raw or "").strip().lower()
    return value if value in PLAYBOOK_SOURCES else None


def build_playbook(source: str, catalog: Dict[str, Any]) -> Dict[str, Any]:
    """The playbook for ``source`` (one of PLAYBOOK_SOURCES) as structured steps."""
    steps = [{"n": i + 1, **s} for i, s in enumerate(_STEPS[source])]
    out: Dict[str, Any] = {
        "source": source,
        "title": _TITLES[source],
        "ground_rules": list(GROUND_RULES),
        "steps": steps,
        "figma_pattern_table": figma_pattern_table(catalog),
        "pattern_table_note": (
            "Generated from the design-pattern registry: match a design section by its cues, then read the pattern "
            "with website(action='patterns', ids=[…]). Cues are about Figma frames but hold for screenshots too."
        ),
        "data_questions": [q["ask"] for q in DESIGN_DATA_CHECKLIST],
        "not_available": list(NOT_AVAILABLE),
        "review": (
            "Pages saved with design_source are reviewed in fidelity mode: the design wins over the generic quality "
            "rules — never add sections, heroes, stats or testimonials the design does not have."
        ),
    }
    if source == "figma":
        out["budget"] = _FIGMA_BUDGET
    return out


def playbook_markdown(source: str, catalog: Dict[str, Any], figma_url: str = "") -> str:
    """The same playbook as prose, for the MCP prompt and resource."""
    pb = build_playbook(source, catalog)
    lines = [f"# {pb['title']}", ""]
    if figma_url:
        lines += [f"Design link from the admin: {figma_url}", ""]
    lines += ["## Ground rules"] + [f"- {r}" for r in pb["ground_rules"]] + [""]
    if pb.get("budget"):
        b = pb["budget"]
        lines += ["## Figma call budget", b["why"]] + [f"- {x}" for x in b["plan"]] + [f"Stop: {b['stop']}", ""]
    lines.append("## Steps")
    for s in pb["steps"]:
        lines.append(f"{s['n']}. **{s['step']}**")
        lines += [f"   - {d}" for d in s["do"]]
        if s.get("stop"):
            lines.append(f"   - Stop: {s['stop']}")
    lines += ["", "## Ask the admin only these"] + [f"- {q}" for q in pb["data_questions"]]
    lines += ["", "## Not available here"] + [f"- {x}" for x in pb["not_available"]]
    lines += ["", "## Figma → pattern table"]
    for row in pb["figma_pattern_table"]:
        lines.append(f"- `{row['pattern']}` ({row['write_with']}): " + "; ".join(row["figma_cues"]))
    lines += ["", pb["review"]]
    return "\n".join(lines)


__all__ = [
    "DESIGN_DATA_CHECKLIST",
    "FIGMA_SEND_STEPS",
    "DESIGN_INTERVIEW_RULES",
    "GROUND_RULES",
    "NOT_AVAILABLE",
    "PLAYBOOK_SOURCES",
    "build_playbook",
    "figma_pattern_table",
    "normalise_source",
    "playbook_markdown",
]
