"""One visitor message → one answer, as a stream of SSE events.

    token {text}…   card {type, ...fields}…   done {message_id, answered, billed}
    or   error {code, message}  (daily_cap / no_credits also send the contact card first)

Order of checks, cheapest first; everything before the model is unbilled:
  invalid text → kill switch → site disabled → idempotent replay of the same
  client_msg_id → per-minute rate → distress / abuse (fixed replies) → caps
  (DB reservation) → credits pre-flight → the model with tools (≤ 4 rounds,
  the last without tools) → post-check → store → charge → cards → done.

No in-process state: idempotency and caps live in the database, the stream
is produced directly in the POST response (no polling).

The answer is produced by its own task, not by the HTTP response: a visitor
who closes the tab mid-answer does not stop it. The model call is already
paid for at that point, so the answer is still stored (it shows on a reload,
and a resend of the same client_msg_id replays it) and charged like any other.
Only an overall deadline (ANSWER_DEADLINE_SECONDS) stops it early.

Cap slots: one is reserved before the model runs and handed back ONLY when no
model call was made (guards, validation, credit pre-flight) or the model /
provider failed without producing anything. Once a model round has produced
output, the slot stays taken whatever happens to the client.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional, Set, Tuple

from ..db import db_session
from . import billing, caps
from . import cards as C
from . import repository as repo
from . import settings as S
from .guards import (ABUSE_REPLY, DISTRESS_REPLY, AnswerPolicy, StreamSanitizer, clean_text, framing_note,
                     is_distress, is_injection_attempt, language_of, says_unanswered, sensitive_kind,
                     split_reply, visitor_pii)
from .prompt import build_system_prompt, history_messages
from .tools import SiteContext, ToolResult, execute, offered_tools

logger = logging.getLogger(__name__)

Event = Tuple[str, Dict[str, Any]]
IN_FLIGHT_SECONDS = 90
# The whole answer (tools + model rounds) must finish inside this; the HTTP
# stream (router.py) has a slightly longer backstop of its own.
ANSWER_DEADLINE_SECONDS = 85.0

# Answers still being produced after their client went away (strong refs, so
# the loop does not garbage-collect a running task).
_RUNNING: Set["asyncio.Task[None]"] = set()
_END = object()

MESSAGES = {
    "invalid": "Please type a question (up to 1000 characters).",
    "disabled": "The assistant is not available right now.",
    "rate_limited": "You're sending messages very quickly. Please wait a few seconds and try again.",
    "daily_cap": "I can't answer more questions right now, but our team can help you. Leave your details below.",
    "no_credits": "I can't answer more questions right now, but our team can help you. Leave your details below.",
    "internal": "Sorry, something went wrong. Please try again.",
    "in_progress": "This message is already being answered.",
}


# ── the model (replaceable in tests) ─────────────────────────────────────

class _KeyResolver:
    def __init__(self, keys: tuple):
        self._keys = keys

    def resolve_keys(self, institute_id=None, user_id=None, request_model=None, **_ignored):
        return self._keys


def order_chain(models: List[str], prefer_non_reasoning: bool) -> Tuple[str, List[str]]:
    """The use-case chain, with a model that can turn reasoning OFF moved first.

    The V598 default is GLM-5.3-flash, whose endpoint refuses reasoning off
    (it runs at effort low, see chat_llm_client._REASONING_MODE); thinking
    tokens come before the first visible token, which eats the < 2 s
    first-token budget of a chat widget. With the switch on (default), the
    first non-reasoning model of the chain answers and GLM stays as the
    fallback; off = the portal's order exactly."""
    from ..services.llm_router import REASONING_MANDATORY_PREFIXES
    chain = list(dict.fromkeys(m for m in models if m))
    if prefer_non_reasoning:
        fast = [m for m in chain if not m.startswith(REASONING_MANDATORY_PREFIXES)]
        if fast and fast[0] != chain[0]:
            chain.remove(fast[0])
            chain.insert(0, fast[0])
    return chain[0], chain[1:]


