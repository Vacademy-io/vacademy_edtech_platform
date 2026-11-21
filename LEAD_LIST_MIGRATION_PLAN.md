# Lead-list migration — implementation plan

This branch implements **migrating leads from one lead list to another**.

A companion "select all" fix was prototyped alongside it and deliberately **dropped** before
merge: it capped the leads page size at 500 server-side, which silently truncated the CSV export
(`handleExport` asks for `size: totalElements`) to 500 rows. Reverted rather than shipped.

## Status

| Step | State |
|---|---|
| `V502` — `audience_response.original_audience_id` | done |
| `LEAD_LIST_CHANGED` timeline events | done |
| `POST /v1/audience/leads/migrate` (+ `@Auditable`) | done |
| `MigrateLeadsDialog` in both leads tables | done |
| Exercised against a database | **not done** |

Backend compiles, frontend typechecks, `design-lint` clean. `V502` has not run and the endpoint
has not been called.

## Background: what a "lead list" actually is

There is no `LeadList` entity. A **lead list = an `audience` row** (the code calls them
"campaigns"; the Javadoc in `LeadDedupSettingService` and `LeadDeduplicationService` calls
them "lead lists"). A **lead = an `audience_response` row**, attached to its list by the plain
`audience_response.audience_id` column — no join table.

So a migration is fundamentally a single-column `UPDATE`. The work is in the invariants
that hang off that column.

### Deduplication, as it exists today

Stored as JSON, not a table: `institute.setting → setting → LEAD_SETTING → data → dedup`,
read at `LeadDedupSettingService.java:108`, Caffeine-cached 5 min.

| Enum | Values |
|---|---|
| `DedupField` | `EMAIL`, `PHONE` |
| `DedupScope` | `CAMPAIGN` (this list only), `SELECTED` (a named set of lists), `INSTITUTE` |
| `DedupAction` | `REJECT`, `ALLOW_REASSIGN` |

Enforced by `LeadDeduplicationService.checkDuplicate(instituteId, audienceId, email, phone, excludeResponseId)`
(`LeadDeduplicationService.java:130`) from 8 intake call sites in `AudienceService`. PHONE
matches on last-10-digits; EMAIL on trim + lowercase. All 6 backing predicates
(`AudienceResponseRepository.java:1672-1766`) exclude `is_duplicate` and `OPTED_OUT` rows.

This matters for Part B because **dedup is scoped per list**: a lead that is unique in list A
may collide once moved into list B.

---

# The feature

**Decisions taken:** move (not copy); **provenance preserved**; colliding leads **skipped**,
the rest migrated (partial success).

## B1. What has to move with the row

Most of the lead graph is keyed by `audience_response_id` and therefore follows the row for
free — `lead_status_history`, `lead_followup`, `timeline_event`, `telephony_call_log`
(`response_id`), `engagement_member`, enquiry links.

Three things do **not**, because they denormalise `audience_id`:

| What | Where | Handling |
|---|---|---|
| `lead_score.audience_id` | `LeadScore.java:31`, `NOT NULL` | **Must** be updated in the same transaction or scores are mis-attributed to the old list. |
| `audience_response.initial_score` | `AudienceResponse.java:138-140`, a snapshot of the source `audience.default_initial_score` taken at `AudienceService.java:1175` | **Keep the original.** Re-snapshotting would silently rescore historical leads on a move. |
| `audience_response.workflow_activate_day_at` | derived from the source audience's `workflow_setting.offset_day` | **Keep.** Recomputing could re-fire drip workflows for leads that already received them. |

Both "keep" decisions are deliberate and will be commented in the code — a move is a
curation action, not a re-intake.

## B2. Provenance

Two mechanisms, because they answer different questions:

1. **Full chain — timeline event.** New `LeadJourneyActionType.LEAD_LIST_CHANGED` (the enum
   currently has no move/migrate value), logged through the existing `logLeadCurationEvent`
   (`AudienceService.java:3658`) with metadata `from_audience_id`, `from_campaign_name`,
   `to_audience_id`, `to_campaign_name`, `actor`. Renders in the lead journey view with no new
   UI, and records *every* move, so "which list was it in before" is always answerable.
2. **Queryable origin — one new column.** `audience_response.original_audience_id`, written
   only on the **first** move and never overwritten. The timeline is not efficiently
   queryable; this keeps "leads that originally came from campaign X" a plain indexed SQL
   filter after a reorg.

### Migration `V502__add_original_audience_id_to_audience_response.sql`

```sql
ALTER TABLE audience_response ADD COLUMN IF NOT EXISTS original_audience_id TEXT;
CREATE INDEX IF NOT EXISTS idx_audience_response_original_audience_id
    ON audience_response(original_audience_id) WHERE original_audience_id IS NOT NULL;
COMMENT ON COLUMN audience_response.original_audience_id IS
    'The audience (lead list) this response was first created in. Set on the FIRST migration only, never overwritten. NULL = never migrated.';
```

