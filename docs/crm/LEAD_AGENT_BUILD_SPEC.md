# Lead Agent — build spec (v1)

Companion to `LEAD_AGENT_PLAN.md` (the why). This file is the contract every part is built against:
tables, APIs, the fetch-task protocol and who owns which folder. Built 2026-10-25.

## 0. Ownership

| Part | Folder | Notes |
|---|---|---|
| Research library (ported engine) | `ai_service/app/services/lead_agent/engine/` + `ai_service/tests/lead_agent/engine/` | Pure functions: no DB, no network, no LLM client. LLM/search/fetch are injected callables. |
| Orchestration + API | `ai_service/app/services/lead_agent/` (everything except `engine/`), `ai_service/app/routers/lead_agent.py`, `ai_service/tests/lead_agent/` (except `engine/`) | |
| admin_core | `admin_core_service/.../features/audience/leadagent/` (new package) + `db/migration/V612__lead_agent.sql` | Flyway owns ALL lead_agent tables (ai_service only reads/writes them). |
| Admin UI | `frontend-admin-dashboard/src/routes/audience-manager/lead-agent/` | |
| Chrome extension | `lead-agent-extension/` (repo root) | Plain JS, Manifest V3, no build step. |

Never commit API keys. Keys come from env: `PARALLEL_API_KEY`, `SERPER_API_KEYS` (existing setting, comma-separated).

## 1. Flow

```
scheduler tick (one replica, advisory lock)
  for each ACTIVE agent (institute allow-listed, platform kill switch on):
    plan (LLM, cached in lead_agent.plan_json; rebuilt when the brief changes or after 7 days)
    if pipeline backlog < 3 × remaining quota today: discover
       search (Serper web + maps; Parallel for signals) → engine discovery filter (LLM picks
       organisations' own sites) → upsert lead_org by registered domain → skip suppressed / known
       → lead_candidate DISCOVERED
candidate DISCOVERED → pages cached < 14 days? → READY  else  fetch tasks (home page) → FETCHING
fetch result (home) → engine picks ≤3 more pages (contact / team / careers / admissions) → more tasks
all page tasks done (or 10 min deadline) → READY
research worker claims READY (SKIP LOCKED) → RESEARCHING:
    fingerprint + contacts (no AI) → free rejects (dead site, no contact, suppressed, excluded kind)
    → LLM extraction → quote check → engine.build_lead → score → if ≥ review bar: decision-maker
    lookup (Parallel search + LLM) → re-rate contacts → score → gate → SCORED with decision
    AUTO → APPROVED (waits for window + quota)   REVIEW → REVIEW   REJECT → REJECTED
delivery (inside the agent's window, while delivered_today < daily_quota):
    APPROVED oldest-best first → admin_core existing-contacts check → bulk-intake → DELIVERED
    → charge credits (idempotency key lead_agent:{candidate_id}) → lead_agent_day counters
```

## 2. Tables (V612, admin_core Flyway)

IDs are `VARCHAR(36)` default `gen_random_uuid()::text`. All timestamps `TIMESTAMPTZ`.