def _model_chain(db) -> Tuple[str, List[str]]:
    from ..constants.model_defaults import GLM_DEFAULT
    from ..services.model_selection import resolve_models
    primary, fallbacks = resolve_models(db, S.USE_CASE, hard_fallback=S.DEFAULT_MODEL)
    return order_chain([primary, *fallbacks, GLM_DEFAULT], S.prefer_non_reasoning(db))


async def llm_stream(messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]],
                     ctx: SiteContext) -> AsyncIterator[Dict[str, Any]]:
    """Chunks {type: token|tool_calls|done} from the use-case model chain, reasoning off."""
    from ..services.api_key_resolver import ApiKeyResolver
    from ..services.chat_llm_client import ChatLLMClient
    with db_session() as db:
        keys = ApiKeyResolver(db).resolve_keys(institute_id=ctx.institute_id)
        primary, fallbacks = _model_chain(db)
        no_reasoning = S.disable_reasoning(db)
    client = ChatLLMClient(_KeyResolver(keys), disable_reasoning=no_reasoning)
    try:
        async for chunk in client.chat_completion_stream(
                messages, tools=tools, temperature=S.TEMPERATURE, max_tokens=S.MAX_ANSWER_TOKENS,
                institute_id=ctx.institute_id, model=primary, fallback_models=fallbacks):
            yield chunk
    finally:
        await client.close()


# ── helpers ───────────────────────────────────────────────────────────────

def _canned_tokens(text: str) -> List[Event]:
    return [("token", {"text": piece}) for piece in split_reply(text)]


def contact_card_for_limit(ctx: SiteContext) -> Optional[Dict[str, Any]]:
    """The contact card shown when the bot cannot answer (cap / credits)."""
    if ctx.logged_in:
        sup = ctx.settings.get("support") or {}
        return C.contact_info_card(email=sup.get("email"), phone=sup.get("phone"), whatsapp=sup.get("whatsapp"),
                                   login_url=sup.get("loginUrl"))
    from .tools import campaign_for
    consent = (ctx.settings.get("leads") or {}).get("consentText") or (
        f"By sending this you agree that {ctx.site_name or 'we'} may contact you about your enquiry.")
    return C.contact_form_card(kind="SALES", reason="so our team can answer your question",
                               campaign_id=campaign_for(ctx, "SALES"),
                               fields=[{"key": "full_name", "label": "Your name", "type": "text", "required": True},
                                       {"key": "phone", "label": "Phone", "type": "phone", "required": False},
                                       {"key": "email", "label": "Email", "type": "email", "required": False}],
                               consent_text=consent)


def _store_reply(ctx: SiteContext, content: str, *, cards: List[Dict[str, Any]], answered: Optional[bool],
                 sources: Optional[Dict[str, Any]] = None, messages: int = 1) -> int:
    with db_session() as db:
        mid = repo.add_message(db, ctx.conversation_id, "assistant", content, cards=cards or None,
                               sources=sources, answered=answered)
        repo.touch_conversation(db, ctx.conversation_id, messages=messages)
    return mid


async def _fixed_reply(ctx: SiteContext, text: str, kind: str) -> AsyncIterator[Event]:
    mid = _store_reply(ctx, text, cards=[], answered=True, sources={"items": [], "fixed": kind, "billed": False})
    for ev in _canned_tokens(text):
        yield ev
    yield ("done", {"message_id": mid, "answered": True, "billed": False})


def _replay(reply: Dict[str, Any]) -> List[Event]:
    events: List[Event] = _canned_tokens(reply.get("content") or "")
    for card in reply.get("cards") or []:
        if isinstance(card, dict):
            events.append(("card", card))
    src = reply.get("sources") if isinstance(reply.get("sources"), dict) else {}
    events.append(("done", {"message_id": reply["id"], "answered": bool(reply.get("answered", True)),
                            "billed": bool(src.get("billed")), "replayed": True}))
    return events


# ── the answer ────────────────────────────────────────────────────────────

