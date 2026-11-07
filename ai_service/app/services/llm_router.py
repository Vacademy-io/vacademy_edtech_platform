"""
Which gateway serves a chat model.

OpenRouter serves every model by default. A model can be sent to another
OpenAI-compatible gateway (e.g. Isoquant for GLM) by listing it in the route
map — the platform setting `llm.model_routes` (super-admin portal, applies
within 30 s) or, when that is unset, the `LLM_MODEL_ROUTES` env var:

    {"z-ai/glm-5.3-flash": "isoquant"}
    {"z-ai/glm-5.3-flash": {"router": "isoquant", "model": "glm-5.3-flash",
                            "reasoning_effort": "low"}}

The registry id (`ai_models.model_id`, the OpenRouter id) stays the id used
everywhere else — billing, model health, the portal. Only the wire request
changes: URL, key, headers, the gateway's model id and its reasoning shape.

A route is skipped (the call stays on OpenRouter) when:
  * the caller passes its own key that is not the platform OpenRouter key —
    an institute's BYO key is an OpenRouter key, and must never be sent to
    another vendor;
  * the gateway's key is not configured;
  * the gateway failed recently (`mark_router_failed`), so a dead gateway
    costs one failed call per cooldown instead of one per request.

Call sites build their payload in OpenRouter's shape as before and call
`route_chat(payload, api_key)`, which returns (url, headers, payload) for the
gateway that should serve it. `openrouter_chat(...)` gives the plain
OpenRouter request for a failover retry.

Direct Anthropic ("anthropic" router, `{"anthropic/claude-sonnet-4.5":
"anthropic"}`) does not speak OpenAI's format, so it is only ever chosen for
callers whose HTTP call this module owns — post_chat / post_chat_sync /
open_chat_stream / chat_with_chain(_sync), ChatLLMClient and the internal
bridge — which ask with `route_chat(..., allow_translated=True)` and send with
`send` / `send_sync` / `open_stream`. Those translate the request
(llm_providers/anthropic_adapter), pick a key from the budget-aware pool
(llm_providers/key_pool) and hand back an OpenAI-shaped httpx.Response. Any
other caller of `route_chat` gets the OpenRouter route for the same model, as
before. No active key (or the key tables not migrated yet) = OpenRouter.
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional, Tuple

from ..config import get_settings

logger = logging.getLogger(__name__)

ROUTES_SETTING_KEY = "llm.model_routes"
DEFAULT_ROUTER = "openrouter"

# Request keys only OpenRouter understands. Other gateways either reject
# unknown keys or ignore them silently; neither is worth finding out per call.
_OPENROUTER_ONLY_KEYS = ("reasoning", "provider", "transforms", "plugins", "route", "models", "usage")

_FAILED_UNTIL: Dict[str, float] = {}
_FAILURE_COOLDOWN_SECONDS = 120.0


@dataclass(frozen=True)
class RouterSpec:
    name: str
    label: str
    chat_url: Callable[[], str]
    api_key: Callable[[], Optional[str]]
    headers: Dict[str, str] = field(default_factory=dict)
    # "openrouter": `reasoning: {enabled, effort}` passes through.
    # "effort": OpenAI-style top-level `reasoning_effort`.
    reasoning_style: str = "openrouter"
    # Efforts the gateway accepts, lowest first (the "off" request maps to the first).
    efforts: Tuple[str, ...] = ()
    default_effort: Optional[str] = None
    # "openai": the gateway speaks OpenAI chat completions (sent as-is).
    # "anthropic": Messages API, translated at send time; keys from key_pool.
    transport: str = "openai"


def _anthropic_messages_url() -> str:
    return os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/") + "/v1/messages"


ROUTERS: Dict[str, RouterSpec] = {
    "openrouter": RouterSpec(
        name="openrouter",
        label="OpenRouter",
        # LLM_BASE_URL keeps working for self-hosted installs that point it elsewhere.
        chat_url=lambda: get_settings().llm_base_url or "https://openrouter.ai/api/v1/chat/completions",
        api_key=lambda: get_settings().openrouter_api_key,
        headers={"HTTP-Referer": "https://vacademy.io", "X-Title": "Vacademy AI Tutor"},
    ),
    "isoquant": RouterSpec(
        name="isoquant",
        label="Isoquant",
        chat_url=lambda: os.getenv("ISOQUANT_BASE_URL", "https://api.isoquant.ai/v1").rstrip("/") + "/chat/completions",
        api_key=lambda: get_settings().isoquant_api_key,
        # Zero data retention: learner content must not be kept by the gateway.
        headers={"Isoquant-ZDR": "required"},
        reasoning_style="effort",
        # glm-5.3-flash accepts low|high|max and DEFAULTS TO max when nothing
        # is sent — so a request that says nothing must still say "low".
        efforts=("low", "high", "max"),
        default_effort="low",
    ),
    # Keys come from the budget-aware pool (llm_provider_keys), never the env.
    "anthropic": RouterSpec(
        name="anthropic",
        label="Anthropic (direct)",
        chat_url=_anthropic_messages_url,
        api_key=lambda: None,
        reasoning_style="anthropic",
        transport="anthropic",
    ),
}

ANTHROPIC_ROUTER = "anthropic"


@dataclass(frozen=True)
class ChatRoute:
    router: str
    label: str
    url: str
    api_key: str
    wire_model: str
    extra_headers: Dict[str, str]
    reasoning_style: str
    efforts: Tuple[str, ...]
    effort: Optional[str]  # the route entry's effort; None = the gateway default
    transport: str = "openai"
    key_id: Optional[str] = None          # pool key (transport "anthropic")
    registry_model: Optional[str] = None  # ai_models id, for translated replies

    @property
    def is_default(self) -> bool:
        return self.router == DEFAULT_ROUTER

    @property
    def is_translated(self) -> bool:
        return self.transport != "openai"

    def headers(self) -> Dict[str, str]:
        if self.transport == "anthropic":
            from .llm_providers.anthropic_transport import request_headers
            return request_headers(self.api_key)
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            **self.extra_headers,
        }

    def prepare(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """The payload in this gateway's shape. OpenRouter's is returned as-is.
        A translated transport gets the OpenRouter payload with its wire model;
        the Messages body is built at send time."""
        if self.reasoning_style == "openrouter":
            return payload
        if self.transport != "openai":
            return {**payload, "model": self.wire_model}
        p = {k: v for k, v in payload.items() if k not in _OPENROUTER_ONLY_KEYS}
        p["model"] = self.wire_model
        if self.efforts:
            effort = _map_effort(payload.get("reasoning"), self.effort, self.efforts)
            if effort:
                p["reasoning_effort"] = effort
        if p.get("stream") and "stream_options" not in p:
            p["stream_options"] = {"include_usage": True}
        return p


def _map_effort(reasoning: Any, route_effort: Optional[str], efforts: Tuple[str, ...]) -> Optional[str]:
    """OpenRouter's `reasoning` object → the gateway's effort level.

    Off (`enabled: false`) becomes the lowest level — these models cannot turn
    reasoning off. An explicit OpenRouter effort maps to the nearest level the
    gateway has; otherwise the route's configured effort applies.
    """
    r = reasoning if isinstance(reasoning, dict) else {}
    if r.get("enabled") is False:
        return efforts[0]
    wanted = str(r.get("effort") or route_effort or "").lower()
    if not wanted:
        return None
    if wanted in efforts:
        return wanted
    order = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
    rank = order.index(wanted) if wanted in order else order.index("low")
    for level in efforts:
        if level in order and order.index(level) >= rank:
            return level
    return efforts[-1]


# --------------------------------------------------------------------------
# Route map
# --------------------------------------------------------------------------

def parse_routes(raw: Any, strict: bool = True) -> Dict[str, Dict[str, Any]]:
    """Normalise a route map (JSON text or dict) to {model_id: entry}.
    Raises ValueError on anything malformed or on an unknown router. With
    strict=False (runtime) a bad ENTRY is skipped with an error log instead,
    so one typo cannot move every other routed model back to OpenRouter; a map
    that is not a JSON object still raises."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return {}
    data = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(data, dict):
        raise ValueError('routes must be a JSON object like {"z-ai/glm-5.3-flash": "isoquant"}')
    out: Dict[str, Dict[str, Any]] = {}
    for model_id, entry in data.items():
        try:
            out[str(model_id).strip()] = _parse_entry(model_id, entry)
        except ValueError as exc:
            if strict:
                raise
            logger.error("LLM route for %s ignored (%s); that model stays on OpenRouter", model_id, exc)
    return out


