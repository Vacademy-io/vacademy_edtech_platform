"""Course knowledge access (CK-07): the visible tree, the learner scope
(OPEN / COMING_UP, hidden lessons absent) and the staff preview scope.

Runs against real Postgres through the CK-01 helpers (V600 and the V1-era
course stubs); skipped unless AI_LIMITS_PG_URL / AI_LIMITS_PGDATA is set.
Every test makes its own institute, so tests never see each other's rows.
"""
from __future__ import annotations

import json
import sys
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.course_knowledge import access, drip, flags, tree  # noqa: E402
from course_knowledge_pg_helpers import make_course, make_enrolment, pg_session_factory  # noqa: E402

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
FUTURE = "2026-11-12T12:00:00Z"


@pytest.fixture(scope="module")
def Session():
    f = pg_session_factory()
    yield f
    f.close()


@pytest.fixture(autouse=True)
def _fresh_cache():
    access.invalidate_cache()
    yield
    access.invalidate_cache()


def _uid() -> str:
    return str(uuid.uuid4())


def _scope(Session, user, inst, **kw):
    kw.setdefault("drip_mode", drip.MODE_TIME_EXACT)
    kw.setdefault("now", NOW)
    with Session() as db:
        return access.resolve_scope(db, user_id=user, institute_id=inst, **kw)


def _exec(Session, sql, **params):
    with Session() as db:
        db.execute(text(sql), params)
        db.commit()


def _course(Session, inst, n=3, **kw):
    with Session() as db:
        return make_course(db, inst, n, **kw)


def _enrol(Session, user, course, **cols):
    with Session() as db:
        return make_enrolment(db, user, course.package_session_id, course.institute_id, **cols)


def _settings(Session, inst, conditions, *, enabled=True, apply_rules=False, wrap=True):
    drip_block = {"enabled": enabled, "applyConfiguredRules": apply_rules, "conditions": conditions}
    course = {"COURSE_SETTING": {"key": "COURSE_SETTING", "data": {"dripConditions": drip_block}}}
    _exec(Session, "UPDATE institutes SET setting_json = :s WHERE id = :i",
          s=json.dumps({"setting": course} if wrap else course), i=inst)


def _cond(rules, behavior="lock", **kw):
    return {"behavior": behavior, "rules": rules, **kw}


def _stored(level, level_id, condition, **kw):
    return {"id": f"{level}-{level_id}", "level": level, "level_id": level_id, "drip_condition": [condition], **kw}


DATE_FUTURE = {"type": "date_based", "params": {"unlock_date": FUTURE}}


def _seq(threshold=80):
    return {"type": "sequential", "params": {"requires_previous": True, "threshold": threshold}}


# ── Enrolment ────────────────────────────────────────────────────────────────

def test_only_live_paid_unexpired_enrolments_count(Session):
    inst = _uid()
    c = _course(Session, inst, 2)
    past = datetime.now() - timedelta(days=1)
    future = datetime.now() + timedelta(days=30)
    users = {
        "active": {}, "future_expiry": {"expiry_date": future}, "other_type": {"type": "PAID"},
        "cart": {"type": "ABANDONED_CART"}, "failed": {"type": "PAYMENT_FAILED"},
        "expired": {"expiry_date": past}, "inactive": {"status": "INACTIVE"}, "deleted": {"status": "DELETED"},
    }
    ids = {name: _uid() for name in users}
    for name, cols in users.items():
        _enrol(Session, ids[name], c, **cols)
    for name in ("active", "future_expiry", "other_type"):
        assert _scope(Session, ids[name], inst).open_ids() == c.slide_ids, name
    for name in ("cart", "failed", "expired", "inactive", "deleted"):
        assert _scope(Session, ids[name], inst).is_empty, name
    assert _scope(Session, _uid(), inst).is_empty  # never enrolled


def test_other_institutes_batches_are_excluded(Session):
    inst_a, inst_b = _uid(), _uid()
    _course(Session, inst_a, 1)
    theirs = _course(Session, inst_b, 2)
    user = _uid()
    _enrol(Session, user, theirs)  # enrolled in institute B's batch
    assert _scope(Session, user, inst_a).is_empty
    assert _scope(Session, user, inst_b).open_ids() == theirs.slide_ids
    # A mapping that claims institute A for B's batch is still not A's content.
    liar = _uid()
    with Session() as db:
        make_enrolment(db, liar, theirs.package_session_id, inst_a)
    assert _scope(Session, liar, inst_a).is_empty


