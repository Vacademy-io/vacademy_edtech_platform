# CRM Documentation Index

Onboarding doc set for the Vacademy CRM cluster (admin_core_service + frontend-admin-dashboard, with identity/teams in auth_service). Start here.

> All docs last reviewed 2026-06-10 against `main`.

## The doc set

| Doc | Covers |
|---|---|
| [CAMPAIGNS_AND_AUDIENCE_MANAGER.md](CAMPAIGNS_AND_AUDIENCE_MANAGER.md) | Campaigns (audiences): CRUD, custom-field form builder, share links / embed / API integration, Meta & Google & Zoho/Google-Forms/MS-Forms webhook connectors, campaign-users page, workflow linking |
| [LEADS_MANAGEMENT.md](LEADS_MANAGEMENT.md) | The lead lifecycle backend: every intake path, dedup, scoring & tiers, pipeline statuses + history, TAT/SLA scheduler, follow-up tasks, `user_lead_profile` aggregate, the `/v1/audience/leads` listing engine, reports endpoints |
| [LEAD_ASSIGNMENT_AND_COUNSELOR_POOLS.md](LEAD_ASSIGNMENT_AND_COUNSELOR_POOLS.md) | How leads get an owner: counselor pools, MANUAL / ROUND_ROBIN / TIME_BASED routing, rotation cursor, backups, shifts, manual assignment, pool-management UI |
| [RECENT_LEADS_AND_FOLLOWUPS.md](RECENT_LEADS_AND_FOLLOWUPS.md) | The counsellor-facing frontend: Recent Leads inbox, shared LeadTable + side-view + dialogs, Follow-ups list/calendar, Lead Reports page, query-key map |
| [LEADS_SETTINGS.md](LEADS_SETTINGS.md) | Everything configurable: Lead Settings tab, status manager, TAT/SLA config, full `LEAD_SETTING` JSON shape, rating strategy, display-settings gating, known config gaps |
| [CRM_WORKBENCH_AND_SALES_DASHBOARD.md](CRM_WORKBENCH_AND_SALES_DASHBOARD.md) | Manager surfaces: counsellor workbench (`/counsellors`), sales dashboard, counsellor ratings, the reassign engine, org-team hierarchy & RBAC, the data-storage map, known issues |
| [EXOTEL_CALL_INTEGRATION.md](EXOTEL_CALL_INTEGRATION.md) | Telephony: click-to-call from lead rows, provider-agnostic SPI (Exotel first), SSE live status, recording capture into the timeline |
| [AI_CALLING_SYSTEM.md](AI_CALLING_SYSTEM.md) | **The AI calling reference (2026-08-11).** Agents + persona assembly, the STT/LLM/TTS stack (five TTS engines, per-engine pricing), the Pipecat real-time pipeline and turn-taking, end-of-call analysis → disposition → lead action, credits & metering, the per-call diagnostics blob, where the logs live, and a runbook |
| [AI_CALL_QUEUE.md](AI_CALL_QUEUE.md) | **The AI call queue (2026-08-27).** The durable queue in front of every AI dial and the single drainer that places them — how fleet capacity is decided (hardware vs the ops limit), how strict FIFO plus a per-lane cap stops one institute starving another, the guards re-evaluated at dial time, the manual fast path, the institute and super-admin APIs, and a runbook |
| [TTS_SPEECH_CACHE.md](TTS_SPEECH_CACHE.md) | **TTS speech cache (2026-08-22).** Replaying audio already paid for on an exact sentence match — the key, the six gates that decide what may be cached, why live audio is never recorded, the pipecat audio-ordering hazard, per-agent rollout via `ai_agent.speech_cache_mode`, and where to read the savings |
| [TTS_CACHE_API.md](TTS_CACHE_API.md) | **Speech-cache analytics API (2026-08-25).** The six super-admin endpoints behind the cache tab — curl, response shapes, and the two traps: reads are a 2-minute mirror rather than live, and a flush is queued rather than immediate |
| [AAVTAAR_AI_CALLING.md](AAVTAAR_AI_CALLING.md) | **DRAFT** — Aavtaar.ai AI voice-agent calling (Plivo-backed): outbound AI-calling workflow with retrial + counsellor assignment driven by webhook lead-response, configurable disposition→action policy, webhook→resume bridge, inbound AI-sales flow |
| [CRM_MCP.md](CRM_MCP.md) | **The CRM over MCP (2026-10-15).** The 13 `crm_*` tools staff use from Claude / ChatGPT / Cursor: what each does, the dashboard-identical lead scope (`/v1/audience/lead-scope`), id checks, two-step confirmed writes, outbound safety, PII handling, settings and deploy order |
| [CRM_PRODUCT_DEEP_DIVE.md](CRM_PRODUCT_DEEP_DIVE.md) | Product audit (2026-06-12): multi-level report hierarchy design, per-persona experience gaps, unsurfaced-data report ideas, AI layer, trust/correctness debt, prioritized roadmap |

## Reading order for new joiners

1. **CRM_WORKBENCH_AND_SALES_DASHBOARD.md §1–2** — the two-database topology (admin-core vs auth-service) and why nothing can `JOIN users`. Every other doc assumes this.
2. **CAMPAIGNS_AND_AUDIENCE_MANAGER.md** — where leads come from.
3. **LEADS_MANAGEMENT.md** — what happens to them.
4. **LEAD_ASSIGNMENT_AND_COUNSELOR_POOLS.md** — who works them.
5. **RECENT_LEADS_AND_FOLLOWUPS.md** — the screens counsellors live in.
6. **LEADS_SETTINGS.md** + the rest as needed.

## The five invariants everyone trips on

1. Admin-core SQL **cannot join `users`** — hydrate identity via `AuthService.getUsersFromAuthServiceByUserIds` after the query.
2. `timeline_event.type_id` for `USER_LEAD_PROFILE` events is the lead's **user_id**, not the profile PK; `action_type` stores the enum **name** (`COUNSELOR_ASSIGNED`), never the human title.
3. Open lead = `conversion_status IS NULL OR != 'CONVERTED'`.
4. `lead_status` columns are `display_order` + `is_active` (boolean) — not `sort_order` / `status`.
5. There is **no `assigned_at` column** — it is derived from `timeline_event` on read.
