"""
LLM client. All completions run through OpenRouter (the direct-Gemini
fallback was retired — that key was free-tier with a zero image quota, and
text now runs exclusively through the billed OpenRouter account).
"""
from __future__ import annotations

import json
import logging
from typing import AsyncGenerator, Dict, Any, List, Optional, Tuple
import httpx

from ..services.api_key_resolver import ApiKeyResolver
from ..constants.model_defaults import GLM_DEFAULT
from .llm_router import note_route_failure, open_stream, openrouter_chat, route_chat, send, should_fail_over

logger = logging.getLogger(__name__)


# How to call a model whose endpoint refuses `reasoning: {enabled: false}`
# ("Reasoning is mandatory for this endpoint and cannot be disabled" —
# z-ai/glm-5.3-flash, 2026-09-04). Learned per process from the first failure
# (and pre-seeded by the portal's save-time probe): "on" sends reasoning
# explicitly enabled — exactly the shape the owner's working curl used —
# and "on-no-temp" additionally drops `temperature`, for endpoints that reject
# sampling parameters in thinking mode.
# Models whose endpoint REFUSES `reasoning: {enabled: false}` and, worse, spend
# the whole `max_tokens` budget thinking when no reasoning shape is sent at all.
# Seeding them here (rather than waiting for the portal probe) matters because
# the probe only runs for clients with reasoning suppression ON, while
# copy-check grading runs with it OFF — so nothing ever told the client which
# shape to use and every call came back with empty content. Measured on
# z-ai/glm-5.3-flash reading one answer-sheet page (2026-09-09):
#   no reasoning key -> 2,996 reasoning tokens, 0 content, finish_reason=length
#   "on-low"         ->     5 reasoning tokens, 935 chars of correct transcript
# A learned mode from a live failure still overwrites these.
_REASONING_MODE: Dict[str, str] = {
    "z-ai/glm-5.3-flash": "on-low",
    "z-ai/glm-5.3-flash:batch": "on-low",
    "z-ai/glm-5.3": "on-low",
    "z-ai/glm-4.6v": "on-low",
}
_REASONING_ON_MIN_TOKENS = 3000
# Thinking tokens count against max_tokens. A compile that asked for 12k output
# tokens got 3 x 12k of "length"-truncated replies from glm-5.3-flash (2026-09-05)
# because the model spent the budget thinking. Reasoning-on variants therefore
# get an allowance on top of the caller's cap, and try a low effort first.
_REASONING_ALLOWANCE_MIN = 2000
_REASONING_ALLOWANCE_MAX = 12000
_REASONING_MODES = ("on-low", "on", "on-no-temp")

# A model whose every variant failed is skipped for a while: the fallback
# answers directly instead of every turn paying for three rejected attempts.
_BROKEN_UNTIL: Dict[str, float] = {}
_BROKEN_TTL_SECONDS = 300.0


def openrouter_error_text(raw: str) -> str:
    """The provider's actual complaint. OpenRouter wraps upstream errors as
    'Provider returned error' and puts the real text in error.metadata.raw."""
    try:
        data = json.loads(raw or "")
        err = data.get("error") or {}
        msg = err.get("message") or ""
        meta = err.get("metadata") or {}
        upstream = meta.get("raw")
        if isinstance(upstream, (dict, list)):
            upstream = json.dumps(upstream)
        provider = meta.get("provider_name")
        parts = [msg]
        if upstream:
            parts.append(f"provider said: {str(upstream)[:220]}")
        if provider:
            parts.append(f"[{provider}]")
        text = " — ".join(p for p in parts if p)
        return text or (raw or "")[:300]
    except Exception:
        return (raw or "")[:300]


def _mandatory_reasoning_error(body: str) -> bool:
    b = (body or "").lower()
    return "reasoning is mandatory" in b or "cannot be disabled" in b or ("reasoning" in b and "disable" in b)


def mark_reasoning_required(model: str, mode: str = "on") -> None:
    _REASONING_MODE[model] = mode if mode in _REASONING_MODES else "on"


def reasoning_mode_for(model: str) -> Optional[str]:
    return _REASONING_MODE.get(model)