# ── Visible tree ─────────────────────────────────────────────────────────────

def test_draft_pending_and_deleted_lessons_are_hidden(Session):
    inst, user = _uid(), _uid()
    c = _course(Session, inst, 6)
    s = c.slide_ids
    _exec(Session, "UPDATE slide SET status = 'DRAFT' WHERE id = :id", id=s[1])
    _exec(Session, "UPDATE slide SET status = 'PENDING_APPROVAL' WHERE id = :id", id=s[2])
    _exec(Session, "UPDATE chapter_to_slides SET status = 'DELETED' WHERE slide_id = :id", id=s[3])
    _exec(Session, "UPDATE chapter_to_slides SET status = 'DRAFT' WHERE slide_id = :id", id=s[4])
    _exec(Session, "UPDATE slide SET status = 'UNSYNC' WHERE id = :id", id=s[5])
    _exec(Session, "UPDATE chapter_to_slides SET status = 'UNSYNC' WHERE slide_id = :id", id=s[5])
    _enrol(Session, user, c)
    assert _scope(Session, user, inst).open_ids() == [s[0], s[5]]


@pytest.mark.parametrize("change", [
    "cpsm_deleted", "cpsm_draft", "chapter_deleted", "chapter_inactive",
    "module_inactive", "subject_deleted", "subject_not_in_batch",
])
def test_inactive_chapter_module_or_subject_hides_its_lessons(Session, change):
    inst, user = _uid(), _uid()
    c = _course(Session, inst, 2)
    sql = {
        "cpsm_deleted": "UPDATE chapter_package_session_mapping SET status = 'DELETED' WHERE chapter_id = :c",
        "cpsm_draft": "UPDATE chapter_package_session_mapping SET status = 'DRAFT' WHERE chapter_id = :c",
        "chapter_deleted": "UPDATE chapter SET status = 'DELETED' WHERE id = :c",
        "chapter_inactive": "UPDATE chapter SET status = 'INACTIVE' WHERE id = :c",
        "module_inactive": "UPDATE modules SET status = 'INACTIVE' WHERE id = :m",
        "subject_deleted": "UPDATE subject SET status = 'DELETED' WHERE id = :s",
        "subject_not_in_batch": "DELETE FROM subject_session WHERE subject_id = :s",
    }[change]
    _exec(Session, sql, c=c.chapter_id, m=c.module_id, s=c.subject_id)
    _enrol(Session, user, c)
    assert _scope(Session, user, inst).is_empty
    with Session() as db:
        assert not tree.slide_visible_for_institute(db, c.slide_ids[0], inst)


def test_assessments_are_never_returned_but_keep_their_position(Session):
    inst, user = _uid(), _uid()
    c = _course(Session, inst, 3)
    _exec(Session, "UPDATE slide SET source_type = 'ASSESSMENT', title = 'Unit test' WHERE id = :id", id=c.slide_ids[0])
    _enrol(Session, user, c)
    scope = _scope(Session, user, inst)
    assert c.slide_ids[0] not in scope.entries
    assert scope.open_ids() == c.slide_ids[1:]
    # Lesson 2 is the SECOND item of its chapter (the assessment is the first),
    # so the first-item exemption does not open it.
    _settings(Session, inst, [_stored("slide", c.slide_ids[1], _cond([_seq()]))], apply_rules=True)
    access.invalidate_cache()
    scope = _scope(Session, user, inst)
    assert scope.entries[c.slide_ids[1]].state == access.STATE_COMING_UP
    # The hint never names the assessment (hidden items have no title).
    assert scope.entries[c.slide_ids[1]].unlock_hint == access.HINT_EARLIER


