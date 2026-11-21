"""Record-only usage rows for embeddings and web search (no credit charge).

Offline: the pool thread is replaced by an inline executor and db_session by
an in-memory double, so every assertion runs synchronously.

Run from the repo root:
    <venv>/bin/python -m pytest ai_service/tests/test_usage_record_only.py -q
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from contextlib import contextmanager
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import app.db as app_db  # noqa: E402
from app.models.ai_token_usage import ApiProvider, RequestType  # noqa: E402
from app.services import usage_record_only as uro  # noqa: E402
from app.services import embedding_service as emb_mod  # noqa: E402
from app.services import web_search_service as ws_mod  # noqa: E402

INSTITUTE = "11111111-2222-3333-4444-555555555555"
_real_enabled = uro._recording_enabled


class _Res:
    def __init__(self, row=None):
        self._row = row

    def fetchone(self):
        return self._row


class FakeSession:
    def __init__(self, prices=None):
        self.prices = prices or {}
        self.added = []
        self.committed = 0

    def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        assert sql.startswith("SELECT input_price_per_1m, output_price_per_1m, is_free FROM ai_models")
        return _Res(self.prices.get(params["m"]))

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.committed += 1

    def refresh(self, obj):
        pass

    def rollback(self):
        pass


class InlineExecutor:
    def __init__(self):
        self.calls = 0

    def submit(self, fn, *args):
        self.calls += 1
        fn(*args)


@pytest.fixture
def harness(monkeypatch):
    session = FakeSession()
    executor = InlineExecutor()

    @contextmanager
    def fake_db_session():
        yield session

    monkeypatch.setattr(app_db, "db_session", fake_db_session)
    monkeypatch.setattr(uro, "_get_executor", lambda: executor)
    monkeypatch.setattr(uro, "_pending", 0)
    monkeypatch.setattr(uro, "_failure_logged", False)
    monkeypatch.setattr(uro, "_recording_enabled", lambda: True)
    uro._price_cache.clear()
    return SimpleNamespace(session=session, executor=executor)


# ── the helper ──────────────────────────────────────────────────────────────

def test_row_priced_from_registry_no_credits(harness):
    harness.session.prices["google/gemini-embedding-001"] = SimpleNamespace(
        input_price_per_1m=0.15, output_price_per_1m=0, is_free=False)
    assert uro.record_usage_only(
        api_provider=ApiProvider.OPENAI, request_type=RequestType.EMBEDDING,
        model="google/gemini-embedding-001", prompt_tokens=2000, institute_id=INSTITUTE,
        metadata={"source": "t"},
    ) is True
    [row] = harness.session.added
    assert row.api_provider == "openai" and row.request_type == "embedding"
    assert row.prompt_tokens == 2000 and row.completion_tokens == 0 and row.total_tokens == 2000
    assert str(row.institute_id) == INSTITUTE and row.user_id is None
    assert row.input_token_price == pytest.approx(0.15 / 1_000_000)
    assert float(row.total_price) == pytest.approx(0.0003)
    assert getattr(row, "credits_used", None) is None  # column not even mapped: stays NULL
    meta = json.loads(row.request_metadata)
    assert meta == {"source": "t", "charged": False}
    assert uro._pending == 0


def test_switch_off_by_default_writes_nothing(monkeypatch, harness):
    """billing.record_unbilled_usage absent/false: no DB session is opened, no row."""
    from app.services import platform_settings_service as pss

    opened = []

    @contextmanager
    def tracking_db_session():
        opened.append(1)
        yield harness.session

    monkeypatch.setattr(app_db, "db_session", tracking_db_session)
    monkeypatch.setattr(pss, "get_platform_setting", lambda key, default=None, db=None: default)
    monkeypatch.setattr(uro, "_recording_enabled", _real_enabled)  # undo the harness's "on"
    assert uro.record_usage_only(api_provider=ApiProvider.OPENAI, request_type=RequestType.EMBEDDING,
                                 model="m", prompt_tokens=5, institute_id=INSTITUTE) is True
    assert harness.session.added == [] and opened == []
    assert uro._pending == 0


@pytest.mark.parametrize("raw,expected", [(True, True), ("true", True), (False, False), (None, False),
                                          ("off", False)])
def test_switch_values(monkeypatch, raw, expected):
    from app.services import platform_settings_service as pss

    monkeypatch.setattr(pss, "get_platform_setting", lambda key, default=None, db=None: raw)
    assert _real_enabled() is expected


def test_switch_read_error_is_off(monkeypatch):
    from app.services import platform_settings_service as pss

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(pss, "get_platform_setting", boom)
    assert _real_enabled() is False


def test_no_registry_row_leaves_price_null(harness):
    uro.record_usage_only(api_provider=ApiProvider.OPENAI, request_type=RequestType.VIDEO,
                          model="perplexity/sonar", prompt_tokens=10, completion_tokens=5,
                          institute_id="default")
    [row] = harness.session.added
    assert row.input_token_price is None and row.output_token_price is None and row.total_price is None
    assert row.total_tokens == 15
    assert row.institute_id is None  # "default" is not a UUID


def test_free_model_prices_zero(harness):
    harness.session.prices["m/free"] = SimpleNamespace(input_price_per_1m=1, output_price_per_1m=1, is_free=True)
    uro.record_usage_only(api_provider=ApiProvider.OPENAI, request_type=RequestType.EMBEDDING,
                          model="m/free", prompt_tokens=10)
    assert harness.session.added[0].total_price == 0


def test_db_failure_never_raises(monkeypatch, harness):
    @contextmanager
    def broken():
        raise RuntimeError("no database")
        yield  # pragma: no cover

    monkeypatch.setattr(app_db, "db_session", broken)
    assert uro.record_usage_only(api_provider=ApiProvider.OPENAI, request_type=RequestType.EMBEDDING,
                                 model="x", prompt_tokens=1) is True
    assert uro._pending == 0 and uro._failure_logged is True


def test_backlog_full_drops_without_queueing(monkeypatch, harness):
    monkeypatch.setattr(uro, "_pending", uro.MAX_PENDING)
    assert uro.record_usage_only(api_provider=ApiProvider.OPENAI, request_type=RequestType.EMBEDDING,
                                 model="x", prompt_tokens=1) is False
    assert harness.executor.calls == 0


def test_submit_failure_is_swallowed(monkeypatch, harness):
    class Dead:
        def submit(self, *a):
            raise RuntimeError("cannot schedule new futures after shutdown")

    monkeypatch.setattr(uro, "_get_executor", lambda: Dead())
    assert uro.record_usage_only(api_provider=ApiProvider.OPENAI, request_type=RequestType.EMBEDDING,
                                 model="x", prompt_tokens=1) is False
    assert uro._pending == 0


def test_real_pool_returns_before_the_write(monkeypatch):
    """The real executor: the call returns while the write is still blocked."""
    import threading

    gate = threading.Event()
    done = threading.Event()

    def slow_write(kwargs):
        gate.wait(5)
        with uro._pending_lock:
            uro._pending -= 1
        done.set()

    monkeypatch.setattr(uro, "_write", slow_write)
    monkeypatch.setattr(uro, "_pending", 0)
    assert uro.record_usage_only(api_provider=ApiProvider.OPENAI, request_type=RequestType.EMBEDDING,
                                 model="x", prompt_tokens=1) is True
    assert not done.is_set()
    gate.set()
    assert done.wait(5)


# ── embedding_service ───────────────────────────────────────────────────────

class _Resolver:
    def resolve_keys(self, institute_id=None):
        return ("or-key", None, None)


def _service(monkeypatch, response):
    svc = emb_mod.EmbeddingService(_Resolver())

    async def fake_post(url, payload, headers):
        fake_post.payload = payload
        return response

    monkeypatch.setattr(svc, "_post_with_retry", fake_post)
    return svc, fake_post


def _vectors(n):
    return [{"index": i, "embedding": [0.0] * emb_mod.EMBEDDING_DIM} for i in range(n)]


def test_embed_batch_records_one_row_per_call(monkeypatch, harness):
    svc, _ = _service(monkeypatch, {"data": _vectors(2), "usage": {"prompt_tokens": 42, "total_tokens": 42, "cost": 0.0001}})
    out = asyncio.run(svc.embed_batch(["a", "b"], institute_id=INSTITUTE))
    assert len(out) == 2 and all(v is not None for v in out)
    [row] = harness.session.added
    assert row.model == "google/gemini-embedding-001" and row.request_type == "embedding"
    assert row.prompt_tokens == 42 and str(row.institute_id) == INSTITUTE
    meta = json.loads(row.request_metadata)
    assert meta["inputs"] == 2 and meta["input_type"] == "search_document"
    assert meta["openrouter_cost_usd"] == 0.0001 and meta["charged"] is False


def test_embed_query_records_and_cache_hit_does_not(monkeypatch, harness):
    emb_mod._query_cache.clear()
    svc, _ = _service(monkeypatch, {"data": _vectors(1), "usage": {"prompt_tokens": 3}})
    asyncio.run(svc.embed_query("what is x", institute_id=INSTITUTE))
    asyncio.run(svc.embed_query("what is x", institute_id=INSTITUTE))  # cache hit, no API call
    assert len(harness.session.added) == 1
    assert json.loads(harness.session.added[0].request_metadata)["input_type"] == "search_query"
    emb_mod._query_cache.clear()


def test_embedding_result_unchanged_when_recording_explodes(monkeypatch, harness):
    def boom(**kw):
        raise RuntimeError("recorder broken")

    monkeypatch.setattr(uro, "record_usage_only", boom)
    svc, _ = _service(monkeypatch, {"data": _vectors(1)})  # no usage block either
    out = asyncio.run(svc.embed_text("hello", institute_id=INSTITUTE))
    assert out == [0.0] * emb_mod.EMBEDDING_DIM


def test_embedding_payload_unchanged(monkeypatch, harness):
    svc, post = _service(monkeypatch, {"data": _vectors(1)})
    asyncio.run(svc.embed_text("hello"))
    assert post.payload == {"model": "google/gemini-embedding-001", "input": ["hello"],
                            "dimensions": 768, "input_type": "search_document"}


def test_local_model_not_recorded(monkeypatch, harness):
    monkeypatch.setattr(emb_mod, "_embed_local_sync", lambda m, t, task: [[0.0] * 768 for _ in t])
    svc = emb_mod.EmbeddingService(_Resolver())
    asyncio.run(svc.embed_batch(["a"], model="BAAI/bge-base-en-v1.5"))
    assert harness.session.added == []


# ── web_search_service ──────────────────────────────────────────────────────

class _Resp:
    def __init__(self, body):
        self._body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self._body


def _fake_httpx(monkeypatch, body=None, error=None):
    class Client:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            if error:
                raise error
            return _Resp(body)

    monkeypatch.setattr(ws_mod.httpx, "AsyncClient", Client)


SONAR_BODY = {
    "model": "perplexity/sonar",
    "choices": [{"message": {"content": "Answer.", "annotations": []}}],
    "citations": ["https://example.com/a"],
    "usage": {"prompt_tokens": 20, "completion_tokens": 80, "total_tokens": 100},
}


def test_web_search_records_row_and_result_unchanged(monkeypatch, harness):
    _fake_httpx(monkeypatch, SONAR_BODY)
    svc = ws_mod.WebSearchService(openrouter_key="k", institute_id=INSTITUTE, request_id="vid-1")
    out = asyncio.run(svc.search("q"))
    assert out == {"answer": "Answer.", "sources": [{"title": "example.com", "url": "https://example.com/a",
                                                     "snippet": ""}], "query": "q"}
    [row] = harness.session.added
    assert row.model == "perplexity/sonar" and row.request_type == "video"
    assert (row.prompt_tokens, row.completion_tokens, row.total_tokens) == (20, 80, 100)
    assert str(row.institute_id) == INSTITUTE and row.request_id == "vid-1"


def test_web_search_old_constructor_still_works(monkeypatch, harness):
    _fake_httpx(monkeypatch, SONAR_BODY)
    out = asyncio.run(ws_mod.WebSearchService(openrouter_key="k").search("q"))
    assert out["answer"] == "Answer."
    assert harness.session.added[0].institute_id is None


def test_web_search_failure_records_nothing(monkeypatch, harness):
    _fake_httpx(monkeypatch, error=RuntimeError("402 Payment Required"))
    out = asyncio.run(ws_mod.WebSearchService(openrouter_key="k").search("q"))
    assert out == {"answer": "", "sources": [], "query": "q"}
    assert harness.session.added == []
