# Meta Conversions API for CRM (Conversion Leads)

> Status: **Design / requirements**. Nothing in this doc is built yet.
> Last verified against Meta docs: 2026-10-27.

## 1. Goal

Today Vacademy **pulls** Meta Lead Ads leads into an audience (campaign) list. Meta never learns
which of those leads became real students. As a result, the ad sets optimise for *form fills*, not
*quality*.

The **Conversions API for CRM** (Meta calls the optimisation "Conversion Leads") lets us send every
lead's funnel stage back to Meta, for example *New → Contacted → Interested → Converted*. Meta
then:

- attributes each stage to the Page / form / campaign / ad that produced the lead (we do **not**
  send a campaign id — Meta resolves it from the lead id);
- lets the advertiser switch ad sets to the **Conversion Leads** performance goal, so delivery
  shifts towards people who look like leads that actually convert.

## 2. Meta's requirements (from current docs)

### 2.1 Eligibility

| Requirement | Value |
|---|---|
| Lead source | **Native Lead Ads (Instant Forms) only** — not website forms, not Google Ads |
| Prerequisite | Leads already flow Meta → CRM (we have this: Meta connector) |
| Volume | ≥ **200 leads / month** per advertiser |
| Upload frequency | At least **once per day** |
| Optimised stage | Must occur within **28 days** of lead creation |
| Optimised stage conversion rate | Between **1 % and 40 %** |
| Time to value | ~1 month (1–2 days validation + 2–4 weeks learning) |

### 2.2 Endpoint

```
POST https://graph.facebook.com/{API_VERSION}/{DATASET_ID}/events?access_token={TOKEN}
```

- `DATASET_ID` — the CRM dataset (Meta also calls it "CRM Pixel") from Events Manager.
- Keep `API_VERSION` current — deprecated versions cause discarded events. Our Lead Ads code
  uses `v21.0` (`MetaLeadAdsStrategy.GRAPH_API_BASE`); the CAPI client should share that constant.

### 2.3 Payload

```json
{
  "data": [
    {
      "event_name": "Interested",
      "event_time": 1761552000,
      "action_source": "system_generated",
      "user_data": {
        "lead_id": 1234567890123456
      },
      "custom_data": {
        "event_source": "crm",
        "lead_event_source": "Vacademy"
      }
    }
  ]
}
```

| Field | Rule |
|---|---|
| `event_name` | Free text = the CRM stage name. Send **every** stage the lead passes through, including the initial "raw lead" stage. If a lead reaches the final stage, all earlier stages must already have been sent. |
| `event_time` | Unix seconds when the stage changed. ≤ **7 days** old at send time and **after** the lead was created, otherwise discarded. |
| `action_source` | Must be `system_generated`. |
| `custom_data.event_source` | Must be `crm`. |
| `custom_data.lead_event_source` | Name of the CRM → `Vacademy`. |
| `user_data.lead_id` | The 15–17 digit Meta `leadgen_id`. Highest match quality. **If sent it must be valid, or the event is rejected.** |
| `user_data.em` / `ph` | Hashed email / phone. Fallback when we don't have a `lead_id`. Hashing rules follow general CAPI customer-information parameters (normalise, then SHA-256) — confirm against Meta's customer-information-parameters page at build time. |
| `partner_agent` | Only for Option B (MBE) — a string Meta assigns to the partner. |

At least one customer identifier is required.

## 3. Current system — what we have and what's missing

### 3.1 What we have

| Piece | Where | Notes |
|---|---|---|
| Meta connector (Page + form → audience) | `form_webhook_connector` / `FormWebhookConnector.java`, vendor `META_LEAD_ADS` | Stores encrypted **Page** token (`oauth_access_token_enc`), `platform_page_id`, `platform_form_id`. |
| Lead intake (webhook + poller) | `MetaLeadAdsStrategy`, `AdPlatformWebhookService`, `MetaLeadPollingJob` | Each lead fetched from Graph by `leadgen_id`. |
| Lead row | `audience_response` | `source_type = 'META_LEAD_ADS'`, `source_id = 'META_LEAD_ADS_WEBHOOK'`, `lead_status_id`. |
| Status catalog | `lead_status` (`status_key`, `label`, per institute) | Stage names to send as `event_name`. |
| Status change, single path | `LeadStatusService.changeLeadStatus` (manual, bulk via `BulkLeadStatusService`, automatic) | Writes `lead_status_history`, emits `LEAD_STATUS_CHANGED`. |
| Profile → responses mirror | `LeadStatusMirrorService.syncResponsesLeadStatus` | Also writes `lead_status_history` (source `MANUAL`). |
| Token encryption | `TokenEncryptionService` | Reuse for the CAPI token. |
| Scheduled jobs with ShedLock | `MetaLeadPollingJob`, `MetaTokenRefreshJob`, `ShedLockConfig` | Pattern for the sender job. |

