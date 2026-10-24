# Vacademy MCP Server

Lets institute staff use their own AI apps — Claude, ChatGPT, Cursor, Claude Code —
against their institute's Vacademy data, over the [Model Context Protocol](https://modelcontextprotocol.io).

It lives in `ai_service` (`app/mcp/`) because that is where the Vacademy Assistant
tool registry, the per-institute tool gate, and platform JWT verification already
are. The MCP surface is a narrow adapter over those, not a second implementation.

---
## 1. What it exposes

Each feature is **one tool with an `action` argument**, so the institute's
settings tab has one toggle per feature to manage per role:

| Tool | Mode | Settings group | Actions |
| :--- | :--- | :--- | :--- |
| `whoami` | READ | `identity` — **always on**, not a toggle | the caller's name, username, email, mobile, roles + the institute's name, logo, theme, portals, terminology |
| `get_institute_overview` | READ | `institute_overview` | sections: `profile` (name, logo, theme, contact, terminology), outstanding fees, classes live now, active learners |
| `website` | READ | `website_builder` | `list`, `get_page`, `find_section`, `context`, `analytics`, `lead_summary`, `audit`, `review`, `brief_checklist`, `schema`, `list_media`, `preview`, `strings` |
| `design_import` | WRITE (drafts only, no model, no credits; MCP-only — never offered in the in-product assistant) | `design_import` (Website → "Import Figma designs", off until enabled) | `plan` (Figma results the AI app read itself → tokens, sections matched to the pattern registry, data needs, assets, site JSON draft; uploads kept 24 h in `mcp_design_import_part`, one row per part, institute-scoped, purged for all institutes on every upload), `save_draft` (through `website_edit`'s create_site / create_page; also needs `website_builder_edits`) |
| `catalog_data_edit` | WRITE (live-additive: never deletes, renames, hides or clears; every action a dry run unless `dry_run=false`; MCP-only — never offered in the in-product assistant) | `website_data_edits` (Website → "Set up folders, course tags and product pages", risk `live_additive`, off until enabled; **opt-in**: the settings page never turns it on with the area's Edit level or "Turn everything on") | `create_folder_library` (empty, unattached; recorded in `mcp_catalog_data_record`), `upsert_folder_nodes` (≤100, matched by slug; new folders HIDDEN; an existing folder gets only differing fields — never title / parent / status — and only in a library this tool created or no ACTIVE site uses; `image_url` must be an institute asset, `audience_id` an ACTIVE campaign), `add_course_tags` (≤50 courses, slug-normalised, appended; the stored course is sent back whole through `PUT update-course/{id}`; a course whose existing tags that save would lower-case is refused), `create_product_page` (DRAFT, DEFAULT invite + cheapest ACTIVE plan per batch, `role` path / store), `sync_store` (`/{id}/sync-catalogue` with `deactivateMissing=false`; returns skip reasons). No activate, no invite vendor change (admin clicks) |
| `website_edit` | WRITE (drafts only, no model, no credits) | `website_builder_edits` | `create_page`, `create_site`, `add_html_page`, `update_page`, `set_layout`, `add_section`, `set_theme`, `set_site_settings`, `set_courses`, `link_lead_form`, `set_seo`, `import_image`, `discard_draft`, `set_catalog_settings`, `set_translations`, `bind_data`, `request_publish` (readiness only; with `website_publish` on, a ready draft also gets a single-use confirm token) |
| `website_publish` | WRITE (**live**, two-step confirmed; MCP-only) | `website_publish` (Website → "Publish and roll back", **opt-in**: off for everyone, never switched on by the Website Edit level or "Turn everything on") | `publish` (`confirm_token` from `request_publish` < 10 min earlier, bound to institute + user + site + draft id + SHA-256 of the draft JSON + live revision; single use; admin-core called with `expectedLiveRevisionNo` + `expectedDraftSha256`, never `overrideStale`, so a draft older than live or edited in between gets a 409), `rollback` (`to_revision_no`: first call returns `diff_vs_live` + a token, second call with the token saves that PUBLISHED revision's JSON as a NEW draft (`create_only`, refused while any draft is open) and publishes it the same guarded way). Returns `published_revision_no`, `previous_live_revision_no`, `rollback_hint`. Tokens are stored hashed in `mcp_publish_confirm`. Relies on admin-core's stale guard (`CATALOGUE_PUBLISH_STALEGUARD_ENABLED`, on by default): with it off admin-core refuses every checked-draft publish (409 `STALE_GUARD_OFF`). Refused outside MCP (`ToolContext.via_mcp`). Deploy admin-core (and the editor's 409 handling) before ai_service, and enable the group only after both are live |
| `audience_forms` | READ | `audience_forms` | `list`, `get`, `leads` |
| `audience_forms_edit` | WRITE (additive only) | `audience_forms_edits` | `create`, `update_fields` (adds/changes, never removes), `send_test_lead` |
| `workflows` | READ | `workflows` | `list`, `get`, `runs`, `catalog` (the builder's authoring contract, in sections), `context` (real batches / audiences / templates / sessions / invites to reference), `template` (one email or WhatsApp template in full) |
| `workflows_edit` | WRITE (drafts + additive, no model, no credits) | `workflows_edits` | `validate`, `create_draft`, `update_draft`, `discard_draft` (the last two refuse anything whose status is not DRAFT); `create_email_template`, `create_whatsapp_template` (new templates only, WhatsApp submitted to Meta), `sync_whatsapp_templates` |
| `workflows` | READ | `workflows` | `list`, `get`, `runs`, `catalog` (the builder's authoring contract, in sections), `context` (real batches / audiences / templates / sessions / invites to reference) |
| `workflows_edit` | WRITE (drafts only, no model, no credits) | `workflows_edits` | `validate`, `create_draft`, `update_draft`, `discard_draft` — the last two refuse anything whose status is not DRAFT |
| `blog` | READ | `blog` | `list` (posts of any status, categories, where they are shown), `get` (one post with its HTML body, SEO, public URLs), `placements` (website pages carrying a Blog section) |
| `blog_edit` | WRITE (drafts only, no model, no credits) | `blog_edits` | `create` (always a DRAFT, `source=MCP`, body nh3-cleaned with the article profile), `update` / `discard` (refuse anything that is not a DRAFT), `request_publish` (readiness audit + the dashboard link; never publishes) |
| `courses` | READ | `courses` | `list`, `get`, `get_slide`, `schema`, `brief_checklist`, `review`, `drip`, `invites`, `get_invite`, `payment_setup`, `sessions_levels` |
| `course_edit` | WRITE (DRAFT only, no model, no credits) | `course_edits` | `create_course`, `add_chapter`, `add_slide`, `update_slide`, `reorder`, `import_image`, `import_pdf`, `discard_slide`, `publish_slides`, `submit_for_review` |
| `course_drip_edit` | WRITE (non-live courses only) | `course_drip_edits` | `set_rules`, `schedule`, `remove_rules` |
| `course_invites_edit` | WRITE (additive only) | `course_invite_edits` | `create_invite`, `create_payment_plan`, `make_default` |
| `learner_report` | READ (no model, no credits) | `learner_reports` (own area "Progress reports", off until enabled) | `guide` (field meanings, the dashboard report's status / grade rules, how to write a grounded report), `data` (`learner_id`, window ≤ 366 days, optional `batch_id` / `modules` / `detail` / `attempt_limit`: `report` = admin-core `/internal/student-analysis/student-360` (Layer-1 facts, no narrative) and `detail` = `/internal/student-analysis/raw-detail` (per-class attendance, per-module progress vs the batch, slide-by-slide study, assignment submissions, doubt text + replies, per-attempt `processed_json`; `attempt_details` = raw_json, opt-in); both refuse a learner or batch outside the institute), `saved_reports` / `saved_report` (`student_analysis_process`, COMPLETED, institute-scoped SQL) |
| `sub_orgs` | READ | `sub_orgs` (own area "Sub-organisations") | `list` (admin-core `GET /institute/v1/sub-org/get-all-with-details`, caller's visibility), `get` (courses = batches of the sub-org's ACTIVE `tag='SUB_ORG'` invites, seats used per batch vs the cap, admins, `SUB_ORG_SETTING`, invite link), `members` (learners: stamped `sub_org_id` OR a plan from one of its invites), `create_options` (ACTIVE institute payment options incl. CPO mirrors, gateways, auth-service roles, admin permissions), `enroll_template` (add-member's profile columns + custom fields). Institute-scoped through `institute_suborg` (`services/sub_org_data.py`) |
| `sub_org_edit` | WRITE (**live**, preview + confirm token) | `sub_org_edits` (Sub-organisations → "Create and change", **opt-in**) | `preview` / `apply` × `change`: `create` (`POST /institute/v1/sub-org/create-with-subscription` — the dashboard wizard's body; name unique per institute, ≥1 course, payment option / seats / validity / admin roles never defaulted, warns on ADMIN), `update` (`PATCH /{id}/configuration`: `add_package_session_ids`, `member_count` (not below current usage), `validity_in_days`, `auth_roles`, `allowed_team_roles`, `admin_permissions`; no payment-option swap), `add_admin` (`POST /sub-org/v1/add-member` with ROOT_ADMIN on every batch, role = `AUTH_ROLES[0]`; refused when an admin exists). No delete / deactivate / course removal |
| `sub_org_enroll` | WRITE (additive, preview + confirm token) | `sub_org_enrollments` (Sub-organisations → "Add learners", **opt-in**) | `preview` / `enroll`: CSV and/or `[{learner_id} | row]` (≤200) into all or some of the sub-org's batches; one `POST /sub-org/v1/add-member` per learner (role LEARNER, institute / sub-org forced, 4 at a time, each its own transaction, per-row result). Skips anyone ACTIVE in a batch (in or outside the sub-org); refuses an upload over the per-batch cap (`SUB_ORG_SETTING.MEMBER_COUNT`, else the admin plan's `member_count` — admin-core itself only checks the latter); asks `credentials_file` (link-only CSV, `file_exports`); login emails follow Course Settings; lists `SUB_ORG_MEMBER_ENROLLMENT` automations |
| `crm_leads` | READ | `crm_leads` (area "CRM: Leads") | `find`, `list`, `get`, `timeline`, `my_day`, `check_exists`, `catalog`, `automations`, `export` (link-only CSV) |
| `crm_lead_activity` | WRITE (live additive, **opt-in**) | `crm_lead_activity` | `log_interaction` (note + follow-up + answers + call outcome in one call; the status part waits for a confirm when an automation listens), `add_note`, `schedule_followup`, `reschedule_followup`, `complete_followup` (two-step) |
| `crm_lead_edit` | WRITE (live, **opt-in**, two-step) | `crm_lead_edits` | `set_status` (≤500, ids or filter), `set_tier`, `update_details`, `tag`, `untag` |
| `crm_team_edit` | WRITE (live, **opt-in**, two-step; admin / manager of the target) | `crm_team_edits` | `assign_leads` (≤500), `reassign_from_counsellor`, `pause_routing`, `resume_routing` |
| `crm_lead_intake` | WRITE (live, **opt-in**, two-step, single-use) | `crm_lead_intake` | `add_lead` (walk-ins via source WALK_IN), `import_leads` (≤100) |
| `crm_calls` | READ | `crm_calls` (area "CRM: Calls") | `list`, `get`, `transcript`, `callbacks_due`, `missed_inbound`, `ai_agents`, `ai_queue`, `ai_runs`, `ai_status` |
| `crm_dial` | WRITE (outbound, **opt-in**, single-use, hourly caps) | `crm_calling_outbound` | `call` (click-to-call: the caller's phone rings first), `ai_call`, `cancel_queued`, `quota` |
| `crm_ai_campaign` | WRITE (outbound, **opt-in**, single-use, ADMIN only) | `crm_ai_campaigns` | `start` (≤500 leads across lists, explicit ids always), `cancel_run`, `pause_queue`, `resume_queue` |
| `crm_meetings` | READ | `crm_meetings` (area "CRM: Meetings") | `my_meetings`, `team_meetings`, `for_lead`, `free_slots`, `booking_pages` |
| `crm_meetings_edit` | WRITE (outbound, **opt-in**) | `crm_meeting_edits` | `book` (two-step, single-use; invite + calendar to the lead), `log_outcome` |
| `crm_messages` | READ | `crm_messages` (area "CRM: Messages") | `history`, `inbox`, `templates`, `can_message`, `escalations` |
| `crm_send` | WRITE (outbound, **opt-in**, single-use; 20 WhatsApp + 30 email /h/user) | `crm_messaging_outbound` | `send` (`channel` WHATSAPP: an APPROVED template; EMAIL: an institute email template or subject + body; ONE lead; email honours the unsubscribe list whatever its type), `quota` |
| `crm_reports` | READ | `crm_reports` (area "CRM: Reports") | `overview`, `sources`, `campaigns`, `funnel`, `status_changes`, `counsellors`, `workload`, `targets`, `calling`, `ai_calling`, `followup_aging`, `sla_breaches`, `stalled`, `unassigned`, `meetings`, `activity`, `revenue` (admin), `utm` (admin), `custom_options`, `custom` (1-2 dimensions incl. lead-form fields × chosen lead / activity metrics, scoped SQL in `crm_custom_reports.py`), `live_feed`, `live_counts` (the live activity feed, `crm.live_activity`); `compare_to: previous_period` on every windowed action |
| `crm_collections` | READ | `crm_collections` (area "CRM: Payments") | `lead_dues`, `who_owes`, `due_soon`, `collections` (admin), `converted_not_paid`, `abandoned_checkouts` |
| `crm_payment_reminders` | WRITE (outbound, **opt-in**, single-use, ADMIN only, ≤50 reminders/h/user) | `crm_payment_reminders` | `send_installment_reminder`, `send_invoice_reminder` (≤50 per batch, ids verified, re-read at apply), `quota` |

The allow-list is `MCP_EXPOSED_TOOLS` in `app/mcp/constants.py`. A tool in the
Assistant registry is **not** reachable over MCP unless it is named there — so
adding Assistant tools never widens this surface by accident. The tools live in
`app/services/assistant_tools_website.py`, `assistant_tools_website_edit.py`,
`assistant_tools_audience.py` and `assistant_tools_workflow.py` (shared loaders
in `website_data.py`, page summaries and the publish-check port in
`catalogue_summary.py`); the designs are in
`docs/ai-page-builder/WEBSITE_BUILDER_MCP_PLAN.md` and
`docs/WORKFLOW_AI_ASSIST_DESIGN.md` (§14, the MCP path).
The course builder lives in
`assistant_tools_courses.py`, `assistant_tools_course_edit.py`,
`assistant_tools_course_drip.py` and `assistant_tools_course_invites.py`, with
SQL reads + the admin-core client in `course_builder_data.py` and the pure
contract / validators / slide payloads in `course_content.py`; its design is in
`docs/ai-course/COURSE_BUILDER_MCP_PLAN.md`. Like the website tools, no model runs
server-side: the connected LLM writes the course, the tools validate and save.

**One model, not two.** The connected AI app is the only LLM: it interviews the
admin (`website(brief_checklist)`), reads the component contract
(`website(schema)` — the AI builder's own catalogue, design rules and page
archetypes), composes the page JSON itself and saves it with
`website_edit(create_page | create_site)`. The server validates with the
builder's sanitiser, audits, and returns issues to fix with `update_page`.
Nothing on the MCP path calls a model or spends credits; images come only from
the media library (`list_media`) or public URLs pulled in with `import_image`.
**Quality loop.** `website(review)` is an opinionated design review
(`services/page_quality.py`): structure (hero → proof → what you get → CTA),
rhythm (bands, adjacent twins, unstyled pages), hero quality (headline length,
CTAs, image or centered layout, eyebrow), content (placeholder copy, walls of
text, stats without numbers, empty testimonials), palette (accent colours) —
merged with the builder's defect audit — scored 0–100 with a bar of 85 and a
concrete fix per issue. Every `website_edit` result carries the page's score;
the server instructions tell the model to iterate with `update_page` until it
passes. `website(preview)` renders the DRAFT with headless Chromium through the
learner app's preview mode (`services/page_preview.py`: load `/<tag>?preview=true`,
post the config with the wanted page presented as the root page, screenshot the
page or one `section_id`) and returns it as MCP image content, so a
vision-capable client can look at what it made. Screenshot-driven edits:
`get_page` gives each section a `position` and a `looks` line (band colour,
layout, images, buttons); `find_section` turns the text an admin points at into
the section id and exact prop path. `list_media` ranks hero-worthy landscape
photos first; `create_page` places the first one in a split hero that has no
image, or falls back to a centered hero; `import_image` takes a `urls` batch.

**HTML pages.** `add_html_page` takes HTML + CSS the connected model wrote (or
the admin pasted) — a full document or body markup — through the builder's
page-level contract (`services/html_page_import.py`): scripts and external
stylesheets removed, `<style>` moved into `css`, links rewritten into the
renderer's `data-vacademy` hooks (`route`, `scroll`, `lead-form`, `enrol`),
page-level nh3 allowlist (SVG kept, forms/inputs removed), institute-media-only
images, 200 KB/150 KB caps. The page renders in a shadow root with
`hideSiteChrome` on by default. Enquiry buttons are
`<a data-vacademy="lead-form" data-audience="">` — `link_lead_form` on the
htmlPage section fills `data-audience`, and the audit flags empty ones. The
contract is served to the model as `html_page_contract` in `website(schema)`.

Authored pages keep what the author set — explicit paddings, one-section
pages (course-details templates), rich text (nh3-cleaned) — where the
composer's own output rules would have normalised them; a site written
straight to the DB (the Claude-CLI path) round-trips through `create_site`
unchanged (verified against learn.ttsedu.co.in/new-website).

**Automations follow the same pattern.** `workflows(catalog)` serves the AI
drafter's grounding document (`GET /v1/workflow/ai-catalog`: the workflow JSON
shape, the generation rules, every node type's config, the prebuilt queries with
their output keys, the trigger events with the `#ctx` keys they emit) and
`workflows(context)` the institute's real ids and template names. The connected
LLM composes the workflow JSON; `workflows_edit` normalises it (canvas or
builder shape, `config.routing` folded into edges, a CONDITION's predicate
propagated onto its true edge, the trigger backfilled from the TRIGGER node),
lints it (dead node types, flat DELAY shapes, unreachable nodes, missing
templates, ids that are not the institute's, mutating queries), runs the
backend `/validate`, and only then saves — always as `status=DRAFT`. A DRAFT
never fires (`WorkflowTriggerService` and the scheduler read only ACTIVE
workflows); the admin reviews it at `editor_url` and publishes from the
builder. There is no Test Run action: `QUERY`, `SET_LEAD_STATUS` and `COMBOT`
act for real even in a dry run. Nothing on the MCP path calls
`/v1/workflow/ai-draft` or any other model.

Templates are part of the same flow: a SEND node references a template by
name, so `workflows_edit(create_email_template)` creates one (placeholders
derived from the `{{…}}` in subject/HTML become `dynamic_parameters`, which is
what makes the builder's mapping UI appear) and
`workflows_edit(create_whatsapp_template)` creates a draft in
notification-service, pre-checks Meta's content rules (positional `{{1}}`
variables, no leading/trailing variable, one sample per variable, ≤1024
chars, UTILITY/MARKETING) and submits it for approval. Both are **additive**:
an existing template is never edited or removed, because a live automation may
be sending it. `sync_whatsapp_templates` refreshes statuses from Meta so a
PENDING template can be re-checked before the admin publishes.

**Why a write tool is allowed.** MCP has no confirm card, so `website_edit`
never touches live data: every action saves a **draft revision**
(`source=AI_COPILOT`/`AI_WIZARD`, `ai_run_id`) that the admin reviews in Manage
Pages — where the publish checks run — and publishes themselves.
`discard_draft` is the undo. `workflows_edit` has the same property — it can
only create, replace or discard a DRAFT automation — plus the additive one for
templates (create new, never change). `audience_forms_edit` is
only create, replace or discard a DRAFT automation, and so does `blog_edit` —
posts are rows in `catalogue_blog_post` (not page JSON), `create` forces
`status=DRAFT` (the public endpoint serves PUBLISHED only), `update`/`discard`
refuse anything else, and publishing is a click in Manage Pages → Blog.
`audience_forms_edit` is
allowed on the other safe property: it only **adds** (a campaign, a field, a
test lead) and never changes or removes what exists.
`course_edit` creates DRAFT courses (off the catalogue)
and only edits DRAFT courses; slides are DRAFT unless the admin asks for
published ones, and `publish_slides` publishes DRAFT slides only on the admin's
request — going live is `submit_for_review` plus an admin's approval in the
dashboard. `course_drip_edit` only touches courses that are not ACTIVE and never
flips the institute-wide drip switches. `course_invites_edit` only creates
invites and payment plans; re-pointing an invite or making it the default is
refused once the course is ACTIVE. `MCP_ALLOWED_WRITE_TOOLS`
names each allowed write tool with the property that makes it safe, and
`tests/test_mcp_adapter.py` refuses any other write tool. Write groups are off for every role until an admin
enables them.

## 1a. CRM tools

The 15 `crm_*` tools (`app/services/assistant_tools_crm_*.py`) share one
foundation, `app/services/crm_data.py`; the design is
`docs/crm/CRM_MCP.md`. All are `mcp_only` (never offered to the in-product
assistant) and need module `crm` (`ToolSpec.module_feature`, checked in
`execute_tool` against `institute_module_entitlement` / `institute_module_policy`
via `app/services/entitlements.py`; LEGACY institutes have everything on).

* **Scope = the dashboard's.** `crm_data.scope` reads admin-core
  `GET /admin-core-service/v1/audience/lead-scope?instituteId=` — the same
  `LeadVisibilityResolver` the Recent Leads / Lead Board query uses (sub-org
  admin, counsellor hierarchy, AUDIENCE_LIST / COUNSELOR modes, unassigned
  pool). SQL reads apply it with `crm_data.scope_sql`. Against an admin-core
  without the endpoint, only a whole-institute ADMIN keeps SQL reads; everyone
  else gets `scope_unavailable`.
* **Every id is verified** against the pinned institute and the caller's scope
  before any admin-core call (`resolve_lead(s)`, `verify_ids`), and reads are
  anchored to the institute (timeline, messages, revenue).
* **Writes are two-step.** Called without `confirm_token` an action returns a
  preview (before → after, automations that will fire via
  `crm_data.automations_for`, who is notified, credits) and a token; the same
  call with the token applies it. Edits use a stateless HMAC token over the
  resolved targets + their current state; outbound and bulk actions use
  single-use rows in `mcp_crm_confirm` (Flyway V583), spent atomically, with
  per-user hourly caps (`crm_data.CAPS`) counted from spent rows. Tokens are
  bound to the MCP client (`ToolContext.client_id`).
* **PII.** Lists mask phone / email; `get` on one lead in scope returns full
  contact; bulk contact only through `export` (a `file_exports` link). Text
  written by leads or staff comes back inside `lead_content`. The audit log
  keeps only action, ids, enums, numbers and dates for `crm_*` calls
  (`repository._audit_args_json(args, tool_name)`).
* **Deploy order.** admin-core first (V583 + the lead-scope endpoint), then
  ai_service. Until V583 is applied, confirm-token actions answer
  `confirm_unavailable`.

## 2. Who can reach it

Three gates, all deny-by-default, all re-evaluated on **every** request:

1. **OAuth 2.1** — the caller holds an access token this server issued to one
   Vacademy user for one institute.
2. **Institute + role** — that institute enabled the server (`MCP_SERVER_SETTING`)
   and allow-listed the user's role. Learner roles (`STUDENT`, `LEARNER`,
   `PARENT`) are refused unconditionally and are stripped from the allow-list
   server-side, so they cannot be granted even by editing the setting directly.
   Membership is the roles the JWT carries for this institute: `is_root_user`
   is set for ordinary users and grants nothing here (a principal with no role
   in the institute is refused, root or not).
3. **Per-tool** — the institute enabled that specific tool, institute-wide or for
   the caller's role.

The endpoint itself is always mounted (`MCP_SERVER_ENABLED=false` is an emergency
kill switch, not the access control): an institute that has not opted in is
refused, and an unauthenticated caller gets a 401, so the endpoint existing
grants nobody anything.

Because nothing is cached on the token, switching the server off, removing a role,
or untoggling a tool takes effect on the caller's **next** request — existing
connections included.

Identity is never taken from tool arguments: `execute_tool` overwrites `user_id`
and `institute_id` with the pinned principal before the executor runs.

## 3. How a connection is made

### White-label institutes: the institute-scoped server URL

Vacademy is sold white-label (Shiksha Nation, Edzumo …): each institute's admins
live on their own admin portal with their own brand. OAuth discovery is per
resource URL, so the URL the admin pastes carries the institute:

```
https://<backend>/ai-service/mcp/i/<institute_id>      ← what Settings → MCP Server shows
https://<backend>/ai-service/mcp                        ← legacy: platform dashboard + institute picker
```

Both are the same MCP app (one issuer, one `/token`, one `/register`). Under
`/i/<id>` (`app/mcp/institute_scope.py`):

* the 401 challenge and RFC 9728 document are per institute, so the client's
  `resource` names the institute from its first request;
* `/authorize` reads the institute from `resource` and sends the browser to
  **that institute's admin portal** (`institutes.admin_portal_base_url`, else
  the `ADMIN` row in `institute_domain_routing`, else `ADMIN_DASHBOARD_URL`) —
  its brand, its session, no picker;
* consent binds only a user of that institute (`institute_mismatch` otherwise);
* a token minted for `/i/<id>` is accepted only under `/i/<id>` (the SDK's
  single-URL resource check is replaced by ours in `server._authorize`);
* the auto-provisioned OAuth client — the name the AI app shows — is the
  institute's name; `editor_url`s point at the institute's portal.

The only thing still platform-branded is the MCP `initialize` title/instructions,
which the SDK serves statically.

```
AI client ──POST /ai-service/mcp (no token)──▶ 401 + WWW-Authenticate: resource_metadata=…
   │  GET /.well-known/oauth-protected-resource/ai-service/mcp   (RFC 9728)
   │  GET /.well-known/oauth-authorization-server/ai-service/mcp (RFC 8414)
   │  POST /ai-service/mcp/register        ← client registers itself (RFC 7591)
   │  GET  /ai-service/mcp/authorize       ← parked; browser sent to the dashboard
   │        └─ admin signs in, picks an institute, approves
   │           POST /ai-service/mcp/oauth/consent   ← the ONLY place identity is bound
   │  POST /ai-service/mcp/token           ← code + PKCE → access (1h) + refresh (30d)
   └──POST /ai-service/mcp (Bearer vcm_at_…) → initialize / tools/list / tools/call
```

The MCP token is **not** a platform credential — it is an opaque handle into
`mcp_oauth_token`. The approving user's platform JWT is stored encrypted against
that row and replayed to admin-core on each tool call, so a connection can never
do more than the person who approved it.

## 4. Configuration

### Service (env)

| Variable | Required | Notes |
| :--- | :--- | :--- |
| `MCP_SERVER_ENABLED` | – | **`true` by default** — emergency kill switch only. Real access control is per-institute. |
| `MCP_ISSUER_URL` | – | Public URL of the endpoint; doubles as OAuth issuer and RFC 8707 resource id. Must be HTTPS (localhost exempt). Defaults to `<AI_SERVICE_PUBLIC_URL>/ai-service/mcp`. |
| `ADMIN_DASHBOARD_URL` | – | Where the browser is sent to approve. |
| `MCP_TOKEN_ENCRYPTION_KEY` | recommended | Encrypts stored platform tokens. Falls back to another server-side secret when unset, so the server needs no deploy-time config. Set a dedicated key in production so rotating the JWT secret does not invalidate every stored grant. Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `MCP_ACCESS_TOKEN_TTL_SECONDS` | – | 3600 |
| `MCP_REFRESH_TOKEN_TTL_SECONDS` | – | 2592000 (30d) |
| `MCP_AUTH_TXN_TTL_SECONDS` | – | 900 |
| `MCP_AUTH_CODE_TTL_SECONDS` | – | 300 |

Ingress must route `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server` to ai-service: RFC 9728/8414 put those
documents at the **root** of the host, not under `/ai-service`. The Helm chart
does this whenever ai_service is enabled.

### Institute (settings)

Stored under `MCP_SERVER_SETTING` in `institutes.setting_json`, edited at
**Settings → MCP Server**:

```json
{
  "enabled": false,
  "allowed_roles": ["ADMIN"],
  "enabled_tools": ["institute_overview"],
  "role_overrides": { "TEACHER": { "enabled_tools": ["institute_overview"] } }
}
```

`role_overrides` is additive on top of `enabled_tools`, matching the Assistant's
semantics — the same gate code reads both.

### Institute client id

Every institute gets one OAuth client (`vacademy-<hex>`, name `Vacademy`) minted
the first time an admin opens the settings page, pre-seeded with the callbacks of
the apps we know (`AUTO_CLIENT_REDIRECT_URIS`). It is the **primary** client:
`connection-info` flags it `is_primary: true`, the settings page shows it as
"Your client ID" once the server is enabled, and `DELETE /manual-client/{id}`
refuses it (403 `primary_client`) so an institute can never be left without an
id to paste. Clients an admin adds for other apps use the `vcm-` prefix and can
be removed. Most AI apps never need any of this — they self-register via DCR.

## 5. Layout

| File | Responsibility |
| :--- | :--- |
| `constants.py` | Exposed-tool allow-list, setting key, learner roles, denial messages |
| `schema.py` | Idempotent DDL for local standalone runs; mirrors Flyway V519 |
| `crypto.py` | Token hashing + Fernet encryption of platform credentials |
| `repository.py` | SQL for clients, pending authorizations, codes, tokens, audit log |
| `access.py` | The institute + role gate, and setting normalization |
| `principal.py` | Rebuilds a `PinnedPrincipal` from a stored token; refreshes it |
| `oauth_provider.py` | OAuth 2.1 authorization server + token verifier |
| `consent.py` | Dashboard-facing endpoints: consent, connection info, client ids |
| `adapter.py` | Registry `ToolSpec` → MCP `Tool`; call dispatch + audit |
| `server.py` | Protocol handlers and the mounted ASGI app |
| `well_known.py` | Root-level OAuth discovery documents (global + per-institute) |
| `institute_scope.py` | Institute-scoped server URLs for white-label institutes: path adapter, portal lookup, resource parsing |

Tables: `mcp_oauth_client`, `mcp_oauth_txn`, `mcp_oauth_code`, `mcp_oauth_token`,
`mcp_tool_call_log`. Issued tokens are stored as SHA-256 hashes; auth codes and
refresh tokens are single-use; refresh rotates both halves of the pair.

**Schema ownership.** ai_service shares admin-core's database, so these tables
ship as a Flyway migration in that service:
`admin_core_service/src/main/resources/db/migration/V519__mcp_server_oauth_and_audit.sql`.
That file is the source of truth. `app/mcp/schema.py::ensure_mcp_schema` applies
the same statements at startup so the service runs standalone in local
development; it is idempotent, so it is a no-op once Flyway has run. Change one,
change the other.

## 6. Running it locally

```bash
cd ai_service
export MCP_SERVER_ENABLED=true
export MCP_ISSUER_URL=http://localhost:8077/ai-service/mcp   # localhost is exempt from the HTTPS rule
export MCP_TOKEN_ENCRYPTION_KEY=dev-passphrase
export ADMIN_DASHBOARD_URL=http://localhost:5173
./run-local.sh
```

Then:

```bash
curl -i localhost:8077/ai-service/mcp                                   # 401 + WWW-Authenticate
curl localhost:8077/.well-known/oauth-protected-resource/ai-service/mcp # RFC 9728 doc
npx @modelcontextprotocol/inspector                                     # full OAuth + tools flow
```

Connecting a real client once deployed:

```bash
claude mcp add --transport http vacademy https://backend-stage.vacademy.io/ai-service/mcp
```

## 7. Tests

```bash
cd ai_service
python -m pytest tests/test_mcp_access.py tests/test_mcp_adapter.py \
                 tests/test_mcp_oauth.py tests/test_mcp_clients.py tests/test_mcp_institute_scope.py \
                 tests/test_website_tools.py tests/test_website_edit_tool.py \
                 tests/test_workflow_tools.py tests/test_course_tools.py tests/test_institute_setting_reader.py -q
```

These cover the gates, the exposed-tool containment, the redirect-URI policy and
the credential primitives without a database. The OAuth flow itself (DCR → consent
→ PKCE exchange → `tools/list` → rotation) is exercised against a real Postgres;
see the verification notes in the PR.

## 8. Adding a tool

1. Prefer adding an **action** to an existing feature tool over a new tool —
   every tool is a toggle an admin has to understand.
2. For a new tool: add the registry name to `MCP_EXPOSED_TOOLS` in
   `constants.py`, a label in `MCP_TOOL_GROUP_LABELS` and a one-sentence
   `MCP_TOOL_GROUP_SUMMARIES` entry (the settings page shows the summary and the
   tool's `action` enum, not the model-facing description).
3. Read-only tools (`mode == "READ"`) need nothing else. `always_allowed=True`
   skips the settings toggle altogether (the settings page shows the tool as
   "Always on"); reserve it for identity-only tools like `whoami` — the
   institute/role gate still applies. A write tool is only
   allowed when **every** action is draft-only (published from the dashboard)
   or purely additive; add it to `MCP_ALLOWED_WRITE_TOOLS` with that reason and
   keep it `default_enabled=False` with no `default_roles`. Live writes that
   change or remove data (learner edits, announcements) stay off MCP until
   elicitation exists.
4. Nothing else: the settings UI reads its catalogue from
   `/mcp/oauth/connection-info`, so the toggle appears on its own.
