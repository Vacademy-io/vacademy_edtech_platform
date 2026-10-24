"""
website_publish: MCP publish and rollback behind a two-step confirm (product decision 3).

admin-core is a small in-memory stand-in that behaves like CatalogueRevisionService
(draft upsert, create_only, publish with the stale guard, expectedLiveRevisionNo
and expectedDraftSha256, history, discard); the confirm tokens live in a real
SQLite ``mcp_publish_confirm`` table. Pinned down here:

* request_publish issues a token only to a caller holding website_publish, only
  for a "ready" draft admin-core says is not older than live — and never for
  callers without it (their result is unchanged);
* publish refuses: no / malformed / unknown token, another institute's or
  user's token, a rollback token, an expired one, a used one (single use), a
  draft edited after the check, a draft older than live (ours and the server's
  409), a live site that moved, a different site, a server that does not report
  staleness, credentials as arguments — and admin-core is never asked to publish
  in any of those cases;
* the happy path publishes with expectedLiveRevisionNo + expectedDraftSha256 and
  never overrideStale, and returns the new and previous revision numbers and a
  rollback hint;
* rollback: step one returns the diff and a token (nothing written), step two
  saves the old version as a create-only draft and publishes it; refused while a
  draft is open, for an unknown / live revision, with a token for another target;
  a failed publish drops only its own draft.
"""
import copy
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.models.publish_confirm import PublishConfirm  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tools_website as website_mod  # noqa: E402
from app.services import assistant_tools_website_edit as edit_mod  # noqa: E402
from app.services import assistant_tools_website_publish as pub  # noqa: E402
from app.services import website_data  # noqa: E402
from app.services.assistant_tool_registry import ToolContext, execute_tool  # noqa: E402

from test_website_tools import CATALOGUE_ROW, fake_admin_core, sample_config  # noqa: E402

#: The settings an admin would give a connection that may publish (edit drafts + publish).
PUBLISH = {"enabled_tools": ["website_builder", "website_builder_edits", "website_publish"]}
EDIT_ONLY = {"enabled_tools": ["website_builder", "website_builder_edits"]}


def sha(text_: str) -> str:
    return hashlib.sha256(text_.encode("utf-8")).hexdigest()


