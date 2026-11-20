"""One visitor turn → one reply, as a stream of SSE events (SPEC 2.2).

    open {message_id, turn}        always first
    token {text}…                  the reply as it is written (the bubble)
    sentence {n, text}…            each completed sentence, in order (speech)
    choices {options}              at most 5
    tour {tour_id}                 at most one, played after the speech
    form {kind:"contact", reason}  at most twice per session
    done {message_id, turn}        or   error {code, message}

Order of checks, cheapest first: the turn's shape → kill switch → caps (one
statement in the database) → fixed replies for distress / prompt extraction
(no model call) → the model with tools (≤ 3 tool rounds, the last round
without tools).

The reply row is created before the model runs and every completed sentence
is saved before its ``sentence`` event goes out, so the speech endpoint can
serve sentence n from any replica while the reply is still streaming, and can
only ever speak text the guide wrote.

No in-process state: turns, caps and the transcript live in the database.
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

from ..db import db_session
from ..site_assistant.guards import (AnswerPolicy, StreamSanitizer, clean_text, is_distress, is_injection_attempt,
                                     visitor_pii)
from . import caps
from . import catalog as cat
from . import repository as repo
from . import settings as S
from . import tools as T
from . import usage
from .prompt import build_system_prompt, event_line, history_messages
from .speech import SentenceSplitter, plain

logger = logging.getLogger(__name__)

Event = Tuple[str, Dict[str, Any]]
KINDS = ("start", "text", "choice", "tour_end", "contact_saved")

MESSAGES = {
    "invalid": "That message could not be read. Please try again.",
    "disabled": "The demo guide is not available right now.",
    "capped": "The guide has reached its limit for now. You can keep exploring the demo, or leave your details "
              "and our team will get in touch.",
    "internal": "Sorry, something went wrong. Please try again.",
}

DISTRESS_REPLY = {
    "en": "I'm really sorry you're going through this. I'm an AI guide for a product demo and not the right help, "
          "but please talk to someone you trust today. In India you can call Tele-MANAS on 14416, free, at any time.",
    "hi": "मुझे बहुत दुख है कि आप इससे गुज़र रहे हैं। मैं एक प्रोडक्ट डेमो की एआई गाइड हूँ और सही मदद नहीं हूँ, पर कृपया आज "
          "किसी भरोसेमंद व्यक्ति से बात करें। भारत में आप Tele-MANAS 14416 पर कभी भी मुफ़्त कॉल कर सकते हैं।",
}
REFUSAL_REPLY = {
    "en": "I can't help with that. I'm the AI guide for this demo, and I can show you the product or answer "
          "questions about it.",
    "hi": "मैं इसमें मदद नहीं कर सकती। मैं इस डेमो की एआई गाइड हूँ, आपको प्रोडक्ट दिखा सकती हूँ या उसके बारे में सवालों के "
          "जवाब दे सकती हूँ।",
    "kn": "ಇದರಲ್ಲಿ ನಾನು ಸಹಾಯ ಮಾಡಲು ಆಗುವುದಿಲ್ಲ. ನಾನು ಈ ಡೆಮೊದ ಎಐ ಗೈಡ್, ನಿಮಗೆ ಉತ್ಪನ್ನವನ್ನು ತೋರಿಸಬಲ್ಲೆ ಅಥವಾ ಅದರ ಬಗ್ಗೆ "
          "ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಬಲ್ಲೆ.",
    "fr": "Je ne peux pas vous aider pour cela. Je suis le guide IA de cette démo : je peux vous montrer le produit "
          "ou répondre à vos questions à son sujet.",
}
# Said when the model queued a tour but wrote no line of its own.
TOUR_LINE = {
    "en": "Let me show you.",
    "hi": "चलिए, मैं आपको दिखाती हूँ।",
    "kn": "ಬನ್ನಿ, ನಾನು ತೋರಿಸುತ್ತೇನೆ.",
    "fr": "Je vous montre cela.",
}
# What replaces a price the model stated without a source (guards.AnswerPolicy's own
# wording is about course pages).
_SA_PRICE_PHRASE = "the price shown on the course page"
PRICE_PHRASE = {
    "en": "a price our team can confirm",
    "hi": "वह कीमत जो हमारी टीम बता सकती है",
    "kn": "ನಮ್ಮ ತಂಡ ತಿಳಿಸಬಹುದಾದ ಬೆಲೆ",
    "fr": "un prix que notre équipe peut confirmer",
}


_EVENT_MARK_RE = re.compile(r"\[\s*event\s*\]", re.IGNORECASE)


class GuidePolicy(AnswerPolicy):
    """Site Assistant's answer post-check (no invented links or prices, no echo
    of the visitor's phone or email), with the guide's wording for a removed price."""

    def __init__(self, lang: str, **kw: Any):
        super().__init__(**kw)
        self.lang = lang

    def sanitize(self, text: str) -> str:
        return super().sanitize(text).replace(_SA_PRICE_PHRASE, PRICE_PHRASE.get(self.lang, PRICE_PHRASE["en"]))


# ── the model (replaceable in tests) ─────────────────────────────────────

class _KeyResolver:
    def __init__(self, keys: tuple):
        self._keys = keys

    def resolve_keys(self, institute_id=None, user_id=None, request_model=None, **_ignored):
        return self._keys


async def llm_stream(messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]],
                     ctx: T.TurnContext) -> AsyncIterator[Dict[str, Any]]:
    """Chunks {type: token|tool_calls|done} from the demo_guide model chain, reasoning off."""
    from ..constants.model_defaults import GLM_DEFAULT
    from ..services.api_key_resolver import ApiKeyResolver
    from ..services.chat_llm_client import ChatLLMClient
    from ..services.model_selection import resolve_models
    institute_id = ctx.product.lead_institute_id
    with db_session() as db:
        keys = ApiKeyResolver(db).resolve_keys(institute_id=institute_id)
        primary, fallbacks = resolve_models(db, S.USE_CASE, hard_fallback=S.DEFAULT_MODEL)
    chain = list(dict.fromkeys(m for m in [primary, *fallbacks, GLM_DEFAULT] if m))
    client = ChatLLMClient(_KeyResolver(keys), disable_reasoning=True)
    try:
        async for chunk in client.chat_completion_stream(
                messages, tools=tools, temperature=S.TEMPERATURE, max_tokens=S.MAX_ANSWER_TOKENS,
                institute_id=institute_id, model=chain[0], fallback_models=chain[1:]):
            yield chunk
    finally:
        await client.close()


# ── the turn ──────────────────────────────────────────────────────────────

def _user_turn(kind: str, body: Dict[str, Any], hist: List[Dict[str, Any]], catalogue: Optional[Dict[str, Any]],
               lang: str) -> Optional[Tuple[str, str, Dict[str, Any]]]:
    """(stored text, text for the model, actions) of this turn; None when it is malformed."""
    actions: Dict[str, Any] = {}
    if body.get("spoken") is True:
        actions["spoken"] = True
    if kind == "start":
        actions["model_text"] = event_line("start")
        return "", actions["model_text"], actions
    if kind == "text":
        text = clean_text(body.get("text"))
        if not text:
            return None
        # "[event]" marks what the stage reported; a visitor cannot type one.
        model_text = _EVENT_MARK_RE.sub("(event)", text)
        if model_text != text:
            actions["model_text"] = model_text
        return text, model_text, actions
    if kind == "choice":
        choice_id = " ".join(str(body.get("choice_id") or "").split())[:40]
        label = None
        for row in reversed(hist):
            offered = (row.get("actions") or {}).get("choices") if row.get("role") == "assistant" else None
            if offered:
                label = next((c.get("label") for c in offered if isinstance(c, dict) and c.get("id") == choice_id),
                             None)
                break
        label = label or clean_text(body.get("text"))
        if not label:
            return None
        label = label[:200]
        actions["choice_id"] = choice_id or None
        return label, label, actions
    if kind == "tour_end":
        tour_id = " ".join(str(body.get("tour_id") or "").split())[:80]
        if cat.tour(catalogue, tour_id) is None:
            return None
        finished = body.get("finished") is not False
        actions.update({"tour_id": tour_id, "finished": finished})
        line = event_line("tour_end", tour_title=cat.tour_title(catalogue, tour_id), finished=finished)
        actions["model_text"] = line
        return "", line, actions
    if kind == "contact_saved":
        line = event_line("contact_saved")
        actions["model_text"] = line
        return "", line, actions
    return None


async def turn(session: Dict[str, Any], product: S.Product, body: Dict[str, Any]) -> AsyncIterator[Event]:
    """The events of one turn. `session` is the row the caller's token owns."""
    sid = session["id"]
    message_id = str(uuid.uuid4())
    turns_so_far = int(session.get("turns") or 0)
    kind = str(body.get("kind") or "").strip().lower()

    def refuse(code: str, turn_no: int = turns_so_far) -> List[Event]:
        return [("open", {"message_id": message_id, "turn": turn_no}),
                ("error", {"code": code, "message": MESSAGES[code]})]

    if kind not in KINDS:
        for ev in refuse("invalid"):
            yield ev
        return
    if not S.enabled():
        for ev in refuse("disabled"):
            yield ev
        return

    lang = session.get("lang") or "en"
    asked_lang = body.get("lang")
    if isinstance(asked_lang, str) and asked_lang.strip():
        new_lang = S.clean_lang(asked_lang, default=lang)
        if new_lang != lang:
            lang = new_lang
            with db_session() as db:
                repo.set_lang(db, sid, lang)

    catalogue = await cat.load_catalog(product.catalog_url)
    if catalogue is None:
        logger.error("demo-guide: no catalogue for product %s", product.key)
        for ev in refuse("internal"):
            yield ev
        return
    with db_session() as db:
        hist = repo.history(db, sid, S.HISTORY_MESSAGES)
        forms_shown = repo.forms_shown(db, sid)
    parsed = _user_turn(kind, body, hist, catalogue, lang)
    if parsed is None:
        for ev in refuse("invalid"):
            yield ev
        return
    stored_text, model_text, user_actions = parsed

    with db_session() as db:
        turn_no = caps.take_turn(db, sid, session.get("ip_hash"))
    if turn_no is None:
        for ev in refuse("capped"):
            yield ev
        return
    yield ("open", {"message_id": message_id, "turn": turn_no})

    with db_session() as db:
        repo.add_message(db, sid, "user", kind, stored_text, actions=user_actions or None)
        if kind == "tour_end":
            repo.finish_tour(db, sid, user_actions["tour_id"], bool(user_actions["finished"]))

    reply = _Reply(sid, message_id, turn_no, lang)
    if kind == "text" and is_distress(stored_text):
        # No Kannada / French wording yet: those sessions hear the English one in the English voice.
        reply.lang = lang if lang in DISTRESS_REPLY else "en"
        for ev in reply.fixed(DISTRESS_REPLY[reply.lang], "distress"):
            yield ev
        return
    if kind == "text" and is_injection_attempt(stored_text):
        for ev in reply.fixed(REFUSAL_REPLY.get(lang, REFUSAL_REPLY["en"]), "refusal"):
            yield ev
        return

    seen = [str(t.get("id")) for t in (session.get("tours") or []) if isinstance(t, dict) and t.get("id")]
    if kind == "tour_end" and user_actions["tour_id"] not in seen:
        seen.append(user_actions["tour_id"])
    ctx = T.TurnContext(session_id=sid, product=product, lang=lang, catalogue=catalogue,
                        knowledge=await cat.load_knowledge(product.knowledge_url),
                        lead_saved=bool(session.get("lead_id")) or kind == "contact_saved",
                        forms_shown=forms_shown, tours_seen=seen)
    system = build_system_prompt(
        product_name=str(catalogue.get("product") or product.key).capitalize(), lang=lang,
        catalogue=cat.prompt_view(catalogue, lang),
        qualification=session.get("qualification") if isinstance(session.get("qualification"), dict) else {},
        tours_seen=seen, contact_saved=ctx.lead_saved, forms_left=S.MAX_FORMS_PER_SESSION - forms_shown)
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system}, *history_messages(hist),
                                      {"role": "user", "content": model_text}]
    visitor_texts = [stored_text] + [str(r.get("text") or "") for r in hist if r.get("role") == "user"]

    progress = {"output": False}
    try:
        reply.begin()
        async for ev in _model_reply(ctx, reply, messages, visitor_texts, progress):
            yield ev
    finally:
        # Also runs when the client left or the 60 s deadline cancelled the stream:
        # what was written is kept (it may already have been spoken).
        reply.save(ctx, final=False)
        if not progress["output"]:
            with db_session() as db:
                repo.give_turn_back(db, sid)


