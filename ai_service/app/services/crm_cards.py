"""
The CRM writes in the in-product assistant: the preview becomes the
assistant's confirmation card, and the card's Confirm runs the change.

One code path. Every CRM write executor runs crm_data's two-step
(``preview_or_apply``). Over MCP the preview hands the AI app a confirm_token
and the same call with it applies. In the assistant (``crm_data.card_door``):

* ``propose`` runs the executor once with the model's arguments (a
  ``confirm_token`` the model passes is dropped). The executor resolves and
  checks everything as on MCP — the caller's lead scope, admin-only actions,
  opt-out rules, the admission rule — and, when there is something to change,
  mints the same token MCP would (an edit token bound to the request and the
  targets' current state, or a single-use one under the hourly caps). The
  token goes to the card (``CARD_TOKEN_KEY``), stored encrypted with the
  pending action and bound to this assistant session; the model only sees the
  card's text.
* ``perform`` (the card's Confirm, via registry.performer_for) runs the same
  executor with the stored arguments plus that token and ``ctx.card_confirm``.
  The executor re-resolves and re-checks everything and the token check
  refuses a change made in between, exactly as an MCP confirm does; only then
  does the change run (``ctx.card_applied``).

The card itself is single-use and expires before its token (the confirm
endpoint claims it atomically). Actions that contact a lead stay MCP-only
(``REFUSED_ACTIONS``).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from . import crm_data as cd
from .assistant_tool_registry import ToolContext, ToolSpec

logger = logging.getLogger(__name__)

#: Actions of card-bridged tools the assistant refuses: they contact a lead.
REFUSED_ACTIONS: Dict[str, Dict[str, str]] = {
    "crm_meetings_edit": {
        "book": ("Booking a meeting sends the lead a calendar invite and an email (and a WhatsApp when the booking "
                 "page's reminders say so), so it is not available in this assistant. Book it from "
                 "[My Schedule](/meetings/my-schedule)."),
    },
}

#: The most lines a card lists; the rest is counted.
MAX_LINES = 8
_TEXT = 160


def card_client(session_id: Any) -> str:
    """What a card's confirm token is bound to in place of an MCP connection: this assistant session."""
    return f"assistant:{session_id}"


def refused(tool: str, action: Any) -> Optional[str]:
    return REFUSED_ACTIONS.get(tool, {}).get(str(action or "").strip())


def _cipher():
    from ..mcp.crypto import TokenCipher
    from . import course_builder_data as cbd
    return TokenCipher(cbd._settings().resolve_mcp_encryption_key())


def _loads(raw: Any) -> Any:
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return None


def _door(ctx: ToolContext) -> None:
    """The assistant door: no MCP connection; tokens are bound to this session."""
    ctx.via_mcp = False
    ctx.client_id = card_client(ctx.session_id)


# ── propose: the preview becomes the card ────────────────────────────────

async def propose(spec: ToolSpec, args: Dict[str, Any], ctx: ToolContext) -> str:
    from .assistant_tool_registry import _propose_action

    action = str((args or {}).get("action") or "").strip()
    why = refused(spec.name, action)
    if why:
        return json.dumps({"error": "action_not_available", "tool": spec.name, "action": action,
                           "message": why + " Do not retry."}, ensure_ascii=False)
    if not ctx.session_id:
        return json.dumps({"error": "no_session"})
    args = {k: v for k, v in (args or {}).items() if k != "confirm_token"}
    _door(ctx)
    ctx.card_confirm = False
    raw = await spec.executor(dict(args), ctx)
    data = _loads(raw)
    if not isinstance(data, dict) or cd.CARD_TOKEN_KEY not in data:
        if isinstance(data, dict) and "confirm_token" in data:   # never hand a token to the model
            data.pop("confirm_token", None)
            return json.dumps(data, ensure_ascii=False, default=str)
        return raw
    token = str(data.pop(cd.CARD_TOKEN_KEY))
    ttl = data.pop("confirm_expires_in_s", None)
    card = build_card(spec.name, action, data)
    sealed = _cipher().encrypt(token)
    shown = _loads(await _propose_action(ctx, spec.name, {"args": args, "token": sealed}, card["title"], card=card,
                                         expires_in_s=ttl))
    if not isinstance(shown, dict) or shown.get("status") != "awaiting_user_confirmation":
        return json.dumps(shown, ensure_ascii=False, default=str)
    # The card's lines carry names, notes and answers written by leads or staff: the model gets them as data.
    return json.dumps({"status": shown["status"],
                       "card": cd.lead_content({k: shown[k] for k in ("summary", "details", "warnings") if k in shown}),
                       "note": shown.get("note")}, ensure_ascii=False, default=str)