class AdminCore:
    """CatalogueRevisionService in memory, for one site of inst-1."""

    def __init__(self, monkeypatch, live, draft=None, stale=False):
        self.calls = []
        self.live_json = json.dumps(live)
        self.published = [{"id": "rev-5", "revision_no": 5, "status": "PUBLISHED", "source": "MANUAL",
                           "updated_at": "2026-09-01T00:00:00", "catalogue_json": json.dumps(self._older(live))},
                          {"id": "rev-7", "revision_no": 7, "status": "PUBLISHED", "source": "MANUAL",
                           "updated_at": "2026-09-30T00:00:00", "catalogue_json": self.live_json}]
        self.draft = None
        self.stale = stale
        self.publish_error = None
        self.report_stale = True
        if draft is not None:
            self.set_draft(json.dumps(draft))
        base = fake_admin_core([])

        async def _call(ctx_, method, path, params=None, body=None, timeout=None, error_detail=False):
            self.calls.append((method, path, dict(params or {}), body))
            out = self.handle(method, path, params or {}, body)
            return await base(ctx_, method, path, params=params, body=body, timeout=timeout) if out is NotImplemented else out

        for mod in (website_data, edit_mod, website_mod, pub):
            monkeypatch.setattr(mod, "_admin_core_json", _call)

    @staticmethod
    def _older(live):
        older = copy.deepcopy(live)
        older["pages"][0]["title"] = "Home (September)"
        return older

    @property
    def live_no(self):
        return max((r["revision_no"] for r in self.published), default=None)

    def set_draft(self, raw, rev_id="rev-d"):
        self.draft = {"id": rev_id, "revision_no": 8, "status": "DRAFT", "source": "AI_COPILOT", "catalogue_json": raw,
                      "created_at": "2026-10-01T00:00:00", "updated_at": "2026-10-09T00:00:00"}

    def row(self):
        return {**CATALOGUE_ROW, "catalogue_json": self.live_json}

    def handle(self, method, path, params, body):
        if path.endswith("/course-catalogue/institute/get-all"):
            return [self.row()]
        if path.endswith("/course-catalogue/institute/get/by-tag"):
            return self.row() if params.get("tagName") == "main-site" else {"error": "fetch_failed", "status": 404}
        if path.endswith("/revision/draft"):
            if self.draft is None:
                return {"error": "fetch_failed", "status": 204}
            out = dict(self.draft)
            if self.live_no is not None:   # admin-core leaves live_* out (NON_NULL) when nothing was published
                out.update({"live_revision_no": self.live_no, "live_updated_at": "2026-09-30T00:00:00"})
            if self.report_stale:
                out["live_changed_since_draft"] = self.stale
            return out
        if path.endswith("/revision/history"):
            rows = ([{k: v for k, v in self.draft.items() if k != "catalogue_json"}] if self.draft else [])
            return rows + [{k: v for k, v in r.items() if k != "catalogue_json"}
                           for r in sorted(self.published, key=lambda r: -r["revision_no"])]
        if path.endswith("/revision/get"):
            return next((dict(r) for r in self.published if r["id"] == params["revisionId"]),
                        {"error": "fetch_failed", "status": 404})
        if path.endswith("/revision/save-draft"):
            if body.get("create_only") and self.draft is not None:
                return {"error": "fetch_failed", "status": 409, "detail": '{"ex":"DRAFT_EXISTS: ..."}'}
            self.set_draft(body["catalogue_json"], rev_id="rev-new")
            self.draft["source"] = body.get("source")
            return {k: v for k, v in self.draft.items() if k != "catalogue_json"}
        if path.endswith("/revision/discard-draft"):
            self.draft = None
            return {"error": "fetch_failed", "status": 200}
        if path.endswith("/revision/publish"):
            if self.publish_error is not None:
                return self.publish_error
            if self.draft is None:
                return {"error": "fetch_failed", "status": 400}
            if params.get("expectedDraftSha256") and params["expectedDraftSha256"] != sha(self.draft["catalogue_json"]):
                return {"error": "fetch_failed", "status": 409, "detail": '{"ex":"DRAFT_CHANGED: the draft changed"}'}
            if params.get("overrideStale") is not True and (
                    self.stale or ("expectedLiveRevisionNo" in params and params["expectedLiveRevisionNo"] != self.live_no)):
                return {"error": "fetch_failed", "status": 409, "detail": '{"ex":"DRAFT_OLDER_THAN_LIVE: ..."}'}
            promoted = {**self.draft, "status": "PUBLISHED", "revision_no": (self.live_no or 0) + 1}
            self.published.append(promoted)
            self.live_json, self.draft = promoted["catalogue_json"], None
            return {k: v for k, v in promoted.items() if k != "catalogue_json"}
        return NotImplemented

    def live_write(self, live):
        """Someone else publishes (or a legacy PUT /update) — live moves on."""
        self.live_json = json.dumps(live)
        self.published.append({"id": f"rev-{self.live_no + 1}", "revision_no": self.live_no + 1, "status": "PUBLISHED",
                               "source": "LEGACY_UPDATE", "updated_at": "2026-10-10T00:00:00",
                               "catalogue_json": self.live_json})

    def writes(self):
        return [p for m, p, _, _ in self.calls if m == "POST" and ("/revision/" in p)]

    def publishes(self):
        return [(p, params) for m, p, params, _ in self.calls if p.endswith("/revision/publish")]


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'ai.db'}", connect_args={"check_same_thread": False})
    with engine.begin() as conn:   # the institute lookups site_url / editor links make
        conn.execute(text("CREATE TABLE institutes (id TEXT, learner_portal_base_url TEXT, admin_portal_base_url TEXT)"))
        conn.execute(text("CREATE TABLE institute_domain_routing (institute_id TEXT, domain TEXT, subdomain TEXT, role TEXT)"))
        conn.execute(text("INSERT INTO institutes VALUES ('inst-1', 'learn.acme.example', NULL)"))
    PublishConfirm.__table__.create(engine)                # Flyway V562 creates it in production
    monkeypatch.setattr(pub, "_schema_ready", False)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def clean_checks(monkeypatch):
    """Readiness itself is test_website_request_publish's job: here every check passes."""
    async def _audit(ctx_, config, library_id=None):
        return {"summary": {"error": 0, "warning": 0}, "issues": []}

    def _review(ctx_, gs, pages):
        return {str(p.get("route")): {"score": 95, "passes": True, "issues": []} for p in pages}
    monkeypatch.setattr(website_mod, "site_data_audit", _audit)
    monkeypatch.setattr(website_mod, "review_pages", _review)
    monkeypatch.setattr(edit_mod, "run_publish_checks", lambda config: [])