def test_tree_helpers(Session):
    inst = _uid()
    c = _course(Session, inst, 2)
    _exec(Session, "UPDATE slide SET status = 'DRAFT' WHERE id = :id", id=c.slide_ids[1])
    with Session() as db:
        rows = tree.learner_slide_tree(db, [c.package_session_id])
        assert [r.slide_id for r in rows] == [c.slide_ids[0]]
        r = rows[0]
        assert (r.package_id, r.chapter_id, r.module_id, r.subject_id) == (
            c.package_id, c.chapter_id, c.module_id, c.subject_id)
        assert (r.subject_order, r.module_order, r.chapter_order, r.slide_order) == (1, 1, 1, 1)
        assert r.title == "Lesson 1" and r.chapter_title == "Chapter" and r.source_type == "DOCUMENT"
        assert [x.slide_id for x in tree.package_slide_tree(db, inst, c.package_id)] == [c.slide_ids[0]]
        assert tree.package_slide_tree(db, _uid(), c.package_id) == []
        assert tree.slide_visible_for_institute(db, c.slide_ids[0], inst)
        assert not tree.slide_visible_for_institute(db, c.slide_ids[1], inst)
        assert not tree.slide_visible_for_institute(db, c.slide_ids[0], _uid())
        outline = tree.learner_course_outline(db, [c.package_session_id])
        assert [(o.subject_id, o.module_id, o.chapter_id) for o in outline] == [
            (c.subject_id, c.module_id, c.chapter_id)]
    _exec(Session, "UPDATE package_session SET status = 'DELETED' WHERE id = :ps", ps=c.package_session_id)
    with Session() as db:
        assert tree.package_slide_tree(db, inst, c.package_id) == []


# ── Drip ─────────────────────────────────────────────────────────────────────

def test_time_exact_treats_progress_rules_as_unmet(Session):
    inst, done, fresh = _uid(), _uid(), _uid()
    c = _course(Session, inst, 2)
    _settings(Session, inst, [_stored("slide", c.slide_ids[1], _cond([_seq(80)]))], apply_rules=True)
    for u in (done, fresh):
        _enrol(Session, u, c)
    _exec(Session, "INSERT INTO learner_operation (id, user_id, source, source_id, operation, value) "
                   "VALUES (:id, :u, 'SLIDE', :s, 'PERCENTAGE_DOCUMENT_COMPLETED', '100')",
          id=_uid(), u=done, s=c.slide_ids[0])

    exact = _scope(Session, done, inst, drip_mode=drip.MODE_TIME_EXACT)
    assert exact.open_ids() == [c.slide_ids[0]]
    assert exact.coming_up_ids() == [c.slide_ids[1]]
    assert exact.entries[c.slide_ids[1]].unlock_hint == "After you finish Lesson 1"

    assert _scope(Session, done, inst, drip_mode=drip.MODE_MIRROR).open_ids() == c.slide_ids
    assert _scope(Session, fresh, inst, drip_mode=drip.MODE_MIRROR).coming_up_ids() == [c.slide_ids[1]]

    # Without applyConfiguredRules the progress rule is dormant, as in the app.
    _settings(Session, inst, [_stored("slide", c.slide_ids[1], _cond([_seq(80)]))], apply_rules=False)
    access.invalidate_cache()
    assert _scope(Session, fresh, inst).open_ids() == c.slide_ids


def test_an_evaluation_exception_fails_closed(Session, monkeypatch):
    inst, user = _uid(), _uid()
    c = _course(Session, inst, 3)
    _settings(Session, inst, [
        _stored("slide", c.slide_ids[1], {"behavior": "lock", "rules": [None]}),  # the app would throw here
        _stored("slide", c.slide_ids[2], _cond([DATE_FUTURE], "hide")),
    ])
    _enrol(Session, user, c)
    scope = _scope(Session, user, inst)
    assert scope.open_ids() == [c.slide_ids[0]]
    assert scope.coming_up_ids() == [c.slide_ids[1]]
    assert scope.entries[c.slide_ids[1]].unlock_hint == access.HINT_NOT_YET

    def boom(*_a, **_k):
        raise RuntimeError("evaluator bug")

    access.invalidate_cache()
    monkeypatch.setattr(drip, "evaluate_drip_condition", boom)
    scope = _scope(Session, user, inst)
    # Lesson 1 has no condition (open); the others never open: the lock one is
    # COMING_UP, the one whose condition asked to hide stays hidden.
    assert scope.open_ids() == [c.slide_ids[0]]
    assert scope.coming_up_ids() == [c.slide_ids[1]]
    assert c.slide_ids[2] not in scope.entries


