"""What preparing slides will cost, before any credit is spent (design §4.8).

Per slide: whether it is up to date, needs details, or will be compiled;
the compile credits; the transcription minutes and credits for an uploaded
video without a cached transcript; OCR pages for a scanned PDF and OCR slides
for a SCORM package whose slides are drawn as images (from what an earlier
free pass cached; never a download here); the image cap when images are on. Prices
come from the estimator, so super-admin overrides in ai_tool_pricing show up
here exactly as they will be charged.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..tool_cost_estimator import ToolCostEstimator
from . import plan_store, source_text
from .slide_source import load_slide_source, source_kind_label

MAX_IMAGES_PER_SLIDE = 4          # plan_compiler.MAX_GENERATED_IMAGES_PER_SLIDE
# When a video's length is unknown, budget this many minutes for the estimate.
ASSUMED_VIDEO_MINUTES = 10

KIND_LABEL = {"document": "Document", "pdf": "PDF", "quiz": "Quiz", "ai_video": "AI video", "youtube": "YouTube video",
              "video_upload": "Uploaded video", "video_link": "Video link", "scorm": "SCORM package",
              "other": "Not supported"}


def _credits(est: ToolCostEstimator, tool_key: str, params: Dict[str, Any]) -> float:
    try:
        return float(est.estimate(tool_key, params).get("estimated_credits") or 0)
    except Exception:  # noqa: BLE001
        return 0.0


def estimate_compile(
    db: Session, *, institute_id: str, slide_ids: List[str], language: str, generate_images: bool,
    transcribe_videos: bool, force: bool, ocr_pdfs: bool = True,
    voice_provider: Optional[str] = None, languages: Optional[List[str]] = None,
) -> Dict[str, Any]:
    est = ToolCostEstimator(db)
    compile_price = _credits(est, "tutor_compile_slide", {})
    image_price = _credits(est, "tutor_media_image", {})
    per_minute = _credits(est, "transcription", {"audio_minutes": 100}) / 100.0
    transcription_min = _credits(est, "transcription", {"audio_minutes": 1})
    ocr_per_page = _credits(est, source_text.OCR_TOOL, {"num_pages": 100}) / 100.0
    voice_price = _credits(est, "tutor_voice_prepare", {})
    # Prepared voice: charged per slide per language, once, unless the voice is the free engine.
    voice_langs = 0 if (voice_provider or "sarvam") == "edge" else max(1, len([x for x in (languages or ["en"]) if x in ("en", "hi")]))
    can_transcribe = transcribe_videos and source_text.transcription_available()
    can_ocr = ocr_pdfs and source_text.ocr_available()
    can_ocr_scorm = ocr_pdfs and source_text.scorm_ocr_available()
    newest = plan_store.latest_plans_for_slides(db, slide_ids)

    rows: List[Dict[str, Any]] = []
    for sid in dict.fromkeys(slide_ids):
        src = load_slide_source(db, sid)
        if src is None:
            rows.append({"slide_id": sid, "title": None, "kind": "other", "action": "unpublished", "compile": 0,
                         "transcription": 0, "minutes": 0, "ocr": 0, "pages": 0, "voice": 0, "images_max": 0, "total": 0, "note": "Not published"})
            continue
        kind = source_kind_label(src)
        existing = newest.get(sid)
        description = ((existing.source_description if existing else None) or src.video_description or "").strip()
        row: Dict[str, Any] = {"slide_id": sid, "title": src.title, "kind": kind, "compile": 0.0, "transcription": 0.0,
                               "minutes": 0, "ocr": 0.0, "pages": 0, "voice": 0.0, "images_max": 0, "total": 0.0, "note": None, "text": None}
        if kind == "other":
            row["action"] = "unsupported"
            rows.append(row); continue
        if kind == "quiz":
            row["action"] = "skip" if not src.questions else "free"
            row["note"] = "This quiz has no questions" if not src.questions else "Quizzes prepare for free"
            rows.append(row); continue

        scorm = source_text.scorm_cached(src) if kind == "scorm" else None
        expected = source_text.expected_text_kind(src)
        if kind == "scorm" and scorm is not None and (scorm["paid"] or (scorm["ocr_units"] and can_ocr_scorm)):
            expected = source_text.SCORM_OCR_TEXT
        h = source_text.hash_for(src, expected) if expected else src.content_hash
        up_to_date = (existing is not None and existing.status == "READY" and existing.content_hash == h
                      and existing.language == language and not force)
        if up_to_date:
            row["action"] = "up_to_date"
            rows.append(row); continue

        row["compile"] = compile_price
        row["text"] = expected
        if kind == "video_upload":
            cached = bool(src.media_file_id) and source_text.transcript_cached(db, src.media_file_id or "")
            if cached:
                row["note"] = "Transcript already available"
            elif can_transcribe:
                minutes = source_text.transcription_minutes(src.video_length_ms) or ASSUMED_VIDEO_MINUTES
                row["minutes"] = minutes
                row["transcription"] = _credits(est, "transcription", {"audio_minutes": minutes})
                wait = int((source_text.expected_transcription_seconds(src.video_length_ms) or 0) / 60)
                in_flight = bool(src.media_file_id) and source_text.pending_transcription_job(db, src.media_file_id or "")
                fast = source_text.transcription_provider() == "openrouter"
                if in_flight and not fast:
                    row["note"] = "Transcription already running; this prepare picks it up"
                elif not src.video_length_ms:
                    row["note"] = "Speech-to-text, length unknown (assumed %d min)" % ASSUMED_VIDEO_MINUTES
                elif fast:
                    row["note"] = "Speech-to-text of the recording (a few minutes)"
                elif source_text.transcription_wait_budget(src.video_length_ms) == 0:
                    row["note"] = f"Long recording: transcription takes about {wait} min, so it is prepared in two steps (start now, prepare again later)"
                else:
                    row["note"] = f"Speech-to-text of the recording (about {max(1, wait)} min)"
            elif description:
                row["text"] = None
                row["note"] = "Prepared from the description"
            else:
                row["action"] = "needs_details"
                row["compile"] = 0.0
                row["note"] = "Needs a description (or turn on transcription)"
                rows.append(row); continue
        elif kind == "pdf":
            probe = source_text.pdf_probe(db, src.media_file_id or "") if src.media_file_id else None
            scanned = bool(probe) and int(probe.get("text_chars") or 0) == 0
            if scanned and can_ocr:
                pages = int(probe.get("scanned_pages") or probe.get("pages") or 0)
                row["pages"] = pages
                row["ocr"] = _credits(est, source_text.OCR_TOOL, {"num_pages": pages}) if pages else 0.0
                row["note"] = f"Scanned PDF: OCR of {pages} page(s)"
            elif scanned and not description:
                row["action"] = "needs_details"; row["compile"] = 0.0; row["text"] = None
                row["note"] = "Scanned PDF: turn on OCR or add what it teaches"
                rows.append(row); continue
            elif scanned:
                row["text"] = None; row["note"] = "Scanned PDF, prepared from the description"
            else:
                row["note"] = "PDF text (free)" if probe else "PDF text (free; a scanned PDF is read with OCR per page)"
        elif kind == "scorm":
            units = int(scorm["ocr_units"]) if scorm else 0
            if scorm is None:
                row["note"] = "SCORM package text (free; slides drawn as images are read with OCR per slide)"
            elif scorm["paid"]:
                row["note"] = "Slide text already read (free)"
            elif units and can_ocr_scorm:
                row["pages"] = units
                row["ocr"] = _credits(est, source_text.OCR_TOOL, {"num_pages": units})
                row["note"] = f"Slides are images: OCR of {units} slide(s)"
            elif not scorm["has_text"] and not description:
                row["action"] = "needs_details"; row["compile"] = 0.0; row["text"] = None
                row["note"] = ("Slides are images: turn on OCR or add what it teaches" if units
                               else "This package has no readable text: add what it teaches")
                rows.append(row); continue
            elif not scorm["has_text"]:
                row["text"] = None; row["note"] = "Prepared from the description"
            elif units:
                row["note"] = f"Package text (free); {units} image slide(s) skipped with OCR off"
            else:
                row["note"] = "SCORM package text (free)"
        elif kind in ("youtube", "ai_video"):
            row["note"] = {"youtube": "Captions (free)", "ai_video": "Narration script (free)"}[kind]
        elif kind == "video_link":
            if not description:
                row["action"] = "needs_details"; row["compile"] = 0.0; row["text"] = None
                row["note"] = "Needs a description of what the video teaches"
                rows.append(row); continue
            row["text"] = None; row["note"] = "Prepared from the description"
        if generate_images and kind == "document":
            row["images_max"] = MAX_IMAGES_PER_SLIDE
        row["action"] = "compile"
        row["voice"] = round(voice_price * voice_langs, 2)
        row["total"] = round(row["compile"] + row["transcription"] + row["ocr"] + row["voice"], 2)
        rows.append(row)

    required = round(sum(r["total"] for r in rows), 2)
    images_max = sum(int(r["images_max"]) for r in rows)
    balance: Optional[float] = None
    try:
        b = est.estimate_with_balance("tutor_compile_slide", {}, institute_id).get("current_balance")
        balance = float(b) if b is not None else None
    except Exception:  # noqa: BLE001
        balance = None
    return {
        "slides": rows,
        "totals": {
            "to_compile": sum(1 for r in rows if r["action"] == "compile"),
            "up_to_date": sum(1 for r in rows if r["action"] == "up_to_date"),
            "needs_details": sum(1 for r in rows if r["action"] == "needs_details"),
            "free": sum(1 for r in rows if r["action"] == "free"),
            "compile_credits": round(sum(r["compile"] for r in rows), 2),
            "transcription_credits": round(sum(r["transcription"] for r in rows), 2),
            "transcription_minutes": sum(int(r["minutes"]) for r in rows),
            "ocr_credits": round(sum(float(r.get("ocr") or 0) for r in rows), 2),
            "ocr_pages": sum(int(r.get("pages") or 0) for r in rows),
            "voice_credits": round(sum(float(r.get("voice") or 0) for r in rows), 2),
            "voice_languages": voice_langs,
            "images_max": images_max,
            "images_max_credits": round(images_max * image_price, 2),
            "required": required,
            "worst_case": round(required + images_max * image_price, 2),
        },
        "prices": {"compile_slide": compile_price, "image": image_price, "transcription_per_minute": round(per_minute, 3),
                   "transcription_minimum": transcription_min, "ocr_per_page": round(ocr_per_page, 3),
                   "voice_prepare_per_slide_language": voice_price},
        "balance": balance,
        "sufficient": None if balance is None else balance >= required,
        "transcription_available": source_text.transcription_available(),
        "ocr_available": source_text.ocr_available(),
    }
