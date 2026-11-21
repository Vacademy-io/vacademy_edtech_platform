"""
The ``website_publish`` tool — put a checked website draft LIVE, or roll the
live site back to an earlier published version, from an AI app over MCP.

This is the one website tool that changes what visitors see, so it is built
around a two-step confirm and refuses whenever the state it was shown has
moved:

    publish   confirm_token from ``website_edit(action='request_publish')``.
              request_publish issues one only when this capability is on and
              its verdict is "ready" (checks, review and data audit pass, and
              admin-core says the draft is not older than the live site). The
              token is bound to the institute, the user, the site, the draft
              revision AND the SHA-256 of the draft's JSON text, and the live
              revision then; it is valid 10 minutes and spent by the first
              call that uses it. The publish itself goes to admin-core with
              expectedLiveRevisionNo + expectedDraftSha256 and never with
              overrideStale, so the server refuses (409) a draft older than
              live, a live site that moved, or a draft edited in between.
              Returns published_revision_no, previous_live_revision_no and a
              rollback_hint.
    rollback  to_revision_no (a PUBLISHED revision from the site's history).
              Without confirm_token: returns what the rollback changes on the
              live site (diff_vs_live) and a token bound to that target and
              the current live revision. With it: the target's JSON is saved
              as a NEW draft (refused when any draft is open — an admin's
              unpublished work is never overwritten) and published the same
              guarded way. Nothing is deleted: the rolled-back version stays
              in the history and can itself be restored.

Its own settings group ("Website: publish", the Website area's only "live"
edit), off by default for every institute and every role, never turned on by
the area's Edit level or the "Turn everything on" preset (``opt_in`` in the
catalogue), and MCP-only: the in-product assistant works next to the editor's
own Publish button. Identity is pinned by ``execute_tool``; every id is
resolved through the caller's own institute (``load_site``) and the token row
is filtered by it.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from .assistant_tool_registry import ToolContext, ToolSpec, _admin_core_json
from .website_data import (
    _err,
    _is_error,
    _parse_config,
    load_site,
    site_editor_url,
    site_url,
    text_sha256,
)

logger = logging.getLogger(__name__)

WEBSITE_PUBLISH_TOOL_NAME = "website_publish"
#: Its own settings group: off for every existing institute and connection until an admin turns it on.
WEBSITE_PUBLISH_GROUP_KEY = "website_publish"
WEBSITE_PUBLISH_ACTIONS = ("publish", "rollback")

CONFIRM_TTL = timedelta(minutes=10)
#: Unused tokens an institute may hold at once; the oldest are revoked first.
MAX_OPEN_TOKENS_PER_INSTITUTE = 20
#: Spent / expired rows are kept this long so a late call is told "expired" or "used", not "unknown".
_KEEP_SPENT = timedelta(hours=24)
TOKEN_PREFIX = "vpc_"
_TOKEN_RE = re.compile(r"^vpc_[A-Za-z0-9_-]{30,80}$")
#: Argument names that would carry a credential (confirm_token is this server's own nonce, not one).
_SECRET_ARG_RE = re.compile(r"(token|secret|password|api[_-]?key|authorization|bearer|cookie|^pat$)", re.I)
ROLLBACK_SOURCE = "MCP_ROLLBACK"

_PUBLISH_PATH = "/admin-core-service/v1/course-catalogue/revision/publish"
_SAVE_DRAFT_PATH = "/admin-core-service/v1/course-catalogue/revision/save-draft"
_DISCARD_PATH = "/admin-core-service/v1/course-catalogue/revision/discard-draft"
_HISTORY_PATH = "/admin-core-service/v1/course-catalogue/revision/history"
_REVISION_PATH = "/admin-core-service/v1/course-catalogue/revision/get"

ASK_FIRST = ("Publishing changes what visitors see at once. Call this only after the admin has seen what changes "
             "and clearly said to do it now.")

WEBSITE_PUBLISH_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": WEBSITE_PUBLISH_TOOL_NAME,
        "description": (
            "Put a website draft LIVE, or roll the live site back to an earlier published version. This changes "
            "what visitors see at once, so every call needs a confirm_token from a check made less than 10 minutes "
            "earlier, and only after the admin has seen what changes and clearly said yes.\n"
            "- publish (tag_name, confirm_token): run website_edit(action='request_publish') first; when it is "
            "ready it returns publish_confirm.confirm_token. Show the admin diff_vs_live.summary, ask, and on a "
            "clear yes call this with that token. The token works once, for that exact draft: any edit after "
            "request_publish, a newer live version or a draft older than live is refused — re-run request_publish. "
            "Returns published_revision_no, previous_live_revision_no and rollback_hint.\n"
            "- rollback (tag_name, to_revision_no, confirm_token?): bring back an earlier PUBLISHED version "
            "(previous_live_revision_no from a publish; without to_revision_no the error lists the published "
            "versions). First call without "
            "confirm_token: returns diff_vs_live and a token. Show the admin, ask, and on a clear yes call again "
            "with the same to_revision_no and the token. Refused while the site has an unpublished draft.\n"
            "Never pass credentials; confirm_token is the only token this tool takes. Never say the site is live "
            "unless this tool returned published=true."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(WEBSITE_PUBLISH_ACTIONS)},
                "tag_name": {"type": "string", "description": "The site (from website list); the token must be for it."},
                "confirm_token": {"type": "string", "description": (
                    "publish: publish_confirm.confirm_token from website_edit(request_publish). rollback: the token "
                    "the first rollback call returned. Single use, 10 minutes.")},
                "to_revision_no": {"type": "integer", "description": "rollback: the published revision number to bring back."},
            },
            "required": ["action"],
        },
    },
}


# ──────────────────────────────────────────────────────────────────────────
# Confirm-token store: mcp_publish_confirm (hash of the token only)
# ──────────────────────────────────────────────────────────────────────────
_schema_ready = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _ensure_schema(ctx: ToolContext) -> None:
    """Raise TableMissing when Flyway V562 has not created the table (ai_service runs no DDL)."""
    global _schema_ready
    if not _schema_ready:
        from ..models.flyway_owned import TableMissing
        from ..models.publish_confirm import check_publish_confirm_schema
        _schema_ready = check_publish_confirm_schema(ctx.db)
        if not _schema_ready:
            raise TableMissing("mcp_publish_confirm is missing (admin_core Flyway V562)")


def _issue_token(ctx: ToolContext, action: str, site: Dict[str, Any], **fields: Any) -> Tuple[str, datetime]:
    """
    A new single-use token for this institute + user + site + action. Older
    unused tokens for the same site and action are revoked: only the latest
    check can be confirmed.
    """
    from ..models.publish_confirm import PublishConfirm
    _ensure_schema(ctx)
    now = _now()
    inst = ctx.principal.institute_id
    q = ctx.db.query(PublishConfirm)
    q.filter(PublishConfirm.expires_at <= now - _KEEP_SPENT).delete(synchronize_session=False)
    q.filter(PublishConfirm.institute_id == inst, PublishConfirm.catalogue_id == site["catalogue_id"],
             PublishConfirm.action == action, PublishConfirm.used_at.is_(None)
             ).update({PublishConfirm.used_at: now}, synchronize_session=False)
    open_ids = [r[0] for r in (ctx.db.query(PublishConfirm.id)
                               .filter(PublishConfirm.institute_id == inst, PublishConfirm.used_at.is_(None),
                                       PublishConfirm.expires_at > now)
                               .order_by(PublishConfirm.created_at.desc()).all())]
    if len(open_ids) >= MAX_OPEN_TOKENS_PER_INSTITUTE:
        (ctx.db.query(PublishConfirm).filter(PublishConfirm.id.in_(open_ids[MAX_OPEN_TOKENS_PER_INSTITUTE - 1:]))
         .update({PublishConfirm.used_at: now}, synchronize_session=False))
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    expires = now + CONFIRM_TTL
    ctx.db.add(PublishConfirm(id=_token_hash(token), institute_id=inst, user_id=ctx.principal.user_id,
                              action=action, catalogue_id=site["catalogue_id"], tag_name=site["tag_name"],
                              created_at=now, expires_at=expires, **fields))
    ctx.db.commit()
    return token, expires


def _rollback_quietly(ctx: ToolContext) -> None:
    """A failed write leaves the shared session aborted; roll it back so later writes (the audit log) still land."""
    try:
        ctx.db.rollback()
    except Exception:  # noqa: BLE001
        logger.warning("website_publish: session rollback failed", exc_info=True)


def _token_refusal(code: str, message: str, **extra: Any) -> Dict[str, Any]:
    return _err(code, published=False, message=message, **extra)


def _load_token(ctx: ToolContext, token: Any, action: str):
    """``(row, None)`` for a live token of this institute + user + action, else ``(None, refusal)``."""
    from ..models.publish_confirm import PublishConfirm
    again = ("Re-run website_edit(action='request_publish')" if action == "publish"
             else "Call website_publish(action='rollback', tag_name, to_revision_no) without a token")
    if not isinstance(token, str) or not _TOKEN_RE.match(token.strip()):
        return None, _token_refusal("invalid_confirm_token", (
            f"confirm_token is missing or not one this server issued. {again} to get one, show the admin what "
            "changes, and call again after they say yes."))
    from ..models.flyway_owned import TableMissing
    try:
        _ensure_schema(ctx)
    except TableMissing:
        return None, _token_refusal("publish_unavailable", (
            "Publishing over MCP is not available on this server yet (its confirm-token store is missing). "
            "Nothing was changed: the admin can publish from the editor."))
    # populate_existing: a row this session already holds may predate a revoke / spend made in bulk.
    row = (ctx.db.query(PublishConfirm).populate_existing()
           .filter(PublishConfirm.id == _token_hash(token.strip()),
                   PublishConfirm.institute_id == ctx.principal.institute_id).first())
    if row is None or row.user_id != ctx.principal.user_id:
        return None, _token_refusal("invalid_confirm_token", (
            f"This confirm_token was not issued to this connection. {again} to get one."))
    if row.action != action:
        return None, _token_refusal("confirm_token_mismatch", (
            f"This confirm_token is for a {row.action}, not a {action}. {again} to get the right one."))
    if row.used_at is not None:
        return None, _token_refusal("confirm_token_used", (
            "This confirm_token was already used, or a newer check replaced it. Tokens work once. "
            f"{again} to check the current state again."))
    if _aware(row.expires_at) <= _now():
        return None, _token_refusal("confirm_token_expired", (
            f"This confirm_token expired (they last 10 minutes). {again}, show the admin the result and ask again."))
    return row, None


def _spend(ctx: ToolContext, row: Any) -> bool:
    """Marks the token used — atomically, so two calls racing with one token cannot both go on."""
    from ..models.publish_confirm import PublishConfirm
    now = _now()
    n = (ctx.db.query(PublishConfirm)
         .filter(PublishConfirm.id == row.id, PublishConfirm.institute_id == ctx.principal.institute_id,
                 PublishConfirm.used_at.is_(None), PublishConfirm.expires_at > now)
         .update({PublishConfirm.used_at: now}, synchronize_session=False))
    ctx.db.commit()
    return n == 1


def _other_tag(row: Any, tag_arg: Any) -> Optional[Dict[str, Any]]:
    if tag_arg and str(tag_arg).strip().lower() != str(row.tag_name).lower():
        return _token_refusal("confirm_token_mismatch", (
            f"This confirm_token is for website '{row.tag_name}', not '{tag_arg}'. Nothing was published."))
    return None


def _same_site(row: Any, site: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if site["catalogue_id"] != row.catalogue_id:
        return _token_refusal("confirm_token_mismatch", (
            f"Website '{row.tag_name}' is no longer the site this token was issued for. Nothing was published."))
    return None


# ──────────────────────────────────────────────────────────────────────────
# request_publish → token (called by website_edit)
# ──────────────────────────────────────────────────────────────────────────
def attach_publish_confirm(ctx: ToolContext, site: Dict[str, Any], out: Dict[str, Any]) -> None:
    """
    Adds ``publish_confirm`` to a request_publish result — only for a caller
    who may use website_publish. A token is issued only for a "ready" draft
    that admin-core says is not older than the live site.
    """
    if not ctx.may_use(WEBSITE_PUBLISH_TOOL_NAME):
        return
    revisions = site.get("revisions") or {}
    draft = site.get("draft") or {}
    if not out.get("ready"):
        out["publish_confirm"] = {"issued": False, "reason": (
            "No publish token: the draft is not ready (see blockers). Fix what you can, re-run request_publish, "
            "or hand the admin editor_url.")}
        return
    if revisions.get("live_changed_since_draft") is not False or not draft.get("id") or not site.get("draft_sha256"):
        out["publish_confirm"] = {"issued": False, "reason": (
            "No publish token: the server did not confirm that this draft is newer than the live site, so it "
            "cannot be published from here. Hand the admin editor_url.")}
        return
    try:
        token, expires = _issue_token(
            ctx, "publish", site,
            draft_revision_id=str(draft["id"]), draft_revision_no=draft.get("revision_no"),
            draft_sha256=site["draft_sha256"], live_revision_no=revisions.get("live_revision_no"),
            live_sha256=site.get("live_sha256"))
    except Exception:  # noqa: BLE001 — a failed issue never breaks the readiness report
        logger.exception("website_publish: issuing a publish token failed for %s", site.get("tag_name"))
        _rollback_quietly(ctx)
        out["publish_confirm"] = {"issued": False, "reason": "The publish token could not be issued; re-run request_publish."}
        return
    out["publish_confirm"] = {
        "issued": True,
        "confirm_token": token,
        "expires_at": expires.isoformat(),
        "expires_in_seconds": int(CONFIRM_TTL.total_seconds()),
        "draft_revision_no": draft.get("revision_no"),
        "live_revision_no": revisions.get("live_revision_no"),
        "how": (f"{ASK_FIRST} Then call website_publish(action='publish', tag_name='{site['tag_name']}', "
                "confirm_token=…) within 10 minutes. The token works once and only for this exact draft: any edit "
                "after this check needs a new request_publish."),
    }
    out["next"] = ("Ready: show the admin diff_vs_live.summary and ask whether to publish it now. On a clear yes, "
                   "call website_publish(action='publish') with publish_confirm.confirm_token; otherwise give them "
                   "editor_url to review and publish there.")
    out["note"] = ("request_publish only checks the draft; it never publishes. Until website_publish returns "
                   "published=true, never tell the admin the site is live.")


# ──────────────────────────────────────────────────────────────────────────
# admin-core calls
# ──────────────────────────────────────────────────────────────────────────
def _conflict_kind(data: Dict[str, Any]) -> str:
    """Which 409 admin-core answered; "" when it is none of the publish guard's (or not a 409)."""
    if data.get("status") != 409:
        return ""
    detail = str(data.get("detail") or "")
    if "DRAFT_CHANGED" in detail:
        return "draft_changed"
    if "STALE_GUARD_OFF" in detail:
        return "stale_guard_off"
    if "DRAFT_OLDER_THAN_LIVE" in detail:
        return "draft_older_than_live"
    return ""