def apply_reasoning_mode(payload: Dict[str, Any], mode: str) -> Dict[str, Any]:
    p = dict(payload)
    p["reasoning"] = {"enabled": True, "effort": "low"} if mode == "on-low" else {"enabled": True}
    requested = int(p.get("max_tokens") or 0)
    allowance = min(max(requested, _REASONING_ALLOWANCE_MIN), _REASONING_ALLOWANCE_MAX)
    p["max_tokens"] = max(requested, _REASONING_ON_MIN_TOKENS) + allowance
    if mode == "on-no-temp":
        p.pop("temperature", None)
    return p


def payload_variants(model: str, base: Dict[str, Any]) -> List[Tuple[str, Dict[str, Any]]]:
    """Ordered (label, payload) attempts for one call."""
    known = _REASONING_MODE.get(model)
    if known:
        return [(known, apply_reasoning_mode(base, known))]
    variants = [("as-configured", base)]
    if (base.get("reasoning") or {}).get("enabled") is False:
        variants += [(m, apply_reasoning_mode(base, m)) for m in _REASONING_MODES]
    return variants


def should_try_next_variant(label: str, error_text: str) -> bool:
    # Only escalate from the configured shape when the provider said reasoning
    # is mandatory; once we are in reasoning-on territory, try the next shape.
    if label == "as-configured":
        return _mandatory_reasoning_error(error_text)
    return True


def mark_model_broken(model: str) -> None:
    import time
    _BROKEN_UNTIL[model] = time.monotonic() + _BROKEN_TTL_SECONDS


# Errors that say the MODEL is unusable (unknown id, no endpoint serves it,
# no access) — as opposed to one request failing (timeout, 429, 5xx, a 400
# about this payload). Only these park a model for _BROKEN_TTL_SECONDS: with
# GLM as the platform default, parking it on a one-off failure would move every
# default-model caller on the pod to the fallback for five minutes.
_MODEL_LEVEL_ERROR_MARKERS = (
    "not a valid model",
    "model not found",
    "model_not_found",
    "no endpoints found",
    "no allowed providers",
    "is not available",
    "does not exist",
)


def is_model_level_error(error_text: str) -> bool:
    text = (error_text or "").lower()
    if " 404 " in f" {text} " or "openrouter 404" in text or "status: 404" in text:
        return True
    return any(marker in text for marker in _MODEL_LEVEL_ERROR_MARKERS)


def is_model_broken(model: str) -> bool:
    import time
    until = _BROKEN_UNTIL.get(model)
    if until is None:
        return False
    if time.monotonic() >= until:
        _BROKEN_UNTIL.pop(model, None)
        return False
    return True


def _mode_note(mode: str) -> str:
    detail = {
        "on-low": " at low effort",
        "on": "",
        "on-no-temp": " and without a temperature parameter",
    }.get(mode, "")
    return f"this endpoint requires reasoning; running with reasoning on{detail} (output cap raised to leave room for thinking)"


