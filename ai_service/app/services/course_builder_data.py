"""
Shared plumbing for the course-builder tools (``courses``, ``course_edit``,
``course_drip_edit``, ``course_invites_edit``).

Reads are SQL on the shared database, always scoped to the pinned institute
through ``package_institute`` (the same way ``find_batch`` reads). Writes go to
admin-core with the caller's own JWT, so the MCP can never do what the admin
could not do in the dashboard.

No model runs anywhere in this feature: the connected LLM writes the outline and
every slide, and these tools validate and persist it. See
docs/ai-course/COURSE_BUILDER_MCP_PLAN.md.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text

from .assistant_tool_registry import ToolContext, _jwt_headers

logger = logging.getLogger(__name__)

#: Course (package) statuses. Only DRAFT courses are writable by `course_edit`;
#: drip / invite re-pointing is refused on ACTIVE ones.
STATUS_DRAFT = "DRAFT"
STATUS_IN_REVIEW = "IN_REVIEW"
STATUS_ACTIVE = "ACTIVE"

#: admin-core's placeholder name for hidden structure levels. The learner app
#: hides subjects / modules / chapters named this.
DEFAULT_LEVEL_NAME = "DEFAULT"

_MAX_COURSES = 60


def err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


def is_error(data: Any) -> bool:
    return isinstance(data, dict) and bool(data.get("error"))


def _settings():
    from ..config import get_settings
    return get_settings()


# ── admin-core client ────────────────────────────────────────────────────

async def admin_core(
    ctx: ToolContext,
    method: str,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    body: Any = None,
    timeout: float = 30.0,
) -> Any:
    """
    One JWT call to admin-core. Returns parsed JSON, the bare text of a string
    response (admin-core answers ids as plain text), or an error dict that
    carries admin-core's own message so the model can fix its input.
    """
    import httpx

    if not ctx.bearer_token:
        return err("no_auth", message="This action is unavailable right now (no session).")
    url = f"{_settings().admin_core_service_base_url}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(method, url, params=params, json=body, headers=_jwt_headers(ctx))
    except Exception as exc:  # noqa: BLE001
        logger.warning("course builder %s %s failed: %s", method, path, exc)
        return err("request_failed", message="admin-core could not be reached.")
    if resp.status_code >= 300:
        logger.warning("course builder %s %s -> %s (%s)", method, path, resp.status_code, resp.text[:300])
        return err("admin_core_rejected", status=resp.status_code, message=_error_message(resp))
    if not resp.content:
        return ""
    try:
        return resp.json()
    except ValueError:
        return resp.text.strip()


def _error_message(resp: Any) -> str:
    try:
        data = resp.json()
    except ValueError:
        return (resp.text or "").strip()[:300]
    if isinstance(data, dict):
        for key in ("ex", "message", "error", "responseCode"):
            if isinstance(data.get(key), str) and data[key].strip():
                return data[key].strip()[:300]
    return str(data)[:300]


def admin_base(ctx: ToolContext) -> str:
    """The institute's own admin portal (white-label), else the platform dashboard."""
    from ..mcp.institute_scope import admin_portal_base
    return admin_portal_base(ctx.db, ctx.principal.institute_id, _settings().admin_dashboard_url)


def course_editor_url(ctx: ToolContext, course_id: str) -> str:
    return f"{admin_base(ctx)}/study-library/courses/course-details?courseId={course_id}"


# ── SQL reads (institute-scoped) ─────────────────────────────────────────