```sql
lead_agent (
  id, institute_id VARCHAR(255) NOT NULL, audience_id VARCHAR(255) NOT NULL, name VARCHAR(200) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PAUSED'  -- ACTIVE | PAUSED | ARCHIVED
  brief_json JSONB NOT NULL DEFAULT '{}',        -- §2.1
  markets_json JSONB NOT NULL DEFAULT '[]',      -- [{country, state?, city?}] 1..5
  daily_quota INT NOT NULL DEFAULT 10,           -- 1..200 delivered leads / day
  monthly_credit_cap NUMERIC(12,2) NULL,         -- NULL = no cap beyond the wallet
  mode VARCHAR(12) NOT NULL DEFAULT 'AUTO',      -- LOCAL | REMOTE | AUTO
  gate_json JSONB NOT NULL DEFAULT '{"auto_score":70,"review_score":45,"min_contact":"likely","require_intent":false}',
  window_json JSONB NOT NULL DEFAULT '{"tz":"Asia/Kolkata","start":"09:30","end":"19:00","days":[1,2,3,4,5,6]}', -- ISO weekday 1=Mon
  plan_json JSONB NULL, plan_built_at TIMESTAMPTZ NULL, brief_hash VARCHAR(64) NULL,
  cursor_json JSONB NOT NULL DEFAULT '{}',       -- which queries/pages were searched already
  last_tick_at, last_error TEXT, created_by VARCHAR(255), created_at, updated_at
)  UNIQUE (audience_id) WHERE status <> 'ARCHIVED';  INDEX (institute_id), (status)

lead_org (
  id, domain VARCHAR(255) NOT NULL UNIQUE, name VARCHAR(300), website VARCHAR(1000),
  country VARCHAR(80), state VARCHAR(120), city VARCHAR(120),
  platforms_json JSONB NOT NULL DEFAULT '[]', size_json JSONB NOT NULL DEFAULT '{}',
  social_json JSONB NOT NULL DEFAULT '{}', robots_json JSONB NULL,
  pages_fetched_at TIMESTAMPTZ NULL, created_at, updated_at
)   -- shared across institutes: public facts only

lead_org_page (
  id, org_id VARCHAR(36) NOT NULL REFERENCES lead_org(id) ON DELETE CASCADE,
  url VARCHAR(1000) NOT NULL, page_type VARCHAR(30) NOT NULL,  -- home | contact | team | careers | admissions | other
  access VARCHAR(20) NOT NULL,          -- ok | blocked | error | not_html | robots_disallowed | unsafe_url
  status_code INT, final_url VARCHAR(1000), text TEXT, links_json JSONB NOT NULL DEFAULT '[]',
  has_form BOOLEAN NOT NULL DEFAULT FALSE, platform_hints_json JSONB NOT NULL DEFAULT '[]',
  fetched_by VARCHAR(12) NOT NULL,      -- SERVER | EXTENSION
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days'
)  UNIQUE (org_id, url);  INDEX (expires_at)

lead_candidate (
  id, agent_id VARCHAR(36) NOT NULL REFERENCES lead_agent(id) ON DELETE CASCADE,
  institute_id VARCHAR(255) NOT NULL, org_id VARCHAR(36) NOT NULL REFERENCES lead_org(id),
  source VARCHAR(40) NOT NULL,          -- organisation_search | maps | hiring | keyword | software_request | new_centre
  discovery_json JSONB NOT NULL DEFAULT '{}',   -- {query, url, title, snippet, maps:{phone, rating, reviews, address}}
  status VARCHAR(16) NOT NULL DEFAULT 'DISCOVERED',
     -- DISCOVERED | FETCHING | READY | RESEARCHING | REVIEW | APPROVED | DELIVERED | REJECTED | SKIPPED | FAILED
  decision VARCHAR(8) NULL,             -- AUTO | REVIEW | REJECT
  score INT NULL, score_json JSONB NULL, lead_json JSONB NULL, stage VARCHAR(20) NULL,
  reject_reason VARCHAR(300) NULL, reviewed_by VARCHAR(255) NULL, reviewed_at TIMESTAMPTZ NULL,
  delivered_response_id VARCHAR(255) NULL, delivered_at TIMESTAMPTZ NULL, delivery_note VARCHAR(300) NULL,
  credits_charged NUMERIC(12,2) NOT NULL DEFAULT 0, cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0, last_error TEXT NULL, fetch_deadline TIMESTAMPTZ NULL,
  claimed_at TIMESTAMPTZ NULL, not_before TIMESTAMPTZ NOT NULL DEFAULT now(), created_at, updated_at
)  UNIQUE (agent_id, org_id);  INDEX (agent_id, status), (status, not_before), (institute_id, status)

lead_fetch_task (
  id, institute_id VARCHAR(255) NOT NULL, agent_id VARCHAR(36) NOT NULL REFERENCES lead_agent(id) ON DELETE CASCADE,
  candidate_id VARCHAR(36) NOT NULL REFERENCES lead_candidate(id) ON DELETE CASCADE,
  org_id VARCHAR(36) NOT NULL, url VARCHAR(1000) NOT NULL, page_type VARCHAR(30) NOT NULL,
  mode VARCHAR(12) NOT NULL,            -- LOCAL | REMOTE | AUTO (AUTO: either may take it; REMOTE takes it after 5 min unclaimed)
  status VARCHAR(12) NOT NULL DEFAULT 'PENDING',  -- PENDING | CLAIMED | DONE | FAILED
  lease_owner VARCHAR(64) NULL, lease_until TIMESTAMPTZ NULL, attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL, not_before TIMESTAMPTZ NOT NULL DEFAULT now(), created_at, updated_at
)  INDEX (status, mode, not_before), (candidate_id)

lead_agent_worker (
  id, institute_id VARCHAR(255) NOT NULL, user_id VARCHAR(255) NOT NULL, kind VARCHAR(12) NOT NULL, -- EXTENSION
  label VARCHAR(120), token_hash VARCHAR(64) NOT NULL UNIQUE,  -- sha256 hex of the extension token
  version VARCHAR(30), last_seen_at TIMESTAMPTZ NULL, revoked_at TIMESTAMPTZ NULL,
  pages_today INT NOT NULL DEFAULT 0, pages_day DATE NULL, created_at, updated_at
)  INDEX (institute_id)

lead_suppression (
  id, institute_id VARCHAR(255) NOT NULL, kind VARCHAR(8) NOT NULL,   -- DOMAIN | PHONE | EMAIL
  value VARCHAR(320) NOT NULL,          -- domain lower-case; phone = last 10 digits; email lower-case
  reason VARCHAR(40) NOT NULL,          -- CUSTOMER | COMPETITOR | OPTED_OUT | MANUAL | NOT_INTERESTED
  note VARCHAR(300), created_by VARCHAR(255), created_at
)  UNIQUE (institute_id, kind, value)

lead_agent_day (
  agent_id VARCHAR(36) NOT NULL REFERENCES lead_agent(id) ON DELETE CASCADE, day DATE NOT NULL,
  discovered INT NOT NULL DEFAULT 0, researched INT NOT NULL DEFAULT 0, delivered INT NOT NULL DEFAULT 0,
  review INT NOT NULL DEFAULT 0, rejected INT NOT NULL DEFAULT 0, searches INT NOT NULL DEFAULT 0,
  pages INT NOT NULL DEFAULT 0, cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0, credits NUMERIC(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, day)
)  -- day is in the agent's window tz

lead_search_cache (
  key VARCHAR(64) PRIMARY KEY,          -- sha256(provider|kind|query|location|page)
  provider VARCHAR(12) NOT NULL, kind VARCHAR(12) NOT NULL, query TEXT NOT NULL,
  results_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)  INDEX (created_at)
```

