# CRM over MCP

The CRM tools of the Vacademy MCP server let institute staff — admins, sales managers, counsellors — work the CRM
from Claude, ChatGPT, Cursor or Claude Code: find and work leads, log calls and follow-ups, assign leads, place
human and AI calls, book meetings, send an approved WhatsApp template or an email, see dues and send fee reminders,
and read the CRM reports, build custom reports and follow the live activity feed.

* Server plumbing, gates, OAuth: `ai_service/MCP_SERVER_GUIDE.md` (§1a covers the CRM tools).
* Public docs: `vacademy-docs/mcp-server/` (the "MCP server" product of the Vacademy docs site, published from Vacademy-io/docs). Tool pages are generated: `cd ai_service && python scripts/gen_mcp_docs.py`.
* Code: `ai_service/app/services/crm_data.py` (shared foundation) and `assistant_tools_crm_*.py`.

## 1. Tools

| Area | Tool | What | Writes |
|---|---|---|---|
| CRM: Leads | `crm_leads` | find, list, get, timeline, my_day, check_exists, catalog, automations, export | – |
| | `crm_lead_activity` | log_interaction, add_note, schedule / reschedule / complete follow-up | opt-in |
| | `crm_lead_edit` | set_status, set_tier, update_details, tag, untag, tag_lists (admins: key → value tags on lead lists) | opt-in, two-step |
| | `crm_team_edit` | assign_leads, reassign_from_counsellor, pause / resume routing | opt-in, two-step |
| | `crm_lead_intake` | add_lead, import_leads | opt-in, two-step |
| CRM: Calls | `crm_calls` | call log, transcripts, callbacks due, missed inbound, AI agents / queue / runs / status | – |
| | `crm_dial` | click-to-call, AI call one lead, cancel own queued call, quota | opt-in, outbound |
| | `crm_ai_campaign` | start an AI campaign, cancel a run, pause / resume the AI queue (admins) | opt-in, outbound |
| CRM: Meetings | `crm_meetings` | my / team meetings, a lead's meetings, free slots, booking pages | – |
| | `crm_meetings_edit` | book a meeting, log its outcome | opt-in, outbound |
| CRM: Messages | `crm_messages` | message history, WhatsApp inbox, templates, can_message, escalations | – |
| | `crm_send` | send an approved WhatsApp template or an email (institute template, or subject + body) to one lead, quota | opt-in, outbound |
| CRM: Reports | `crm_reports` | overview, sources, campaigns, funnel, status changes, counsellors, workload, targets, calling, AI calling, follow-up aging, SLA breaches, stalled, unassigned, meetings, activity, revenue (with a reconciliation against collections), UTM, custom reports (`custom_options`, `custom`: incl. state / city, `list_tag:<key>`, `collected`, `converted_within_7d / 30d`), live activity (`live_feed`, `live_counts`) | – |
| CRM: Payments | `crm_collections` | a lead's dues, who owes, due soon, converted but not paid, failed checkouts, collections (admins; `group_by` up to two of day / week / month / method / course / counsellor / currency / source / list / state / city / `list_tag:<key>`, per-row `compare_to`) | – |
| | `crm_payment_reminders` | installment and invoice reminders (admins, ≤50 per batch), quota | opt-in, outbound |

Not in v1: meeting cancel / reschedule and meeting outcomes as statuses, the engagement copilot inbox, onboarding
flows, target editing, connector management, retrying an automation run,
pausing / blasting a whole lead list, scheduled digest sends. There are no deals / pipeline value, call scripts,
lead attachments or lead merge in the CRM, so the tools do not offer them.

Money reports take `date_basis`: `paid_on` (default) counts a payment on the day it was made —
`payment_log.date` when it was entered as another day than the record (offline / backfilled), else the record's
own time — and `recorded_on` on `payment_log.created_at`. State and city come from `crm_geo`: the person's learner
profile (PIN, region, city), else their lead-form PIN / state / city answers, resolved PIN circle → state named in
the text → known city (aliases and close spellings).

## 2. Rules every CRM tool follows

1. **Identity.** `lead_id` is an `audience_response.id`; a person is `lead_user_id` (never `user_id`, which
   `execute_tool` overwrites with the caller). `find` / `list` group a person's leads together.
2. **Scope is the dashboard's.** Admin-core `GET /admin-core-service/v1/audience/lead-scope` returns the caller's
   visibility from `LeadVisibilityResolver` — the same resolver `AudienceService.getLeads` uses — and SQL reads
   apply it (`crm_data.scope_sql`): either ownership store (enquiry-linked counsellor or lead-profile owner) in the
   owner set, the unassigned pool when the scope includes it, the allowed lists. An institute admin sees the
   institute; a sub-org admin their sub-org; a counsellor their own and their reportees' leads.
3. **Ids are checked first.** Every lead, list, call, follow-up, booking, tag, queue item, run and counsellor id
   is checked against the pinned institute and the caller's scope before admin-core is called.
4. **Reads are institute-anchored.** A person can be a lead of several institutes; timeline, message history,
   revenue and activity only return what belongs to this institute.
5. **Writes are two-step.** Without `confirm_token`: a preview (before → after, automations that will run and
   whether they message or call the lead, credits). With the token: the change. Edit tokens sign the resolved
   targets and their current state (stale ⇒ refused); outbound and bulk tokens are single use
   (`mcp_crm_confirm`) and counted against hourly per-user caps. Notes and follow-ups apply directly.
6. **Outbound safety.** Opted-out people, DND / wrong-number outcomes, recent AI calls (60 min), the per-lead daily
   AI-call limit and the institute's calling hours are checked by the tool before a call or campaign; a campaign
   always sends an explicit lead list. Messages (an approved WhatsApp template or an email) go to one lead at a time; email always honours the
   institute's unsubscribe list. Fee reminders are admin-only and go out through the institute's own reminder automations.
7. **PII.** Lists mask phone and email; one lead's `get` shows full contact; bulk contact goes out only as a
   private, expiring CSV link. Text written by leads or staff is returned inside `lead_content`.
8. **Numbers carry their definition** — window, timezone, what is counted — because dashboard widgets count
   differently by design (submission vs person grain, UTC vs institute days, what "converted" and "connected" mean).

## 3. Settings

All CRM edit groups are opt-in (never switched on by an area's Edit level or "Turn everything on"). A sensible
setup: institute-wide `crm_leads`, `crm_calls`, `crm_meetings`, `crm_messages`, `crm_reports` and
`crm_lead_activity`; for ADMIN (and managers) also `crm_lead_edits`, `crm_team_edits`, `crm_lead_intake`; the
outbound groups only for the people who should call or message from their AI app.

## 4. Deploying

admin-core first (Flyway `V583__mcp_crm_confirm.sql` and the lead-scope endpoint), then ai_service. Before V583
is applied, confirm-token actions answer `confirm_unavailable`; before the lead-scope endpoint is live, only
whole-institute admins get SQL-backed reads.
