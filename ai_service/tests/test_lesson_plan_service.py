"""A lesson's teacher must be a Spatius avatar the institute may use.

The Video API renders any avatar id on our app — including another
institute's custom teacher. So the request is checked against the same list
the AI tutor offers: platform stock plus the institute's own ready rows.
"""

import os
import sys

import pytest

_HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(_HERE, ".."))

from app.services import lesson_plan_service as lps  # noqa: E402
from app.services.tutor import asset_registry  # noqa: E402

AV = "37b77e8a-c2bd-413d-818f-810a59fcc14c"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("SPATIUS_API_KEY", "k")
    monkeypatch.setenv("SPATIUS_APP_ID", "app")


def _rows(monkeypatch, rows):
    seen = {}

    def visible(db, *, institute_id, kind=None):
        seen.update(institute_id=institute_id, kind=kind)
        return rows

    monkeypatch.setattr(asset_registry, "visible", visible)
    return seen


def _row(**kw):
    base = {"kind": "avatar", "provider": "spatius", "status": "ready", "external_id": AV,
            "display_name": "Riya Jain", "institute_id": None}
    base.update(kw)
    return base


def test_stock_or_own_ready_avatar_is_accepted_and_named(monkeypatch):
    seen = _rows(monkeypatch, [_row()])
    plan = lps.resolve_lesson_plan({"teacher": {"avatar_id": AV}}, institute_id="inst-1", db=object())
    assert plan["teacher"]["avatar_id"] == AV and plan["teacher"]["name"] == "Riya Jain"
    assert seen == {"institute_id": "inst-1", "kind": "avatar"}


@pytest.mark.parametrize("row", [
    _row(external_id="someone-elses-avatar"),
    _row(status="requested"),
    _row(provider="heygen"),
])
def test_an_avatar_the_institute_cannot_use_is_refused(monkeypatch, row):
    _rows(monkeypatch, [row])
    with pytest.raises(lps.LessonConfigError, match="not available to this institute"):
        lps.resolve_lesson_plan({"teacher": {"avatar_id": AV}}, institute_id="inst-1", db=object())


def test_lesson_and_host_cannot_be_combined(monkeypatch):
    _rows(monkeypatch, [_row()])
    with pytest.raises(lps.LessonConfigError, match="remove `host`"):
        lps.resolve_lesson_plan({"teacher": {"avatar_id": AV}}, institute_id="i", host={"type": "avatar"}, db=object())


def test_teacher_needs_spatius_configured(monkeypatch):
    monkeypatch.delenv("SPATIUS_API_KEY")
    with pytest.raises(lps.LessonConfigError, match="not configured"):
        lps.resolve_lesson_plan({"teacher": {"avatar_id": AV}}, institute_id="i", db=object())


def test_board_only_lesson_needs_no_avatar_or_vendor(monkeypatch):
    monkeypatch.delenv("SPATIUS_API_KEY")
    plan = lps.resolve_lesson_plan({"subject": "Physics"}, institute_id="i", db=object())
    assert plan["teacher"] is None and plan["layout"] == "board" and plan["subject"] == "Physics"


def test_no_lesson_block_means_lesson_mode_off():
    assert lps.resolve_lesson_plan(None, institute_id="i") is None
    assert lps.resolve_lesson_plan({"enabled": False}, institute_id="i") is None
