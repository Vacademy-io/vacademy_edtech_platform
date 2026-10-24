"""mcp_tool_call_log.args_json: a base64 image is stored as size + hash, never
whole (client artwork, up to ~13 MB of text per call on the primary), and any
call's args are bounded; ordinary calls are logged exactly as before."""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.mcp import repository as repo_mod  # noqa: E402


def test_ordinary_args_are_logged_unchanged():
    args = {"action": "update_page", "tag_name": "home", "ops": [{"op": "set_props", "props": {"title": "Hi"}}]}
    assert json.loads(repo_mod._audit_args_json(args)) == args
    assert repo_mod._audit_args_json(None) == "{}"


def test_base64_image_is_replaced_by_its_size_and_hash():
    blob = "iVBORw0KGgo" * 1_000_000  # ~11 MB of base64
    out = repo_mod._audit_args_json({"action": "import_image", "data_base64": blob, "file_name": "hero.png"})
    assert len(out) < 1_000 and "iVBORw0KGgo" not in out
    logged = json.loads(out)
    assert logged["action"] == "import_image" and logged["file_name"] == "hero.png"
    assert logged["data_base64"] == {"bytes": len(blob), "sha256": hashlib.sha256(blob.encode()).hexdigest()}


def test_oversized_args_keep_their_small_fields_only():
    page = {"components": [{"type": "textBlock", "props": {"text": "x" * 1_000}} for _ in range(200)]}
    out = repo_mod._audit_args_json({"action": "create_page", "tag_name": "bv", "route": "/about", "page": page})
    assert len(out) <= repo_mod._AUDIT_ARGS_MAX_CHARS
    logged = json.loads(out)
    assert logged["_truncated"] is True and logged["action"] == "create_page" and logged["route"] == "/about"
    assert set(logged["page"]) == {"bytes", "sha256"}


def test_log_tool_call_writes_the_bounded_args():
    captured = {}

    class _Db:
        def execute(self, stmt, params):
            captured.update(params)

        def commit(self):
            pass

        def rollback(self):
            pass

    repo = repo_mod.McpOAuthRepository(_Db(), cipher=None)
    repo.log_tool_call(user_id="u", institute_id="i", client_id=None, client_name=None, tool_name="website_edit",
                       args={"action": "import_image", "data_base64": "A" * 5_000_000}, ok=True, error_code=None,
                       duration_ms=5)
    assert len(captured["args"]) < 1_000 and json.loads(captured["args"])["data_base64"]["bytes"] == 5_000_000


# ── CRM tools: an allow-list, per tool ───────────────────────────────────
import pytest  # noqa: E402

from app.services import assistant_tool_registry as registry  # noqa: E402

PHONE, EMAIL, NAME = "+91 98765 43210", "asha.k@example.com", "Asha Kumari"


@pytest.fixture
def crm_tool(monkeypatch):
    """A registered crm_* schema with enums, so the audit can tell enum values from free text."""
    schema = {"type": "function", "function": {"name": "crm_zz", "description": "t", "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["find", "log_interaction"]},
            "kind": {"type": "string", "enum": ["CALL", "WHATSAPP", "NOTE"]},
            "filter": {"type": "object", "properties": {
                "owner": {"type": "string"},
                "sla": {"type": "string", "enum": ["overdue", "due_soon"]},
                "tiers": {"type": "array", "items": {"type": "string", "enum": ["HOT", "WARM"]}},
            }},
        },
    }}}

    async def executor(args, ctx):
        return "{}"

    monkeypatch.setitem(registry.ASSISTANT_TOOLS, "crm_zz",
                        registry.ToolSpec(name="crm_zz", schema=schema, executor=executor, mcp_only=True))
    return "crm_zz"


def test_crm_call_stores_no_contact_details_or_free_text(crm_tool):
    args = {
        "action": "log_interaction", "lead_id": "7f0c2c1e-1111-2222-3333-444455556666", "query": PHONE,
        "phone": PHONE, "email": EMAIL, "name": NAME, "note": "Wants NEET coaching, call Friday",
        "kind": "CALL", "next_followup_at": "2026-10-17T17:00:00+05:30", "confirm_token": "tok-secret",
        "variables": {"1": NAME}, "lead_ids": ["a1", "b2"], "limit": 20, "re_enquiry": False,
        "mobile_number": 9876543210, "date_of_birth": "2008-04-01",
        "filter": {"owner": "me", "sla": "overdue", "tiers": ["HOT", "Asha"], "submitted_from": "2026-10-01",
                   "list_ids": ["L1"], "min_score": 5},
    }
    out = repo_mod._audit_args_json(args, crm_tool)
    for secret in (PHONE, EMAIL, NAME, "NEET", "tok-secret", "9876543210", "2008-04-01", "Asha"):
        assert secret not in out, secret
    logged = json.loads(out)
    assert logged["action"] == "log_interaction" and logged["kind"] == "CALL"
    assert logged["lead_id"] == args["lead_id"] and logged["lead_ids"] == ["a1", "b2"]
    assert logged["limit"] == 20 and logged["re_enquiry"] is False
    assert logged["next_followup_at"] == "2026-10-17T17:00:00+05:30"
    assert logged["phone"] == {"redacted": True, "bytes": len(PHONE)}
    assert logged["query"] == {"redacted": True, "bytes": len(PHONE)}
    assert logged["note"]["redacted"] is True and "sha256" not in json.dumps(logged)
    assert logged["filter"]["sla"] == "overdue" and logged["filter"]["owner"]["redacted"] is True
    assert logged["filter"]["tiers"] == ["HOT", {"redacted": True, "bytes": 4}]
    assert logged["filter"]["submitted_from"] == "2026-10-01" and logged["filter"]["list_ids"] == ["L1"]
    assert logged["filter"]["min_score"] == 5


def test_crm_redaction_works_without_a_registered_schema():
    """A crm_* tool whose module has not loaded keeps no enum values (nothing to check them against)."""
    logged = json.loads(repo_mod._audit_args_json({"action": "find", "query": NAME, "kind": "CALL"}, "crm_missing"))
    assert logged == {"action": "find", "query": {"redacted": True, "bytes": len(NAME)},
                      "kind": {"redacted": True, "bytes": 4}}


def test_non_crm_tools_are_logged_as_before(crm_tool):
    args = {"action": "find", "query": NAME, "name": NAME}
    assert json.loads(repo_mod._audit_args_json(args, "learners")) == args
    assert repo_mod._audit_args_json(args, "learners") == repo_mod._audit_args_json(args)


def test_log_tool_call_redacts_by_tool_name(crm_tool):
    captured = {}

    class _Db:
        def execute(self, stmt, params):
            captured.update(params)

        def commit(self):
            pass

        def rollback(self):
            pass

    repo = repo_mod.McpOAuthRepository(_Db(), cipher=None)
    repo.log_tool_call(user_id="u", institute_id="i", client_id=None, client_name=None, tool_name=crm_tool,
                       args={"action": "find", "query": PHONE}, ok=True, error_code=None, duration_ms=5)
    assert PHONE not in captured["args"] and json.loads(captured["args"])["action"] == "find"