Pricing seed (same migration), mirrored in `ai_service/app/services/tool_cost_estimator.py`:
`ai_tool_pricing` rows `lead_agent_lead_local` and `lead_agent_lead_remote`, request_type reusing an existing
value (no CHECK change), `unit_field` leads, fixed price, **provisional** 2 and 4 credits per delivered lead
(open question for the owner; editable in the table). Plus an `ai_use_case_catalog` row `lead_agent`.

### 2.1 `brief_json`

```json
{
  "products": [],                             // LEGACY Vacademy keys (complete_vacademy | crm | lms | ai_calling); new briefs send []
  "offer": {                                  // what the institute sells (required unless products is set), see §5a
    "name": "Rooftop solar installation", "seller": "SunGrid", "website": null,
    "fit_signals": [{"key": "fit_1", "label": "Owns a warehouse", "description": "…", "weight": 3}],  // ≤8, keys by position
    "competitors": [{"name": "Tata Power Solar", "domain": "tatapowersolar.com"}],                   // ≤10
    "competitor_kinds": ["crm"],               // lms | crm | whatsapp | chat | payments | website
    "education": false, "discovery_question": "How do you handle this today?"
  },
  "description": "What we sell and to whom",
  "industries": [{"name": "Online coaching institutes", "search_term": "online coaching institute"}],  // 1..6
  "buyer_roles": ["founder", "director"],
  "hiring_roles": ["telecaller", "admission counsellor"],
  "keywords": ["looking for LMS for coaching"],
  "must_have": ["offers online courses"],     // free text, given to the extraction prompt as fit criteria
  "deal_breakers": ["schools", "government institutions"],
  "exclude": ["Schools & playschools"],       // engine exclusion kinds
  "sources": ["organisation_search", "maps", "hiring", "keyword", "software_request", "new_centre"],
  "find_contacts": true
}
```

