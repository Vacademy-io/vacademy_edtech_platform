"""HTTP surface of the Site Assistant: /ai-service/site-assistant/v1 (SPEC §4.1, §4.6).

Visitor routes are public (anonymous visitors) and authorised by the signed
session token after POST /sessions. Staff routes need a staff JWT pinned to
the clientId institute; writes need the admin role.

POST /sessions/{id}/messages answers with text/event-stream IN the response:
the stream is produced as the model writes, nothing is polled. While tools
and the model run, a `: ping` comment goes out every PING_SECONDS so proxies
and the browser keep the connection; the whole stream ends by
STREAM_DEADLINE_SECONDS with an `error` event (code `internal`) at the latest.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse

from . import admin as A
from . import engine
from . import service as svc
from . import tokens as T

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/site-assistant/v1", tags=["site-assistant"])

PING_SECONDS = 15.0
# A backstop over the engine's own ANSWER_DEADLINE_SECONDS (which also covers
# loading the site before the engine starts).
STREAM_DEADLINE_SECONDS = 90.0
PING = ": ping\n\n"


def sse(event: str, data: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


async def with_keepalive(events: AsyncIterator[str], *, ping_seconds: Optional[float] = None,
                         deadline_seconds: Optional[float] = None) -> AsyncIterator[str]:
    """Relay SSE frames, a `: ping` comment whenever nothing was sent for ping_seconds, and an
    `internal` error when the deadline passes. The pending read is never cancelled by a ping
    (asyncio.wait, not wait_for), so a slow tool or model round is not cut short."""
    ping = PING_SECONDS if ping_seconds is None else ping_seconds
    limit = STREAM_DEADLINE_SECONDS if deadline_seconds is None else deadline_seconds
    loop = asyncio.get_running_loop()
    ends_at = loop.time() + limit
    it = events.__aiter__()
    pending: Optional["asyncio.Future[str]"] = None
    try:
        while True:
            remaining = ends_at - loop.time()
            if remaining <= 0:
                yield sse("error", {"code": "internal", "message": engine.MESSAGES["internal"]})
                return
            if pending is None:
                pending = asyncio.ensure_future(it.__anext__())
            done, _ = await asyncio.wait({pending}, timeout=min(ping, remaining))
            if not done:
                if loop.time() < ends_at:
                    yield PING
                continue
            fut, pending = pending, None
            try:
                frame = fut.result()
            except StopAsyncIteration:
                return
            yield frame
    finally:
        # The visitor left or the deadline passed: stop relaying. The engine's
        # own task still finishes (and stores) an answer whose model already ran.
        if pending is not None and not pending.done():
            pending.cancel()


# ── visitor API ───────────────────────────────────────────────────────────

@router.post("/sessions", summary="Open (or resume) a chat with the site's assistant")
async def open_session(request: Request, body: Dict[str, Any] = Body(default_factory=dict)) -> Dict[str, Any]:
    return await svc.open_session(request, body if isinstance(body, dict) else {})


@router.post("/sessions/{session_id}/messages", summary="Ask; the answer streams back as SSE")
async def post_message(session_id: str, request: Request, body: Dict[str, Any] = Body(default_factory=dict),
                       authorization: Optional[str] = Header(None)) -> StreamingResponse:
    _claims, conv = svc.owned_conversation(session_id, authorization)   # 401/403 before any streaming
    body = body if isinstance(body, dict) else {}
    page = svc.clean_page(body.get("page"))
    host = svc.request_host(request)
    ip_key = T.hash_key("ip", svc.client_ip(request)) if conv["channel"] != "PREVIEW" else None

    async def stream() -> AsyncIterator[str]:
        try:
            ctx = await svc.site_context(conv, page, host=host)
        except Exception as exc:  # noqa: BLE001 - the site vanished / admin_core down
            code = "disabled" if getattr(exc, "status_code", 0) == 404 else "internal"
            yield sse("error", {"code": code, "message": engine.MESSAGES[code]})
            return
        try:
            async for name, data in engine.answer(ctx, body.get("text"), page, body.get("client_msg_id"),
                                                  ip_key=ip_key):
                yield sse(name, data)
        except Exception:  # noqa: BLE001
            logger.exception("site-assistant stream failed (session %s)", session_id)
            yield sse("error", {"code": "internal", "message": engine.MESSAGES["internal"]})

    return StreamingResponse(with_keepalive(stream()), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/sessions/{session_id}/contact", summary="Send the visitor's contact details to the institute")
async def contact(session_id: str, body: Dict[str, Any] = Body(default_factory=dict),
                  authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    return await svc.submit_contact(session_id, authorization, body if isinstance(body, dict) else {})


@router.post("/sessions/{session_id}/feedback", summary="Thumbs up / down on one answer")
async def feedback(session_id: str, body: Dict[str, Any] = Body(default_factory=dict),
                   authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    return svc.set_feedback(session_id, authorization, body if isinstance(body, dict) else {})


@router.get("/sessions/{session_id}", summary="The chat so far (for a page reload)")
async def history(session_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    return svc.get_history(session_id, authorization)


# ── staff API ─────────────────────────────────────────────────────────────

async def staff_dep(request: Request) -> svc.Staff:
    return await svc.staff_from_request(request)


@router.get("/admin/knowledge")
async def admin_list_knowledge(site_tag: Optional[str] = Query(None), kind: Optional[str] = Query(None),
                               staff: svc.Staff = Depends(staff_dep)) -> Dict[str, Any]:
    return A.list_knowledge(staff, site_tag, kind)


@router.post("/admin/knowledge")
async def admin_create_knowledge(body: Dict[str, Any] = Body(default_factory=dict),
                                 staff: svc.Staff = Depends(staff_dep)) -> Dict[str, Any]:
    return await A.create_knowledge(staff, body if isinstance(body, dict) else {})


@router.put("/admin/knowledge/{knowledge_id}")
async def admin_update_knowledge(knowledge_id: str, body: Dict[str, Any] = Body(default_factory=dict),
                                 staff: svc.Staff = Depends(staff_dep)) -> Dict[str, Any]:
    return await A.update_knowledge(staff, knowledge_id, body if isinstance(body, dict) else {})


@router.delete("/admin/knowledge/{knowledge_id}")
async def admin_delete_knowledge(knowledge_id: str, staff: svc.Staff = Depends(staff_dep)) -> Dict[str, Any]:
    return A.delete_knowledge(staff, knowledge_id)


@router.get("/admin/conversations")
async def admin_conversations(site_tag: Optional[str] = Query(None), lead: Optional[str] = Query(None),
                              page: int = Query(0, ge=0), size: int = Query(20, ge=1, le=100),
                              include_empty: bool = Query(False),
                              staff: svc.Staff = Depends(staff_dep)) -> Dict[str, Any]:
    return A.list_conversations(staff, site_tag, lead, page, size, include_empty)


@router.get("/admin/conversations/{conversation_id}")
async def admin_conversation(conversation_id: str, staff: svc.Staff = Depends(staff_dep)) -> Dict[str, Any]:
    return A.get_conversation(staff, conversation_id)


@router.get("/admin/unanswered")
async def admin_unanswered(site_tag: Optional[str] = Query(None), days: int = Query(30, ge=1, le=180),
                           staff: svc.Staff = Depends(staff_dep)) -> List[Dict[str, Any]]:
    return A.unanswered(staff, site_tag, days)


@router.get("/admin/status")
async def admin_status(site_tag: str = Query(...), staff: svc.Staff = Depends(staff_dep)) -> Dict[str, Any]:
    return await A.site_status(staff, site_tag)


@router.post("/admin/reindex")
async def admin_reindex(site_tag: str = Query(...), staff: svc.Staff = Depends(staff_dep)) -> Dict[str, Any]:
    return await A.reindex(staff, site_tag)
