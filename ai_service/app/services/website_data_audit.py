"""
``website(action='data_audit')``: the data a site's widgets run on, checked
against what the site expects. Pure — the caller loads the site config and the
inventory (``website_data.load_data_inventory``); nothing here does I/O.

The design-heavy catalogue widgets (stream tabs, mega menu, FORMAT / FOR
filters, EN/HI version groups, learning paths, the flagship spotlight) render
from course tags, folder libraries and product pages, not from the page JSON.
A faithful page over wrong data still looks broken: a course with no stream tag
sits in no tab, a category nobody tagged is an empty tab, a paid invite on an
unconfigured gateway cannot be bought. These checks found by hand on the
Brahm Varchas build are what this reports, with a fix and a dashboard link for
each. Nothing here writes; the opt-in ``catalog_data_edit`` tool (when an
admin enables it) can add the missing folders, tags and product pages.

Severities: ``error`` = visibly broken or cannot be bought; ``warning`` = a
widget shows less than the design expects; ``info`` = worth knowing.

A read that failed is not data: when the inventory's ``sources`` marks a read
``failed`` (or ``partial``), the checks that need it are skipped and one
``inventory_unavailable`` item says so — a gateway list that did not load is
not "no gateway configured". When ``courses_truncated`` is set, "no course
matches" findings drop to ``info`` (a course past the cut may match).
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple

from .catalogue_course_rules import (
    course_languages_of,
    public_folder_tree,
    resolve_course_formats,
    streams_from_folder_tree,
)

_SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}
_MAX_ISSUES = 80
#: A literal amount in authored text ("₹251", "Rs. 1,001", "$20", "INR 500").
_PRICE_LITERAL = re.compile(r"(₹|rs\.?\s*|inr\s*|\$|€|£)\s*\d", re.IGNORECASE)
_FREE_TYPES = {"FREE"}
_AMOUNT = re.compile(r"\d[\d,]*(?:\.\d+)?")
#: What each inventory ``sources`` key read, for the inventory_unavailable message.
_SOURCE_LABELS = {
    "courses_sql": "institute's full course list (only catalogue courses were read)",
    "courses": "course list",
    "folder_libraries": "folder libraries",
    "product_pages": "product pages",
    "payment_vendors": "list of configured payment gateways",
    "invites": "invites the site names",
    "course_invites": "courses' default invites",
}


def _issue(check: str, severity: str, message: str, fix: str, **extra: Any) -> Dict[str, Any]:
    return {"check": check, "severity": severity, "message": message, "fix": fix,
            **{k: v for k, v in extra.items() if v not in (None, "", [], {})}}


def _text(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


# ── walking the site ─────────────────────────────────────────────────────
def _walk(obj: Any, path: str) -> Iterator[Tuple[str, str, Any, Dict[str, Any]]]:
    """(path, key, value, parent) for every key below ``obj``."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else str(k)
            yield p, str(k), v, obj
            yield from _walk(v, p)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk(v, f"{path}[{i}]")


def _sections(config: Dict[str, Any]) -> Iterator[Tuple[str, Dict[str, Any]]]:
    """(page_route, component) for every component, column slots included, then the header and footer."""
    def inner(components: Any, route: str) -> Iterator[Tuple[str, Dict[str, Any]]]:
        for c in components if isinstance(components, list) else []:
            if not isinstance(c, dict):
                continue
            yield route, c
            props = c.get("props") if isinstance(c.get("props"), dict) else {}
            for slot in props.get("slots") or []:
                yield from inner(slot, route)
    for page in config.get("pages") or []:
        if isinstance(page, dict):
            yield from inner(page.get("components"), str(page.get("route") or ""))
    layout = (config.get("globalSettings") or {}).get("layout") or {}
    for part in ("header", "footer"):
        if isinstance(layout.get(part), dict):
            yield "layout", {"id": part, "type": part, **layout[part]}


def _where(route: str, comp: Dict[str, Any], path: str) -> Dict[str, Any]:
    return {"page_route": route, "section_id": comp.get("id"), "section_type": comp.get("type"), "path": path}


# ── the audit ────────────────────────────────────────────────────────────
class _Links:
    def __init__(self, admin_base: str):
        self.base = (admin_base or "").rstrip("/")

    def course(self, course_id: Any) -> str:
        return f"{self.base}/study-library/courses/course-details?courseId={course_id}"

    def product_page(self, page_id: Any) -> Optional[str]:
        return f"{self.base}/manage-pages/product-pages/editor/{page_id}" if page_id else None

    @property
    def folders(self) -> str:
        return f"{self.base}/manage-pages"

    @property
    def gateways(self) -> str:
        return f"{self.base}/settings?selectedTab=paymentGateways"


