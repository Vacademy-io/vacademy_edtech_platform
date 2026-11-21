"""
Service for generating text embeddings.

Two providers, chosen PER MODEL — every knowledge base pins the model it was
indexed with (kb_embedding_model registry, V435), and a query against it must
use the same one:

  * google/gemini-embedding-001 through OpenRouter (pay-per-token). The
    default; also what the legacy content_embeddings rows were written with.
    The direct-Gemini fallback was retired — this one runs exclusively
    through OpenRouter.
  * BAAI/bge-base-en-v1.5 IN-PROCESS (fastembed, ONNX on CPU). No account, no
    per-token cost, ~600 MB of RAM once loaded. Registered by V520 for the
    curriculum libraries: 35k chunks of NCERT would cost dollars to embed and
    every client's search would then depend on a metered key. Same 768 width,
    so it shares the embedding_768 column — one KB, one model, always.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple
import httpx

from ..services.api_key_resolver import ApiKeyResolver

logger = logging.getLogger(__name__)

# Chunk size ~500 tokens (~2000 chars) with 200 char overlap
CHUNK_SIZE = 2000
CHUNK_OVERLAP = 200

OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings"
OPENROUTER_EMBED_MODEL = "google/gemini-embedding-001"
EMBEDDING_DIM = 768
# Batch at most 100 inputs per embeddings call.
BATCH_LIMIT = 100
MAX_RETRIES = 3
MAX_RETRY_DELAY_SECONDS = 30.0

# task -> openrouter input_type
TASK_TYPES = {
    "document": "search_document",
    "query": "search_query",
}

# Models served in-process by fastembed (ONNX, CPU). Value = vector width.
LOCAL_MODELS: Dict[str, int] = {"BAAI/bge-base-en-v1.5": 768}
LOCAL_BATCH = 32
# Where the ONNX weights live. The Dockerfile bakes them in at this path so a
# pod never downloads from Hugging Face at request time.
LOCAL_CACHE_DIR = os.getenv("FASTEMBED_CACHE_PATH") or os.path.join(
    os.path.expanduser("~"), ".cache", "fastembed"
)

# Module-level so the cache survives per-request EmbeddingService instances.
QUERY_CACHE_SIZE = 256
_query_cache: "OrderedDict[Tuple[str, str, str], List[float]]" = OrderedDict()

# One loaded local model per process; loading takes seconds and ~600 MB.
_local_models: Dict[str, Any] = {}
_local_lock = threading.Lock()


def _local_model(model_id: str):
    with _local_lock:
        model = _local_models.get(model_id)
        if model is None:
            from fastembed import TextEmbedding  # heavy import; only when used

            logger.info("Loading local embedding model %s from %s", model_id, LOCAL_CACHE_DIR)
            model = TextEmbedding(model_id, cache_dir=LOCAL_CACHE_DIR)
            _local_models[model_id] = model
        return model


def _embed_local_sync(model_id: str, texts: List[str], task: str) -> List[List[float]]:
    model = _local_model(model_id)
    # bge prefixes queries with its retrieval instruction; passages are raw.
    it = model.query_embed(texts) if task == "query" else model.embed(texts, batch_size=LOCAL_BATCH)
    return [[float(x) for x in vec] for vec in it]


def _record_embedding_usage(data: Any, inputs: int, input_type: str, institute_id: Optional[str]) -> None:
    """Record-only ai_token_usage row for one OpenRouter embeddings call: the
    tokens it billed us, no credits charged. Queued off the request path;
    never raises (usage_record_only swallows its own failures, this guards
    the parsing)."""
    try:
        usage = data.get("usage") if isinstance(data, dict) else None
        if not isinstance(usage, dict):
            usage = {}
        prompt_tokens = int(usage.get("prompt_tokens") or usage.get("total_tokens") or 0)
        meta: Dict[str, Any] = {"source": "embedding_service", "inputs": inputs, "input_type": input_type}
        if usage.get("cost") is not None:
            meta["openrouter_cost_usd"] = usage.get("cost")
        from ..models.ai_token_usage import ApiProvider, RequestType
        from .usage_record_only import record_usage_only

        record_usage_only(
            api_provider=ApiProvider.OPENAI,
            request_type=RequestType.EMBEDDING,
            model=OPENROUTER_EMBED_MODEL,
            prompt_tokens=prompt_tokens,
            completion_tokens=0,
            total_tokens=int(usage.get("total_tokens") or prompt_tokens),
            institute_id=institute_id,
            metadata=meta,
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("embedding usage record skipped: %s", exc)


class EmbeddingService:
    """Generates text embeddings for RAG."""

    def __init__(self, api_key_resolver: ApiKeyResolver):
        self.api_key_resolver = api_key_resolver
        self.http_client = httpx.AsyncClient(timeout=30.0)

    def chunk_text(self, text: str) -> List[str]:
        """Split text into overlapping chunks for embedding."""
        if len(text) <= CHUNK_SIZE:
            return [text]

        chunks = []
        start = 0
        while start < len(text):
            end = start + CHUNK_SIZE
            chunk = text[start:end]
            # Try to break at sentence boundary
            if end < len(text):
                last_period = chunk.rfind('. ')
                last_newline = chunk.rfind('\n')
                break_point = max(last_period, last_newline)
                if break_point > CHUNK_SIZE // 2:
                    chunk = chunk[:break_point + 1]
                    end = start + break_point + 1
            chunks.append(chunk.strip())
            start = end - CHUNK_OVERLAP
        return [c for c in chunks if c]

    async def _post_with_retry(self, url: str, payload: Dict, headers: Dict) -> Dict:
        """
        POST with backoff on 429/5xx, honoring Retry-After.

        API keys go in headers, never the URL — httpx logs full request URLs
        at INFO level, so a ?key= query param leaks the key into logs.
        """
        for attempt in range(MAX_RETRIES + 1):
            response = await self.http_client.post(url, json=payload, headers=headers)
            if (response.status_code == 429 or response.status_code >= 500) and attempt < MAX_RETRIES:
                try:
                    delay = float(response.headers.get("retry-after", ""))
                except ValueError:
                    delay = float(2 ** attempt)
                delay = min(delay, MAX_RETRY_DELAY_SECONDS)
                logger.warning(
                    f"Embedding API at {url} returned {response.status_code}, "
                    f"retrying in {delay:.0f}s (attempt {attempt + 1}/{MAX_RETRIES})"
                )
                await asyncio.sleep(delay)
                continue
            response.raise_for_status()
            return response.json()
        raise RuntimeError("unreachable")

    async def _embed_openrouter(
        self, texts: List[str], input_type: str, api_key: str, institute_id: Optional[str] = None
    ) -> List[List[float]]:
        """Embed texts via OpenRouter's OpenAI-compatible embeddings endpoint."""
        payload = {
            "model": OPENROUTER_EMBED_MODEL,
            "input": texts,
            "dimensions": EMBEDDING_DIM,
            "input_type": input_type,
        }
        headers = {"Authorization": f"Bearer {api_key}"}
        data = await self._post_with_retry(OPENROUTER_EMBEDDINGS_URL, payload, headers)
        # OpenRouter billed this call whatever we make of the vectors below.
        _record_embedding_usage(data, len(texts), input_type, institute_id)
        items = sorted(data["data"], key=lambda d: d["index"])
        if len(items) != len(texts):
            raise ValueError(f"OpenRouter returned {len(items)} embeddings for {len(texts)} inputs")
        embeddings = [item["embedding"] for item in items]
        # If the provider ignored `dimensions`, raising here drops the batch
        # (returns None) instead of inserting vectors pgvector will reject.
        if embeddings and len(embeddings[0]) != EMBEDDING_DIM:
            raise ValueError(f"OpenRouter returned {len(embeddings[0])}-dim embeddings, expected {EMBEDDING_DIM}")
        return embeddings

    async def _embed_with_providers(
        self, texts: List[str], task: str, institute_id: str, model: Optional[str] = None
    ) -> List[Optional[List[float]]]:
        """Embed up to BATCH_LIMIT texts with the provider that serves `model`
        (default: the OpenRouter Gemini embedder)."""
        model = model or OPENROUTER_EMBED_MODEL

        if model in LOCAL_MODELS:
            try:
                # CPU-bound ONNX inference: off the event loop, so a 100-chunk
                # batch does not stall every other request the worker serves.
                return await asyncio.to_thread(_embed_local_sync, model, texts, task)
            except Exception as e:  # noqa: BLE001
                logger.error(f"Local embedding ({model}) failed, batch dropped: {e}")
                return [None] * len(texts)

        if model != OPENROUTER_EMBED_MODEL:
            logger.error("Unknown embedding model %s — no provider serves it", model)
            return [None] * len(texts)

        openrouter_key, _gemini_key, _ = self.api_key_resolver.resolve_keys(institute_id=institute_id)
        openrouter_input_type = TASK_TYPES[task]

        if not openrouter_key:
            logger.error("No embedding provider available (OPENROUTER_API_KEY not configured)")
            return [None] * len(texts)

        try:
            return await self._embed_openrouter(texts, openrouter_input_type, openrouter_key, institute_id)
        except Exception as e:
            # No cross-provider fallback — a failure means these chunks go
            # un-embedded (logged so it's diagnosable, not silent). Falling
            # over to a different model would write vectors from another
            # space into the same knowledge base.
            logger.error(f"OpenRouter embedding failed, batch dropped: {e}")
            return [None] * len(texts)

    async def embed_text(
        self, text: str, institute_id: str = "default", model: Optional[str] = None
    ) -> Optional[List[float]]:
        """Generate embedding for a single document text."""
        results = await self._embed_with_providers([text], "document", institute_id, model)
        return results[0]

    async def embed_batch(
        self, texts: List[str], institute_id: str = "default", model: Optional[str] = None
    ) -> List[Optional[List[float]]]:
        """Generate embeddings for multiple texts in batched calls."""
        results: List[Optional[List[float]]] = []
        for start in range(0, len(texts), BATCH_LIMIT):
            batch = texts[start:start + BATCH_LIMIT]
            results.extend(await self._embed_with_providers(batch, "document", institute_id, model))
        return results

    async def embed_query(
        self, text: str, institute_id: str = "default", model: Optional[str] = None
    ) -> Optional[List[float]]:
        """Generate embedding for a search query (uses retrieval-query task type)."""
        cache_key = (institute_id, model or OPENROUTER_EMBED_MODEL, text)
        cached = _query_cache.get(cache_key)
        if cached is not None:
            _query_cache.move_to_end(cache_key)
            return cached

        results = await self._embed_with_providers([text], "query", institute_id, model)
        embedding = results[0]
        if embedding is None:
            return None

        _query_cache[cache_key] = embedding
        if len(_query_cache) > QUERY_CACHE_SIZE:
            _query_cache.popitem(last=False)
        return embedding

    async def close(self):
        await self.http_client.aclose()


__all__ = ["EmbeddingService"]