def test_drip_hide_drops_lessons_and_parents_cascade(Session):
    inst, user = _uid(), _uid()
    c = _course(Session, inst, 3)
    _enrol(Session, user, c)

    _settings(Session, inst, [_stored("slide", c.slide_ids[0], _cond([DATE_FUTURE], "hide")),
                              _stored("slide", c.slide_ids[1], _cond([DATE_FUTURE], "both"))])
    scope = _scope(Session, user, inst)
    assert list(scope.entries) == [c.slide_ids[2]]

    for level, level_id in (("chapter", c.chapter_id), ("module", c.module_id), ("subject", c.subject_id)):
        access.invalidate_cache()
        _settings(Session, inst, [_stored(level, level_id, _cond([DATE_FUTURE]))])
        scope = _scope(Session, user, inst)
        assert scope.coming_up_ids() == c.slide_ids, level
        assert {e.unlock_hint for e in scope.entries.values()} == {"Unlocks on 12 Nov"}, level

        access.invalidate_cache()
        _settings(Session, inst, [_stored(level, level_id, _cond([DATE_FUTURE], "hide"))])
        assert _scope(Session, user, inst).is_empty, level


def test_master_switch_gates_the_settings_and_row_paths(Session):
    inst, user = _uid(), _uid()
    c = _course(Session, inst, 2)
    _enrol(Session, user, c)
    _exec(Session, "UPDATE slide SET drip_condition_json = :j WHERE id = :id",
          j=json.dumps(_cond([DATE_FUTURE])), id=c.slide_ids[0])
    _exec(Session, "UPDATE package SET drip_condition_json = :j WHERE id = :p",
          j=json.dumps(_cond([DATE_FUTURE], target="slide")), p=c.package_id)
    _settings(Session, inst, [_stored("slide", c.slide_ids[1], _cond([DATE_FUTURE]))], enabled=False)
    assert _scope(Session, user, inst).open_ids() == c.slide_ids  # switch off: nothing locks

    access.invalidate_cache()
    _settings(Session, inst, [], enabled=True, wrap=False)  # the {COURSE_SETTING} blob shape
    scope = _scope(Session, user, inst)
    # Lesson 1: its own row condition; lesson 2: the package row condition for slides.
    assert scope.coming_up_ids() == c.slide_ids


def test_relative_dates_use_the_learner_time_zone_and_the_cache_key_includes_tz(Session):
    inst, user = _uid(), _uid()
    start = date(2026, 10, 5)
    c = _course(Session, inst, 1, start_date=start)
    _enrol(Session, user, c)
    day2 = _cond([{"type": "relative_date", "params": {"unlock_on_day": 2, "anchor": "session_start"}}], target="slide")
    _settings(Session, inst, [_stored("package", c.package_id, day2)])
    # 20:00 UTC on the 5th is already the 6th (day 2) in Kolkata, still day 1 in UTC.
    now = datetime(2026, 10, 5, 20, 0, tzinfo=timezone.utc)
    ist = _scope(Session, user, inst, tz="Asia/Kolkata", now=now)
    utc = _scope(Session, user, inst, tz="UTC", now=now)
    assert ist.open_ids() == c.slide_ids and ist.tz == "Asia/Kolkata"
    assert utc.coming_up_ids() == c.slide_ids and utc.tz == "UTC"
    assert utc.entries[c.slide_ids[0]].unlock_hint == "Unlocks on 6 Oct"
    assert access.cache_key(user, inst, "UTC", "time_exact", now) != access.cache_key(
        user, inst, "Asia/Kolkata", "time_exact", now)
    assert len(access._cache) == 2

    # Cached for the minute: a change in the DB is not seen until it expires.
    _exec(Session, "UPDATE slide SET status = 'DRAFT' WHERE id = :id", id=c.slide_ids[0])
    assert _scope(Session, user, inst, tz="UTC", now=now).coming_up_ids() == c.slide_ids
    access.invalidate_cache()
    assert _scope(Session, user, inst, tz="UTC", now=now).is_empty


def test_invalid_or_missing_tz_uses_the_default():
    assert access.normalize_tz(None) == access.DEFAULT_TZ == "Asia/Kolkata"
    assert access.normalize_tz("Mars/Olympus") == access.DEFAULT_TZ
    assert access.normalize_tz("../../etc/passwd") == access.DEFAULT_TZ
    assert access.normalize_tz(" Europe/London ") == "Europe/London"


