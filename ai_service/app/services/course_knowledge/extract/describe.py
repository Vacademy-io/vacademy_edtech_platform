"""describe_slides: what a lesson publishes, read in one short pass (spec §6.4).

Runs inside the caller's short session and does no network I/O: one batched
read of the slide rows, then one per lesson type (plus the question tables).

Only PUBLISHED columns are read. An UNSYNC lesson (published, edited since)
keeps serving its published content (SlideService.java:797-809), and an
empty published column means nothing is published yet: unlike
tutor/slide_source.py there is NO fallback to the draft column.

Documents are classified by document_slide.type FIRST and only then by
whether the body is a file id; slide_source.py tests the UUID first and so
sends PRESENTATION (an Excalidraw file id) down the PDF path.

content_hash covers the extractor version, the lesson type, title,
description and the published pointer or inline text. slide.updated_at is
never used: Slide.java maps it insertable=false/updatable=false and no
trigger maintains it.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...kb.parsing import youtube_video_id
from ...tutor.slide_source import _hash, html_to_text
from . import documents, questions
from .types import EXTRACTOR_VERSION, SCORM_EXTRACTOR_VERSION, Segment, SlideRef

logger = logging.getLogger(__name__)

_UUID_RE = re.compile(r"^[0-9a-fA-F-]{32,36}$")
_YOUTUBE_RE = re.compile(r"(youtube\.com|youtu\.be)", re.IGNORECASE)

EXTERNAL_VIDEO_NOTE = "External video link: the AI cannot read it. Add a description or upload the video"
EXTERNAL_AUDIO_NOTE = "External audio link: the AI cannot read it. Add a transcript or upload the audio"
ASSESSMENT_NOTE = "Assessments are never read by the AI"

INLINE_DOC_TYPES = ("HTML", "DOC", "DOCX")

_SLIDES_SQL = text("""
    SELECT id, title, description, status, source_type, source_id
      FROM slide
     WHERE id = ANY(:ids)
""")
_DOCS_SQL = text("SELECT id, type, published_data FROM document_slide WHERE id = ANY(:ids)")
_VIDEOS_SQL = text("""
    SELECT id, published_url, published_video_length, source_type, description, embedded_type, embedded_data
      FROM video
     WHERE id = ANY(:ids)
""")
_AUDIO_SQL = text("""
    SELECT id, published_audio_file_id, published_audio_length_in_millis, transcript, source_type, external_url
      FROM audio_slide
     WHERE id = ANY(:ids)
