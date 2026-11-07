"""Image models out of code: image_model_for() and its call sites.

The six image use cases read ONLY ai_model_defaults.default_model_id (30 s
cache, last-good on a DB error, the code literal when the row is missing or
blank). Env overrides keep winning over the row. No network, no DB.

Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_image_model_resolver.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services import image_model_resolver as imr  # noqa: E402

GEMINI_IMG = "google/gemini-3.1-flash-image"
QWEN = "qwen/qwen-image-3"


class _Row(tuple):
    pass


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class FakeDB:
    """execute() answers from `rows` (use_case -> default_model_id), or raises
    when `fail` is set. Counts queries so cache hits are visible."""

    def __init__(self, rows=None):
        self.rows = dict(rows or {})
        self.fail = False
        self.queries = 0

    def execute(self, query, params):
        self.queries += 1
        if self.fail:
            raise RuntimeError("pool exhausted")
        assert "ai_model_defaults" in str(query) and "default_model_id" in str(query)
        uc = params["uc"]
        if uc not in self.rows:
            return _Result(None)
        return _Result(_Row((self.rows[uc],)))


@pytest.fixture(autouse=True)
def _fresh_cache():
    imr.invalidate_cache()
    yield
    imr.invalidate_cache()


def _expire(use_case):
    stamp, value = imr._CACHE[use_case]
    imr._CACHE[use_case] = (stamp - imr.CACHE_TTL_SECONDS - 1, value)


def test_row_wins_over_the_hard_default_and_is_cached():
    db = FakeDB({"page_builder_image": "openai/gpt-image-2"})
    assert imr.image_model_for("page_builder_image", GEMINI_IMG, db=db) == "openai/gpt-image-2"
    assert imr.image_model_for("page_builder_image", GEMINI_IMG, db=db) == "openai/gpt-image-2"
    assert db.queries == 1, "second call within the TTL is a cache hit"


def test_missing_or_blank_row_is_the_hard_default():
    db = FakeDB({"quiz_image": "   "})
    assert imr.image_model_for("document_image", QWEN, db=db) == QWEN
    assert imr.image_model_for("quiz_image", GEMINI_IMG, db=db) == GEMINI_IMG


def test_seeded_row_equal_to_the_literal_changes_nothing():
    db = FakeDB({"video_image": "recraft/recraft-v4.1"})
    assert imr.image_model_for("video_image", "recraft/recraft-v4.1", db=db) == "recraft/recraft-v4.1"


def test_db_error_keeps_the_last_good_value_and_backs_off():
    db = FakeDB({"document_image": "bytedance-seed/seedream-4.5"})
    assert imr.image_model_for("document_image", QWEN, db=db) == "bytedance-seed/seedream-4.5"
    _expire("document_image")
    db.fail = True
    assert imr.image_model_for("document_image", QWEN, db=db) == "bytedance-seed/seedream-4.5"
    # The failure is stamped: no DB retry on every image call until the TTL passes.
    queries = db.queries
    assert imr.image_model_for("document_image", QWEN, db=db) == "bytedance-seed/seedream-4.5"
    assert db.queries == queries


def test_db_error_without_a_previous_value_is_the_hard_default():
    db = FakeDB()
    db.fail = True
    assert imr.image_model_for("video_support_visual", "bytedance-seed/seedream-4.5", db=db) == \
        "bytedance-seed/seedream-4.5"


def test_no_session_opens_a_short_one(monkeypatch):
    from contextlib import contextmanager

    from ai_service.app import db as app_db

    db = FakeDB({"quiz_image": "openai/gpt-image-2"})
    opened = []

    @contextmanager
    def fake_session():
        opened.append(1)
        yield db

    monkeypatch.setattr(app_db, "db_session", fake_session)
    assert imr.image_model_for("quiz_image", GEMINI_IMG) == "openai/gpt-image-2"
    assert opened == [1]


def test_a_session_that_cannot_open_is_the_hard_default(monkeypatch):
    from ai_service.app import db as app_db

    def broken():
        raise RuntimeError("no database configured")

    monkeypatch.setattr(app_db, "db_session", broken)
    assert imr.image_model_for("quiz_image", GEMINI_IMG) == GEMINI_IMG


# ── on the event loop: never a DB wait on the request path ──────────────────

def _wait_for_refresh(timeout=5.0):
    import time as _t

    end = _t.monotonic() + timeout
    while imr._REFRESHING and _t.monotonic() < end:
        _t.sleep(0.01)
    assert not imr._REFRESHING


def test_on_the_loop_a_cold_cache_answers_the_literal_and_refreshes_off_the_loop(monkeypatch):
    import asyncio
    import threading

    threads = []

    def lookup(_db, uc):
        threads.append(threading.current_thread().name)
        return "openai/gpt-image-2"

    monkeypatch.setattr(imr, "_lookup", lookup)

    async def call():
        return imr.image_model_for("page_builder_image", GEMINI_IMG)

    assert asyncio.run(call()) == GEMINI_IMG
    _wait_for_refresh()
    assert threads and threads[0].startswith("image-model-")
    assert asyncio.run(call()) == "openai/gpt-image-2"
    assert len(threads) == 1, "fresh cache: no second read"


def test_on_the_loop_a_stale_cache_keeps_answering_the_last_value(monkeypatch):
    import asyncio

    rows = {"quiz_image": "openai/gpt-image-2"}
    monkeypatch.setattr(imr, "_lookup", lambda _db, uc: rows.get(uc))
    assert imr.image_model_for("quiz_image", GEMINI_IMG) == "openai/gpt-image-2"  # off the loop: sync
    _expire("quiz_image")
    rows["quiz_image"] = "x/new-image"

    async def call():
        return imr.image_model_for("quiz_image", GEMINI_IMG)

    assert asyncio.run(call()) == "openai/gpt-image-2"
    _wait_for_refresh()
    assert asyncio.run(call()) == "x/new-image"


def test_on_the_loop_a_failing_refresh_keeps_the_literal(monkeypatch):
    import asyncio

    def boom(_db, uc):
        raise RuntimeError("pool exhausted")

    monkeypatch.setattr(imr, "_lookup", boom)

    async def call():
        return imr.image_model_for("document_image", QWEN)

    assert asyncio.run(call()) == QWEN
    _wait_for_refresh()
    assert asyncio.run(call()) == QWEN


def test_on_the_loop_with_a_session_reads_synchronously():
    import asyncio

    db = FakeDB({"quiz_image": "openai/gpt-image-2"})

    async def call():
        return imr.image_model_for("quiz_image", GEMINI_IMG, db=db)

    assert asyncio.run(call()) == "openai/gpt-image-2"
    assert db.queries == 1


# ── call sites: env overrides first, exactly as before ───────────────────────

def _seed(monkeypatch, rows):
    """Stand in for the ai_model_defaults read (the call sites open their own session)."""
    monkeypatch.setattr(imr, "_lookup", lambda _db, uc: rows.get(uc))


def test_page_builder_env_override_beats_the_row(monkeypatch):
    from ai_service.app.routers import page_builder as pb

    _seed(monkeypatch, {"page_builder_image": "openai/gpt-image-2"})
    monkeypatch.setattr(pb, "_IMAGE_MODEL_ENV", None)
    assert pb._image_model() == "openai/gpt-image-2"
    monkeypatch.setattr(pb, "_IMAGE_MODEL_ENV", "google/gemini-9-image")
    assert pb._image_model() == "google/gemini-9-image"


def test_page_builder_without_a_row_is_todays_literal(monkeypatch):
    from ai_service.app.routers import page_builder as pb

    _seed(monkeypatch, {})
    monkeypatch.setattr(pb, "_IMAGE_MODEL_ENV", None)
    assert pb._image_model() == GEMINI_IMG == pb._IMAGE_MODEL_DEFAULT


def test_course_assist_env_override_beats_the_row(monkeypatch):
    from ai_service.app.routers import course_assist as ca

    _seed(monkeypatch, {"course_assist_image": "openai/gpt-image-2"})
    monkeypatch.setattr(ca, "_IMAGE_MODEL_ENV", None)
    assert ca._image_model() == "openai/gpt-image-2"
    monkeypatch.setattr(ca, "_IMAGE_MODEL_ENV", "x/env-image")
    assert ca._image_model() == "x/env-image"
    imr.invalidate_cache()
    _seed(monkeypatch, {})
    monkeypatch.setattr(ca, "_IMAGE_MODEL_ENV", None)
    assert ca._image_model() == GEMINI_IMG


def test_document_env_override_beats_the_row_and_the_constant_is_unchanged(monkeypatch):
    from ai_service.app.services import document_postprocess as dp

    _seed(monkeypatch, {"document_image": "bytedance-seed/seedream-4.5"})
    monkeypatch.setattr(dp, "_DOC_IMAGE_MODEL_ENV", None)
    assert dp.doc_image_model() == "bytedance-seed/seedream-4.5"
    monkeypatch.setattr(dp, "_DOC_IMAGE_MODEL_ENV", "x/env-doc")
    assert dp.doc_image_model() == "x/env-doc"
    imr.invalidate_cache()
    _seed(monkeypatch, {})
    monkeypatch.setattr(dp, "_DOC_IMAGE_MODEL_ENV", None)
    assert dp.doc_image_model() == QWEN
    # Importers (html_document billing label) still get today's static value.
    assert dp.DOC_IMAGE_MODEL in (QWEN, dp._DOC_IMAGE_MODEL_ENV or QWEN)


def test_document_explicit_model_argument_still_wins(monkeypatch):
    import asyncio

    from ai_service.app.services import document_postprocess as dp

    _seed(monkeypatch, {"document_image": "bytedance-seed/seedream-4.5"})
    seen = []

    async def fake_one(prompt, aspect, model=None):
        seen.append(model)
        return "https://cdn/x.png"

    monkeypatch.setattr(dp, "_generate_one_image", fake_one)
    monkeypatch.setattr(dp, "get_settings", lambda: type("S", (), {"openrouter_api_key": "k"})())
    imr.image_model_for("document_image", QWEN)  # warm the cache (on the loop it never reads)
    html = '<p>x</p><img data-img-prompt="a heart diagram with labels" src="placeholder.png">'
    _, n = asyncio.run(dp.illustrate_document(html, model="qwen/qwen-image-3"))
    _, m = asyncio.run(dp.illustrate_document(html))
    assert (n, m) == (1, 1)
    assert seen == ["qwen/qwen-image-3", "bytedance-seed/seedream-4.5"]


def test_quiz_payload_uses_the_row(monkeypatch):
    import asyncio
    import json as _json

    import httpx

    from ai_service.app.services import quiz_service as qs

    _seed(monkeypatch, {"quiz_image": "openai/gpt-image-2"})
    sent = []

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            sent.append(json)
            return type("R", (), {"status_code": 500, "text": "nope"})()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    imr.image_model_for("quiz_image", GEMINI_IMG)  # warm the cache (on the loop it never reads)
    svc = object.__new__(qs.QuizService)
    assert asyncio.run(svc._gen_image_s3_url("a cell", "key")) is None
    assert sent and sent[0]["model"] == "openai/gpt-image-2"
    assert _json.dumps(sent[0])  # payload shape untouched otherwise
    assert set(sent[0]) == {"model", "messages", "modalities", "image_config"}
