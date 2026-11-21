"""Public endpoints of Tutezy Studio (services/tutor/studio.py): build a live
lesson from a topic, a PDF or a YouTube link. No login; every call carries the
kiosk or visitor code from the platform settings."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..services.tutor import demo, studio
from ..services.tutor import languages as tutor_langs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tutor/v1/studio", tags=["tutor-studio"])


def _access(db: Session, code: Optional[str]) -> tuple:
    c = studio.config(db)
    role = studio.role_for(code, c)
    if not role:
        raise HTTPException(status_code=403, detail="This page is open at the Vacademy stall. Ask the team for the link.")
    return c, role


@router.get("/config", summary="Public: what the studio page shows (needs the kiosk or visitor code)")
def studio_config(code: str = "", db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    c, role = _access(db, code)
    # The stall screen shows a QR so visitors can build one on their own phone.
    visitor_link = (f"https://learner.vacademy.io/studio?v={c['visitor_code']}"
                    if role == "kiosk" and c["visitor_code"] else None)
    return {"role": role, "minutes": c["minutes"], "event": c["event"], "visitor_link": visitor_link,
            "languages": list(tutor_langs.SUPPORTED_LANGS), **studio.stats(db)}


class StudioJobRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=64)
    kind: str = Field(default="topic", pattern="^(topic|text|youtube)$")
    text: str = Field(..., min_length=2, max_length=20000)
    name: str = Field(..., min_length=1, max_length=80)
    language: str = Field(default="en", pattern="^(en|hi|bn|kn)$")
    org: Optional[str] = Field(default=None, max_length=160)
    phone: Optional[str] = Field(default=None, max_length=32)


def _create(db: Session, request: Request, *, code: str, kind: str, text_: str, name: str, language: str,
            org: Optional[str], phone: Optional[str]) -> Dict[str, Any]:
    c, role = _access(db, code)
    iph = demo.ip_hash(demo.client_ip(request))
    reason = studio.create_allowed(db, role=role, iph=iph, c=c)
    if reason:
        raise HTTPException(status_code=429, detail=reason)
    job_id = studio.create_job(db, kind=kind, request_text=text_, language=language, source=role,
                               visitor_name=demo.sanitize_name(name), org=org, phone=phone, iph=iph)
    studio.launch(job_id)
    logger.info("studio job %s queued (%s, %s, %s)", job_id, kind, language, role)
    return {"job_id": job_id}


@router.post("/jobs", summary="Public: build a lesson from a topic, pasted text or a YouTube link")
async def studio_job(payload: StudioJobRequest, request: Request, db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    return _create(db, request, code=payload.code, kind=payload.kind, text_=payload.text, name=payload.name,
                   language=payload.language, org=payload.org, phone=payload.phone)


@router.post("/jobs/upload", summary="Public: build a lesson from a PDF")
async def studio_job_upload(request: Request, file: UploadFile = File(...), code: str = Form(...), name: str = Form(...),
                            language: str = Form("en"), org: Optional[str] = Form(None), phone: Optional[str] = Form(None),
                            db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    _access(db, code)
    if not tutor_langs.is_supported(language):
        raise HTTPException(status_code=422, detail="Unknown language")
    data = await file.read(studio.PDF_MAX_BYTES + 1)
    if len(data) > studio.PDF_MAX_BYTES:
        raise HTTPException(status_code=413, detail="That PDF is over 15 MB. Try a smaller one, or type the topic.")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail="Please choose a PDF file.")
    try:
        body = await studio.pdf_text(data)
    except Exception:  # noqa: BLE001
        logger.warning("studio pdf unreadable", exc_info=True)
        body = ""
    if len(body.strip()) < 200:
        raise HTTPException(status_code=422, detail="We could not read text in that PDF (it may be a scan). Try another PDF, or type the topic.")
    return _create(db, request, code=code, kind="pdf", text_=body[:studio.MATERIAL_MAX_CHARS], name=name[:80] or "Friend",
                   language=language, org=org, phone=phone)


@router.get("/jobs/{job_id}", summary="Public: how far a lesson build has got")
def studio_job_status(job_id: str, db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    view = studio.job_view(db, job_id)
    if not view:
        raise HTTPException(status_code=404, detail="Unknown lesson")
    return view


@router.get("/qr", summary="Public: an SVG QR code for one of our own links")
def studio_qr(u: str) -> Response:
    svg = studio.qr_svg(u)
    if not svg:
        raise HTTPException(status_code=400, detail="Unsupported link")
    return Response(content=svg, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})


__all__ = ["router"]
