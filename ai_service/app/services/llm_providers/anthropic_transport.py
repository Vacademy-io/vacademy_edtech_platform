"""
HTTP for an llm_router route whose transport is "anthropic".

The caller hands over the OpenRouter-shaped payload (llm_router already put
the wire model in it); this module translates it with anthropic_adapter, POSTs
{base}/v1/messages with a pool key, and hands back a REAL httpx.Response whose
status, JSON body, text and headers are OpenAI-shaped — so post_chat callers,
ChatLLMClient and chat_with_chain parse it exactly like an OpenRouter reply.
Streaming returns an httpx.Response whose body is OpenAI SSE
("data: {chunk}\\n\\n" ... "data: [DONE]\\n\\n") produced by StreamTranslator.

Key-specific refusals (401, 402/billing, 403, 429) move to the provider's next
eligible key inside this module. A stream whose first event after the 200 is
`event: error` (e.g. overloaded_error) is treated like that error's HTTP status,
so it too moves keys or fails over before the caller has seen a byte. When no key is left, or the failure is not
the key's (5xx, 529, 404, 400), the vendor's status is returned with an
OpenAI-style error body and llm_router fails over to OpenRouter. Transport
errors propagate (the router fails over on those too). Spend is metered per
key in the background (key_pool.record_usage) — nothing here charges credits.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import httpx

from . import anthropic_adapter as adapter
from . import key_pool

logger = logging.getLogger(__name__)

PROVIDER = key_pool.PROVIDER_ANTHROPIC
# Headers from the vendor reply worth keeping on the translated response.
_KEEP_HEADERS = ("request-id", "retry-after")


def base_url() -> str:
    return os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")


def messages_url() -> str:
    return base_url() + "/v1/messages"


def request_headers(api_key: str) -> Dict[str, str]:
    return {
        "x-api-key": api_key,
        "anthropic-version": adapter.ANTHROPIC_VERSION,
        "content-type": "application/json",
    }


def _registry_model(route, wire: Dict[str, Any]) -> str:
    return getattr(route, "registry_model", None) or str(wire.get("model") or "")


def _response(status: int, body: Dict[str, Any], url: str, upstream: Optional[httpx.Response] = None) -> httpx.Response:
    headers = {}
    if upstream is not None:
        for name in _KEEP_HEADERS:
            value = upstream.headers.get(name)
            if value:
                headers[name] = value
    return httpx.Response(status, json=body, headers=headers, request=httpx.Request("POST", url))


def _body(route, wire: Dict[str, Any], stream: bool) -> Dict[str, Any]:
    payload = dict(wire)
    if stream:
        payload["stream"] = True
    else:
        payload.pop("stream", None)
        payload.pop("stream_options", None)
    return adapter.to_messages_request(payload, route.wire_model)


def _hint(key_id: Optional[str]) -> str:
    k = key_pool.get_key(key_id, PROVIDER)
    return f"{k.label} {k.key_hint}" if k else str(key_id)


class _KeyWalk:
    """The key the route picked first, then the provider's next eligible ones."""

    def __init__(self, route, wire: Dict[str, Any]):
        self.key_id: Optional[str] = route.key_id
        self.api_key: str = route.api_key
        self.tried: List[str] = []
        self._registry = _registry_model(route, wire)
        self._wire = wire

    def after_failure(self, status: Optional[int], headers: Any, body_text: str) -> bool:
        """Apply the pool rule; True when another key should be tried."""
        outcome = key_pool.note_failure(self.key_id, status, headers, body_text, PROVIDER)
        logger.warning("Anthropic %s on key %s for %s: %s", status, _hint(self.key_id), self._registry,
                       adapter.error_to_openai(status or 0, body_text)["error"]["message"][:200])
        if outcome != key_pool.NEXT_KEY:
            return False
        if self.key_id:
            self.tried.append(self.key_id)
        nxt = key_pool.select_key(PROVIDER, key_pool.estimate_usd(self._registry, self._wire), exclude=self.tried)
        if nxt is None:
            return False
        self.key_id, self.api_key = nxt.id, nxt.api_key
        return True

    def transport_failed(self, exc: Exception) -> None:
        key_pool.note_failure(self.key_id, None, None, f"{type(exc).__name__}: {exc}", PROVIDER)


