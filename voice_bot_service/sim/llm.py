"""One async chat call for every LLM the bot can run on, keyed by a model spec:

    vertex:gemini-2.5-flash            (Vertex, VERTEX_* settings, thinking off)
    vertex:gemini-2.5-flash@global     (other location after '@')
    sarvam:sarvam-105b                 (Sarvam v1 chat, reasoning off)
    openrouter:anthropic/claude-sonnet-4.5
    zai:glm-5.3-flash
    bedrock:moonshotai.kimi-k2.5       (ap-south-1, bearer token)

Returns (text, ttft_seconds). Streaming everywhere so TTFT means what it means
on a call. No pipecat — this is the vendor API, nothing else."""
from __future__ import annotations

import json
import os
import time
from typing import Dict, List, Tuple

import httpx


def _openai_compatible(base_url: str, api_key: str, model: str, extra: dict | None,
                       headers: dict | None = None):
    async def call(system: str, messages: List[Dict[str, str]], max_tokens: int, temperature: float):
        body = {"model": model, "stream": True, "max_tokens": max_tokens, "temperature": temperature,
                "messages": [{"role": "system", "content": system}] + messages}
        if extra:
            body.update(extra)
        t0 = time.perf_counter(); first = None; text = ""
        async with httpx.AsyncClient(timeout=90) as c:
            async with c.stream("POST", f"{base_url.rstrip('/')}/chat/completions",
                                headers=headers or {"Authorization": f"Bearer {api_key}"},
                                json=body) as r:
                if r.status_code != 200:
                    raise RuntimeError(f"{model}: HTTP {r.status_code} {(await r.aread())[:200]!r}")
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    d = line[5:].strip()
                    if d == "[DONE]":
                        break
                    try:
                        j = json.loads(d)
                    except Exception:
                        continue
                    ch = j.get("choices") or []
                    if not ch:
                        continue
                    piece = (ch[0].get("delta") or {}).get("content") or ""
                    if piece:
                        if first is None:
                            first = time.perf_counter() - t0
                        text += piece
        return text.strip(), (first if first is not None else time.perf_counter() - t0)
    return call


def _vertex(model: str, location: str):
    from app.config import get_settings
    s = get_settings()

    async def call(system: str, messages: List[Dict[str, str]], max_tokens: int, temperature: float):
        import google.oauth2.service_account
        from google import genai
        from google.genai import types as gt
        if s.vertex_credentials_json:
            creds = google.oauth2.service_account.Credentials.from_service_account_info(
                json.loads(s.vertex_credentials_json), scopes=["https://www.googleapis.com/auth/cloud-platform"])
        else:
            creds = google.oauth2.service_account.Credentials.from_service_account_file(
                s.vertex_credentials_path, scopes=["https://www.googleapis.com/auth/cloud-platform"])
        client = genai.Client(vertexai=True, project=s.vertex_project_id, location=location, credentials=creds)
        contents = [gt.Content(role=("model" if m["role"] == "assistant" else "user"),
                               parts=[gt.Part(text=m["content"])]) for m in messages]
        cfg = gt.GenerateContentConfig(system_instruction=system, max_output_tokens=max_tokens,
                                       temperature=temperature,
                                       thinking_config=gt.ThinkingConfig(thinking_budget=0))
        t0 = time.perf_counter(); first = None; text = ""
        try:
            stream = await client.aio.models.generate_content_stream(model=model, contents=contents, config=cfg)
        except Exception:
            cfg = gt.GenerateContentConfig(system_instruction=system, max_output_tokens=max_tokens,
                                           temperature=temperature)
            stream = await client.aio.models.generate_content_stream(model=model, contents=contents, config=cfg)
        async for chunk in stream:
            piece = chunk.text or ""
            if piece:
                if first is None:
                    first = time.perf_counter() - t0
                text += piece
        return text.strip(), (first if first is not None else time.perf_counter() - t0)
    return call


def _bedrock(model_id: str):
    async def call(system: str, messages: List[Dict[str, str]], max_tokens: int, temperature: float):
        from aiobotocore.session import get_session
        os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
        t0 = time.perf_counter(); first = None; text = ""
        async with get_session().create_client("bedrock-runtime", region_name=os.environ.get("BEDROCK_REGION", "ap-south-1")) as c:
            resp = await c.converse_stream(
                modelId=model_id, system=[{"text": system}],
                messages=[{"role": m["role"], "content": [{"text": m["content"]}]} for m in messages],
                inferenceConfig={"maxTokens": max_tokens, "temperature": temperature})
            async for ev in resp["stream"]:
                d = ev.get("contentBlockDelta", {}).get("delta") or {}
                piece = d.get("text") or ""
                if piece:
                    if first is None:
                        first = time.perf_counter() - t0
                    text += piece
        return text.strip(), (first if first is not None else time.perf_counter() - t0)
    return call


def make_chat(spec: str):
    """spec → async callable(system, messages, max_tokens, temperature) -> (text, ttft)."""
    from app.config import get_settings
    s = get_settings()
    kind, _, rest = spec.partition(":")
    kind = kind.lower()
    if kind == "vertex":
        model, _, loc = rest.partition("@")
        return _vertex(model or s.vertex_model, loc or s.vertex_location)
    if kind == "sarvam":
        return _openai_compatible(s.sarvam_llm_base_url, s.sarvam_llm_api_key, rest or s.sarvam_llm_model,
                                  {"reasoning_effort": None})
    if kind == "openrouter":
        return _openai_compatible("https://openrouter.ai/api/v1", os.environ["OPENROUTER_API_KEY"], rest, None)
    if kind == "zai":
        return _openai_compatible("https://api.z.ai/api/paas/v4", os.environ["ZAI_API_KEY"], rest,
                                  {"thinking": {"type": "enabled"}})
    if kind == "bedrock":
        return _bedrock(rest)
    if kind == "sarvamos":
        # Sarvam's OPEN-SOURCE models (docs.sarvam.ai/api/getting-started/models/
        # open-source): OpenAI-compatible on /v2, but the header is
        # `api-subscription-key`, not a bearer token, and the key is a separate
        # sk_… subscription from SARVAM_API_KEY. Benched 2026-09-14 from Mumbai.
        import os as _os
        key = _os.environ.get("SARVAM_OS_KEY") or _os.environ.get("SARVAM_API_KEY") or ""
        if not key:
            raise RuntimeError("sarvamos: set SARVAM_OS_KEY")
        return _openai_compatible("https://api.sarvam.ai/v2", key, rest or "gemma4", None,
                                  headers={"api-subscription-key": key})
    raise ValueError(f"unknown model spec {spec!r}")


def spec_for_provider(provider: str | None = None) -> str:
    """The spec matching what the box would use for LLM_PROVIDER (default: the
    configured provider) — so `--model prod` tests exactly what callers get."""
    from app.config import get_settings
    s = get_settings()
    prov = (provider or s.llm_provider or "vertex").lower()
    if prov == "vertex":
        return f"vertex:{s.vertex_model}@{s.vertex_location}"
    if prov == "sarvam":
        return f"sarvam:{s.sarvam_llm_model}"
    if prov == "bedrock":
        return f"bedrock:{s.bedrock_model}"
    return f"vertex:{s.vertex_model}@{s.vertex_location}"
