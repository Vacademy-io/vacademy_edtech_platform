"""Every failed call the voice bot makes to an outside vendor, kept briefly for admin-core.

The voice bot has no database. admin-core polls /voice-bot-service/health every 30 s; the
health body carries `vendorFailures`, the most recent failures here, and admin-core copies
each one (once, by its id) into external_api_call_log, where the platform portal lists every
failed vendor call. Without this, Sarvam's "Credits exhausted", a Smallest 401 or an LLM 429
on a live call left no record outside the pod log.

What is caught:
- every aiohttp request (Sarvam/Smallest/Navana REST, and the sessions pipecat services open,
  including websocket handshakes) that answers >= 400 or fails to connect: a trace hook added
  to every ClientSession;
- every httpx request (the OpenAI-compatible LLM clients) that answers >= 400 or raises;
- every error a pipecat vendor service raises during a call (Sarvam, Smallest, Navana, Rumik,
  Deepgram, Google, Bedrock, the OpenAI-compatible LLMs, Edge): a websocket refused or closed
  mid-call, a gRPC or SDK error, a vendor error message. Whatever the transport, these reach
  the pipeline as an ErrorFrame, and the hook on FrameProcessor.push_frame sees each one once;
- failures outside a call or outside HTTP (Sarvam/Navana key refusals, Rumik and Smallest
  previews over websockets), recorded by the code that sees them through `record()`.

Only host, method, the first two path segments, status and a short reason are kept: never a
header, query string, body or key. Our own hosts are skipped. Nothing here can fail a call.
"""
from __future__ import annotations

import collections
import ipaddress
import itertools
import json
import logging
import re
import threading
import time
import uuid
from typing import Any, Deque, Dict, List, Optional
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

MAX_KEPT = 200
OWN_SUFFIXES = (".vacademy.io", ".svc", ".svc.cluster.local", ".internal", ".local")

_lock = threading.Lock()
_kept: Deque[Dict[str, Any]] = collections.deque(maxlen=MAX_KEPT)
_seq = itertools.count(1)
_boot = uuid.uuid4().hex[:8]
_installed = False


def _external(host: str) -> bool:
    host = (host or "").strip().lower().rstrip(".")
    if not host or host == "localhost" or "." not in host:
        return False  # a bare name is a cluster service
    if host == "vacademy.io" or host.endswith(OWN_SUFFIXES):
        return False
    try:
        ip = ipaddress.ip_address(host)
        return not (ip.is_private or ip.is_loopback or ip.is_link_local)
    except ValueError:
        return True


# The integrated vendors' domains. Only these are recorded: anything else is not a third-party
# API we integrated. Same list as ai_service/app/services/integrated_vendors.py, admin_core's
# IntegratedVendors.java and the portal's src/lib/integrated-vendors.ts.
INTEGRATED_DOMAINS = (
    "openrouter.ai", "api.isoquant.ai", "api.anthropic.com", "api.openai.com",
    "generativelanguage.googleapis.com", "aiplatform.googleapis.com", "api.parallel.ai",
    "api.sarvam.ai", "smallest.ai", "navana.ai", "rumik.ai", "deepgram.com",
    "texttospeech.googleapis.com", "speech.googleapis.com", "speech.platform.bing.com",
    "fal.run", "fal.ai", "fal.media", "runpod.ai", "runpod.io", "spatius.ai", "api.mathpix.com",
    "api.docconverter.pro", "cloudconvert.com", "google.serper.dev", "api.pexels.com", "pixabay.com",
    "www.googleapis.com", "oauth2.googleapis.com", "meet.googleapis.com", "workspaceevents.googleapis.com",
    "api.plivo.com", "exotel.com", "exotel.in", "api.vonage.com", "api.nexmo.com", "aavtaar.ai",
    "api.razorpay.com", "api.cashfree.com", "sandbox.cashfree.com", "api.stripe.com", "api.phonepe.com",
    "api-preprod.phonepe.com", "api.paypal.com", "api-m.paypal.com", "api.sandbox.paypal.com",
    "api-m.sandbox.paypal.com", "ewaypayments.com", "wati.io", "graph.facebook.com", "api.zoom.us",
    "zoom.us", "zohoapis.in", "zohoapis.com", "zoho.in", "api.cloudflare.com", "open.er-api.com",
)


def integrated(host: str) -> bool:
    h = (host or "").strip().lower().rstrip(".")
    return bool(h) and any(h == d or h.endswith("." + d) for d in INTEGRATED_DOMAINS)


MAX_BODY_CHARS = 4000
MAX_STRING_CHARS = 500
_SECRET_KEY = re.compile(r"(?i)(api[_-]?key|key|token|secret|password|passwd|authorization|auth|signature|"
                         r"otp|phone|mobile|msisdn|email|card|cvv)")


def _redact(value: Any, depth: int = 0) -> Any:
    if depth > 8:
        return "…"
    if isinstance(value, dict):
        return {k: ("<hidden>" if _SECRET_KEY.search(str(k)) else _redact(v, depth + 1)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v, depth + 1) for v in value[:50]]
    if isinstance(value, str):
        v = clean_reason(value) if len(value) < 2000 else value[:MAX_STRING_CHARS]
        return v[:MAX_STRING_CHARS]
    return value