def _translate_ok(route, wire, upstream: httpx.Response, key_id: Optional[str], url: str) -> httpx.Response:
    registry = _registry_model(route, wire)
    try:
        data = upstream.json()
    except Exception:  # noqa: BLE001
        return _response(502, adapter.error_to_openai(502, f"unreadable Anthropic reply: {upstream.text[:200]}"),
                         url, upstream)
    out = adapter.from_messages_response(data, registry, json_mode=adapter.wants_json(wire))
    key_pool.record_usage(key_id, registry, out.get("usage"))
    return _response(upstream.status_code, out, url, upstream)


async def send_async(client, route, wire: Dict[str, Any], **kwargs) -> httpx.Response:
    """One non-streaming call with an httpx.AsyncClient."""
    url = route.url or messages_url()
    body = _body(route, wire, stream=False)
    walk = _KeyWalk(route, wire)
    while True:
        try:
            resp = await client.post(url, headers=request_headers(walk.api_key), json=body, **kwargs)
        except httpx.TransportError as exc:
            walk.transport_failed(exc)
            raise
        if resp.status_code < 400:
            return _translate_ok(route, wire, resp, walk.key_id, url)
        if walk.after_failure(resp.status_code, resp.headers, resp.text):
            continue
        return _response(resp.status_code, adapter.error_to_openai(resp.status_code, resp.text), url, resp)


def send_sync(client, route, wire: Dict[str, Any], **kwargs) -> httpx.Response:
    """`send_async` for an httpx.Client."""
    url = route.url or messages_url()
    body = _body(route, wire, stream=False)
    walk = _KeyWalk(route, wire)
    while True:
        try:
            resp = client.post(url, headers=request_headers(walk.api_key), json=body, **kwargs)
        except httpx.TransportError as exc:
            walk.transport_failed(exc)
            raise
        if resp.status_code < 400:
            return _translate_ok(route, wire, resp, walk.key_id, url)
        if walk.after_failure(resp.status_code, resp.headers, resp.text):
            continue
        return _response(resp.status_code, adapter.error_to_openai(resp.status_code, resp.text), url, resp)