def ctx(db, institute="inst-1", user="user-1", via_mcp=True):
    p = PinnedPrincipal(user_id=user, institute_id=institute, roles=["ADMIN"], permissions=[], is_root_user=False)
    return ToolContext(db=db, principal=p, keys=(), bearer_token="jwt", via_mcp=via_mcp)


async def call(db, tool, args, setting=PUBLISH, **who):
    return json.loads(await execute_tool(tool, args, ctx(db, **who), setting))


async def request(db, setting=PUBLISH, **who):
    return await call(db, "website_edit", {"action": "request_publish", "tag_name": "main-site"}, setting, **who)


async def publish(db, token, setting=PUBLISH, **extra):
    return await call(db, "website_publish", {"action": "publish", "tag_name": "main-site",
                                              "confirm_token": token, **extra}, setting)


def edited(live, title="New home"):
    draft = copy.deepcopy(live)
    draft["pages"][0]["title"] = title
    return draft


def tokens(db):
    return db.query(PublishConfirm).all()


# ── request_publish issues the token ─────────────────────────────────────
@pytest.mark.asyncio
async def test_request_publish_issues_a_token_only_to_a_caller_with_the_capability(db, monkeypatch):
    live = sample_config()
    AdminCore(monkeypatch, live, edited(live))
    out = await request(db, EDIT_ONLY)
    assert out["verdict"] == "ready" and "publish_confirm" not in out
    assert "never publishes" in out["note"] and tokens(db) == []

    out = await request(db)
    confirm = out["publish_confirm"]
    assert confirm["issued"] is True and confirm["confirm_token"].startswith("vpc_")
    assert confirm["expires_in_seconds"] == 600 and confirm["draft_revision_no"] == 8 and confirm["live_revision_no"] == 7
    assert "website_publish(action='publish'" in confirm["how"] and "yes" in out["next"]
    assert "never tell the admin the site is live" in out["note"]
    # Only the hash is stored, bound to this institute, user, site, draft and live state.
    [row] = tokens(db)
    assert row.id == sha(confirm["confirm_token"]) and confirm["confirm_token"] not in json.dumps(
        {c.name: str(getattr(row, c.name)) for c in row.__table__.columns})
    assert (row.institute_id, row.user_id, row.catalogue_id, row.action) == ("inst-1", "user-1", "cat-1", "publish")
    assert row.draft_revision_id == "rev-d" and row.draft_sha256 == sha(json.dumps(edited(live)))
    assert row.live_revision_no == 7 and row.used_at is None


