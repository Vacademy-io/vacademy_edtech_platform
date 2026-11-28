"""
Personal starters for the learner chatbot: what to ask, built from what matters
to this learner right now.

In Sep-Oct 2026 about 560 first messages were unfinished quick-action text
("quiz me on", "help me learn about") or a bare "hi": the empty chat did not
tell learners what it could do. Starters are complete requests, so one tap gets
a real answer, and they change with the page and the learner's day (a class at
7:30, a daily task closing at 8, the lesson they left yesterday, a test on
Saturday).

Every source is optional and time-boxed; a slow or failing source is skipped.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable, Dict, List, Optional

from .learner_tools import (
    IST,
    _f,
    _parse_when,
    _UPCOMING_LIVE_SQL,
    _MY_COURSES_SQL,
    _assessment_get,
    engagement_snapshot,
    summarize_engagement,
    when_label,
)

logger = logging.getLogger(__name__)

SOURCE_TIMEOUT_S = 2.5
MAX_STARTERS = 4


def _t(hindi: bool, en: str, hi: str) -> str:
    return hi if hindi else en


def _clip(text: str, n: int) -> str:
    """Shorten at a word boundary with an ellipsis."""
    text = " ".join(str(text or "").split())
    if len(text) <= n:
        return text
    cut = text[: n - 1].rsplit(" ", 1)[0].rstrip(" -|·,")
    return (cut or text[: n - 1]) + "…"


async def _timed(name: str, fn: Callable[[], Awaitable[Any]]) -> Any:
    try:
        return await asyncio.wait_for(fn(), timeout=SOURCE_TIMEOUT_S)
    except Exception as e:  # noqa: BLE001 — a starter source must never break the chat
        logger.info(f"starters: {name} skipped ({type(e).__name__})")
        return None


async def build_starters(
    db_factory: Callable,
    user_id: str,
    institute_id: str,
    context_type: Optional[str],
    context_meta: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    meta = context_meta or {}
    hindi = str(meta.get("ui_language") or "").lower().startswith("hi")
    now = datetime.now(IST)
    params = {"user_id": user_id, "institute_id": institute_id}

    def _query(sql) -> Callable[[], Awaitable[Any]]:
        async def run():
            def go():
                with db_factory() as db:
                    return [dict(r) for r in db.execute(sql, params).mappings().all()]
            return await asyncio.to_thread(go)
        return run

    async def tests():
        return await _assessment_get("/assessments", [("userId", user_id), ("instituteId", institute_id)])

    async def tasks():
        return await engagement_snapshot(user_id, institute_id)

    live_rows, course_rows, test_data, snapshot = await asyncio.gather(
        _timed("live", _query(_UPCOMING_LIVE_SQL)),
        _timed("courses", _query(_MY_COURSES_SQL)),
        _timed("tests", tests),
        _timed("tasks", tasks),
    )

    starters: List[Dict[str, Any]] = []
    peek: Optional[Dict[str, Any]] = None

    def add(icon: str, label: str, sublabel: str, prompt: str):
        if len(starters) < MAX_STARTERS and all(s["prompt"] != prompt for s in starters):
            starters.append({"icon": icon, "label": label, "sublabel": sublabel, "prompt": prompt})

    # 1. On a lesson: help with exactly this page first.
    lesson = str(meta.get("name") or "").strip()
    if context_type == "slide" and lesson:
        add("explain", _t(hindi, "Explain this lesson simply", "इस लेसन को आसान भाषा में समझाइए"), _clip(lesson, 60),
            _t(hindi, f"Explain \"{lesson}\" in simple terms", f"\"{lesson}\" को आसान भाषा में समझाइए"))
        add("quiz", _t(hindi, "Quiz me on this lesson", "इस लेसन पर मेरा क्विज़ लीजिए"),
            _t(hindi, "5 quick questions", "5 छोटे सवाल"),
            _t(hindi, f"Quiz me on \"{lesson}\" with 5 questions", f"\"{lesson}\" पर 5 सवालों का क्विज़ लीजिए"))
    elif context_type == "course_details" and lesson:
        add("course", _t(hindi, "What will I learn here?", "इसमें मैं क्या सीखूँगा?"), _clip(lesson, 60),
            _t(hindi, f"Give me an overview of \"{lesson}\"", f"\"{lesson}\" का ओवरव्यू दीजिए"))

    # 2. A live class that is on now or later today.
    for row in live_rows or []:
        start = _parse_when(row.get("start_at")) if isinstance(row.get("start_at"), str) else row.get("start_at")
        start_ist = start.astimezone(IST) if start else None
        if not start_ist or start_ist.date() != now.date():
            continue
        title = " ".join(str(row.get("title") or "Live class").split())
        if row.get("joinable_now") or row.get("live_now"):
            add("live", _t(hindi, "Your class is live now", "आपकी क्लास अभी लाइव है"), _clip(title, 60),
                _t(hindi, "My live class is on now. How do I join?", "मेरी लाइव क्लास अभी चल रही है, कैसे जॉइन करूँ?"))
            peek = peek or {"text": _t(hindi, f"{_clip(title, 40)} is live now", f"{_clip(title, 40)} अभी लाइव है"),
                            "prompt": starters[-1]["prompt"]}
        else:
            add("live", _t(hindi, f"Class at {when_label(start, now).replace('today ', '')}",
                           f"{when_label(start, now).replace('today ', '')} बजे क्लास"), _clip(title, 60),
                _t(hindi, "When is my next live class and how do I join?", "मेरी अगली लाइव क्लास कब है और कैसे जॉइन करूँ?"))
            if start_ist - now <= timedelta(hours=1):
                peek = peek or {"text": _t(hindi, f"Class in {int((start_ist - now).total_seconds() // 60)} min. Warm up with 3 questions?",
                                           f"{int((start_ist - now).total_seconds() // 60)} मिनट में क्लास है। 3 सवालों से वॉर्म-अप करें?"),
                                "prompt": _t(hindi, f"Give me 3 quick warm-up questions before my {title} class",
                                             f"मेरी {title} क्लास से पहले 3 छोटे वॉर्म-अप सवाल दीजिए")}
        break

    # 3. Daily tasks from the institute's engagement plan.
    if snapshot:
        _lines, task_items, counts = summarize_engagement(snapshot, now)
        points = snapshot.get("points") or {}
        streak = points.get("currentStreak") or points.get("current_streak") or 0
        kept = points.get("keptToday") if "keptToday" in points else points.get("kept_today")
        left = counts["scheduled"] - counts["completed"]
        if left > 0 and counts["open"]:
            first = next((i for i in task_items if i.get("badge") == "To do"), None)
            add("task", _t(hindi, f"{left} daily task{'s' if left > 1 else ''} left today", f"आज {left} डेली टास्क बाकी"),
                (first or {}).get("subtitle", "")[:60],
                _t(hindi, "What are my daily tasks today? Help me with the next one",
                   "आज मेरे डेली टास्क क्या हैं? अगले वाले में मदद कीजिए"))
            if streak and not kept:
                peek = peek or {"text": _t(hindi, f"Keep your {streak}-day streak: {left} task{'s' if left > 1 else ''} left today",
                                           f"अपनी {streak} दिन की स्ट्रीक बचाइए: आज {left} टास्क बाकी"),
                                "prompt": starters[-1]["prompt"]}

    # 4. The lesson to continue.
    resume = next((r for r in course_rows or [] if r.get("kind") == "RESUME"), None)
    start_row = next((r for r in course_rows or [] if r.get("kind") == "START"), None)
    if resume:
        add("resume", _t(hindi, f"Continue \"{_clip(resume.get('slide_title'), 40)}\"", f"\"{_clip(resume.get('slide_title'), 40)}\" जारी रखें"),
            f"{_clip(resume.get('package_name'), 40)} · {round(float(resume.get('percent') or 0))}%",
            _t(hindi, "Where did I leave off? Help me continue", "मैंने कहाँ छोड़ा था? आगे बढ़ने में मदद कीजिए"))
    elif start_row:
        add("resume", _t(hindi, "Start your course", "अपना कोर्स शुरू करें"), _clip(start_row.get("package_name"), 60),
            _t(hindi, "Which lesson should I start with?", "मुझे किस लेसन से शुरू करना चाहिए?"))

    # 5. A test in the next three days, or one open now.
    if test_data:
        soonest = None
        for key in ("live", "upcoming"):
            for t in test_data.get(key) or []:
                begins = _parse_when(_f(t, "bound_start_time"))
                ends = _parse_when(_f(t, "bound_end_time"))
                if key == "upcoming" and begins and begins - now.astimezone(begins.tzinfo) > timedelta(days=3):
                    continue
                if key == "live" and ends and ends.year >= 9000:
                    continue  # open indefinitely: not urgent
                soonest = soonest or (key, t, begins, ends)
        if soonest:
            key, t, begins, ends = soonest
            name = _clip(_f(t, "name") or "your test", 50)
            when = when_label(ends if key == "live" else begins, now)
            add("test", _t(hindi, f"Practise for {name}", f"{name} की तैयारी करें"),
                (_t(hindi, f"closes {when}", f"{when} तक") if key == "live" else _t(hindi, f"opens {when}", f"{when} से")),
                _t(hindi, f"Quiz me to prepare for my test \"{name}\"", f"मेरे टेस्ट \"{name}\" की तैयारी के लिए क्विज़ लीजिए"))

    # 6. Always-useful fallbacks so there are never fewer than four.
    add("plan", _t(hindi, "What should I study today?", "आज मुझे क्या पढ़ना चाहिए?"),
        _t(hindi, "A plan from your courses and tasks", "आपके कोर्स और टास्क से प्लान"),
        _t(hindi, "What should I study today?", "आज मुझे क्या पढ़ना चाहिए?"))
    add("results", _t(hindi, "How am I doing?", "मेरी तैयारी कैसी है?"),
        _t(hindi, "Strengths and what to fix", "ताकत और कमज़ोरियाँ"),
        _t(hindi, "What are my strengths and weaknesses?", "मेरी ताकत और कमज़ोरियाँ क्या हैं?"))
    add("doubt", _t(hindi, "Clear a doubt", "डाउट पूछें"),
        _t(hindi, "Type or send a photo of the question", "सवाल लिखें या फोटो भेजें"),
        _t(hindi, "I have a doubt. Can you help me?", "मेरा एक डाउट है, मदद करेंगे?"))

    examples = (
        ["sector ka area simple language mein samjhao", "मेरी अगली क्लास कब है?", "Quiz me on photosynthesis"]
        if hindi else
        ["Explain sector area like I'm 12", "When is my next class?", "sector ka area Hinglish mein samjhao"]
    )
    return {"starters": starters, "peek": peek, "try_saying": examples}


__all__ = ["build_starters"]