async def answer(ctx: SiteContext, raw_text: Any, page: Dict[str, Any], client_msg_id: Any,
                 *, ip_key: Optional[str] = None,
                 deadline_seconds: Optional[float] = None) -> AsyncIterator[Event]:
    """The answer's events. The work runs in a task of its own that does not
    depend on this generator being read to the end: closing it (the visitor
    left) only stops the relaying; the answer is still finished, stored and
    charged. The deadline does stop the work, with an `internal` error."""
    queue: "asyncio.Queue[Any]" = asyncio.Queue()
    limit = ANSWER_DEADLINE_SECONDS if deadline_seconds is None else deadline_seconds

    async def drive() -> None:
        async for ev in _answer(ctx, raw_text, page, client_msg_id, ip_key=ip_key):
            queue.put_nowait(ev)

    async def produce() -> None:
        try:
            await asyncio.wait_for(drive(), timeout=limit)
        except asyncio.TimeoutError:
            logger.warning("site-assistant: answer passed the %ss deadline (conversation %s)",
                           limit, ctx.conversation_id)
            queue.put_nowait(("error", {"code": "internal", "message": MESSAGES["internal"]}))
        except Exception:  # noqa: BLE001
            logger.exception("site-assistant: answer failed (conversation %s)", ctx.conversation_id)
            queue.put_nowait(("error", {"code": "internal", "message": MESSAGES["internal"]}))
        finally:
            queue.put_nowait(_END)

    task = asyncio.get_running_loop().create_task(produce())
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)
    while True:
        ev = await queue.get()
        if ev is _END:
            return
        yield ev


async def wait_for_running(timeout: float = 5.0) -> None:
    """Let answers whose client went away finish (tests; graceful shutdown)."""
    pending = [t for t in _RUNNING if not t.done()]
    if pending:
        await asyncio.wait(pending, timeout=timeout)


async def _answer(ctx: SiteContext, raw_text: Any, page: Dict[str, Any], client_msg_id: Any,
                  *, ip_key: Optional[str] = None) -> AsyncIterator[Event]:
    text = clean_text(raw_text)
    cmid = str(client_msg_id or "").strip()[:64]
    if text is None or not cmid:
        yield ("error", {"code": "invalid", "message": MESSAGES["invalid"]})
        return
    if S.kill_switch_on() or (ctx.channel != "PREVIEW" and not ctx.settings.get("enabled")):
        yield ("error", {"code": "disabled", "message": MESSAGES["disabled"]})
        return
    if ctx.channel == "EMBED" and not (ctx.settings.get("embed") or {}).get("enabled"):
        yield ("error", {"code": "disabled", "message": MESSAGES["disabled"]})
        return

    # Idempotency + rate, under a per-conversation lock every replica respects.
    page_json = {k: v for k, v in (page or {}).items() if k in ("url", "route", "title", "course_id") and v}
    page_json["client_msg_id"] = cmid
    with db_session() as db:
        repo.advisory_lock(db, f"sa:{ctx.conversation_id}")
        found = repo.find_by_client_msg_id(db, ctx.conversation_id, cmid)
        if found and found["reply"]:
            replay = _replay(found["reply"])
            db.commit()
            for ev in replay:
                yield ev
            return
        if found:
            user_mid = found["user"]["id"]
            from datetime import datetime, timezone
            created = found["user"].get("created_at")
            try:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(str(created))).total_seconds()
            except (TypeError, ValueError):
                age = IN_FLIGHT_SECONDS + 1
            if age < IN_FLIGHT_SECONDS:
                db.commit()
                yield ("error", {"code": "invalid", "message": MESSAGES["in_progress"]})
                return
        else:
            if repo.recent_user_messages(db, ctx.conversation_id, 60) >= S.MESSAGES_PER_MINUTE:
                db.commit()
                yield ("error", {"code": "rate_limited", "message": MESSAGES["rate_limited"]})
                return
            user_mid = repo.add_message(db, ctx.conversation_id, "user", text, page=page_json)
            repo.touch_conversation(db, ctx.conversation_id, messages=1)
        hist_rows = [r for r in repo.history(db, ctx.conversation_id, S.HISTORY_MESSAGES + 1) if r["id"] != user_mid]
        db.commit()

    lang = language_of(text)
    if is_distress(text):
        async for ev in _fixed_reply(ctx, DISTRESS_REPLY.get(lang, DISTRESS_REPLY["en"]), "distress"):
            yield ev
        return
    if is_injection_attempt(text):
        async for ev in _fixed_reply(ctx, ABUSE_REPLY.get(lang, ABUSE_REPLY["en"]), "abuse"):
            yield ev
        return

    # Caps (DB reservation) and credits, before any model call.
    with db_session() as db:
        reservation = caps.reserve(
            db, visitor_key=_visitor_key(ctx), ip_key=ip_key, institute_id=ctx.institute_id, site_tag=ctx.site_tag,
            visitor_cap=S.visitor_daily_cap(db) if ctx.channel != "PREVIEW" else 10_000,
            ip_cap=S.ip_daily_cap(db) if ctx.channel != "PREVIEW" else 10_000,
            site_cap=int((ctx.settings.get("limits") or {}).get("dailyAnswers", S.SITE_DAILY_ANSWERS)),
        )
    if reservation is None:
        async for ev in _limit_reply(ctx, "daily_cap"):
            yield ev
        return
    if not billing.preflight(ctx.institute_id, channel=ctx.channel, user_id=ctx.user_id):
        with db_session() as db:
            caps.release(db, reservation)
        async for ev in _limit_reply(ctx, "no_credits"):
            yield ev
        return

    progress = {"started": False, "output": False}
    try:
        async for ev in _model_answer(ctx, text, lang, hist_rows, progress):
            yield ev
    finally:
        # The slot goes back only when the model never ran or gave nothing at all
        # (provider down, timed out before a token). Once it produced output the
        # call cost us, and handing the slot back would make every abandoned or
        # broken stream a free, uncapped model call.
        if not progress["started"] or not progress["output"]:
            with db_session() as db:
                caps.release(db, reservation)