**Key point:** every status change already lands in `lead_status_history` with `changed_at`. That
table is a ready-made outbox — the sender can read from it instead of hooking into every write
path.

### 3.2 Gaps

1. **`leadgen_id` is not persisted.** `AdPlatformWebhookService` passes it as metadata
   `platform_lead_id`. `AudienceService.submitLeadFromFormWebhook` only uses it to synthesise a
   placeholder email, then drops it. Without it we can only match on hashed email/phone, which
   matches less often.
2. **Repeat submissions lose their lead id.** If the same person submits again into the same
   audience, `existsByAudienceIdAndUserId` short-circuits and no new row is created. The second
   `leadgen_id` is never recorded.
3. **No initial-stage history.** A webhook lead is created with `lead_status_id = null` (unless a
   default applies), and no `lead_status_history` row. Meta wants the raw-lead stage too.
4. **No dataset id / CAPI token storage.** The stored Page token has `leads_retrieval`-type
   access only. It cannot post events to a dataset.
5. **No sender, no send log, no admin UI** for enabling CAPI or mapping stages.

## 4. Changes common to both options

### 4.1 Schema (one Flyway migration, next free `V###`)

```sql
-- Meta leadgen_id of the Instant Form submission that created this lead.
ALTER TABLE audience_response ADD COLUMN platform_lead_id VARCHAR(32);
CREATE INDEX idx_audience_response_platform_lead_id
    ON audience_response (platform_lead_id) WHERE platform_lead_id IS NOT NULL;

-- Per-connector CAPI config (Option A fills these by paste, Option B via MBE onboarding).
ALTER TABLE form_webhook_connector
    ADD COLUMN capi_enabled          BOOLEAN DEFAULT FALSE,
    ADD COLUMN capi_dataset_id       VARCHAR(64),
    ADD COLUMN capi_access_token_enc TEXT,
    ADD COLUMN capi_business_id      VARCHAR(64),   -- Option B
    ADD COLUMN capi_status           VARCHAR(30),   -- ACTIVE / TOKEN_INVALID / DISABLED
    ADD COLUMN capi_status_detail    TEXT,
    ADD COLUMN capi_last_sent_at     TIMESTAMP;

-- One row per (lead, stage) sent/attempted — idempotency + audit + retries.
CREATE TABLE meta_capi_event_log (
    id                    VARCHAR(255) PRIMARY KEY,
    institute_id          VARCHAR(255) NOT NULL,
    connector_id          VARCHAR(255) NOT NULL,
    audience_response_id  VARCHAR(255) NOT NULL,
    lead_status_history_id VARCHAR(255),           -- null for the synthetic initial stage
    event_name            VARCHAR(255) NOT NULL,
    event_time            TIMESTAMP NOT NULL,
    match_key             VARCHAR(20) NOT NULL,    -- LEAD_ID / EMAIL_PHONE
    status                VARCHAR(20) NOT NULL,    -- PENDING / SENT / FAILED / SKIPPED
    attempts              INT DEFAULT 0,
    last_error            TEXT,
    fbtrace_id            VARCHAR(100),
    created_at            TIMESTAMP DEFAULT now(),
    sent_at               TIMESTAMP,
    UNIQUE (audience_response_id, event_name)
);
```

Unique on `(audience_response_id, event_name)` ensures each stage goes to Meta once per lead, even
when a lead moves back and forth between statuses.

### 4.2 Persist the lead id at intake

- In `AudienceService.submitLeadFromFormWebhook`, read `metadata.platform_lead_id` and set
  `audience_response.platform_lead_id` when `source_type = 'META_LEAD_ADS'`.
- Repeat submission (existing row, gap 2): stamp the new `leadgen_id` only if the column is
  empty. Do not overwrite an existing one — the first lead id is the one Meta attributes.
- Optional backfill: the Graph `/{form_id}/leads` edge returns the last 90 days. A one-off job could
  match on email/phone and fill `platform_lead_id` for recent leads. Older leads fall back to
  hashed email/phone.

### 4.3 Stage mapping

- Default: `event_name = lead_status.label` for the status the lead moved to.
- Initial stage: a synthetic `event_name = "Lead"` sent for every eligible lead at creation
  (covers gap 3 without touching intake status logic).