class _Reply:
    """The assistant message of one turn: its text, sentences and stored row."""

    def __init__(self, session_id: str, message_id: str, turn_no: int, lang: str):
        self.session_id, self.message_id, self.turn_no, self.lang = session_id, message_id, turn_no, lang
        self.text = ""
        self.sentences: List[str] = []
        self.splitter = SentenceSplitter()
        self.extra: Dict[str, Any] = {}
        self.saved_final = False
        self.started = False

    def _actions(self, ctx: Optional[T.TurnContext] = None) -> Dict[str, Any]:
        actions: Dict[str, Any] = {"lang": self.lang, "sentences": list(self.sentences), **self.extra}
        if ctx is not None:
            if ctx.choices:
                actions["choices"] = ctx.choices
            if ctx.tour_id:
                actions["tour"] = ctx.tour_id
            if ctx.form_reason:
                actions["form"] = {"kind": "contact", "reason": ctx.form_reason}
        return actions

    def begin(self) -> None:
        with db_session() as db:
            repo.add_message(db, self.session_id, "assistant", "reply", "", actions=self._actions(),
                             message_id=self.message_id)
        self.started = True

    def save(self, ctx: Optional[T.TurnContext], *, final: bool) -> None:
        if self.saved_final or not self.started:
            return
        with db_session() as db:
            repo.update_message(db, self.message_id, self.text.strip(), self._actions(ctx))
        self.saved_final = final

    def write(self, chunk: str, ctx: Optional[T.TurnContext] = None) -> List[Event]:
        """Events for a piece of reply text: the token, then any sentence it completed."""
        chunk = plain(chunk)
        if not chunk:
            return []
        self.text += chunk
        return [("token", {"text": chunk}), *self._sentences(self.splitter.feed(chunk), ctx)]

    def end(self, ctx: Optional[T.TurnContext] = None) -> List[Event]:
        return self._sentences(self.splitter.flush(), ctx)

    def _sentences(self, new: List[str], ctx: Optional[T.TurnContext]) -> List[Event]:
        events: List[Event] = []
        for s in new:
            self.sentences.append(s)
            events.append(("sentence", {"n": len(self.sentences) - 1, "text": s}))
        if new:
            self.save(ctx, final=False)        # stored BEFORE the events go out: speech may ask at once
        return events

    def fixed(self, text: str, why: str) -> List[Event]:
        """A reply that needs no model."""
        self.extra["fixed"] = why
        self.begin()
        events = self.write(text) + self.end()
        self.save(None, final=True)
        return events + [("done", {"message_id": self.message_id, "turn": self.turn_no})]