## 3. Engine library interface (`app/services/lead_agent/engine/`)

Ported from `himangkalal/vacademy-lead-engine` `worker/lead_worker/` keeping module names and function
signatures (`research/contacts.py`, `research/contact_search.py`, `research/evidence.py`, `research/lead.py`,
`research/social.py`, `research/catalogue.py`, `research/extract.py`, `research/pages.py`, `research/url_guard.py`,
`discovery/domains.py`, `discovery/exclusions.py`, `discovery/sources.py`, the prompt builders and pure helpers of
`discovery/pipeline.py`, `jobs/planning.py`, `jobs/profiles.py`, and `schemas.py`). Anything that touched the DB,
the browser or OpenRouter becomes a parameter (`search(query) -> list[SearchResult]`,
`ask(system, user, output_model) -> model`).

New in v1 (`engine/scoring.py`, `engine/fingerprint.py`, `engine/pagefetch.py`):

```python
# fingerprint.py — no AI
def detect_platforms(pages: list[dict]) -> list[dict]
    # pages: [{"url","html"?, "text","links":[(href,text)]}]
    # -> [{"key":"appx","name":"Appx","kind":"lms|crm|whatsapp|website|payments","competitor":True,
    #      "evidence":"live.example.in → appx assets","url":...}]
def size_signals(pages: list[dict], social: dict) -> dict
    # -> {"youtube_subscribers":int|None,"app_downloads":int|None,"students":int|None,"branches":int|None,
    #     "tier":"micro|small|mid|large|enterprise"|None,"evidence":[{"value","quote","url"}]}

# pagefetch.py — turning raw HTML (from the server fetcher OR the extension) into a page record
def parse_page(url: str, final_url: str, html: str, status_code: int | None) -> dict
    # -> {"url","final_url","access","text","links":[(href,text)],"has_form":bool,"platform_hints":[...]}
def choose_pages(home: dict, max_pages: int = 3) -> list[tuple[str, str]]   # [(url, page_type)]

# scoring.py
def score_lead(lead: dict, brief: dict, platforms: list[dict], size: dict) -> dict
    # -> {"score":0-100,"fit":0-100,"intent":0-100,"reach":0-100,"risk":0-100,
    #     "products":[{"key","name","score","why"}],"has_intent":bool,
    #     "flags":["competitor_platform:appx","enterprise","no_contact",...],"reasons":["..."]}
def gate(scored: dict, lead: dict, gate_cfg: dict) -> tuple[str, list[str]]   # ("AUTO"|"REVIEW"|"REJECT", reasons)
```

Fixes carried in the port (from the 2026-10-25 review): a number the site labels as a desk line or shows on
most pages is never upgraded to `direct` by a search hit (WiNNERS regression test); negative scoring;
"qualified" needs an intent signal or a strong fit + reach for AUTO; Complete Vacademy gets real weights.

## 4. ai_service API (`/ai-service/lead-agent/v1`)

Admin endpoints: `Authorization: Bearer <JWT>` + `clientId: <instituteId>` → `get_pinned_principal`,
institute ADMIN role required for writes. All responses JSON, snake_case.