# ── perform: the card's Confirm ──────────────────────────────────────────

_CARD_REFUSALS = {
    "confirm_token_mismatch": ("Something on this card changed after it was shown (in the dashboard or another "
                               "conversation), so nothing was changed. Ask the assistant again for a fresh card."),
    "confirm_token_expired": "This card expired, so nothing was changed. Ask the assistant again.",
    "confirm_token_used": "This card was already used. Nothing more was changed.",
    "confirm_token_invalid": "This card can no longer be confirmed, so nothing was changed. Ask the assistant again.",
    "confirm_required": "This card can no longer be confirmed, so nothing was changed. Ask the assistant again.",
    "confirm_unavailable": "Confirmations are not available right now. Nothing was changed; try again later.",
}


def _failed(message: str, detail: Any = None, *, retry: bool = False) -> Dict[str, Any]:
    out: Dict[str, Any] = {"ok": False, "message": message, "detail": detail if detail is not None else message}
    if retry:
        out["retry"] = True
    return out


async def perform(spec: ToolSpec, perform_args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    """Run an approved card: the same executor with the card's token; ``{ok, message, detail, retry?}``."""
    from .assistant_tool_registry import context_entitlements, missing_module_feature

    stored = dict((perform_args or {}).get("args") or {})
    action = str(stored.get("action") or "").strip()
    why = refused(spec.name, action)
    if why:
        return _failed(why)
    if (spec.module_feature or spec.module_features_any) and ctx.db is not None:
        try:
            missing = missing_module_feature(spec, context_entitlements(ctx))
        except Exception:  # noqa: BLE001 — a broken entitlement check never runs a gated write
            logger.exception("card confirm: module check failed for %s", spec.name)
            missing = spec.module_feature or "unknown"
        if missing:
            return _failed("This is not part of the institute's plan any more, so nothing was changed.")
    token = _cipher().decrypt((perform_args or {}).get("token"))
    if not token:
        return _failed(_CARD_REFUSALS["confirm_token_invalid"])
    _door(ctx)
    ctx.card_confirm, ctx.card_applied = True, False
    # Identity always from the principal confirming (the session owner), never from what was stored.
    args = {**stored, "user_id": ctx.principal.user_id, "institute_id": ctx.principal.institute_id,
            "confirm_token": token}
    try:
        data = _loads(await spec.executor(args, ctx))
    finally:
        ctx.card_confirm = False
    return outcome(data, applied=ctx.card_applied)


def outcome(data: Any, *, applied: bool) -> Dict[str, Any]:
    """What the card's Confirm tells the user, from the executor's answer and whether the change ran."""
    if not isinstance(data, dict):
        return _failed("The change could not be applied. Nothing was changed.")
    code = data.get("error")
    detail = json.dumps(data, ensure_ascii=False, default=str)[:400]
    if not applied or code:
        if code == "rate_limited":
            minutes = max(1, int((data.get("retry_after_s") or 60) + 59) // 60)
            return _failed(f"This change is limited to {data.get('cap_per_hour')} an hour and that limit is reached. "
                           f"Nothing was changed; press Confirm again in about {minutes} minute"
                           f"{'s' if minutes != 1 else ''} while the card is still open.", detail, retry=True)
        message = _CARD_REFUSALS.get(code or "")
        if message is None:
            message = cd.clean(data.get("message"), 400) or "The change could not be applied."
            if not applied and "nothing" not in message.lower():
                message += " Nothing was changed."
        return _failed(message, detail)
    notes: List[str] = []
    moved = (data.get("not_changed_because_they_changed_since_preview")
             or data.get("not_added_because_they_changed_since_preview"))
    if moved:
        notes.append(f"{len(moved)} of them changed after the card was shown and were left as they were.")
    skipped = data.get("skipped")
    if isinstance(skipped, dict) and skipped.get("count"):
        notes.append(f"{skipped['count']} were skipped since the card was shown.")
    failed = data.get("failed")
    if isinstance(failed, list) and failed:
        notes.append(f"{len(failed)} part{'s' if len(failed) != 1 else ''} could not be saved.")
    elif isinstance(failed, (int, float)) and failed:
        notes.append(f"{int(failed)} could not be saved.")
    summary = data.get("summary") if isinstance(data.get("summary"), dict) else {}
    if summary.get("failed"):
        notes.append(f"{summary['failed']} row(s) could not be added.")
    if data.get("done") is False and not notes:
        notes.append("Some of it could not be saved.")
    return {"ok": True, "detail": detail, "notes": notes}


# ── the card's text ──────────────────────────────────────────────────────

def _s(value: Any, limit: int = _TEXT) -> str:
    text = cd.clean(value, limit) or ""
    return text + ("…" if value is not None and len(str(value).strip()) > limit else "")


def _plural(n: Any, one: str, many: Optional[str] = None) -> str:
    try:
        k = int(n)
    except (TypeError, ValueError):
        k = 0
    return f"{k} {one if k == 1 else (many or one + 's')}"


def _content(value: Any) -> str:
    """Text inside a lead_content block (or plain text), on one line."""
    if isinstance(value, dict):
        if "text" in value:
            return _s(value.get("text"))
        if "items" in value:
            return _s("; ".join(str(x) for x in value.get("items") or []))
    return _s(value)


def _lead(view: Any) -> str:
    """A lead or person as the lists show it: name, masked phone, list."""
    if not isinstance(view, dict):
        return "the lead"
    name = _s(view.get("name"), 80) or "(no name)"
    phone = view.get("phone")
    out = name + (f" ({phone})" if phone and phone not in name else "")
    lst = _s(view.get("list"), 60)
    return out + (f" · {lst}" if lst else "")


def _who(view: Any) -> str:
    if isinstance(view, dict):
        return _s(view.get("name"), 60) or _s(view.get("counsellor_id"), 60) or "a counsellor"
    return "unassigned"


def _status(view: Any) -> str:
    if isinstance(view, dict):
        return _s(view.get("label") or view.get("status"), 60) or "?"
    return _s(view, 60) or "(none)"


def _more(lines: List[str], total: int) -> List[str]:
    shown = lines[:MAX_LINES]
    if total > len(shown):
        shown.append(f"… and {total - len(shown)} more")
    return shown


def _automation_warnings(autos: Any, when: str = "") -> List[str]:
    if isinstance(autos, dict):           # crm_team_edit: {event, runs_per_lead, warning?}
        runs = autos.get("runs_per_lead") or []
        out = [f"Runs these automations for each lead: {', '.join(_s(a.get('name'), 60) for a in runs[:5])}"
               f"{' …' if len(runs) > 5 else ''}."] if runs else []
        if autos.get("warning"):
            out.append(_s(autos["warning"], 240))
        return out
    autos = [a for a in autos or [] if isinstance(a, dict)]
    contact = [a for a in autos if a.get("contacts_people")]
    out = []
    if contact:
        names = ", ".join(f"{_s(a.get('name'), 60)} ({', '.join(a.get('channels') or ['contact'])})"
                          for a in contact[:5])
        out.append(f"Automations that contact people will run{when}: {names}{' …' if len(contact) > 5 else ''}.")
    quiet = [a for a in autos if not a.get("contacts_people")]
    if quiet:
        out.append(f"Also runs{when}: {', '.join(_s(a.get('name'), 60) for a in quiet[:5])}"
                   f"{' …' if len(quiet) > 5 else ''}.")
    return out


def _skipped_warning(skipped: Any) -> List[str]:
    if isinstance(skipped, dict) and skipped.get("count"):
        reasons = ", ".join(f"{k.replace('_', ' ')}: {v}" for k, v in list((skipped.get("by_reason") or {}).items())[:4])
        return [f"{_plural(skipped['count'], 'lead')} left as they are ({reasons})."]
    if isinstance(skipped, list) and skipped:
        reasons: Dict[str, int] = {}
        for item in skipped:
            r = _s((item or {}).get("reason"), 80) if isinstance(item, dict) else "skipped"
            reasons[r] = reasons.get(r, 0) + 1
        text = ", ".join(f"{k}: {v}" for k, v in list(reasons.items())[:4])
        return [f"{_plural(len(skipped), 'lead')} left as they are ({text})."]
    return []


def _no_course(p: Dict[str, Any]) -> List[str]:
    nc = p.get("no_course_yet")
    return [_s(nc.get("message"), 300)] if isinstance(nc, dict) and nc.get("message") else []


def _tags(tags: Any) -> str:
    if not isinstance(tags, dict) or not tags:
        return "(none)"
    return ", ".join(f"{_s(k, 40)}={_s(v, 60)}" for k, v in tags.items())


def build_card(tool: str, action: str, p: Dict[str, Any]) -> Dict[str, Any]:
    """``{title, details, warnings}`` from a write's preview: what changes, for whom, and what to know first."""
    fn = _CARDS.get(action)
    card = fn(p) if fn else {"title": f"Confirm this CRM change ({action or tool})", "details": [], "warnings": []}
    card.setdefault("details", [])
    card.setdefault("warnings", [])
    card["details"] = [d for d in card["details"] if d]
    card["warnings"] = [w for w in card["warnings"] if w]
    return card


def _set_status(p: Dict[str, Any]) -> Dict[str, Any]:
    to = _status(p.get("to"))
    leads = p.get("leads") or []
    total = int(p.get("count") or len(leads))
    lines = [f"{_lead(v)}: {_status(v.get('from'))} → {to}" + (" (no course yet)" if v.get("no_course_yet") else "")
             for v in leads]
    warnings = _no_course(p) + _automation_warnings(p.get("automations")) + _skipped_warning(p.get("skipped"))
    if p.get("unchanged"):
        warnings.append(f"{_plural(p['unchanged'], 'lead')} already on {to}: left as they are.")
    if p.get("other_lists_not_changed"):
        warnings.append(_s(p["other_lists_not_changed"], 240))
    return {"title": f"Change status to {to} for {_plural(total, 'lead')}", "details": _more(lines, total),
            "warnings": warnings}


def _set_tier(p: Dict[str, Any]) -> Dict[str, Any]:
    tier = _s(p.get("tier"), 40)
    leads = p.get("leads") or []
    total = int(p.get("people") or len(leads))
    lines = [f"{_lead(v)}: {_s(v.get('tier_from'), 40) or '(none)'} → {tier}" for v in leads]
    return {"title": f"Set tier to {tier} for {_plural(total, 'person', 'people')}", "details": _more(lines, total),
            "warnings": _automation_warnings(p.get("automations")) + _skipped_warning(p.get("skipped"))}


def _tag(p: Dict[str, Any]) -> Dict[str, Any]:
    remove = p.get("will") == "remove"
    names = ", ".join(_s(t.get("name") or t.get("tag_id"), 40) for t in p.get("tags") or [])
    leads = p.get("leads") or []
    total = int(p.get("people") or len(leads))
    title = (f"Remove tag {names} from " if remove else f"Add tag {names} to ") + _plural(total, "person", "people")
    return {"title": title, "details": _more([_lead(v) for v in leads], total),
            "warnings": _skipped_warning(p.get("skipped"))}


def _tag_lists(p: Dict[str, Any]) -> Dict[str, Any]:
    lists = p.get("lists") or []
    lines = [f"{_s(x.get('list') or x.get('list_id'), 60)}: {_tags(x.get('tags_before'))} → {_tags(x.get('tags_after'))}"
             for x in lists]
    return {"title": f"Set report tags on {_plural(len(lists), 'lead list')}", "details": _more(lines, len(lists)),
            "warnings": _skipped_warning(p.get("skipped"))}


def _changes(items: Any, label: str = "") -> List[str]:
    return [f"{label}{_s(c.get('field'), 40)}: {_s(c.get('from'), 80) or '(empty)'} → {_s(c.get('to'), 80)}"
            for c in items or [] if isinstance(c, dict)]


def _update_details(p: Dict[str, Any]) -> Dict[str, Any]:
    lines = _changes(p.get("changes")) + _changes(p.get("guardian"), "guardian ")
    answers = p.get("answers") if isinstance(p.get("answers"), dict) else {}
    for a in answers.get("items") or []:
        if isinstance(a, dict):
            lines.append(f"{_s(a.get('question'), 60)}: {_s(a.get('from'), 60) or '(empty)'} → {_s(a.get('to'), 80)}")
    return {"title": f"Update the details of {_lead(p.get('lead'))}", "details": lines,
            "warnings": [_s(w, 240) for w in p.get("warnings") or []]}


def _answers(value: Any) -> List[str]:
    items = value.get("items") if isinstance(value, dict) else None
    return [f"{_s(a.get('question'), 60)}: {_s(a.get('answer'), 80)}" for a in items or [] if isinstance(a, dict)]


def _intake_warnings(p: Dict[str, Any]) -> List[str]:
    """What adding leads sets off: the acknowledgement email, the admission rule and every kind of automation."""
    out: List[str] = []
    ack = p.get("acknowledgement_email")
    if isinstance(ack, dict) and ack.get("will_send") is not False and ack.get("message"):
        out.append(_s(ack["message"], 400))
    out += _no_course(p)
    out += _automation_warnings(p.get("automations"))
    out += _automation_warnings(p.get("automations_when_assigned"), " when an owner is set")
    out += _automation_warnings(p.get("automations_on_repeat_enquiry"), " for a repeat enquiry")
    return out


def _add_lead(p: Dict[str, Any]) -> Dict[str, Any]:
    lead = p.get("lead") or {}
    lst = (p.get("list") or {}).get("name") or (p.get("list") or {}).get("list_id")
    owner = p.get("owner")
    lines = [f"Phone: {lead['phone']}" if lead.get("phone") else "", f"Email: {lead['email']}" if lead.get("email") else "",
             f"Source: {_s(p.get('source'), 40)}",
             f"Owner: {_who(owner)}" if isinstance(owner, dict) else "Owner: the list's lead routing",
             f"Status: {_s(p.get('status'), 40)}" if p.get("status") else ""]
    lines += _answers(p.get("answers"))
    warnings: List[str] = []
    if p.get("warning"):
        warnings.append(_s(p["warning"], 300))
    similar = p.get("similar_name_leads")
    if isinstance(similar, list) and similar:
        names = ", ".join(_lead(s) for s in similar[:3] if isinstance(s, dict))
        warnings.append(f"Similar names already in the CRM: {names}. Check it is not the same person.")
    again = p.get("re_enquiry_of")
    if again:
        warnings.append("This person already is a lead: this adds a new enquiry for them.")
    warnings += _intake_warnings(p)
    return {"title": f"Add lead {_s(lead.get('name'), 80)} to {_s(lst, 60)}", "details": lines, "warnings": warnings}


def _import_leads(p: Dict[str, Any]) -> Dict[str, Any]:
    lst = (p.get("list") or {}).get("name") or (p.get("list") or {}).get("list_id")
    rows = p.get("rows") or []
    total = int(p.get("will_add") or len(rows))
    lines = [f"{_s(r.get('name'), 60)}" + (f" ({r['phone']})" if r.get("phone") else "")
             + (f" ({r['email']})" if r.get("email") and not r.get("phone") else "")
             + (f" · {_s(r.get('owner'), 40)}" if r.get("owner") else "")
             + (f" · status {_s(r.get('status'), 40)}" if r.get("status") else "")
             + (" (no course yet)" if r.get("no_course_yet") else "") for r in rows]
    warnings: List[str] = []
    dropped = p.get("dropped") or []
    if dropped:
        warnings.append(f"{_plural(len(dropped), 'row')} left out (already leads, opted out, incomplete or "
                        "refused by the admission rule).")
    if p.get("re_enquiries"):
        warnings.append(f"{_plural(p['re_enquiries'], 'row')} add a new enquiry for an existing lead.")
    warnings += _intake_warnings(p)
    return {"title": f"Import {_plural(total, 'lead')} into {_s(lst, 60)}", "details": _more(lines, total),
            "warnings": warnings}


def _person(view: Any) -> str:
    if not isinstance(view, dict):
        return "a person"
    return f"{_s(view.get('name'), 80) or '(no name)'} ({_plural(view.get('enquiries') or 0, 'enquiry', 'enquiries')})"


def _merge_people(p: Dict[str, Any]) -> Dict[str, Any]:
    keep, dup = p.get("keep") or {}, p.get("duplicate") or {}
    return {"title": f"Merge {_s(dup.get('name'), 80) or 'the duplicate'} into {_s(keep.get('name'), 80) or 'the person kept'}",
            "details": [f"Keep: {_person(keep)}", f"Duplicate: {_person(dup)}"],
            "warnings": [_s(e, 240) for e in (p.get("effects") or [])[:4]]}


def _unmerge_people(p: Dict[str, Any]) -> Dict[str, Any]:
    merged = p.get("merged_person") or {}
    return {"title": f"Undo the merge of {_s(merged.get('name'), 80) or 'this person'}",
            "details": [_s(e, 240) for e in p.get("effects") or []]}


def _log_interaction(p: Dict[str, Any]) -> Dict[str, Any]:
    kind = str(p.get("kind") or "NOTE").lower().replace("_", " ")
    lines = []
    if p.get("note"):
        lines.append(f"Note: {_content(p['note'])}")
    if p.get("outcome"):
        lines.append(f"Outcome: {_s(p['outcome'], 80)}")
    answers = p.get("answers") if isinstance(p.get("answers"), dict) else {}
    for a in answers.get("items") or []:
        if isinstance(a, dict):
            lines.append(f"{_s(a.get('question'), 60)}: {_s(a.get('answer'), 80)}")
    fu = p.get("followup")
    if isinstance(fu, dict):
        lines.append(f"Next follow-up: {_s(fu.get('at_local'), 60)}"
                     + (f" — {_content(fu['note'])}" if fu.get("note") else ""))
    st = p.get("status_change")
    if isinstance(st, dict):
        lines.append(f"Status: {_status(st.get('from'))} → {_status(st.get('to'))}")
    if p.get("call_outcome"):
        lines.append(f"Call outcome: {_s(p['call_outcome'], 60)}")
    warnings = _no_course(p) + _automation_warnings(p.get("automations"))
    held = p.get("status_not_changed")
    if isinstance(held, dict):
        warnings.append(f"The status stays as it is: {_s(held.get('reason'), 160)}.")
    warnings += [_s(n, 200) for n in p.get("notes") or []]
    return {"title": f"Log a {kind} with {_lead(p.get('lead'))}", "details": lines, "warnings": warnings}


def _add_note(p: Dict[str, Any]) -> Dict[str, Any]:
    return {"title": f"Add a note to {_lead(p.get('lead'))}", "details": [_content(p.get("note"))]}


def _schedule_followup(p: Dict[str, Any]) -> Dict[str, Any]:
    fu = p.get("followup") or {}
    lines = [f"When: {_s(fu.get('at_local'), 60)}", f"Note: {_content(fu['note'])}" if fu.get("note") else ""]
    lines += [f"{k.replace('_', ' ')}: {_s(v, 60)}" for k, v in (fu.get("fields") or {}).items()]
    warnings = [_s(n, 200) for n in p.get("notes") or []]
    autos = p.get("automations_when_due") or []
    if autos:
        warnings += _automation_warnings(autos)
    return {"title": f"Schedule a follow-up with {_lead(p.get('lead'))}", "details": lines, "warnings": warnings}


def _reschedule_followup(p: Dict[str, Any]) -> Dict[str, Any]:
    who = f" with {_lead(p['lead'])}" if p.get("lead") else ""
    return {"title": f"Move a follow-up{who}",
            "details": [f"{_s(p.get('from_local') or p.get('from'), 60)} → {_s(p.get('to_local'), 60)}",
                        f"Note: {_content(p['note'])}" if p.get("note") else ""],
            "warnings": [_s(p["note_on_due"], 240)] if p.get("note_on_due") else []}


def _complete_followup(p: Dict[str, Any]) -> Dict[str, Any]:
    who = f" with {_lead(p['lead'])}" if p.get("lead") else ""
    nxt = p.get("then_schedules") or {}
    return {"title": f"Mark a follow-up{who} as done",
            "details": [f"Outcome: {_content(p.get('outcome'))}",
                        f"Then a new follow-up: {_s(nxt.get('at_local'), 60)}" if nxt else ""],
            "warnings": ["A completed follow-up cannot be reopened."]}


def _assign(p: Dict[str, Any], *, reassign: bool = False) -> Dict[str, Any]:
    changes = p.get("changes") or []
    total = int((p.get("leads") if reassign else p.get("people")) or len(changes))
    src = _who(p.get("from")) if reassign else None
    lines = [f"{_lead(c)}: {src or _who(c.get('from'))} → {_who(c.get('to'))}" for c in changes]
    warnings = _automation_warnings(p.get("automations")) + _skipped_warning(p.get("skipped"))
    shown = p.get("still_shown_with_enquiry_counsellor")
    if isinstance(shown, dict) and shown.get("note"):
        warnings.append(_s(shown["note"], 240))
    if reassign and p.get("pools"):
        warnings.append(f"Their lead routing stops in {_plural(len(p['pools']), 'lead pool')}.")
    return {"title": _s(p.get("preview"), 200) or "Move leads between counsellors", "details": _more(lines, total),
            "warnings": warnings}


def _routing(p: Dict[str, Any]) -> Dict[str, Any]:
    pools = p.get("pools") or []
    lines = [f"{_s(x.get('pool') or x.get('pool_id'), 60)}: {x.get('from')} → {x.get('to')}" for x in pools]
    return {"title": _s(p.get("preview"), 200) or "Change lead routing", "details": _more(lines, len(pools)),
            "warnings": [_s(e, 240) for e in (p.get("effects") or [])[1:]]}


def _log_outcome(p: Dict[str, Any]) -> Dict[str, Any]:
    what = "held" if p.get("outcome") == "HELD" else "a no-show"
    who = f" with {_lead(p['lead'])}" if p.get("lead") else ""
    return {"title": f"Log the meeting{who} as {what}",
            "details": [f"When: {_s(p.get('meeting_at'), 60)}" if p.get("meeting_at") else "",
                        f"Note: {_content(p['note'])}" if p.get("note") else "",
                        f"Next step: {_content(p['next_step'])}" if p.get("next_step") else ""]}


_CARDS = {
    "set_status": _set_status, "set_tier": _set_tier, "tag": _tag, "untag": _tag, "tag_lists": _tag_lists,
    "update_details": _update_details, "add_lead": _add_lead, "import_leads": _import_leads,
    "merge_people": _merge_people, "unmerge_people": _unmerge_people,
    "log_interaction": _log_interaction, "add_note": _add_note, "schedule_followup": _schedule_followup,
    "reschedule_followup": _reschedule_followup, "complete_followup": _complete_followup,
    "assign_leads": _assign, "reassign_from_counsellor": lambda p: _assign(p, reassign=True),
    "pause_routing": _routing, "resume_routing": _routing, "log_outcome": _log_outcome,
}

__all__ = ["REFUSED_ACTIONS", "card_client", "refused", "propose", "perform", "outcome", "build_card"]