- Per-institute exclusions: let the admin untick statuses that shouldn't be sent (e.g. internal
  "Duplicate"). Store as JSON on the connector (`capi_stage_config_json`) or reuse `lead_status`
  with a new flag — decide at build time.
- Funnel order is configured by the advertiser in Events Manager ("Configure Sales Funnel"), not
  by us.
- **Rule from Meta:** if a lead jumps straight to Converted, the earlier stages must have been
  sent. The sender should backfill missing earlier stages from `lead_status_history`. If a stage
  was skipped in the CRM, send only what actually happened, with the history timestamps.

### 4.4 Sender job — `MetaCapiSenderJob`

- `@Scheduled` every 15 min + `@SchedulerLock` (same pattern as `MetaLeadPollingJob`).
- For each connector with `capi_enabled = true`:
  1. Select `lead_status_history` rows where `changed_at > now() - 7 days` for responses with
     `source_type = 'META_LEAD_ADS'` in the connector's audience, not yet in
     `meta_capi_event_log`. Plus the synthetic "Lead" stage for new responses.
  2. Skip if `event_time` would be before the lead's `created_at`.
  3. Build the payload: `lead_id` when `platform_lead_id` is present, else `em`/`ph` hashed. Never
     send both a guessed `lead_id` and fallback — a bad `lead_id` rejects the event.
  4. POST in batches (CAPI accepts up to 1000 events per request). Write `SENT` / `FAILED` +
     `fbtrace_id` to `meta_capi_event_log`.
  5. Retry `FAILED` up to N times while still inside the 7-day window, then mark `SKIPPED`.
  6. On auth errors (190 / 10 / 200 codes), set `capi_status = TOKEN_INVALID` and stop for this
     connector. Surface it in the connector card, same as `connection_status` today.
- Why a job and not an inline call in `changeLeadStatus`: it keeps the status write fast and
  transactional, it covers the mirror path for free, and it satisfies Meta's "at least daily"
  rule even if a burst fails.

### 4.5 Admin UI (Meta connector card)

- "Optimise ads with conversion data" section: enable toggle, status, last sent, count sent /
  failed (7 days), stage checklist.
- Option A: Dataset ID + token fields. Option B: "Connect with Meta" button.
- Show the eligibility hints (≥ 200 leads / month, Instant Forms only) so admins aren't surprised
  when Meta doesn't unlock the goal.

### 4.6 API (admin-core)

| Method | Path | Purpose |
|---|---|---|
| `PUT` | `/admin-core-service/v1/oauth/meta/connectors/{id}/capi` | Save dataset id / token / enabled / stages. |
| `POST` | `/admin-core-service/v1/oauth/meta/connectors/{id}/capi/test` | Send one test event using a `test_event_code` (Events Manager → Test Events). |
| `GET` | `/admin-core-service/v1/oauth/meta/connectors/{id}/capi/log` | Recent `meta_capi_event_log` rows for the card. |