def body_summary(raw: Any) -> Optional[Any]:
    """A body that is safe to keep: JSON with secrets and personal fields hidden and long
    strings cut, or the first part of plain text. None when empty."""
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        if not raw:
            return None
        try:
            raw = bytes(raw).decode("utf-8")
        except UnicodeDecodeError:
            return {"binary_bytes": len(raw)}
    text = str(raw).strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except ValueError:
        return {"text": clean_reason(text[:MAX_BODY_CHARS])}
    redacted = _redact(parsed)
    dumped = json.dumps(redacted, default=str)
    return redacted if len(dumped) <= MAX_BODY_CHARS else {"truncated_json": dumped[:MAX_BODY_CHARS]}


def _operation(method: str, path: str) -> str:
    segments = [s for s in (path or "").split("/") if s][:2]
    return f"{(method or 'GET').upper()} /{'/'.join(segments)}"[:64]


def record(vendor: str, operation: str, *, http_status: Optional[int] = None,
           reason: Optional[str] = None, from_pipeline: bool = False,
           request: Optional[Dict[str, Any]] = None, response: Optional[Dict[str, Any]] = None) -> None:
    """Keep one failure. `vendor` is the host ("api.sarvam.ai"); `reason` must hold no secret.

    A pipeline error right after an HTTP failure to the same vendor is the same failure seen
    twice (the service reports the HTTP error it got), so it is not kept again."""
    try:
        family = _family(vendor)
        now = time.monotonic()
        if from_pipeline:
            if now - _last_http.get(family, -1e9) < _DEDUPE_SECONDS:
                return
        elif http_status is not None or reason:
            _last_http[family] = now
        entry = {
            # Unique across restarts: admin-core keys its insert on this id.
            "id": f"vb-{_boot}-{next(_seq)}",
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "vendor": (vendor or "unknown")[:255],
            "operation": (operation or "call")[:64],
            "httpStatus": http_status,
            "reason": (reason or "")[:300] or None,
            # What we sent and what came back, cleaned, for whoever debugs the failure.
            "request": request,
            "response": response if response is not None else ({"error": (reason or "")[:300]} if reason else None),
        }
        with _lock:
            _kept.append(entry)
    except Exception:  # noqa: BLE001
        pass


# Service class name fragment -> the vendor's host (or name), most specific first.
_SERVICE_HOSTS = (
    ("sarvam", "api.sarvam.ai"),
    ("smallest", "waves-api.smallest.ai"),
    ("navana", "tts.navana.ai"), ("bodhi", "tts.navana.ai"),
    ("rumik", "silk-api.rumik.ai"),
    ("deepgram", "api.deepgram.com"),
    ("vertex", "aiplatform.googleapis.com"),
    ("google", "googleapis.com"),
    ("bedrock", "bedrock (AWS)"), ("aws", "bedrock (AWS)"),
    ("openrouter", "openrouter.ai"),
    ("openai", "api.openai.com"),
    ("edge", "speech.platform.bing.com"),
)

# A vendor's "family", so an HTTP failure and the pipeline error it causes count once.
_FAMILIES = ("sarvam", "smallest", "navana", "rumik", "deepgram", "google", "bedrock", "openrouter",
             "openai", "bing", "edge")
_DEDUPE_SECONDS = 3.0
_last_http: Dict[str, float] = {}


def _family(vendor: str) -> str:
    v = (vendor or "").lower()
    return next((f for f in _FAMILIES if f in v), v)


_SECRETISH = re.compile(r"(?i)(key|token|secret|authorization|bearer|password)[\s:=\"']+(?:bearer\s+)?[^\s,;\"'&]+")
_LONG_TOKEN = re.compile(r"[A-Za-z0-9_\-]{24,}")


def clean_reason(text: Any) -> str:
    """An error message with anything that looks like a credential removed, kept short."""
    t = str(text or "")
    t = _SECRETISH.sub(lambda m: m.group(1) + "=<hidden>", t)
    t = _LONG_TOKEN.sub("<hidden>", t)
    return " ".join(t.split())[:300]


def vendor_of(service: Any) -> str:
    """A pipecat service object as the vendor's host where known, else its class name.
    An OpenAI-compatible client says where it really goes (Sarvam's or Google's LLM run
    through OpenAILLMService), so its base URL wins over the class name."""
    try:
        base = getattr(getattr(service, "_client", None), "base_url", None)
        host = urlsplit(str(base)).hostname if base else None
        if host and _external(host):
            return host
    except Exception:  # noqa: BLE001
        pass
    name = type(service).__name__.lower()
    if "google" in name and "vertex" not in name:
        # One company, three products on three hosts.
        return ("speech.googleapis.com" if "stt" in name and "tts" not in name.replace("stt", "")
                else "texttospeech.googleapis.com" if name.startswith("googletts") or "ttsservice" in name
                else "generativelanguage.googleapis.com")
    for key, host in _SERVICE_HOSTS:
        if key in name:
            return host
    return type(service).__name__


