"""
The ``catalog_data_edit`` tool — set up the institute's catalogue DATA a site
design needs (folder libraries for stream tabs / mega menus, course tags for
the FORMAT / FOR / language filters, product pages for learning paths and the
store), additively.

Actions:

    create_folder_library  a new, empty library; no site uses it until a page
                           binds it (website_edit bind_data).
    upsert_folder_nodes    folders matched by their key (slug). A new folder is
                           created HIDDEN; a matching folder gets the fields the
                           caller sends that differ — never its title (no
                           rename), parent (no move) or visibility, and only
                           while it is HIDDEN or no live (ACTIVE) site uses the
                           library, whoever created it. Nothing is ever deleted
                           or cleared.
    add_course_tags        appends slug-normalised tags; existing tags are kept
                           exactly. admin-core's update-course writes EVERY
                           field of the course and lower-cases its tags, so the
                           whole stored course is read and sent back with only
                           the tags grown; a course whose existing tags that
                           round trip would change is refused.
    create_product_page    a DRAFT product page selling the given courses
                           through each one's DEFAULT invite (or the invite
                           named), its payment option and plan — picked by the
                           rule admin-core's catalogue sync uses. NOTE: admin-
                           core does not gate DRAFT pages yet; anyone with the
                           page's code can open it (follow-up for admin-core).
    sync_store             the product page's own "add catalogue courses"
                           (/{id}/sync-catalogue) with deactivateMissing=false:
                           adds courses, never switches one off.

Every action is a dry run unless the caller passes dry_run=false, and returns
exactly what it would change plus a ``plan_token``: an HMAC over the caller,
the action, its arguments and the plan computed from the data read, valid
for 10 minutes. Applying (dry_run=false) requires that token and recomputes
the plan from fresh data first: a different plan (other arguments, or data
that changed since) is refused, so what is applied is what the admin saw.
Not here, on purpose (product decision 2):
activating a product page and switching an invite's payment vendor stay admin
clicks in the dashboard.

Gated by its own settings group (Website → "Set up course data", risk
live-additive, off until an admin turns it on) and MCP-only: the in-product
assistant is never offered it. Identity is pinned by ``execute_tool``; every
id argument is checked against the caller's institute before any write, and
every admin-core call replays the caller's own token (``_admin_core_json``).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import time
import unicodedata
import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy import text

from .assistant_tool_registry import ToolContext, ToolSpec, _admin_core_json
from .website_data import _err, _is_error, list_catalogues, list_folder_libraries, get_campaign

logger = logging.getLogger(__name__)

CATALOG_DATA_EDIT_TOOL_NAME = "catalog_data_edit"
#: Its own settings group: off for every existing institute and connection.
CATALOG_DATA_EDIT_GROUP_KEY = "website_data_edits"
CATALOG_DATA_EDIT_ACTIONS = (
    "create_folder_library", "upsert_folder_nodes", "add_course_tags", "create_product_page", "sync_store",
)
#: The admin-core calls this tool makes, by action — the ONLY writes it can
#: send (pinned by a test: no DELETE, no library rename, no node move, no
#: product-page update / activate, no invite change).
WRITE_ENDPOINTS = {
    "create_folder_library": ("POST", "/admin-core-service/v1/folder-library/library"),
    "upsert_folder_nodes": (("POST", "/admin-core-service/v1/folder-library/node"),
                            ("PUT", "/admin-core-service/v1/folder-library/node")),
    "add_course_tags": ("PUT", "/admin-core-service/course/v1/update-course/{course_id}"),
    "create_product_page": ("POST", "/admin-core-service/v1/product-page/create"),
    "sync_store": ("POST", "/admin-core-service/v1/product-page/{id}/sync-catalogue"),
}

MAX_NODES = 100
#: How long a dry run's plan_token may be applied (decision 2: dry run first).
PLAN_TOKEN_TTL_SECONDS = 600
_PLAN_TOKEN_VERSION = "cdp1"
MAX_COURSES = 50
MAX_TAGS_PER_COURSE = 20
MAX_PRODUCT_PAGE_ITEMS = 50
#: Result lists longer than this are cut (with a count).
MAX_LISTED = 100

# admin-core's own bounds (CatalogueFolderService / FolderLibraryDTOs), checked
# here first so a bad field is reported per node instead of failing mid-apply.
_MAX_NAME = 255
_MAX_DESCRIPTION = 2000
_MAX_SLUG = 120
_MAX_TAG = 191
_MAX_SUBTITLE = 255
_MAX_TAGLINE = 255
_MAX_CTA = 120
_MAX_URL = 2048
#: admin-core CatalogueFolderService.MAX_DEPTH (top level = 1) and MAX_NODES (items per library).
_MAX_DEPTH = 10
_MAX_LIBRARY_NODES = 2000
_HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
_SECRET_ARG_RE = re.compile(r"(token|secret|password|api[_-]?key|authorization|bearer|cookie|^pat$)", re.I)
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_COURSE_STATUSES = ("ACTIVE", "DRAFT", "IN_REVIEW")
_LIVE_SITE_STATUSES = {"", "ACTIVE"}
_KIND_LIBRARY = "folder_library"

#: The settings a product page created in the dashboard starts with
#: (frontend-admin-dashboard product-page-types.ts DEFAULT_PRODUCT_PAGE_SETTINGS).
DEFAULT_PRODUCT_PAGE_SETTINGS: Dict[str, Any] = {
    "defaultStep": "CATALOG",
    "allowCourseDeselection": True,
    "tnc": {"enabled": False, "content": "", "externalUrl": ""},
    "invoice": {"enabled": True, "channels": ["EMAIL"]},
    "suggestedCourses": {"enabled": False, "heading": "People also buy"},
    "disableBackNavigation": False,
    "coupon": {"enabled": False},
    "afterPaymentRedirectUrl": "",
    "afterPaymentRedirectDelaySeconds": 3,
    "showLoginButton": True,
    "successPageContent": "",
}

#: admin-core does not gate a DRAFT product page by status yet (by-code read and
#: enrol both serve it), so the tool never calls DRAFT "hidden".
DRAFT_PAGE_NOTE = ("DRAFT here means not activated and not on any site until one binds it; the page's own link "
                   "(its code) still opens for anyone who has it, so share it only after the admin activates it.")

#: Plain words for admin-core's sync / sellability reason codes.
REASON_TEXT = {
    "no_active_invite": "the course has no active enrollment link for this batch",
    "non_default_invite": "the course has no open DEFAULT enrollment link (a scholarship or promo link never sets the price)",
    "invite_inactive": "its enrollment link is not active",
    "invite_not_started": "its enrollment link has not opened yet",
    "invite_expired": "its enrollment link has expired",
    "invite_not_linked": "the invite named is not linked to this batch",
    "payment_option_inactive": "its payment option is not active",
    "cpo_not_supported": "it uses a CPO payment option (the cart checks out one CPO course at a time)",
    "no_active_plan": "its payment option has no active plan",
    "currency_mismatch": "it is priced in another currency than the page",
    "vendor_mismatch": "it is on another payment gateway than the page",
}

FIELD_TEXT = (
    "Folder fields: key (its URL key / slug — the match key), parent_key?, title, subtitle?, tagline?, description?, "
    "cta? (button label), link_url? ('/route' or https://…), course_tag? (the course tag the folder filters by; "
    "default = key), image_url? (an institute asset: website(list_media) / website_edit(import_image)), "
    "accent_color? (#hex), coming_soon?, audience_id? (an ACTIVE lead campaign of this institute)."
)

_NODE_ITEM = {
    "type": "object",
    "properties": {
        "key": {"type": "string", "description": "The folder's slug ([a-z0-9-], unique in the library) — matched to existing folders."},
        "parent_key": {"type": "string", "description": "The parent folder's key (an existing folder or one in this call); omit for top level."},
        "title": {"type": "string"},
        "subtitle": {"type": "string"},
        "tagline": {"type": "string"},
        "description": {"type": "string"},
        "cta": {"type": "string", "description": "Button label."},
        "link_url": {"type": "string"},
        "course_tag": {"type": "string"},
        "image_url": {"type": "string"},
        "accent_color": {"type": "string"},
        "coming_soon": {"type": "boolean"},
        "audience_id": {"type": "string"},
    },
    "required": ["key"],
}

CATALOG_DATA_EDIT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": CATALOG_DATA_EDIT_TOOL_NAME,
        "description": (
            "Set up the catalogue DATA a site design needs — ADDITIVE ONLY: never deletes, renames, hides or clears "
            "anything. Every action is a DRY RUN by default and returns exactly what it would change plus a "
            "plan_token: show the plan to the admin, then call again with the SAME arguments, dry_run=false and that "
            f"plan_token (valid {PLAN_TOKEN_TTL_SECONDS // 60} minutes; refused when the data changed since). Unknown "
            "arguments are refused. Ids come from website(action='data_inventory').\n"
            "- create_folder_library (name, description?): a new empty folder library (not used by any site until "
            "you bind it with website_edit(bind_data)).\n"
            f"- upsert_folder_nodes (library_id, nodes[≤{MAX_NODES}]): folders matched by key. New folders are "
            "created HIDDEN (the admin shows them in Manage Pages → Folders). A matching folder gets the fields you "
            "send that differ — never its title, parent or visibility — and only while the folder is HIDDEN or no "
            f"live site uses the library. {FIELD_TEXT}\n"
            f"- add_course_tags (assignments[≤{MAX_COURSES}] of {{course_id, add[]}}): appends tags (lower-case, "
            "[a-z0-9-], e.g. 'format-ebook', 'for-students'); existing tags are kept. Returns before/after per course. "
            "On a live course the new tags change the site's filters at once.\n"
            "- create_product_page (name, items[{course_id, invite_id?, package_session_id?}], role='path'|'store'): "
            "a DRAFT product page selling each course through its DEFAULT invite (or invite_id), its payment option "
            "and cheapest active plan. 'path' = one batch per step (pass package_session_id when a course has "
            "several); 'store' = every sellable batch. It is listed nowhere until a site binds it and the admin "
            "activates it, but its link already opens for anyone who has the code — do not share it before then.\n"
            "- sync_store (product_page_code): adds the catalogue courses the product page does not sell yet (never "
            "switches one off) and returns why any were skipped. On an ACTIVE page the added courses are on sale at "
            "once.\n"
            "Never send access tokens or other credentials."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(CATALOG_DATA_EDIT_ACTIONS)},
                "dry_run": {"type": "boolean", "description": "Default true: report the change without making it. false = apply (needs plan_token)."},
                "plan_token": {"type": "string", "description": (
                    "dry_run=false: the plan_token the dry run of these same arguments returned (valid "
                    f"{PLAN_TOKEN_TTL_SECONDS // 60} minutes). It is this server's own check value, not a credential.")},
                "name": {"type": "string", "description": "create_folder_library / create_product_page: its name."},
                "description": {"type": "string", "description": "create_folder_library: optional description."},
                "library_id": {"type": "string", "description": "upsert_folder_nodes: the library (website(data_inventory) folder_libraries)."},
                "nodes": {"type": "array", "items": _NODE_ITEM, "description": "upsert_folder_nodes: the folders."},
                "assignments": {
                    "type": "array",
                    "items": {"type": "object", "properties": {
                        "course_id": {"type": "string"},
                        "add": {"type": "array", "items": {"type": "string"}},
                    }, "required": ["course_id", "add"]},
                    "description": "add_course_tags: tags to append per course.",
                },
                "items": {
                    "type": "array",
                    "items": {"type": "object", "properties": {
                        "course_id": {"type": "string"},
                        "invite_id": {"type": "string", "description": "Optional: sell through this invite instead of the DEFAULT one."},
                        "package_session_id": {"type": "string", "description": "Optional: this batch only."},
                    }, "required": ["course_id"]},
                    "description": "create_product_page: the courses, in display order.",
                },
                "role": {"type": "string", "enum": ["path", "store"], "description": "create_product_page: default 'path'."},
                "product_page_code": {"type": "string", "description": "sync_store: the product page (website(data_inventory) product_pages code)."},
            },
            "required": ["action"],
        },
    },
}


# ──────────────────────────────────────────────────────────────────────────
# Small helpers
# ──────────────────────────────────────────────────────────────────────────
def _dry_run(args: Dict[str, Any]) -> bool:
    """True unless the caller explicitly passed dry_run=false."""
    value = args.get("dry_run", True)
    if isinstance(value, str):
        return value.strip().lower() not in ("false", "0", "no")
    return value is not False and value != 0


def _str(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def slugify(raw: Any, limit: int = _MAX_TAG) -> str:
    """Lower-case [a-z0-9-] key, the learner site's folder-slug rule (catalogue_course_rules.folder_slug)."""
    value = unicodedata.normalize("NFKD", raw if isinstance(raw, str) else "")
    value = re.sub(r"[̀-ͯ]", "", value).lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:limit].strip("-")


