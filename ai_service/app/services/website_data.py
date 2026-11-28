"""
Loaders shared by the website tools (``website``, ``website_edit``) and the lead
forms tool: which catalogues the pinned institute has, the config the editor
would show (draft over published), the real courses / product pages / campaigns
a page may link to, and the URLs an admin needs to look at the result.

Every call replays the caller's own JWT to admin-core, so nothing here can read
what the admin could not open in the dashboard. Kept free of tool-module
imports so the feature modules can import it in any order.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text

from .assistant_tool_registry import ToolContext, _admin_core_json
from .catalogue_summary import editor_url, learner_site_url

logger = logging.getLogger(__name__)

#: Campaigns beyond this count are listed without lead counts.
_MAX_CAMPAIGNS_WITH_COUNTS = 15
_MAX_COURSES = 40
_MAX_CATALOGUE_BYTES = 3_000_000
#: The inventory view (``detail=True``) lists up to this many courses.
_MAX_DETAIL_COURSES = 200
_MAX_DETAIL_SEARCH_ROWS = 600
_MAX_FOLDER_LIBRARIES = 10
_MAX_FOLDER_NODES = 400


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


def _is_error(data: Any) -> bool:
    return isinstance(data, dict) and bool(data.get("error"))


def _settings():
    from ..config import get_settings
    return get_settings()


NO_PORTAL_DOMAIN_NOTE = (
    "This institute has no learner-portal domain configured, so its websites cannot be reached on "
    "the shared learner host (that host serves a different institute). An admin can set the "
    "institute's learner domain under white-label / domain settings; the site is then served at "
    "https://<that domain>/<site name>. Until then, preview it in the editor."
)


def learner_portal_base(ctx: ToolContext) -> Optional[str]:
    """
    The institute's learner-portal origin, or None when it has none.

    Mirrors admin-core's LearnerPortalUrlResolver without its final fallback:
    ``institutes.learner_portal_base_url`` first, else a LEARNER row in
    ``institute_domain_routing`` (wildcard subdomains and admin-* portals
    skipped). No fallback to the shared learner host on purpose — the learner
    app resolves the INSTITUTE from the domain, so a site of an institute
    without a domain is a 404 there, and a dead link is worse than none.
    """
    inst = ctx.principal.institute_id
    try:
        row = ctx.db.execute(
            text("SELECT learner_portal_base_url FROM institutes WHERE id = :id"), {"id": inst}
        ).first()
        column = (row[0] or "").strip() if row else ""
        if column:
            return column
    except Exception as exc:  # noqa: BLE001
        logger.warning("learner_portal_base_url lookup failed for %s: %s", inst, exc)
        return None
    try:
        rows = ctx.db.execute(
            text("SELECT domain, subdomain FROM institute_domain_routing WHERE institute_id = :id AND role = 'LEARNER'"),
            {"id": inst},
        ).fetchall()
    except Exception as exc:  # noqa: BLE001
        logger.warning("institute_domain_routing lookup failed for %s: %s", inst, exc)
        return None
    for domain, subdomain in rows or []:
        domain = str(domain or "").strip().lower()
        domain = domain.replace("https://", "").replace("http://", "").rstrip("/")
        sub = str(subdomain or "").strip().lower()
        if not domain or sub.startswith("admin"):
            continue
        return domain if (not sub or sub == "*") else f"{sub}.{domain}"
    return None


def site_url(ctx: ToolContext, tag_name: str) -> Optional[str]:
    """Public URL of a site, or None when the institute has no learner domain."""
    base = learner_portal_base(ctx)
    return learner_site_url(tag_name, base, "") if base else None


def site_editor_url(tag_name: str, page_route: Optional[str] = None, section_id: Optional[str] = None,
                    ctx: Optional[ToolContext] = None) -> str:
    """Editor deep link on the institute's OWN admin portal (white-label), else the platform's."""
    from ..mcp.institute_scope import admin_portal_base
    base = _settings().admin_dashboard_url
    if ctx is not None:
        base = admin_portal_base(ctx.db, ctx.principal.institute_id, base)
    return editor_url(base, tag_name, page_route, section_id)


async def list_catalogues(ctx: ToolContext) -> Any:
    """All catalogues mapped to the pinned institute (full rows, incl. catalogue_json)."""
    return await _admin_core_json(
        ctx, "GET", "/admin-core-service/v1/course-catalogue/institute/get-all",
        params={"instituteId": ctx.principal.institute_id}, timeout=30.0,
    )


async def resolve_tag(ctx: ToolContext, tag_name: Optional[str]) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    """
    Turn an optional tag into a definite one: the given tag if the institute has
    it, else the institute's default site, else its only site. Returns
    ``(tag, None)`` or ``(None, error_dict)`` listing the options.
    """
    rows = await list_catalogues(ctx)
    if _is_error(rows) or not isinstance(rows, list):
        return None, _err("fetch_failed", message="Could not list this institute's websites.")
    names = [str(r.get("tag_name") or "") for r in rows if isinstance(r, dict)]
    wanted = str(tag_name or "").strip()
    if wanted:
        for n in names:
            if n.lower() == wanted.lower():
                return n, None
        return None, _err("unknown_site", message=f"No website named '{wanted}'.", available=names)
    default = next((r for r in rows if isinstance(r, dict) and r.get("is_default")), None)
    if default:
        return str(default.get("tag_name")), None
    if len(names) == 1:
        return names[0], None
    if not names:
        return None, _err("no_sites", message="This institute has no websites yet.")
    return None, _err("tag_required", message="Several websites exist — pass tag_name.", available=names)


async def get_draft(ctx: ToolContext, catalogue_id: str) -> Optional[Dict[str, Any]]:
    """The pending draft revision, or None (the endpoint answers 204 when there is none)."""
    data = await _admin_core_json(
        ctx, "GET", "/admin-core-service/v1/course-catalogue/revision/draft",
        params={"catalogueId": catalogue_id}, timeout=30.0,
    )
    if _is_error(data):
        return None
    return data if isinstance(data, dict) and data.get("id") else None


async def get_draft_checked(ctx: ToolContext, catalogue_id: str) -> Tuple[Optional[Dict[str, Any]], bool]:
    """
    ``(draft or None, read_ok)``: like ``get_draft`` but tells "no draft" (the
    endpoint's 204, or an empty 200) apart from a failed read (timeout, 5xx,
    401) — ``read_ok`` False means nobody knows whether a draft exists.
    """
    data = await _admin_core_json(
        ctx, "GET", "/admin-core-service/v1/course-catalogue/revision/draft",
        params={"catalogueId": catalogue_id}, timeout=30.0,
    )
    if _is_error(data):
        return None, data.get("status") == 204
    return (data if isinstance(data, dict) and data.get("id") else None), True


async def get_history(ctx: ToolContext, catalogue_id: str) -> List[Dict[str, Any]]:
    data = await _admin_core_json(
        ctx, "GET", "/admin-core-service/v1/course-catalogue/revision/history",
        params={"catalogueId": catalogue_id},
    )
    return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []


def _parse_config(raw: Any) -> Optional[Dict[str, Any]]:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return None
    if len(raw) > _MAX_CATALOGUE_BYTES:
        return None
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


STALE_DRAFT_NOTE = (
    "This site has an unpublished draft that was started before the live site last changed, so this "
    "shows the PUBLISHED site. Publishing that draft would undo the newer live changes. The admin "
    "should open editor_url and either discard the draft (use the live site) or review it before publishing."
)


def text_sha256(raw: Any) -> Optional[str]:
    """Hex SHA-256 of a catalogue's JSON text exactly as admin-core stores it (None when it is not text)."""
    if not isinstance(raw, str):
        return None
    return hashlib.sha256(raw.encode("utf-8", "surrogatepass")).hexdigest()


