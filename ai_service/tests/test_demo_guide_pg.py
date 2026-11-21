"""Demo guide SQL on a REAL Postgres: the Flyway migration itself, then every
repository function and the database-backed caps.

Needs DEMO_GUIDE_TEST_PG_URL (e.g. postgresql+psycopg://postgres@localhost:55432/postgres);
skipped otherwise. Each run works in its own throw-away schema. The tables come
from the real migration file (admin_core V*__Demo_guide.sql), run twice to
prove it is idempotent; its seed rows go into minimal stubs of the three
registry tables it inserts into.
"""
import os
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

PG_URL = os.getenv("DEMO_GUIDE_TEST_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="DEMO_GUIDE_TEST_PG_URL not set")

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.demo_guide import caps  # noqa: E402
from app.demo_guide import repository as repo  # noqa: E402
from app.demo_guide import settings as S  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "admin_core_service/src/main/resources/db/migration"

# The registry tables the migration seeds: the columns it names, with the same keys.
STUBS = """
CREATE TABLE ai_tool_pricing (
    tool_key VARCHAR(64) PRIMARY KEY, request_type VARCHAR(64), flat_base_credits NUMERIC, per_unit_credits NUMERIC,
    unit_field VARCHAR(32), params_json JSONB);
CREATE TABLE ai_use_case_catalog (
    use_case VARCHAR(64) PRIMARY KEY, feature_group VARCHAR(48), label VARCHAR(128), label_template VARCHAR(255),
    count_unit_label VARCHAR(32), model_use_case VARCHAR(64), legacy_request_types TEXT[], tool_keys TEXT[],
    capability_key VARCHAR(64), default_surface VARCHAR(24), actor_kind VARCHAR(16), unit_kind VARCHAR(16),
    plan_eligible BOOLEAN, limit_eligible BOOLEAN, reserve_on_authorize BOOLEAN, intentionally_separate BOOLEAN,
    display_order INT, updated_by VARCHAR(255));
CREATE TABLE ai_model_defaults (
    use_case VARCHAR(100) PRIMARY KEY, default_model_id VARCHAR(255), fallback_model_id VARCHAR(255),
    free_tier_model_id VARCHAR(255), description TEXT);
"""


def migration_sql() -> str:
    hits = sorted(MIGRATIONS.glob("V*__Demo_guide.sql"))
    assert len(hits) == 1, hits
    return hits[0].read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def Session():
    schema = "dg_" + uuid.uuid4().hex[:10]
    admin = create_engine(PG_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(PG_URL, connect_args={"options": f"-csearch_path={schema}"})
    with engine.begin() as c:
        c.execute(text(STUBS))
    for _ in range(2):                                   # Flyway runs it once; a re-run must be a no-op
        with engine.begin() as c:
            c.exec_driver_sql(migration_sql())
    yield sessionmaker(bind=engine)
    engine.dispose()
    with admin.connect() as c:
        c.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    admin.dispose()


@pytest.fixture
def db(Session):
    s = Session()
    yield s
    s.rollback()
    s.execute(text("DELETE FROM demo_guide_session"))
    s.commit()
    s.close()


def new_session(db, ip="ip-1", cap=30, **over):
    args = dict(product="vacademy", lang="en", visitor_id="v_visitor0001", ip_hash=ip, origin="https://demo.vacademy.io",
                page_url="https://demo.vacademy.io/", utm={"utm_source": "google"}, ip_cap=cap)
    args.update(over)
    sid = repo.create_session(db, **args)
    db.commit()
    return sid


def test_migration_seeds_the_registry_rows_once(db):
    assert db.execute(text("SELECT flat_base_credits, per_unit_credits, unit_field, request_type "
                           "FROM ai_tool_pricing WHERE tool_key = 'demo_guide_turn'")).fetchall() == [(0, 0, "flat", "chatbot")]
    row = db.execute(text("SELECT model_use_case, tool_keys, legacy_request_types, default_surface, plan_eligible, "
                          "limit_eligible FROM ai_use_case_catalog WHERE use_case = 'demo_guide'")).one()
    assert tuple(row) == ("demo_guide", ["demo_guide_turn"], [], "PUBLIC", False, False)
    site = db.execute(text("SELECT count(*) FROM ai_model_defaults WHERE use_case = 'demo_guide' "
                           "AND default_model_id <> '' AND fallback_model_id <> ''")).scalar()
    assert site == 1


def test_session_round_trip_and_the_per_ip_session_cap(db):
    sid = new_session(db)
    s = repo.get_session(db, sid)
    assert s["product"] == "vacademy" and s["utm"] == {"utm_source": "google"} and s["turns"] == 0
    assert s["tours"] is None and s["qualification"] is None and s["lead_id"] is None and "T" in s["created_at"]
    assert new_session(db, cap=2) is not None
    assert new_session(db, cap=2) is None                     # the third from this network today
    assert new_session(db, ip="ip-2", cap=2) is not None      # another network is not affected
    assert db.execute(text("SELECT count(*) FROM demo_guide_session")).scalar() == 3
    assert repo.get_session(db, "nope") is None
    repo.set_lang(db, sid, "kn")
    assert repo.get_session(db, sid)["lang"] == "kn"


def test_turn_caps_per_session_per_ip_and_per_day(db):
    a, b, c = new_session(db), new_session(db), new_session(db, ip="ip-2")
    take = lambda sid, ip, **caps_: repo.take_turn(db, sid, ip, **{"session_cap": 60, "ip_cap": 200, "daily_cap": 3000, **caps_})
    assert [take(a, "ip-1", session_cap=2) for _ in range(3)] == [1, 2, None]
    assert take(b, "ip-1", ip_cap=2) is None                  # a's two turns count for the network
    assert take(b, "ip-1", ip_cap=3) == 1
    assert take(c, "ip-2", daily_cap=3) is None               # three turns today across everyone
    assert take(c, "ip-2", daily_cap=4) == 1
    repo.give_turn_back(db, c)
    repo.give_turn_back(db, c)
    assert repo.get_session(db, c)["turns"] == 0              # never below zero
    # yesterday's sessions do not count against today
    db.execute(text("UPDATE demo_guide_session SET last_at = now() - interval '2 days' WHERE id IN (:a, :b)"),
               {"a": a, "b": b})
    assert take(c, "ip-2", daily_cap=1) == 1
    db.commit()


def test_caps_module_reads_the_settings(db, monkeypatch):
    values = {"demo_guide.turns_per_session": 1, "demo_guide.speech_chars_per_session": 30}
    monkeypatch.setattr(S, "_platform", lambda key, default, db=None: values.get(key, default))
    sid = new_session(db)
    assert caps.take_turn(db, sid, "ip-1") == 1 and caps.take_turn(db, sid, "ip-1") is None
    assert caps.take_speech(db, sid, 20) and not caps.take_speech(db, sid, 11) and caps.take_speech(db, sid, 10)
    assert repo.get_session(db, sid)["speech_chars"] == 30
    assert caps.listen_left(db, repo.get_session(db, sid)) == 600.0
    repo.add_listen_seconds(db, sid, 45)
    repo.add_listen_seconds(db, sid, -5)
    assert caps.listen_left(db, repo.get_session(db, sid)) == 555.0


def test_tours_and_qualification_are_merged_as_json(db):
    sid = new_session(db)
    repo.add_tour(db, sid, "fee-collection")
    repo.add_tour(db, sid, "tests")
    repo.finish_tour(db, sid, "fee-collection", True)
    repo.finish_tour(db, sid, "never-queued", False)
    tours = repo.get_session(db, sid)["tours"]
    assert [(t["id"], t["finished"]) for t in tours] == [("fee-collection", True), ("tests", None), ("never-queued", False)]
    repo.merge_qualification(db, sid, {"audience": "school", "needs": "fees"})
    repo.merge_qualification(db, sid, {"needs": "fees and tests", "timeline": "June"})
    assert repo.get_session(db, sid)["qualification"] == {"audience": "school", "needs": "fees and tests",
                                                          "timeline": "June"}


def test_messages_keep_their_order_and_sentences(db):
    sid = new_session(db)
    u = repo.add_message(db, sid, "user", "text", "What does it cost?", actions={"spoken": True})
    mid = str(uuid.uuid4())
    assert repo.add_message(db, sid, "assistant", "reply", "", actions={"lang": "hi", "sentences": []},
                            message_id=mid) == mid
    repo.update_message(db, mid, "नमस्ते। यह रहा।", {"lang": "hi", "sentences": ["नमस्ते।", "यह रहा।"],
                                                   "form": {"kind": "contact", "reason": "pricing"}})
    repo.add_message(db, sid, "user", "contact_saved", "")
    db.commit()
    rows = repo.transcript(db, sid)
    assert [(r["role"], r["kind"]) for r in rows] == [("user", "text"), ("assistant", "reply"), ("user", "contact_saved")]
    assert rows[0]["id"] == u and rows[0]["actions"] == {"spoken": True} and rows[2]["actions"] is None
    assert rows[1]["actions"]["sentences"] == ["नमस्ते।", "यह रहा।"] and rows[1]["text"] == "नमस्ते। यह रहा।"
    assert [r["kind"] for r in repo.history(db, sid, 2)] == ["reply", "contact_saved"]
    assert repo.forms_shown(db, sid) == 1
    assert repo.get_message(db, sid, mid)["actions"]["lang"] == "hi"
    other = new_session(db, ip="ip-9")
    assert repo.get_message(db, other, mid) is None           # a message is only readable inside its session
    db.execute(text("DELETE FROM demo_guide_session WHERE id = :id"), {"id": sid})
    assert db.execute(text("SELECT count(*) FROM demo_guide_message")).scalar() == 0     # cascade


def test_leads_and_the_staff_list(db):
    a, b, c = new_session(db), new_session(db), new_session(db, ip="ip-2", product="other")
    for sid in (a, b, c):
        repo.take_turn(db, sid, "x", session_cap=60, ip_cap=200, daily_cap=3000)
    empty = new_session(db)                                   # opened, never used
    repo.set_lead(db, a, "resp-1")
    assert repo.leads_from_ip_today(db, "ip-1") == 1 and repo.leads_from_ip_today(db, "ip-2") == 0
    db.commit()
    page = repo.list_sessions(db, ["vacademy"], page=0, size=10)
    assert page["total"] == 2 and {r["id"] for r in page["items"]} == {a, b} and empty not in {r["id"] for r in page["items"]}
    assert {r["id"]: r["lead"] for r in page["items"]} == {a: True, b: False}
    assert [r["id"] for r in repo.list_sessions(db, ["vacademy"], page=0, size=10, lead=True)["items"]] == [a]
    assert [r["id"] for r in repo.list_sessions(db, ["vacademy"], page=0, size=10, lead=False)["items"]] == [b]
    assert repo.list_sessions(db, ["vacademy"], page=1, size=1)["items"][0]["id"] in (a, b)
    assert repo.list_sessions(db, [], page=0, size=10) == {"items": [], "page": 0, "size": 10, "total": 0}
    assert repo.list_sessions(db, ["vacademy", "other"], page=0, size=10)["total"] == 3