| Method + path | Body / query | Returns |
|---|---|---|
| `GET /agents` | | `[Agent]` (+ `today: {delivered, review, rejected}`, `workers_online`) |
| `POST /agents` | `{audience_id, name, brief, markets, daily_quota, monthly_credit_cap?, mode, gate?, window?}` | `Agent` (status PAUSED) |
| `GET /agents/{id}` | | `Agent` |
| `PUT /agents/{id}` | same fields as create (partial) | `Agent` |
| `POST /agents/{id}/status` | `{status: ACTIVE\|PAUSED\|ARCHIVED}` | `Agent` |
| `POST /agents/{id}/run-now` | | `{queued: true}` (a tick for this agent now; delivery still respects the window) |
| `GET /agents/{id}/candidates` | `?status=REVIEW&page=0&size=25` | `{items:[CandidateSummary], total}` |
| `GET /candidates/{id}` | | `Candidate` (with `lead_json`, `score_json`, evidence) |
| `POST /candidates/{id}/decision` | `{action: APPROVE\|REJECT, reason?}` | `Candidate` |
| `POST /candidates/bulk-decision` | `{ids:[], action, reason?}` | `{updated: n}` |
| `GET /agents/{id}/stats` | `?days=14` | `[{day, discovered, researched, delivered, review, rejected, searches, pages, cost_usd, credits}]` |
| `POST /brief/suggest` | `{name?, seller?, description?, url?}` (legacy `products`) | `{summary, keywords[], industries:[{name, search_term, fit, why, products[], buyer_roles[], hiring_phrases[], need_phrases[]}], offer:{name, fit_signals[], competitors[], competitor_kinds[], education, discovery_question}, note?}` (sync, ≤60 s) |
| `GET /suppressions` · `POST /suppressions` · `DELETE /suppressions/{id}` | `{kind, value, reason, note?}` | |
| `GET /workers` | | `[{id, label, user_id, last_seen_at, online, version, pages_today}]` |
| `POST /workers/pair` | `{label?}` | `{token, worker_id}` — token shown once (32 random bytes, url-safe) |
| `DELETE /workers/{id}` | | revoke |

`Agent` = the `lead_agent` row (JSON columns as objects) + `audience_name`.
`CandidateSummary` = `{id, status, decision, score, stage, org:{name, domain, website, city}, top_reason, flags,
best_contact:{kind, value, quality, label}, created_at, delivered_at}`.

### 4.1 Extension endpoints (header `X-Lead-Agent-Token: <token>`)

| Method + path | Body | Returns |
|---|---|---|
| `POST /ext/hello` | `{version, label?}` | `{worker_id, institute_id, institute_name, user_name, poll_interval_s: 30, max_parallel: 2, paused: bool}` |
| `POST /ext/claim` | `{max: 1..4}` | `{tasks:[{id, url, page_type, timeout_ms: 20000, render: "fetch"\|"tab"}], lease_s: 120}` |
| `POST /ext/result` | `{task_id, ok, status_code?, final_url?, content_type?, html?, error?}` | `{accepted: true}` |

`html` ≤ 1.5 MB (truncate client-side). The server parses it with `engine.pagefetch.parse_page`, exactly as it
parses pages it fetched itself. A token whose worker is revoked gets 401. Claims touch `last_seen_at`; a worker
is online when `last_seen_at` < 90 s old. Per worker: max 300 pages a day, max 1 task per site at a time.

## 5. admin_core internal endpoints (HMAC internal auth, `internal_auth_headers()` from ai_service)

`POST /admin-core-service/internal/audience/v1/lead-agent/existing-contacts`
`{institute_id, phones: ["9876543210"…] (last 10 digits), emails: [...]}` →
`{phones: [...found], emails: [...found]}` — institute-wide, any lead list, not deleted.

`POST /admin-core-service/internal/audience/v1/lead-agent/bulk-intake`
```json
{ "institute_id": "...", "audience_id": "...",
  "rows": [{ "external_id": "<candidate id>", "full_name": "Aditya Patel", "email": null, "mobile": "+919009335533",
             "custom_fields": {"la_org_name": "WiNNERS Institute", "la_website": "https://…", "la_city": "Indore",
                               "la_role": "Founder & Director", "la_contact_quality": "Desk mobile: ask for Aditya Patel",
                               "la_other_contacts": "…", "la_score": "82", "la_why": "…", "la_opening": "…",
                               "la_platforms": "Appx (LMS)", "la_source_url": "https://…"},
             "note": "Evidence:\n- Admissions open: \"…\" (https://…)" }] }
```
→ `{results: [{external_id, status: CREATED|DUPLICATE|FAILED, response_id?, message?}]}`.
Creates the `la_*` custom fields on the audience once (labels: Organisation, Website, City, Role, How to reach,
Other contacts, Lead score, Why this lead, Opening question, Platforms they use, Source page). Every row goes
through `AudienceService.submitLead` with `source_type = "LEAD_AGENT"`, `source_id = <domain>`, so the list's
automations run as for any lead. A row whose phone (last 10) or email already exists institute-wide is
`DUPLICATE` and is not submitted. The note is written to the lead's timeline. ≤ 50 rows per call.