def audit_site_data(config: Optional[Dict[str, Any]], inventory: Dict[str, Any], *,
                    admin_base: str = "", library_id: Optional[str] = None) -> Dict[str, Any]:
    """
    ``{"issues": [...], "summary": {...}, "library": ...}``. ``config`` may be
    None (no site yet): course-level checks still run, and folder checks run
    on ``library_id`` (or the institute's only library).
    """
    links = _Links(admin_base)
    cfg = config if isinstance(config, dict) else {}
    gs = cfg.get("globalSettings") if isinstance(cfg.get("globalSettings"), dict) else {}
    courses = [c for c in inventory.get("courses") or [] if isinstance(c, dict) and c.get("id")]
    by_id = {str(c["id"]): c for c in courses}
    on_catalogue = [c for c in courses if c.get("published_to_catalogue") and (c.get("status") or "ACTIVE") == "ACTIVE"]
    libraries = {str(l["id"]): l for l in inventory.get("folder_libraries") or [] if isinstance(l, dict) and l.get("id")}
    pages = {str(p["code"]): p for p in inventory.get("product_pages") or [] if isinstance(p, dict) and p.get("code")}
    vendors = {str(v).upper() for v in inventory.get("payment_vendors") or [] if v}
    invites_by_id = {str(k): v for k, v in (inventory.get("invites_by_id") or {}).items()}
    sources = inventory.get("sources") if isinstance(inventory.get("sources"), dict) else {}
    # Hand-built inventories carry no `sources`: a course status means the SQL read answered.
    sql_available = (sources["courses_sql"] == "ok") if "courses_sql" in sources else any(c.get("status") for c in courses)
    courses_known = sql_available or sources.get("catalogue_search", "ok") == "ok"
    libraries_status = sources.get("folder_libraries", "ok")
    pages_ok = sources.get("product_pages", "ok") == "ok"
    vendors_ok = sources.get("payment_vendors", "ok") == "ok"
    invites_ok = sql_available and sources.get("invites", "ok") == "ok"
    truncated = bool(inventory.get("courses_truncated"))
    issues: List[Dict[str, Any]] = []
    skipped: Dict[str, List[str]] = {}         # source → checks it could not run

    def skip(source: str, check: str) -> None:
        if check not in skipped.setdefault(source, []):
            skipped[source].append(check)

    def none_match_severity(severity: str) -> str:
        """A 'matches no course' finding is only a guess when the course list was cut."""
        return "info" if truncated else severity

    cut_note = (f" (the inventory lists {len(courses)} of {inventory.get('courses_total') or 'more'} courses, "
                "so a course past the cut may match)") if truncated else ""

    def course_ref(c: Dict[str, Any]) -> Dict[str, Any]:
        return {"id": c.get("id"), "name": c.get("name")}

    def tagset(c: Dict[str, Any]) -> Set[str]:
        return {t.lower() for t in c.get("tags") or []}

    # ── references the site makes ──
    course_refs: List[Tuple[str, Dict[str, Any], str, str]] = []      # (id, where, route, kind)
    library_refs: List[Tuple[str, Dict[str, Any]]] = []
    page_refs: List[Tuple[str, Dict[str, Any]]] = []
    folder_refs: List[Tuple[str, Dict[str, Any]]] = []
    catalogs: List[Tuple[str, Dict[str, Any]]] = []
    learning_paths: List[Tuple[str, Dict[str, Any]]] = []
    for route, comp in _sections(cfg):
        props = comp.get("props") if isinstance(comp.get("props"), dict) else {}
        if comp.get("type") == "courseCatalog":
            catalogs.append((route, comp))
        if comp.get("type") == "learningPath":
            learning_paths.append((route, comp))
        for path, key, value, parent in _walk(props, "props"):
            where = _where(route, comp, path)
            if key == "courseIds" and isinstance(value, list):
                course_refs += [(str(v).strip(), _where(route, comp, f"{path}[{i}]"), route, "list")
                                for i, v in enumerate(value) if _text(v)]
            elif key == "courseId" and _text(value):
                # A CTA that also names a product page opens an off-catalogue course through it.
                course_refs.append((value.strip(), where, route, "via_page" if _text(parent.get("productPageCode")) else "cta"))
            elif key == "libraryId" and _text(value):
                library_refs.append((value.strip(), where))
            elif key in ("productPageCode", "storeProductPageCode") and _text(value):
                page_refs.append((value.strip(), where))
            elif key == "code" and _text(value) and (".featured." in f"{path}." or ".pathExtras[" in path):
                page_refs.append((value.strip(), where))
            elif key == "folderId" and _text(value):
                folder_refs.append((value.strip(), where))
    cart = gs.get("siteCart") if isinstance(gs.get("siteCart"), dict) else {}
    if _text(cart.get("storeProductPageCode")):
        page_refs.append((cart["storeProductPageCode"].strip(),
                          {"page_route": "globalSettings", "path": "siteCart.storeProductPageCode"}))
    elif cart.get("enabled"):
        issues.append(_issue(
            "store_page_missing", "warning",
            "The site cart is on but names no store product page, so 'Add to cart' has nothing to check out through.",
            "Create a store product page, sync the catalogue into it, then set siteCart.storeProductPageCode.",
            path="globalSettings.siteCart"))

    # Unknown ids — another institute's, deleted, or invented.
    for cid, where, _r, _k in course_refs:
        if cid not in by_id and not cid.startswith("<"):
            if not sql_available:
                skip("courses_sql", "unknown_course")
                continue
            issues.append(_issue("unknown_course", "error",
                                 f"'{cid}' is not one of this institute's courses.",
                                 "Use an id from website(action='data_inventory').", where=where))
    lib_refs_checked = libraries_status == "ok"
    for lid, where in library_refs:
        if lid not in libraries:
            if not lib_refs_checked:
                skip("folder_libraries", "unknown_library")
                continue
            issues.append(_issue("unknown_library", "error",
                                 f"Folder library '{lid}' does not exist in this institute.",
                                 "Use a library id from website(action='data_inventory') → folder_libraries.",
                                 where=where, link=links.folders))
    if library_id and str(library_id) not in libraries:
        if lib_refs_checked:
            issues.append(_issue("unknown_library", "error",
                                 f"The library_id argument '{library_id}' is not one of this institute's folder "
                                 "libraries, so no stream checks ran against it.",
                                 "Pass a library id from website(action='data_inventory') → folder_libraries.",
                                 path="library_id", link=links.folders))
        else:
            skip("folder_libraries", "unknown_library")
    seen_pages: Set[str] = set()
    for code, where in page_refs:
        page = pages.get(code)
        if page is None and not pages_ok:
            skip("product_pages", "unknown_product_page")
            continue
        if page is None:
            issues.append(_issue("unknown_product_page", "error",
                                 f"Product page '{code}' does not exist in this institute.",
                                 "Create it (Manage Pages → Product pages) or use a code from data_inventory → product_pages.",
                                 where=where))
            continue
        if code in seen_pages:
            continue
        seen_pages.add(code)
        if str(page.get("status") or "").upper() != "ACTIVE":
            issues.append(_issue("product_page_not_active", "warning",
                                 f"Product page '{page.get('name') or code}' is {page.get('status') or 'not active'}: "
                                 "visitors cannot open or buy through it.",
                                 "An admin activates it in the product page editor.",
                                 where=where, link=links.product_page(page.get("id"))))
        elif not page.get("steps") and "steps" in page:
            issues.append(_issue("product_page_empty", "warning",
                                 f"Product page '{page.get('name') or code}' sells no course.",
                                 "Add the courses in the product page editor (a store page: sync it with the catalogue).",
                                 where=where, link=links.product_page(page.get("id"))))
    all_node_ids = set()
    for lib in libraries.values():
        def collect(nodes: Any) -> None:
            for n in nodes or []:
                if isinstance(n, dict):
                    all_node_ids.add(str(n.get("id")))
                    collect(n.get("children"))
        collect(lib.get("roots"))
    for fid, where in folder_refs:
        if fid not in all_node_ids:
            if libraries_status != "ok":
                skip("folder_libraries", "unknown_folder")
                continue
            issues.append(_issue("unknown_folder", "error", f"Folder '{fid}' is not in any of this institute's libraries.",
                                 "Use a folder id from data_inventory → folder_libraries.", where=where, link=links.folders))

    # Courses the site points at that the catalogue does not list.
    seen_course_refs: Set[str] = set()
    for cid, where, _r, kind in course_refs:
        c = by_id.get(cid)
        if not c or cid in seen_course_refs or c.get("published_to_catalogue"):
            continue
        seen_course_refs.add(cid)
        issues.append(_issue(
            "course_not_on_catalogue", "warning",
            f"'{c.get('name')}' is used on the site but is not published to the catalogue"
            + (": the button opens it through its product page, but the Courses grid, stream tabs and counts never show it."
               if kind == "via_page" else ", so it does not appear in the Courses grid, stream tabs or counts."),
            "If it should be listed, an admin turns on 'Publish to catalogue' in the course settings.",
            where=where, course=course_ref(c), link=links.course(cid)))
    for c in courses:
        if not c.get("published_to_catalogue") and str(c["id"]) not in seen_course_refs and (c.get("status") or "ACTIVE") == "ACTIVE":
            issues.append(_issue("course_not_on_catalogue", "info",
                                 f"'{c.get('name')}' is not published to the catalogue (no card, no stream count).",
                                 "Publish it to the catalogue if visitors should find it.",
                                 course=course_ref(c), link=links.course(c["id"])))

    # ── streams and categories (folder library) ──
    stream_library_id: Optional[str] = None
    stream_items: Optional[List[Dict[str, Any]]] = None
    for _route, comp in catalogs:
        streams_cfg = (comp.get("props") or {}).get("streams") or {}
        if not isinstance(streams_cfg, dict) or streams_cfg.get("enabled") is False:
            continue
        if streams_cfg.get("source") == "tags" and isinstance(streams_cfg.get("items"), list):
            stream_items = [i for i in streams_cfg["items"] if isinstance(i, dict) and _text(i.get("tag"))]
        elif _text(streams_cfg.get("libraryId")):
            stream_library_id = streams_cfg["libraryId"].strip()
        break
    if not stream_library_id:
        mega = [lid for lid, w in library_refs if ".megaMenu." in f"{w['path']}."]
        stream_library_id = mega[0] if mega else None
    if not stream_library_id and library_id and str(library_id) in libraries:
        stream_library_id = str(library_id)
    if not stream_library_id and not cfg and len(libraries) == 1:
        stream_library_id = next(iter(libraries))
    streams: List[Dict[str, Any]] = []
    library = libraries.get(stream_library_id or "")
    if library is not None and (library.get("tree_error") or library.get("tree_truncated")):
        skip("folder_libraries", f"stream / category checks on library '{library.get('name') or library.get('id')}'")
        library = None
        stream_items = None
    if library is not None:
        streams = streams_from_folder_tree(public_folder_tree(library.get("roots")))
    elif stream_items:
        streams = [{"slug": i.get("slug"), "title": i.get("label"), "tag": i["tag"].strip().lower(),
                    "tags": [i["tag"].strip().lower()], "categories": [], "coming_soon": False} for i in stream_items]
    if streams:
        live_streams = [s for s in streams if not s["coming_soon"]]
        for c in on_catalogue:
            tags = tagset(c)
            hit = [s for s in streams if any(t in tags for t in s["tags"])]
            missing = []
            if not hit:
                missing.append("stream")
            if not any(any(t in tags for t in cat["tags"]) for s in (hit or streams) for cat in s["categories"]) \
                    and any(s["categories"] for s in (hit or streams)):
                missing.append("category")
            if missing:
                where_text = "appears in no stream tab" if "stream" in missing else "is in no category of its stream"
                expected = ", ".join(s["tag"] for s in live_streams[:8])
                issues.append(_issue(
                    "course_no_stream" if "stream" in missing else "course_no_category",
                    "warning" if "stream" in missing else "info", f"'{c.get('name')}' has no {' or '.join(missing)} tag, so it {where_text}.",
                    f"Add the right stream / category tag to the course (streams: {expected}).",
                    course=course_ref(c), tags=c.get("tags"), link=links.course(c["id"])))
        for s in streams:
            nodes = [("stream", s)] + [("category", cat) for cat in s["categories"]]
            for kind, node in nodes:
                n = sum(1 for c in on_catalogue if any(t in tagset(c) for t in node["tags"]))
                label = node.get("subtitle") or node.get("title") or node.get("slug")
                if n == 0 and not node.get("coming_soon"):
                    if not courses_known:
                        skip("courses", "folder_without_courses")
                        continue
                    off = [c.get("name") for c in courses if c not in on_catalogue
                           and any(t in tagset(c) for t in node["tags"])]
                    issues.append(_issue(
                        "folder_without_courses", none_match_severity("warning"),
                        f"The {kind} '{label}' (tag '{', '.join(node['tags'][:3])}') matches no course on the catalogue, "
                        "so its tab / category is empty"
                        + (f" ({', '.join(map(str, off[:3]))} carries the tag but is not on the catalogue)" if off else "")
                        + cut_note + ".",
                        "Tag the courses that belong to it, publish them to the catalogue, or mark the folder 'coming soon'.",
                        folder={"id": node.get("id"), "slug": node.get("slug")}, link=links.folders))
                elif n and node.get("coming_soon"):
                    issues.append(_issue(
                        "coming_soon_has_courses", "info",
                        f"The {kind} '{label}' is marked coming soon but {n} course(s) carry its tag.",
                        "Switch off 'coming soon' on the folder if it has launched.",
                        folder={"id": node.get("id"), "slug": node.get("slug")}, link=links.folders))
    # Learning paths: product-page leaves of the library.
    for lib in libraries.values():
        if stream_library_id and lib["id"] != stream_library_id and lib["id"] not in {l for l, _w in library_refs}:
            continue
        for n in _iter_nodes(lib.get("roots")):
            if n.get("node_type") == "PRODUCT_PAGE" and str(n.get("product_page_status") or "ACTIVE").upper() != "ACTIVE":
                issues.append(_issue(
                    "path_hidden", "warning",
                    f"Path '{n.get('product_page_name') or n.get('title')}' in library '{lib.get('name')}' is "
                    f"{n.get('product_page_status')}, so visitors do not see it.",
                    "Activate its product page, or remove it from the library.",
                    link=links.product_page(n.get("product_page_id"))))
    for route, comp in learning_paths:
        props = comp.get("props") or {}
        section_lib = libraries.get(_text(props.get("libraryId")))
        if section_lib is None or section_lib.get("tree_error") or section_lib.get("tree_truncated"):
            continue           # unknown library: reported above; unreadable tree: nothing to compare with
        path_codes = {str(n.get("product_page_code")) for n in _iter_nodes(section_lib.get("roots"))
                      if n.get("node_type") == "PRODUCT_PAGE" and n.get("product_page_code")}
        refs = [("props.featured.code", (props.get("featured") or {}).get("code"))] + [
            (f"props.pathExtras[{i}].code", (x or {}).get("code")) for i, x in enumerate(props.get("pathExtras") or [])
            if isinstance(x, dict)]
        for path, code in refs:
            if _text(code) and code in pages and code not in path_codes:
                issues.append(_issue(
                    "path_not_in_library", "warning",
                    f"'{pages[code].get('name') or code}' is not a path in the section's library, so it is never shown.",
                    "Add the product page to the library (Manage Pages → Folders) or pick a path from it.",
                    where=_where(route, comp, path), link=links.folders))

    # ── languages ──
    languages = course_languages_of(gs.get("courseLanguages"))
    lang_settings = gs.get("courseLanguages") if isinstance(gs.get("courseLanguages"), dict) else {}
    uses_languages = bool(lang_settings.get("enabled")) or any(
        isinstance(q, dict) and q.get("kind") == "language"
        for _r, comp in catalogs for q in ((comp.get("props") or {}).get("quickFilters") or []))
    if uses_languages:
        for c in on_catalogue:
            if not c.get("language_detected"):
                issues.append(_issue(
                    "course_no_language", "warning",
                    f"'{c.get('name')}' has no language: neither a level name nor a tag names one, so the language "
                    "chip, filter and EN/HI grouping skip it.",
                    "Add a tag that is exactly the language (" + ", ".join(
                        str(l.get('label') or l.get('code')).lower() for l in languages) + ").",
                    course=course_ref(c), link=links.course(c["id"])))
    groups = lang_settings.get("versionGroups")
    if isinstance(groups, list) and groups:
        if not lang_settings.get("enabled"):
            issues.append(_issue("version_groups_ignored", "info",
                                 "courseLanguages.versionGroups are set but language grouping is off, so they do nothing.",
                                 "Set courseLanguages.enabled to true, or remove the groups.",
                                 path="globalSettings.courseLanguages"))
        placed: Dict[str, int] = {}
        for gi, group in enumerate(groups):
            path = f"globalSettings.courseLanguages.versionGroups[{gi}]"
            ids = [str(x).strip() for x in group if _text(x)] if isinstance(group, list) else []
            if len(ids) < 2:
                issues.append(_issue("version_group_too_small", "warning",
                                     "A version group needs two or more courses (the same course in each language).",
                                     "Remove it, or add the other language's course id.", path=path))
            seen_langs: Dict[str, str] = {}
            for cid in ids:
                c = by_id.get(cid)
                if c is None and not sql_available:
                    skip("courses_sql", "unknown_course")
                    continue
                if c is None:
                    issues.append(_issue("unknown_course", "error", f"'{cid}' is not one of this institute's courses.",
                                         "Use an id from website(action='data_inventory').", path=path))
                    continue
                if cid in placed:
                    issues.append(_issue("version_group_duplicate", "warning",
                                         f"'{c.get('name')}' is in version groups {placed[cid]} and {gi}; only the first counts.",
                                         "Keep the course in one group.", path=path, course=course_ref(c)))
                placed.setdefault(cid, gi)
                langs = c.get("language_detected") or []
                if not langs:
                    issues.append(_issue("version_group_no_language", "warning",
                                         f"'{c.get('name')}' in a version group has no detected language, so the card "
                                         "cannot offer it as EN or HI.",
                                         "Tag it with its language.", path=path, course=course_ref(c),
                                         link=links.course(cid)))
                for code in langs:
                    if code in seen_langs:
                        other = by_id.get(seen_langs[code]) or {}
                        issues.append(_issue(
                            "version_group_same_language", "warning",
                            f"'{c.get('name')}' and '{other.get('name')}' are both '{code}', so one version hides the other.",
                            "Group one course per language; fix the language tag of the one that is wrong.",
                            path=path, course=course_ref(c), link=links.course(cid)))
                    seen_langs.setdefault(code, cid)

    # ── formats and custom filters ──
    formats = resolve_course_formats(gs)
    if formats:
        for c in on_catalogue:
            if not c.get("format_detected"):
                issues.append(_issue(
                    "course_no_format", "warning",
                    f"'{c.get('name')}' has no format: no 'format-<key>' tag and its level "
                    f"({', '.join(c.get('levels') or ['default'])}) is not a format level, so its card has no format "
                    "pill and the FORMAT filter never counts it.",
                    "Add a tag 'format-<key>' (" + ", ".join(f["key"] for f in formats["list"]) + ").",
                    course=course_ref(c), link=links.course(c["id"])))
        empty = [f["label"] for f in formats["list"]
                 if not any(f["key"] in (c.get("format_detected") or []) for c in on_catalogue)]
        if empty and courses_known:
            issues.append(_issue("format_without_courses", "info",
                                 f"No course has these formats yet, so they show 0: {', '.join(empty)}{cut_note}.",
                                 "Fine if intended (the Figma greys them out); otherwise tag the courses.",
                                 path="globalSettings.courseFormats"))
    for route, comp in catalogs:
        for fi, flt in enumerate((comp.get("props") or {}).get("customFilters") or []):
            if not isinstance(flt, dict) or flt.get("source") == "courseFormats" or flt.get("enabled") is False:
                continue
            for oi, opt in enumerate(flt.get("options") or []):
                if not isinstance(opt, dict):
                    continue
                tags = {t.strip().lower() for t in opt.get("tags") or [] if _text(t)}
                levels = {t.strip().lower() for t in opt.get("levels") or [] if _text(t)}
                if not tags and not levels:
                    continue
                n = sum(1 for c in on_catalogue if tags & tagset(c)
                        or levels & {lv.lower() for lv in c.get("levels") or []})
                if n == 0 and not courses_known:
                    skip("courses", "filter_option_empty")
                elif n == 0:
                    issues.append(_issue(
                        "filter_option_empty", none_match_severity("warning"),
                        f"Filter '{flt.get('label') or flt.get('id')}' → '{opt.get('label')}' matches no course "
                        f"(tags {', '.join(sorted(tags)) or '—'}), so ticking it shows nothing{cut_note}.",
                        "Tag the courses it is for, or remove the option.",
                        where=_where(route, comp, f"props.customFilters[{fi}].options[{oi}]")))

    # ── popular chips, spotlight, free strip ──
    for route, comp in catalogs:
        props = comp.get("props") or {}
        hero = props.get("hero") if isinstance(props.get("hero"), dict) else {}
        qf_ids = {str(q.get("id")) for q in props.get("quickFilters") or [] if isinstance(q, dict)}
        for ci, chip in enumerate(hero.get("popular") or []):
            if not isinstance(chip, dict) or _text(chip.get("searchValue")):
                continue
            where = _where(route, comp, f"props.hero.popular[{ci}]")
            if _text(chip.get("streamSlug")) and streams:
                stream = next((s for s in streams if s["slug"] == chip["streamSlug"]), None)
                target: Optional[Dict[str, Any]] = stream
                if stream and _text(chip.get("categorySlug")):
                    target = next((c for c in stream["categories"] if c["slug"] == chip["categorySlug"]), None)
                if target is None:
                    issues.append(_issue("popular_chip_broken", "warning",
                                         f"Popular chip '{chip.get('label')}' opens a stream/category that does not exist.",
                                         "Use a slug from the library (data_inventory → folder_libraries).",
                                         where=where, link=links.folders))
                    continue
                n = sum(1 for c in on_catalogue if any(t in tagset(c) for t in target["tags"]))
                if n == 0 and not courses_known:
                    skip("courses", "popular_chip_empty")
                elif n == 0:
                    issues.append(_issue("popular_chip_empty", none_match_severity("warning"),
                                         f"Popular chip '{chip.get('label')}' opens '{target.get('subtitle') or target.get('slug')}', "
                                         f"which has no course on the catalogue{cut_note}.",
                                         "Tag its courses or point the chip at a stream that has some.", where=where))
            elif _text(chip.get("quickFilterId")) and chip["quickFilterId"] not in qf_ids:
                issues.append(_issue("popular_chip_broken", "warning",
                                     f"Popular chip '{chip.get('label')}' toggles quick filter '{chip['quickFilterId']}', "
                                     "which the section does not have.",
                                     "Use an id from props.quickFilters.", where=where))
        for si, sec in enumerate(props.get("columnSections") or []):
            if not isinstance(sec, dict):
                continue
            if sec.get("kind") == "free-courses":
                for i, cid in enumerate(sec.get("courseIds") or []):
                    c = by_id.get(str(cid))
                    if c and c.get("price") not in (None, 0, 0.0):
                        issues.append(_issue(
                            "free_strip_paid_course", "warning",
                            f"'{c.get('name')}' is listed in '{sec.get('title') or 'Start free'}' but costs "
                            f"{c.get('currency') or ''} {c.get('price')}.",
                            "Remove it from courseIds, or make its default invite free.",
                            where=_where(route, comp, f"props.columnSections[{si}].courseIds[{i}]"), course=course_ref(c)))
            if sec.get("kind") != "spotlight":
                continue
            for li, slide in enumerate(sec.get("slides") or []):
                if not isinstance(slide, dict):
                    continue
                base = f"props.columnSections[{si}].slides[{li}]"
                cta = slide.get("cta") if isinstance(slide.get("cta"), dict) else {}
                live = _live_price(cta, by_id, invites_by_id)
                invite_id = _text(cta.get("enrollInviteId"))
                invite = invites_by_id.get(invite_id)
                if invite_id and not invites_ok:
                    skip("invites", "unknown_invite")
                elif invite_id and invite is None:
                    issues.append(_issue("unknown_invite", "error",
                                         f"Invite '{invite_id}' is not one of this institute's invites.",
                                         "Use the course's default invite (data_inventory → courses[].default_invite_id).",
                                         where=_where(route, comp, f"{base}.cta.enrollInviteId")))
                elif invite_id and "package_session_id" in invite and not invite.get("package_session_id"):
                    issues.append(_issue("invite_no_active_batch", "error",
                                         f"Invite '{invite.get('name') or invite_id}' has no active batch, so the "
                                         "button cannot enrol anyone through it.",
                                         "An admin links the invite to the course's batch (Invite settings), or use the "
                                         "course's default invite (data_inventory → courses[].default_invite_id).",
                                         where=_where(route, comp, f"{base}.cta.enrollInviteId")))
                authored = _text(cta.get("price"))
                if authored and live is not None and _amount(authored) is not None and _amount(authored) != live:
                    issues.append(_issue(
                        "authored_price_stale", "warning",
                        f"The spotlight's fallback price '{authored}' differs from the live price ({live:g}); the button "
                        "shows the live price, any text that copies the authored one is wrong.",
                        "Use {price} in the label and steps; set cta.price to the live price or remove it.",
                        where=_where(route, comp, f"{base}.cta.price")))
                unlinked: List[str] = []
                for ti, step in enumerate(slide.get("steps") or []):
                    if not isinstance(step, dict):
                        continue
                    meta = _text(step.get("meta"))
                    if meta and _PRICE_LITERAL.search(meta):
                        issues.append(_issue(
                            "authored_price", "warning",
                            f"Step '{step.get('title')}' authors a price ('{meta}'); the widget computes it live.",
                            "Write '{price}' instead of the amount.",
                            where=_where(route, comp, f"{base}.steps[{ti}].meta")))
                    if not _text(step.get("route")) and not _text(step.get("audienceId")):
                        unlinked.append(str(step.get("title") or ti + 1))
                if unlinked:
                    issues.append(_issue(
                        "step_without_link", "info",
                        f"Spotlight '{slide.get('title')}': steps {', '.join(repr(t) for t in unlinked)} are plain text "
                        "(no route or form).",
                        "Give a step a route or an audienceId if it should open something (a survey, a form).",
                        where=_where(route, comp, f"{base}.steps")))
        for si, stat in enumerate(hero.get("stats") or []):
            if isinstance(stat, dict) and any(k in stat for k in ("value", "number", "count")):
                issues.append(_issue(
                    "authored_stat", "info",
                    f"Hero stat '{stat.get('label') or stat.get('kind')}' carries an authored number, which is ignored: "
                    "stats are counted live from the catalogue.",
                    "Remove the number; keep kind + label.", where=_where(route, comp, f"props.hero.stats[{si}]")))

    # ── payment gateways ──
    for c in on_catalogue if vendors_ok else []:
        vendor = str(c.get("vendor") or "").upper()
        paid = str(c.get("payment_type") or "").upper() not in _FREE_TYPES and (c.get("price") or 0) > 0
        if not vendor or not paid:
            continue
        if vendor not in vendors:
            issues.append(_issue(
                "invite_vendor_unconfigured", "error",
                f"'{c.get('name')}' is sold through {vendor}, which is not a configured payment gateway"
                + (f" (configured: {', '.join(sorted(vendors))})" if vendors else " (none is configured)")
                + ", so checkout fails.",
                "An admin switches the course's default invite to a configured gateway, or connects "
                f"{vendor} under Settings → Payment gateways.",
                course=course_ref(c), invite_id=c.get("default_invite_id"), link=links.gateways))

    if not vendors_ok and any(c.get("vendor") for c in on_catalogue):
        skip("payment_vendors", "invite_vendor_unconfigured")
    elif on_catalogue and not sql_available:
        skip("courses_sql", "invite_vendor_unconfigured")       # the courses' invites come from the same read
    elif on_catalogue and sources.get("course_invites", "ok") != "ok":
        skip("course_invites", "invite_vendor_unconfigured")
    for source, skipped_checks in skipped.items():
        issues.append(_issue(
            "inventory_unavailable", "warning",
            f"The {_SOURCE_LABELS.get(source, source)} could not be read, so these checks did not run: "
            f"{', '.join(skipped_checks)}. Missing data here is unknown, not absent.",
            "Re-run data_audit; if it persists, check the item in the dashboard by hand.",
            source=source, skipped_checks=skipped_checks))

    issues = _merge_repeats(issues)
    issues.sort(key=lambda i: _SEVERITY_ORDER.get(i["severity"], 3))
    counts = {s: sum(1 for i in issues if i["severity"] == s) for s in ("error", "warning", "info")}
    return {
        "summary": {**counts, "courses_checked": len(courses), "on_catalogue": len(on_catalogue),
                    "streams": len(streams), **({"courses_truncated": True} if truncated else {})},
        "issues": issues[:_MAX_ISSUES],
        "truncated": max(0, len(issues) - _MAX_ISSUES) or None,
        "library": ({"id": library.get("id"), "name": library.get("name")} if library else None),
    }