class _TranslatedSSE(httpx.AsyncByteStream):
    """Anthropic SSE in, OpenAI SSE out. Closing it closes the vendor stream."""

    def __init__(self, upstream: httpx.Response, upstream_cm, registry_model: str, key_id: Optional[str],
                 lines=None, buffered: Optional[List[str]] = None):
        self._upstream = upstream
        self._cm = upstream_cm
        # open_stream already read the head of the stream (up to the first
        # content event); replay it, then carry on with the same iterator.
        self._lines = lines
        self._buffered = list(buffered or [])
        self._registry = registry_model
        self._key_id = key_id
        self._translator = adapter.StreamTranslator(registry_model)
        self._metered = False
        self._closed = False

    def _meter(self, usage: Optional[Dict[str, Any]]) -> None:
        if not self._metered and usage:
            self._metered = True
            key_pool.record_usage(self._key_id, self._registry, usage)

    def _encode(self, chunks: List[Dict[str, Any]]) -> bytes:
        out = []
        for chunk in chunks:
            if chunk.get("usage"):
                self._meter(chunk["usage"])
            out.append(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n")
        return "".join(out).encode("utf-8")

    async def _all_lines(self):
        for line in self._buffered:
            yield line
        self._buffered = []
        lines = self._lines if self._lines is not None else self._upstream.aiter_lines()
        async for line in lines:
            yield line

    async def __aiter__(self):
        event: Optional[str] = None
        try:
            async for line in self._all_lines():
                if line.startswith("event:"):
                    event = line[6:].strip()
                    continue
                if not line.startswith("data:"):
                    continue
                try:
                    data = json.loads(line[5:].strip())
                except ValueError:
                    continue
                payload = self._encode(self._translator.feed(event or "", data))
                event = None
                if payload:
                    yield payload
                if self._translator.finished:
                    break
            yield b"data: [DONE]\n\n"
        finally:
            # A stream cut short (client gone, vendor dropped) still meters
            # what the vendor reported so far.
            if not self._metered and self._translator.raw_usage:
                self._meter(adapter.usage_to_openai(self._translator.raw_usage))

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        if not self._metered and self._translator.raw_usage:
            self._meter(adapter.usage_to_openai(self._translator.raw_usage))
        await self._cm.__aexit__(None, None, None)


# Events that carry (or end) the answer; anything before them is the stream head.
_CONTENT_EVENTS = ("content_block_start", "content_block_delta", "content_block_stop",
                   "message_delta", "message_stop")


async def _read_head(lines) -> Tuple[List[str], Optional[Dict[str, Any]]]:
    """Read SSE lines up to the first content event. Returns the lines read
    (to replay) and the data of an `error` event met first, else None. A stream
    that ends early returns what it had and no error (the translator handles it)."""
    buffered: List[str] = []
    event: Optional[str] = None
    while True:
        try:
            line = await lines.__anext__()
        except StopAsyncIteration:
            return buffered, None
        buffered.append(line)
        if line.startswith("event:"):
            event = line[6:].strip()
            continue
        if not line.startswith("data:"):
            continue
        try:
            data = json.loads(line[5:].strip())
        except ValueError:
            continue
        etype = event or (data.get("type") if isinstance(data, dict) else "") or ""
        event = None
        if etype == "error":
            return buffered, data if isinstance(data, dict) else {}
        if etype in _CONTENT_EVENTS:
            return buffered, None


def _stream_error_status(data: Dict[str, Any]) -> int:
    err = data.get("error") if isinstance(data, dict) else None
    err_type = err.get("type") if isinstance(err, dict) else None
    return adapter._ERROR_STATUS.get(err_type or "", 500)


class open_stream:
    """`async with open_stream(client, route, wire) as resp:` — a streaming
    call. `resp` is an httpx.Response: 200 with OpenAI SSE, or the vendor's
    error status with an OpenAI-style JSON body (after the key walk)."""

    def __init__(self, client, route, wire: Dict[str, Any], **kwargs):
        self._client, self._route, self._wire, self._kwargs = client, route, wire, kwargs
        self._response: Optional[httpx.Response] = None

    async def __aenter__(self) -> httpx.Response:
        url = self._route.url or messages_url()
        body = _body(self._route, self._wire, stream=True)
        walk = _KeyWalk(self._route, self._wire)
        while True:
            cm = self._client.stream("POST", url, headers=request_headers(walk.api_key), json=body, **self._kwargs)
            try:
                upstream = await cm.__aenter__()
            except httpx.TransportError as exc:
                walk.transport_failed(exc)
                raise
            if upstream.status_code < 400:
                lines = upstream.aiter_lines()
                try:
                    buffered, error = await _read_head(lines)
                except BaseException as exc:
                    await cm.__aexit__(None, None, None)
                    if isinstance(exc, httpx.TransportError):
                        walk.transport_failed(exc)
                    raise
                if error is None:
                    self._response = httpx.Response(
                        upstream.status_code,
                        headers={"content-type": "text/event-stream"},
                        stream=_TranslatedSSE(upstream, cm, _registry_model(self._route, self._wire), walk.key_id,
                                              lines=lines, buffered=buffered),
                        request=httpx.Request("POST", url),
                    )
                    return self._response
                # `event: error` before any content (e.g. overloaded_error after the
                # 200): nothing reached the caller, so treat it like the same error
                # as an HTTP status - next key, or a failover status for llm_router.
                await cm.__aexit__(None, None, None)
                err_status = _stream_error_status(error)
                body_text = json.dumps(error, ensure_ascii=False)
                if walk.after_failure(err_status, upstream.headers, body_text):
                    continue
                self._response = _response(err_status, adapter.error_to_openai(err_status, body_text), url, upstream)
                return self._response
            try:
                body_text = (await upstream.aread()).decode("utf-8", "ignore")
            finally:
                await cm.__aexit__(None, None, None)
            if walk.after_failure(upstream.status_code, upstream.headers, body_text):
                continue
            self._response = _response(upstream.status_code,
                                       adapter.error_to_openai(upstream.status_code, body_text), url, upstream)
            return self._response

    async def __aexit__(self, *exc_info) -> bool:
        if self._response is not None:
            await self._response.aclose()
        return False


__all__ = ["base_url", "messages_url", "request_headers", "send_async", "send_sync", "open_stream"]
