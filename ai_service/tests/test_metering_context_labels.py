"""MeteringContext attribution (from the verified JWT + Origin/Referer, no
custom header, never raises, no I/O) and History label rendering
(services/metering/labels.py). Offline.

Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_metering_context_labels.py -q -p no:cacheprovider
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.core import security  # noqa: E402
from ai_service.app.services.metering import cache as mcache  # noqa: E402
from ai_service.app.services.metering.context import MeteringContext, resolve_role_class  # noqa: E402
from ai_service.app.services.metering.labels import render_label, render_template  # noqa: E402

INST = "inst-1"


class _Headers(dict):
    def get(self, key, default=None):
        for k, v in self.items():
            if k.lower() == key.lower():
                return v
        return default


def _req(headers=None, state=None):
    return SimpleNamespace(headers=_Headers(headers or {}), state=state or SimpleNamespace())


@pytest.fixture
def jwt(monkeypatch):
    """Token 'Bearer good' carries `roles` in INST and fullname 'Ravi K'."""
    box = {"roles": {"STUDENT"}, "payload": {"user": "u-9", "fullname": "Ravi K"}}

    def roles(authorization, institute_id):
        if authorization != "Bearer good" or institute_id != INST:
            return None
        return set(box["roles"])

    monkeypatch.setattr(security, "jwt_institute_roles", roles)
    monkeypatch.setattr(security, "decode_access_token",
                        lambda token: box["payload"] if token == "good" else None)
    mcache.reset_cache()
    return box


def test_learner_token_is_learner_app_with_name_and_roles(jwt):
    ctx = MeteringContext.from_request(_req({"Authorization": "Bearer good"}), INST)
    assert (ctx.actor_kind, ctx.actor_user_id, ctx.actor_role_class, ctx.role_source) == ("USER", "u-9", "LEARNER", "JWT")
    assert ctx.actor_roles_raw == ["STUDENT"] and ctx.actor_display_name == "Ravi K"
    assert ctx.surface == "LEARNER_APP"


def test_admin_dashboard_origin_is_admin_app(jwt):
    jwt["roles"] = {"ADMIN", "TEACHER"}
    ctx = MeteringContext.from_request(
        _req({"Authorization": "Bearer good", "Origin": "https://dash.vacademy.io"}), INST)
    assert (ctx.actor_role_class, ctx.surface) == ("ADMIN", "ADMIN_APP")
    ref = MeteringContext.from_request(
        _req({"Authorization": "Bearer good", "Referer": "https://DASH.vacademy.io/study-library?x=1"}), INST)
    assert ref.surface == "ADMIN_APP"


def test_mixed_roles_on_another_host_stay_unknown_surface(jwt):
    jwt["roles"] = {"STUDENT", "COUNSELLOR"}
    ctx = MeteringContext.from_request(_req({"Authorization": "Bearer good", "Origin": "https://x.example"}), INST)
    assert (ctx.actor_role_class, ctx.surface) == ("STAFF", "UNKNOWN")


def test_internal_token_and_api_key(jwt, monkeypatch):
    from ai_service.app import config as app_config

    monkeypatch.setattr(app_config, "get_settings", lambda: SimpleNamespace(internal_service_token="t"))
    internal = MeteringContext.from_request(_req({"X-Internal-Service-Token": "t"}), INST)
    assert internal.surface == "INTERNAL" and internal.actor_kind == "UNKNOWN"
    partner = MeteringContext.from_request(_req({"X-Institute-Key": "k"}, SimpleNamespace(api_key_id="key-1")), INST)
    assert (partner.surface, partner.actor_kind, partner.actor_role_class, partner.actor_user_id) == (
        "PARTNER_API", "API_KEY", "API_KEY", "apikey:key-1")
    # the route's own dependency vouched for the mode
    assert MeteringContext.from_request(_req({"X-Institute-Key": "k"}), INST,
                                        auth_mode="INSTITUTE").surface == "PARTNER_API"


def test_unverified_internal_or_api_key_headers_are_ignored(jwt, monkeypatch):
    from ai_service.app import config as app_config

    monkeypatch.setattr(app_config, "get_settings", lambda: SimpleNamespace(internal_service_token="secret"))
    # a learner adding a made-up internal token stays a learner on LEARNER_APP
    ctx = MeteringContext.from_request(_req({"Authorization": "Bearer good", "X-Internal-Service-Token": "x"}), INST)
    assert (ctx.surface, ctx.actor_role_class) == ("LEARNER_APP", "LEARNER")
    # a raw X-Institute-Key that no API-key dependency verified proves nothing
    junk = MeteringContext.from_request(_req({"X-Institute-Key": "junk"}), INST)
    assert (junk.surface, junk.actor_kind, junk.actor_role_class) == ("UNKNOWN", "UNKNOWN", None)
    # no server secret configured: never INTERNAL
    monkeypatch.setattr(app_config, "get_settings", lambda: SimpleNamespace(internal_service_token=""))
    assert MeteringContext.from_request(_req({"X-Internal-Service-Token": ""}), INST).surface == "UNKNOWN"


def test_user_argument_wins_for_the_actor_id(jwt):
    ctx = MeteringContext.from_request(_req({"Authorization": "Bearer good"}), INST,
                                       user=SimpleNamespace(user_id="from-user"))
    assert ctx.actor_user_id == "from-user"


@pytest.mark.parametrize("request_obj", [None, object(), SimpleNamespace(headers=None),
                                         SimpleNamespace(headers={"authorization": 5})])
def test_from_request_never_raises(jwt, request_obj):
    ctx = MeteringContext.from_request(request_obj, INST)
    assert ctx.actor_kind == "UNKNOWN" and ctx.surface == "UNKNOWN"


def test_bad_token_leaves_roles_unresolved(jwt):
    ctx = MeteringContext.from_request(_req({"Authorization": "Bearer forged"}), INST)
    assert ctx.actor_role_class is None and ctx.role_source == "UNRESOLVED" and ctx.actor_user_id is None


def test_builders_and_as_fields():
    s = MeteringContext.system(subject_user_id="learner-1", subject_display_name="Priya")
    assert s.as_fields() == {
        "actor_kind": "SYSTEM", "actor_role_class": "SYSTEM", "role_source": "CALLER",
        "subject_user_id": "learner-1", "subject_display_name": "Priya", "surface": "SCHEDULED",
        "source_service": "ai_service",
    }
    k = MeteringContext.api_key("abc")
    assert (k.actor_kind, k.actor_user_id, k.surface) == ("API_KEY", "apikey:abc", "PARTNER_API")
    assert "user_id" not in s.as_fields() and "user_role" not in s.as_fields(), "ledger fields are never produced"


def test_role_class_precedence():
    assert resolve_role_class(["student", "Admin"]) == "ADMIN"
    assert resolve_role_class(["CONTENT CREATOR"]) == "TEACHER"
    assert resolve_role_class(["content-creator", "parent"]) == "TEACHER"
    assert resolve_role_class(["MY_CUSTOM"]) == "STAFF"
    assert resolve_role_class(["PARENT", "STUDENT"]) == "PARENT"
    assert resolve_role_class([]) is None


# ── labels ──────────────────────────────────────────────────────────────────

TUTOR = {"label": "AI tutor chat", "label_template": "{label} — {actor_role_label} {actor_name}"}
LIVE = {"label": "AI tutor session", "label_template": "{label} · {minutes} min — {actor_name}"}
VIDEO = {"label": "Lesson video", "label_template": "Lesson video — {video_title|course_name}"}
CALL = {"label": "AI calling", "label_template": "AI calling — {minutes} min · {agent_name}"}


def test_templates_render():
    assert render_label(TUTOR, {"use_case": "tutor_chat", "actor_role_class": "LEARNER",
                                "actor_display_name": "Ravi"}) == "AI tutor chat — student Ravi"
    assert render_label(LIVE, {"use_case": "tutor_live", "minutes": 12, "actor_display_name": "Ravi"}) == \
        "AI tutor session · 12 min — Ravi"
    assert render_label(VIDEO, {"use_case": "lesson_video", "context": {"course_name": "Course X"}}) == \
        "Lesson video — Course X"
    assert render_label(VIDEO, {"use_case": "lesson_video", "context": {"video_title": "Fractions",
                                                                         "course_name": "X"}}) == \
        "Lesson video — Fractions"
    assert render_label(CALL, {"use_case": "ai_calling", "minutes": "4.0", "context": {"agent_name": "Riya"}}) == \
        "AI calling — 4 min · Riya"


def test_missing_names_are_dropped_cleanly():
    assert render_label(TUTOR, {"use_case": "tutor_chat"}) == "AI tutor chat"
    assert render_label(LIVE, {"use_case": "tutor_live", "actor_display_name": "Ravi"}) == "AI tutor session — Ravi"
    assert render_label(LIVE, {"use_case": "tutor_live", "minutes": 3}) == "AI tutor session · 3 min"
    assert render_label(VIDEO, {"use_case": "lesson_video"}) == "Lesson video"
    assert render_label(CALL, {"use_case": "ai_calling"}) == "AI calling"


def test_unknown_and_legacy_rows_fall_back_to_the_description():
    assert render_label(None, {"use_case": "unknown", "description": "conversation using z-ai/glm-5.3-flash"}) == \
        "conversation using z-ai/glm-5.3-flash"
    assert render_label({"label": "Other AI usage"}, {"use_case": "unknown"}) == "Other AI usage"
    assert render_label(None, {}) == "AI usage"


def test_formatting_is_safe():
    evil = {"label": "X", "label_template": "{label} {__class__} {actor_name.__dict__} {0}"}
    out = render_label(evil, {"use_case": "x", "actor_display_name": "{label}\nRavi"})
    assert "__" not in out and "\n" not in out
    assert render_template("{a} — {b}", {"a": "A"}) == "A"
    long = render_label({"label": "X", "label_template": "{label} — {actor_name}"},
                        {"use_case": "x", "actor_display_name": "A" * 500})
    assert long.startswith("X — A") and len(long) <= len("X — ") + 80
