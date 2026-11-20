"""The guide's five tools (SPEC 2.3).

    play_tour(tour_id)        play one catalogue tour after the reply is spoken
    offer_choices(options)    up to 5 tappable answers
    ask_contact(reason)       show the contact form (at most twice per session)
    search_knowledge(query)   product facts, then the how-to help library
    note_visitor(fields)      what was learned about the visitor

Executors get a TurnContext built from the verified session: the product,
session and institute come from there, never from the model's arguments. A
tool returns only text for the model; what the visitor should see (a tour, the
choices, the form) is collected on the context and sent by the engine after
the text, so the model cannot emit an action the server did not check.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

from ..db import db_session
from . import catalog as cat
from . import knowledge as K
from . import repository as repo
from .settings import MAX_CHOICES, Product

logger = logging.getLogger(__name__)

NOTE_FIELDS = ("audience", "learner_count", "current_tools", "needs", "timeline")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"\+?\d[\d\s-]{7,}\d")
_ID_RE = re.compile(r"[^a-z0-9_-]+")


@dataclass
class TurnContext:
    session_id: str
    product: Product
    lang: str
    catalogue: Optional[Dict[str, Any]]
    knowledge: str = ""
    lead_saved: bool = False
    forms_shown: int = 0
    tours_seen: List[str] = field(default_factory=list)
    # what this turn will show the visitor
    tour_id: Optional[str] = None
    choices: List[Dict[str, str]] = field(default_factory=list)
    form_reason: Optional[str] = None
    notes: Dict[str, str] = field(default_factory=dict)
    searched: List[str] = field(default_factory=list)
    learned: List[str] = field(default_factory=list)      # tool result texts (figures the reply may quote)


Executor = Callable[[Dict[str, Any], TurnContext], Awaitable[str]]


def _clip(v: Any, cap: int) -> str:
    if v is None or isinstance(v, (dict, list)):
        return ""
    return " ".join(str(v).split())[:cap]


async def _play_tour(args: Dict[str, Any], ctx: TurnContext) -> str:
    tour_id = _clip(args.get("tour_id"), 80)
    tour = cat.tour(ctx.catalogue, tour_id)
    if tour is None:
        ids = ", ".join(t["id"] for t in cat.tours(ctx.catalogue)[:40])
        return f"No such tour. Valid tour ids: {ids or 'none'}."
    if ctx.tour_id:
        return f"Only one tour per reply: {ctx.tour_id} is already queued."
    ctx.tour_id = tour["id"]
    with db_session() as db:
        repo.add_tour(db, ctx.session_id, tour["id"])
    return ("Queued. The tour starts when you finish speaking: say ONE short line introducing it, ask nothing, "
            "and stop.")


async def _offer_choices(args: Dict[str, Any], ctx: TurnContext) -> str:
    raw = args.get("options")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = [raw]
    options: List[Dict[str, str]] = []
    for i, item in enumerate(raw if isinstance(raw, list) else []):
        if isinstance(item, dict):
            label, oid = _clip(item.get("label"), 60), _clip(item.get("id"), 40)
        else:
            label, oid = _clip(item, 60), ""
        if not label:
            continue
        oid = _ID_RE.sub("-", oid.lower()).strip("-") or f"c{i + 1}"
        if any(o["id"] == oid for o in options):
            oid = f"{oid}-{i + 1}"
        options.append({"id": oid, "label": label})
        if len(options) == MAX_CHOICES:
            break
    if not options:
        return "No choices given. Pass options as a list of {id, label}."
    ctx.choices = options
    return f"{len(options)} choices will be shown under your reply. Do not list them again in your text."


async def _ask_contact(args: Dict[str, Any], ctx: TurnContext) -> str:
    from .settings import MAX_FORMS_PER_SESSION
    if ctx.lead_saved:
        return "The visitor already sent their contact details. Do not ask again."
    if ctx.forms_shown >= MAX_FORMS_PER_SESSION:
        return "The contact form was already shown twice in this session. Do not ask again."
    if ctx.form_reason is None:
        ctx.form_reason = _clip(args.get("reason"), 200) or "so the team can reach you"
    return ("The contact form will be shown under your reply. Say in one line why (the team can help with this), "
            "and do not ask for the details in the chat.")


async def _search_knowledge(args: Dict[str, Any], ctx: TurnContext) -> str:
    query = _clip(args.get("query"), 200)
    if not query:
        return "Give a query."
    ctx.searched.append(query)
    found = await K.search(ctx.knowledge, query, ctx.product.lead_institute_id)
    text = K.render(found)
    if not text:
        return ("Nothing was found for this. Say you do not know this detail and offer a call with the team "
                "(ask_contact). Do not guess.")
    ctx.learned.append(text)
    return text


async def _note_visitor(args: Dict[str, Any], ctx: TurnContext) -> str:
    raw = args.get("fields") if isinstance(args.get("fields"), dict) else args
    fields: Dict[str, str] = {}
    for key in NOTE_FIELDS:
        value = _clip((raw or {}).get(key), 200)
        # Contact details belong in the form (and the CRM), never in free-text notes.
        # (learner_count may hold a range of numbers, so only the email check applies to it.)
        if not value or _EMAIL_RE.search(value) or (key != "learner_count" and _PHONE_RE.search(value)):
            continue
        fields[key] = value
    if not fields:
        return f"Nothing recorded. Allowed fields: {', '.join(NOTE_FIELDS)}."
    ctx.notes.update(fields)
    with db_session() as db:
        repo.merge_qualification(db, ctx.session_id, fields)
    return "Noted."


def _obj(props: Dict[str, Any], required: List[str]) -> Dict[str, Any]:
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: Dict[str, Any]
    executor: Executor

    def schema(self) -> Dict[str, Any]:
        return {"type": "function", "function": {"name": self.name, "description": self.description,
                                                 "parameters": self.parameters}}


TOOLS: List[ToolSpec] = [
    ToolSpec("play_tour",
             "Play one guided tour on the visitor's screen after your reply has been spoken. Use a tour id from the "
             "catalogue. At most one per reply.",
             _obj({"tour_id": {"type": "string", "description": "A tour id from the catalogue."}}, ["tour_id"]),
             _play_tour),
    ToolSpec("offer_choices",
             f"Show up to {MAX_CHOICES} tappable answers under your reply, in the session language.",
             _obj({"options": {"type": "array", "maxItems": MAX_CHOICES, "items": _obj(
                 {"id": {"type": "string", "description": "Short id: an audience id, a tour id or a word."},
                  "label": {"type": "string", "description": "A few words the visitor taps."}}, ["id", "label"])}},
                  ["options"]),
             _offer_choices),
    ToolSpec("ask_contact",
             "Show the contact form (name, phone, email, organisation). Only on buying intent or after two tours.",
             _obj({"reason": {"type": "string", "description": "Why, in a few words, e.g. 'pricing for 500 learners'."}},
                  ["reason"]),
             _ask_contact),
    ToolSpec("search_knowledge",
             "Search the product facts and the how-to help library. Use it before answering any product question. "
             "Query with a few English keywords.",
             _obj({"query": {"type": "string"}}, ["query"]),
             _search_knowledge),
    ToolSpec("note_visitor",
             "Record what you learned about the visitor. Never put names, phone numbers or emails here.",
             _obj({"fields": _obj({k: {"type": "string"} for k in NOTE_FIELDS}, [])}, ["fields"]),
             _note_visitor),
]
_BY_NAME = {t.name: t for t in TOOLS}
TOOL_NAMES = [t.name for t in TOOLS]


def schemas() -> List[Dict[str, Any]]:
    return [t.schema() for t in TOOLS]


async def execute(name: str, raw_args: Any, ctx: TurnContext) -> str:
    """Run one tool call. Never raises: a failure is a short text the model can act on."""
    spec = _BY_NAME.get(name)
    if spec is None:
        return f"Unknown tool {name!r}."
    args: Any = raw_args
    if isinstance(raw_args, str):
        try:
            args = json.loads(raw_args) if raw_args.strip() else {}
        except ValueError:
            try:
                from json_repair import repair_json
                args = json.loads(repair_json(raw_args))
            except Exception:  # noqa: BLE001
                args = {}
    if not isinstance(args, dict):
        args = {}
    try:
        return await spec.executor(args, ctx)
    except Exception:  # noqa: BLE001
        logger.exception("demo-guide: tool %s failed (session %s)", name, ctx.session_id)
        return "This did not work just now. Carry on without it."