@pytest.mark.asyncio
async def test_no_token_for_a_draft_that_is_not_ready_or_not_known_to_be_current(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    monkeypatch.setattr(edit_mod, "run_publish_checks",
                        lambda config: [{"severity": "error", "code": "x", "message": "Form not linked"}])
    out = await request(db)
    assert out["verdict"] == "not_ready" and out["publish_confirm"]["issued"] is False
    assert "confirm_token" not in json.dumps(out)
    monkeypatch.setattr(edit_mod, "run_publish_checks", lambda config: [])
    be.report_stale = False                      # an older admin-core: staleness unknown
    out = await request(db)
    assert out["verdict"] == "ready" and out["publish_confirm"]["issued"] is False
    assert "confirm_token" not in json.dumps(out)
    be.report_stale, be.stale = True, True       # a stale draft is never "ready"
    out = await request(db)
    assert out["verdict"] == "not_ready" and "confirm_token" not in json.dumps(out)


@pytest.mark.asyncio
async def test_a_new_check_replaces_the_previous_token(db, monkeypatch):
    live = sample_config()
    AdminCore(monkeypatch, live, edited(live))
    first = (await request(db))["publish_confirm"]["confirm_token"]
    second = (await request(db))["publish_confirm"]["confirm_token"]
    out = await publish(db, first)
    assert out["error"] == "confirm_token_used" and out["published"] is False
    assert (await publish(db, second))["published"] is True


# ── the happy path ───────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_publish_with_a_fresh_token_publishes_the_checked_draft(db, monkeypatch):
    live = sample_config()
    draft = edited(live)
    be = AdminCore(monkeypatch, live, draft)
    token = (await request(db))["publish_confirm"]["confirm_token"]
    out = await publish(db, token)
    assert out["action"] == "publish" and out["published"] is True
    assert out["published_revision_no"] == 8 and out["previous_live_revision_no"] == 7
    assert out["rollback_hint"]["available"] is True and out["rollback_hint"]["to_revision_no"] == 7
    assert "website_publish(action='rollback'" in out["rollback_hint"]["how"]
    assert out["live_url"] and "manage-pages/editor/main-site" in out["editor_url"]
    [(_, params)] = be.publishes()
    assert params == {"catalogueId": "cat-1", "expectedDraftSha256": sha(json.dumps(draft)), "expectedLiveRevisionNo": 7}
    assert json.loads(be.live_json) == draft and be.draft is None
    # Single use.
    again = await publish(db, token)
    assert again["error"] == "confirm_token_used" and len(be.publishes()) == 1


@pytest.mark.asyncio
async def test_first_publish_has_no_rollback_target(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    be.published = []                                # never published: no live revision number
    token = (await request(db))["publish_confirm"]["confirm_token"]
    assert tokens(db)[0].live_revision_no is None
    out = await publish(db, token)
    assert out["published"] is True and out["previous_live_revision_no"] is None
    assert out["rollback_hint"]["available"] is False
    assert "expectedLiveRevisionNo" not in be.publishes()[0][1]


# ── refusals: the token ──────────────────────────────────────────────────
@pytest.mark.asyncio
@pytest.mark.parametrize("token", [None, "", "abc", "vpc_short", "vpc_" + "A" * 43 + "!", 42])
async def test_missing_or_malformed_tokens_are_refused(db, monkeypatch, token):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    out = await publish(db, token)
    assert out["error"] == "invalid_confirm_token" and out["published"] is False
    assert "request_publish" in out["message"] and be.publishes() == []


@pytest.mark.asyncio
async def test_missing_flyway_table_is_a_clear_refusal_and_never_ddl(db, monkeypatch):
    """ai_service runs no DDL: without Flyway V562's table, publish refuses cleanly and creates nothing."""
    from sqlalchemy import inspect
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    PublishConfirm.__table__.drop(db.get_bind())
    out = await publish(db, "vpc_" + "A" * 43)
    assert out["error"] == "publish_unavailable" and out["published"] is False
    assert be.publishes() == []
    assert not inspect(db.get_bind()).has_table("mcp_publish_confirm")


@pytest.mark.asyncio
async def test_a_guessed_token_is_refused(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    await request(db)
    out = await publish(db, "vpc_" + "A" * 43)
    assert out["error"] == "invalid_confirm_token" and be.publishes() == []


@pytest.mark.asyncio
async def test_another_institutes_or_users_token_is_refused(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    out = await call(db, "website_publish", {"action": "publish", "confirm_token": token}, institute="inst-2")
    assert out["error"] == "invalid_confirm_token"
    out = await call(db, "website_publish", {"action": "publish", "confirm_token": token}, user="user-2")
    assert out["error"] == "invalid_confirm_token"
    assert be.publishes() == []
    # Neither attempt spent it.
    assert (await publish(db, token))["published"] is True


@pytest.mark.asyncio
async def test_an_expired_token_is_refused(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    row = tokens(db)[0]
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    out = await publish(db, token)
    assert out["error"] == "confirm_token_expired" and "10 minutes" in out["message"] and be.publishes() == []


@pytest.mark.asyncio
async def test_the_token_lasts_ten_minutes(db, monkeypatch):
    live = sample_config()
    AdminCore(monkeypatch, live, edited(live))
    before = datetime.now(timezone.utc)
    await request(db)
    row = tokens(db)[0]
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    assert timedelta(minutes=9, seconds=58) <= expires - before <= timedelta(minutes=10, seconds=2)


@pytest.mark.asyncio
async def test_a_draft_edited_after_the_check_is_refused(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    be.draft["catalogue_json"] = json.dumps(edited(live, "Edited after the check"))   # same revision, new JSON
    out = await publish(db, token)
    assert out["error"] == "confirm_token_mismatch" and "request_publish" in out["message"]
    assert be.publishes() == [] and be.draft is not None
    # The token is not spent by a refused check; but it can never match this draft.
    assert tokens(db)[0].used_at is None


@pytest.mark.asyncio
async def test_a_draft_older_than_live_is_refused(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    be.stale = True
    out = await publish(db, token)
    assert out["error"] == "draft_older_than_live" and out["published"] is False and be.publishes() == []


@pytest.mark.asyncio
async def test_a_live_site_that_moved_is_refused(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    be.live_write(edited(live, "Fixed live"))
    out = await publish(db, token)
    assert out["error"] == "confirm_token_mismatch" and "v7" in out["message"] and "v8" in out["message"]
    assert be.publishes() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("detail,code", [
    ('{"ex":"DRAFT_OLDER_THAN_LIVE: the live site changed"}', "draft_older_than_live"),
    ('{"ex":"DRAFT_CHANGED: the draft changed"}', "draft_changed"),
    ('{"ex":"STALE_GUARD_OFF: the publish stale guard is turned off"}', "stale_guard_off"),
])
async def test_the_servers_409_is_a_refusal(db, monkeypatch, detail, code):
    """admin-core's own guard (row-locked) catches what changed between our check and its publish."""
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    be.publish_error = {"error": "fetch_failed", "status": 409, "detail": detail}
    out = await publish(db, token)
    assert out["error"] == code and out["published"] is False and "Nothing was published" in out["message"]
    assert be.draft is not None
    assert (await publish(db, token))["error"] == "confirm_token_used"


@pytest.mark.asyncio
async def test_a_publish_that_does_not_answer_is_reported_as_unknown(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    be.publish_error = {"error": "fetch_failed"}
    out = await publish(db, token)
    assert out["error"] == "publish_unknown" and "Do not retry" in out["message"]


@pytest.mark.asyncio
async def test_a_token_for_another_site_or_action_is_refused(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    out = await publish(db, token, tag_name="other-site")
    assert out["error"] == "confirm_token_mismatch" and "main-site" in out["message"]
    out = await call(db, "website_publish", {"action": "rollback", "tag_name": "main-site", "to_revision_no": 5,
                                             "confirm_token": token})
    assert out["error"] == "confirm_token_mismatch" and "publish" in out["message"]
    assert be.publishes() == []


@pytest.mark.asyncio
async def test_a_server_that_does_not_report_staleness_cannot_publish(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    be.report_stale = False
    out = await publish(db, token)
    assert out["error"] == "stale_check_unavailable" and be.publishes() == []


@pytest.mark.asyncio
async def test_a_discarded_draft_has_nothing_to_publish(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    be.draft = None
    out = await publish(db, token)
    assert out["error"] == "no_draft" and be.publishes() == []


# ── refusals: the gate and the arguments ─────────────────────────────────
@pytest.mark.asyncio
async def test_the_tool_is_off_without_its_own_group(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    out = await publish(db, token, setting=EDIT_ONLY)
    assert out["error"] == "tool_not_permitted" and be.publishes() == []


@pytest.mark.asyncio
async def test_the_in_product_assistant_can_neither_get_a_token_nor_publish(db, monkeypatch):
    """MCP-only is enforced, not just "not offered": a settings row enabling the group for the in-product
    assistant (whose context is not via_mcp) gets no token and cannot call the tool."""
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    out = await call(db, "website_edit", {"action": "request_publish", "tag_name": "main-site"}, via_mcp=False)
    assert out["verdict"] == "ready" and "publish_confirm" not in out and tokens(db) == []
    token = (await request(db))["publish_confirm"]["confirm_token"]
    out = await call(db, "website_publish", {"action": "publish", "tag_name": "main-site", "confirm_token": token},
                     via_mcp=False)
    assert out["error"] == "tool_not_available" and be.publishes() == []
    assert (await publish(db, token))["published"] is True      # the token was not spent by the refused call


def test_the_group_is_not_listed_as_an_assistant_settings_capability():
    """The in-product assistant tells the model every GROUP_LABELS group can be turned on in Assistant
    settings; this MCP-only group is not there (its label lives in MCP_TOOL_GROUP_LABELS)."""
    from app.mcp.constants import MCP_TOOL_GROUP_LABELS
    from app.services.assistant_tool_registry import GROUP_LABELS
    assert pub.WEBSITE_PUBLISH_GROUP_KEY not in GROUP_LABELS
    assert MCP_TOOL_GROUP_LABELS[pub.WEBSITE_PUBLISH_GROUP_KEY] == "Website: publish"


@pytest.mark.asyncio
async def test_a_failed_token_issue_leaves_the_session_usable(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    rolled = []
    real_rollback = db.rollback

    def _rollback():
        rolled.append(True)
        real_rollback()

    def _boom(*a, **k):
        raise RuntimeError("db down")
    monkeypatch.setattr(db, "rollback", _rollback)
    monkeypatch.setattr(pub, "_issue_token", lambda *a, **k: _boom())
    out = await request(db)
    assert out["publish_confirm"]["issued"] is False and rolled
    rolled.clear()
    be.draft = None                      # a rollback needs a site without an open draft
    out = await rollback(db)
    assert out["error"] == "token_unavailable" and rolled


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["access_token", "api_key", "Authorization", "password"])
async def test_credentials_are_refused_and_never_echoed(db, monkeypatch, key):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    token = (await request(db))["publish_confirm"]["confirm_token"]
    out = await publish(db, token, **{key: "SECRET-123"})
    assert out["error"] == "secret_not_accepted" and "SECRET-123" not in json.dumps(out)
    assert be.publishes() == [] and tokens(db)[0].used_at is None


@pytest.mark.asyncio
async def test_unknown_action(db, monkeypatch):
    out = await call(db, "website_publish", {"action": "unpublish"})
    assert out["error"] == "unknown_action" and out["available"] == ["publish", "rollback"]


# ── rollback ─────────────────────────────────────────────────────────────
async def rollback(db, to=5, token=None, **extra):
    args = {"action": "rollback", "tag_name": "main-site", "to_revision_no": to, **extra}
    if token is not None:
        args["confirm_token"] = token
    return await call(db, "website_publish", args)


@pytest.mark.asyncio
async def test_rollback_is_two_steps_and_republishes_the_old_version(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live)
    old_json = be.published[0]["catalogue_json"]
    first = await rollback(db)
    assert first["confirm_required"] is True and first["published"] is False
    assert first["to_revision_no"] == 5 and first["live_revision_no"] == 7
    assert first["diff_vs_live"]["changed"] is True and "yes" in first["next"]
    assert be.writes() == []                          # step one writes nothing to admin-core

    out = await rollback(db, token=first["confirm_token"])
    assert out["published"] is True and out["rolled_back_to_revision_no"] == 5
    assert out["published_revision_no"] == 8 and out["previous_live_revision_no"] == 7
    assert out["rollback_hint"]["to_revision_no"] == 7
    saves = [(p, b) for m, p, _, b in be.calls if p.endswith("/save-draft")]
    assert saves == [("/admin-core-service/v1/course-catalogue/revision/save-draft",
                      {"catalogue_json": old_json, "source": "MCP_ROLLBACK", "ai_run_id": None, "create_only": True})]
    [(_, params)] = be.publishes()
    assert params == {"catalogueId": "cat-1", "expectedDraftSha256": sha(old_json), "expectedLiveRevisionNo": 7}
    assert be.live_json == old_json and be.draft is None
    # Every version stays: the rolled-back one is still in the history.
    assert [r["revision_no"] for r in be.published] == [5, 7, 8]
    assert (await rollback(db, token=first["confirm_token"]))["error"] == "confirm_token_used"


@pytest.mark.asyncio
async def test_rollback_never_overwrites_an_open_draft(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    out = await rollback(db)
    assert out["error"] == "open_draft" and "discard" in out["message"] and tokens(db) == []
    assert be.writes() == []


@pytest.mark.asyncio
async def test_rollback_refuses_when_a_draft_appears_between_the_steps(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live)
    token = (await rollback(db))["confirm_token"]
    be.set_draft(json.dumps(edited(live, "Admin's new work")))
    out = await rollback(db, token=token)
    assert out["error"] == "open_draft" and be.writes() == []
    assert json.loads(be.draft["catalogue_json"])["pages"][0]["title"] == "Admin's new work"


@pytest.mark.asyncio
async def test_rollback_create_only_save_loses_the_race_safely(db, monkeypatch):
    """A draft opened after our last read: admin-core's create_only refuses, nothing is overwritten."""
    live = sample_config()
    be = AdminCore(monkeypatch, live)
    token = (await rollback(db))["confirm_token"]
    orig = be.handle

    def racing(method, path, params, body):
        if path.endswith("/save-draft"):
            be.set_draft(json.dumps(edited(live, "Opened a moment ago")))
        return orig(method, path, params, body)
    be.handle = racing
    out = await rollback(db, token=token)
    assert out["error"] == "open_draft" and be.publishes() == []
    assert json.loads(be.draft["catalogue_json"])["pages"][0]["title"] == "Opened a moment ago"


@pytest.mark.asyncio
async def test_rollback_refuses_unknown_live_and_identical_targets(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live)
    out = await rollback(db, to=4)
    assert out["error"] == "revision_not_found" and [r["revision_no"] for r in out["published_revisions"]] == [7, 5]
    assert (await rollback(db, to=7))["error"] == "already_live"
    be.published[0]["catalogue_json"] = be.live_json  # v5 has the live content
    assert (await rollback(db, to=5))["error"] == "already_live"
    for bad in (None, 0, -1, "five", True):
        out = await call(db, "website_publish", {"action": "rollback", "tag_name": "main-site", "to_revision_no": bad})
        assert out["error"] == "to_revision_no_required" and out["published"] is False
        # It says which versions there are to choose from.
        assert [r["revision_no"] for r in out["published_revisions"]] == [7, 5]
    assert be.writes() == []


@pytest.mark.asyncio
async def test_a_rollback_token_is_for_its_own_target_and_live_state(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live)
    be.published.insert(0, {"id": "rev-3", "revision_no": 3, "status": "PUBLISHED", "source": "MANUAL",
                            "catalogue_json": json.dumps(edited(live, "Very old"))})
    token = (await rollback(db, to=5))["confirm_token"]
    out = await rollback(db, to=3, token=token)
    assert out["error"] == "confirm_token_mismatch" and be.writes() == []
    be.live_write(edited(live, "Someone published"))
    out = await rollback(db, to=5, token=token)
    assert out["error"] == "confirm_token_mismatch" and "changed" in out["message"] and be.writes() == []


@pytest.mark.asyncio
async def test_a_failed_rollback_publish_drops_only_its_own_draft(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live)
    token = (await rollback(db))["confirm_token"]
    be.publish_error = {"error": "fetch_failed", "status": 409, "detail": '{"ex":"DRAFT_OLDER_THAN_LIVE: x"}'}
    out = await rollback(db, token=token)
    assert out["error"] == "draft_older_than_live" and be.draft is None
    assert [p for p in be.writes() if p.endswith("/discard-draft")]
    # Someone edited the rollback draft in between: theirs now — kept.
    token = (await rollback(db))["confirm_token"]
    be.publish_error = {"error": "fetch_failed", "status": 409, "detail": '{"ex":"DRAFT_CHANGED: x"}'}
    out = await rollback(db, token=token)
    assert out["error"] == "draft_changed" and be.draft is not None


@pytest.mark.asyncio
async def test_a_rollback_refused_because_the_guard_is_off_drops_its_own_draft(db, monkeypatch):
    live = sample_config()
    be = AdminCore(monkeypatch, live)
    token = (await rollback(db))["confirm_token"]
    be.publish_error = {"error": "fetch_failed", "status": 409, "detail": '{"ex":"STALE_GUARD_OFF: off"}'}
    out = await rollback(db, token=token)
    assert out["error"] == "stale_guard_off" and "Do not retry" in out["message"] and be.draft is None


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [
    {"error": "fetch_failed", "status": 400},          # "No draft to publish": someone published / discarded it
    {"error": "fetch_failed", "status": 502},
    {"error": "fetch_failed"},                          # no answer: outcome unknown
])
async def test_a_rollback_publish_failure_never_discards_a_draft_it_cannot_vouch_for(db, monkeypatch, error):
    """discard-draft drops whichever draft is open, so it runs only after the server confirmed it is ours."""
    live = sample_config()
    be = AdminCore(monkeypatch, live)
    token = (await rollback(db))["confirm_token"]
    be.publish_error = error
    out = await rollback(db, token=token)
    assert out["published"] is False
    assert not [p for p in be.writes() if p.endswith("/discard-draft")] and be.draft is not None
    if error.get("status") == 502:
        assert "draft_left_open" in out


@pytest.mark.asyncio
async def test_published_site_can_be_rolled_back_with_the_hint(db, monkeypatch):
    """publish → rollback_hint → rollback: back to exactly the version that was live before."""
    live = sample_config()
    be = AdminCore(monkeypatch, live, edited(live))
    before = be.live_json
    token = (await request(db))["publish_confirm"]["confirm_token"]
    hint = (await publish(db, token))["rollback_hint"]
    first = await rollback(db, to=hint["to_revision_no"])
    out = await rollback(db, to=hint["to_revision_no"], token=first["confirm_token"])
    assert out["published"] is True and be.live_json == before