def _secret_args(args: Dict[str, Any]) -> List[str]:
    return [k for k in args if isinstance(k, str) and _SECRET_ARG_RE.search(k)]


def _admin_base(ctx: ToolContext) -> str:
    try:
        from .course_builder_data import admin_base
        return admin_base(ctx).rstrip("/")
    except Exception:  # noqa: BLE001 — a link is a convenience, never a failure
        return ""


def _folders_url(ctx: ToolContext) -> str:
    return f"{_admin_base(ctx)}/manage-pages"


def _product_page_url(ctx: ToolContext, page_id: Any) -> str:
    return f"{_admin_base(ctx)}/manage-pages/product-pages/editor/{page_id}"


def _cap(items: List[Any]) -> Tuple[List[Any], Optional[int]]:
    return (items[:MAX_LISTED], len(items) - MAX_LISTED) if len(items) > MAX_LISTED else (items, None)


def _sql_rows(ctx: ToolContext, sql: str, params: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    """Rows, or None when the read failed (rolled back so later reads still work)."""
    try:
        result = ctx.db.execute(text(sql), params)
        return [dict(r._mapping) for r in result.fetchall()]
    except Exception as exc:  # noqa: BLE001
        logger.warning("catalog_data_edit query failed: %s", exc)
        try:
            ctx.db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None


def _as_date(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and len(value) >= 10:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _as_timestamp(value: Any) -> Optional[float]:
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).timestamp()
    return None


def _fetch_failed(what: str, data: Any) -> Dict[str, Any]:
    status = data.get("status") if isinstance(data, dict) else None
    return _err("fetch_failed", message=f"Could not read {what}; nothing was changed. Try again.",
                **({"status": status} if status else {}))


# ──────────────────────────────────────────────────────────────────────────
# Arguments: only the ones an action reads (an ignored "remove" or
# "status": "ACTIVE" would let a caller believe it happened)
# ──────────────────────────────────────────────────────────────────────────
_COMMON_ARGS = {"action", "dry_run", "plan_token", "user_id", "institute_id"}
_ACTION_ARGS = {
    "create_folder_library": {"name", "description"},
    "upsert_folder_nodes": {"library_id", "nodes"},
    "add_course_tags": {"assignments"},
    "create_product_page": {"name", "items", "role"},
    "sync_store": {"product_page_code"},
}
_ASSIGNMENT_KEYS = {"course_id", "add"}
_ITEM_KEYS = {"course_id", "invite_id", "package_session_id"}
#: Not part of what a plan_token covers: how the call is made, not what it does.
_NOT_PLAN_ARGS = {"dry_run", "plan_token", "user_id", "institute_id"}


def _unknown_args(action: str, args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    accepted = _ACTION_ARGS.get(action, set())
    unknown = sorted(str(k) for k in args if k not in accepted and k not in _COMMON_ARGS)
    if not unknown:
        return None
    return _err("unknown_argument", fields=unknown, accepted=sorted(accepted | {"dry_run", "plan_token"}), message=(
        f"{action} does not take " + ", ".join(unknown) + "; nothing was changed. This tool only adds: it never "
        "removes, deletes, renames, hides or activates anything, so there is no argument for that."))


def _unknown_item_keys(items: List[Any], allowed: Set[str], what: str) -> List[Dict[str, Any]]:
    out = []
    for i, it in enumerate(items):
        if isinstance(it, dict):
            unknown = sorted(str(k) for k in it if k not in allowed)
            if unknown:
                out.append({"index": i, "field": ",".join(unknown), "message": (
                    f"Unknown field(s) in {what}; each takes only " + ", ".join(sorted(allowed)) + ".")})
    return out


# ──────────────────────────────────────────────────────────────────────────
# plan_token: apply only the plan a dry run showed (decision 2, "dry_run first")
# ──────────────────────────────────────────────────────────────────────────
def _plan_key() -> bytes:
    from ..config import get_settings
    secret = get_settings().resolve_mcp_encryption_key()
    return hashlib.sha256(b"catalog_data_edit.plan_token|" + secret.encode("utf-8")).digest()


def _plan_digest(ctx: ToolContext, action: str, args: Dict[str, Any], plan: Dict[str, Any]) -> str:
    """Who, what and the exact plan computed from the data read — any difference is another digest."""
    request = {k: v for k, v in args.items() if k not in _NOT_PLAN_ARGS}
    payload = json.dumps({"institute": ctx.principal.institute_id, "user": ctx.principal.user_id,
                          "action": action, "args": request, "plan": plan},
                         sort_keys=True, default=str, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _plan_signature(expires: int, digest: str) -> str:
    return hmac.new(_plan_key(), f"{_PLAN_TOKEN_VERSION}.{expires}.{digest}".encode("utf-8"),
                    hashlib.sha256).hexdigest()


def issue_plan_token(ctx: ToolContext, action: str, args: Dict[str, Any], plan: Dict[str, Any],
                     now: Optional[float] = None) -> str:
    expires = int(now if now is not None else time.time()) + PLAN_TOKEN_TTL_SECONDS
    return f"{_PLAN_TOKEN_VERSION}.{expires}.{_plan_signature(expires, _plan_digest(ctx, action, args, plan))}"


def check_plan_token(ctx: ToolContext, action: str, args: Dict[str, Any], plan: Dict[str, Any],
                     now: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """None when ``plan_token`` was issued for this caller, action, arguments and plan less than 10 minutes ago."""
    again = ("Nothing was written. Call again without dry_run (a dry run), show the admin the plan it returns, "
             "then apply with dry_run=false and that plan_token.")
    token = args.get("plan_token")
    if not isinstance(token, str) or not token.strip():
        return _err("plan_token_required", message="Applying needs the plan_token of a dry run of this same call. " + again)
    parts = token.strip().split(".")
    if len(parts) != 3 or parts[0] != _PLAN_TOKEN_VERSION or not parts[1].isdigit():
        return _err("invalid_plan_token", message="That is not a plan_token this tool issued. " + again)
    expires = int(parts[1])
    expected = _plan_signature(expires, _plan_digest(ctx, action, args, plan))
    if not hmac.compare_digest(parts[2], expected):
        return _err("plan_changed", message=(
            "This plan_token does not match what applying would do now: the arguments differ from the dry run, "
            "the data changed since, or it was issued for another action or connection. " + again))
    if expires < int(now if now is not None else time.time()):
        return _err("plan_token_expired", message=(
            f"This plan_token expired (they last {PLAN_TOKEN_TTL_SECONDS // 60} minutes). " + again))
    return None


def _dry_run_result(ctx: ToolContext, action: str, args: Dict[str, Any], plan: Dict[str, Any],
                    next_text: str) -> Dict[str, Any]:
    return {"dry_run": True, **plan, "plan_token": issue_plan_token(ctx, action, args, plan),
            "plan_token_expires_in_seconds": PLAN_TOKEN_TTL_SECONDS, "next": next_text}


# ──────────────────────────────────────────────────────────────────────────
# Created-by-this-tool records (mcp_catalog_data_record)
# ──────────────────────────────────────────────────────────────────────────
_schema_ready = False


def _ensure_schema(ctx: ToolContext) -> bool:
    global _schema_ready
    if not _schema_ready:
        from ..models.catalog_data_edit import check_catalog_data_schema
        _schema_ready = check_catalog_data_schema(ctx.db)   # no DDL: Flyway V562 creates it
    return _schema_ready


def created_by_tool(ctx: ToolContext, kind: str, record_id: str) -> bool:
    """True when this tool created ``record_id`` for the caller's institute. False when unknown."""
    try:
        if not _ensure_schema(ctx):
            return False
        from ..models.catalog_data_edit import CatalogDataRecord
        row = (ctx.db.query(CatalogDataRecord)
               .filter(CatalogDataRecord.institute_id == ctx.principal.institute_id,
                       CatalogDataRecord.kind == kind, CatalogDataRecord.record_id == record_id)
               .first())
        return row is not None
    except Exception as exc:  # noqa: BLE001
        logger.warning("catalog_data_edit record lookup failed: %s", exc)
        try:
            ctx.db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return False


def record_created(ctx: ToolContext, kind: str, record_id: str) -> bool:
    try:
        if not _ensure_schema(ctx):
            return False
        from ..models.catalog_data_edit import CatalogDataRecord
        ctx.db.add(CatalogDataRecord(
            id=uuid.uuid4().hex, institute_id=ctx.principal.institute_id, kind=kind, record_id=record_id,
            created_by=ctx.principal.user_id, created_at=datetime.now(timezone.utc)))
        ctx.db.commit()
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("catalog_data_edit record save failed: %s", exc)
        try:
            ctx.db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return False


# ──────────────────────────────────────────────────────────────────────────
# create_folder_library
# ──────────────────────────────────────────────────────────────────────────
async def _action_create_folder_library(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    name = _str(args.get("name"))
    description = _str(args.get("description"))
    if not name:
        return _err("missing_argument", needs=["name"], message="Pass the new library's name.")
    if len(name) > _MAX_NAME or len(description) > _MAX_DESCRIPTION:
        return _err("too_long", message=f"name is at most {_MAX_NAME} characters, description {_MAX_DESCRIPTION}.")
    libraries = await list_folder_libraries(ctx)
    if libraries is None:
        return _fetch_failed("this institute's folder libraries", None)
    same = next((lib for lib in libraries if str(lib.get("name") or "").strip().lower() == name.lower()), None)
    if same:
        return _err("library_exists", library_id=same["id"], message=(
            f"A folder library named '{same['name']}' already exists — add folders to it with "
            "upsert_folder_nodes(library_id) instead of creating a second one."))
    plan = {"create": {"name": name, **({"description": description} if description else {})},
            "note": "The library starts empty and unattached: no site shows it until a page binds it."}
    if _dry_run(args):
        return _dry_run_result(ctx, "create_folder_library", args, plan, (
            "Nothing was written. Call again with dry_run=false and this plan_token to create it."))
    refusal = check_plan_token(ctx, "create_folder_library", args, plan)
    if refusal:
        return refusal
    body = {"name": name, **({"description": description} if description else {})}
    data = await _admin_core_json(ctx, "POST", "/admin-core-service/v1/folder-library/library",
                                  params={"instituteId": ctx.principal.institute_id}, body=body, timeout=30.0)
    if _is_error(data) or not isinstance(data, dict) or not data.get("id"):
        return _err("write_failed", message="admin-core did not create the library; nothing else was changed.",
                    **({"status": data.get("status")} if isinstance(data, dict) and data.get("status") else {}))
    library_id = str(data["id"])
    # Bookkeeping only (which libraries this tool made); it grants no extra edits.
    record_created(ctx, _KIND_LIBRARY, library_id)
    out: Dict[str, Any] = {
        "dry_run": False,
        "library": {"id": library_id, "name": data.get("name") or name},
        "next": ("Add folders with upsert_folder_nodes(library_id) — they start HIDDEN — then bind the library "
                 "to a section with website_edit(bind_data, data_kind='folderLibrary')."),
        "dashboard_url": _folders_url(ctx),
    }
    return out


# ──────────────────────────────────────────────────────────────────────────
# upsert_folder_nodes
# ──────────────────────────────────────────────────────────────────────────
#: Input field → admin-core NodeRequest field (snake_case on the wire).
_NODE_FIELDS = {
    "title": "title", "subtitle": "subtitle", "tagline": "tagline", "description": "description",
    "cta": "cta_label", "link_url": "link_url", "course_tag": "course_tag", "image_url": "image_url",
    "accent_color": "accent_color", "coming_soon": "coming_soon", "audience_id": "audience_id",
}
#: Fields a MATCHED folder never gets from this tool: changing them renames,
#: moves or shows / hides a folder the admin already has.
_KEPT_ON_MATCH = ("title",)
_TEXT_LIMITS = {"title": _MAX_NAME, "subtitle": _MAX_SUBTITLE, "tagline": _MAX_TAGLINE,
                "description": _MAX_DESCRIPTION, "cta": _MAX_CTA, "link_url": _MAX_URL, "image_url": _MAX_URL}


def _flatten_tree(roots: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    def walk(nodes: Any, parent_id: Optional[str], depth: int) -> None:
        for n in nodes if isinstance(nodes, list) else []:
            if not isinstance(n, dict) or not n.get("id") or depth > 12:
                continue
            node = dict(n)
            node["parent_id"] = n.get("parent_id") or parent_id
            node.pop("children", None)
            out.append(node)
            walk(n.get("children"), str(n["id"]), depth + 1)
    walk(roots, None, 0)
    return out


async def library_live_sites(ctx: ToolContext, library_id: str) -> Optional[List[str]]:
    """Names of the live (ACTIVE) sites whose published JSON uses the library; None when unreadable."""
    rows = await list_catalogues(ctx)
    if _is_error(rows) or not isinstance(rows, list):
        return None
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("status") or "").strip().upper() not in _LIVE_SITE_STATUSES:
            continue
        raw = row.get("catalogue_json")
        raw = raw if isinstance(raw, str) else json.dumps(raw or {})
        if library_id in raw:
            out.append(str(row.get("tag_name") or ""))
    return out


def link_url_ok(url: str) -> bool:
    """admin-core CatalogueFolderService.linkUrlOrNull, so a bad link fails here, before any write."""
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in url):
        return False
    if url.startswith("/"):
        return not (url.startswith("//") or url.startswith("/\\"))
    lower = url.lower()
    rest = url[8:] if lower.startswith("https://") else url[7:] if lower.startswith("http://") else None
    if rest is None:
        return False
    host = re.split(r"[/?#]", rest, maxsplit=1)[0]
    return bool(host) and "\\" not in host and not any(c.isspace() for c in host)


def _clean_node(raw: Any, index: int, errors: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Validate one input node against admin-core's own rules; None (and errors) when it cannot be used."""
    def bad(field: str, message: str) -> None:
        errors.append({"index": index, "key": raw.get("key") if isinstance(raw, dict) else None,
                       "field": field, "message": message})

    if not isinstance(raw, dict):
        bad("node", "Each node is an object with at least a key.")
        return None
    unknown = sorted(k for k in raw if k not in _NODE_FIELDS and k not in ("key", "parent_key"))
    if unknown:
        bad(",".join(unknown), "Unknown field(s). " + FIELD_TEXT)
    key_raw = _str(raw.get("key"))
    key = slugify(key_raw, _MAX_SLUG)
    if not key:
        bad("key", "key is required: the folder's URL key, letters / digits / hyphens.")
        return None
    node: Dict[str, Any] = {"key": key}
    if key_raw and key_raw != key:
        node["key_normalised_from"] = key_raw
    parent = raw.get("parent_key")
    if parent not in (None, ""):
        parent_key = slugify(_str(parent), _MAX_SLUG)
        if not parent_key:
            bad("parent_key", "parent_key must be another folder's key.")
        elif parent_key == key:
            bad("parent_key", "A folder cannot be its own parent.")
        else:
            node["parent_key"] = parent_key
    for field in _NODE_FIELDS:
        value = raw.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            continue            # never sent: an empty string would CLEAR the stored value
        if field == "coming_soon":
            if not isinstance(value, bool):
                bad(field, "coming_soon is true or false.")
                continue
            node[field] = value
            continue
        if not isinstance(value, str):
            bad(field, f"{field} is text.")
            continue
        value = value.strip()
        if field in _TEXT_LIMITS and len(value) > _TEXT_LIMITS[field]:
            bad(field, f"{field} is at most {_TEXT_LIMITS[field]} characters.")
            continue
        if field == "course_tag":
            tag = slugify(value)
            if not tag:
                bad(field, "course_tag must contain letters or digits (it is stored lower-case, [a-z0-9-]).")
                continue
            value = tag
        elif field == "accent_color":
            if not _HEX_COLOR.match(value):
                bad(field, "accent_color is #rgb, #rrggbb or #rrggbbaa.")
                continue
            value = value.lower()           # admin-core stores it lower-case
        elif field == "link_url":
            if not link_url_ok(value):
                bad(field, "link_url is a site route starting with '/' or an http(s):// address with a host "
                           "(no spaces, backslashes or control characters).")
                continue
        elif field == "image_url":
            from .assistant_tools_website_edit import _is_institute_asset
            if not _is_institute_asset(value):
                bad(field, "image_url must be one of this institute's assets: pick one from website(action="
                           "'list_media') or import it with website_edit(import_image) first.")
                continue
        elif field == "audience_id" and not _ID_RE.match(value):
            bad(field, "audience_id is a lead campaign id from website(action='data_inventory').")
            continue
        node[field] = value
    return node


def _depth(node_id: str, by_id: Dict[str, Dict[str, Any]]) -> int:
    """Level of an existing node, the top level being 1 (admin-core depthOf); bounded against a corrupt cycle."""
    depth, cur = 0, by_id.get(node_id)
    while cur is not None and depth <= _MAX_DEPTH + 5:
        depth += 1
        cur = by_id.get(str(cur.get("parent_id") or ""))
    return depth


def _check_room(existing: List[Dict[str, Any]], by_id: Dict[str, Dict[str, Any]], ordered: List[Dict[str, Any]],
                folders_by_key: Dict[str, Dict[str, Any]], errors: List[Dict[str, Any]]) -> None:
    """admin-core's library size and nesting limits, checked before the first write (all or nothing)."""
    if len(existing) + len(ordered) > _MAX_LIBRARY_NODES:
        errors.append({"field": "nodes", "message": (
            f"A folder library holds at most {_MAX_LIBRARY_NODES} items; this one has {len(existing)}, so at most "
            f"{max(0, _MAX_LIBRARY_NODES - len(existing))} more can be added.")})
    depths: Dict[str, int] = {}
    for node in ordered:            # parents first
        parent_key = node.get("parent_key")
        if not parent_key:
            depth = 1
        elif parent_key in depths:
            depth = depths[parent_key] + 1
        else:
            parent = folders_by_key.get(parent_key)
            depth = (_depth(str(parent["id"]), by_id) if parent else 0) + 1
        depths[node["key"]] = depth
        if depth > _MAX_DEPTH:
            errors.append({"index": node.get("index"), "key": node["key"], "field": "parent_key",
                           "message": f"Folders can be nested at most {_MAX_DEPTH} levels deep."})


def _order_creates(creates: List[Dict[str, Any]], errors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Parents before children among the NEW folders; a cycle is an error."""
    by_key = {n["key"]: n for n in creates}
    ordered: List[Dict[str, Any]] = []
    state: Dict[str, int] = {}

    def visit(node: Dict[str, Any], trail: List[str]) -> bool:
        key = node["key"]
        if state.get(key) == 2:
            return True
        if state.get(key) == 1:
            errors.append({"key": key, "field": "parent_key",
                           "message": "parent_key forms a cycle: " + " → ".join(trail + [key])})
            return False
        state[key] = 1
        parent = by_key.get(node.get("parent_key") or "")
        if parent is not None and not visit(parent, trail + [key]):
            return False
        state[key] = 2
        ordered.append(node)
        return True

    for n in creates:
        if not visit(n, []):
            return []
    return ordered


def _node_body(node: Dict[str, Any], fields: Iterable[str]) -> Dict[str, Any]:
    return {_NODE_FIELDS[f]: node[f] for f in fields if f in node}


def _find_by_slug(tree: Any, slug: str) -> Optional[str]:
    roots = tree.get("roots") if isinstance(tree, dict) else None
    for n in _flatten_tree(roots):
        if str(n.get("slug") or "") == slug:
            return str(n["id"])
    return None


async def _action_upsert_folder_nodes(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    from .catalogue_course_rules import folder_slug
    inst = ctx.principal.institute_id
    library_id = _str(args.get("library_id"))
    raw_nodes = args.get("nodes")
    if not library_id:
        return _err("missing_argument", needs=["library_id"],
                    message="Pass library_id (website(action='data_inventory') lists folder_libraries), or create "
                            "one with create_folder_library.")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        return _err("missing_argument", needs=["nodes"], message="Pass nodes: a list of folders. " + FIELD_TEXT)
    if len(raw_nodes) > MAX_NODES:
        return _err("too_many_nodes", limit=MAX_NODES, message=f"At most {MAX_NODES} folders per call; split the rest.")

    libraries = await list_folder_libraries(ctx)
    if libraries is None:
        return _fetch_failed("this institute's folder libraries", None)
    library = next((lib for lib in libraries if lib["id"] == library_id), None)
    if library is None:
        return _err("unknown_library", message="No folder library with that id in this institute.",
                    available=[{"id": lib["id"], "name": lib["name"]} for lib in libraries][:30])
    tree = await _admin_core_json(ctx, "GET", "/admin-core-service/v1/folder-library/tree",
                                  params={"instituteId": inst, "libraryId": library_id}, timeout=30.0)
    if _is_error(tree) or not isinstance(tree, dict):
        return _fetch_failed("the library's folders", tree)
    owner = (tree.get("library") or {}).get("institute_id") if isinstance(tree.get("library"), dict) else None
    if owner and str(owner) != inst:
        return _err("unknown_library", message="No folder library with that id in this institute.")
    existing = _flatten_tree(tree.get("roots"))

    errors: List[Dict[str, Any]] = []
    nodes: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for i, raw in enumerate(raw_nodes):
        node = _clean_node(raw, i, errors)
        if node is None:
            continue
        if node["key"] in seen:
            errors.append({"index": i, "key": node["key"], "field": "key", "message": "The same key appears twice in this call."})
            continue
        seen.add(node["key"])
        node["index"] = i
        nodes.append(node)

    # Campaigns: each distinct id once, ACTIVE and this institute's (admin-core checks it again).
    for audience_id in sorted({n["audience_id"] for n in nodes if n.get("audience_id")}):
        campaign = await get_campaign(ctx, audience_id)
        if campaign is None or str(campaign.get("status") or "") != "ACTIVE":
            for n in nodes:
                if n.get("audience_id") == audience_id:
                    errors.append({"index": n["index"], "key": n["key"], "field": "audience_id", "message": (
                        "Not an ACTIVE lead campaign of this institute: pick one from website(action='data_inventory') "
                        "or create it with audience_forms_edit(create).")})

    folders_by_key: Dict[str, Dict[str, Any]] = {}
    slugs_taken: Dict[str, Dict[str, Any]] = {}
    for n in existing:
        if n.get("slug"):
            slugs_taken[str(n["slug"])] = n
        if str(n.get("node_type") or "FOLDER").upper() == "FOLDER":
            folders_by_key.setdefault(folder_slug(n), n)
    by_id = {str(n["id"]): n for n in existing}

    creates: List[Dict[str, Any]] = []
    updates: List[Dict[str, Any]] = []
    unchanged: List[Dict[str, Any]] = []
    new_keys = {n["key"] for n in nodes if n["key"] not in folders_by_key}
    for node in nodes:
        key = node["key"]
        parent_key = node.get("parent_key")
        if parent_key and parent_key not in folders_by_key and parent_key not in new_keys:
            errors.append({"index": node["index"], "key": key, "field": "parent_key",
                           "message": f"No folder with key '{parent_key}' in this library or in this call."})
            continue
        match = folders_by_key.get(key)
        if match is None:
            taken = slugs_taken.get(key)
            if taken is not None:
                errors.append({"index": node["index"], "key": key, "field": "key", "message": (
                    "Another item of this library (a product-page leaf) already uses this key; choose another.")})
                continue
            if not node.get("title"):
                errors.append({"index": node["index"], "key": key, "field": "title", "message": "A new folder needs a title."})
                continue
            creates.append(node)
            continue
        changes: Dict[str, Dict[str, Any]] = {}
        kept: List[str] = []
        for field, wire in _NODE_FIELDS.items():
            if field not in node:
                continue
            before = match.get(wire)
            if field == "coming_soon":
                before = bool(before)
            if before == node[field] or (isinstance(before, str) and field in ("course_tag",) and before.lower() == node[field]):
                continue
            if field in _KEPT_ON_MATCH:
                kept.append(field)
                continue
            if field == "subtitle" and not _str(match.get("slug")):
                # Its link key (?stream=…) is made from the subtitle: a new one would rename it.
                kept.append(field)
                continue
            changes[field] = {"before": before, "after": node[field]}
        current_parent = by_id.get(str(match.get("parent_id") or ""))
        current_parent_key = folder_slug(current_parent) if current_parent else None
        if parent_key is not None and parent_key != current_parent_key:
            kept.append("parent_key")
        entry = {"key": key, "id": str(match["id"]), "status": match.get("status")}
        if kept:
            entry["kept"] = kept
        if changes:
            updates.append({**entry, "changes": changes})
        else:
            unchanged.append(entry)

    ordered = _order_creates(creates, errors) if creates else []
    _check_room(existing, by_id, ordered, folders_by_key, errors)
    if errors:
        return _err("invalid_nodes", errors=errors[:MAX_LISTED], message=(
            "Nothing was written. Fix these folders and call again (all or nothing)."))

    # A HIDDEN folder is not on any public site, so filling it in changes nothing
    # learners see. A shown folder is edited only while no live site uses the
    # library — whoever created the library (decision 2: additive only).
    refused: List[Dict[str, Any]] = []
    visible = [u for u in updates if str(u.get("status") or "").upper() != "HIDDEN"]
    if visible:
        live_sites = await library_live_sites(ctx, library_id)
        if live_sites is None:
            reason = ("Could not check whether a live site uses this library, so its shown folders are left as "
                      "they are.")
        elif live_sites:
            reason = ("The live site(s) " + ", ".join(live_sites) + " use this library: shown folders there are "
                      "changed by the admin in Manage Pages → Folders.")
        else:
            reason = None
        if reason:
            refused = [{**u, "reason": reason} for u in visible]
            updates = [u for u in updates if u not in visible]

    plan: Dict[str, Any] = {
        "library": {"id": library_id, "name": library.get("name")},
        "create": [{k: v for k, v in n.items() if k != "index"} | {"status": "HIDDEN"} for n in ordered],
        "update": updates,
        "unchanged": unchanged,
    }
    if refused:
        plan["refused"] = refused
    if any(u.get("kept") for u in updates + unchanged + refused):
        plan["kept_note"] = ("Titles, parents and visibility of existing folders are never changed here (no rename, "
                             "move, show or hide), nor the subtitle of a folder whose link key is made from it: the "
                             "admin does that in Manage Pages → Folders.")
    if _dry_run(args):
        return _dry_run_result(ctx, "upsert_folder_nodes", args, plan, (
            "Nothing was written. Show the admin this plan; call again with the same nodes, dry_run=false and this "
            "plan_token to apply it. New folders are created HIDDEN."))
    refusal = check_plan_token(ctx, "upsert_folder_nodes", args, plan)
    if refusal:
        return refusal

    created: List[Dict[str, Any]] = []
    updated: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    key_ids = {k: str(n["id"]) for k, n in folders_by_key.items()}
    for node in ordered:
        parent_key = node.get("parent_key")
        parent_id = key_ids.get(parent_key) if parent_key else None
        if parent_key and not parent_id:
            failed.append({"key": node["key"], "reason": f"its parent '{parent_key}' was not created"})
            continue
        body = {"node_type": "FOLDER", "status": "HIDDEN", "slug": node["key"],
                **({"parent_id": parent_id} if parent_id else {}), **_node_body(node, _NODE_FIELDS)}
        data = await _admin_core_json(ctx, "POST", "/admin-core-service/v1/folder-library/node",
                                      params={"instituteId": inst, "libraryId": library_id}, body=body, timeout=30.0)
        node_id = _find_by_slug(data, node["key"]) if not _is_error(data) else None
        if not node_id:
            failed.append({"key": node["key"], "reason": "admin-core refused or did not return it",
                           **({"status": data.get("status")} if isinstance(data, dict) and data.get("status") else {})})
            continue
        key_ids[node["key"]] = node_id
        created.append({"key": node["key"], "id": node_id, "status": "HIDDEN"})
    for upd in updates:
        node = next(n for n in nodes if n["key"] == upd["key"])
        body = _node_body(node, upd["changes"].keys())
        data = await _admin_core_json(ctx, "PUT", "/admin-core-service/v1/folder-library/node",
                                      params={"instituteId": inst, "nodeId": upd["id"]}, body=body, timeout=30.0)
        if _is_error(data):
            failed.append({"key": upd["key"], "reason": "admin-core refused the change",
                           **({"status": data.get("status")} if data.get("status") else {})})
            continue
        updated.append({"key": upd["key"], "id": upd["id"], "changed": sorted(upd["changes"])})
    out: Dict[str, Any] = {
        "dry_run": False,
        "library": plan["library"],
        "created": created,
        "updated": updated,
        "unchanged": [u["key"] for u in unchanged],
        "dashboard_url": _folders_url(ctx),
        "next": ("New folders are HIDDEN: the admin shows them in Manage Pages → Folders when the site is ready. "
                 "Courses join a folder through its course_tag (add_course_tags)."),
    }
    if refused:
        out["refused"] = refused
    if failed:
        out["failed"] = failed
    return out


# ──────────────────────────────────────────────────────────────────────────
# add_course_tags
# ──────────────────────────────────────────────────────────────────────────
_COURSE_ROWS_SQL = """
SELECT DISTINCT p.id, p.package_name, p.status, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
       p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
       p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
       p.course_depth, p.course_html_description
FROM package p
JOIN package_institute pi ON pi.package_id = p.id
WHERE pi.institute_id = :inst AND p.id = ANY(:ids) AND p.status IN ('ACTIVE', 'DRAFT', 'IN_REVIEW')
"""


def load_course_rows(ctx: ToolContext, course_ids: List[str]) -> Optional[Dict[str, Dict[str, Any]]]:
    """id → the stored course row (every field update-course writes), this institute's only. None if unreadable."""
    if not course_ids:
        return {}
    rows = _sql_rows(ctx, _COURSE_ROWS_SQL, {"inst": ctx.principal.institute_id, "ids": sorted(set(course_ids))})
    if rows is None:
        return None
    return {str(r["id"]): r for r in rows if r.get("id")}


def _stored_tags(row: Dict[str, Any]) -> List[str]:
    raw = row.get("comma_separated_tags")
    return [t.strip() for t in raw.split(",") if t.strip()] if isinstance(raw, str) else []


def course_update_body(row: Dict[str, Any], tags: List[str]) -> Dict[str, Any]:
    """PUT update-course writes EVERY one of these fields: all are sent back exactly as stored."""
    return {
        "package_name": row.get("package_name"),
        "thumbnail_file_id": row.get("thumbnail_file_id"),
        "is_course_published_to_catalaouge": row.get("is_course_published_to_catalaouge"),
        "course_preview_image_media_id": row.get("course_preview_image_media_id"),
        "course_banner_media_id": row.get("course_banner_media_id"),
        "course_media_id": row.get("course_media_id"),
        "why_learn_html": row.get("why_learn"),
        "who_should_learn_html": row.get("who_should_learn"),
        "about_the_course_html": row.get("about_the_course"),
        "tags": tags,
        "course_depth": row.get("course_depth"),
        "course_html_description_html": row.get("course_html_description"),
    }


def _tag_plan(row: Dict[str, Any], add: List[str]) -> Dict[str, Any]:
    before = _stored_tags(row)
    changed_by_save = [t for t in before if t != t.lower().strip()]
    lowered = {t.lower() for t in before}
    to_add = [t for t in dict.fromkeys(add) if t not in lowered]
    return {"before": before, "add": to_add, "after": before + to_add, "would_lowercase": changed_by_save}


async def _action_add_course_tags(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    assignments = args.get("assignments")
    if not isinstance(assignments, list) or not assignments:
        return _err("missing_argument", needs=["assignments"],
                    message="Pass assignments: [{course_id, add: ['format-ebook', …]}].")
    if len(assignments) > MAX_COURSES:
        return _err("too_many_courses", limit=MAX_COURSES, message=f"At most {MAX_COURSES} courses per call.")
    errors: List[Dict[str, Any]] = _unknown_item_keys(assignments, _ASSIGNMENT_KEYS, "assignments")
    wanted: Dict[str, List[str]] = {}
    normalised: Dict[str, Dict[str, str]] = {}
    for i, a in enumerate(assignments):
        course_id = _str(a.get("course_id")) if isinstance(a, dict) else ""
        add = a.get("add") if isinstance(a, dict) else None
        if not course_id or not _ID_RE.match(course_id):
            errors.append({"index": i, "field": "course_id", "message": "course_id is a course id from website(action='data_inventory')."})
            continue
        if course_id in wanted:
            errors.append({"index": i, "course_id": course_id, "field": "course_id", "message": "The same course appears twice; merge its tags."})
            continue
        if not isinstance(add, list) or not add or len(add) > MAX_TAGS_PER_COURSE:
            errors.append({"index": i, "course_id": course_id, "field": "add",
                           "message": f"add is a list of 1–{MAX_TAGS_PER_COURSE} tags."})
            continue
        tags: List[str] = []
        for raw in add:
            tag = slugify(raw) if isinstance(raw, str) else ""
            if not tag:
                errors.append({"index": i, "course_id": course_id, "field": "add",
                               "message": f"'{raw}' has no letters or digits; tags are lower-case [a-z0-9-]."})
                continue
            if tag != raw:
                normalised.setdefault(course_id, {})[str(raw)] = tag
            tags.append(tag)
        wanted[course_id] = tags
    rows = load_course_rows(ctx, list(wanted))
    if rows is None:
        return _fetch_failed("the courses", None)
    for course_id in wanted:
        if course_id not in rows:
            errors.append({"course_id": course_id, "field": "course_id", "message": (
                "Not a course of this institute (or it is deleted): use ids from website(action='data_inventory').")})
    if errors:
        return _err("invalid_assignments", errors=errors[:MAX_LISTED],
                    message="Nothing was written. Fix these and call again (all or nothing).")

    changes: List[Dict[str, Any]] = []
    unchanged: List[Dict[str, Any]] = []
    refused: List[Dict[str, Any]] = []
    for course_id, tags in wanted.items():
        row = rows[course_id]
        plan = _tag_plan(row, tags)
        entry = {"course_id": course_id, "name": row.get("package_name"), "before": plan["before"]}
        if course_id in normalised:
            entry["normalised"] = normalised[course_id]
        if not plan["add"]:
            unchanged.append({**entry, "note": "already has every tag"})
        elif plan["would_lowercase"]:
            refused.append({**entry, "reason": (
                "Saving tags through the course editor lower-cases every tag, which would change these existing "
                "ones: " + ", ".join(plan["would_lowercase"]) + ". The admin adds the tags in the course editor.")})
        else:
            live = (_str(row.get("status")).upper() == "ACTIVE" and row.get("is_course_published_to_catalaouge") is True)
            changes.append({**entry, "add": plan["add"], "after": plan["after"], **({"live": True} if live else {})})
    result: Dict[str, Any] = {"changes": changes, "unchanged": unchanged}
    if refused:
        result["refused"] = refused
    if any(c.get("live") for c in changes):
        result["warnings"] = ["Courses marked live are ACTIVE and in the catalogue: their new tags change the live "
                              "site's filters and folders as soon as they are applied."]
    if _dry_run(args):
        return _dry_run_result(ctx, "add_course_tags", args, result, (
            "Nothing was written. Show the admin these before/after tags; call again with the same assignments, "
            "dry_run=false and this plan_token to append them. Existing tags are never removed."))
    refusal = check_plan_token(ctx, "add_course_tags", args, result)
    if refusal:
        return refusal

    applied: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    for change in changes:
        course_id = change["course_id"]
        # Read again right before the write: the body carries every field of the course.
        fresh = (load_course_rows(ctx, [course_id]) or {}).get(course_id)
        if fresh is None:
            failed.append({"course_id": course_id, "reason": "could not re-read the course; not changed"})
            continue
        plan = _tag_plan(fresh, wanted[course_id])
        if plan["would_lowercase"]:
            failed.append({"course_id": course_id, "reason": "its tags changed meanwhile; not changed"})
            continue
        if not plan["add"]:
            applied.append({"course_id": course_id, "name": fresh.get("package_name"), "before": plan["before"],
                            "after": plan["before"], "note": "already had every tag"})
            continue
        data = await _admin_core_json(ctx, "PUT", f"/admin-core-service/course/v1/update-course/{course_id}",
                                      body=course_update_body(fresh, plan["after"]), timeout=30.0)
        if _is_error(data):
            failed.append({"course_id": course_id, "reason": "admin-core refused the save; not changed",
                           **({"status": data.get("status")} if data.get("status") else {})})
            continue
        after_row = (load_course_rows(ctx, [course_id]) or {}).get(course_id) or {}
        after = _stored_tags(after_row) if after_row else plan["after"]
        entry = {"course_id": course_id, "name": fresh.get("package_name"), "before": plan["before"], "after": after}
        if after_row and not set(plan["add"]) <= {t.lower() for t in after}:
            entry["warning"] = "The save answered OK but the new tags are not all there; check the course."
        applied.append(entry)
    out: Dict[str, Any] = {"dry_run": False, "applied": applied, "unchanged": unchanged}
    if refused:
        out["refused"] = refused
    if failed:
        out["failed"] = failed
    out["next"] = "Re-run website(action='data_audit') to see the stream / format / language filters fill."
    return out


# ──────────────────────────────────────────────────────────────────────────
# create_product_page / sync_store: which batch, invite, payment option and
# plan a course is sold through — the rule admin-core's catalogue sync uses
# (ProductPageCatalogueRepository.findCatalogueSessions + CatalogueSyncPlanner).
# ──────────────────────────────────────────────────────────────────────────
_SELLABLE_SQL = """
SELECT ps.id AS package_session_id, p.id AS course_id, p.package_name AS course_name,
       l.level_name, s.session_name,
       b.id AS bridge_id, b.updated_at AS bridge_updated_at, ei.id AS invite_id, ei.name AS invite_name, ei.tag AS invite_tag,
       ei.status AS invite_status, ei.start_date AS invite_start, ei.end_date AS invite_end,
       ei.vendor AS invite_vendor, ei.currency AS invite_currency,
       po.id AS payment_option_id, po.type AS payment_type,
       pp.id AS plan_id, pp.actual_price AS price, pp.currency AS plan_currency
FROM package p
JOIN package_institute pi ON pi.package_id = p.id AND pi.institute_id = :inst
JOIN package_session ps ON ps.package_id = p.id AND ps.status IN ('ACTIVE', 'HIDDEN')
LEFT JOIN level l ON l.id = ps.level_id
LEFT JOIN session s ON s.id = ps.session_id
LEFT JOIN package_session_learner_invitation_to_payment_option b
       ON b.package_session_id = ps.id AND b.status = 'ACTIVE'
LEFT JOIN enroll_invite ei ON ei.id = b.enroll_invite_id AND ei.institute_id = :inst AND ei.status <> 'DELETED'
LEFT JOIN payment_option po ON po.id = b.payment_option_id AND po.status = 'ACTIVE'
LEFT JOIN payment_plan pp ON pp.payment_option_id = po.id AND pp.status = 'ACTIVE'
WHERE {scope}
ORDER BY LOWER(p.package_name), LOWER(l.level_name), ps.id
LIMIT 5000
"""
_SCOPE_COURSES = "p.id = ANY(:ids) AND p.status IN ('ACTIVE', 'DRAFT', 'IN_REVIEW')"
#: The catalogue the store sync reads (ProductPageCatalogueRepository.findCatalogueSessions).
_SCOPE_CATALOGUE = "p.is_course_published_to_catalaouge = true AND p.status = 'ACTIVE' AND l.status = 'ACTIVE'"


def load_sellable_rows(ctx: ToolContext, course_ids: Optional[List[str]] = None) -> Optional[List[Dict[str, Any]]]:
    """One row per (batch, bridge, plan) of this institute's courses (or its catalogue). None if unreadable."""
    if course_ids is not None:
        return _sql_rows(ctx, _SELLABLE_SQL.format(scope=_SCOPE_COURSES),
                         {"inst": ctx.principal.institute_id, "ids": sorted(set(course_ids))})
    return _sql_rows(ctx, _SELLABLE_SQL.format(scope=_SCOPE_CATALOGUE), {"inst": ctx.principal.institute_id})


def _invite_open(row: Dict[str, Any], today: date) -> Optional[str]:
    """Why the invite takes no enrollments now (EnrollInviteAvailabilityUtil), or None when it is open."""
    status = _str(row.get("invite_status")).upper()
    if status and status != "ACTIVE":
        return "invite_inactive"
    start, end = _as_date(row.get("invite_start")), _as_date(row.get("invite_end"))
    if start and start > today:
        return "invite_not_started"
    if end and end < today:
        return "invite_expired"
    return None


def pick_mapping(rows: List[Dict[str, Any]], invite_id: Optional[str] = None,
                 today: Optional[date] = None) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """``(row, None)`` — the bridge row + plan a product page sells this batch through — or ``(None, reason)``."""
    today = today or date.today()
    linked = [r for r in rows if r.get("bridge_id") and r.get("invite_id")]
    if not linked:
        return None, "no_active_invite"
    if invite_id:
        linked = [r for r in linked if str(r.get("invite_id")) == invite_id]
        if not linked:
            return None, "invite_not_linked"

    # ProductPageCatalogueRepository.findCatalogueSessions: tier, then the most
    # recently updated link (psli.updated_at DESC NULLS LAST), then the cheapest
    # plan, then ids — so a page made here sells at the price the store sync and
    # the Courses page use.
    def rank(r: Dict[str, Any]) -> Tuple[int, int, float, float, str, str]:
        default = _str(r.get("invite_tag")).upper() == "DEFAULT"
        tier = 0 if default and _invite_open(r, today) is None else (1 if default else 2)
        if invite_id:
            tier = 0 if _invite_open(r, today) is None else 1
        updated = _as_timestamp(r.get("bridge_updated_at"))
        price = r.get("price")
        return (tier, 0 if updated is not None else 1, -(updated or 0.0),
                float(price) if isinstance(price, (int, float)) else float("inf"),
                str(r.get("bridge_id")), str(r.get("plan_id") or ""))

    best = sorted(linked, key=rank)[0]
    if not invite_id and _str(best.get("invite_tag")).upper() != "DEFAULT":
        return None, "non_default_invite"
    closed = _invite_open(best, today)
    if closed:
        return None, closed
    if not best.get("payment_option_id"):
        return None, "payment_option_inactive"
    if _str(best.get("payment_type")).upper() == "CPO":
        return None, "cpo_not_supported"
    if not best.get("plan_id"):
        return None, "no_active_plan"
    return best, None


def _by_session(rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(str(r.get("package_session_id")), []).append(r)
    return out


def _batch_label(row: Dict[str, Any]) -> Optional[str]:
    parts = [str(row.get(k)) for k in ("level_name", "session_name")
             if row.get(k) and str(row.get(k)).strip().lower() != "default"]
    return " · ".join(parts) or None


def _step(row: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in {
        "course_id": row.get("course_id"), "course_name": row.get("course_name"), "batch": _batch_label(row),
        "package_session_id": row.get("package_session_id"), "invite_id": row.get("invite_id"),
        "invite_name": row.get("invite_name"), "payment_type": row.get("payment_type"),
        "price": row.get("price"), "currency": row.get("plan_currency"), "vendor": row.get("invite_vendor"),
    }.items() if v not in (None, "")}


def _money_warnings(steps: List[Dict[str, Any]]) -> List[str]:
    priced = [s for s in steps if isinstance(s.get("price"), (int, float)) and s["price"] > 0]
    out = []
    if len({s.get("vendor") for s in priced}) > 1:
        out.append("The priced courses use different payment gateways; one checkout charges one gateway.")
    if len({s.get("currency") for s in priced}) > 1:
        out.append("The priced courses are in different currencies; one checkout charges one currency.")
    return out


async def _load_pages_raw(ctx: ToolContext) -> Optional[List[Dict[str, Any]]]:
    data = await _admin_core_json(ctx, "GET", "/admin-core-service/v1/product-page/get-all",
                                  params={"instituteId": ctx.principal.institute_id})
    if not isinstance(data, list):
        return None
    inst = ctx.principal.institute_id
    return [p for p in data if isinstance(p, dict) and str(p.get("institute_id") or inst) == inst]


async def _action_create_product_page(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    name = _str(args.get("name"))
    role = _str(args.get("role")).lower() or "path"
    items = args.get("items")
    if not name:
        return _err("missing_argument", needs=["name"], message="Pass the product page's name.")
    if len(name) > _MAX_NAME:
        return _err("too_long", message=f"name is at most {_MAX_NAME} characters.")
    if role not in ("path", "store"):
        return _err("invalid_role", message="role is 'path' (one batch per step) or 'store' (every sellable batch).")
    if not isinstance(items, list) or not items:
        return _err("missing_argument", needs=["items"], message="Pass items: [{course_id, invite_id?, package_session_id?}].")
    if len(items) > MAX_PRODUCT_PAGE_ITEMS:
        return _err("too_many_items", limit=MAX_PRODUCT_PAGE_ITEMS, message=f"At most {MAX_PRODUCT_PAGE_ITEMS} courses per page.")

    errors: List[Dict[str, Any]] = _unknown_item_keys(items, _ITEM_KEYS, "items")
    clean: List[Dict[str, Any]] = []
    for i, it in enumerate(items):
        course_id = _str(it.get("course_id")) if isinstance(it, dict) else ""
        invite_id = _str(it.get("invite_id")) if isinstance(it, dict) else ""
        session_id = _str(it.get("package_session_id")) if isinstance(it, dict) else ""
        if not course_id or not _ID_RE.match(course_id):
            errors.append({"index": i, "field": "course_id", "message": "course_id is a course id from website(action='data_inventory')."})
            continue
        if (invite_id and not _ID_RE.match(invite_id)) or (session_id and not _ID_RE.match(session_id)):
            errors.append({"index": i, "course_id": course_id, "message": "invite_id / package_session_id are ids from website(action='data_inventory')."})
            continue
        clean.append({"index": i, "course_id": course_id, "invite_id": invite_id or None, "package_session_id": session_id or None})
    if errors:
        return _err("invalid_items", errors=errors, message="Nothing was written. Fix these and call again.")

    pages = await _load_pages_raw(ctx)
    if pages is None:
        return _fetch_failed("this institute's product pages", None)
    same = next((p for p in pages if str(p.get("name") or "").strip().lower() == name.lower()), None)
    if same:
        return _err("product_page_exists", product_page={"id": same.get("id"), "code": same.get("code"),
                                                         "status": same.get("status")},
                    message=f"A product page named '{same.get('name')}' already exists; use it or choose another name.")

    rows = load_sellable_rows(ctx, [c["course_id"] for c in clean])
    course_rows = load_course_rows(ctx, [c["course_id"] for c in clean])
    if rows is None or course_rows is None:
        return _fetch_failed("the courses' batches and invites", None)
    by_course: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        by_course.setdefault(str(r.get("course_id")), []).append(r)

    steps: List[Dict[str, Any]] = []
    not_sold: List[Dict[str, Any]] = []
    seen_sessions: Set[str] = set()
    for it in clean:
        course_id = it["course_id"]
        if course_id not in course_rows:
            errors.append({"index": it["index"], "course_id": course_id, "message": (
                "Not a course of this institute (or it is deleted): use ids from website(action='data_inventory').")})
            continue
        sessions = _by_session(by_course.get(course_id, []))
        if it["package_session_id"]:
            if it["package_session_id"] not in sessions:
                errors.append({"index": it["index"], "course_id": course_id, "field": "package_session_id",
                               "message": "That batch is not an active batch of this course.",
                               "batches": [_step(r[0]) for r in sessions.values()][:20]})
                continue
            sessions = {it["package_session_id"]: sessions[it["package_session_id"]]}
        if not sessions:
            errors.append({"index": it["index"], "course_id": course_id,
                           "message": "This course has no active batch to sell."})
            continue
        picks, skipped = [], []
        for session_id, srows in sessions.items():
            row, reason = pick_mapping(srows, it["invite_id"])
            if row:
                picks.append(row)
            else:
                skipped.append({**_step(srows[0]), "reason": reason, "why": REASON_TEXT.get(reason or "", reason)})
        if role == "path" and len(picks) > 1:
            errors.append({"index": it["index"], "course_id": course_id, "field": "package_session_id", "message": (
                "This course is sold in several batches; a learning-path step is one of them — pass "
                "package_session_id."), "batches": [_step(r) for r in picks][:20]})
            continue
        if not picks:
            errors.append({"index": it["index"], "course_id": course_id,
                           "message": "No batch of this course can be sold from a product page.", "batches": skipped[:20]})
            continue
        not_sold.extend(skipped)
        for row in picks:
            session_id = str(row["package_session_id"])
            if session_id in seen_sessions:
                continue
            seen_sessions.add(session_id)
            steps.append(row)
    if errors:
        return _err("invalid_items", errors=errors[:MAX_LISTED],
                    message="Nothing was written. Fix these and call again (all or nothing).")

    listed = [{"order": i, **_step(r)} for i, r in enumerate(steps)]
    warnings = _money_warnings(listed)
    plan: Dict[str, Any] = {"product_page": {"name": name, "status": "DRAFT", "role": role}, "steps": listed}
    if not_sold:
        plan["batches_not_sold"], more = _cap(not_sold)
        if more:
            plan["batches_not_sold_more"] = more
    warnings.append(DRAFT_PAGE_NOTE)
    plan["warnings"] = warnings
    if _dry_run(args):
        return _dry_run_result(ctx, "create_product_page", args, plan, (
            "Nothing was written. Show the admin the steps and prices; call again with the same items, "
            "dry_run=false and this plan_token to create the DRAFT page."))
    refusal = check_plan_token(ctx, "create_product_page", args, plan)
    if refusal:
        return refusal
    body = {
        "name": name,
        "status": "DRAFT",
        "settings_json": json.dumps(DEFAULT_PRODUCT_PAGE_SETTINGS),
        "mappings": [{"ps_invite_payment_option_id": r["bridge_id"], "payment_plan_id": r["plan_id"],
                      "preselected": False, "display_order": i} for i, r in enumerate(steps)],
    }
    data = await _admin_core_json(ctx, "POST", "/admin-core-service/v1/product-page/create",
                                  params={"instituteId": ctx.principal.institute_id}, body=body, timeout=30.0)
    if _is_error(data) or not isinstance(data, dict) or not data.get("id"):
        return _err("write_failed", message="admin-core did not create the product page; nothing else was changed.",
                    **({"status": data.get("status")} if isinstance(data, dict) and data.get("status") else {}))
    out = {
        "dry_run": False,
        "product_page": {"id": data.get("id"), "code": data.get("code"), "name": data.get("name") or name,
                         "status": data.get("status") or "DRAFT", "role": role},
        "steps": listed,
        "editor_url": _product_page_url(ctx, data.get("id")),
        "warnings": warnings,
        "next": ("The page is saved as DRAFT: the admin reviews it and activates it in the dashboard (editor_url). "
                 "Bind it with website_edit(bind_data, data_kind='productPage', data_id=<code>)."),
    }
    return out


async def _action_sync_store(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    code = _str(args.get("product_page_code"))
    if not code:
        return _err("missing_argument", needs=["product_page_code"],
                    message="Pass product_page_code (website(action='data_inventory') product_pages).")
    pages = await _load_pages_raw(ctx)
    if pages is None:
        return _fetch_failed("this institute's product pages", None)
    page = next((p for p in pages if str(p.get("code") or "") == code), None)
    if page is None or not page.get("id"):
        return _err("unknown_product_page", message="No product page with that code in this institute.",
                    available=[{"code": p.get("code"), "name": p.get("name"), "status": p.get("status")}
                               for p in pages][:30])
    page_ref = {"id": page.get("id"), "code": code, "name": page.get("name"), "status": page.get("status")}
    rows = load_sellable_rows(ctx)
    if rows is None:
        return _fetch_failed("the catalogue's batches", None)
    sold = {str(m.get("package_session_id")) for m in page.get("mappings") or []
            if isinstance(m, dict) and str(m.get("status") or "ACTIVE").upper() == "ACTIVE"}
    would_add, would_skip = [], []
    for session_id, srows in _by_session(rows).items():
        if session_id in sold:
            continue
        row, reason = pick_mapping(srows)
        if row:
            would_add.append(_step(row))
        else:
            would_skip.append({**_step(srows[0]), "reason": reason, "why": REASON_TEXT.get(reason or "", reason)})
    would_add, more_add = _cap(would_add)
    would_skip, more_skipped = _cap(would_skip)
    plan: Dict[str, Any] = {"product_page": page_ref, "already_sold": len(sold),
                            "would_add": would_add, "would_skip": would_skip}
    if more_add:
        plan["would_add_more"] = more_add
    if more_skipped:
        plan["would_skip_more"] = more_skipped
    page_active = _str(page.get("status")).upper() == "ACTIVE"
    if page_active and (would_add or more_add):
        plan["warnings"] = ["This product page is ACTIVE: the courses added are on sale on it immediately."]
    if _dry_run(args):
        return _dry_run_result(ctx, "sync_store", args, plan, (
            "Nothing was written. This preview applies the catalogue rule; on apply admin-core also skips courses on "
            "another payment gateway or currency than the page. Call again with dry_run=false and this plan_token. "
            "Courses already on the page are never switched off."))
    refusal = check_plan_token(ctx, "sync_store", args, plan)
    if refusal:
        return refusal
    data = await _admin_core_json(
        ctx, "POST", f"/admin-core-service/v1/product-page/{page['id']}/sync-catalogue",
        params={"instituteId": ctx.principal.institute_id, "deactivateMissing": "false"}, timeout=60.0)
    if _is_error(data) or not isinstance(data, dict):
        return _err("write_failed", message="admin-core did not sync the product page; nothing was changed.",
                    **({"status": data.get("status")} if isinstance(data, dict) and data.get("status") else {}))
    skipped = [{k: v for k, v in {
        "package_session_id": s.get("package_session_id"), "course_name": s.get("package_name"),
        "batch": s.get("level_name"), "reason": s.get("reason"),
        "why": REASON_TEXT.get(str(s.get("reason") or ""), s.get("reason")),
    }.items() if v} for s in data.get("skipped") or [] if isinstance(s, dict)]
    skipped, more = _cap(skipped)
    out: Dict[str, Any] = {
        "dry_run": False,
        "product_page": page_ref,
        "added": data.get("added") if isinstance(data.get("added"), int) else len(data.get("added_package_session_ids") or []),
        "added_package_session_ids": (data.get("added_package_session_ids") or [])[:MAX_LISTED],
        "skipped": skipped,
        "warnings": ([w if isinstance(w, str) else str(w) for w in data.get("warnings") or []][:20]
                     + (plan.get("warnings") or [])),
        "editor_url": _product_page_url(ctx, page["id"]),
    }
    if more:
        out["skipped_more"] = more
    deactivated = data.get("deactivated")
    if deactivated:
        # deactivateMissing=false is sent; an older server that ignores it is reported, never hidden.
        out["deactivated"] = deactivated
        out["warning"] = "admin-core reports mappings switched off although this tool asked it not to; check the page."
    return out


# ──────────────────────────────────────────────────────────────────────────
# Dispatch + registration
# ──────────────────────────────────────────────────────────────────────────
_ACTIONS = {
    "create_folder_library": _action_create_folder_library,
    "upsert_folder_nodes": _action_upsert_folder_nodes,
    "add_course_tags": _action_add_course_tags,
    "create_product_page": _action_create_product_page,
    "sync_store": _action_sync_store,
}


async def execute_catalog_data_edit(args: Dict[str, Any], ctx: ToolContext) -> str:
    args = args or {}
    # plan_token is this tool's own check value (an HMAC it issued), never a credential.
    secrets = _secret_args({k: v for k, v in args.items() if k not in ("user_id", "institute_id", "plan_token")})
    if secrets:
        return json.dumps(_err("secret_not_accepted", message=(
            "Never send access tokens or other credentials to this tool; it acts as the connected admin."),
            fields=sorted(secrets)))
    action = _str(args.get("action"))
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(CATALOG_DATA_EDIT_ACTIONS), message=(
            "Not an action of this tool. Activating a product page and changing an invite's payment gateway are "
            "admin clicks in the dashboard; nothing is ever deleted or renamed from here."
            if action else "Pass action.")))
    result = _unknown_args(action, args) or await handler(args, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


CATALOG_DATA_EDIT_TOOLS: Dict[str, ToolSpec] = {
    CATALOG_DATA_EDIT_TOOL_NAME: ToolSpec(
        name=CATALOG_DATA_EDIT_TOOL_NAME,
        schema=CATALOG_DATA_EDIT_SCHEMA,
        executor=execute_catalog_data_edit,
        required_permission=None,
        setting_key=CATALOG_DATA_EDIT_GROUP_KEY,
        default_enabled=False,
        default_roles=None,
        # For AI apps building a site from a design over MCP; the in-product
        # assistant is never offered it (it would need its own confirm cards).
        mcp_only=True,
        phase=3,
        mode="WRITE",
    ),
}


def _register() -> None:
    """Self-register into the shared registry (see assistant_tool_registry._load_feature_tools)."""
    from .assistant_tool_registry import ASSISTANT_TOOLS
    ASSISTANT_TOOLS.update(CATALOG_DATA_EDIT_TOOLS)


_register()

__all__ = [
    "CATALOG_DATA_EDIT_TOOLS", "CATALOG_DATA_EDIT_TOOL_NAME", "CATALOG_DATA_EDIT_GROUP_KEY",
    "CATALOG_DATA_EDIT_ACTIONS", "CATALOG_DATA_EDIT_SCHEMA", "WRITE_ENDPOINTS", "execute_catalog_data_edit",
    "slugify", "pick_mapping", "course_update_body", "link_url_ok", "issue_plan_token", "check_plan_token",
    "PLAN_TOKEN_TTL_SECONDS",
]
