"""Rules a call must satisfy, checked on what the caller HEARD (post-gate text),
plus one judge score for "did it listen". Every rule here is a failure we
shipped to a real lead in the week of 2026-09-08; the call id is in the comment."""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
_GREETING = re.compile(r"\b(good\s+(morning|afternoon|evening)|hello|namaste|namaskar)\b", re.I)
_PRICE = re.compile(r"(₹|rs\.?|rupees|inr)\s?\d|\b\d{3,5}\s?(per|/|a)\s?(month|mo|year|class|session)\b", re.I)
_CLOCK = re.compile(r"\b\d{1,2}(:\d{2})?\s?(am|pm)\b", re.I)
_ONLINE_PITCH = re.compile(r"\b(zoom|google meet|daily link|the link|recordings?|online sessions?)\b", re.I)
_DAILY_LINK_Q = re.compile(r"(who sends the link|send(ing|s)? (the|that|out the) link|daily link|day's link)", re.I)
_CONTENT_FREE = {"right", "okay", "ok", "hmm", "achha", "acha", "theek hai", "thik hai", "sure",
                 "alright", "i see", "got it", "understood", "great", "okay great", "fair enough",
                 "correct", "yes", "yes go ahead", "please go on", "sorry you were saying", "ji",
                 "ji boliye", "haan ji", "haan", "aap bataiye", "boliye", "bataiye", "yes?", "hmm hmm"}
_HINDI = re.compile(r"[ऀ-ॿ]|\b(aap|hai|hain|kya|main|hoon|ke|ki|ka|ji|nahi|haan|theek|bataiye|kaise)\b", re.I)


def _turns(convo: List[Dict]) -> List[Dict]:
    return [t for t in convo if t["role"] == "assistant"]