def _parse_entry(model_id: Any, entry: Any) -> Dict[str, Any]:
    if isinstance(entry, str):
        entry = {"router": entry}
    if not isinstance(entry, dict) or not entry.get("router"):
        raise ValueError(f"route for {model_id} needs a router name")
    router = str(entry["router"]).strip().lower()
    if router not in ROUTERS:
        raise ValueError(f"unknown router '{router}' for {model_id} (known: {', '.join(ROUTERS)})")
    # `"reasoning_effort": false` → send none (models without the parameter).
    send_effort = entry.get("reasoning_effort") is not False
    effort = entry.get("reasoning_effort") if send_effort else None
    spec = ROUTERS[router]
    if effort is not None and spec.efforts and str(effort).lower() not in spec.efforts:
        raise ValueError(f"{spec.label} accepts reasoning_effort {', '.join(spec.efforts)}, not '{effort}'")
    return {
        "router": router,
        "model": str(entry.get("model") or "").strip() or None,
        "reasoning_effort": str(effort).lower() if effort is not None else None,
        "send_effort": send_effort,
    }


def _env_routes() -> str:
    return os.getenv("LLM_MODEL_ROUTES", "") or "{}"


def model_routes() -> Dict[str, Dict[str, Any]]:
    try:
        from .platform_settings_service import get_platform_setting
        raw = get_platform_setting(ROUTES_SETTING_KEY, default=_env_routes())
    except Exception:  # noqa: BLE001
        raw = _env_routes()
    try:
        return parse_routes(raw, strict=False)
    except Exception as exc:  # noqa: BLE001
        # A bad map must never take generation down: everything stays on OpenRouter.
        logger.error("LLM route map is invalid (%s); every model stays on OpenRouter", exc)
        return {}