def _rows(ctx: ToolContext, sql: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    try:
        result = ctx.db.execute(text(sql), params)
        return [dict(r._mapping) for r in result.fetchall()]
    except Exception as exc:  # noqa: BLE001
        logger.warning("course builder query failed: %s", exc)
        try:
            ctx.db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return []


_LIST_COURSES_SQL = """
SELECT p.id, p.package_name AS name, p.status, p.course_depth AS depth,
       p.created_by_user_id, p.created_at,
       (SELECT COUNT(*) FROM package_session ps
          JOIN chapter_package_session_mapping cpsm ON cpsm.package_session_id = ps.id AND cpsm.status <> 'DELETED'
          JOIN chapter_to_slides cts ON cts.chapter_id = cpsm.chapter_id AND cts.status <> 'DELETED'
         WHERE ps.package_id = p.id AND ps.status = 'ACTIVE') AS slide_count
FROM package p
JOIN package_institute pi ON pi.package_id = p.id
WHERE pi.institute_id = :inst
  AND p.status IN ('ACTIVE', 'DRAFT', 'IN_REVIEW')
  {filters}
ORDER BY p.created_at DESC
LIMIT :lim
"""


def list_courses(ctx: ToolContext, status: Optional[str] = None, search: Optional[str] = None,
                 limit: int = 30) -> List[Dict[str, Any]]:
    # Optional filters are added only when present: an untyped NULL parameter
    # (":x IS NULL") fails server-side binding under psycopg 3.
    filters, params = [], {"inst": ctx.principal.institute_id, "lim": max(1, min(int(limit or 30), _MAX_COURSES))}
    if status:
        filters.append("AND p.status = :status")
        params["status"] = status
    if search:
        filters.append("AND LOWER(p.package_name) LIKE :q")
        params["q"] = f"%{search.lower()}%"
    rows = _rows(ctx, _LIST_COURSES_SQL.format(filters=" ".join(filters)), params)
    for r in rows:
        r["slide_count"] = int(r.get("slide_count") or 0)
    return rows


_COURSE_SQL = """
SELECT p.id, p.package_name AS name, p.status, p.course_depth AS depth,
       p.created_by_user_id, p.about_the_course, p.why_learn, p.who_should_learn,
       p.comma_separated_tags AS tags, p.course_preview_image_media_id, p.course_banner_media_id,
       p.course_media_id
FROM package p
JOIN package_institute pi ON pi.package_id = p.id
WHERE p.id = :id AND pi.institute_id = :inst AND p.status <> 'DELETED'
LIMIT 1
"""


def course_row(ctx: ToolContext, course_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """The course if it belongs to the pinned institute, else None."""
    if not course_id:
        return None
    rows = _rows(ctx, _COURSE_SQL, {"id": str(course_id), "inst": ctx.principal.institute_id})
    return rows[0] if rows else None


_COURSE_FULL_SQL = """
SELECT p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
       p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
       p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
       p.course_depth, p.course_html_description
FROM package p
JOIN package_institute pi ON pi.package_id = p.id
WHERE p.id = :id AND pi.institute_id = :inst AND p.status <> 'DELETED'
LIMIT 1
"""


def course_update_body(ctx: ToolContext, course_id: str) -> Optional[Dict[str, Any]]:
    """
    Every column ``PUT /course/v1/update-course/{id}`` overwrites, as currently
    stored, in its PackageDTO shape. That endpoint sets each field to whatever it
    is sent (nulls included), so a change starts from this and edits one key.
    """
    rows = _rows(ctx, _COURSE_FULL_SQL, {"id": str(course_id), "inst": ctx.principal.institute_id})
    if not rows:
        return None
    r = rows[0]
    return {
        "id": r["id"], "package_name": r["package_name"], "thumbnail_file_id": r["thumbnail_file_id"],
        "is_course_published_to_catalaouge": r["is_course_published_to_catalaouge"],
        "course_preview_image_media_id": r["course_preview_image_media_id"],
        "course_banner_media_id": r["course_banner_media_id"], "course_media_id": r["course_media_id"],
        "why_learn_html": r["why_learn"], "who_should_learn_html": r["who_should_learn"],
        "about_the_course_html": r["about_the_course"],
        "tags": [t.strip() for t in (r["comma_separated_tags"] or "").split(",") if t.strip()],
        "course_depth": r["course_depth"], "course_html_description_html": r["course_html_description"],
    }


_BATCH_SQL = """
SELECT ps.id FROM package_session ps
WHERE ps.package_id = :pkg AND ps.status = 'ACTIVE'
ORDER BY ps.created_at ASC
LIMIT 1
"""


def active_batch_id(ctx: ToolContext, course_id: str) -> Optional[str]:
    """The course's PRIMARY batch (oldest ACTIVE). Content is shared by all of
    a course's batches, so the tree is read through this one — use
    course_batches() for anything that is per batch (invites, enrolments)."""
    rows = _rows(ctx, _BATCH_SQL, {"pkg": course_id})
    return rows[0]["id"] if rows else None


_BATCHES_SQL = """
SELECT ps.id, ps.session_id, s.session_name, s.start_date, ps.level_id, l.level_name, ps.status,
       (SELECT COUNT(*) FROM student_session_institute_group_mapping m
         WHERE m.package_session_id = ps.id AND m.institute_id = :inst AND m.status = 'ACTIVE') AS enrolled
FROM package_session ps
LEFT JOIN session s ON s.id = ps.session_id
LEFT JOIN level l ON l.id = ps.level_id
WHERE ps.package_id = :pkg AND ps.status = 'ACTIVE'
ORDER BY ps.created_at ASC
"""


def _label(name: Optional[str]) -> Optional[str]:
    """Session / level name as the admin sees it — the DEFAULT placeholder is no name."""
    return None if not name or name.upper() == DEFAULT_LEVEL_NAME else name


def course_batches(ctx: ToolContext, course_id: str) -> List[Dict[str, Any]]:
    """Every ACTIVE batch (session × level) of a course — the INVITED sentinel excluded."""
    rows = _rows(ctx, _BATCHES_SQL, {"pkg": course_id, "inst": ctx.principal.institute_id})
    out = []
    for r in rows:
        session, level = _label(r.get("session_name")), _label(r.get("level_name"))
        out.append({
            "id": r["id"],
            "session": session, "session_id": r.get("session_id") if session else None,
            "level": level, "level_id": r.get("level_id") if level else None,
            "start_date": r.get("start_date"),
            "name": " · ".join(x for x in (session, level) if x) or "Default batch",
            "enrolled": int(r.get("enrolled") or 0),
        })
    return out


_SESSIONS_LEVELS_SQL = """
SELECT DISTINCT 'session' AS kind, s.id, s.session_name AS name, s.start_date
FROM package_session ps JOIN package_institute pi ON pi.package_id = ps.package_id
JOIN session s ON s.id = ps.session_id
WHERE pi.institute_id = :inst AND ps.status = 'ACTIVE' AND COALESCE(s.status, 'ACTIVE') = 'ACTIVE'
UNION
SELECT DISTINCT 'level' AS kind, l.id, l.level_name AS name, NULL::date AS start_date
FROM package_session ps JOIN package_institute pi ON pi.package_id = ps.package_id
JOIN level l ON l.id = ps.level_id
WHERE pi.institute_id = :inst AND ps.status = 'ACTIVE' AND COALESCE(l.status, 'ACTIVE') = 'ACTIVE'
"""


def institute_sessions_levels(ctx: ToolContext) -> Dict[str, List[Dict[str, Any]]]:
    """The sessions and levels the institute already uses (DEFAULT placeholders left out)."""
    rows = _rows(ctx, _SESSIONS_LEVELS_SQL, {"inst": ctx.principal.institute_id})
    out: Dict[str, List[Dict[str, Any]]] = {"sessions": [], "levels": []}
    for r in rows:
        if not _label(r.get("name")):
            continue
        item = {"id": r["id"], "name": r["name"]}
        if r["kind"] == "session":
            item["start_date"] = r.get("start_date")
            out["sessions"].append(item)
        else:
            out["levels"].append(item)
    for k in out:
        out[k].sort(key=lambda x: str(x["name"]).casefold())
    return out


_ENROLLED_SQL = """
SELECT COUNT(*) AS n FROM student_session_institute_group_mapping
WHERE package_session_id = :ps AND institute_id = :inst AND status = 'ACTIVE'
"""


def enrolled_count(ctx: ToolContext, package_session_id: Optional[str]) -> int:
    """Learners enrolled in ONE batch (course_batches() carries the per-batch counts)."""
    if not package_session_id:
        return 0
    rows = _rows(ctx, _ENROLLED_SQL, {"ps": package_session_id, "inst": ctx.principal.institute_id})
    return int(rows[0]["n"] or 0) if rows else 0


_SUBJECTS_SQL = """
SELECT s.id, s.subject_name AS name, ss.subject_order AS "order"
FROM subject_session ss JOIN subject s ON s.id = ss.subject_id
WHERE ss.session_id = :ps AND COALESCE(s.status, 'ACTIVE') <> 'DELETED'
ORDER BY ss.subject_order NULLS LAST, s.created_at
"""

_MODULES_SQL = """
SELECT smm.subject_id, m.id, m.module_name AS name, smm.module_order AS "order"
FROM subject_module_mapping smm JOIN modules m ON m.id = smm.module_id
WHERE smm.subject_id = ANY(:subjects) AND COALESCE(m.status, 'ACTIVE') <> 'DELETED'
ORDER BY smm.module_order NULLS LAST, smm.created_at
"""

_CHAPTERS_SQL = """
SELECT mcm.module_id, c.id, c.chapter_name AS name, cpsm.chapter_order AS "order", cpsm.status
FROM module_chapter_mapping mcm
JOIN chapter c ON c.id = mcm.chapter_id
JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = c.id AND cpsm.package_session_id = :ps
WHERE mcm.module_id = ANY(:modules) AND cpsm.status <> 'DELETED' AND COALESCE(c.status, 'ACTIVE') <> 'DELETED'
ORDER BY cpsm.chapter_order NULLS LAST, c.created_at
"""

_SLIDES_SQL = """
SELECT cts.chapter_id, s.id, s.title, s.source_type AS type, s.source_id, cts.status, cts.slide_order AS "order"
FROM chapter_to_slides cts JOIN slide s ON s.id = cts.slide_id
WHERE cts.chapter_id = ANY(:chapters) AND cts.status <> 'DELETED'
ORDER BY cts.slide_order NULLS LAST, s.created_at
"""


def course_tree(ctx: ToolContext, course_id: str, package_session_id: str) -> List[Dict[str, Any]]:
    """subjects → modules → chapters → slides for one batch of a course."""
    subjects = _rows(ctx, _SUBJECTS_SQL, {"ps": package_session_id})
    if not subjects:
        return []
    modules = _rows(ctx, _MODULES_SQL, {"subjects": [s["id"] for s in subjects]})
    chapters = _rows(ctx, _CHAPTERS_SQL, {"ps": package_session_id, "modules": [m["id"] for m in modules]}) if modules else []
    slides = _rows(ctx, _SLIDES_SQL, {"chapters": [c["id"] for c in chapters]}) if chapters else []

    slides_by_ch: Dict[str, List[Dict[str, Any]]] = {}
    for s in slides:
        slides_by_ch.setdefault(s.pop("chapter_id"), []).append(s)
    chapters_by_mod: Dict[str, List[Dict[str, Any]]] = {}
    for c in chapters:
        c["slides"] = slides_by_ch.get(c["id"], [])
        chapters_by_mod.setdefault(c.pop("module_id"), []).append(c)
    modules_by_sub: Dict[str, List[Dict[str, Any]]] = {}
    for m in modules:
        m["chapters"] = chapters_by_mod.get(m["id"], [])
        modules_by_sub.setdefault(m.pop("subject_id"), []).append(m)
    for s in subjects:
        s["modules"] = modules_by_sub.get(s["id"], [])
    return subjects


def flatten_chapters(tree: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Every chapter with the ids of its parents, in course order."""
    out = []
    for s in tree:
        for m in s.get("modules") or []:
            for c in m.get("chapters") or []:
                out.append({**c, "subject_id": s["id"], "module_id": m["id"],
                            "subject_name": s["name"], "module_name": m["name"]})
    return out


_CHAPTER_CTX_SQL = """
SELECT c.id AS chapter_id, c.chapter_name, mcm.module_id, smm.subject_id,
       cpsm.package_session_id, p.id AS course_id, p.status AS course_status, p.course_depth
FROM chapter c
JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = c.id AND cpsm.status <> 'DELETED'
JOIN package_session ps ON ps.id = cpsm.package_session_id
JOIN package p ON p.id = ps.package_id
JOIN package_institute pi ON pi.package_id = p.id AND pi.institute_id = :inst
JOIN module_chapter_mapping mcm ON mcm.chapter_id = c.id
JOIN subject_module_mapping smm ON smm.module_id = mcm.module_id
WHERE c.id = :id
LIMIT 1
"""


def chapter_context(ctx: ToolContext, chapter_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Everything a slide write needs about a chapter of THIS institute, else None."""
    if not chapter_id:
        return None
    rows = _rows(ctx, _CHAPTER_CTX_SQL, {"id": str(chapter_id), "inst": ctx.principal.institute_id})
    return rows[0] if rows else None


_SLIDE_CTX_SQL = """
SELECT s.id AS slide_id, s.title, s.source_type, s.source_id, s.status AS slide_status,
       cts.chapter_id, cts.slide_order
FROM slide s JOIN chapter_to_slides cts ON cts.slide_id = s.id AND cts.status <> 'DELETED'
WHERE s.id = :id
LIMIT 1
"""


def slide_context(ctx: ToolContext, slide_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """A slide of THIS institute with its chapter context, else None."""
    if not slide_id:
        return None
    rows = _rows(ctx, _SLIDE_CTX_SQL, {"id": str(slide_id)})
    if not rows:
        return None
    chapter = chapter_context(ctx, rows[0]["chapter_id"])
    if chapter is None:
        return None
    return {**chapter, **rows[0]}


_INVITES_SQL = """
SELECT ei.id, ei.name, ei.status, ei.tag, ei.invite_code, ei.short_url, ei.currency, ei.vendor,
       ei.start_date, ei.end_date, ei.learner_access_days, ei.created_at,
       b.id AS link_id, po.id AS payment_option_id, po.name AS payment_option_name, po.type AS payment_type,
       po.require_approval
       , b.package_session_id
FROM enroll_invite ei
JOIN package_session_learner_invitation_to_payment_option b
     ON b.enroll_invite_id = ei.id AND b.status = 'ACTIVE' AND b.package_session_id = ANY(:ps)
LEFT JOIN payment_option po ON po.id = b.payment_option_id
WHERE ei.institute_id = :inst AND ei.status <> 'DELETED'
ORDER BY ei.created_at DESC
LIMIT 200
"""

_PLANS_SQL = """
SELECT payment_option_id, id, name, actual_price, elevated_price, currency, validity_in_days
FROM payment_plan
WHERE payment_option_id = ANY(:ids) AND status = 'ACTIVE'
ORDER BY validity_in_days NULLS LAST
"""


def invites_for_batches(ctx: ToolContext, package_session_ids: List[str]) -> List[Dict[str, Any]]:
    """
    Invites linked to any of the given batches — one row per invite, newest
    first. ``links`` holds one entry per (invite, batch) link (its id is what a
    payment-option swap replaces); ``batch_ids`` the batches it enrols into.
    """
    if not package_session_ids:
        return []
    rows = _rows(ctx, _INVITES_SQL, {"ps": list(package_session_ids), "inst": ctx.principal.institute_id})
    invites: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        link = {"link_id": r.pop("link_id"), "package_session_id": r.pop("package_session_id"),
                "payment_option_id": r.get("payment_option_id")}
        inv = invites.setdefault(r["id"], {**r, "links": []})
        inv["links"].append(link)
    out = list(invites.values())
    option_ids = sorted({i["payment_option_id"] for i in out if i.get("payment_option_id")})
    plans = _rows(ctx, _PLANS_SQL, {"ids": option_ids}) if option_ids else []
    plans_by_opt: Dict[str, List[Dict[str, Any]]] = {}
    for p in plans:
        plans_by_opt.setdefault(p.pop("payment_option_id"), []).append(p)
    for i in out:
        i["plans"] = plans_by_opt.get(i.get("payment_option_id"), [])
        i["is_default"] = (i.get("tag") or "") == "DEFAULT"
        i["batch_ids"] = [l["package_session_id"] for l in i["links"]]
        i["link_id"] = i["links"][0]["link_id"]
    return out


def invites_for_batch(ctx: ToolContext, package_session_id: str) -> List[Dict[str, Any]]:
    return invites_for_batches(ctx, [package_session_id])


def invite_row(ctx: ToolContext, invite_id: Optional[str], package_session_ids: Any) -> Optional[Dict[str, Any]]:
    """An invite of THIS institute linked to the given batch(es), else None."""
    if not invite_id:
        return None
    ids = [package_session_ids] if isinstance(package_session_ids, str) else list(package_session_ids or [])
    for r in invites_for_batches(ctx, ids):
        if r["id"] == invite_id:
            return r
    return None


_CUSTOM_FIELDS_BY_KEY_SQL = """
SELECT id, field_key, field_name, field_type, config, status
FROM custom_fields
WHERE field_key = ANY(:keys)
ORDER BY (status = 'ACTIVE') DESC, created_at DESC
"""


def custom_fields_by_keys(ctx: ToolContext, keys: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    The institute's existing field definitions for the given field keys (keys
    already carry ``_inst_<institute>``, so this cannot see another institute's
    fields). Admin-core reuses — and overwrites — the row for a key, so callers
    look first and bind to it by id instead.
    """
    if not keys:
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for r in _rows(ctx, _CUSTOM_FIELDS_BY_KEY_SQL, {"keys": list(keys)}):
        out.setdefault(r["field_key"], r)
    return out


async def payment_vendors(ctx: ToolContext, *, strict: bool = False) -> Optional[List[Dict[str, str]]]:
    """
    Active payment gateways of the institute (empty = none configured).
    ``strict=True`` returns None when the list could not be read, so a caller
    can tell "none configured" from "unknown".
    """
    data = await admin_core(
        ctx, "GET", "/admin-core-service/open/v1/institute/payment-setting/vendors",
        params={"instituteId": ctx.principal.institute_id},
    )
    if not isinstance(data, list):
        return None if strict else []
    return [v for v in data if isinstance(v, dict)]


# ── media-service upload (PDF slides need a media file id) ───────────────

async def upload_to_media(ctx: ToolContext, content: bytes, file_name: str, content_type: str) -> Any:
    """
    The dashboard's own upload flow with the caller's JWT: presigned URL → PUT →
    acknowledge. Returns the media file id, or an error dict.
    """
    import httpx

    if not ctx.bearer_token:
        return err("no_auth", message="Uploads are unavailable right now (no session).")
    base = _settings().media_server_base_url.rstrip("/")
    headers = _jwt_headers(ctx)
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            signed = await client.post(
                f"{base}/media-service/get-signed-url", headers=headers,
                json={"file_name": file_name, "file_type": content_type,
                      "source": "COURSE_BUILDER", "source_id": ctx.principal.institute_id},
            )
            if signed.status_code >= 300:
                return err("upload_failed", message="The media service refused the upload.", status=signed.status_code)
            data = signed.json() if signed.content else {}
            file_id, url = data.get("id"), data.get("url")
            if not file_id or not url:
                return err("upload_failed", message="The media service returned no upload URL.")
            put = await client.put(url, content=content, headers={"Content-Type": content_type})
            if put.status_code >= 300:
                return err("upload_failed", message="The file could not be stored.", status=put.status_code)
            ack = await client.post(f"{base}/media-service/acknowledge", headers=headers,
                                    json={"file_id": file_id, "user_id": ctx.principal.user_id})
            if ack.status_code >= 300:
                logger.warning("media acknowledge for %s -> %s", file_id, ack.status_code)
    except Exception as exc:  # noqa: BLE001
        logger.warning("course builder media upload failed: %s", exc)
        return err("upload_failed", message="The media service could not be reached.")
    return file_id


async def fetch_public_file(url: str, *, max_bytes: int, allowed_types: Dict[str, str]) -> Any:
    """
    Download a public https file (SSRF-guarded like the website importer).
    Returns (bytes, content_type, ext) or an error dict.
    """
    from .safe_http import WEB_PORTS, SafeFetchError, safe_fetch

    if not str(url or "").lower().startswith("https://"):
        return err("bad_request", message="Only public https URLs can be imported.")
    # safe_fetch re-validates every redirect hop and pins the connection to the
    # checked address (the old follow_redirects=True fetched a 302 to a private
    # address, and a second DNS lookup could be rebound).
    try:
        resp = await safe_fetch(
            url, max_bytes=max_bytes, timeout=45.0, total_timeout=90.0, allowed_ports=WEB_PORTS,
            headers={"User-Agent": "VacademyCourseImport/1.0"},
        )
    except SafeFetchError as exc:
        if exc.code in ("blocked_host", "blocked_address", "bad_url"):
            return err("bad_request", message="That address is not a public website.")
        if exc.code == "too_large":
            return err("too_large", message=f"Files over {max_bytes // 1_000_000} MB cannot be imported.")
        logger.warning("course import fetch failed for %s: %s", url[:200], exc.code)
        return err("fetch_failed", message="The file could not be downloaded.")
    if resp.status_code != 200 or not resp.content:
        return err("fetch_failed", message=f"The file could not be downloaded (HTTP {resp.status_code}).")
    ctype = resp.content_type
    if ctype not in allowed_types and resp.content[:5] == b"%PDF-" and "application/pdf" in allowed_types:
        ctype = "application/pdf"  # servers often send octet-stream for PDFs
    ext = allowed_types.get(ctype)
    if not ext:
        return err("wrong_type", message=f"Unsupported content type '{ctype or 'unknown'}'.")
    return resp.content, ctype, ext


# ── course settings (drip lives here) ────────────────────────────────────

COURSE_SETTING_KEY = "COURSE_SETTING"
COURSE_SETTING_NAME = "Course Creation Configuration"


# ── images (course + invite media) ─────────────────────────────────────

MEDIA_IMAGE_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
MAX_MEDIA_IMAGE_BYTES = 6_000_000
_FILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MEDIA_SPEC_DOC = ("{image_url} (public https image — imported into the institute's media) | {file_id} (existing "
                  "media file) | 'none'")


def check_media_spec(spec: Any, label: str, *, allow_youtube: bool = False) -> Optional[str]:
    """What is wrong with an image spec, without fetching anything — so a bad one fails before any import."""
    if spec == "none":
        return None
    if not isinstance(spec, dict):
        return f"{label} must be {MEDIA_SPEC_DOC}" + (" | {youtube: url}" if allow_youtube else "")
    if spec.get("youtube"):
        if not allow_youtube:
            return f"{label} cannot be a video — only the intro media takes {{youtube}}"
        from .course_content import youtube_id
        return None if youtube_id(spec["youtube"]) else \
            f"{label}.youtube must be a YouTube https link (watch / youtu.be / embed / shorts)"
    if spec.get("file_id"):
        return None if _FILE_ID_RE.match(str(spec["file_id"]).strip()) else \
            f"{label}.file_id is not a media file id (pass a URL as image_url instead)"
    if spec.get("image_url"):
        return None if str(spec["image_url"]).strip().lower().startswith("https://") else \
            f"{label}.image_url must be a public https URL"
    return f"{label} must be {MEDIA_SPEC_DOC}"


async def resolve_media(ctx: ToolContext, spec: Any, label: str, *,
                        allow_youtube: bool = False) -> Tuple[Optional[Tuple[str, str]], Optional[str]]:
    """
    An image spec → (kind, value): ("image", media file id), ("youtube", url) or
    ("", "") for 'none'; else (None, problem). Images are stored as media file
    ids — the learner pages turn ids into URLs, never the other way round.
    """
    problem = check_media_spec(spec, label, allow_youtube=allow_youtube)
    if problem:
        return None, problem
    if spec == "none":
        return ("", ""), None
    if spec.get("youtube"):
        return ("youtube", str(spec["youtube"]).strip()), None
    if spec.get("file_id"):
        return ("image", str(spec["file_id"]).strip()), None
    fetched = await fetch_public_file(str(spec["image_url"]).strip(), max_bytes=MAX_MEDIA_IMAGE_BYTES,
                                      allowed_types=MEDIA_IMAGE_TYPES)
    if is_error(fetched):
        return None, f"{label}: {fetched.get('message')}"
    content, ctype, ext = fetched
    file_id = await upload_to_media(ctx, content, f"{label.replace('.', '-')}.{ext}", ctype)
    if is_error(file_id):
        return None, f"{label}: {file_id.get('message')}"
    return ("image", file_id), None


async def load_course_settings(ctx: ToolContext) -> Any:
    """The institute's COURSE_SETTING data ({} when never saved), or an error dict."""
    data = await admin_core(
        ctx, "GET", "/admin-core-service/institute/setting/v1/data",
        params={"instituteId": ctx.principal.institute_id, "settingKey": COURSE_SETTING_KEY},
    )
    if is_error(data):
        # Never-saved setting answers 4xx on some deployments — treat as empty,
        # but a 5xx / auth failure must not be mistaken for "no settings".
        if data.get("status") in (400, 404):
            return {}
        return data
    if data in ("", None):
        return {}
    if isinstance(data, str):
        import json
        try:
            data = json.loads(data)
        except ValueError:
            return err("bad_setting", message="The institute's course settings could not be read.")
    return data if isinstance(data, dict) else {}


async def save_course_settings(ctx: ToolContext, data: Dict[str, Any]) -> Any:
    """Save the FULL COURSE_SETTING data (admin-core replaces it wholesale)."""
    return await admin_core(
        ctx, "POST", "/admin-core-service/institute/setting/v1/save-setting",
        params={"instituteId": ctx.principal.institute_id, "settingKey": COURSE_SETTING_KEY},
        body={"setting_name": COURSE_SETTING_NAME, "setting_data": data},
    )


__all__ = [
    "STATUS_DRAFT", "STATUS_IN_REVIEW", "STATUS_ACTIVE", "DEFAULT_LEVEL_NAME",
    "err", "is_error", "admin_core", "admin_base", "course_editor_url",
    "list_courses", "course_row", "active_batch_id", "course_batches", "institute_sessions_levels",
    "enrolled_count", "course_tree", "flatten_chapters",
    "chapter_context", "slide_context", "invites_for_batches", "invites_for_batch", "invite_row", "payment_vendors",
    "custom_fields_by_keys", "course_update_body", "check_media_spec", "resolve_media", "MEDIA_SPEC_DOC",
    "load_course_settings", "save_course_settings",
]