def grade(persona, convo: List[Dict], lead_name: str, now: Optional[datetime] = None) -> Dict:
    """convo: [{role, text, raw?, ended?, dropped?}] in order. Returns
    {'fails': [..], 'warns': [..]} — a fail is a hard regression."""
    fails, warns = [], []
    checks = set(persona.checks)
    bot = _turns(convo)
    spoken_all = " ".join(t["text"] for t in bot)
    now = now or datetime.now(ZoneInfo("Asia/Kolkata"))

    # ── global rules (every persona) ──────────────────────────────────────
    greetings = sum(1 for t in bot if _GREETING.search(t["text"][:40]))
    if greetings > 2:                                   # call 862aa6a0: "Good morning!" x5 (one echo is human)
        fails.append(f"re-greeted ({greetings} greeting turns)")
    if any("<" in t["text"] and ">" in t["text"] for t in bot):   # call 5a9fe35a
        fails.append("markup spoken to the caller")
    if any(t.get("had_markup") for t in bot):
        warns.append("model wrote tool-call/markup (stripped by the gate)")
    first = (lead_name or "").split()[0] if lead_name else ""
    # The opening's identity check ("is this Vijay Madhekar?") legitimately uses
    # the full name; anywhere after that it is a form being read out.
    after_opening = " ".join(t["text"] for t in bot[1:])
    if lead_name and len(lead_name.split()) > 1 and lead_name.lower() in after_opening.lower():
        fails.append(f"addressed by full name '{lead_name}'")        # call ada2e60c
    for i, t in enumerate(bot[1:], 1):                  # opening exempt
        if len(t["text"].split()) > 70:
            warns.append(f"turn {i}: monologue ({len(t['text'].split())} words)")
        if t["text"].count("?") > 2:
            warns.append(f"turn {i}: {t['text'].count('?')} questions in one turn")
    # Call 08df7128 (2026-09-12): the caller heard "Right." and then nothing —
    # every real sentence behind it was an already-said drop. What the caller
    # HEARS must carry something answerable; a bare acknowledgment is a dead turn.
    for i, t in enumerate(bot[1:], 1):
        heard = " ".join(w.strip(".,!?…") for w in t["text"].lower().split())
        if heard and heard in _CONTENT_FREE:
            fails.append(f"turn {i}: content-free reply {t['text'][:24]!r}")
            break
    seen = set()
    # A reply to the caller's "Hello?" legitimately repeats the lost question.
    _after_hello = {id(convo[i + 1]) for i, t in enumerate(convo[:-1])
                    if t["role"] == "user"
                    and re.fullmatch(r"(hello[?,.!\s]*)+", t["text"].strip().lower())}
    for t in bot:
        if id(t) in _after_hello:
            continue
        for s in re.split(r"(?<=[.?!])\s+", t["text"]):
            k = " ".join(s.split()).lower()
            if len(k.split()) >= 5:
                if k in seen:
                    fails.append(f"repeated sentence: {s[:50]!r}")
                    break
                seen.add(k)

    # ── persona checks ────────────────────────────────────────────────────
    def after(pattern) -> List[Dict]:
        """Bot turns after the first caller turn matching pattern."""
        hit = False; out = []
        for t in convo:
            if t["role"] == "user" and re.search(pattern, t["text"], re.I):
                hit = True
            elif t["role"] == "assistant" and hit:
                out.append(t)
        return out

    if "ends_when_asked" in checks:                    # ada2e60c / wrong number
        reply = after(r"cut the call|don't need|wrong number|don't call")
        if not reply:
            fails.append("caller asked to end but no bot reply followed")
        else:
            r = reply[0]
            if not r.get("ended"):
                fails.append("did not END after being asked to end")
            if "?" in r["text"]:
                fails.append("asked a question after being asked to end")
            if len(r["text"].split()) > 30:
                fails.append("long reply after being asked to end")
    if "no_online_pitch_after_offline" in checks:      # 5a9fe35a
        bad = [t for t in after(r"offline") if _ONLINE_PITCH.search(t["text"]) and "?" in t["text"]]
        if len(bad) >= 2:
            fails.append("kept asking about online links/Zoom after 'all offline'")
        elif bad:
            warns.append("one online-link question after 'all offline'")
    if "no_daily_link_question_after_permanent" in checks:   # 34f258c2
        if any(_DAILY_LINK_Q.search(t["text"]) for t in after(r"same link|one link|permanent")):
            fails.append("asked who sends the daily link after 'same link every day'")
    if "no_invented_price" in checks:
        if _PRICE.search(spoken_all):
            fails.append("stated a price")
    if "correct_weekday" in checks:
        target = (now + timedelta(days=2)).strftime("%A").lower()
        for t in after(r"day after tomorrow"):
            named = [d for d in WEEKDAYS if re.search(rf"\b{d}\b", t["text"], re.I)]
            if named and target not in named:
                fails.append(f"wrong weekday {named} for day-after-tomorrow ({target})")
    if "no_invented_time" in checks:
        if any(_CLOCK.search(t["text"]) for t in after(r"day after tomorrow")):
            fails.append("invented a clock time the caller never said")
    if "stays_hindi_after_switch" in checks:
        later = after(r"hindi")
        eng = [t for t in later if not _HINDI.search(t["text"])]
        if later and eng:
            fails.append(f"{len(eng)}/{len(later)} replies not in Hindi after the switch")
    if "clarifies_ambiguous_yes" in checks:
        # After a bare "Yes." to a two-option question the bot must not assume.
        for i, t in enumerate(convo):
            if t["role"] == "user" and t["text"].strip().lower().rstrip(".!") == "yes" and i + 1 < len(convo):
                prev = convo[i - 1]["text"] if i else ""
                nxt = convo[i + 1]["text"]
                if " or " in prev and "?" not in nxt:
                    fails.append("took a bare 'Yes' to an either/or question as an answer")
                    break
    if "short_when_busy" in checks:
        r = after(r"middle of a class|i'm busy")
        if r and len(r[0]["text"].split()) > 35:
            fails.append("long reply to a caller who is busy")
        if r and not re.search(r"call (you )?back|later|evening|when (would|is)|what time", r[0]["text"], re.I):
            fails.append("did not offer a call-back to a busy caller")
    if "accepts_no" in checks:
        hyp = [t for t in after(r"not looking|not interested|no need") if re.search(r"if you (were|ever|do)|in the future|scale up", t["text"], re.I)]
        if len(hyp) >= 2:
            fails.append("kept pushing hypotheticals after the caller said no")
    if "no_confirmation_loop" in checks:               # call 15aadcdb
        # After "It is offline." the bot restated or double-checked that answer
        # FOUR times ("It's all offline right now." / "No online classes at all
        # then?" / "So you're not running any online classes…" / "So you're only
        # doing offline classes."), each answered "Yes". One echo is tolerated
        # (the gate trims most); two is the loop.
        after = False; echoes = []
        for t in convo:
            if t["role"] == "user" and "offline" in t["text"].lower():
                after = True
                continue
            if after and t["role"] == "assistant":
                for sent in re.split(r"(?<=[.?!])\s+", t["text"]):
                    w = sent.lower()
                    if re.search(r"\b(offline|online)\b", w) and len(w.split()) <= 12 and (
                            w.rstrip().endswith("?") or re.match(r"^(so|okay|ok|alright|right|it'?s)\b", w)):
                        echoes.append(sent.strip())
        if len(echoes) >= 2:
            # A FAIL since 2026-09-15: the text sim now runs the same next-step
            # path production does (sim/gates.py next_step → bot.next_step_cue),
            # so a loop here is a loop on the phone (call 71e8f39b).
            fails.append(f"restated/double-checked the caller's answer {len(echoes)}x: {echoes[:3]}")
    if "no_restatement_only_turns" in checks:           # call 71e8f39b
        # A turn that is nothing but the caller's answer said back — no
        # question, no fact — is dead air with words. One is tolerated; two
        # in a call is the loop the founder heard five times.
        only = [t["text"] for t in bot[1:]
                if t["text"] and "?" not in t["text"] and len(t["text"].split()) <= 12
                and re.match(r"^(so|okay|ok|alright|right|got it|you|you're|you are|it'?s)\b", t["text"].strip().lower())]
        if len(only) >= 2:
            fails.append(f"restatement-only turns {len(only)}x: {only[:3]}")
        steps = sum(1 for t in convo if t.get("next_step"))
        if steps >= 2 and any(t.get("next_step") for t in convo[-3:]):
            warns.append(f"next-step budget exhausted ({steps}) — the model kept restating")
    if "answers_who" in checks:                         # calls 91d1541e/b2f6330a
        for i, t in enumerate(convo):
            if t["role"] == "user" and re.search(r"who is this|who are you|name of your|which company", t["text"], re.I):
                nxt = next((x for x in convo[i + 1:] if x["role"] == "assistant" and x["text"]), None)
                if nxt is None:
                    continue
                first = re.split(r"(?<=[.!?])\s+", nxt["text"].strip())[0]
                if not re.search(r"aarushi|vacademy|shreya|shiksha", first, re.I):
                    fails.append(f"asked who is calling; first sentence did not answer: {first[:70]!r}")
    if "reasks_after_hello" in checks:                 # call f08f5712
        # After a caller "Hello?" the bot must put its question back on the line,
        # not just confirm it is there.
        for i, t in enumerate(convo):
            if t["role"] == "user" and re.fullmatch(r"(hello[?,.!\s]*)+", t["text"].strip().lower()):
                nxt = next((x for x in convo[i + 1:] if x["role"] == "assistant"), None)
                if nxt is not None and "?" not in nxt["text"]:
                    fails.append(f"after the caller's 'Hello?' the bot did not re-ask: {nxt['text'][:60]!r}")
                    break
    if "one_question_per_turn" in checks:
        if any(t["text"].count("?") > 1 for t in bot[1:]):
            warns.append("more than one question in a turn")
    return {"fails": fails, "warns": warns}