def _default_wire_model(model_id: str) -> str:
    """OpenRouter ids carry a vendor prefix and variant suffix
    ("z-ai/glm-5.3-flash:batch"); direct gateways use the bare name."""
    return model_id.split("/", 1)[-1].split(":", 1)[0]


def anthropic_wire_model(model_id: str) -> str:
    """`anthropic/claude-sonnet-4.5` -> `claude-sonnet-4-5` (Anthropic API id)."""
    from .llm_providers.anthropic_adapter import derive_wire_model
    return derive_wire_model(model_id)


# --------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------

def mark_router_failed(router: str) -> None:
    if router != DEFAULT_ROUTER:
        _FAILED_UNTIL[router] = time.monotonic() + _FAILURE_COOLDOWN_SECONDS
        logger.warning("LLM router %s failed; sending its models to OpenRouter for %.0f s",
                       router, _FAILURE_COOLDOWN_SECONDS)


def _router_cooling_down(router: str) -> bool:
    until = _FAILED_UNTIL.get(router)
    if until is None:
        return False
    if time.monotonic() >= until:
        _FAILED_UNTIL.pop(router, None)
        return False
    return True


def _openrouter_route(model: str, api_key: Optional[str]) -> ChatRoute:
    spec = ROUTERS[DEFAULT_ROUTER]
    return ChatRoute(
        router=spec.name, label=spec.label, url=spec.chat_url(),
        api_key=api_key or spec.api_key() or "", wire_model=model,
        extra_headers=dict(spec.headers), reasoning_style=spec.reasoning_style,
        efforts=spec.efforts, effort=None,
    )


def _anthropic_route(model: str, entry: Dict[str, Any], key) -> ChatRoute:
    spec = ROUTERS[ANTHROPIC_ROUTER]
    return ChatRoute(
        router=spec.name, label=spec.label, url=spec.chat_url(), api_key=key.api_key,
        wire_model=entry.get("model") or anthropic_wire_model(model),
        extra_headers={}, reasoning_style=spec.reasoning_style, efforts=(), effort=None,
        transport=spec.transport, key_id=key.id, registry_model=model,
    )