No backfill: `NULL` correctly means "never moved, `audience_id` is still the original".

## B3. Skip rules (partial success)

A lead is **skipped**, not failed, when:

| Reason code | Condition |
|---|---|
| `ALREADY_IN_TARGET_LIST` | `audience_id` already equals the target — idempotent no-op |
| `DUPLICATE_USER_IN_TARGET` | `existsByAudienceIdAndUserId(targetAudienceId, userId)` — the one-response-per-person-per-list invariant the intake guards rely on (`AudienceService.java:1155`, `:1692`, `:4522`). Note this is a **code** guard, not a DB constraint — verified: no unique index on `(audience_id, user_id)` — so it must be checked explicitly. |
| `DUPLICATE_IN_TARGET` | `leadDeduplicationService.checkDuplicate(instituteId, targetAudienceId, email, phone, responseId)` returns `REJECT` under the institute's setting. `excludeResponseId` is passed so the row cannot match itself. |
| `LEAD_CONVERTED` | converted leads are not moved, mirroring `deleteLeads` |

`ALLOW_REASSIGN` is treated as "let it through" — the admin is acting deliberately, and the
repeat-lead counsellor/status rules are an *intake* concern, not a curation one.

Everything else migrates. Response:

```json
{ "migrated": 1187,
  "skipped": [ { "response_id": "r9",  "reason": "ALREADY_IN_TARGET_LIST" },
               { "response_id": "r14", "reason": "DUPLICATE_IN_TARGET",
                 "detail": "A lead with this phone number already exists in this lead list." } ] }
```

Shape follows `BulkSubmitLeadResponseDTO` / `BulkSubmitLeadResultItemDTO`, the existing
partial-success precedent.

## B4. Endpoint

Modelled directly on `POST /leads/delete`:

```
POST /admin-core-service/v1/audience/leads/migrate
{ "response_ids": [...], "target_audience_id": "...", "institute_id": "...", "scope": "RESPONSE" }
```

- `MigrateLeadsRequestDTO` — `@JsonNaming(SnakeCaseStrategy.class)`, same as `LeadDeleteRequestDTO`.
- `AudienceService.migrateLeads(MigrateLeadsRequestDTO, CustomUserDetails)`, `@Transactional`.
  One transaction: the moved rows are managed entities, so the field writes are dirty-checked and
  flushed at commit. This is NOT a per-chunk-commit bulk write path — the same limitation
  `deleteLeads` and `CounsellorReassignService` already have.
- **Authorization and tenancy reuse `resolveDeleteTargets`' pattern exactly**
  (`AudienceService.java:3607-3644`): require `instituteId`, `hasAdminRole(actor, instituteId)`
  → `ForbiddenException`, then resolve rows **through the institute** via
  `findAllByInstituteAndIds` and 404 on any count mismatch. Resolving by raw id would let an
  admin pass their own `institute_id` with another tenant's response ids.
- **Additionally (CONFIRMED)**: the target audience **must** belong to the same
  `institute_id` as the request. `resolveDeleteTargets` only proves the caller administers the
  institute they named and that the *source* rows belong to it — it says nothing about the
  destination. Without this check a well-formed request from a legitimate admin moves their own
  leads into another tenant's list. Resolve the target as
  `audienceRepository.findById(targetAudienceId)` and reject unless its `institute_id` equals
  `request.getInstituteId()`, with the same deliberately-vague `ResourceNotFoundException`
  ("Lead list not found") used elsewhere, so the response cannot be used to probe for the
  existence of another tenant's lists. This is a new check with no precedent in delete, and is
  the main security-relevant addition.
- `scope: "USER"` supported for symmetry (move every lead this person holds).

## B5. Frontend

- "Move to another list" in the bulk-actions dropdown alongside assign / unassign / delete
  (`campaign-users-table.tsx:~1330-1370`, mirrored in `recent-leads-page.tsx:1623-1642`),
  admin-gated via the existing `isAdminForInstitute`.
- New shared `components/shared/leads/migrate-leads-dialog.tsx`, following
  `delete-leads-dialog.tsx`: target-list picker (audiences for this institute, source excluded),
  confirmation count, then a result summary listing skipped leads with their reasons.
- New service `routes/audience-manager/list/-services/migrate-audience-leads.ts`, following
  `delete-audience-lead.ts:19-36`.
- On success invalidate `recent-leads`, `campaign-users`, `user-lead-profile`,
  `lead-profiles-batch` (same set as `handleStatusUpdated`).

---

## Open items to confirm during implementation

- Exact `name` source on `audience_response` for the ids endpoint (`parent_name` vs a
  full-name column) — to be read off the entity rather than assumed.
- Whether `sub_org_id` equality should be *required* between source and target lists or only
  warned on. Defaulting to required, as the stricter choice.