def recent(limit: int = 100) -> List[Dict[str, Any]]:
    """The newest failures, oldest first, for /health."""
    with _lock:
        items = list(_kept)
    return items[-limit:]


def _record_url(method: str, url: Any, status: Optional[int], error: Optional[BaseException],
                request_body: Any = None, response_body: Any = None, status_reason: Optional[str] = None) -> None:
    try:
        parts = urlsplit(str(url))
        if not _external(parts.hostname or "") or not integrated(parts.hostname or ""):
            return
        reason = None if error is None else type(error).__name__
        sent: Dict[str, Any] = {"method": (method or "GET").upper(), "path": parts.path}
        if parts.query:
            sent["query_params"] = sorted({q.split("=", 1)[0] for q in parts.query.split("&") if q})
        body = body_summary(request_body)
        if body is not None:
            sent["body"] = body
        got: Optional[Dict[str, Any]] = None
        if status is not None:
            got = {"status": status, "reason": status_reason}
            answer = body_summary(response_body)
            if answer is not None:
                got["body"] = answer
        record(parts.hostname or "", _operation(method, parts.path), http_status=status, reason=reason,
               request=sent, response=got)
    except Exception:  # noqa: BLE001
        pass


def _install_aiohttp() -> None:
    import aiohttp

    async def on_end(session, ctx, params):  # noqa: ANN001
        if params.response.status >= 400:
            body = None
            try:
                # aiohttp keeps the body once read, so the caller still gets all of it.
                body = await params.response.read()
            except Exception:  # noqa: BLE001
                pass
            _record_url(params.method, params.url, params.response.status, None,
                        response_body=body, status_reason=params.response.reason)

    async def on_exception(session, ctx, params):  # noqa: ANN001
        _record_url(params.method, params.url, None, params.exception)

    trace = aiohttp.TraceConfig()
    trace.on_request_end.append(on_end)
    trace.on_request_exception.append(on_exception)
    trace.freeze()
    original = aiohttp.ClientSession.__init__

    def init(self, *args, **kwargs):  # noqa: ANN001
        configs = list(kwargs.get("trace_configs") or [])
        if trace not in configs:
            configs.append(trace)
        kwargs["trace_configs"] = configs
        original(self, *args, **kwargs)

    aiohttp.ClientSession.__init__ = init


def _content(message: Any) -> Any:
    """An httpx request/response body if it was already read, else None (never forces a read)."""
    try:
        return message.content
    except Exception:  # noqa: BLE001
        return None


def _install_httpx() -> None:
    import httpx

    sync_send, async_send = httpx.Client.send, httpx.AsyncClient.send

    def send(self, request, *args, **kwargs):  # noqa: ANN001
        try:
            response = sync_send(self, request, *args, **kwargs)
        except Exception as exc:
            _record_url(request.method, request.url, None, exc)
            raise
        if response.status_code >= 400:
            _record_url(request.method, request.url, response.status_code, None,
                        _content(request), None if kwargs.get("stream") else _content(response),
                        response.reason_phrase)
        return response

    async def asend(self, request, *args, **kwargs):  # noqa: ANN001
        try:
            response = await async_send(self, request, *args, **kwargs)
        except Exception as exc:
            _record_url(request.method, request.url, None, exc)
            raise
        if response.status_code >= 400:
            _record_url(request.method, request.url, response.status_code, None,
                        _content(request), None if kwargs.get("stream") else _content(response),
                        response.reason_phrase)
        return response

    httpx.Client.send, httpx.AsyncClient.send = send, asend


def _install_pipeline() -> None:
    from pipecat.frames.frames import ErrorFrame
    from pipecat.processors.frame_processor import FrameProcessor
    from pipecat.services.ai_service import AIService

    original = FrameProcessor.push_frame

    async def push_frame(self, frame, *args, **kwargs):  # noqa: ANN001
        if isinstance(frame, ErrorFrame) and not getattr(frame, "_vendor_failure_seen", False):
            source = getattr(frame, "processor", None) or self
            if isinstance(source, AIService):
                try:
                    setattr(frame, "_vendor_failure_seen", True)
                    # The capitalised kind in the class name, leftmost first: "SmallestTTSService"
                    # is TTS, "SarvamSTTService" STT (lowercase, both contain "stt" and "tts").
                    m = re.search(r"STT|TTS|LLM", type(source).__name__)
                    kind = m.group(0) if m else "call"
                    record(vendor_of(source), f"in-call {kind}",
                           reason=clean_reason(getattr(frame, "error", "")) or type(source).__name__,
                           from_pipeline=True)
                except Exception:  # noqa: BLE001
                    pass
        return await original(self, frame, *args, **kwargs)

    FrameProcessor.push_frame = push_frame


def install() -> None:
    """Hook aiohttp, httpx and the pipecat pipeline once per process. A missing one is skipped."""
    global _installed
    if _installed:
        return
    _installed = True
    for hook in (_install_aiohttp, _install_httpx, _install_pipeline):
        try:
            hook()
        except Exception:  # noqa: BLE001
            logger.warning("vendor-failures: %s not installed", hook.__name__, exc_info=True)