def route_for(
    model: str, api_key: Optional[str] = None, routes: Optional[Dict[str, Dict[str, Any]]] = None,
    allow_translated: bool = False, payload: Optional[Dict[str, Any]] = None,
) -> ChatRoute:
    """The gateway that should serve `model`. `api_key` is the key the caller
    resolved (None = the platform key); `routes` overrides the live map (the
    portal probes a map before saving it). `allow_translated`: the caller sends
    through `send`/`send_sync`/`open_stream`, so a non-OpenAI gateway may be
    picked; otherwise such an entry resolves to OpenRouter. `payload` sizes the
    call for the key pool's budget check."""
    entry = (model_routes() if routes is None else routes).get(model or "")
    if not entry or entry["router"] == DEFAULT_ROUTER:
        return _openrouter_route(model, api_key)

    platform_key = get_settings().openrouter_api_key
    if api_key and api_key != platform_key:
        return _openrouter_route(model, api_key)  # caller's own OpenRouter key

    spec = ROUTERS[entry["router"]]
    if spec.transport != "openai":
        if not allow_translated or _router_cooling_down(spec.name):
            return _openrouter_route(model, api_key)
        from .llm_providers import key_pool
        pool_key = key_pool.select_key(spec.name, key_pool.estimate_usd(model, payload) if payload else 0.0)
        if pool_key is None:
            return _openrouter_route(model, api_key)  # no active key with budget left
        return _anthropic_route(model, entry, pool_key)
    key = spec.api_key()
    if not key:
        logger.warning("Model %s is routed to %s but its API key is not set; using OpenRouter",
                       model, spec.label)
        return _openrouter_route(model, api_key)
    if _router_cooling_down(spec.name):
        return _openrouter_route(model, api_key)

    effort = entry["reasoning_effort"] or spec.default_effort
    return ChatRoute(
        router=spec.name, label=spec.label, url=spec.chat_url(), api_key=key,
        wire_model=entry["model"] or _default_wire_model(model),
        extra_headers=dict(spec.headers), reasoning_style=spec.reasoning_style,
        efforts=spec.efforts if entry["send_effort"] else (),
        effort=effort,
    )


def route_chat(
    payload: Dict[str, Any], api_key: Optional[str] = None,
    routes: Optional[Dict[str, Dict[str, Any]]] = None,
    allow_translated: bool = False,
) -> Tuple[str, Dict[str, str], Dict[str, Any], ChatRoute]:
    """(url, headers, payload, route) for one chat completion whose payload is
    in OpenRouter's shape with the registry model id in `payload["model"]`.
    Only pass allow_translated=True when the request goes out through
    `send` / `send_sync` / `open_stream` (see route_for)."""
    route = route_for(payload.get("model") or "", api_key, routes,
                      allow_translated=allow_translated, payload=payload)
    return route.url, route.headers(), route.prepare(payload), route


def openrouter_chat(
    payload: Dict[str, Any], api_key: Optional[str] = None
) -> Tuple[str, Dict[str, str], Dict[str, Any], ChatRoute]:
    """The same request sent to OpenRouter — the failover for a routed call."""
    route = _openrouter_route(payload.get("model") or "", api_key)
    return route.url, route.headers(), payload, route


def should_fail_over(route: ChatRoute, status: Optional[int]) -> bool:
    """Whether a routed call's failure should be retried on OpenRouter.
    `status` None = the request never got a response (timeout, connect error).
    A 400 is the request's own fault and would fail on OpenRouter too."""
    if route.is_default:
        return False
    if route.is_translated:
        # Key-specific refusals were already walked through the key pool;
        # anything still failing (incl. a 400 the translation may have caused)
        # gets one try on OpenRouter. Never a model-park signal to callers.
        return status is None or status >= 400
    return status is None or status in (401, 402, 403, 404, 408, 429) or status >= 500


def note_route_failure(route: ChatRoute, status: Optional[int]) -> None:
    """A routed call is failing over: cool the gateway down when the gateway
    itself is the problem. For OpenAI-transport gateways that is every
    failover (today's rule); a translated gateway cools down only on a
    transport error or a 5xx/529 — a key's refusal is the pool's business."""
    if route.is_translated and status is not None and status < 500:
        return
    mark_router_failed(route.router)