def test_open_in_any_enrolled_batch_is_open(Session):
    inst, user = _uid(), _uid()
    c = _course(Session, inst, 1)
    # A second batch of the same course with the same chapter.
    ps2, sess2 = _uid(), _uid()
    _exec(Session, "INSERT INTO session (id, session_name, status, start_date) VALUES (:id, 'S2', 'ACTIVE', :d)",
          id=sess2, d=date(2026, 10, 1))
    _exec(Session, "INSERT INTO package_session (id, session_id, package_id, status) VALUES (:id, :s, :p, 'ACTIVE')",
          id=ps2, s=sess2, p=c.package_id)
    _exec(Session, "INSERT INTO subject_session (id, subject_id, session_id, subject_order) VALUES (:id, :sub, :ps, 1)",
          id=_uid(), sub=c.subject_id, ps=ps2)
    _exec(Session, "INSERT INTO chapter_package_session_mapping (id, chapter_id, package_session_id, status, "
                   "chapter_order) VALUES (:id, :c, :ps, 'ACTIVE', 1)", id=_uid(), c=c.chapter_id, ps=ps2)
    day5 = _cond([{"type": "relative_date", "params": {"unlock_on_day": 5}}])
    _settings(Session, inst, [_stored("slide", c.slide_ids[0], day5)])
    _enrol(Session, user, c, enrolled_date=date(2026, 10, 9))  # day 2 in this batch
    assert _scope(Session, user, inst).coming_up_ids() == c.slide_ids
    with Session() as db:
        make_enrolment(db, user, ps2, inst, enrolled_date=date(2026, 9, 1))  # long past day 5 here
    access.invalidate_cache()
    scope = _scope(Session, user, inst)
    assert scope.open_ids() == c.slide_ids
    entry = scope.entries[c.slide_ids[0]]
    assert entry.package_session_id == ps2
    assert entry.package_session_ids == {c.package_session_id, ps2}


def test_prerequisite_hint_names_the_lessons(Session):
    inst, user = _uid(), _uid()
    c = _course(Session, inst, 3)
    rule = {"type": "prerequisite", "params": {"required_slides": c.slide_ids[:2], "threshold": 100}}
    _settings(Session, inst, [_stored("slide", c.slide_ids[2], _cond([rule]))], apply_rules=True)
    _enrol(Session, user, c)
    hint = _scope(Session, user, inst).entries[c.slide_ids[2]].unlock_hint
    assert hint == "After you complete Lesson 1 and Lesson 2"


# ── Hints and tiers ──────────────────────────────────────────────────────────

def test_hints_outside_the_open_set_are_ignored(Session):
    inst, user = _uid(), _uid()
    c = _course(Session, inst, 3)
    other = _course(Session, inst, 1)  # not enrolled
    _settings(Session, inst, [_stored("slide", c.slide_ids[2], _cond([DATE_FUTURE]))])
    _enrol(Session, user, c)

    for slide_hint, chapter_hint, ps_hint in (
        (c.slide_ids[2], None, None),                 # COMING_UP, not OPEN
        ("no-such-slide", None, None),
        (other.slide_ids[0], other.chapter_id, other.package_session_id),  # not enrolled
    ):
        scope = _scope(Session, user, inst, hint_slide_id=slide_hint, hint_chapter_id=chapter_hint,
                       hint_package_session_id=ps_hint)
        assert (scope.current_slide_id, scope.current_chapter_id, scope.current_package_session_id) == (
            None, None, None)
        assert all(scope.tier_of(s) == access.TIER_OTHER for s in c.slide_ids)

    scope = _scope(Session, user, inst, hint_slide_id=c.slide_ids[0], hint_chapter_id=other.chapter_id)
    assert scope.current_slide_id == c.slide_ids[0]
    assert scope.current_chapter_id == c.chapter_id  # the bad chapter hint is replaced by the slide's
    assert scope.current_package_session_id == c.package_session_id
    assert [scope.tier_of(s) for s in c.slide_ids] == [0, 1, 1]
    assert scope.tier_of("no-such-slide") == access.TIER_OTHER

    scope = _scope(Session, user, inst, hint_package_session_id=c.package_session_id)
    assert scope.current_slide_id is None and scope.current_chapter_id is None
    assert [scope.tier_of(s) for s in c.slide_ids] == [2, 2, 2]


