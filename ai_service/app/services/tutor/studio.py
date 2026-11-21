"""Tutezy Studio: a live lesson from any topic, PDF or video, in under a minute.

Built for the exhibition stall (DIDAC India 2026): a visitor names a topic or
hands over a PDF / YouTube link on the kiosk, and about forty seconds later
the AI teacher is teaching it on the screen. Each request is a JOB:

  QUEUED → WRITING (short lesson notes, with a safety check) → BUILDING (the
  ordinary plan compiler, images off) → READY | REJECTED | FAILED

A ready job is an UNLISTED demo topic (tutor_demo_topic, sort_order ≥ 1000),
so the lesson itself runs on the public-demo path unchanged: guest token,
unbilled minutes, and the same link works later on the visitor's own phone.

Access needs a code (platform settings): the kiosk code has no per-device
limit; the visitor code (printed in the QR) is limited per IP. Both share a
daily cap and a concurrency cap, so a public URL cannot spend freely.
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import re
import time
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...db import db_session
from ...models.ai_token_usage import RequestType
from ..ai_billing import UC, record_llm_billing
from ..platform_settings_service import get_platform_setting
from . import demo
from . import languages as tutor_langs

logger = logging.getLogger(__name__)

KEY_PREFIX = "studio-"
SORT_ORDER = 2000                 # ≥ demo.UNLISTED_SORT_ORDER: never in the public picker
MAX_CONCURRENT_JOBS = 6
STALE_AFTER_SECONDS = 240
MATERIAL_MAX_CHARS = 9000
PDF_MAX_BYTES = 15 * 1024 * 1024
KINDS = ("topic", "text", "youtube", "pdf")
ACTIVE = ("QUEUED", "WRITING", "BUILDING")

_ENSURE = [
    """
    CREATE TABLE IF NOT EXISTS tutor_studio_job (
        id            VARCHAR(36) PRIMARY KEY,
        topic_key     VARCHAR(64),
        kind          VARCHAR(16) NOT NULL,
        title         VARCHAR(200),
        request_text  TEXT,
        language      VARCHAR(8) NOT NULL DEFAULT 'en',
        source        VARCHAR(16) NOT NULL DEFAULT 'kiosk',
        visitor_name  VARCHAR(80),
        org           VARCHAR(160),
        phone         VARCHAR(32),
        status        VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
        error         VARCHAR(300),
        ip_hash       VARCHAR(64),
        seconds       NUMERIC(8,1),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        ready_at      TIMESTAMPTZ
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_tutor_studio_job_created ON tutor_studio_job(created_at)",
]


def ensure_tutor_studio_schema(db: Session) -> None:
    try:
        for stmt in _ENSURE:
            db.execute(text(stmt))
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("ensure_tutor_studio_schema failed: %s", exc)


# ── configuration and access ─────────────────────────────────────────────────

def config(db: Optional[Session] = None) -> Dict[str, Any]:
    def g(key: str, default: Any) -> Any:
        try:
            v = get_platform_setting(key, default=default, db=db)
            return default if v in (None, "") else v
        except Exception:  # noqa: BLE001
            return default
    return {
        "enabled": str(g("tutor.studio.enabled", "false")).lower() in ("1", "true", "yes", "on"),
        "kiosk_code": str(g("tutor.studio.kiosk_code", "")).strip(),
        "visitor_code": str(g("tutor.studio.visitor_code", "")).strip(),
        "daily_cap": max(0, int(float(g("tutor.studio.daily_cap", 800)))),
        "visitor_per_ip": max(0, int(float(g("tutor.studio.visitor_per_ip", 3)))),
        "minutes": max(1, min(10, int(float(g("tutor.studio.minutes", 5))))),
        "model": str(g("tutor.studio.model", "")).strip() or None,
        "event": str(g("tutor.studio.event", "")).strip(),
    }


def _same(a: str, b: str) -> bool:
    return bool(a) and bool(b) and hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def role_for(code: Optional[str], c: Dict[str, Any]) -> Optional[str]:
    """"kiosk" | "visitor" | None for the code a client presented."""
    code = (code or "").strip()
    if not c.get("enabled") or not code:
        return None
    if _same(code, c.get("kiosk_code") or ""):
        return "kiosk"
    if _same(code, c.get("visitor_code") or ""):
        return "visitor"
    return None