# --------------------------------------------------------------------------
# Send helpers (the only way a translated route goes out)
# --------------------------------------------------------------------------

async def send(client, route: ChatRoute, wire: Dict[str, Any], **kwargs):
    """POST `wire` (route.prepare output) on `route` with an httpx.AsyncClient.
    OpenAI transport: exactly client.post(url, headers, json). Anthropic: the
    translated call; returns an OpenAI-shaped httpx.Response."""
    if route.transport == "anthropic":
        from .llm_providers.anthropic_transport import send_async
        return await send_async(client, route, wire, **kwargs)
    return await client.post(route.url, headers=route.headers(), json=wire, **kwargs)


def send_sync(route: ChatRoute, wire: Dict[str, Any], timeout: float = 60.0, client=None, **kwargs):
    """`send` for synchronous code (httpx.Client; one is opened when not given)."""
    import httpx

    if client is None:
        with httpx.Client(timeout=timeout) as own:
            return send_sync(route, wire, timeout, own, **kwargs)
    if route.transport == "anthropic":
        from .llm_providers.anthropic_transport import send_sync as anthropic_send_sync
        return anthropic_send_sync(client, route, wire, **kwargs)
    return client.post(route.url, headers=route.headers(), json=wire, **kwargs)


def open_stream(client, route: ChatRoute, wire: Dict[str, Any], **kwargs):
    """Async context manager for one streaming request on `route`. OpenAI
    transport: exactly client.stream("POST", ...). Anthropic: an httpx.Response
    whose body is OpenAI SSE translated from the Messages stream."""
    if route.transport == "anthropic":
        from .llm_providers.anthropic_transport import open_stream as anthropic_open_stream
        return anthropic_open_stream(client, route, wire, **kwargs)
    return client.stream("POST", route.url, headers=route.headers(), json=wire, **kwargs)


def probe_anthropic_route(model_id: str, routes: Optional[Dict[str, Dict[str, Any]]] = None,
                          timeout: float = 25.0) -> Optional[str]:
    """One tiny call for `model_id` through the Anthropic key pool — no
    OpenRouter failover, so a save-time probe tests what will really serve.
    None when it answered, else why not."""
    import httpx
    from .chat_llm_client import openrouter_error_text
    from .llm_providers import key_pool

    entry = (model_routes() if routes is None else routes).get(model_id) or {"router": ANTHROPIC_ROUTER}
    pool_key = key_pool.select_key(ANTHROPIC_ROUTER)
    if pool_key is None:
        return ("no active Anthropic key with budget left — add one under Super admin > LLM keys "
                "(or check that the llm_provider_keys migration has run)")
    route = _anthropic_route(model_id, entry, pool_key)
    payload = {"model": model_id, "messages": [{"role": "user", "content": "Reply with the single word: ok"}],
               "max_tokens": 16}
    try:
        resp = send_sync(route, route.prepare(payload), timeout)
    except Exception as exc:  # noqa: BLE001
        return f"could not reach Anthropic: {exc}"
    if resp.status_code >= 400:
        return f"Anthropic {resp.status_code}: {openrouter_error_text(resp.text)}"
    try:
        if not (resp.json().get("choices") or []):
            return "Anthropic returned no choices"
    except Exception as exc:  # noqa: BLE001
        return f"unreadable Anthropic response: {exc}"
    return None


# --------------------------------------------------------------------------
# Sending
# --------------------------------------------------------------------------

async def post_chat(client, payload: Dict[str, Any], api_key: Optional[str] = None, **kwargs):
    """POST one chat completion through the model's gateway with an
    httpx.AsyncClient. A routed gateway that is unreachable or refuses is
    retried once on OpenRouter. Returns the httpx.Response (status untouched,
    so callers keep their own error handling)."""
    import httpx

    url, headers, wire, route = route_chat(payload, api_key, allow_translated=True)
    status: Optional[int] = None
    try:
        response = await send(client, route, wire, **kwargs)
        if not should_fail_over(route, response.status_code):
            return response
        status = response.status_code
        reason = f"{response.status_code}: {response.text[:200]}"
    except httpx.TransportError as exc:
        if route.is_default:
            raise
        reason = str(exc)
    note_route_failure(route, status)
    logger.warning("%s failed for %s (%s); retrying on OpenRouter", route.label, payload.get("model"), reason)
    url, headers, wire, _ = openrouter_chat(payload, api_key)
    return await client.post(url, headers=headers, json=wire, **kwargs)