""")
_HTML_VIDEO_SQL = text("SELECT id, ai_gen_video_id, video_length FROM html_video_slide WHERE id = ANY(:ids)")
_SCORM_SQL = text("SELECT id, launch_url, launch_path, original_file_id FROM scorm_slide WHERE id = ANY(:ids)")


def _is_uuid(value: Optional[str]) -> bool:
    return bool(value) and bool(_UUID_RE.match(value.strip()))


def _plain(value: Optional[str]) -> str:
    raw = (value or "").strip()
    if "<" in raw and ">" in raw:
        return html_to_text(raw)
    return raw


def _int(value: Any) -> Optional[int]:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _rows(db: Session, sql, ids: Iterable[str]) -> Dict[str, tuple]:
    ids = sorted({i for i in ids if i})
    if not ids:
        return {}
    return {r[0]: tuple(r) for r in db.execute(sql, {"ids": ids}).fetchall()}


def content_hash(ref: SlideRef) -> str:
    """Changes when the published body, pointer, title or description changes."""
    inline = [s.text for s in ref.inline_segments]
    published: Dict[str, Any] = {"pointer": [ref.pointer_kind, ref.pointer_key], "inline": inline}
    for key in ("url", "launch_url", "launch_path", "video_description", "note", "extractor"):
        if ref.extras.get(key):
            published[key] = ref.extras[key]
    return _hash(EXTRACTOR_VERSION, ref.source_type, ref.doc_type, ref.title, ref.description, published)


# ── per-type classification ──────────────────────────────────────────────────

def _document(ref: SlideRef, row: Optional[tuple]) -> None:
    if row is None:
        return
    dtype = (row[1] or "").strip().upper()
    body = (row[2] or "").strip()
    ref.doc_type = dtype or None
    if not body:
        return                                   # nothing published yet
    if dtype == "PDF":
        ref.pointer_kind, ref.pointer_key = "file", body
        ref.extras["text_kind"] = "pdf"
    elif dtype in INLINE_DOC_TYPES:
        if _is_uuid(body):
            # An uploaded Word/PDF file: pdf.py reads it when it is a PDF.
            ref.pointer_kind, ref.pointer_key = "file", body
            ref.extras["text_kind"] = "pdf"
        else:
            ref.pointer_kind = "inline"
            ref.inline_segments = documents.html_segments(body)
            ref.extras["text_kind"] = "document"
    elif dtype == "PRESENTATION":
        ref.extras["text_kind"] = "drawing"
        if body.startswith("{"):
            # Older drawings keep the scene JSON inline.
            try:
                scene = json.loads(body)
            except Exception:  # noqa: BLE001
                scene = None
            ref.pointer_kind = "inline"
            ref.inline_segments = documents.drawing_segments(scene)
        else:
            ref.pointer_kind, ref.pointer_key = "file", body
    elif dtype == "PPT_ANIM":
        ref.pointer_kind, ref.pointer_key = "deck", body
        ref.extras["text_kind"] = "deck"
    elif dtype == "CODE":
        ref.pointer_kind = "inline"
        ref.inline_segments = documents.code_segments(body)
        ref.extras["text_kind"] = "code"
    elif dtype in ("JUPYTER", "SCRATCH"):
        ref.pointer_kind = "none"
        ref.inline_segments = documents.project_segments(body, dtype)
        ref.extras["note"] = documents.EXTERNAL_PROJECT_NOTE
        ref.extras["text_kind"] = "lesson"
    elif _is_uuid(body):
        ref.pointer_kind, ref.pointer_key = "file", body
        ref.extras["text_kind"] = "pdf"
    elif "<" in body:
        ref.pointer_kind = "inline"
        ref.inline_segments = documents.html_segments(body)
        ref.extras["text_kind"] = "document"


def _video(ref: SlideRef, row: Optional[tuple], vq: Dict[str, List[Segment]]) -> None:
    if row is None:
        return
    vid, url, length, _src_type, vdesc, emb_type, emb_data = row
    url = (url or "").strip()
    ref.length_ms = _int(length)
    vdesc = _plain(vdesc)
    if vdesc:
        ref.extras["video_description"] = vdesc
    inline: List[Segment] = list(vq.get(vid, []))
    if (emb_type or "").strip().upper() == "CODE":
        inline.extend(documents.code_segments(emb_data))
    ref.inline_segments = inline
    if not url:
        return
    if _is_uuid(url):
        ref.pointer_kind, ref.pointer_key = "file", url
        ref.extras["text_kind"] = "transcript"
    elif _YOUTUBE_RE.search(url) and youtube_video_id(url):
        ref.pointer_kind, ref.pointer_key = "youtube", youtube_video_id(url)
        ref.extras["url"] = url
        ref.extras["text_kind"] = "captions"
    else:
        ref.pointer_kind = "none"
        ref.extras["url"] = url
        ref.extras["note"] = EXTERNAL_VIDEO_NOTE


def _audio(ref: SlideRef, row: Optional[tuple]) -> None:
    if row is None:
        return
    _id, file_id, length, transcript, src_type, external_url = row
    ref.length_ms = _int(length)
    body = _plain(transcript)
    file_id = (file_id or "").strip()
    if body:
        ref.pointer_kind = "inline"
        ref.inline_segments = [Segment(text=body, anchor="none", label="Transcript")]
        ref.extras["text_kind"] = "transcript"
    elif file_id and (src_type or "FILE").strip().upper() != "URL":
        ref.pointer_kind, ref.pointer_key = "file", file_id
        ref.extras["text_kind"] = "transcript"
    elif (external_url or "").strip():
        ref.pointer_kind = "none"
        ref.extras["url"] = external_url.strip()
        ref.extras["note"] = EXTERNAL_AUDIO_NOTE


def _html_video(ref: SlideRef, row: Optional[tuple]) -> None:
    if row is None:
        return
    ref.length_ms = _int(row[2])
    if (row[1] or "").strip():
        ref.pointer_kind, ref.pointer_key = "ai_video", row[1].strip()
        ref.extras["text_kind"] = "script"


def _scorm(ref: SlideRef, row: Optional[tuple]) -> None:
    if row is None:
        return
    _id, launch_url, launch_path, original_file_id = row
    launch_url = (launch_url or "").strip()
    if not launch_url:
        return
    ref.pointer_kind = "scorm"
    ref.pointer_key = (original_file_id or "").strip() or launch_url
    ref.extras["launch_url"] = launch_url
    if (launch_path or "").strip():
        ref.extras["launch_path"] = launch_path.strip()
    ref.extras["text_kind"] = "scorm"
    ref.extras["extractor"] = f"scorm-v{SCORM_EXTRACTOR_VERSION}"


def _inline(ref: SlideRef, segs: List[Segment], text_kind: str) -> None:
    ref.pointer_kind = "inline"
    ref.inline_segments = segs
    ref.extras["text_kind"] = text_kind


# ── entry point ──────────────────────────────────────────────────────────────

def describe_slides(db: Session, slide_ids: Sequence[str]) -> List[SlideRef]:
    """SlideRefs for the given lessons, in input order (unknown ids are skipped)."""
    wanted = [s for s in dict.fromkeys(slide_ids or []) if s]
    if not wanted:
        return []
    slides = _rows(db, _SLIDES_SQL, wanted)
    by_type: Dict[str, List[str]] = {}
    for row in slides.values():
        st, sid = (row[4] or "").strip().upper(), (row[5] or "").strip()
        if sid:
            by_type.setdefault(st, []).append(sid)

    docs = _rows(db, _DOCS_SQL, by_type.get("DOCUMENT", []))
    videos = _rows(db, _VIDEOS_SQL, by_type.get("VIDEO", []))
    audios = _rows(db, _AUDIO_SQL, by_type.get("AUDIO", []))
    html_videos = _rows(db, _HTML_VIDEO_SQL, by_type.get("HTML_VIDEO", []))
    scorms = _rows(db, _SCORM_SQL, by_type.get("SCORM", []))
    quiz = questions.quiz_segments(db, sorted(set(by_type.get("QUIZ", []))))
    single = questions.question_segments(db, sorted(set(by_type.get("QUESTION", []))))
    assignments = questions.assignment_segments(db, sorted(set(by_type.get("ASSIGNMENT", []))))
    video_qs = questions.video_question_segments(db, sorted(videos))

    out: List[SlideRef] = []
    for slide_id in wanted:
        row = slides.get(slide_id)
        if row is None:
            continue
        st = (row[4] or "").strip().upper()
        sid = (row[5] or "").strip()
        ref = SlideRef(
            slide_id=slide_id, title=(row[1] or "").strip(), description=_plain(row[2]),
            status=(row[3] or "").strip().upper(), source_type=st, doc_type=None,
            pointer_kind="none", pointer_key=None,
        )
        try:
            if st == "DOCUMENT":
                _document(ref, docs.get(sid))
            elif st == "VIDEO":
                _video(ref, videos.get(sid), video_qs)
            elif st == "AUDIO":
                _audio(ref, audios.get(sid))
            elif st == "HTML_VIDEO":
                _html_video(ref, html_videos.get(sid))
            elif st == "SCORM":
                _scorm(ref, scorms.get(sid))
            elif st == "QUIZ":
                _inline(ref, quiz.get(sid, []), "questions")
            elif st == "QUESTION":
                _inline(ref, single.get(sid, []), "questions")
            elif st == "ASSIGNMENT":
                _inline(ref, assignments.get(sid, []), "questions")
            elif st == "ASSESSMENT":
                ref.learner_indexable = False
                ref.extras["note"] = ASSESSMENT_NOTE
        except Exception:  # noqa: BLE001 - a malformed body must not hide the rest of the batch
            logger.warning("course knowledge: could not describe slide %s (%s)", slide_id, st, exc_info=True)
            ref.pointer_kind, ref.pointer_key, ref.inline_segments = "none", None, []
        ref.content_hash = content_hash(ref)
        out.append(ref)
    return out


__all__ = ["describe_slides", "content_hash", "EXTERNAL_VIDEO_NOTE", "EXTERNAL_AUDIO_NOTE", "ASSESSMENT_NOTE"]