def create_allowed(db: Session, *, role: str, iph: str, c: Dict[str, Any]) -> Optional[str]:
    """None when a new lesson may be built; otherwise the visitor-facing reason."""
    busy = db.execute(text("SELECT count(*) FROM tutor_studio_job WHERE status IN ('QUEUED','WRITING','BUILDING') "
                           "AND created_at > now() - make_interval(secs => :s)"), {"s": STALE_AFTER_SECONDS}).scalar() or 0
    if int(busy) >= MAX_CONCURRENT_JOBS:
        return "Several lessons are being built right now. Try again in half a minute."
    if c["daily_cap"]:
        n = db.execute(text("SELECT count(*) FROM tutor_studio_job WHERE created_at > now() - interval '1 day'")).scalar() or 0
        if int(n) >= c["daily_cap"]:
            return "Today's lessons are all made. Ask the team at the stall for a full demo."
    if role == "visitor" and c["visitor_per_ip"]:
        n = db.execute(text("SELECT count(*) FROM tutor_studio_job WHERE ip_hash = :h AND source = 'visitor' "
                            "AND created_at > now() - interval '1 day'"), {"h": iph}).scalar() or 0
        if int(n) >= c["visitor_per_ip"]:
            return "You have made your free lessons for today. Book a demo and we will build one on your own syllabus."
    return None


# ── jobs ─────────────────────────────────────────────────────────────────────

_PHONE = re.compile(r"[^\d+]")


def clean_phone(raw: Optional[str]) -> Optional[str]:
    p = _PHONE.sub("", raw or "")[:16]
    return p if len(p.lstrip("+")) >= 8 else None