async def _publish_draft(ctx: ToolContext, catalogue_id: str, draft_sha: str,
                         live_no: Optional[int]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """``(revision, None)`` or ``(None, admin-core's error dict)``. Never overrides the stale guard."""
    params: Dict[str, Any] = {"catalogueId": catalogue_id, "expectedDraftSha256": draft_sha}
    if live_no is not None:
        params["expectedLiveRevisionNo"] = live_no
    data = await _admin_core_json(ctx, "POST", _PUBLISH_PATH, params=params, timeout=60.0, error_detail=True)
    if _is_error(data) or not isinstance(data, dict):
        return None, data if isinstance(data, dict) else {"error": "fetch_failed"}
    return data, None


def _publish_failure(err: Dict[str, Any], tag: str, editor: str, again: str) -> Dict[str, Any]:
    status = err.get("status")
    kind = _conflict_kind(err)
    if kind == "draft_changed":
        return _token_refusal("draft_changed", (
            "Refused by the server: the draft changed after it was checked (an autosave or another editor). "
            f"Nothing was published. {again}"), editor_url=editor)
    if kind == "stale_guard_off":
        return _token_refusal("stale_guard_off", (
            "Refused by the server: its publish safety check (the stale-draft guard) is turned off, so nothing can "
            "be published from here. Nothing was published. Do not retry; hand the admin editor_url to publish "
            "there."), editor_url=editor)
    if status == 409:
        return _token_refusal("draft_older_than_live", (
            "Refused by the server: the live site changed after this was checked, so publishing would undo "
            f"newer live changes. Nothing was published. {again} The admin decides in the editor."),
            editor_url=editor)
    if status is None:
        return _token_refusal("publish_unknown", (
            f"The server did not answer the publish of '{tag}', so it may or may not have gone through. Do not "
            "retry: check with website(action='list') (or request_publish) and tell the admin what you find."),
            editor_url=editor)
    return _token_refusal("publish_failed", (
        f"The server refused the publish (HTTP {status}). Nothing was published. Hand the admin editor_url."),
        status=status, editor_url=editor)


def _rollback_hint(tag: str, previous_no: Optional[int]) -> Dict[str, Any]:
    if previous_no is None:
        return {"available": False, "message": (
            "There was no earlier published version on record, so there is nothing to roll back to from here. "
            "The admin can unpublish or change the site in Manage Pages.")}
    return {"available": True, "to_revision_no": previous_no, "how": (
        f"To undo: website_publish(action='rollback', tag_name='{tag}', to_revision_no={previous_no}) returns what "
        "changes and a confirm token; show the admin, and on a clear yes call it again with the token.")}


# ──────────────────────────────────────────────────────────────────────────
# Actions
# ──────────────────────────────────────────────────────────────────────────
async def _action_publish(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    row, refusal = _load_token(ctx, args.get("confirm_token"), "publish")
    if refusal:
        return refusal
    again = "Re-run website_edit(action='request_publish'), show the admin the result and ask again."
    if refusal := _other_tag(row, args.get("tag_name")):
        return refusal
    site, err = await load_site(ctx, row.tag_name, with_live=True)
    if err:
        return {**err, "published": False}
    if refusal := _same_site(row, site):
        return refusal
    tag, editor = site["tag_name"], site_editor_url(site["tag_name"], ctx=ctx)
    revisions = site.get("revisions") or {}
    draft = site.get("draft") or {}
    if site.get("draft_read_ok") is False:
        return _token_refusal("draft_unavailable", (
            "The site's draft could not be read right now, so it cannot be checked against the token. Nothing was "
            "published; try again in a moment."), editor_url=editor)
    if site.get("stale_draft") or revisions.get("live_changed_since_draft") is True:
        return _token_refusal("draft_older_than_live", (
            "The draft is now older than the live site: publishing it would undo newer live changes. Nothing was "
            "published. The admin decides in the editor (discard the draft or keep it deliberately)."),
            editor_url=editor, stale_draft={k: v for k, v in (site.get("stale_draft") or {}).items() if k != "note"})
    if not draft.get("id"):
        return _token_refusal("no_draft", (
            "There is no unpublished draft any more (it was published or discarded since the check). Nothing was "
            "published."), editor_url=editor)
    if (str(draft["id"]) != row.draft_revision_id or site.get("draft_sha256") != row.draft_sha256):
        return _token_refusal("confirm_token_mismatch", (
            f"The draft changed after request_publish checked it, so the admin has not seen this version. Nothing "
            f"was published. {again}"), editor_url=editor)
    if revisions.get("live_changed_since_draft") is None:
        return _token_refusal("stale_check_unavailable", (
            "The server did not say whether the live site changed after this draft was started, so it cannot be "
            "published from here. Nothing was published; hand the admin editor_url."), editor_url=editor)
    live_no = revisions.get("live_revision_no")
    if live_no != row.live_revision_no or (row.live_sha256 and site.get("live_sha256") != row.live_sha256):
        return _token_refusal("confirm_token_mismatch", (
            f"The live site changed after request_publish (live v{row.live_revision_no} → v{live_no}). Nothing was "
            f"published. {again}"), editor_url=editor)
    if not _spend(ctx, row):
        return _token_refusal("confirm_token_used", (
            "This confirm_token was used by another call a moment ago. Nothing more was published; check "
            "website(action='list')."))

    published, perr = await _publish_draft(ctx, site["catalogue_id"], row.draft_sha256, live_no)
    if perr:
        return _publish_failure(perr, tag, editor, again)
    out = {
        "published": True,
        "tag_name": tag,
        "published_revision_no": published.get("revision_no"),
        "previous_live_revision_no": live_no,
        "draft_revision_no": row.draft_revision_no,
        "rollback_hint": _rollback_hint(tag, live_no),
        "live_url": site_url(ctx, tag),
        "editor_url": editor,
        "next": "Tell the admin the site is live now (live_url) and how to undo it (rollback_hint).",
    }
    logger.info("website_publish: %s published v%s (was v%s) institute=%s user=%s", tag,
                out["published_revision_no"], live_no, ctx.principal.institute_id, ctx.principal.user_id)
    return out


async def _published_history(ctx: ToolContext, catalogue_id: str) -> Optional[List[Dict[str, Any]]]:
    data = await _admin_core_json(ctx, "GET", _HISTORY_PATH, params={"catalogueId": catalogue_id}, timeout=30.0)
    if not isinstance(data, list):
        return None
    return [r for r in data if isinstance(r, dict) and str(r.get("status") or "").upper() == "PUBLISHED"]


def _revision_no(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _revision_list(history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{"revision_no": r.get("revision_no"), "updated_at": r.get("updated_at"), "source": r.get("source")}
            for r in sorted(history, key=lambda r: -(_revision_no(r.get("revision_no")) or 0))[:10]]


async def _action_rollback(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    to_no = _revision_no(args.get("to_revision_no"))
    if to_no is None:
        out = _token_refusal("to_revision_no_required", (
            "Pass to_revision_no: the number of an earlier PUBLISHED version (previous_live_revision_no from a "
            "publish, or one of published_revisions). Nothing was changed."))
        site, err = await load_site(ctx, args.get("tag_name"))
        history = await _published_history(ctx, site["catalogue_id"]) if not err else None
        if history:
            out["published_revisions"] = _revision_list(history)
        return out
    token = args.get("confirm_token")
    row = None
    if token not in (None, ""):
        row, refusal = _load_token(ctx, token, "rollback")
        if refusal:
            return refusal
        if row.to_revision_no != to_no:
            return _token_refusal("confirm_token_mismatch", (
                f"This confirm_token is for rolling back to v{row.to_revision_no}, not v{to_no}. Nothing was changed."))
        if refusal := _other_tag(row, args.get("tag_name")):
            return refusal
    site, err = await load_site(ctx, row.tag_name if row else args.get("tag_name"), with_live=True)
    if err:
        return {**err, "published": False}
    if row is not None and (refusal := _same_site(row, site)):
        return refusal
    tag, editor = site["tag_name"], site_editor_url(site["tag_name"], ctx=ctx)
    if site.get("draft_read_ok") is False:
        return _token_refusal("draft_unavailable", (
            "The site's draft could not be read right now, so it is unknown whether the admin has unpublished work. "
            "Nothing was changed; try again in a moment."), editor_url=editor)
    if site.get("draft"):
        d = site["draft"]
        return _token_refusal("open_draft", (
            f"Website '{tag}' has an unpublished draft (v{d.get('revision_no')}). A rollback goes through a new "
            "draft and would overwrite it, so nothing was changed. Ask the admin to publish or discard that draft "
            "first (website_edit(action='discard_draft') only when they say so)."),
            editor_url=editor, draft_revision_no=d.get("revision_no"))

    history = await _published_history(ctx, site["catalogue_id"])
    if history is None:
        return _token_refusal("history_unavailable", (
            "The site's version history could not be read. Nothing was changed; try again in a moment."),
            editor_url=editor)
    numbers = [n for n in (_revision_no(r.get("revision_no")) for r in history) if n]
    live_no = max(numbers) if numbers else None
    target = next((r for r in history if _revision_no(r.get("revision_no")) == to_no), None)
    if target is None or not target.get("id"):
        return _token_refusal("revision_not_found", (
            f"Website '{tag}' has no published version v{to_no}. Nothing was changed."),
            published_revisions=_revision_list(history))
    if to_no == live_no:
        return _token_refusal("already_live", f"v{to_no} is the live version of '{tag}' already. Nothing was changed.")
    full = await _admin_core_json(ctx, "GET", _REVISION_PATH, params={"revisionId": target["id"]}, timeout=30.0)
    raw = full.get("catalogue_json") if isinstance(full, dict) and not _is_error(full) else None
    target_config = _parse_config(raw)
    if target_config is None:
        return _token_refusal("revision_unreadable", (
            f"Version v{to_no} could not be read (or is too large to handle here). Nothing was changed; the admin "
            "can restore it from the editor's history."), editor_url=editor)
    target_sha = text_sha256(raw)

    from .assistant_tools_website_edit import diff_site_configs
    diff = diff_site_configs(site.get("live_config"), target_config)
    if not diff.get("changed"):
        return _token_refusal("already_live", (
            f"v{to_no} has the same content as the live site of '{tag}'. Nothing was changed."))

    if row is None:
        try:
            new_token, expires = _issue_token(
                ctx, "rollback", site, to_revision_id=str(target["id"]), to_revision_no=to_no, to_sha256=target_sha,
                live_revision_no=live_no, live_sha256=site.get("live_sha256"))
        except Exception:  # noqa: BLE001
            logger.exception("website_publish: issuing a rollback token failed for %s", tag)
            _rollback_quietly(ctx)
            return _token_refusal("token_unavailable", "The confirm token could not be issued; try again.")
        return {
            "published": False,
            "confirm_required": True,
            "tag_name": tag,
            "to_revision_no": to_no,
            "to_revision": {k: target.get(k) for k in ("revision_no", "updated_at", "source") if target.get(k) is not None},
            "live_revision_no": live_no,
            "diff_vs_live": {**diff, "note": "What the live site would change to: the live version vs v%d." % to_no},
            "confirm_token": new_token,
            "expires_at": expires.isoformat(),
            "expires_in_seconds": int(CONFIRM_TTL.total_seconds()),
            "editor_url": editor,
            "next": (f"{ASK_FIRST} Show the admin diff_vs_live.summary and ask whether to roll '{tag}' back to "
                     f"v{to_no} now. On a clear yes, call website_publish(action='rollback', tag_name='{tag}', "
                     f"to_revision_no={to_no}, confirm_token=…) within 10 minutes."),
        }

    again = "Call website_publish(action='rollback') without a token to check again, and ask the admin again."
    if target_sha != row.to_sha256 or str(target["id"]) != row.to_revision_id:
        return _token_refusal("confirm_token_mismatch", f"v{to_no} is not the version that was checked. {again}")
    if live_no != row.live_revision_no or (row.live_sha256 and site.get("live_sha256") != row.live_sha256):
        return _token_refusal("confirm_token_mismatch", (
            f"The live site changed after the rollback was checked (live v{row.live_revision_no} → v{live_no}). "
            f"Nothing was changed. {again}"), editor_url=editor)
    if not _spend(ctx, row):
        return _token_refusal("confirm_token_used", (
            "This confirm_token was used by another call a moment ago. Nothing more was changed; check "
            "website(action='list')."))

    # create_only: admin-core refuses (409) if someone opened a draft since the check above.
    saved = await _admin_core_json(
        ctx, "POST", _SAVE_DRAFT_PATH, params={"catalogueId": site["catalogue_id"]},
        body={"catalogue_json": raw, "source": ROLLBACK_SOURCE, "ai_run_id": None, "create_only": True},
        timeout=60.0, error_detail=True)
    if _is_error(saved) or not isinstance(saved, dict):
        if isinstance(saved, dict) and saved.get("status") == 409:
            return _token_refusal("open_draft", (
                "Someone opened a draft of this site a moment ago; the rollback would overwrite it, so nothing was "
                "changed. Ask the admin to publish or discard it first."), editor_url=editor)
        return _token_refusal("rollback_failed", (
            "The rollback draft could not be saved. Nothing was changed; try again or hand the admin editor_url."),
            editor_url=editor)

    published, perr = await _publish_draft(ctx, site["catalogue_id"], target_sha, live_no)
    if perr:
        out = _publish_failure(perr, tag, editor, again)
        # Drop our own copy of v{to_no} only when the server has just confirmed the open draft IS that copy
        # (it checks the draft hash before these two refusals). Any other failure — a draft edited in between,
        # no draft, a 5xx, no answer — may leave someone else's draft open, and discard-draft drops whichever
        # draft is open, so it is left alone.
        if _conflict_kind(perr) in ("draft_older_than_live", "stale_guard_off"):
            await _admin_core_json(ctx, "POST", _DISCARD_PATH, params={"catalogueId": site["catalogue_id"]})
        elif perr.get("status") not in (None, 409, 400):
            out["draft_left_open"] = (f"A draft with v{to_no}'s content may be open in the editor; the admin can "
                                      "publish or discard it there.")
        return out
    out = {
        "published": True,
        "tag_name": tag,
        "rolled_back_to_revision_no": to_no,
        "published_revision_no": published.get("revision_no"),
        "previous_live_revision_no": live_no,
        "rollback_hint": _rollback_hint(tag, live_no),
        "live_url": site_url(ctx, tag),
        "editor_url": editor,
        "next": (f"Tell the admin '{tag}' now shows v{to_no}'s content again (as v{published.get('revision_no')}); "
                 "rollback_hint undoes this rollback."),
    }
    logger.info("website_publish: %s rolled back to v%s as v%s (was v%s) institute=%s user=%s", tag, to_no,
                out["published_revision_no"], live_no, ctx.principal.institute_id, ctx.principal.user_id)
    return out


# ──────────────────────────────────────────────────────────────────────────
# Dispatch + registration
# ──────────────────────────────────────────────────────────────────────────
_ACTIONS = {
    "publish": _action_publish,
    "rollback": _action_rollback,
}


async def execute_website_publish(args: Dict[str, Any], ctx: ToolContext) -> str:
    args = args or {}
    secrets_in = [k for k in args if isinstance(k, str) and k not in ("confirm_token", "user_id", "institute_id")
                  and _SECRET_ARG_RE.search(k)]
    if secrets_in:
        return json.dumps(_err("secret_not_accepted", published=False, fields=sorted(secrets_in), message=(
            "Never send credentials to this tool. The only token it takes is confirm_token, which this server "
            "issues itself.")))
    action = str(args.get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(WEBSITE_PUBLISH_ACTIONS)))
    result = await handler(args, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


WEBSITE_PUBLISH_TOOLS: Dict[str, ToolSpec] = {
    WEBSITE_PUBLISH_TOOL_NAME: ToolSpec(
        name=WEBSITE_PUBLISH_TOOL_NAME,
        schema=WEBSITE_PUBLISH_SCHEMA,
        executor=execute_website_publish,
        required_permission=None,
        setting_key=WEBSITE_PUBLISH_GROUP_KEY,
        # Live changes: never default-on; an admin turns it on for a role in MCP settings.
        default_enabled=False,
        default_roles=None,
        # The in-product assistant sits next to the editor's own Publish button.
        mcp_only=True,
        phase=3,
        mode="WRITE",
    ),
}


def _register() -> None:
    """
    Self-register into the shared registry (see assistant_tool_registry._load_feature_tools).
    No GROUP_LABELS entry, like design_import: the in-product assistant lists every
    labelled group as one an admin can turn on in Assistant settings, and this
    MCP-only group is not there (its label is MCP_TOOL_GROUP_LABELS').
    """
    from .assistant_tool_registry import ASSISTANT_TOOLS
    ASSISTANT_TOOLS.update(WEBSITE_PUBLISH_TOOLS)


_register()

__all__ = [
    "WEBSITE_PUBLISH_TOOLS", "WEBSITE_PUBLISH_TOOL_NAME", "WEBSITE_PUBLISH_GROUP_KEY", "WEBSITE_PUBLISH_ACTIONS",
    "WEBSITE_PUBLISH_SCHEMA", "CONFIRM_TTL", "execute_website_publish", "attach_publish_confirm",
]