def _visitor_key(ctx: SiteContext) -> str:
    from .tokens import hash_key
    return hash_key("v", f"{ctx.institute_id}:{ctx.user_id or ctx.visitor_id}")


async def _limit_reply(ctx: SiteContext, code: str) -> AsyncIterator[Event]:
    card = C.normalize(contact_card_for_limit(ctx))
    _store_reply(ctx, MESSAGES[code], cards=[card] if card else [], answered=None,
                 sources={"items": [], "fixed": code, "billed": False})
    if card:
        yield ("card", card)
    yield ("error", {"code": code, "message": MESSAGES[code]})


async def _model_answer(ctx: SiteContext, text: str, lang: str, hist_rows: List[Dict[str, Any]],
                        progress: Optional[Dict[str, bool]] = None) -> AsyncIterator[Event]:
    progress = progress if progress is not None else {}
    specs = offered_tools(ctx)
    tool_schemas = [s.schema() for s in specs]
    sensitive = sensitive_kind(text)
    system = build_system_prompt(site_name=ctx.site_name, persona=ctx.settings.get("persona", "warm"),
                                 channel=ctx.channel, page=ctx.page, logged_in=ctx.logged_in,
                                 tools=[s.name for s in specs], sensitive=sensitive)
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system}, *history_messages(hist_rows),
                                      {"role": "user", "content": text}]
    hosts = [h for h in (ctx.site_host,) if h]
    if ctx.hosted_base:
        from urllib.parse import urlsplit
        hosts.append(urlsplit(ctx.hosted_base).hostname or "")
    policy = AnswerPolicy(site_hosts=hosts,
                          pii=visitor_pii([text] + [r.get("content") or "" for r in hist_rows if r.get("role") == "user"]))
    sanitizer = StreamSanitizer(policy)
    shown_cards: List[Dict[str, Any]] = []
    sources: List[Dict[str, Any]] = []
    tools_used: List[str] = []
    tool_found: List[bool] = []
    prompt_tokens = completion_tokens = 0
    model_used = ""

    try:
        for round_no in range(S.MAX_TOOL_ROUNDS + 1):
            last = round_no == S.MAX_TOOL_ROUNDS
            calls: List[Dict[str, Any]] = []
            round_text = ""
            progress["started"] = True
            async for chunk in llm_stream(messages, None if last or not tool_schemas else tool_schemas, ctx):
                kind = chunk.get("type")
                if kind in ("token", "tool_calls"):
                    progress["output"] = True
                if kind == "token" and chunk.get("content"):
                    round_text += chunk["content"]
                    out = sanitizer.push(chunk["content"])
                    if out:
                        yield ("token", {"text": out})
                elif kind == "tool_calls":
                    calls = [c for c in chunk.get("tool_calls") or [] if isinstance(c, dict)][:4]
                elif kind == "done":
                    usage = chunk.get("usage") or {}
                    prompt_tokens += int(usage.get("prompt_tokens") or 0)
                    completion_tokens += int(usage.get("completion_tokens") or 0)
                    model_used = chunk.get("model") or model_used
            if not calls:
                break
            for c in calls:
                c.setdefault("type", "function")
                c["id"] = c.get("id") or f"call_{uuid.uuid4().hex[:12]}"
            messages.append({"role": "assistant", "content": round_text or None, "tool_calls": calls})
            for c in calls:
                fn = c.get("function") or {}
                name = str(fn.get("name") or "")
                result: ToolResult = await execute(name, fn.get("arguments"), ctx)
                tools_used.append(name)
                tool_found.append(result.found)
                policy.learn(result.text)
                for card in result.cards:
                    policy.learn(json.dumps(card, ensure_ascii=False))
                    if len(shown_cards) < S.MAX_CARDS_PER_ANSWER:
                        shown_cards.append(card)
                        # The card carries its own button, so the text never repeats its link.
                        policy.carded(json.dumps(card, ensure_ascii=False))
                sources.extend(result.sources)
                messages.append({"role": "tool", "tool_call_id": c["id"], "content": result.text})
                with db_session() as db:
                    repo.add_message(db, ctx.conversation_id, "tool", result.text[:8000], tool_name=name[:64],
                                     sources=result.sources or None)
    except Exception:  # noqa: BLE001
        logger.exception("site-assistant: model answer failed (conversation %s)", ctx.conversation_id)
        yield ("error", {"code": "internal", "message": MESSAGES["internal"]})
        return

    rest = sanitizer.finish()
    if rest:
        yield ("token", {"text": rest})
    answer_text = sanitizer.text
    note = framing_note(sensitive, answer_text, lang)
    if note:
        extra = ("\n\n" if answer_text else "") + note
        yield ("token", {"text": extra})
        answer_text = (answer_text + extra).strip()
    if not answer_text and not shown_cards:
        logger.warning("site-assistant: empty answer (conversation %s)", ctx.conversation_id)
        yield ("error", {"code": "internal", "message": MESSAGES["internal"]})
        return

    no_source = bool(tool_found) and not any(tool_found) and not shown_cards
    answered = not (says_unanswered(sanitizer.raw) or no_source)
    with db_session() as db:
        mid = repo.add_message(db, ctx.conversation_id, "assistant", answer_text, cards=shown_cards or None,
                               sources={"items": sources[:30], "tools": tools_used, "model": model_used,
                                        "billed": False}, answered=answered)
        repo.touch_conversation(db, ctx.conversation_id, messages=1)
    # Owner decision (2026-10-20): 1 credit per answer; an "I don't know" is not an answer.
    # It still costs us the model call, but the visitor is sent to a person and the
    # question lands in the admin's Unanswered list, so the institute is not charged.
    billed = answered and billing.charge(
        institute_id=ctx.institute_id, model=model_used, prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens, message_id=mid, conversation_id=ctx.conversation_id,
        site_tag=ctx.site_tag, channel=ctx.channel, user_id=ctx.user_id)
    if billed:
        with db_session() as db:
            repo.mark_billed(db, mid)
            repo.touch_conversation(db, ctx.conversation_id, billed=1)
    for card in shown_cards:
        yield ("card", card)
    done: Dict[str, Any] = {"message_id": mid, "answered": answered, "billed": billed}
    if ctx.channel == "PREVIEW":
        done["tools"] = tools_used
    yield ("done", done)
