"""
search_help_knowledge against a REAL Postgres with pgvector, over the MCP adapter.

The real RAGService SQL (cosine search, source_type filter, Python role filter)
and the real admin-portal lookup run here; only the embedder is replaced, by one
that maps a query to a fixed vector, so no network or key is used.

Needs a Postgres 16 with pgvector: set AI_LIMITS_PG_URL (a server URL,
postgresql+psycopg://...; a scratch database is created and dropped). Skipped
otherwise.
"""
import json
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.mcp import adapter  # noqa: E402
from app.mcp.access import normalize_setting  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import api_key_resolver, embedding_service  # noqa: E402
from app.services.assistant_tool_registry import HELP_KNOWLEDGE_INSTITUTE_ID  # noqa: E402

DIM = 768
SCHEMA = f"""
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE content_embeddings (
    id           VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id VARCHAR(255),
    source_type  VARCHAR(50),
    source_id    VARCHAR(255),
    content_text TEXT,
    chunk_index  INTEGER DEFAULT 0,
    embedding    vector({DIM}),
    meta_data    JSONB
);
CREATE TABLE institutes (id VARCHAR(255) PRIMARY KEY, admin_portal_base_url VARCHAR(512));
CREATE TABLE institute_domain_routing (
    institute_id VARCHAR(255), domain VARCHAR(255), subdomain VARCHAR(255), role VARCHAR(32)
);
"""


def vec(axis: int):
    v = [0.0] * DIM
    v[axis] = 1.0
    return v


#: (source_id, task, route_path, role, axis of its vector)
ARTICLES = [
    ("create-course", "Create a course", "/study-library/courses", "any", 0),
    ("payment-settings", "Set up payment gateways", "/settings?selectedTab=paymentGateways", "ADMIN", 0),
    ("evaluate", "Evaluate a submission", "/evaluation/evaluations", "EVALUATOR", 0),
    ("unrelated", "Something else entirely", "/dashboard", "any", 5),
]


@pytest.fixture(scope="module")
def Session():
    base = os.environ.get("AI_LIMITS_PG_URL")
    if not base:
        pytest.skip("no Postgres: set AI_LIMITS_PG_URL")
    name = f"help_{uuid.uuid4().hex[:10]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT", future=True)
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"'))
    head, _, tail = base.rpartition("/")
    query = ("?" + tail.split("?", 1)[1]) if "?" in tail else ""
    engine = create_engine(f"{head}/{name}{query}", future=True)
    try:
        with engine.begin() as c:
            c.exec_driver_sql(SCHEMA)
            for source_id, task, route, role, axis in ARTICLES:
                c.execute(text(
                    "INSERT INTO content_embeddings (institute_id, source_type, source_id, content_text, embedding, "
                    "meta_data) VALUES (:i, 'help_knowledge', :s, :t, CAST(:v AS vector), CAST(:m AS jsonb))"
                ), {"i": HELP_KNOWLEDGE_INSTITUTE_ID, "s": source_id, "t": f"Steps for {task}.", "v": str(vec(axis)),
                    "m": json.dumps({"task": task, "route_path": route, "role": role})})
            c.execute(text("INSERT INTO institutes (id, admin_portal_base_url) VALUES "
                           "('inst-wl', 'admin.brandschool.in'), ('inst-route', NULL), ('inst-none', NULL)"))
            c.execute(text("INSERT INTO institute_domain_routing VALUES ('inst-route', 'brandacademy.org', 'portal', "
                           "'ADMIN'), ('inst-route', 'learn.brandacademy.org', NULL, 'LEARNER')"))
        yield sessionmaker(bind=engine, future=True)
    finally:
        engine.dispose()
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture(autouse=True)
def offline_embedder(monkeypatch):
    """Every query lands on axis 0; the key the server resolved is recorded."""
    used = []

    class FakeResolver:
        def __init__(self, db):
            pass

        def resolve_keys(self, institute_id, user_id=None, **_kw):
            return ("server-key", None, "model")

    async def embed_query(self, text_, institute_id="default", model=None):
        used.append(self.api_key_resolver.resolve_keys(institute_id=institute_id)[0])
        return vec(0)

    monkeypatch.setattr(api_key_resolver, "ApiKeyResolver", FakeResolver)
    monkeypatch.setattr(embedding_service.EmbeddingService, "embed_query", embed_query)
    return used


async def ask(Session, institute_id, roles):
    principal = PinnedPrincipal(user_id="u-1", institute_id=institute_id, roles=list(roles), permissions=[],
                                is_root_user=False)
    setting = normalize_setting({"enabled": True, "allowed_roles": list(roles),
                                 "enabled_tools": ["search_help_knowledge"]})
    with Session() as db:
        result = await adapter.call_tool(name="search_help_knowledge", arguments={"query": "how do I set this up"},
                                         principal=principal, platform_token="jwt", db=db, mcp_setting=setting)
    assert not result.is_error
    return json.loads(result.content[0].text)


@pytest.mark.asyncio
async def test_role_filter_and_white_label_link_on_real_rows(Session, offline_embedder):
    out = await ask(Session, "inst-wl", ["EVALUATOR"])
    tasks = {r["task"] for r in out["results"]}
    assert tasks == {"Create a course", "Evaluate a submission"}  # ADMIN-only article filtered, far one too
    assert out["admin_portal_url"] == "https://admin.brandschool.in"
    assert {r["url"] for r in out["results"]} == {"https://admin.brandschool.in/study-library/courses",
                                                  "https://admin.brandschool.in/evaluation/evaluations"}
    assert set(offline_embedder) == {"server-key"}

    out = await ask(Session, "inst-wl", ["ADMIN"])
    assert {r["task"] for r in out["results"]} == {"Create a course", "Set up payment gateways"}


@pytest.mark.asyncio
async def test_domain_routing_link_and_no_portal_on_real_rows(Session):
    out = await ask(Session, "inst-route", ["ADMIN"])
    assert out["admin_portal_url"] == "https://portal.brandacademy.org"
    assert all(r["url"].startswith("https://portal.brandacademy.org/") for r in out["results"])

    out = await ask(Session, "inst-none", ["ADMIN"])
    from app.config import get_settings
    base = get_settings().admin_dashboard_url.rstrip("/")
    assert out["admin_portal_url"] == base and all(r["url"].startswith(base + "/") for r in out["results"])
