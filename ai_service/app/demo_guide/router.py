"""HTTP surface of the demo guide: /ai-service/demo-guide/v1 (docs/demo-stage/SPEC.md 2.2).

Visitor routes are public and authorised by the page's Origin (a stage origin
of the product) plus, after POST /sessions, the signed session token. Staff
routes need an ADMIN JWT pinned to the product's lead institute.

POST /sessions/{id}/turns answers with text/event-stream in the response.
While tools and the model run a ``: ping`` comment goes out every 15 s, and
the stream ends within 60 s (an ``error`` event with code ``internal`` at
the latest).
"""
from __future__ import annotations

import logging
from typing import Any, AsyncIterator, Dict, Optional

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import Response, StreamingResponse

from ..site_assistant.router import sse, with_keepalive
from . import engine
from . import service as svc
from . import settings as S
from . import tokens as T

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/demo-guide/v1", tags=["demo-guide"])


def _dict(body: Any) -> Dict[str, Any]:
    return body if isinstance(body, dict) else {}


# ── visitor API ───────────────────────────────────────────────────────────

@router.post("/sessions", summary="Open a demo session with the guide")
async def open_session(request: Request, body: Dict[str, Any] = Body(default_factory=dict)) -> Dict[str, Any]:
    return await svc.open_session(request, _dict(body))


@router.post("/sessions/{session_id}/turns", summary="One turn; the reply streams back as SSE")
async def post_turn(session_id: str, request: Request, body: Dict[str, Any] = Body(default_factory=dict),
                    authorization: Optional[str] = Header(None)) -> StreamingResponse:
    owned = svc.owned_session(session_id, T.bearer(authorization))     # 401/403 before any streaming
    svc.require_origin(request, owned.product)
    body = _dict(body)

    async def stream() -> AsyncIterator[str]:
        try:
            async for name, data in engine.turn(owned.session, owned.product, body):
                yield sse(name, data)
        except Exception:  # noqa: BLE001
            logger.exception("demo-guide stream failed (session %s)", session_id)
            yield sse("error", {"code": "internal", "message": engine.MESSAGES["internal"]})

    return StreamingResponse(
        with_keepalive(stream(), ping_seconds=S.PING_SECONDS, deadline_seconds=S.TURN_DEADLINE_SECONDS),
        media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/sessions/{session_id}/speech/{message_id}/{n}", summary="Audio of one sentence the guide wrote")
async def speech(session_id: str, message_id: str, n: int, request: Request,
                 t: Optional[str] = Query(None)) -> Response:
    audio, mime = await svc.reply_speech(request, session_id, message_id, n, t)
    return Response(content=audio, media_type=mime, headers={"Cache-Control": "private, max-age=600"})


@router.get("/narration/{product}/{tour_id}/{step}", summary="Audio of a tour step's line (from the catalogue)")
async def narration(product: str, tour_id: str, step: int, request: Request,
                    lang: Optional[str] = Query(None)) -> Response:
    audio, mime, etag = await svc.narration(request, product, tour_id, step, lang)
    headers = {"Cache-Control": "public, max-age=86400", "ETag": f'"{etag}"'}
    if not audio:
        return Response(status_code=304, headers=headers)
    return Response(content=audio, media_type=mime, headers=headers)


@router.post("/sessions/{session_id}/listen", summary="Speech to text for the microphone (multipart `audio`)")
async def listen(session_id: str, request: Request, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    # The form is parsed here, not by a File(...) parameter: the token, origin, language and
    # declared size are checked first, so a caller without a session never makes us read a body.
    owned, left = svc.listen_begin(request, session_id, authorization)
    try:
        form = await request.form(max_files=1, max_fields=4)
    except Exception:  # noqa: BLE001 - not multipart / malformed
        raise svc.deny(400, "invalid", "Send the recording as multipart form data.")
    upload = form.get("audio")
    if upload is None or isinstance(upload, str):
        raise svc.deny(400, "invalid", "No audio was sent.")
    data = await upload.read(S.LISTEN_MAX_BYTES + 1)     # one byte past the limit is enough to refuse
    return await svc.listen(owned, left, data, upload.content_type)


@router.post("/sessions/{session_id}/contact", summary="Send the visitor's contact details to the team")
async def contact(session_id: str, request: Request, body: Dict[str, Any] = Body(default_factory=dict),
                  authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    return await svc.submit_contact(request, session_id, authorization, _dict(body))


# ── staff API ─────────────────────────────────────────────────────────────

@router.get("/admin/sessions", summary="Demo conversations (paged)")
async def admin_sessions(request: Request, page: int = Query(0, ge=0), size: int = Query(20, ge=1, le=100),
                         lead: Optional[bool] = Query(None)) -> Dict[str, Any]:
    return svc.admin_sessions(await svc.staff_products(request), page, size, lead)


@router.get("/admin/sessions/{session_id}", summary="One demo conversation's transcript")
async def admin_session(session_id: str, request: Request) -> Dict[str, Any]:
    return svc.admin_session(await svc.staff_products(request), session_id)