JUDGE_PROMPT = """You are reviewing ONE phone sales call transcript between an AI counsellor (Aarushi, Vacademy) and a yoga teacher. Judge the AGENT only.
Score 0-10 for LISTENING: does each agent reply respond to what the caller just said, adapt the pitch to the caller's actual situation, avoid repeating itself, keep replies short and natural, and end gracefully when the caller wants to?
Return JSON only: {"score": <0-10>, "problems": ["<short, specific, quote the turn>", ...]}

Transcript:
"""


async def judge(chat, convo: List[Dict]) -> Dict:
    lines = "\n".join(f"{'CALLER' if t['role']=='user' else 'AGENT'}: {t['text']}" for t in convo)
    msgs = [{"role": "user", "content": JUDGE_PROMPT + lines}]
    text, _ = await chat("You are a strict but fair call-quality reviewer.", msgs, 400, 0.0)
    if not re.search(r'"score"\s*:\s*\d', text or ""):
        # Gemini occasionally returns prose or nothing (~1 in 8 runs); one nudge.
        msgs += [{"role": "assistant", "content": text or "(empty)"},
                 {"role": "user", "content": "Return ONLY the JSON object {\"score\": <0-10>, \"problems\": [...]}."}]
        text, _ = await chat("You are a strict but fair call-quality reviewer.", msgs, 400, 0.0)
    m = re.search(r"\{.*\}", text, re.S)
    try:
        d = json.loads(m.group(0)) if m else {}
        return {"score": int(d.get("score", -1)), "problems": [str(p) for p in (d.get("problems") or [])][:5]}
    except Exception:
        sc = re.search(r'"score"\s*:\s*(\d+)', text)
        probs = re.findall(r'"((?:[^"\\]|\\.){12,})"', text)
        return {"score": int(sc.group(1)) if sc else -1,
                "problems": [p for p in probs if "score" not in p][:5] or [f"judge output unparseable: {text[:80]!r}"]}
