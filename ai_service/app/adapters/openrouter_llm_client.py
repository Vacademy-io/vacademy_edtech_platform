from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, AsyncGenerator, Tuple

import httpx
import json
import os

from ..config import get_settings
from ..constants.model_defaults import GLM_DEFAULT
from ..ports.llm_client import OutlineLLMClient
from ..core.exceptions import PaymentRequiredError
from ..services.llm_router import post_chat

logger = logging.getLogger(__name__)


class OpenRouterOutlineLLMClient(OutlineLLMClient):
    """
    HTTP-based OutlineLLMClient implementation using a generic OpenRouter-style API.

    All concrete details (base URL, API key, default model, timeouts) are configurable
    via environment variables. You can adapt this to any provider by adjusting the
    request payload format and headers.
    
    A call without a model runs the `use_case` row of ai_model_defaults
    (default 'chat'; GLM + its fallback), resolved through model_selection —
    not the registry's nondeterministic recommended_models[0].
    """
    
    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        default_model: Optional[str] = None,
        timeout_seconds: float = 1200.0,  # 20 minutes for long content generation
        use_case: str = "chat",
    ) -> None:
        settings = get_settings()
        self._base_url = base_url or getattr(settings, "llm_base_url", "")
        self._api_key = api_key or getattr(settings, "openrouter_api_key", "")
        # Explicit ctor model only; otherwise the use-case row decides per call.
        self._explicit_default_model = default_model
        self._default_model = default_model or getattr(settings, "llm_default_model", None) or GLM_DEFAULT
        self._use_case = use_case
        self._timeout_seconds = timeout_seconds

    async def _models_for(
        self,
        model: Optional[str],
        use_case: Optional[str],
        fallback_models: Optional[List[str]],
    ) -> List[str]:
        """Ordered models to try. An explicit model is honoured as-is (plus
        any fallback chain the caller passed); a model-less call resolves the
        use case (row default + fallback, NON_GLM tail) — never a registry
        'recommended' list."""
        if model:
            chain = [model]
        elif self._explicit_default_model and not use_case:
            chain = [self._explicit_default_model]
        else:
            try:
                from ..services.model_selection import resolve_model_sync
                primary, fallbacks = await asyncio.to_thread(
                    resolve_model_sync, use_case or self._use_case
                )
                chain = [primary, *fallbacks]
            except Exception as exc:  # noqa: BLE001
                logger.warning("use-case model lookup failed (%s); using %s", exc, self._default_model)
                chain = [self._default_model]
        for candidate in fallback_models or []:
            if candidate and candidate not in chain:
                chain.append(candidate)
        return chain

    async def generate_outline(
        self, 
        prompt: str, 
        model: str | None, 
        api_key: str | None = None,
        *,
        use_case: str | None = None,
        fallback_models: List[str] | None = None,
    ) -> str | Tuple[str, Dict[str, int]]:
        """
        Generate outline using regular (non-streaming) API call with free model fallback.
        
        Args:
            prompt: The prompt to send to the LLM
            model: Optional model to use (overrides default)
            api_key: Optional API key to use (overrides instance default)
        
        Returns:
            If return_usage=True: Tuple of (content, usage_dict)
            Otherwise: Just the content string (backward compatible)
        """
        return await self._generate_outline_with_usage(
            prompt, model, api_key, return_usage=False,
            use_case=use_case, fallback_models=fallback_models,
        )
    
    async def generate_outline_with_usage(
        self, 
        prompt: str, 
        model: str | None, 
        api_key: str | None = None,
        *,
        use_case: str | None = None,
        fallback_models: List[str] | None = None,
    ) -> Tuple[str, Dict[str, int]]:
        """
        Generate outline and return both content and token usage.
        
        Args:
            prompt: The prompt to send to the LLM
            model: Optional model to use (overrides default)
            api_key: Optional API key to use (overrides instance default)
        
        Returns:
            Tuple of (content, usage_dict) where usage_dict contains:
            - prompt_tokens: int
            - completion_tokens: int
            - total_tokens: int
        """
        return await self._generate_outline_with_usage(
            prompt, model, api_key, return_usage=True,
            use_case=use_case, fallback_models=fallback_models,
        )
    
    async def _generate_outline_with_usage(
        self, 
        prompt: str, 
        model: str | None, 
        api_key: str | None = None,
        return_usage: bool = False,
        use_case: str | None = None,
        fallback_models: List[str] | None = None,
    ) -> str | Tuple[str, Dict[str, int]]:
        """
        Internal method to generate outline with optional usage tracking.
        """
        # Use provided API key or fall back to instance default
        effective_api_key = api_key or self._api_key
        
        # Determine which models to try
        models_to_try = await self._models_for(model, use_case, fallback_models)
        
        last_error = None
        for model_to_use in models_to_try:
            try:
                payload = self._build_payload(prompt=prompt, model=model_to_use, stream=False)
                response = await self._post_routed(payload, effective_api_key)
                response.raise_for_status()
                data: Dict[str, Any] = response.json()

                # Extract content
                try:
                    content = data["choices"][0]["message"]["content"]
                except Exception:
                    # Fallback: return raw JSON string
                    content = response.text
                
                # Extract usage information if available
                usage_info = {}
                if "usage" in data:
                    usage = data["usage"]
                    usage_info = {
                        "prompt_tokens": usage.get("prompt_tokens", 0),
                        "completion_tokens": usage.get("completion_tokens", 0),
                        "total_tokens": usage.get("total_tokens", 0),
                    }
                else:
                    # Default to 0 if usage not available
                    usage_info = {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                    }
                
                if return_usage:
                    return content, usage_info
                else:
                    return content
                    
            except httpx.HTTPStatusError as exc:
                # HTTP 402 Payment Required is fatal — no fallback model will help
                # if the API key has insufficient credits. Raise immediately.
                if exc.response.status_code == 402:
                    raise PaymentRequiredError(
                        "OpenRouter API returned 402 Payment Required. "
                        "The configured API key has insufficient credits or the "
                        "free-tier quota has been exhausted. Please top up your "
                        "OpenRouter account or configure a valid API key."
                    ) from exc
                last_error = exc
                # If this is not the last model, continue to next
                if model_to_use != models_to_try[-1]:
                    continue
                # Last model failed, raise the error
                raise
            except Exception as exc:
                last_error = exc
                # If this is not the last model, continue to next
                if model_to_use != models_to_try[-1]:
                    continue
                # Last model failed, raise the error
                raise
        
        # Should never reach here, but just in case
        if last_error:
            raise last_error
        raise RuntimeError("No models available to try")

    async def stream_outline(self, prompt: str, model: str | None, api_key: str | None = None) -> AsyncGenerator[str, None]:
        """
        Generate outline using streaming API call (matches media-service pattern).
        
        Args:
            prompt: The prompt to send to the LLM
            model: Optional model to use (overrides default)
            api_key: Optional API key to use (overrides instance default)
        """
        # For now, use non-streaming API for simplicity
        result = await self.generate_outline(prompt, model, api_key=api_key)
        yield result

    async def _post_routed(self, payload: Dict[str, Any], api_key: str | None) -> httpx.Response:
        """POST through the model's gateway (llm_router); a routed gateway that
        is down or refuses is retried once on OpenRouter."""
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            return await post_chat(client, payload, api_key or self._api_key)

    def _build_payload(self, prompt: str, model: str, stream: bool = False) -> Dict[str, Any]:
        payload = {
            "model": model,
            "messages": [
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
        }
        if stream:
            payload["stream"] = True
        return payload

    def _build_headers(self, api_key: str | None = None) -> Dict[str, str]:
        """
        Build HTTP headers for API requests.
        
        Args:
            api_key: Optional API key to use (overrides instance default)
        """
        headers = {"Content-Type": "application/json"}
        effective_key = api_key or self._api_key
        if effective_key:
            headers["Authorization"] = f"Bearer {effective_key}"
        return headers


__all__ = ["OpenRouterOutlineLLMClient"]