def post_chat_sync(payload: Dict[str, Any], api_key: Optional[str] = None, timeout: float = 60.0):
    """`post_chat` for synchronous code paths (httpx.Client)."""
    import httpx

    url, headers, wire, route = route_chat(payload, api_key, allow_translated=True)
    with httpx.Client(timeout=timeout) as client:
        status: Optional[int] = None
        try:
            response = send_sync(route, wire, timeout, client)
            if not should_fail_over(route, response.status_code):
                return response
            status = response.status_code
            reason = f"{response.status_code}: {response.text[:200]}"
        except httpx.TransportError as exc:
            if route.is_default:
                raise
            reason = str(exc)
        note_route_failure(route, status)
        logger.warning("%s failed for %s (%s); retrying on OpenRouter", route.label, payload.get("model"), reason)
        url, headers, wire, _ = openrouter_chat(payload, api_key)
        return client.post(url, headers=headers, json=wire)


class open_chat_stream:
    """`async with open_chat_stream(client, payload, api_key) as resp:` — a
    streaming chat completion through the model's gateway. The failover to
    OpenRouter happens before the body is read, so no token is ever repeated."""

    def __init__(self, client, payload: Dict[str, Any], api_key: Optional[str] = None, **kwargs):
        self._client, self._payload, self._api_key, self._kwargs = client, payload, api_key, kwargs
        self._cm = None
        self.route: Optional[ChatRoute] = None

    async def _open(self, url, headers, wire):
        self._cm = self._client.stream("POST", url, headers=headers, json=wire, **self._kwargs)
        return await self._cm.__aenter__()

    async def __aenter__(self):
        import httpx

        url, headers, wire, self.route = route_chat(self._payload, self._api_key, allow_translated=True)
        status: Optional[int] = None
        try:
            if self.route.is_translated:
                self._cm = open_stream(self._client, self.route, wire, **self._kwargs)
                response = await self._cm.__aenter__()
            else:
                response = await self._open(url, headers, wire)
            if not should_fail_over(self.route, response.status_code):
                return response
            status = response.status_code
            reason = f"{response.status_code}: {(await response.aread())[:200]!r}"
            await self._cm.__aexit__(None, None, None)
        except httpx.TransportError as exc:
            if self.route.is_default:
                raise
            reason = str(exc)
        self._cm = None
        note_route_failure(self.route, status)
        logger.warning("%s failed for %s (%s); streaming from OpenRouter",
                       self.route.label, self._payload.get("model"), reason)
        url, headers, wire, self.route = openrouter_chat(self._payload, self._api_key)
        return await self._open(url, headers, wire)

    async def __aexit__(self, *exc_info):
        if self._cm is not None:
            return await self._cm.__aexit__(*exc_info)
        return False


# --------------------------------------------------------------------------
# Use-case chains
# --------------------------------------------------------------------------

# Models whose endpoint cannot turn reasoning off and that spend the whole
# max_tokens budget thinking when no reasoning shape is sent (see
# chat_llm_client._REASONING_MODE). Every leg of a chain call must carry
# `reasoning: {enabled, effort: low}` plus a max_tokens allowance for them.
REASONING_MANDATORY_PREFIXES = ("z-ai/glm-5", "z-ai/glm-4.6v")


class ChainExhausted(RuntimeError):
    """Every model in the chain failed. `attempts` = [(model, reason), ...]."""

    def __init__(self, use_case: Optional[str], attempts):
        self.use_case = use_case
        self.attempts = list(attempts)
        detail = "; ".join(f"{m}: {r}" for m, r in self.attempts) or "empty model chain"
        super().__init__(f"LLM chain failed for {use_case or 'explicit models'}: {detail}")