# ── Plumbing ─────────────────────────────────────────────────────────────────

def test_missing_identity_is_empty_without_touching_the_db():
    scope = access.resolve_scope(None, user_id="", institute_id="inst", drip_mode=drip.MODE_TIME_EXACT)
    assert scope.is_empty and scope.open_ids() == [] and scope.coming_up_ids() == []


def test_db_none_opens_one_short_session_and_mode_defaults_to_the_flag(Session, monkeypatch):
    inst, user = _uid(), _uid()
    c = _course(Session, inst, 1)
    _enrol(Session, user, c)
    opened = []

    @contextmanager
    def fake_db_session():
        db = Session()
        opened.append(db)
        try:
            yield db
        finally:
            db.close()

    import app.db as app_db
    monkeypatch.setattr(app_db, "db_session", fake_db_session)
    monkeypatch.setattr(flags, "drip_mode", lambda: drip.MODE_MIRROR)
    scope = access.resolve_scope(None, user_id=user, institute_id=inst, now=NOW)
    assert scope.open_ids() == c.slide_ids
    assert scope.drip_mode == drip.MODE_MIRROR
    assert len(opened) == 1


def test_staff_preview_scope_ignores_drip_and_assessments(Session):
    inst = _uid()
    c = _course(Session, inst, 3)
    _exec(Session, "UPDATE slide SET source_type = 'ASSESSMENT' WHERE id = :id", id=c.slide_ids[2])
    _settings(Session, inst, [_stored("slide", c.slide_ids[0], _cond([DATE_FUTURE], "hide"))])
    with Session() as db:
        scope = access.staff_preview_scope(db, inst, c.package_id)
        assert scope.open_ids() == c.slide_ids[:2]
        assert scope.coming_up_ids() == []
        assert access.staff_preview_scope(db, _uid(), c.package_id).is_empty


@pytest.mark.parametrize("sql, status, served", [
    ("UPDATE package_session SET status = :st WHERE id = :ps", "DELETED", False),
    ("UPDATE package_session SET status = :st WHERE id = :ps", "DRAFT", False),
    ("UPDATE package_session SET status = :st WHERE id = :ps", "INVITED", False),
    ("UPDATE package_session SET status = :st WHERE id = :ps", "HIDDEN", True),  # the app lists HIDDEN
    ("UPDATE package SET status = :st WHERE id = (SELECT package_id FROM package_session WHERE id = :ps)",
     "DELETED", False),
    ("UPDATE package SET status = :st WHERE id = (SELECT package_id FROM package_session WHERE id = :ps)",
     "DRAFT", False),
])
def test_learner_scope_follows_batch_and_course_status(Session, sql, status, served):
    # Deleting a batch or course leaves the enrolment row ACTIVE; the learner
    # app stops listing it, so the AI must stop serving it too.
    inst, user = _uid(), _uid()
    c = _course(Session, inst, 2)
    _enrol(Session, user, c)
    assert _scope(Session, user, inst).open_ids() == c.slide_ids
    access.invalidate_cache()
    _exec(Session, sql, st=status, ps=c.package_session_id)
    scope = _scope(Session, user, inst)
    assert (scope.open_ids() == c.slide_ids) if served else scope.is_empty


def test_scope_cache_drops_expired_entries_on_put(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(access.time, "monotonic", lambda: clock[0])
    empty = access.ResolvedScope(user_id="u", institute_id="i", tz="UTC", drip_mode="time_exact")
    for minute in range(5):
        access._cache_put(("u", "i", "UTC", "time_exact", minute), empty)
        clock[0] += access.CACHE_TTL_SECONDS + 1
    # Every earlier minute's key had expired by the next put.
    assert list(access._cache) == [("u", "i", "UTC", "time_exact", 4)]
    for n in range(access._CACHE_MAX_ENTRIES + 10):
        access._cache_put(("u", str(n)), empty)
    assert len(access._cache) == access._CACHE_MAX_ENTRIES
    assert ("u", str(access._CACHE_MAX_ENTRIES + 9)) in access._cache