def create_job(db: Session, *, kind: str, request_text: str, language: str, source: str, visitor_name: str,
               org: Optional[str], phone: Optional[str], iph: str) -> str:
    job_id = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO tutor_studio_job (id, kind, request_text, language, source, visitor_name, org, phone, ip_hash)
        VALUES (:id, :k, :r, :l, :s, :n, :o, :p, :h)
    """), {"id": job_id, "k": kind, "r": (request_text or "")[:20000], "l": tutor_langs.normalize(language), "s": source,
           "n": (visitor_name or "")[:80], "o": (org or "").strip()[:160] or None, "p": clean_phone(phone), "h": iph})
    db.commit()
    return job_id


def _update(job_id: str, **cols: Any) -> None:
    sets = ", ".join(f"{k} = :{k}" for k in cols)
    try:
        with db_session() as db:
            db.execute(text(f"UPDATE tutor_studio_job SET {sets} WHERE id = :id"), {**cols, "id": job_id})
            db.commit()
    except Exception:  # noqa: BLE001
        logger.warning("studio job %s update failed", job_id, exc_info=True)


_JOB_COLS = ("id", "topic_key", "kind", "title", "language", "status", "error", "seconds", "created_at")


def job_view(db: Session, job_id: str) -> Optional[Dict[str, Any]]:
    r = db.execute(text("SELECT " + ", ".join(_JOB_COLS) + ", extract(epoch from (now() - created_at)) "
                        "FROM tutor_studio_job WHERE id = :id"), {"id": job_id}).first()
    if not r:
        return None
    d = dict(zip(_JOB_COLS, r))
    age = float(r[len(_JOB_COLS)] or 0)
    if d["status"] in ACTIVE and age > STALE_AFTER_SECONDS:
        # The pod that was building it went away (a deploy): say so instead of spinning for ever.
        d["status"], d["error"] = "FAILED", "That took too long. Please try once more."
        _update(job_id, status="FAILED", error=d["error"])
    return {"id": d["id"], "status": d["status"], "kind": d["kind"], "title": d["title"], "language": d["language"],
            "topic_key": d["topic_key"] if d["status"] == "READY" else None, "error": d["error"],
            "seconds": float(d["seconds"]) if d["seconds"] is not None else None, "elapsed": round(age, 1)}


def stats(db: Session, *, limit: int = 8) -> Dict[str, Any]:
    """The stall counter and the "just made" ticker (titles are model-written
    from accepted requests, never a visitor's raw words)."""
    made = db.execute(text("SELECT count(*) FROM tutor_studio_job WHERE status = 'READY'")).scalar() or 0
    avg = db.execute(text("SELECT avg(seconds) FROM tutor_studio_job WHERE status = 'READY' AND seconds IS NOT NULL")).scalar()
    rows = db.execute(text("SELECT title, kind, language FROM tutor_studio_job WHERE status = 'READY' AND title IS NOT NULL "
                           "ORDER BY ready_at DESC LIMIT :n"), {"n": limit}).fetchall()
    return {"made": int(made), "avg_seconds": round(float(avg), 0) if avg is not None else None,
            "recent": [{"title": r[0], "kind": r[1], "language": r[2]} for r in rows]}


# ── the lesson notes (one fast model call, with the safety check) ────────────

REJECT = "REJECT:"

NOTES_SYSTEM = """You prepare the source notes for ONE short live whiteboard lesson (about four minutes) that an AI teacher \
will teach one-to-one, on a big screen at a public education exhibition.

FIRST decide whether to accept. Reply with exactly `REJECT: <one polite sentence>` and nothing else when the request is \
not something a teacher would teach in front of families and school leaders: sexual or abusive content, hate, instructions \
for harm or crime, an attack on a real person, party-political campaigning, or text with no teachable meaning. Anything a \
school, college, coaching class, skills trainer or company trainer could teach is welcome, at any level.

Otherwise reply with plain text only, 900 to 1,400 characters, in exactly this shape:
# <lesson title, at most 60 characters, no quotes>
Emoji: <one emoji that fits>
Audience: <who this is for, one line>. Goal: <what they can do after four minutes, one line>.
## <idea 1 heading>
<2-3 factual sentences with one concrete example, number or picture a teacher could draw>
Check: <one short question the learner answers aloud> (Expected: <the answer>)
## <idea 2 heading>
...
## <idea 3 heading>
...

Rules: exactly three ideas, each with a Check. Facts must be correct, standard and uncontroversial; when unsure, leave \
the detail out. Write the notes in English whatever language the request is in. No preamble and no closing line."""

GROUNDED_RULE = ("Build the lesson ONLY from the material below: choose its single most important idea and teach that. "
                 "Do not add facts the material does not contain. If the material has no teachable content, REJECT.")


def notes_messages(kind: str, request_text: str) -> List[Dict[str, str]]:
    if kind == "topic":
        user = f"The visitor asked to learn: {request_text.strip()[:300]}"
    else:
        what = {"pdf": "a PDF", "youtube": "a video's captions", "text": "pasted notes"}.get(kind, "material")
        user = f"{GROUNDED_RULE}\n\nMATERIAL (from {what}):\n{request_text.strip()[:MATERIAL_MAX_CHARS]}"
    return [{"role": "system", "content": NOTES_SYSTEM}, {"role": "user", "content": user}]


_TITLE = re.compile(r"^#\s+(.+)$", re.MULTILINE)
_EMOJI = re.compile(r"^Emoji:\s*(\S+)\s*$", re.MULTILINE)


def parse_notes(raw: str) -> Dict[str, Any]:
    """{"reject": reason} or {"title", "emoji", "source"} from the model's reply."""
    body = (raw or "").strip()
    if not body:
        return {"reject": "We could not plan a lesson from that. Try another topic."}
    if body.upper().startswith(REJECT):
        return {"reject": body[len(REJECT):].strip()[:200] or "Let's pick a classroom topic instead."}
    m = _TITLE.search(body)
    if not m or body.count("## ") < 2 or "Check:" not in body:
        return {"reject": "We could not plan a lesson from that. Try another topic."}
    title = m.group(1).strip().strip('"').strip()[:80]
    e = _EMOJI.search(body)
    emoji = (e.group(1) if e else "✨")[:8]
    source = _EMOJI.sub("", body, count=1).strip()
    return {"title": title, "emoji": emoji, "source": source}


async def write_notes(kind: str, request_text: str, *, institute_id: str, model: Optional[str], job_id: str) -> Dict[str, Any]:
    from ..api_key_resolver import ApiKeyResolver
    from ..chat_llm_client import ChatLLMClient
    from .plan_compiler import _FixedKeys
    with db_session() as db:
        keys = ApiKeyResolver(db).resolve_keys(institute_id, None, request_model=model, platform_default_key="chatbot.text.model")
    client = ChatLLMClient(_FixedKeys(keys), platform_model_key="chatbot.text.model")
    resp = await client.chat_completion(notes_messages(kind, request_text), temperature=0.4, max_tokens=800,
                                        institute_id=institute_id, user_id=None, model=model)
    u = resp.get("usage") or {}
    pt, ct = int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)
    if pt + ct:
        record_llm_billing(request_type=RequestType.CONTENT, model=resp.get("model") or model or "default",
                           prompt_tokens=pt, completion_tokens=ct, total_tokens=pt + ct, institute_id=institute_id,
                           user_id=None, request_id=job_id, metadata={"tool": "tutor_studio_notes", "kind": kind},
                           use_case=UC.TUTOR_SETUP, usage_context={"feature": "tutor_studio", "job_id": job_id})
    return parse_notes(resp.get("content") or "")


# ── material ─────────────────────────────────────────────────────────────────

async def pdf_text(data: bytes) -> str:
    """The text layer of a PDF (no OCR: a scan has none)."""
    from ..kb import parsing
    extracted = await asyncio.to_thread(parsing._extract_sync, data, False)
    return "\n\n".join((p.text or "").strip() for p in extracted.pages if (p.text or "").strip())


async def youtube_text(url: str) -> str:
    from ..kb.parsing import youtube_video_id
    from ..youtube_captions import service as yt_service
    vid = youtube_video_id(url)
    if not vid:
        raise ValueError("That does not look like a YouTube link.")
    result = await yt_service.require_captions(vid, purpose="tutor")
    return (result.text or "").strip()


# ── the build ────────────────────────────────────────────────────────────────

