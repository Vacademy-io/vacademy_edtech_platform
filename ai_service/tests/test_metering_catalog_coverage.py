"""CI guard for the AI usage-metering vocabulary seeded by the V586 Flyway migration.

The migration (admin_core_service .../db/migration/V*__ai_usage_metering.sql) seeds
ai_use_case_catalog, ai_role_class_map and ai_model_alias. ai_service maps every
usage event to a catalog row (explicit use_case > tool_key > request_type >
'unknown'), so a request_type, tool key or model use case that the seed does not
cover lands in 'unknown' on the History page. This test parses the seed (no DB)
and fails when:

  (a) a billed key in ai_service/app/constants/model_use_cases.py has no catalog
      row (same key, or a row whose model_use_case is that key) and is not in the
      explicit COVERED_BY / NOT_BILLED lists below;
  (b) a RequestType value (Python enum, Java enum, or a value seen in the prod
      ledger) or an ai_tool_pricing tool key does not map to a non-'unknown' row;
  plus structural checks on the migration (IF NOT EXISTS, ON CONFLICT targets,
  no CHECK constraints, no Flyway ${...} placeholders, balanced parentheses).

When you add a model use case, request type or tool key: add it to a catalog row
in a NEW migration (the seed uses ON CONFLICT DO NOTHING, so editing V586 after it
ran changes nothing on prod) and update the expectations here.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from ai_service.app.constants import model_use_cases as muc  # noqa: E402

MIGRATION_DIR = REPO / "admin_core_service" / "src" / "main" / "resources" / "db" / "migration"
AI_APP = REPO / "ai_service" / "app"
JAVA_REQUEST_TYPE = (
    REPO / "admin_core_service" / "src" / "main" / "java" / "vacademy" / "io" / "admin_core_service"
    / "features" / "ai_usage" / "enums" / "RequestType.java"
)

# Every request_type in prod credit_transactions (all time) and ai_token_usage (120 days),
# checked on the read-only standby 2026-10-15. Several are written only by Java or by
# string literals, so they are not in either enum.
PROD_REQUEST_TYPES = (
    "agent", "analytics", "voice_call_out", "ai_call_out", "content", "video", "image",
    "conversation", "call_intelligence", "tts_premium", "stock", "pdf_questions", "outline",
    "chatbot", "knowledge_base", "assessment", "evaluation", "engagement_message", "tts",
    "copilot", "ai_video", "voice_call_in", "ai_call_in", "lecture", "avatar_video",
    "transcription", "reels_preview", "notes", "coding_question", "presentation", "report",
)

# Every ai_tool_pricing.tool_key on prod (2026-10-15).
PROD_TOOL_KEYS = (
    "assessment", "assessment_class_ai_report", "kb_paper_blueprint", "kb_paper_questions",
    "kb_paper_regenerate", "coding_question", "course_slide_assessment", "course_slide_document",
    "course_slide_video", "html_document", "html_document_edit", "html_document_pdf",
    "tutor_compile_slide", "tutor_live_minute", "copy_check_evaluation", "copy_check_evaluation_api",
    "html_document_image", "tutor_media_image", "kb_ask", "kb_companion_ask", "kb_companion_lesson",
    "kb_companion_practice", "kb_companion_speech", "kb_ingest_page", "kb_ingest_url",
    "kb_library_unlock", "lecture", "notes", "course_outline", "extract_questions",
    "extract_questions_ocr", "transcription", "dub_video", "translate_course", "translate_question",
    "translate_rich_text", "translate_strings",
)

# Model use cases whose spend is metered under ANOTHER catalog row (a sub-step of
# that feature). key -> catalog use_case.
COVERED_BY: Dict[str, str] = {
    "brand_kit": "page_builder",              # brand-kit scrape is a page-builder step (tool page_brand_kit)
    "image_keyword": "content_image",         # stock-image keywords for banners / slides
    "copy_check_deduction": "evaluation",     # re-check inside copy-check grading
    "question_metadata": "questions",         # request_type question_metadata -> questions
    "knowledge_base_summary": "knowledge_base",  # runs during KB ingest (kb_ingest_*)
    "reels_preview": "reels",
    "reels_director": "reels",
    "video_image": "lesson_video",            # AI-video stage models: billed on the video batch
    "video_support_visual": "lesson_video",
}

# Catalog rows seeded by a LATER migration than V586 (this test only parses V586):
# use_case -> (migration, tool keys that row owns).
SEEDED_LATER: Dict[str, Tuple[str, Tuple[str, ...]]] = {
    "site_assistant": ("V598__Site_assistant.sql", ("site_assistant_answer",)),
    "course_knowledge": ("V600__Course_knowledge.sql", ("course_kb_ocr_page", "course_kb_transcribe_minute")),
}
SEEDED_LATER_TOOL_KEYS = {k for _m, keys in SEEDED_LATER.values() for k in keys}

# Model use cases that are not a billable feature of their own.
NOT_BILLED: Dict[str, str] = {
    "platform_default": "base model tier; the caller's own request_type / use case is what bills",
    "knowledge_base_figure": "reserved, not read by code yet",
}

FEATURE_GROUPS = {
    "tutor", "video", "calling", "content", "assessment", "analytics", "kb", "crm",
    "engagement", "agent", "media", "platform",
}
SURFACES = {
    "ADMIN_APP", "LEARNER_APP", "PUBLIC", "PARTNER_API", "WHATSAPP", "PHONE", "SCHEDULED",
    "INTERNAL", "UNKNOWN",
}
CATALOG_ACTOR_KINDS = {"USER", "SYSTEM", "ON_BEHALF"}
UNIT_KINDS = {"TOKENS", "IMAGES", "SECONDS", "MINUTES", "CHARS", "REQUESTS", "MIXED"}
MAP_ROLE_CLASSES = {"ADMIN", "TEACHER", "STAFF", "PARENT", "LEARNER"}

CATALOG_COLUMNS = (
    "use_case", "feature_group", "label", "label_template", "count_unit_label", "model_use_case",
    "legacy_request_types", "tool_keys", "capability_key", "default_surface", "actor_kind", "unit_kind",
    "plan_eligible", "limit_eligible", "reserve_on_authorize", "intentionally_separate", "display_order",
    "updated_by",
)

# Names the K4 Java callers and the design reference by key.
REQUIRED_USE_CASES = {
    "ai_calling", "telephony", "call_intelligence", "learner_analytics", "student_report",
    "report_narrative", "class_report", "lesson_video", "ai_video_clip", "avatar_video", "tutor_live",
    "tutor_chat", "chat_with_pdf", "learner_assistant", "vacademy_assistant", "admin_agent", "content",
    "content_image", "course_outline", "course_assist", "questions", "evaluation", "knowledge_base",
    "transcript_notes", "transcription", "lecture", "presentation", "copilot", "chatbot_flow",
    "engagement_message", "tts", "stock_media", "agent_assist", "embedding", "web_search",
    "voice_bot_llm", "unknown",
    # explicitly named in the U1 task
    "page_builder_image", "course_assist_image", "quiz_image", "document_image", "html_document",
    "page_builder", "engagement_plan",
    # Java LLMService CTX_USE_CASE values
    "engagement", "workflow_draft", "parent_assistant",
}


# ── SQL helpers (no DB) ────────────────────────────────────────────────────

def _migration_path() -> Path:
    hits = sorted(MIGRATION_DIR.glob("V*__ai_usage_metering.sql"))
    assert len(hits) == 1, f"expected exactly one V*__ai_usage_metering.sql, found {hits}"
    return hits[0]


def _strip_comments(sql: str) -> str:
    """Drop -- and /* */ comments outside string literals; keep strings intact."""
    out: List[str] = []
    i, n = 0, len(sql)
    while i < n:
        c = sql[i]
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and j + 1 < n and sql[j + 1] == "'":
                    j += 2
                    continue
                if sql[j] == "'":
                    break
                j += 1
            out.append(sql[i:j + 1])
            i = j + 1
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j < 0 else j
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def _mask_strings(sql: str) -> str:
    return re.sub(r"'(?:[^']|'')*'", "''", sql)


def _parse_tuples(values_sql: str) -> List[List[object]]:
    """Parse "(v, v, ...), (v, ...)" where v is a quoted string, NULL, TRUE/FALSE or an int."""
    rows: List[List[object]] = []
    i, n = 0, len(values_sql)
    row: Optional[List[object]] = None
    while i < n:
        c = values_sql[i]
        if c.isspace() or c == ",":
            i += 1
        elif c == "(":
            assert row is None, "nested tuple"
            row = []
            i += 1
        elif c == ")":
            assert row is not None
            rows.append(row)
            row = None
            i += 1
        elif c == "'":
            j, buf = i + 1, []
            while True:
                if values_sql[j] == "'" and j + 1 < n and values_sql[j + 1] == "'":
                    buf.append("'")
                    j += 2
                elif values_sql[j] == "'":
                    break
                else:
                    buf.append(values_sql[j])
                    j += 1
            assert row is not None
            row.append("".join(buf))
            i = j + 1
        else:
            m = re.match(r"(NULL|TRUE|FALSE|-?\d+)", values_sql[i:], re.I)
            assert m, f"unexpected token near: {values_sql[i:i + 40]!r}"
            tok = m.group(1).upper()
            assert row is not None
            row.append(None if tok == "NULL" else True if tok == "TRUE" else False if tok == "FALSE" else int(tok))
            i += len(m.group(1))
    assert row is None, "unterminated tuple"
    return rows


def _insert_rows(sql: str, table: str) -> Tuple[List[str], List[List[object]], str]:
    m = re.search(
        rf"INSERT INTO {table}\s*\(([^)]*)\)\s*VALUES(.*?)ON CONFLICT\s*\(([^)]*)\)\s*DO NOTHING\s*;",
        sql, re.S | re.I,
    )
    assert m, f"no INSERT ... ON CONFLICT DO NOTHING seed for {table}"
    cols = [c.strip() for c in m.group(1).split(",")]
    rows = _parse_tuples(m.group(2))
    for r in rows:
        assert len(r) == len(cols), f"{table}: row has {len(r)} values for {len(cols)} columns: {r[:2]}"
    return cols, rows, m.group(3).strip()


def _array(v: object) -> List[str]:
    assert isinstance(v, str) and v.startswith("{") and v.endswith("}"), v
    inner = v[1:-1].strip()
    return [x.strip() for x in inner.split(",")] if inner else []


@pytest.fixture(scope="module")
def sql() -> str:
    return _strip_comments(_migration_path().read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def catalog(sql) -> Dict[str, dict]:
    cols, rows, target = _insert_rows(sql, "ai_use_case_catalog")
    assert tuple(cols) == CATALOG_COLUMNS
    assert target == "use_case"
    out: Dict[str, dict] = {}
    for r in rows:
        d = dict(zip(cols, r))
        d["legacy_request_types"] = _array(d["legacy_request_types"])
        d["tool_keys"] = _array(d["tool_keys"])
        assert d["use_case"] not in out, f"duplicate catalog row {d['use_case']}"
        out[d["use_case"]] = d
    return out


def _resolve(catalog: Dict[str, dict], *, use_case: Optional[str] = None,
             tool_key: Optional[str] = None, request_type: Optional[str] = None) -> str:
    """d_credits 1.4: explicit active key > tool_key > request_type (by display_order) > 'unknown'."""
    rows = sorted(catalog.values(), key=lambda r: r["display_order"])
    if use_case and use_case in catalog:
        return use_case
    if tool_key:
        for r in rows:
            if tool_key in r["tool_keys"]:
                return r["use_case"]
    if request_type:
        for r in rows:
            if request_type in r["legacy_request_types"]:
                return r["use_case"]
    return "unknown"


def _python_request_types() -> List[str]:
    src = (AI_APP / "models" / "ai_token_usage.py").read_text(encoding="utf-8")
    body = src[src.index("class RequestType("):]
    body = body[:body.index("\nclass ", 1)]
    vals = re.findall(r'^\s+[A-Z_]+\s*=\s*"([a-z_0-9]+)"', body, re.M)
    assert len(vals) >= 25, vals
    return vals


def _java_request_types() -> List[str]:
    if not JAVA_REQUEST_TYPE.exists():
        return []
    return re.findall(r'[A-Z_]+\("([a-z_0-9]+)"\)', JAVA_REQUEST_TYPE.read_text(encoding="utf-8"))


def _code_tool_keys() -> Dict[str, str]:
    """tool_key -> request_type from the code defaults in services/tool_cost_estimator.py."""
    src = (AI_APP / "services" / "tool_cost_estimator.py").read_text(encoding="utf-8")
    found = dict(re.findall(r'^    "([a-z_0-9]+)":\s*\{[^}]*?"request_type":\s*"([a-z_0-9]+)"', src, re.M | re.S))
    assert len(found) >= 40, found
    return found


# ── (a) model use cases ────────────────────────────────────────────────────

def test_every_billed_model_use_case_has_a_catalog_row(catalog):
    by_model_key = {r["model_use_case"] for r in catalog.values() if r["model_use_case"]}
    missing = []
    for u in muc.USE_CASES:
        key = u.use_case
        if key in catalog or key in by_model_key or key in NOT_BILLED or key in SEEDED_LATER:
            continue
        target = COVERED_BY.get(key)
        if target is None:
            missing.append(key)
        else:
            assert target in catalog, f"COVERED_BY[{key!r}] -> {target!r} is not a catalog row"
    assert not missing, (
        f"model use cases with no ai_use_case_catalog row: {missing}. Seed a catalog row in a new "
        "migration (or list the key in COVERED_BY / NOT_BILLED with a reason)."
    )


def test_exemption_lists_are_not_stale(catalog):
    keys = set(muc.USE_CASE_CATALOG)
    assert set(COVERED_BY) <= keys, set(COVERED_BY) - keys
    assert set(NOT_BILLED) <= keys, set(NOT_BILLED) - keys
    # a key that now has its own row should leave the exemption lists
    assert not (set(COVERED_BY) | set(NOT_BILLED)) & set(catalog)


def test_catalog_model_use_case_refers_to_a_known_model_key(catalog):
    keys = set(muc.USE_CASE_CATALOG)
    bad = {r["use_case"]: r["model_use_case"] for r in catalog.values()
           if r["model_use_case"] and r["model_use_case"] not in keys}
    assert not bad, bad


# ── (b) request types and tool keys ───────────────────────────────────────

def test_every_request_type_maps_to_a_real_use_case(catalog):
    all_types = set(_python_request_types()) | set(_java_request_types()) | set(PROD_REQUEST_TYPES)
    unmapped = sorted(t for t in all_types if _resolve(catalog, request_type=t) == "unknown")
    assert not unmapped, f"request types that would be metered as 'unknown': {unmapped}"


def test_every_tool_key_maps_to_a_real_use_case(catalog):
    keys = (set(_code_tool_keys()) | set(PROD_TOOL_KEYS)) - SEEDED_LATER_TOOL_KEYS
    unmapped = sorted(k for k in keys if _resolve(catalog, tool_key=k) == "unknown")
    assert not unmapped, f"ai_tool_pricing tool keys with no catalog row: {unmapped}"


def test_each_request_type_and_tool_key_has_one_owner(catalog):
    seen_rt: Dict[str, str] = {}
    seen_tk: Dict[str, str] = {}
    for r in catalog.values():
        for rt in r["legacy_request_types"]:
            assert rt not in seen_rt, f"request_type {rt!r} in both {seen_rt[rt]} and {r['use_case']}"
            seen_rt[rt] = r["use_case"]
        for tk in r["tool_keys"]:
            assert tk not in seen_tk, f"tool_key {tk!r} in both {seen_tk[tk]} and {r['use_case']}"
            seen_tk[tk] = r["use_case"]


@pytest.mark.parametrize("kwargs,expected", [
    ({"tool_key": "html_document_image", "request_type": "image"}, "document_image"),
    ({"tool_key": "tutor_live_minute", "request_type": "conversation"}, "tutor_live"),
    ({"request_type": "conversation"}, "tutor_chat"),
    ({"request_type": "agent"}, "learner_assistant"),
    ({"request_type": "analytics"}, "learner_analytics"),
    ({"request_type": "ai_call_out"}, "ai_calling"),
    ({"request_type": "voice_call_in"}, "telephony"),
    ({"request_type": "chatbot"}, "chatbot_flow"),
    ({"tool_key": "kb_paper_questions", "request_type": "assessment"}, "kb_question_paper"),
    ({"use_case": "admin_agent", "request_type": "agent"}, "admin_agent"),
    ({"use_case": "not_a_use_case", "request_type": "content"}, "content"),
    ({"request_type": "no_such_type"}, "unknown"),
])
def test_resolution_examples(catalog, kwargs, expected):
    assert _resolve(catalog, **kwargs) == expected


# ── catalog row sanity ─────────────────────────────────────────────────────

def test_catalog_vocabularies(catalog):
    assert REQUIRED_USE_CASES <= set(catalog), REQUIRED_USE_CASES - set(catalog)
    for r in catalog.values():
        uc = r["use_case"]
        assert re.fullmatch(r"[a-z][a-z0-9_]{1,63}", uc), uc
        assert r["feature_group"] in FEATURE_GROUPS, (uc, r["feature_group"])
        assert r["default_surface"] in SURFACES, (uc, r["default_surface"])
        assert r["actor_kind"] in CATALOG_ACTOR_KINDS, (uc, r["actor_kind"])
        assert r["unit_kind"] in UNIT_KINDS, (uc, r["unit_kind"])
        assert r["label"] and len(r["label"]) <= 128, uc
        assert r["label_template"] is None or len(r["label_template"]) <= 255, uc
        assert isinstance(r["display_order"], int), uc
        assert all(isinstance(r[k], bool) for k in
                   ("plan_eligible", "limit_eligible", "reserve_on_authorize", "intentionally_separate")), uc
        tpl = r["label_template"] or ""
        assert tpl.count("{") == tpl.count("}"), (uc, tpl)
    assert catalog["unknown"]["feature_group"] == "platform"
    assert catalog["voice_bot_llm"]["intentionally_separate"] is True
    for uc in ("ai_calling", "telephony", "ai_video_clip", "avatar_video"):
        assert catalog[uc]["plan_eligible"] is False, uc
    for uc in ("lesson_video", "ai_video_clip", "avatar_video"):
        assert catalog[uc]["reserve_on_authorize"] is True, uc


# ── role map + aliases ─────────────────────────────────────────────────────

def _norm_role(r: str) -> str:
    # same rule as core/security.py jwt_institute_roles
    return str(r).strip().upper().replace("-", "_").replace(" ", "_")


def test_role_map_seed(sql):
    cols, rows, target = _insert_rows(sql, "ai_role_class_map")
    assert cols == ["role_name", "role_class", "precedence", "updated_by"]
    assert target == "role_name"
    m = {r[0]: (r[1], r[2]) for r in rows}
    assert len(m) == len(rows), "duplicate role_name"
    for name, (cls, prec) in m.items():
        assert name == _norm_role(name) and len(name) <= 64, name
        assert cls in MAP_ROLE_CLASSES, (name, cls)
        assert isinstance(prec, int), name
    expected = {
        "ADMIN": "ADMIN", "SCHOOL_ADMIN": "ADMIN", "SCHOOL_PRINCIPAL": "ADMIN",
        "TEACHER": "TEACHER", "EVALUATOR": "TEACHER", "CONTENT_CREATOR": "TEACHER",
        "ASSESSMENT_CREATOR": "TEACHER", "CUSTOM_CREATOR": "TEACHER", "MENTOR": "TEACHER",
        "COUNSELLOR": "STAFF", "CHANNEL_PARTNER": "STAFF", "VLE": "STAFF",
        "PARENT": "PARENT", "STUDENT": "LEARNER", "LEARNER": "LEARNER",
    }
    for name, cls in expected.items():
        assert m.get(name, (None,))[0] == cls, (name, m.get(name))
    # precedence order: ADMIN < TEACHER < STAFF < PARENT < LEARNER
    assert m["ADMIN"][1] < m["TEACHER"][1] < m["COUNSELLOR"][1] < m["PARENT"][1] < m["STUDENT"][1]
    # mixed-case prod spellings normalise onto seeded rows
    for raw in ("Admin", "CONTENT CREATOR", "Evaluator", "Co-ordinator"):
        assert _norm_role(raw) in m, raw


def test_model_alias_seed(sql):
    cols, rows, target = _insert_rows(sql, "ai_model_alias")
    assert cols == ["alias", "model_id", "note"]
    assert target == "alias"
    aliases = {r[0]: r[1] for r in rows}
    assert aliases.get("glm-5.3-flash") == "z-ai/glm-5.3-flash"
    for alias, model_id in aliases.items():
        assert alias != model_id and "/" in model_id, (alias, model_id)
        assert alias not in ("image", "system"), "ambiguous labels must stay unmapped"


# ── migration structure ───────────────────────────────────────────────────

def test_migration_structure(sql):
    masked = _mask_strings(sql)
    assert masked.count("(") == masked.count(")"), "unbalanced parentheses"
    assert "${" not in sql, "Flyway would treat ${...} as a placeholder"
    assert not re.search(r"\bCHECK\s*\(", masked, re.I), "no CHECK constraints on the new columns"
    for stmt in re.findall(r"CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b[^;]*", masked, re.I):
        assert re.match(r"CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS", stmt, re.I), stmt[:80]
    for alter in re.findall(r"ALTER\s+TABLE[^;]*", masked, re.I):
        assert alter.split()[2] in ("credit_transactions", "ai_token_usage"), alter[:60]
        adds = re.findall(r"ADD\s+(?:COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?\w+", alter, re.I)
        assert adds and all(a for a in adds), f"every ADD must be IF NOT EXISTS: {alter[:80]}"
        assert not re.search(r"\b(DROP|ALTER\s+COLUMN|RENAME|NOT\s+NULL|DEFAULT)\b", alter, re.I), alter[:80]
    for table in ("ai_use_case_catalog", "ai_role_class_map", "ai_usage_event", "ai_model_alias"):
        assert re.search(rf"CREATE TABLE IF NOT EXISTS {table}\s*\(", masked), table
    # ON CONFLICT targets are the primary keys
    for table, pk in (("ai_use_case_catalog", "use_case"), ("ai_role_class_map", "role_name"),
                      ("ai_model_alias", "alias")):
        body = re.search(rf"CREATE TABLE IF NOT EXISTS {table}\s*\((.*?)\n\);", masked, re.S).group(1)
        assert re.search(rf"^\s*{pk}\s+VARCHAR\(\d+\)\s+PRIMARY KEY", body, re.M), (table, pk)
    ev = re.search(r"CREATE TABLE IF NOT EXISTS ai_usage_event\s*\((.*?)\n\);", masked, re.S).group(1)
    for col, typ in (("gateway_key_id", r"VARCHAR\(64\)"), ("shadow_billing_mode", r"VARCHAR\(20\)"),
                     ("billing_mode", r"VARCHAR\(20\) NOT NULL"), ("limit_decision", r"VARCHAR\(16\) NOT NULL DEFAULT ''"),
                     ("subscription_id", "UUID"), ("plan_id", "UUID"), ("plan_item_id", "UUID"),
                     ("reservation_id", "UUID"), ("ledger_tx_id", "UUID"), ("actor_user_id", r"VARCHAR\(255\)")):
        assert re.search(rf"^\s*{col}\s+{typ}", ev, re.M), col
    tu = re.search(r"ALTER TABLE ai_token_usage(.*?);", masked, re.S).group(1)
    for col in ("usage_event_id", "router", "gateway_key_id", "cached_read_tokens", "cache_write_tokens",
                "reasoning_tokens"):
        assert re.search(rf"IF NOT EXISTS {col}\b", tu), col
    assert re.search(r"IF NOT EXISTS gateway_key_id\s+VARCHAR\(64\)", tu)
    ct = re.search(r"ALTER TABLE credit_transactions(.*?);", masked, re.S).group(1)
    assert re.search(r"IF NOT EXISTS usage_event_id\s+UUID", ct)
    assert re.search(r"IF NOT EXISTS use_case\s+VARCHAR\(64\)", ct)