Tenant scoping should follow the existing checks in `MetaOAuthController` (connector must belong
to the caller's institute).

## 5. Option A — Admin pastes Dataset ID + token (recommended first)

### 5.1 Manual setup by the institute (one-time, in Meta)

Done by someone with **Meta Business Suite admin** access:

1. *(Already done)* Meta connector in Vacademy connected to the Page/forms.
2. **Events Manager → Connect data sources → CRM** → create a CRM dataset (or choose one). Copy
   its **Dataset ID**.
3. Dataset **Settings → Conversions API → Generate access token**. Copy the token.
4. Paste both into Vacademy → Meta connector → "Optimise ads with conversion data". Enable.
5. *(Optional)* Events Manager → **Test Events** → copy the test code → Vacademy "Send test event".
6. Wait ~1 day until events show and the "Send a CRM event" step gets a green check.
7. Events Manager → **Configure Sales Funnel**: order the stages and pick the one to optimise for.
8. Ads Manager → lead-ad campaigns → performance goal **Conversion Leads**, using this dataset.
9. Don't switch datasets afterwards — it restarts learning.

**Page side:** no extra Page step was found in Meta's docs. The Page link comes from the existing
Lead Ads integration and the `lead_id`. Keep Lead Access / CRM access granted for our app in Lead
Access Manager. Verify on the first live institute that Events Manager doesn't ask for a Page.

### 5.2 What we build

Everything in §4, with config filled by the PUT endpoint. The token is stored encrypted via
`TokenEncryptionService` in `capi_access_token_enc`.

### 5.3 Pros / cons

| Pros | Cons |
|---|---|
| No Meta App Review, no partner allow-listing | Admin must do Events Manager steps by hand |
| Ship in ~1–2 sprints | Token pasted by humans: typos, wrong dataset |
| Same code path later reused by Option B | Token can be revoked/rotated outside our view → handled by `TOKEN_INVALID` status |

## 6. Option B — Meta Business Extension (MBE) onboarding

### 6.1 Flow

1. Admin clicks **Connect with Meta** on the connector card.
2. The MBE popup (channel `CONVERSIONS_API`) lets the admin pick business + dataset and grants
   access.
3. Meta calls our onboarding webhook. We exchange the result for a **System User access token**
   with one extra API call.
4. Store `external_business_id`, `pixel_id` (dataset id), `business_id`, and the system user token on
   the connector → same sender as §4.4. Add `partner_agent` to every event.

### 6.2 What Meta requires from us (partner side)

- App Review with **Advanced Access** for `ads_management`, `ads_read`, `business_management`,
  `pages_show_list`, `pages_read_engagement`. Our Lead Ads app already holds some Page
  permissions — check what's granted before submitting.
- **Marketing API Access Tier** — Full Access needs ~500 Marketing API calls in 15 days.
- `manage_business_extension` — **private**. A Meta representative must allow-list our app.
- MBE integration approval from Meta.

### 6.3 What the institute still does by hand

Per Meta's partner guide, even with MBE the advertiser still:

- creates the CRM dataset in Events Manager;
- configures the sales funnel once events arrive;
- switches campaigns to Conversion Leads in Ads Manager.

MBE removes the copy-paste of the dataset id and token. It does not remove all Meta-side setup.

### 6.4 Pros / cons

| Pros | Cons |
|---|---|
| One-click connect, no token copy-paste | Needs a Meta rep + several reviews: weeks to months, uncertain |
| System user token from Meta, fewer human errors | More OAuth/webhook surface to maintain |
| Looks like a first-class integration | Advertiser still does dataset + funnel + campaign steps |

## 7. Recommendation

1. Build **Option A** now (§4 + §5). Pilot it with one institute that runs Instant Forms at ≥ 200
   leads/month.
2. Start the Meta partner conversation for MBE in parallel. When approved, add **Option B** as a
   second way to fill the same `capi_*` columns. Sender, log and UI stay the same.

## 8. Edge cases & rules

| Case | Handling |
|---|---|
| Lead not from Instant Forms (`source_type != 'META_LEAD_ADS'`) | Not sent. |
| Old lead without `platform_lead_id` | Send hashed email/phone only. Skip if the email is a synthesised placeholder (`PlaceholderEmailService`) and there is no phone. |
| Status change > 7 days ago (e.g. CAPI enabled later) | Not sendable. Starts from enable date. |
| Status moved back (Converted → Contacted) | Already-sent stages aren't re-sent (unique key). How Meta treats a lead that goes backwards is not documented — verify in the pilot. |
| Lead deleted / soft-deleted | Stop sending future stages. Already-sent events stay. |
| Same person, two audiences | Each `audience_response` is its own lead with its own `leadgen_id`. |
| Mirror path (profile status → all responses) | Covered — it writes `lead_status_history`. |
| PII | Only hashed email/phone leave the system. `lead_id` is Meta's own id. Log payloads without raw PII. |

## 9. Open questions

1. Per-connector config vs per-institute? One institute may run several Pages/forms on one dataset.
   Proposal: config on the connector, with the UI offering "use same dataset for all Meta
   connectors".
2. Stage names: send `label` (human, editable) or `status_key` (stable)? Renaming a label
   mid-campaign creates a "new" stage in Meta. Leaning `status_key` with a display mapping.
3. Backfill of `platform_lead_id` for the last 90 days — worth it for the pilot institute?
4. Should "Enrolled" (payment / enrolment, not just CRM status) be sent as its own stage?
   Enrolled leads are pinned to `CONVERTED`, so it probably maps already.

## 10. References

- [Conversion Leads integration (overview, eligibility)](https://developers.facebook.com/docs/marketing-api/conversions-api/conversion-leads-integration)
- [Payload specification](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/payload-specification.md)
- [Implementing the CRM integration (endpoint, token)](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/crm-integration/3-implementing-the-crm-integration)
- [Conversions API for CRM — Integrate as a Platform (MBE, permissions)](https://developers.facebook.com/documentation/ads-commerce/conversions-api/guides/conversions-api-crm-for-platforms)