def ensure_user_turn(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The agent speaks first (greeting, voice opening turn), so some calls carry
    only a system message. Gemini via OpenRouter tolerates that; GLM/Z.AI-style
    providers reject a conversation with no user turn (400, 'Provider returned
    error'). Append a minimal user turn in that case — never otherwise."""
    if not messages:
        return messages
    if any(m.get("role") in ("user", "tool") for m in messages):
        return messages
    return list(messages) + [{"role": "user", "content": "Begin."}]


class _AttemptRejected(Exception):
    """OpenRouter answered 4xx to one payload variant (status + provider text)."""

    def __init__(self, status: int, body: str):
        super().__init__(f"OpenRouter {status}: {body}")
        self.status = status
        self.body = body


class _RouteUnavailable(Exception):
    """A routed gateway (not OpenRouter) was unreachable or refused before any
    token arrived; the caller retries the same request on OpenRouter.
    `status` is the gateway's HTTP status (None = no response at all)."""

    def __init__(self, message: str = "", status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class ChatLLMClient:
    """
    Handles LLM calls through OpenRouter. Supports tool calling for
    agentic behavior.
    """
    
    def __init__(
        self,
        api_key_resolver: ApiKeyResolver,
        disable_reasoning: bool = False,
        platform_model_key: Optional[str] = None,
        provider_prefs: Optional[Dict[str, Any]] = None,
    ):
        """
        disable_reasoning: send `reasoning: {"enabled": false}` so the provider
            does not spend hidden reasoning tokens before answering.

            OFF BY DEFAULT AND DELIBERATELY SO. This client is shared by
            assessment generation, coding-question generation, the page builder,
            the admin assistant and copy-check grading — reasoning is worth
            paying for there, and copy-check in particular grades real student
            answer sheets, where suppressing it could cost accuracy on marks.

            Only the learner text chatbot opts in (see
            AiChatAgentService._make_llm_client): its median message is 23
            characters and most turns are greetings, "yes"/"idk" and quiz
            acknowledgements, so reasoning is pure latency and cost there.
        """
        self.api_key_resolver = api_key_resolver
        self.disable_reasoning = disable_reasoning
        # Name of the platform setting (super-admin portal) whose value is the
        # default model for this client, e.g. "chatbot.text.model". None keeps
        # the env default — right for every consumer that isn't the chatbot.
        self.platform_model_key = platform_model_key
        # OpenRouter's `provider` routing object, e.g. {"zdr": True} to allow
        # only zero-data-retention endpoints. OpenRouter-only: llm_router drops
        # it for any other gateway. None = OpenRouter's default routing.
        self.provider_prefs = dict(provider_prefs) if provider_prefs else None
        self.http_client = httpx.AsyncClient(timeout=120.0)

    @staticmethod
    def _fallback_model_for(model: str, explicit_model: Optional[str]) -> Optional[str]:
        """
        The env failover model (LLM_FALLBACK_MODEL — a different vendor than
        the GLM default, so GLM never fails over to itself), or the env default
        when the failing model IS the fallback model. None when the caller
        pinned the model on purpose without a chain (an explicit override —
        escalation to a stronger model — should fail loudly, not silently
        downgrade); pass fallback_models to fail over an explicit model.
        """
        if explicit_model:
            return None
        try:
            from ..config import get_settings
            settings = get_settings()
            candidates = (
                getattr(settings, "llm_fallback_model", None),
                getattr(settings, "llm_default_model", None),
            )
        except Exception:
            return None
        for candidate in candidates:
            if candidate and candidate != model:
                return candidate
        return None

    @classmethod
    def _fallback_chain(
        cls,
        model: str,
        explicit_model: Optional[str],
        fallback_models: Optional[List[str]],
    ) -> List[str]:
        """Models to try, in order, after `model` fails. An explicit
        fallback_models list (a use-case chain from model_selection) wins and
        applies even to an explicitly passed model; otherwise the env failover
        (see _fallback_model_for)."""
        if fallback_models is not None:
            chain: List[str] = []
            for candidate in fallback_models:
                if candidate and candidate != model and candidate not in chain:
                    chain.append(candidate)
            return chain
        fallback = cls._fallback_model_for(model, explicit_model)
        return [fallback] if fallback else []

    @staticmethod
    def _note_model_failure(model: str, reason: str, fallback: Optional[str]) -> None:
        try:
            from .platform_settings_service import record_model_failure
            record_model_failure(model, reason, fallback)
        except Exception:
            pass

    @staticmethod
    def _note_model_note(model: str, note: str) -> None:
        try:
            from .platform_settings_service import record_model_note
            record_model_note(model, note)
        except Exception:
            pass

    @staticmethod
    def _note_model_ok(model: str) -> None:
        try:
            from .platform_settings_service import record_model_success
            record_model_success(model)
        except Exception:
            pass

    def _resolve(self, institute_id: Optional[str], user_id: Optional[str]):
        """
        resolve_keys with the platform-default hint, tolerating resolvers that
        don't know it. The chatbot and the assistant hand this client duck-typed
        resolvers that return pre-fetched keys; passing them an unexpected
        keyword took the learner chatbot down for every institute (2026-09-03).
        """
        base = {"institute_id": institute_id or "default", "user_id": user_id}
        if not self.platform_model_key:
            return self.api_key_resolver.resolve_keys(**base)
        try:
            return self.api_key_resolver.resolve_keys(
                **base, platform_default_key=self.platform_model_key
            )
        except TypeError:
            return self.api_key_resolver.resolve_keys(**base)
    
    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.3,
        max_tokens: int = 1500,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        model: Optional[str] = None,
        fallback_models: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Call LLM with tool support, trying providers in priority order.

        Args:
            messages: List of message dicts with role and content
            tools: Optional list of tool definitions
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            institute_id: Optional institute ID for key resolution
            user_id: Optional user ID for key resolution
            model: Optional explicit model override — when supplied, takes
                priority over the resolver's choice (used by copy-check to
                escalate flagged questions to a stronger model).
            fallback_models: Optional ordered failover chain (e.g. the rest of
                model_selection.resolve_models' chain). When given it is used
                even for an explicit model; when None, only an implicit model
                fails over (to LLM_FALLBACK_MODEL).

        Returns:
            Response dict with content, tool_calls, finish_reason, etc.
        """
        # Resolve keys. gemini_key is ignored — the Gemini fallback was retired.
        openrouter_key, _gemini_key, resolved_model = self._resolve(institute_id, user_id)
        # Caller override wins over the resolver's pick.
        explicit_model = model
        model = model or resolved_model

        # Track per-provider failure reasons so the final exception surfaces
        # actionable detail (e.g. "Gemini: 403 PERMISSION_DENIED") instead of
        # the misleading "no API keys available" — which was wrong whenever
        # keys WERE present but providers rejected them.
        failures: List[str] = []

        # Try OpenRouter first (primary provider)
        if openrouter_key:
            chain = self._fallback_chain(model, explicit_model, fallback_models)
            # A model that failed every variant recently is skipped for a while:
            # the fallback answers directly instead of each turn paying for the
            # rejected attempts first.
            if chain and is_model_broken(model):
                logger.warning(f"Model {model} marked broken; answering with {chain[0]}")
                result = await self._call_openrouter(
                    messages, tools, temperature, max_tokens, openrouter_key, chain[0]
                )
                result["fallback_from"] = model
                return result
            try:
                logger.info(f"Attempting OpenRouter API call with model: {model}")
                result = await self._call_openrouter(messages, tools, temperature, max_tokens, openrouter_key, model)
                self._note_model_ok(model)
                return result
            except Exception as e:
                logger.warning(f"OpenRouter failed: {e}")
                failures.append(f"OpenRouter: {e}")
                # A model chosen in the portal / institute settings that OpenRouter
                # rejects must not take the chatbot down: answer with the next
                # model in the chain and record why, so the portal can show it.
                if chain:
                    if is_model_level_error(str(e)):
                        mark_model_broken(model)
                    self._note_model_failure(model, str(e), chain[0])
                for fallback in chain:
                    try:
                        logger.error(
                            f"Model {model} failed; falling back to {fallback} for this call"
                        )
                        result = await self._call_openrouter(
                            messages, tools, temperature, max_tokens, openrouter_key, fallback
                        )
                        result["fallback_from"] = model
                        return result
                    except Exception as e2:
                        logger.warning(f"OpenRouter fallback {fallback} failed too: {e2}")
                        failures.append(f"OpenRouter fallback {fallback}: {e2}")
        else:
            failures.append("OpenRouter: no key configured")

        raise Exception("All LLM providers failed - " + "; ".join(failures))
    
    def _convert_to_multimodal_messages(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert messages with attachments to OpenAI multimodal format."""
        converted = []
        for msg in messages:
            attachments = msg.get("attachments")
            if attachments and msg.get("role") == "user":
                content_parts = []
                if msg.get("content"):
                    content_parts.append({"type": "text", "text": msg["content"]})
                for att in attachments:
                    if att.get("type") == "image":
                        content_parts.append({
                            "type": "image_url",
                            "image_url": {"url": att["url"]}
                        })
                converted.append({
                    "role": msg["role"],
                    "content": content_parts if content_parts else msg.get("content", ""),
                })
            else:
                # Strip attachments key for non-multimodal messages
                clean_msg = {k: v for k, v in msg.items() if k != "attachments"}
                converted.append(clean_msg)
        return converted

    async def _call_openrouter(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]],
        temperature: float,
        max_tokens: int,
        api_key: str,
        model: str = GLM_DEFAULT,
        force_openrouter: bool = False,
    ) -> Dict[str, Any]:
        """Call the model through its gateway (OpenRouter unless the route map
        says otherwise — see llm_router). A routed gateway that is down or
        refuses the key is retried on OpenRouter before anything else reacts,
        so a gateway outage never marks the MODEL broken."""
        # Check for multimodal content and convert if needed
        has_attachments = any(msg.get("attachments") for msg in messages)
        if has_attachments:
            messages = self._convert_to_multimodal_messages(messages)

        payload = {
            "model": model,
            "messages": ensure_user_turn(messages),
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        # Per-client opt-in only — see __init__. Never global: this client also
        # serves copy-check grading and assessment generation, where reasoning earns
        # its cost. Models known to require reasoning are handled by payload_variants.
        if self.disable_reasoning:
            payload["reasoning"] = {"enabled": False}
        if self.provider_prefs:
            payload["provider"] = dict(self.provider_prefs)

        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        response = None
        route = None
        variants = payload_variants(model, payload)
        for index, (label, attempt) in enumerate(variants):
            if force_openrouter:
                url, headers, wire, route = openrouter_chat(attempt, api_key)
            else:
                url, headers, wire, route = route_chat(attempt, api_key, allow_translated=True)
            try:
                if route.is_translated:
                    # Direct Anthropic: translated request, OpenAI-shaped reply.
                    response = await send(self.http_client, route, wire)
                else:
                    response = await self.http_client.post(url, json=wire, headers=headers)
            except httpx.TransportError as exc:
                if route.is_default:
                    raise
                logger.warning(f"{route.label} unreachable for {model} ({exc}); retrying on OpenRouter")
                note_route_failure(route, None)
                return await self._call_openrouter(messages, tools, temperature, max_tokens, api_key, model, True)
            if should_fail_over(route, response.status_code):
                logger.warning(
                    f"{route.label} {response.status_code} for {model}: "
                    f"{openrouter_error_text(response.text)}; retrying on OpenRouter"
                )
                note_route_failure(route, response.status_code)
                return await self._call_openrouter(messages, tools, temperature, max_tokens, api_key, model, True)

            if response.status_code == 402:
                error_body = response.text
                logger.error(
                    f"OpenRouter 402 Payment Required - insufficient credits or quota exceeded. "
                    f"Model: {model}, Status: {response.status_code}, Response: {error_body}"
                )
                raise Exception(
                    f"OpenRouter 402 Payment Required: insufficient credits or quota exceeded. "
                    f"Model: {model}. Details: {error_body}"
                )

            if response.status_code >= 400:
                # raise_for_status() would drop the body — and the body is the
                # only place the provider says WHY. Keep it: it is what the logs,
                # model_health and the portal show.
                err = openrouter_error_text(response.text)
                is_last = index == len(variants) - 1
                logger.warning(f"OpenRouter {response.status_code} for {model} [{label}]: {err}")
                if not is_last and 400 <= response.status_code < 500 and should_try_next_variant(label, err):
                    continue
                raise Exception(f"OpenRouter {response.status_code} for {model} [{label}]: {err}")

            if label != "as-configured" and reasoning_mode_for(model) != label:
                # A reasoning-on variant answered where the configured shape
                # failed: remember it so the next call skips the rejected attempt.
                mark_reasoning_required(model, label)
                self._note_model_note(model, _mode_note(label))
            break

        data = response.json()
        choice = data["choices"][0]
        message = choice["message"]

        return {
            "content": message.get("content", ""),
            "tool_calls": message.get("tool_calls"),
            "finish_reason": choice.get("finish_reason"),
            # "openrouter" = OpenAI-shaped usage; billing keys on it. Every
            # gateway here speaks that shape, so it stays whichever served.
            "provider": "openrouter",
            "router": route.router if route else "openrouter",
            "usage": data.get("usage"),
            # A routed gateway echoes its own id (glm-5.3-flash); billing and
            # model health need the registry id.
            "model": data.get("model", model) if (route is None or route.is_default) else model,
        }
    
    async def chat_completion_stream(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.3,
        max_tokens: int = 1500,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        model: Optional[str] = None,
        fallback_models: Optional[List[str]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Stream LLM response token-by-token.
        Yields dicts: {"type": "token", "content": "..."} or {"type": "tool_calls", "tool_calls": [...]} or {"type": "done", "usage": {...}}
        — exactly one "done" per stream, carrying the usage if the gateway sent any.
        Falls back to non-streaming if streaming fails.

        model / fallback_models: same meaning as in chat_completion — an
        explicit model beats the resolver's pick (a BYO institute/user default
        model is only the resolver's pick, so callers that must honour it
        resolve it first), and the chain is used for failover.
        """
        openrouter_key, _gemini_key, resolved_model = self._resolve(institute_id, user_id)
        explicit_model = model
        model = model or resolved_model

        if openrouter_key:
            stream_model = model
            chain = self._fallback_chain(model, explicit_model, fallback_models)
            if chain and is_model_broken(model):
                logger.warning(f"Model {model} marked broken; streaming with {chain[0]}")
                stream_model = chain[0]
            try:
                async for chunk in self._stream_openrouter(messages, tools, temperature, max_tokens, openrouter_key, stream_model):
                    yield chunk
                return
            except Exception as e:
                logger.warning(f"OpenRouter streaming failed: {e}")
                if stream_model == model:
                    self._note_model_failure(model, f"streaming: {e}", None)

        # Fallback to non-streaming (which walks the failover chain if the
        # configured model is what the gateway rejects)
        response = await self.chat_completion(
            messages, tools, temperature, max_tokens, institute_id, user_id,
            model=explicit_model, fallback_models=fallback_models,
        )
        if response.get("content"):
            yield {"type": "token", "content": response["content"]}
        if response.get("tool_calls"):
            yield {"type": "tool_calls", "tool_calls": response["tool_calls"]}
        yield {"type": "done", "usage": response.get("usage"), "model": response.get("model"), "provider": response.get("provider")}

    async def _stream_openrouter(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]],
        temperature: float,
        max_tokens: int,
        api_key: str,
        model: str = GLM_DEFAULT,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream from OpenRouter using SSE."""
        # Check for multimodal content and convert if needed
        has_attachments = any(msg.get("attachments") for msg in messages)
        if has_attachments:
            messages = self._convert_to_multimodal_messages(messages)

        payload = {
            "model": model,
            "messages": ensure_user_turn(messages),
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        # Per-client opt-in only — see __init__. Models known to require
        # reasoning are handled by payload_variants.
        if self.disable_reasoning:
            payload["reasoning"] = {"enabled": False}
        if self.provider_prefs:
            payload["provider"] = dict(self.provider_prefs)

        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        # One streaming request per variant. The status is checked before any
        # token is yielded, so moving to the next variant never duplicates
        # output — and never leaves two streams open for one turn.
        variants = payload_variants(model, payload)
        for index, (label, attempt) in enumerate(variants):
            url, headers, wire, route = route_chat(attempt, api_key, allow_translated=True)
            try:
                try:
                    async for chunk in self._stream_openrouter_once(url, headers, wire, model, route):
                        yield chunk
                except _RouteUnavailable as unavailable:
                    # Raised before the first token, so nothing is duplicated.
                    logger.warning(f"{route.label} failed for {model} (streaming): {unavailable}; retrying on OpenRouter")
                    note_route_failure(route, unavailable.status)
                    url, headers, wire, route = openrouter_chat(attempt, api_key)
                    async for chunk in self._stream_openrouter_once(url, headers, wire, model, route):
                        yield chunk
                if label != "as-configured" and reasoning_mode_for(model) != label:
                    mark_reasoning_required(model, label)
                    self._note_model_note(model, _mode_note(label))
                return
            except _AttemptRejected as rejected:
                is_last = index == len(variants) - 1
                logger.warning(f"OpenRouter {rejected.status} for {model} (streaming) [{label}]: {rejected.body}")
                if is_last or not should_try_next_variant(label, rejected.body):
                    raise Exception(f"OpenRouter {rejected.status} for {model} [{label}]: {rejected.body}")

    async def _stream_openrouter_once(
        self,
        url: str,
        headers: Dict[str, str],
        payload: Dict[str, Any],
        model: str,
        route=None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """A single streaming request. Raises _AttemptRejected on a 4xx (with
        the provider's text) so the caller can try the next payload variant,
        and _RouteUnavailable — before any token — when a routed gateway is
        unreachable or refuses, so the caller can retry on OpenRouter."""
        accumulated_tool_calls = {}  # index -> {id, function: {name, arguments}}
        routed = route is not None and not route.is_default
        # Usage arrives in its own chunk just before [DONE] (or on the last
        # choice chunk). Keep it and emit ONE "done" carrying it: consumers keep
        # the last "done", and a second usage-less one used to drop the usage.
        usage_seen: Optional[Dict[str, Any]] = None
        usage_model: str = model

        def _done() -> Dict[str, Any]:
            return {"type": "done", "usage": usage_seen, "model": usage_model, "provider": "openrouter"}

        def _tool_calls_event() -> Optional[Dict[str, Any]]:
            if not accumulated_tool_calls:
                return None
            return {
                "type": "tool_calls",
                "tool_calls": [accumulated_tool_calls[i] for i in sorted(accumulated_tool_calls.keys())],
            }

        if route is not None and route.is_translated:
            # Direct Anthropic: a response whose body is OpenAI SSE.
            stream_cm = open_stream(self.http_client, route, payload)
        else:
            stream_cm = self.http_client.stream("POST", url, json=payload, headers=headers)
        try:
            response = await stream_cm.__aenter__()
        except httpx.TransportError as exc:
            if routed:
                raise _RouteUnavailable(str(exc)) from exc
            raise
        try:
            if routed and should_fail_over(route, response.status_code):
                body = (await response.aread())[:300].decode("utf-8", "ignore")
                raise _RouteUnavailable(f"{response.status_code}: {openrouter_error_text(body)}",
                                        response.status_code)
            if response.status_code == 402:
                raise Exception(f"OpenRouter 402 Payment Required")
            if 400 <= response.status_code < 500:
                body = (await response.aread())[:600].decode("utf-8", "ignore")
                raise _AttemptRejected(response.status_code, openrouter_error_text(body))
            if response.status_code >= 500:
                body = (await response.aread())[:300].decode("utf-8", "ignore")
                logger.error(f"OpenRouter {response.status_code} for {model} (streaming): {body}")
                raise Exception(f"OpenRouter {response.status_code} for {model}: {body}")

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str.strip() == "[DONE]":
                    # Yield accumulated tool calls if any
                    tool_event = _tool_calls_event()
                    if tool_event:
                        yield tool_event
                    yield _done()
                    return

                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                if chunk.get("usage"):
                    usage_seen = chunk["usage"]
                    # A routed gateway echoes its own wire id; billing needs the
                    # registry id.
                    usage_model = model if routed else (chunk.get("model") or model)

                if not chunk.get("choices"):
                    continue

                delta = chunk["choices"][0].get("delta", {})

                # Token content
                if delta.get("content"):
                    yield {"type": "token", "content": delta["content"]}

                # Tool calls (accumulated across chunks)
                if delta.get("tool_calls"):
                    for tc_delta in delta["tool_calls"]:
                        idx = tc_delta.get("index", 0)
                        if idx not in accumulated_tool_calls:
                            accumulated_tool_calls[idx] = {
                                "id": tc_delta.get("id", ""),
                                "type": "function",
                                "function": {"name": "", "arguments": ""}
                            }
                        if tc_delta.get("id"):
                            accumulated_tool_calls[idx]["id"] = tc_delta["id"]
                        func = tc_delta.get("function", {})
                        if func.get("name"):
                            accumulated_tool_calls[idx]["function"]["name"] = func["name"]
                        if func.get("arguments"):
                            accumulated_tool_calls[idx]["function"]["arguments"] += func["arguments"]
            # Stream closed without [DONE]: still hand over the tool calls and
            # the usage that did arrive (one "done", as above).
            tool_event = _tool_calls_event()
            if tool_event:
                yield tool_event
            yield _done()
        finally:
            await stream_cm.__aexit__(None, None, None)

    async def close(self):
        """Close the HTTP client."""
        await self.http_client.aclose()


__all__ = ["ChatLLMClient"]
