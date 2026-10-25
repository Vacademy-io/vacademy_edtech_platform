# Lead Agent (ai_service)

Contract: `docs/crm/LEAD_AGENT_BUILD_SPEC.md` (why: `LEAD_AGENT_PLAN.md`). Tables are owned by
admin_core Flyway `V612__lead_agent.sql`; this package only reads and writes them (raw SQL, `store.py`).

## What runs where

| Piece | File | Runs |
|---|---|---|
| Admin + extension API | `app/routers/lead_agent.py` (`/ai-service/lead-agent/v1`) | every pod |
| Agent tick (plan, discover, deliver) | `scheduler._tick_loop` | every pod; agents leased one at a time (`tick_owner` / `tick_until`, SKIP LOCKED, renewed between steps), so an agent is never ticked twice at once |
| Research pool | `scheduler._research_loop` -> `research.py` | every pod, `lead_agent.max_concurrency` at once (READY claimed with SKIP LOCKED, 15-min lease, 3 attempts -> FAILED) |
| Server page fetcher | `scheduler._fetch_loop` -> `fetcher.py` | every pod; REMOTE tasks + AUTO tasks no extension took within 5 min; one task per site at a time |
| Chrome extension | `lead-agent-extension/` (repo root) | the institute's browser: LOCAL + AUTO tasks via `/ext/*` |
| Engine (pure research rules) | `engine/` | called through `engine_api.py` only |

Flow: plan (`planner.py`, one LLM call, cached weekly in `plan_json`) -> discovery round (`discovery.py`:
Serper web + Maps, Parallel for buying signals, LLM picks own-site results; dedup by registered domain;
suppressed domains skipped) -> home-page fetch task in the agent's mode -> `choose_pages` adds <= 3
pages (+ a course-portal "platform" page) -> READY -> research (free rejects first; LLM extraction;
build_lead; fingerprint + size; score; decision-maker lookup only at or above the review bar; gate)
-> APPROVED / REVIEW / REJECTED -> delivery inside the window while today's delivered < quota
(today's slots reserved atomically in `lead_agent_day.delivered`; admin_core existing-contacts + bulk-intake, <= 10 rows per call, a failed call retried idempotently on `external_id`, 5 attempts then FAILED) -> one charge per delivered lead (`charged_at` marks it settled).

Page cache: pages our server read are shared by every institute (`fetched_institute_id = ''`); pages an
institute's extension read are visible to that institute only.

## Flags (platform settings; JSON values are STRINGS)

| Key | Default | Meaning |
|---|---|---|
| `lead_agent.enabled` | `false` | Kill switch. Off = no loop does any DB work, every admin endpoint is 403 `not_available`, extensions are told `paused`. |
| `lead_agent.institutes` | `"[]"` | JSON string list of institute ids (or `["*"]`). Empty = nobody. |
| `lead_agent.model` | `z-ai/glm-5.3-flash` | First model; the `lead_agent` use-case chain follows it. |
| `lead_agent.max_concurrency` | `3` | Research workers per pod (1..10). |

The specs are registered by `flags.py` (imported by the router at app start), so they show on the
super-admin settings page.

### Enable for one institute safely

```python
import json
from app.services.platform_settings_service import set_platform_setting
set_platform_setting(db, "lead_agent.institutes", json.dumps(["<institute-id>"]), "<you>")  # a STRING
set_platform_setting(db, "lead_agent.enabled", "true", "<you>")
```

A Python list would be `str()`-ed (`"['id']"`, not JSON) and read as EMPTY: nothing runs. Read the value
back and check it parses before telling anyone it is on. Then, in the dashboard: create the agent on a
test lead list (it starts PAUSED), check the brief, pair an extension (or use REMOTE), set a small
quota (e.g. 3) and a monthly credit cap, ACTIVATE. Watch `GET /agents/{id}/stats` and the review queue.

Kill switch: `lead_agent.enabled = "false"` (30 s cache). PAUSE one agent with `POST /agents/{id}/status`.

## Keys

Environment only, never in files or logs: `SERPER_API_KEYS` (comma-separated, rotated; the existing
setting), `PARALLEL_API_KEY` (`settings.parallel_api_key`). The LLM goes through the platform router
(Isoquant / OpenRouter keys as for every feature).

On prod, `SERPER_API_KEYS` comes from the GitHub secret set by the deploy workflow, and `PARALLEL_API_KEY`
lives in the cluster's shared `vacademy-secrets` (envFrom; added 2026-10-26): the repository is at GitHub's
limit of 100 Actions secrets, so no new one can be added there. Without it, Parallel searches fall back to Serper.

## Costs and credits

* Our cost: Serper ~ $0.001 per credit (web 1, maps 3), Parallel "fast" $0.001 per search, GLM Flash
  ~ $0.0005-0.001 per researched organisation. Tracked per candidate (`lead_candidate.cost_usd`, LLM) and
  per day (`lead_agent_day.cost_usd`, LLM + search). Searches are cached 7 days (`lead_search_cache`).
  Dry run 2026-10-26 (8 Indore candidates, plan + discovery + fetch + research): about $0.016 total.
* The institute pays per DELIVERED lead only: `lead_agent_lead_local` (2 credits, any page read by its
  extension) / `lead_agent_lead_remote` (4 credits); provisional, edit the `ai_tool_pricing` rows.
  Idempotency key `lead_agent:{candidate_id}` (a UUID, unique ledger-wide); credits read back into
  `credits_charged`. LLM calls are recorded record-only (`usage_record_only`, behind
  `billing.record_unbilled_usage`), never charged.
* Discovery is skipped when the wallet cannot cover the rest of today's quota at the agent's price, or
  the monthly cap is reached; delivery stops at the cap.

## Retention

Pages expire after 30 days (`lead_org_page.expires_at`); the scheduler deletes expired pages and search
cache rows older than 7 days once a day per pod.

## Tests and scripts

```
cd ai_service
AI_LIMITS_PGDATA=/tmp/la_pgdata python -m pytest tests/lead_agent -q   # pgserver Postgres + real V612
python scripts/lead_agent_smoke.py --query "JEE coaching institute" --city Indore --env-file <env>
python scripts/lead_agent_dry_run.py --env-file <env> --max 8      # real plan->research, no delivery
```