def stale_note(site: Dict[str, Any]) -> Dict[str, Any]:
    """``{"stale_draft": …}`` for a read result when the site's draft is older than live, else ``{}``."""
    return {"stale_draft": site["stale_draft"]} if site.get("stale_draft") else {}


async def load_site(ctx: ToolContext, tag_name: Optional[str], *,
                    with_live: bool = False) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    ``(site, None)`` or ``(None, error)``. ``site`` carries the catalogue row, the
    parsed config the EDITOR would show (draft if one exists, else published),
    and ``from_draft``.

    A draft the live site has moved past (admin-core's
    ``live_changed_since_draft``) is never shown or built on: ``config`` is the
    published site and ``stale_draft`` describes the draft, so reads can say so
    and edits can refuse.

    ``with_live`` (request_publish) also returns both sides of a publish:
    ``live_config`` (the published JSON; None when unreadable), ``draft_config``
    (the open draft's JSON, stale or not; None without one) and ``revisions``
    (the draft's and the live site's revision numbers, as admin-core reports them),
    and ``draft_read_ok`` (False when the draft fetch failed rather than
    answering "no draft").
    """
    tag, err = await resolve_tag(ctx, tag_name)
    if err:
        return None, err
    row = await _admin_core_json(
        ctx, "GET", "/admin-core-service/v1/course-catalogue/institute/get/by-tag",
        params={"instituteId": ctx.principal.institute_id, "tagName": tag}, timeout=30.0,
    )
    if _is_error(row) or not isinstance(row, dict):
        return None, _err("fetch_failed", message=f"Could not load website '{tag}'.")
    catalogue_id = str(row.get("id") or "")
    draft_read_ok = True
    if not catalogue_id:
        draft = None
    elif with_live:
        draft, draft_read_ok = await get_draft_checked(ctx, catalogue_id)
    else:
        draft = await get_draft(ctx, catalogue_id)
    stale = bool(draft and draft.get("live_changed_since_draft"))
    raw = draft.get("catalogue_json") if draft and not stale else row.get("catalogue_json")
    config = _parse_config(raw)
    if config is None:
        return None, _err(
            "catalogue_unreadable",
            message=f"Website '{tag}' is too large or malformed to summarise here; open it in the dashboard.",
            editor_url=site_editor_url(tag, ctx=ctx),
        )
    site: Dict[str, Any] = {
        "tag_name": tag,
        "catalogue_id": catalogue_id,
        "status": row.get("status"),
        "is_default": bool(row.get("is_default")),
        "config": config,
        "from_draft": draft is not None and not stale,
        "draft": {k: draft.get(k) for k in ("id", "revision_no", "source", "updated_at")} if draft else None,
    }
    if with_live:
        site["live_config"] = _parse_config(row.get("catalogue_json"))
        site["draft_config"] = (config if not stale else _parse_config(draft.get("catalogue_json"))) if draft else None
        # False: the draft could not be read (not "there is none") — the caller must not say "nothing to publish".
        site["draft_read_ok"] = draft_read_ok
        # SHA-256 of the JSON TEXT as stored (admin-core's publish checks the draft's the same way), so a
        # website_publish confirm token is bound to exactly the draft and live site that were checked.
        site["draft_sha256"] = text_sha256(draft.get("catalogue_json")) if draft else None
        site["live_sha256"] = text_sha256(row.get("catalogue_json"))
        site["revisions"] = {
            "draft_revision_no": (draft or {}).get("revision_no"),
            "draft_started_at": (draft or {}).get("created_at"),
            "draft_updated_at": (draft or {}).get("updated_at"),
            "live_revision_no": (draft or {}).get("live_revision_no"),
            "live_updated_at": (draft or {}).get("live_updated_at"),
            # None: admin-core did not say (an older server) — the caller cannot rule a stale draft out.
            "live_changed_since_draft": (draft or {}).get("live_changed_since_draft"),
        }
    if stale:
        site["stale_draft"] = {
            "draft_revision_no": draft.get("revision_no"),
            "draft_started_at": draft.get("created_at"),
            "live_revision_no": draft.get("live_revision_no"),
            "live_updated_at": draft.get("live_updated_at"),
            "editor_url": site_editor_url(tag, ctx=ctx),
            "note": STALE_DRAFT_NOTE,
        }
    return site, None


# ── context loaders ──────────────────────────────────────────────────────
async def _catalogue_search(ctx: ToolContext, size: int) -> Optional[List[Dict[str, Any]]]:
    """The learner catalogue's own search: one row per (course, level, session), published courses only.
    None when the search could not be read (an empty list is a real answer)."""
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/open/packages/v2/search",
        params={"instituteId": ctx.principal.institute_id, "page": 0, "size": size, "sort": "createdAt,desc"},
        body={"status": [], "level_ids": [], "faculty_ids": [], "search_by_name": "", "tag": [],
              "min_percentage_completed": 0, "max_percentage_completed": 0},
        timeout=30.0,
    )
    if _is_error(data):
        return None
    items = data.get("content") if isinstance(data, dict) else data
    return [c for c in items if isinstance(c, dict)] if isinstance(items, list) else None


async def _catalogue_search_rows(ctx: ToolContext, size: int) -> List[Dict[str, Any]]:
    return await _catalogue_search(ctx, size) or []


async def load_courses(ctx: ToolContext, limit: int = _MAX_COURSES, *, detail: bool = False,
                       global_settings: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Real courses as the learner catalogue sees them (same search the site renders).

    ``detail=True`` is the inventory view (``load_courses_detail``): every course
    of the institute, with tags, detected language and format, catalogue flag,
    default invite and payment vendor. The default shape is unchanged.
    """
    if detail:
        return await load_courses_detail(ctx, global_settings, limit=max(limit, _MAX_DETAIL_COURSES))
    items = await _catalogue_search_rows(ctx, limit)
    # The search returns one row per (course, level, session). The catalogue
    # shows courses, and the wizard's snapshot aggregates the same way: one
    # entry per course carrying every level/session it is offered in.
    by_id: Dict[str, Dict[str, Any]] = {}
    for c in items or []:
        if not isinstance(c, dict) or not c.get("id"):
            continue
        entry = by_id.setdefault(str(c["id"]), {
            "id": c.get("id"), "name": c.get("package_name"), "levels": [], "sessions": [],
            "package_session_ids": [], "price": None, "currency": c.get("currency"),
            "type": c.get("package_type") or c.get("type"),
        })
        level = str(c.get("level_name") or "")
        if level and level.lower() != "default" and level not in entry["levels"]:
            entry["levels"].append(level)
        session = str(c.get("session_name") or "")
        if session and session.lower() != "default" and session not in entry["sessions"]:
            entry["sessions"].append(session)
        if c.get("package_session_id"):
            entry["package_session_ids"].append(c["package_session_id"])
        price = c.get("min_plan_actual_price")
        if isinstance(price, (int, float)) and price > 0 and (entry["price"] is None or price < entry["price"]):
            entry["price"] = price
    out: List[Dict[str, Any]] = []
    for e in by_id.values():
        out.append({k: v for k, v in {
            "id": e["id"],
            "name": e["name"],
            "level": ", ".join(e["levels"]) or None,
            "session": ", ".join(e["sessions"]) or None,
            "batches": len(e["package_session_ids"]) if len(e["package_session_ids"]) > 1 else None,
            "package_session_ids": e["package_session_ids"][:8],
            "price": e["price"],
            "currency": e["currency"] if e["price"] else None,
            "type": e["type"],
        }.items() if v not in (None, "", 0, [])})
    return out[:limit]


async def load_product_pages(ctx: ToolContext, with_steps: bool = False) -> List[Dict[str, Any]]:
    """
    The institute's product pages. ``with_steps=True`` adds each page's id and
    its ACTIVE course mappings in display order (``steps``) — the steps a
    learning path shows, with the price each one is sold at.
    """
    return (await _load_product_pages(ctx, with_steps))[0]


async def _load_product_pages(ctx: ToolContext, with_steps: bool) -> Tuple[List[Dict[str, Any]], bool]:
    """(pages, read ok) — ok is False when admin-core could not answer."""
    data = await _admin_core_json(
        ctx, "GET", "/admin-core-service/v1/product-page/get-all",
        params={"instituteId": ctx.principal.institute_id},
    )
    out: List[Dict[str, Any]] = []
    for p in data if isinstance(data, list) else []:
        if not isinstance(p, dict):
            continue
        if with_steps and p.get("institute_id") and str(p["institute_id"]) != ctx.principal.institute_id:
            continue
        entry = {k: v for k, v in {
            "name": p.get("name"), "code": p.get("code"), "status": p.get("status"),
            "course_count": len(p.get("mappings") or []) or None, "short_url": p.get("short_url"),
        }.items() if v}
        if with_steps:
            entry = {"id": p.get("id"), **entry, "steps": product_page_steps(p)}
            if p.get("vendor"):
                entry["vendor"] = p.get("vendor")
        out.append(entry)
    return out, isinstance(data, list)


def product_page_steps(page: Dict[str, Any]) -> List[Dict[str, Any]]:
    """A product page's ACTIVE mappings as ordered steps (what a learning path renders)."""
    rows = [m for m in page.get("mappings") or [] if isinstance(m, dict)
            and str(m.get("status") or "ACTIVE").upper() == "ACTIVE"]
    rows.sort(key=lambda m: m.get("display_order") if isinstance(m.get("display_order"), (int, float)) else 0)
    steps: List[Dict[str, Any]] = []
    for i, m in enumerate(rows, start=1):
        plan = m.get("payment_plan") if isinstance(m.get("payment_plan"), dict) else {}
        level = str(m.get("level_name") or "")
        steps.append({k: v for k, v in {
            "step": i,
            "course_id": m.get("package_id"),
            "course_name": m.get("package_name"),
            "level": level if level and level.lower() != "default" else None,
            "package_session_id": m.get("package_session_id"),
            "enroll_invite_id": m.get("enroll_invite_id"),
            "payment_type": m.get("payment_option_type"),
            "price": plan.get("actual_price"),
            "currency": plan.get("currency"),
            "tags": m.get("tags"),
        }.items() if v not in (None, "")})
    return steps


async def load_folder_libraries(ctx: ToolContext, with_tree: bool = True) -> List[Dict[str, Any]]:
    """
    The institute's folder libraries (Manage Pages → Folders): the streams /
    categories a catalogue's stream band and mega menu read, and the learning
    paths (product-page leaves). Each node carries its raw fields plus the
    effective ``key`` (slug) and ``tag`` the learner site filters courses by.
    Admin reads: HIDDEN nodes and DRAFT product pages are included and marked.
    A library whose tree could not be read carries ``tree_error``; one cut at
    the node budget carries ``tree_truncated``.
    """
    return (await _load_folder_libraries(ctx, with_tree))[0]


async def _load_folder_libraries(ctx: ToolContext, with_tree: bool = True) -> Tuple[List[Dict[str, Any]], str]:
    """(libraries, "ok" | "partial" | "failed"): partial = some tree unread or cut, or libraries past the cap."""
    inst = ctx.principal.institute_id
    data = await _admin_core_json(
        ctx, "GET", "/admin-core-service/v1/folder-library/libraries", params={"instituteId": inst},
    )
    if not isinstance(data, list):
        return [], "failed"
    status = "partial" if len(data) > _MAX_FOLDER_LIBRARIES else "ok"
    libraries: List[Dict[str, Any]] = []
    budget = [_MAX_FOLDER_NODES, 0]      # [nodes left, nodes dropped]
    for lib in data[:_MAX_FOLDER_LIBRARIES]:
        if not isinstance(lib, dict) or not lib.get("id"):
            continue
        if lib.get("institute_id") and str(lib["institute_id"]) != inst:
            continue
        entry: Dict[str, Any] = {"id": lib.get("id"), "name": lib.get("name"), "node_count": lib.get("node_count")}
        if with_tree:
            tree = await _admin_core_json(
                ctx, "GET", "/admin-core-service/v1/folder-library/tree",
                params={"instituteId": inst, "libraryId": lib["id"]}, timeout=30.0,
            )
            if isinstance(tree, dict) and not _is_error(tree):
                owner = (tree.get("library") or {}).get("institute_id") if isinstance(tree.get("library"), dict) else None
                if owner and str(owner) != inst:
                    continue
                dropped_before = budget[1]
                entry["roots"] = _folder_nodes(tree.get("roots"), budget)
                if budget[1] > dropped_before:
                    entry["tree_truncated"] = True
                    status = "partial"
            else:
                entry["tree_error"] = "The folder tree could not be read."
                status = "partial"
        libraries.append(entry)
    return libraries, status


_FOLDER_NODE_KEYS = (
    "id", "node_type", "title", "subtitle", "slug", "course_tag", "status", "coming_soon", "audience_id",
    "product_page_id", "product_page_code", "product_page_name", "product_page_status", "link_url", "image_url",
)


def _folder_nodes(nodes: Any, budget: List[int], depth: int = 0) -> List[Dict[str, Any]]:
    from .catalogue_course_rules import folder_course_tag, folder_slug
    out: List[Dict[str, Any]] = []
    for n in nodes if isinstance(nodes, list) else []:
        if not isinstance(n, dict):
            continue
        if budget[0] <= 0:
            budget[1] += 1          # dropped: the tree as returned is incomplete
            continue
        budget[0] -= 1
        node = {k: n.get(k) for k in _FOLDER_NODE_KEYS if n.get(k) not in (None, "")}
        if n.get("node_type") == "FOLDER":
            node["key"] = folder_slug(n)
            node["tag"] = folder_course_tag(n).lower()
        if depth < 4:
            children = _folder_nodes(n.get("children"), budget, depth + 1)
            if children:
                node["children"] = children
        elif n.get("children"):
            budget[1] += 1
        out.append(node)
    return out


async def list_folder_libraries(ctx: ToolContext) -> Optional[List[Dict[str, Any]]]:
    """The institute's folder libraries (id, name, node count) — the admin's own read,
    every library, no trees (the ids bind_data checks against; ``load_folder_libraries``
    below is the capped, tree-carrying view context(detail) / data_audit read).
    None when they cannot be read (so an outage is never reported as "no such library")."""
    data = await _admin_core_json(ctx, "GET", "/admin-core-service/v1/folder-library/libraries",
                                  params={"instituteId": ctx.principal.institute_id})
    if _is_error(data) or not isinstance(data, list):
        return None
    out = []
    for lib in data:
        if not isinstance(lib, dict) or not lib.get("id"):
            continue
        if str(lib.get("institute_id") or ctx.principal.institute_id) != ctx.principal.institute_id:
            continue
        out.append({"id": str(lib["id"]), "name": lib.get("name") or "", "node_count": lib.get("node_count")})
    return out


async def load_library_folders(ctx: ToolContext, library_id: str) -> Optional[List[Dict[str, Any]]]:
    """Every FOLDER node of one library (flattened, with depth), or None when the tree cannot be read."""
    data = await _admin_core_json(ctx, "GET", "/admin-core-service/v1/folder-library/tree",
                                  params={"instituteId": ctx.principal.institute_id, "libraryId": library_id})
    if not isinstance(data, dict) or _is_error(data):
        return None
    out: List[Dict[str, Any]] = []

    def walk(nodes: Any, depth: int) -> None:
        for n in nodes if isinstance(nodes, list) else []:
            if not isinstance(n, dict) or depth > 8:
                continue
            if str(n.get("node_type") or "FOLDER").upper() == "FOLDER" and n.get("id"):
                out.append({"id": str(n["id"]), "title": n.get("title") or "", "slug": n.get("slug"),
                            "depth": depth, "status": n.get("status")})
            walk(n.get("children"), depth + 1)
    walk(data.get("roots"), 0)
    return out


# ── course detail (inventory view) ───────────────────────────────────────
_DETAIL_COURSES_SQL = """
SELECT p.id, p.package_name AS name, p.status, p.comma_separated_tags AS tags,
       p.is_course_published_to_catalaouge AS published,
       ps.id AS package_session_id, l.level_name, s.session_name
FROM package p
JOIN package_institute pi ON pi.package_id = p.id
LEFT JOIN package_session ps ON ps.package_id = p.id AND ps.status = 'ACTIVE'
LEFT JOIN level l ON l.id = ps.level_id
LEFT JOIN session s ON s.id = ps.session_id
WHERE pi.institute_id = :inst AND p.status IN ('ACTIVE', 'DRAFT', 'IN_REVIEW'){scope}
ORDER BY p.created_at DESC, ps.created_at ASC
LIMIT :lim
"""

_DETAIL_COURSE_COUNT_SQL = """
SELECT COUNT(DISTINCT p.id) AS total
FROM package p
JOIN package_institute pi ON pi.package_id = p.id
WHERE pi.institute_id = :inst AND p.status IN ('ACTIVE', 'DRAFT', 'IN_REVIEW')
"""

_INVITE_COLUMNS = """
SELECT b.package_session_id, ei.id, ei.name, ei.tag, ei.vendor, ei.status, po.type AS payment_type,
       (SELECT MIN(pp.actual_price) FROM payment_plan pp
         WHERE pp.payment_option_id = po.id AND pp.status = 'ACTIVE') AS price,
       (SELECT MIN(pp.currency) FROM payment_plan pp
         WHERE pp.payment_option_id = po.id AND pp.status = 'ACTIVE') AS currency
FROM enroll_invite ei
"""

#: Invites with an ACTIVE batch link (what a catalogue card enrols through).
_DETAIL_INVITES_SQL = _INVITE_COLUMNS + """JOIN package_session_learner_invitation_to_payment_option b
     ON b.enroll_invite_id = ei.id AND b.status = 'ACTIVE'
LEFT JOIN payment_option po ON po.id = b.payment_option_id
WHERE ei.institute_id = :inst AND ei.status <> 'DELETED'
  AND {scope}
ORDER BY ei.created_at DESC
LIMIT 1000
"""

#: Invites by id, with or without an active batch link (``package_session_id`` NULL = none).
_INVITES_BY_ID_SQL = _INVITE_COLUMNS + """LEFT JOIN package_session_learner_invitation_to_payment_option b
     ON b.enroll_invite_id = ei.id AND b.status = 'ACTIVE'
LEFT JOIN payment_option po ON po.id = b.payment_option_id
WHERE ei.institute_id = :inst AND ei.status <> 'DELETED'
  AND ei.id = ANY(:ids)
ORDER BY ei.created_at DESC
LIMIT 1000
"""


def _sql_rows_checked(ctx: ToolContext, sql: str, params: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    """Rows, or None when the read failed (the session is rolled back so later reads still work)."""
    try:
        result = ctx.db.execute(text(sql), params)
        return [dict(r._mapping) for r in result.fetchall()]
    except Exception as exc:  # noqa: BLE001
        logger.warning("website data query failed: %s", exc)
        try:
            ctx.db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None


def _sql_rows(ctx: ToolContext, sql: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    return _sql_rows_checked(ctx, sql, params) or []


def invites_by_ids(ctx: ToolContext, invite_ids: List[str]) -> Optional[List[Dict[str, Any]]]:
    """
    Invites of THIS institute among ``invite_ids``, one row per (invite, active
    batch) link and one row with ``package_session_id`` None for an invite with
    no active batch. None when the read failed.
    """
    ids = sorted({str(i) for i in invite_ids if i})
    if not ids:
        return []
    return _sql_rows_checked(ctx, _INVITES_BY_ID_SQL, {"inst": ctx.principal.institute_id, "ids": ids})


def _default_invites(ctx: ToolContext, package_session_ids: List[str]) -> Optional[Dict[str, Dict[str, Any]]]:
    """package_session_id → its DEFAULT invite (the one a catalogue card enrols through); None if unreadable."""
    if not package_session_ids:
        return {}
    rows = _sql_rows_checked(
        ctx, _DETAIL_INVITES_SQL.format(scope="ei.tag = 'DEFAULT' AND b.package_session_id = ANY(:ps)"),
        {"inst": ctx.principal.institute_id, "ps": sorted(set(package_session_ids))})
    if rows is None:
        return None
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        out.setdefault(str(r.get("package_session_id")), r)
    return out


def _tag_list(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return [t.strip() for t in raw if isinstance(t, str) and t.strip()]
    return [t.strip() for t in raw.split(",") if t.strip()] if isinstance(raw, str) else []


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


async def load_courses_detail(ctx: ToolContext, global_settings: Optional[Dict[str, Any]] = None,
                              limit: int = _MAX_DETAIL_COURSES) -> List[Dict[str, Any]]:
    """
    Every course of the institute with the facts the catalogue widgets run on:
    ``tags``, ``language_detected`` (course-variants.ts: level name, else a tag
    that is exactly a language), ``format_detected`` (course-format.ts, only
    when the site authors courseFormats), ``published_to_catalogue``,
    ``default_invite_id`` and its payment ``vendor`` / ``payment_type`` / price.
    The list stops at ``limit``; ``load_course_inventory`` says whether it did.
    """
    return (await load_course_inventory(ctx, global_settings, limit=limit))["courses"]


async def load_course_inventory(ctx: ToolContext, global_settings: Optional[Dict[str, Any]] = None,
                                limit: int = _MAX_DETAIL_COURSES,
                                include_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    ``{"courses", "total", "truncated", "sources"}`` — the courses of
    ``load_courses_detail``, plus how complete the list is.

    Merges the learner search (what the site renders) with an institute-scoped
    SQL read (courses NOT on the catalogue, tags, invites). When the SQL read
    is unavailable the search alone is used and ``published_to_catalogue`` is
    true for every row (the search lists published courses only); ``sources``
    then says ``courses_sql: failed`` so a caller does not read a missing
    course as one that does not exist. ``include_ids`` (the courses a site
    names) are always read and always kept, even past ``limit``'s cut.
    """
    from .catalogue_course_rules import (
        card_format_keys, course_languages_of, language_of_row, resolve_course_formats,
    )
    gs = global_settings if isinstance(global_settings, dict) else {}
    languages = course_languages_of(gs.get("courseLanguages"))
    formats = resolve_course_formats(gs)
    inst = ctx.principal.institute_id

    courses: Dict[str, Dict[str, Any]] = {}

    def entry_for(cid: str, name: Any) -> Dict[str, Any]:
        return courses.setdefault(cid, {
            "id": cid, "name": name, "status": None, "tags": None, "published": None,
            "batches": [], "price": None, "currency": None, "search_invite": None, "type": None,
            "in_search": False,
        })

    search_rows = await _catalogue_search(ctx, _MAX_DETAIL_SEARCH_ROWS)
    for row in search_rows or []:
        if not row.get("id"):
            continue
        e = entry_for(str(row["id"]), row.get("package_name"))
        e["in_search"] = True
        e["type"] = e["type"] or row.get("package_type") or row.get("type")
        if e["tags"] is None and row.get("comma_separeted_tags") is not None:
            e["tags"] = row.get("comma_separeted_tags")
        if row.get("is_course_published_to_catalaouge") is not None and e["published"] is None:
            e["published"] = bool(row.get("is_course_published_to_catalaouge"))
        ps_id = row.get("package_session_id")
        if not any(b["package_session_id"] == ps_id for b in e["batches"]):
            e["batches"].append({"package_session_id": ps_id, "level_name": row.get("level_name"),
                                 "session_name": row.get("session_name")})
        price = _num(row.get("min_plan_actual_price"))
        if price is not None and (e["price"] is None or price < e["price"]):
            e["price"], e["currency"] = price, row.get("currency")
        e["search_invite"] = e["search_invite"] or row.get("enroll_invite_id")

    lim = limit * 4
    sql_rows = _sql_rows_checked(ctx, _DETAIL_COURSES_SQL.format(scope=""), {"inst": inst, "lim": lim})
    wanted = sorted({str(i).strip() for i in include_ids or [] if str(i or "").strip()})
    if sql_rows is not None and wanted:
        # The site's own courses, wherever they fall in the institute's list.
        extra = _sql_rows_checked(ctx, _DETAIL_COURSES_SQL.format(scope=" AND p.id = ANY(:ids)"),
                                  {"inst": inst, "ids": wanted, "lim": len(wanted) * 20})
        sql_rows = None if extra is None else sql_rows + extra
    for row in sql_rows or []:
        if not row.get("id"):
            continue
        e = entry_for(str(row["id"]), row.get("name"))
        e["name"] = e["name"] or row.get("name")
        e["status"] = row.get("status")
        # The package row is the truth for tags and the catalogue flag.
        e["tags"] = row.get("tags") if row.get("tags") is not None else e["tags"]
        e["published"] = bool(row.get("published"))
        ps_id = row.get("package_session_id")
        if ps_id and not any(b["package_session_id"] == ps_id for b in e["batches"]):
            e["batches"].append({"package_session_id": ps_id, "level_name": row.get("level_name"),
                                 "session_name": row.get("session_name")})

    # Keep the site's courses, then fill up to ``limit`` in list order.
    keep = {cid for cid in wanted if cid in courses}
    room = max(0, limit - len(keep))
    kept: List[Dict[str, Any]] = []
    for cid, e in courses.items():
        if cid in keep:
            kept.append(e)
        elif room > 0:
            kept.append(e)
            room -= 1

    invites: Optional[Dict[str, Dict[str, Any]]] = {}
    if sql_rows:
        invites = _default_invites(ctx, [b["package_session_id"] for e in kept
                                         for b in e["batches"] if b.get("package_session_id")])

    out: List[Dict[str, Any]] = []
    for e in kept:
        tags = _tag_list(e["tags"])
        tag_str = ",".join(tags)
        rows = ([{"level_name": b.get("level_name"), "comma_separeted_tags": tag_str} for b in e["batches"]]
                or [{"comma_separeted_tags": tag_str}])
        langs: List[str] = []
        for r in rows:
            lang = language_of_row(r, languages)
            if lang and lang["code"] not in langs:
                langs.append(lang["code"])
        levels = []
        for b in e["batches"]:
            level = str(b.get("level_name") or "")
            if level and level.lower() != "default" and level not in levels:
                levels.append(level)
        default = None
        for b in e["batches"]:
            default = (invites or {}).get(str(b.get("package_session_id")))
            if default:
                break
        price = e["price"]
        currency = e["currency"]
        if price is None and default is not None and _num(default.get("price")) is not None:
            price, currency = _num(default.get("price")), default.get("currency")
        published = e["published"] if e["published"] is not None else e["in_search"]
        item: Dict[str, Any] = {
            "id": e["id"],
            "name": (e["name"] or "").strip() or e["name"],
            "status": e["status"],
            "published_to_catalogue": bool(published),
            "tags": tags,
            "levels": levels or None,
            "package_session_ids": [b["package_session_id"] for b in e["batches"] if b.get("package_session_id")][:8] or None,
            "language_detected": langs,
            "format_detected": card_format_keys(rows, formats) if formats else None,
            "price": price,
            "currency": currency if price else None,
            "is_free": (price == 0) if price is not None else None,
            "default_invite_id": (default or {}).get("id") or e["search_invite"],
            "vendor": (default or {}).get("vendor"),
            "payment_type": (default or {}).get("payment_type"),
            "type": e["type"],
        }
        out.append({k: v for k, v in item.items() if v is not None})

    # How complete the list is: the institute's own count when it can be read,
    # else what the capped reads saw (a read that hit its cap may have more).
    total = len(courses)
    capped = (search_rows is not None and len(search_rows) >= _MAX_DETAIL_SEARCH_ROWS) or (
        sql_rows is not None and len(sql_rows) >= lim)
    if sql_rows is not None:
        count = _sql_rows_checked(ctx, _DETAIL_COURSE_COUNT_SQL, {"inst": inst})
        if count and _num(count[0].get("total")) is not None:
            total = max(total, int(_num(count[0].get("total")) or 0))
            capped = False
    sources = {
        "catalogue_search": "ok" if search_rows is not None else "failed",
        "courses_sql": "ok" if sql_rows is not None else "failed",
    }
    if sql_rows:
        sources["course_invites"] = "ok" if invites is not None else "failed"
    return {"courses": out, "total": total, "truncated": total > len(out) or capped, "sources": sources}


async def load_data_inventory(ctx: ToolContext, global_settings: Optional[Dict[str, Any]] = None,
                              include_course_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Everything a design's data needs are checked against: courses in detail,
    the tag vocabulary and level names, folder libraries, product pages with
    steps, lead campaigns and the configured payment gateways.

    ``sources`` says which reads answered (``ok``), answered in part
    (``partial``) or failed (``failed``): an empty list from a failed read is
    NOT "the institute has none". ``courses_truncated`` / ``courses_total``
    say whether ``courses`` stops short of every course; the ids in
    ``include_course_ids`` (what a site names) are always listed.
    """
    from .course_builder_data import payment_vendors
    inv = await load_course_inventory(ctx, global_settings, include_ids=include_course_ids)
    courses = inv["courses"]
    tag_counts: Dict[str, int] = {}
    level_counts: Dict[str, int] = {}
    for c in courses:
        for t in {t.lower() for t in c.get("tags") or []}:
            tag_counts[t] = tag_counts.get(t, 0) + 1
        for lv in c.get("levels") or []:
            level_counts[lv] = level_counts.get(lv, 0) + 1
    vendors = await payment_vendors(ctx, strict=True)
    libraries, libraries_status = await _load_folder_libraries(ctx)
    pages, pages_ok = await _load_product_pages(ctx, with_steps=True)
    return {
        "courses": courses,
        "courses_total": inv["total"],
        "courses_truncated": inv["truncated"],
        "tag_vocabulary": [{"tag": t, "courses": n} for t, n in sorted(tag_counts.items(), key=lambda kv: (-kv[1], kv[0]))],
        "level_names": [{"level": lv, "courses": n} for lv, n in sorted(level_counts.items(), key=lambda kv: (-kv[1], kv[0]))],
        "folder_libraries": libraries,
        "product_pages": pages,
        "lead_campaigns": [{"id": c.get("id"), "name": c.get("name"), "status": c.get("status")}
                           for c in await load_campaigns(ctx, status=None, with_counts=False)],
        "payment_vendors": sorted({str(v.get("vendor") or "").upper() for v in vendors or [] if v.get("vendor")}),
        "sources": {
            **inv["sources"],
            "folder_libraries": libraries_status,
            "product_pages": "ok" if pages_ok else "failed",
            "payment_vendors": "ok" if vendors is not None else "failed",
        },
    }


async def load_campaigns(ctx: ToolContext, status: Optional[str] = "ACTIVE", with_counts: bool = True) -> List[Dict[str, Any]]:
    """Lead campaigns (Audience Manager) with leads received / last lead for the first N."""
    body: Dict[str, Any] = {"institute_id": ctx.principal.institute_id}
    if status:
        body["status"] = status
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/audience/campaigns",
        params={"pageNo": 0, "pageSize": 50}, body=body, timeout=30.0,
    )
    rows = data.get("content") if isinstance(data, dict) else None
    out: List[Dict[str, Any]] = []
    for i, c in enumerate(rows or []):
        if not isinstance(c, dict):
            continue
        entry: Dict[str, Any] = {
            "id": c.get("id"),
            "name": c.get("campaign_name"),
            "status": c.get("status"),
            "type": c.get("campaign_type"),
            "objective": c.get("campaign_objective"),
            "field_count": len(c.get("institute_custom_fields") or []),
        }
        if with_counts and i < _MAX_CAMPAIGNS_WITH_COUNTS and c.get("id"):
            entry.update(await campaign_lead_stats(ctx, str(c["id"])))
        out.append(entry)
    return out


async def campaign_name_map(ctx: ToolContext) -> Dict[str, str]:
    """id → name for every campaign (any status), for labelling ids stored on pages."""
    return {str(c["id"]): str(c.get("name") or "") for c in await load_campaigns(ctx, status=None, with_counts=False) if c.get("id")}


async def get_campaign(ctx: ToolContext, audience_id: str) -> Optional[Dict[str, Any]]:
    """One campaign of the pinned institute with its form fields, or None."""
    audience_id = str(audience_id or "").strip()
    if not audience_id or "/" in audience_id:
        return None
    data = await _admin_core_json(
        ctx, "GET",
        f"/admin-core-service/open/v1/audience/campaign/{ctx.principal.institute_id}/{audience_id}",
    )
    if not isinstance(data, dict) or _is_error(data):
        return None
    # The open endpoint is institute-scoped by path, but be explicit: a campaign
    # of another institute is never described here.
    if str(data.get("institute_id") or ctx.principal.institute_id) != ctx.principal.institute_id:
        return None
    return data


async def campaign_lead_stats(ctx: ToolContext, audience_id: str, days: Optional[int] = None) -> Dict[str, Any]:
    """``{leads_received, last_lead_at}`` — the same query the editor's CampaignHealth strip runs."""
    body: Dict[str, Any] = {
        "audience_id": audience_id,
        "conversion_status_filter": "ALL",
        "sort_by": "SUBMITTED_AT",
        "sort_direction": "DESC",
        "page": 0,
        "size": 1,
    }
    if days:
        from datetime import datetime, timedelta, timezone
        since = datetime.now(timezone.utc) - timedelta(days=int(days))
        body["submitted_from_local"] = since.strftime("%Y-%m-%dT%H:%M:%S")
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/audience/leads",
        params={"pageNo": 0, "pageSize": 1}, body=body,
    )
    if not isinstance(data, dict) or _is_error(data):
        return {"leads_received": None}
    rows = data.get("content") or []
    first = rows[0] if rows and isinstance(rows[0], dict) else {}
    return {
        "leads_received": data.get("total_elements", data.get("totalElements")),
        "last_lead_at": first.get("submitted_at_local"),
    }


__all__ = [
    "NO_PORTAL_DOMAIN_NOTE", "STALE_DRAFT_NOTE", "stale_note", "text_sha256",
    "learner_portal_base", "site_url", "site_editor_url", "list_catalogues", "resolve_tag",
    "get_draft", "get_draft_checked", "get_history", "load_site", "load_courses", "load_courses_detail", "load_course_inventory", "load_product_pages",
    "product_page_steps", "load_folder_libraries", "list_folder_libraries", "load_library_folders", "load_data_inventory",
    "invites_by_ids",
    "load_campaigns", "campaign_lead_stats", "get_campaign", "campaign_name_map",
]


# If this module is imported before the registry has loaded the feature tools
# (a test importing it directly), finish that job now that the loaders exist.
# When the registry is what imported us, it is still initialising and has no
# ``_load_feature_tools`` yet — it will run its own pass once it finishes.
try:
    from .assistant_tool_registry import _load_feature_tools as _load_feature_tools_now
except ImportError:  # registry half-initialised: it loads the feature tools itself
    pass
else:
    _load_feature_tools_now()