async def _model_reply(ctx: T.TurnContext, reply: _Reply, messages: List[Dict[str, Any]],
                       visitor_texts: List[str], progress: Dict[str, bool]) -> AsyncIterator[Event]:
    policy = GuidePolicy(ctx.lang, pii=visitor_pii(visitor_texts))
    sanitizer = StreamSanitizer(policy, max_words=S.MAX_REPLY_WORDS)
    schemas = T.schemas()
    tools_used: List[str] = []
    prompt_tokens = completion_tokens = 0
    model_used = ""
    try:
        for round_no in range(S.MAX_TOOL_ROUNDS + 1):
            last = round_no == S.MAX_TOOL_ROUNDS
            calls: List[Dict[str, Any]] = []
            round_text = ""
            async for chunk in llm_stream(messages, None if last else schemas, ctx):
                ckind = chunk.get("type")
                if ckind == "token" and chunk.get("content"):
                    progress["output"] = True
                    round_text += chunk["content"]
                    out = sanitizer.push(chunk["content"])
                    for ev in reply.write(out, ctx) if out else []:
                        yield ev
                elif ckind == "tool_calls":
                    progress["output"] = True
                    calls = (calls + [c for c in chunk.get("tool_calls") or [] if isinstance(c, dict)])[:6]
                elif ckind == "done":
                    u = chunk.get("usage") or {}
                    prompt_tokens += int(u.get("prompt_tokens") or 0)
                    completion_tokens += int(u.get("completion_tokens") or 0)
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
                result = await T.execute(name, fn.get("arguments"), ctx)
                tools_used.append(name)
                policy.learn(result)
                messages.append({"role": "tool", "tool_call_id": c["id"], "content": result})
            if round_text.strip():
                # Text written before a tool call is followed by more text: keep a space between them.
                rest = sanitizer.push(" ")
                for ev in reply.write(rest, ctx) if rest else []:
                    yield ev
    except Exception:  # noqa: BLE001
        logger.exception("demo-guide: model reply failed (session %s)", ctx.session_id)
        reply.extra["error"] = True
        yield ("error", {"code": "internal", "message": MESSAGES["internal"]})
        return
    finally:
        if prompt_tokens or completion_tokens:
            usage.record_turn(institute_id=ctx.product.lead_institute_id, model=model_used,
                              prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                              session_id=ctx.session_id, message_id=reply.message_id, product=ctx.product.key)

    rest = sanitizer.finish()
    for ev in (reply.write(rest, ctx) if rest else []) + reply.end(ctx):
        yield ev
    if not reply.text.strip() and ctx.tour_id:
        # The model queued a tour and wrote nothing: the tour still needs its one line.
        for ev in reply.write(_tour_line(ctx), ctx) + reply.end(ctx):
            yield ev
    if not reply.text.strip() and not (ctx.choices or ctx.form_reason):
        logger.warning("demo-guide: empty reply (session %s)", ctx.session_id)
        reply.extra["error"] = True
        progress["output"] = False
        yield ("error", {"code": "internal", "message": MESSAGES["internal"]})
        return

    reply.extra.update({"model": model_used, "tools": tools_used})
    reply.save(ctx, final=True)
    if ctx.choices:
        yield ("choices", {"options": ctx.choices})
    if ctx.tour_id:
        yield ("tour", {"tour_id": ctx.tour_id})
    if ctx.form_reason:
        yield ("form", {"kind": "contact", "reason": ctx.form_reason})
    yield ("done", {"message_id": reply.message_id, "turn": reply.turn_no})


def _tour_line(ctx: T.TurnContext) -> str:
    for topic in (ctx.catalogue or {}).get("topics") or []:
        if isinstance(topic, dict) and topic.get("tour") == ctx.tour_id:
            intro, intro_lang = cat.text_and_lang(topic.get("intro"), ctx.lang)
            if intro and intro_lang == ctx.lang:
                return intro
    return TOUR_LINE.get(ctx.lang, TOUR_LINE["en"])