@dataclass
class ChainResult:
    content: str
    model: str                 # REGISTRY id that answered — bill and record under this
    usage: Dict[str, Any]      # the gateway's usage object ({} when it sent none)
    router: str                # gateway that served the answer ("isoquant" / "openrouter")
    finish_reason: Optional[str] = None
    message: Dict[str, Any] = field(default_factory=dict)  # full choices[0].message
    raw: Dict[str, Any] = field(default_factory=dict)      # full response JSON
    attempts: list = field(default_factory=list)           # [(model, reason)] that failed first


def _reasoning_mode(model: str) -> Optional[str]:
    try:
        from .chat_llm_client import reasoning_mode_for
        known = reasoning_mode_for(model)
    except Exception:  # noqa: BLE001
        known = None
    if known:
        return known
    return "on-low" if any((model or "").startswith(p) for p in REASONING_MANDATORY_PREFIXES) else None


def chain_payload(model: str, payload: Dict[str, Any], reasoning_effort: Optional[str] = None) -> Dict[str, Any]:
    """The OpenRouter-shaped payload for one chain leg. For reasoning-mandatory
    models (GLM) this applies chat_llm_client.apply_reasoning_mode — reasoning
    on at low effort and a max_tokens allowance on top of the caller's cap — so
    the Isoquant leg (mapped to `reasoning_effort`) AND the OpenRouter failover
    leg (which sends the payload as-is) both reason briefly. Other models get
    the caller's payload unchanged. Never mutates `payload`."""
    p = dict(payload)
    p["model"] = model
    mode = _reasoning_mode(model)
    if mode:
        from .chat_llm_client import apply_reasoning_mode
        p = apply_reasoning_mode(p, mode)
        if reasoning_effort:
            p["reasoning"] = {**(p.get("reasoning") or {}), "enabled": True,
                              "effort": str(reasoning_effort).lower()}
    return p


def _resolve_chain(use_case, models, db, preferred_model):
    if models:
        chain = [m for m in models if m]
    elif use_case:
        from .model_selection import resolve_model_sync, resolve_models
        if db is not None:
            primary, fallbacks = resolve_models(db, use_case, preferred_model)
        else:
            primary, fallbacks = resolve_model_sync(use_case, preferred_model)
        chain = [primary, *fallbacks]
    else:
        raise ValueError("chat_with_chain needs a use_case or a models list")
    out: list = []
    for m in chain:
        if m not in out:
            out.append(m)
    return out


def _parse_completion(model: str, router: str, response, attempts) -> Tuple[Optional[ChainResult], str]:
    """(result, failure_reason). A 2xx with neither content nor tool calls is
    a failure — GLM that spent its whole budget thinking returns exactly that."""
    status = response.status_code
    if status >= 400:
        return None, f"HTTP {status}: {response.text[:200]}"
    try:
        data = response.json()
    except Exception:  # noqa: BLE001
        return None, f"non-JSON body: {response.text[:200]}"
    if isinstance(data, dict) and data.get("error"):
        return None, f"error body: {str(data.get('error'))[:200]}"
    choices = (data or {}).get("choices") or []
    if not choices:
        return None, "no choices in response"
    message = choices[0].get("message") or {}
    content = message.get("content") or ""
    if isinstance(content, list):  # some gateways return content parts
        content = "".join(str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in content)
    if not str(content).strip() and not message.get("tool_calls"):
        return None, f"empty content (finish_reason={choices[0].get('finish_reason')})"
    return ChainResult(
        content=str(content), model=model, usage=data.get("usage") or {}, router=router,
        finish_reason=choices[0].get("finish_reason"), message=message, raw=data,
        attempts=list(attempts),
    ), ""