## 5a. As built (differences from the first draft, 2026-10-26)

- Pricing is a **flat** charge per delivered lead (`unit_field 'flat'`, request_type `agent`, 2 credits local /
  4 remote, fixed price): the `unit_field` CHECK on `ai_tool_pricing` cannot be altered on prod.
- `lead_org_page.access` also allows `js_shell`: a page whose HTML is an empty JavaScript shell. The server hands
  such a page to an online extension of the institute (tab render) unless the agent is REMOTE; otherwise it is
  stored unreadable, and its links are still used to choose the contact/team pages.
- `choose_pages` returns up to 3 slot pages **plus** one `platform` page (a course-portal sub-domain such as
  live.<site>): competitor markers (Appx, Classplus…) usually live there, so it must not be cut.
- API responses expose JSON columns without the `_json` suffix (`brief`, `markets`, `gate`, `window`);
  `GET /agents` items add `review_waiting`; `CandidateSummary` adds `score_parts {fit, intent, reach, risk}`;
  flags are `"kind:value"` strings.
- Gate: a lead that falls below the review bar **only** because of the competitor / enterprise penalty goes to
  REVIEW, not REJECT (`score_json.base_score` is the score before the penalty).
- LLM calls use reasoning effort `low` and output caps of 3,000–6,000 tokens: GLM 5.3 Flash cannot turn reasoning
  off and its reasoning counts as output (a 3,000 cap truncated signal batches).
- Workflows receive `sourceType` / `sourceId` in the trigger context, so a condition can branch on
  `#ctx['sourceType'] == 'LEAD_AGENT'`.
- **Offer-agnostic (2026-10-26).** What is sold is `brief.offer`, not Vacademy's product keys, resolved by
  `engine/offer.py`: research looks for the universal signals (explicit request, hiring for the run's roles,
  keyword need, new location, branches, size) plus the offer's own `fit_1..fit_8` (weight 1/2/3 = 5/10/15 fit
  points); a platform counts as a competitor only if its kind is in `competitor_kinds` or it is a named competitor
  (named competitors outside the vendor library are detected by their domain / "powered by"); the coaching-chain
  and home-tutor checks run only when `offer.education`. Briefs with only `products` keep the education
  catalogue exactly as before, and `GET` derives an editable `offer` for them. An organisation that itself
  sells the offer (`AccountExtraction.sells_the_offer`) is a hard REJECT (`sells_the_offer` flag): with a
  general offer, sellers of the same thing look like perfect fits. Plan searches are told to look for buyers,
  never for sellers.
- LLM replies: one cut off at the token cap is asked again fresh (not "repaired" from the run-on text), and a
  reply that is valid JSON but slightly off the schema (an extra key, a null text, one list item with an unknown
  value) keeps what fits (`llm._salvage`).
- The extension pairs from a page only on `dash.vacademy.io` and localhost; elsewhere the code is pasted.
  `VACADEMY_LEAD_AGENT_PING` → `VACADEMY_LEAD_AGENT_PRESENT {version}` tells the dashboard it is installed.

## 6. Feature flags (platform settings, JSON strings — `json.dumps`!)

`lead_agent.enabled` ("true"/"false", default false = nothing runs), `lead_agent.institutes` (JSON list of
allowed institute ids; empty = none), `lead_agent.model` (default `z-ai/glm-5.3-flash`, fallback chain from the
router), `lead_agent.max_concurrency` (research workers per replica, default 3).