def _merge_repeats(issues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    One item per finding: the same section on several pages (a catalogue on
    home and courses) reports once, with the other places under ``also_at``.
    """
    out: List[Dict[str, Any]] = []
    first: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for issue in issues:
        key = (issue["check"], issue["message"])
        if key in first:
            if issue.get("where"):
                first[key].setdefault("also_at", []).append(issue["where"])
            continue
        first[key] = issue
        out.append(issue)
    return out


def _iter_nodes(nodes: Any) -> Iterator[Dict[str, Any]]:
    for n in nodes or []:
        if isinstance(n, dict):
            yield n
            yield from _iter_nodes(n.get("children"))


def _amount(text: str) -> Optional[float]:
    """The first number in a price ("Rs. 1,001" → 1001.0); the currency prefix and its dot are skipped."""
    m = _AMOUNT.search(text)
    try:
        return float(m.group(0).replace(",", "")) if m else None
    except ValueError:
        return None


def _live_price(cta: Dict[str, Any], by_id: Dict[str, Dict[str, Any]],
                invites_by_id: Dict[str, Dict[str, Any]]) -> Optional[float]:
    """What the spotlight button shows: the catalogue price, else the plan of the named invite."""
    course = by_id.get(_text(cta.get("courseId")))
    if course and course.get("published_to_catalogue") and isinstance(course.get("price"), (int, float)):
        return float(course["price"])
    invite = invites_by_id.get(_text(cta.get("enrollInviteId")))
    if invite and isinstance(invite.get("price"), (int, float)):
        return float(invite["price"])
    if course and isinstance(course.get("price"), (int, float)):
        return float(course["price"])
    return None


def site_course_ids(config: Optional[Dict[str, Any]]) -> List[str]:
    """Every course id a site names (courseIds / courseId anywhere, version groups) — read even past the cap."""
    cfg = config if isinstance(config, dict) else {}
    out: List[str] = []

    def add(v: Any) -> None:
        if _text(v) and not v.strip().startswith("<") and v.strip() not in out:
            out.append(v.strip())
    for _route, comp in _sections(cfg):
        for _p, key, value, _parent in _walk(comp.get("props") or {}, "props"):
            if key == "courseIds" and isinstance(value, list):
                for v in value:
                    add(v)
            elif key == "courseId":
                add(value)
    langs = ((cfg.get("globalSettings") or {}).get("courseLanguages") or {})
    for group in (langs.get("versionGroups") if isinstance(langs, dict) else None) or []:
        for v in group if isinstance(group, list) else []:
            add(v)
    return out


def site_invite_ids(config: Optional[Dict[str, Any]]) -> List[str]:
    """Every enrollInviteId a site names (the action reads those invites before auditing)."""
    out: List[str] = []
    for _route, comp in _sections(config if isinstance(config, dict) else {}):
        for _p, key, value, _parent in _walk(comp.get("props") or {}, "props"):
            if key == "enrollInviteId" and _text(value) and value.strip() not in out:
                out.append(value.strip())
    return out


__all__ = ["audit_site_data", "site_course_ids", "site_invite_ids"]