async def chat_with_chain(
    payload: Dict[str, Any],
    use_case: Optional[str] = None,
    models: Optional[list] = None,
    *,
    db=None,
    preferred_model: Optional[str] = None,
    api_key: Optional[str] = None,
    reasoning_effort: Optional[str] = None,
    client=None,
    timeout: float = 120.0,
) -> ChainResult:
    """One chat completion that walks a model chain.

    `payload` is OpenRouter-shaped (messages, max_tokens, temperature,
    response_format, ...); its `model` is ignored. The chain is `models` when
    given, else resolve_models(db, use_case, preferred_model) (or
    resolve_model_sync without a session) — i.e. [default, fallback,
    (GLM hard fallback), (NON_GLM_FALLBACK)].

    Per model: the routed gateway (Isoquant for GLM) → the same model on
    OpenRouter (post_chat's failover) → the next model in the chain on any
    error, transport failure or empty answer. Reasoning-mandatory models get
    reasoning effort low (or `reasoning_effort`) and a max_tokens allowance on
    both legs. Returns ChainResult(content, model=<registry id>, usage, ...);
    raises ChainExhausted when every model failed. Charges nothing — the
    caller bills `result.model` with `result.usage`."""
    import asyncio
    import httpx

    if models or db is not None or not use_case:
        chain = _resolve_chain(use_case, models, db, preferred_model)
    else:  # session-less resolve may open a DB connection: keep it off the event loop
        chain = await asyncio.to_thread(_resolve_chain, use_case, None, None, preferred_model)
    attempts: list = []
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=timeout)
    try:
        for model in chain:
            wire = chain_payload(model, payload, reasoning_effort)
            try:
                response = await post_chat(client, wire, api_key)
            except httpx.HTTPError as exc:
                attempts.append((model, f"{type(exc).__name__}: {exc}"[:200]))
                logger.warning("chat_with_chain(%s): %s failed (%s); trying next model",
                               use_case, model, attempts[-1][1])
                continue
            router = _router_of(response)
            result, reason = _parse_completion(model, router, response, attempts)
            if result is not None:
                if attempts:
                    logger.info("chat_with_chain(%s): answered by %s after %d failed model(s)",
                                use_case, model, len(attempts))
                return result
            attempts.append((model, reason))
            logger.warning("chat_with_chain(%s): %s failed (%s); trying next model", use_case, model, reason)
    finally:
        if own_client:
            await client.aclose()
    raise ChainExhausted(use_case, attempts)


def chat_with_chain_sync(
    payload: Dict[str, Any],
    use_case: Optional[str] = None,
    models: Optional[list] = None,
    *,
    db=None,
    preferred_model: Optional[str] = None,
    api_key: Optional[str] = None,
    reasoning_effort: Optional[str] = None,
    timeout: float = 120.0,
) -> ChainResult:
    """`chat_with_chain` for synchronous code paths (uses post_chat_sync)."""
    import httpx

    chain = _resolve_chain(use_case, models, db, preferred_model)
    attempts: list = []
    for model in chain:
        wire = chain_payload(model, payload, reasoning_effort)
        try:
            response = post_chat_sync(wire, api_key, timeout=timeout)
        except httpx.HTTPError as exc:
            attempts.append((model, f"{type(exc).__name__}: {exc}"[:200]))
            logger.warning("chat_with_chain_sync(%s): %s failed (%s); trying next model",
                           use_case, model, attempts[-1][1])
            continue
        result, reason = _parse_completion(model, _router_of(response), response, attempts)
        if result is not None:
            return result
        attempts.append((model, reason))
        logger.warning("chat_with_chain_sync(%s): %s failed (%s); trying next model", use_case, model, reason)
    raise ChainExhausted(use_case, attempts)


def _router_of(response) -> str:
    """Which gateway answered, from the request URL (post_chat hides the route)."""
    try:
        url = str(response.request.url)
    except Exception:  # noqa: BLE001
        return DEFAULT_ROUTER
    for name, spec in ROUTERS.items():
        if name == DEFAULT_ROUTER:
            continue
        try:
            if url.startswith(spec.chat_url().rsplit("/chat/completions", 1)[0]):
                return name
        except Exception:  # noqa: BLE001
            continue
    return DEFAULT_ROUTER


__all__ = [
    "ROUTERS", "ROUTES_SETTING_KEY", "ChatRoute", "parse_routes", "model_routes",
    "route_for", "route_chat", "openrouter_chat", "should_fail_over", "mark_router_failed",
    "note_route_failure", "send", "send_sync", "open_stream", "anthropic_wire_model",
    "probe_anthropic_route",
    "post_chat", "post_chat_sync", "open_chat_stream",
    "REASONING_MANDATORY_PREFIXES", "ChainExhausted", "ChainResult", "chain_payload",
    "chat_with_chain", "chat_with_chain_sync",
]