_TASKS: set = set()


def launch(job_id: str) -> None:
    """Run the job on this process's loop; the row carries the status, so any pod can answer the poll."""
    task = asyncio.get_running_loop().create_task(run_job(job_id))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


async def run_job(job_id: str) -> None:
    t0 = time.time()
    try:
        with db_session() as db:
            r = db.execute(text("SELECT kind, request_text, language FROM tutor_studio_job WHERE id = :id"), {"id": job_id}).first()
            c, d = config(db), demo.config(db)
        if not r:
            return
        kind, request_text, lang = r[0], r[1] or "", tutor_langs.normalize(r[2])
        institute_id = d["institute_id"]
        if not institute_id:
            raise RuntimeError("demo institute is not configured")
        _update(job_id, status="WRITING")
        if kind == "youtube":
            try:
                request_text = await youtube_text(request_text)
            except ValueError as e:
                _update(job_id, status="REJECTED", error=str(e)[:300] or "We could not read that video's captions.")
                return
        if kind != "topic" and len(request_text.strip()) < 200:
            _update(job_id, status="REJECTED", error="There is not enough text in that to build a lesson. Try a text PDF or type a topic.")
            return
        notes = await write_notes(kind, request_text, institute_id=institute_id, model=c["model"], job_id=job_id)
        if notes.get("reject"):
            _update(job_id, status="REJECTED", error=notes["reject"])
            return
        key = KEY_PREFIX + uuid.uuid4().hex[:12]
        with db_session() as db:
            demo.upsert_topic(db, key=key, title=notes["title"], source_text=notes["source"], emoji=notes["emoji"],
                              language=lang, sort_order=SORT_ORDER, is_active=True, style="lesson")
        _update(job_id, status="BUILDING", title=notes["title"])
        result, settings = await _compile(key, lang, institute_id=institute_id, model=c["model"], teacher=d.get("teacher_name"))
        if result.get("type") != "PLAN_READY":
            raise RuntimeError(str(result.get("error") or result.get("type") or "compile failed")[:200])
        _update(job_id, status="READY", topic_key=key, seconds=round(time.time() - t0, 1), ready_at=_now())
        logger.info("studio job %s ready in %.1fs (%s, %s, key %s)", job_id, time.time() - t0, kind, lang, key)
        _warm_voice(result.get("plan_id"), demo.slide_id_for(key), lang, institute_id, settings)
    except Exception as exc:  # noqa: BLE001
        logger.exception("studio job %s failed: %s", job_id, exc)
        _update(job_id, status="FAILED", error="We could not build that lesson. Please try once more.")


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)


async def _compile(key: str, lang: str, *, institute_id: str, model: Optional[str], teacher: Optional[str]):
    from .plan_compiler import PlanCompiler
    from .runtime.settings import resolve_settings
    with db_session() as db:
        s = resolve_settings(db, package_id="", institute_id=institute_id)
    compiler = PlanCompiler(institute_id=institute_id, user_id=None, language=lang, teacher_name=teacher or s.teacher_name,
                            force=True, generate_images=False, model_override=model or s.compile_model, voice_prepare=None)
    return await compiler.compile_slide(demo.slide_id_for(key)), s


def _warm_voice(plan_id: Optional[str], slide_id: str, lang: str, institute_id: str, settings: Any) -> None:
    """Prepare the teacher's lines while the lesson is opening, so the later
    lines play from the cache (and the take-home link plays instantly)."""
    if not plan_id or not getattr(settings, "tts_provider", None):
        return
    try:
        from .voice_cache import warm_plan
        task = asyncio.get_running_loop().create_task(warm_plan(
            plan_id=plan_id, slide_id=slide_id, institute_id=institute_id, user_id=None,
            provider=settings.tts_provider, voice=settings.tts_voice or "", base_pace=float(settings.voice_pace or 1.0),
            languages=[lang], course_lang=lang))
        _TASKS.add(task)
        task.add_done_callback(_TASKS.discard)
    except Exception:  # noqa: BLE001
        logger.warning("studio voice warm-up not started", exc_info=True)


# ── QR codes for the big screen ──────────────────────────────────────────────

QR_HOSTS = ("learner.vacademy.io", "vacademy.io", "www.vacademy.io", "tutezy.ai", "www.tutezy.ai")


def qr_svg(url: str) -> Optional[str]:
    """An SVG QR code for one of our own links (never an open QR service)."""
    from urllib.parse import urlparse
    try:
        p = urlparse(url)
    except ValueError:
        return None
    if p.scheme != "https" or (p.hostname or "") not in QR_HOSTS or len(url) > 400:
        return None
    import io
    import segno
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", scale=8, border=2, dark="#000000", light="#ffffff", xmldecl=False)
    return buf.getvalue().decode("utf-8")
