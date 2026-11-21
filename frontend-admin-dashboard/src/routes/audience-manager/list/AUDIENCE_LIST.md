# Audience List — Current Implementation

A technical reference for how the **Audience List** feature works today in `frontend-admin-dashboard`. The feature lets an institute admin create *audience campaigns* (forms / capture surfaces), share them, collect *leads / responses*, and message respondents.

> Root: [src/routes/audience-manager/list/](src/routes/audience-manager/list/)

---

## 1. Overview

| Aspect | Detail |
|---|---|
| Feature name in UI | "Manage Audience Lists" (label is terminology-driven; see `OtherTerms.AudienceList`) |
| Domain entities | **Campaign / Audience** (the form/list itself) and **Lead / Response** (a submission to a campaign) |
| Primary route | `/audience-manager/list/` |
| Sub-route | `/audience-manager/list/campaign-users/` (responses for one campaign) |
| Add-response route | `/audience-manager/list/campaign-users/add/` |
| Backend service | `admin-core-service` — `/v1/audience/*` (auth) and `/open/v1/audience/*` (public submit) |

Conceptually the feature is split into two screens:

1. **Campaigns list** — cards of all campaigns with create/edit/delete + utility actions (API integration, embed, send message, bulk import).
2. **Campaign users (leads) table** — paginated table of submissions for a single campaign, with date filtering, CSV export, bulk import, send-message and add-response.

---

## 2. File Structure

```
src/routes/audience-manager/list/
├── index.tsx                          # Route definition
├── index.lazy.tsx                     # Page component (AudienceManagerListPage)
├── -components/
│   ├── audience-invite/
│   │   ├── audience-invite.tsx                    # Campaigns list + filters
│   │   └── audience-campaign-card-menu-options.tsx# Per-campaign 3-dot menu
│   ├── create-campaign-dialog/
│   │   ├── CreateCampaignDialog.tsx               # Modal wrapper
│   │   ├── CreateCampaignForm.tsx                 # Create / edit form
│   │   ├── CampaignCustomFieldsCard.tsx
│   │   ├── CampaignTypeDropdown.tsx
│   │   ├── StatusDropdown.tsx
│   │   ├── CampaignLink.tsx
│   │   └── MultiEmailInput.tsx
│   ├── campaign-users/
│   │   ├── campaign-users-table.tsx               # Leads table
│   │   ├── LeadBulkImportDialog.tsx               # CSV bulk import
│   │   ├── SendMessageDialog.tsx                  # Multi-channel messaging
│   │   └── CommunicationHistory.tsx
│   ├── api-integration-dialog/
│   │   └── ApiIntegrationDialog.tsx               # Endpoint + cURL guide
│   └── embed-code-dialog/
│       └── EmbedCodeDialog.tsx                    # HTML/JS embed snippets
├── -context/
│   └── useAudienceInviteFormContext.tsx           # Re-export of InviteFormProvider
├── -hooks/
│   ├── useCampaignsList.ts
│   ├── useCampaignUsers.ts
│   ├── useGetCampaignById.ts
│   ├── useCustomFieldSetup.ts
│   ├── useAudienceCampaignForm.ts
│   ├── useCreateAudienceCampaign.ts
│   └── useUpdateAudienceCampaign.ts
├── -schema/
│   └── AudienceCampaignSchema.ts                  # Zod schema + types
├── -services/
│   ├── get-campaigns-list.ts
│   ├── get-campaign-users.ts
│   ├── get-campaign-by-id.ts
│   ├── get-custom-field-setup.ts
│   ├── get-recent-leads.ts
│   ├── create-audience-campaign.ts                # POST + PUT
│   ├── delete-audience-campaign.ts
│   ├── submit-audience-lead.ts                    # Single submit + cURL gen
│   ├── bulk-submit-audience-lead.ts
│   ├── delete-audience-lead.ts
│   └── send-audience-message.ts
├── -utils/
│   ├── getCampaignCustomFields.ts                 # Field fetching + aliasing
│   ├── createCampaignLink.ts                      # Shareable learner-portal link
│   └── lead-bulk-import-utils.ts                  # CSV parse/validate
└── campaign-users/
    ├── index.tsx                                  # Leads listing route
    └── add/
        └── index.tsx                              # Add response form route
```

---

## 3. Routing

Defined with TanStack Router file-based routes.

| File | Path | Purpose |
|---|---|---|
| [index.tsx](src/routes/audience-manager/list/index.tsx) | `/audience-manager/list/` | Route entry |
| [index.lazy.tsx](src/routes/audience-manager/list/index.lazy.tsx) | (lazy component) | Renders `AudienceManagerListPage` |
| [campaign-users/index.tsx](src/routes/audience-manager/list/campaign-users/index.tsx) | `/audience-manager/list/campaign-users/` | Leads table; reads `campaignId`, `campaignName`, `customFields`, `campaignType` from search params |
| [campaign-users/add/index.tsx](src/routes/audience-manager/list/campaign-users/add/index.tsx) | `/audience-manager/list/campaign-users/add/` | Add-response form |

The page entrypoint at [index.lazy.tsx:15-29](src/routes/audience-manager/list/index.lazy.tsx#L15-L29) sets the nav heading via `useNavHeadingStore` and wraps `<AudienceInvite />` in `AudienceInviteFormProvider` and `LayoutContainer`.

---

## 4. Data Layer

### 4.1 API endpoints (from [src/constants/urls.ts:73-93](src/constants/urls.ts#L73-L93))

| Constant | Method | URL | Used by |
|---|---|---|---|
| `AUDIENCE_CAMPAIGN` | POST / PUT / DELETE | `/admin-core-service/v1/audience/campaign[/{instituteId}/{audienceId}]` | create-, update-, delete-audience-campaign |
| `AUDIENCE_CAMPAIGNS_LIST` | POST | `/admin-core-service/v1/audience/campaigns` | get-campaigns-list |
| `GET_CAMPAIGN_USERS` | POST | `/admin-core-service/v1/audience/leads` | get-campaign-users |
| `DELETE_AUDIENCE_LEAD(responseId)` | DELETE | `/admin-core-service/v1/audience/lead/{responseId}` | delete-audience-lead |
| `SUBMIT_AUDIENCE_LEAD_URL` | POST | `/admin-core-service/open/v1/audience/lead/submit` | submit-audience-lead (open / public) |
| `BULK_SUBMIT_AUDIENCE_LEAD` | POST | `/admin-core-service/open/v1/audience/lead/bulk-submit` | bulk-submit-audience-lead |
| `GET_CUSTOM_FIELD_SETUP` | GET | `/admin-core-service/common/custom-fields/setup` | get-custom-field-setup |
| (open campaign) | GET | `/admin-core-service/open/v1/audience/campaign/{instituteId}/{audienceId}` | get-campaign-by-id |
| (send) | POST | `/admin-core-service/v1/audience/campaign/{audienceId}/send` | send-audience-message |
| (history) | GET | `/admin-core-service/v1/audience/campaign/{audienceId}/communications` | send-audience-message |

> All non-`open/*` endpoints go through `authenticatedAxiosInstance`; `open/*` endpoints accept anonymous calls so the form can be embedded externally.

### 4.2 React Query hooks

| Hook | Query key | Notes |
|---|---|---|
| `useCampaignsList` | `['campaignsList', institute_id, page, size, name, status, type]` | `staleTime: 60s`. Server fetch size = 200, then client-side filtered & paginated (5 cards / page) |
| `useCampaignUsers` | `['campaignUsers', audience_id, page, size, sort_by, sort_dir, source_type, source_id, from, to]` | Page size = 10 |
| `useGetCampaignById` | `['campaign', instituteId, audienceId]` | `staleTime: 0`, `gcTime: 0` — always fresh on edit-open |
| `useCustomFieldSetup` | `['customFieldSetup', instituteId]` | `staleTime: 5min` |

### 4.3 Mutations

| Hook | Action | Invalidates |
|---|---|---|
| `useCreateAudienceCampaign` | POST `AUDIENCE_CAMPAIGN` | `['audienceList']`, `['audiences']`, `['campaignsList']` |
| `useUpdateAudienceCampaign` | PUT `AUDIENCE_CAMPAIGN/{id}` | `['campaignsList']` |
| (inline in menu) | DELETE `AUDIENCE_CAMPAIGN/{instituteId}/{audienceId}` | `['campaignsList']` |
| (inline in add page) | POST `SUBMIT_AUDIENCE_LEAD_URL` | `['campaignUsers']` |
| (bulk import) | POST `BULK_SUBMIT_AUDIENCE_LEAD` | `['campaignUsers']` |
| (send message) | POST `…/{audienceId}/send` | — |

### 4.4 Stores & context

- `useNavHeadingStore` — sets the page header.
- `useInstituteDetailsStore` — current institute id, used in every payload.
- `useStudentSidebar` — opens the lead profile drawer when a row is clicked.
- `AudienceInviteFormProvider` — shared form state, re-exported from `manage-students/InviteFormProvider`.

---

## 5. Form Schema

Defined in [`-schema/AudienceCampaignSchema.ts`](src/routes/audience-manager/list/-schema/AudienceCampaignSchema.ts). Validated with Zod via `zodResolver` inside `useAudienceCampaignForm`.

Fields:

- `campaign_name` — string, min 3 chars
- `campaign_type` — uppercase string (selectable from `CampaignTypeDropdown`)
- `description`, `campaign_objective` — optional strings
- `start_date_local`, `end_date_local` — required ISO dates; cross-field validated
- `status` — `ACTIVE | INACTIVE | DRAFT`
- `custom_fields` — array of `{ id, name, key, type, isRequired, order, options?, status }`
- `institute_custom_fields` — JSON-stringified custom field definitions
- `json_web_metadata` — optional string (used by embed customization)
- `send_respondent_email`, `to_notify` — email notification config
- `campaign_image` — optional URL
- `postSubmitConfiguration` — the thank-you screen / redirect (see §13)

---

## 6. UI Components & Roles

### Campaigns list — `AudienceInvite` ([audience-invite.tsx:37-452](src/routes/audience-manager/list/-components/audience-invite/audience-invite.tsx#L37-L452))

Top-level layout for the list screen.

- Search box (campaign name).
- Status filter tabs: `ALL | ACTIVE | INACTIVE | DRAFT`.
- "Add Audience List" button → opens `CreateCampaignDialog`.
- Renders campaign cards: name, type badge, status badge, start/end dates, description (2-line clamp), objective, shareable link (only when `ACTIVE`), `Add Response`/`API`/`Embed` quick actions, and a 3-dot menu.
- Pagination component below cards.

### Per-card menu — `AudienceCampaignCardMenuOptions` ([audience-campaign-card-menu-options.tsx:40-246](src/routes/audience-manager/list/-components/audience-invite/audience-campaign-card-menu-options.tsx#L40-L246))

Dropdown actions:

| Action | Behavior |
|---|---|
| Edit | Opens `CreateCampaignDialog` pre-filled via `useGetCampaignById` |
| Add Response | Navigates to `/audience-manager/list/campaign-users/add` with `campaignId` |
| Bulk Import CSV | Opens `LeadBulkImportDialog` |
| Send Message | Opens `SendMessageDialog` |
| API Integration | Opens `ApiIntegrationDialog` (endpoint + cURL + docs) |
| Embed Code | Opens `EmbedCodeDialog` (button-popup and direct-link snippets) |
| Delete | Confirmation dialog → DELETE → invalidates `campaignsList` |

### Create / Edit form — `CreateCampaignForm`

Driven by `useAudienceCampaignForm` (RHF + Zod). Loads custom fields via `getCampaignCustomFieldsAsync()` (or from `useGetCampaignById` when editing). Submits through `useCreateAudienceCampaign` or `useUpdateAudienceCampaign` depending on mode.

Below the custom-fields card it renders **Form Heading & Text** (`components/audience/FormTextEditor.tsx`), then **Post Submit Configuration** (§13) — the audience-list twin of the enroll invite's "Post Form Fill Configuration" card.

**Form Heading & Text** edits the words at the top of the public form: the page heading (blank = the list's own name; rich text via `RichTextEditor` in `minimalToolbar` mode) and the form card's heading + sub-heading (sub-heading is rich text too), each block with its own left / center / right alignment (`headingAlign`, `formHeaderAlign`). It is always shown, unlike the **Form Appearance** card, which only appears once an institute turns it on in Settings → Lead Settings → Forms. Both cards edit the same `formAppearance` value inside `setting_json`, so there is one save path, and the heading fields live only in Form Heading & Text, never in both cards. `headline` and `formSubtitle` hold plain text OR sanitized HTML: values saved before rich text existed still render as plain text, and an emptied editor (`<p></p>`) falls back to the default wording. Both are capped at 5,000 chars, not the 500 used for labels, so a cut never lands inside a tag. Any new key must be added in four places: the admin service, the learner `form-appearance.ts` (the two DEFAULT objects must match), **and** `formAppearanceSchema` in `-schema/AudienceCampaignSchema.ts`. That last one is a strict `z.object`, so a key missing there is silently dropped on save.

### Leads table — `CampaignUsersTable`

- Reads `campaignId`, `campaignName`, `customFields`, `campaignType` from URL search params.
- Fetches with `useCampaignUsers`.
- Dynamic columns: S.No → custom-field columns → submitted date → details.
- Date range filter (`submitted_from_local` / `submitted_to_local`).
- CSV download / bulk import / send message / delete-row.
- Clicking a row opens `StudentSidebar` (from manage-students module) with the lead's profile.

### Add-response page

- Custom fields fetched from URL search-param JSON or `GET custom-fields/feature-fields?type=AUDIENCE_FORM&typeId={campaignId}` as fallback.
- Renders dynamic inputs via `CustomFieldRenderer`.
- Extracts `email`, `phone`, `full_name` from custom field values to build `SubmitLeadRequest`.
- POSTs to `SUBMIT_AUDIENCE_LEAD_URL`, invalidates `campaignUsers`, navigates back.

### Bulk import — `LeadBulkImportDialog`

Three-step CSV flow:

1. Download generated template (`generateCsvTemplate` from custom fields).
2. Upload + parse with `papaparse`; validate headers via `buildHeaderToFieldIdMap`.
3. Preview rows with row-level validation (`validateRow`, `getMissingMandatoryColumns`); submit via `BULK_SUBMIT_AUDIENCE_LEAD`.

### Messaging — `SendMessageDialog`

Channels: WhatsApp (templated), Email, Push, System Alert. Supports template variables and audience filters; posts to `…/{audienceId}/send`. Past communications loaded via `CommunicationHistory`.

### Integration helpers

- **ApiIntegrationDialog** — shows `SUBMIT_AUDIENCE_LEAD_URL`, request shape, response shape, and `generateCurlCommand()` from `submit-audience-lead.ts`.
- **EmbedCodeDialog** — produces HTML/JS embed snippets (button-with-popup or direct-link variants), backed by `createCampaignLink()` to point at the learner portal's `/audience-response` (or `/enquiry-response` for enquiry-type campaigns).

---

## 7. Key Utilities

| Utility | Purpose |
|---|---|
| `getCampaignCustomFieldsAsync` ([getCampaignCustomFields.ts](src/routes/audience-manager/list/-utils/getCampaignCustomFields.ts)) | Async fetch + dedupe of custom fields; falls back to `getDefaultCampaignFields()` (Full Name / Email / Phone). Handles aliasing — e.g. `full_name` ↔ `name`, `phone` ↔ `phone_number` |
| `createCampaignLink` ([createCampaignLink.ts](src/routes/audience-manager/list/-utils/createCampaignLink.ts)) | Builds shareable learner-portal URL with encoded institute & campaign IDs; `/audience-response` or `/enquiry-response` |
| `lead-bulk-import-utils` ([lead-bulk-import-utils.ts](src/routes/audience-manager/list/-utils/lead-bulk-import-utils.ts)) | CSV parse / template gen / header-to-field mapping / row validation |
| `generateCurlCommand` (in `submit-audience-lead.ts`) | Builds copy-paste cURL for ApiIntegrationDialog |

---

## 8. End-to-End User Flows

### A. Browse campaigns

1. Visit `/audience-manager/list/`.
2. `useCampaignsList` POSTs to `AUDIENCE_CAMPAIGNS_LIST` (server fetches up to 200).
3. Client-side filter (search + status) + paginate (5 / page).
4. Cards render with quick actions.

### B. Create or edit a campaign

1. Click **Add Audience List** (or Edit on a card).
2. `CreateCampaignDialog` opens; on edit, `useGetCampaignById` hydrates the form.
3. User fills metadata + custom fields; Zod validates.
4. Optionally edits **Post Submit Configuration** — prefilled from the institute default on create, from the campaign's own `setting_json` on edit.
5. Submit → `useCreateAudienceCampaign` or `useUpdateAudienceCampaign` → list invalidated.

### C. View / collect responses

1. Card → **Add Response** navigates to `…/campaign-users/add?campaignId=…` with custom-field metadata in search params.
2. Or open `…/campaign-users?campaignId=…` to view existing leads (`useCampaignUsers`).
3. Row click → `StudentSidebar` with lead profile.

### D. Bulk import leads (CSV)

1. Card menu → **Bulk Import CSV**.
2. Download template → fill → upload → preview → submit → `BULK_SUBMIT_AUDIENCE_LEAD`.

### E. Message respondents

1. Card menu → **Send Message** → choose channel + template → POST `…/{audienceId}/send`.
2. View past sends in `CommunicationHistory`.

### F. Integrate externally

- **API Integration** dialog: shows endpoint + sample payload + cURL.
- **Embed Code** dialog: HTML/JS to drop into a website (uses public `audience-response` page).

---

## 9. External Dependencies

- **TanStack Router** — file-based routing + typed search params.
- **TanStack React Query** — fetching, mutations, cache invalidation.
- **React Hook Form + Zod** — form state and validation.
- **PapaParse** — CSV parsing for bulk import.
- **Sonner** — toast notifications.
- **react-helmet** — page metadata.
- **Lucide / Phosphor Icons** — icons.
- **Internal**: `MyTable`, `MyPagination`, `MyButton` (design system); `CustomFieldRenderer`, `StudentSidebar` (manage-students); `DashboardLoader`; `authenticatedAxiosInstance`.

---

## 10. Quick File Reference

| Concern | Path |
|---|---|
| Page entry | [index.lazy.tsx](src/routes/audience-manager/list/index.lazy.tsx) |
| List view | [audience-invite.tsx](src/routes/audience-manager/list/-components/audience-invite/audience-invite.tsx) |
| Card menu | [audience-campaign-card-menu-options.tsx](src/routes/audience-manager/list/-components/audience-invite/audience-campaign-card-menu-options.tsx) |
| Create/edit form | [CreateCampaignForm.tsx](src/routes/audience-manager/list/-components/create-campaign-dialog/CreateCampaignForm.tsx) |
| Leads table | [campaign-users-table.tsx](src/routes/audience-manager/list/-components/campaign-users/campaign-users-table.tsx) |
| Add response | [campaign-users/add/index.tsx](src/routes/audience-manager/list/campaign-users/add/index.tsx) |
| Bulk import | [LeadBulkImportDialog.tsx](src/routes/audience-manager/list/-components/campaign-users/LeadBulkImportDialog.tsx) |
| Send message | [SendMessageDialog.tsx](src/routes/audience-manager/list/-components/campaign-users/SendMessageDialog.tsx) |
| API integration | [ApiIntegrationDialog.tsx](src/routes/audience-manager/list/-components/api-integration-dialog/ApiIntegrationDialog.tsx) |
| Embed code | [EmbedCodeDialog.tsx](src/routes/audience-manager/list/-components/embed-code-dialog/EmbedCodeDialog.tsx) |
| Schema | [AudienceCampaignSchema.ts](src/routes/audience-manager/list/-schema/AudienceCampaignSchema.ts) |
| URL constants | [src/constants/urls.ts](src/constants/urls.ts) (lines 73–93) |

---

## 11. Lead Scoring & Tier (Cold / Warm / Hot)

Each lead surfaced in the audience-list ecosystem can carry a **score (0–100)** and a **tier** (`HOT`, `WARM`, `COLD`). The score is **computed entirely on the backend**; the frontend only fetches it, renders the badge, and lets an admin manually override the tier.

### 11.1 Where the score comes from

- The score is **not computed on the client**. The backend persists a `UserLeadProfile` per `(user_id, institute_id)` and recomputes the score on its own schedule (new submissions, timeline events, profile updates). A `last_calculated_at` timestamp is exposed.
- The frontend retrieves it through:
  - `GET /admin-core-service/v1/audience/user-lead-profile` — single profile (`GET_USER_LEAD_PROFILE`).
  - `POST /admin-core-service/v1/audience/user-lead-profiles/batch` — batch fetch by user-id list (`GET_USER_LEAD_PROFILES_BATCH`). Used by the campaign-users table to fill badges row-by-row via the `useLeadProfiles()` hook.

### 11.2 `UserLeadProfile` shape (relevant fields)

```ts
{
  user_id: string
  institute_id: string
  best_score: number              // 0–100, backend-computed
  best_score_response_id: string | null
  lead_tier: 'HOT' | 'WARM' | 'COLD' | null   // explicit tier (manual override or backend-set)
  conversion_status: 'LEAD' | 'CONVERTED' | 'LOST'
  converted_at: string | null
  campaign_count: number
  best_source_type: string | null              // e.g. 'WALK_IN', 'GOOGLE_ADS'
  total_timeline_events: number                // engagement signal
  demo_login_count: number
  demo_attendance_count: number
  last_activity_at: string | null
  last_calculated_at: string | null            // when score was last recomputed
  assigned_counselor_id: string | null
  assigned_counselor_name: string | null
}
```

### 11.3 Score → Tier thresholds (display-only)

`LeadScoreBadge` ([src/components/shared/lead-score-badge.tsx](src/components/shared/lead-score-badge.tsx)) maps the numeric score to a tier badge. These thresholds are **only used for rendering** — they are not the source of truth, and they kick in only when `lead_tier` itself is null.

| Score range | Tier label | Badge color |
|---|---|---|
| `>= 80`     | **HOT**  | red — `bg-red-100 text-red-700` |
| `>= 50 && < 80` | **WARM** | amber — `bg-amber-100 text-amber-700` |
| `< 50`      | **COLD** | blue — `bg-blue-100 text-blue-700` |

Resolution order on a row: if `lead_tier` is present, it wins; otherwise the badge falls back to inferring the tier from `best_score` using the table above.

### 11.4 How the percentage is calculated (backend, configured by admins)

Although the math runs server-side, the **weights and inputs are fully configured from the admin UI** at `Settings → Lead Settings`:

> [src/routes/settings/-components/LeadSettings.tsx](src/routes/settings/-components/LeadSettings.tsx) — backed by `useLeadSettings()` ([src/hooks/use-lead-settings.ts](src/hooks/use-lead-settings.ts)), persisted under the institute setting key `LEAD_SETTING` via `GET_INSITITUTE_SETTINGS` (GET) and the `/save-setting` variant (POST).

The composite score is a **weighted average** of four components. The form **enforces that the four weights sum to exactly 100** before saving.

| Component | Default weight | What feeds it |
|---|---|---|
| **Source Quality** | 25 % | Lead's `best_source_type` — e.g. Walk-in scores higher than Google Ads, manual entry lowest. |
| **Profile Completeness** | 30 % | Percent of key user/response fields populated (name, email, phone, class, …). |
| **Recency** | 25 % | Time-decay against `submitted_at` using a configurable `recencyDecayDays` (default 30). A submission today ≈ 100 for this component; one at the decay horizon ≈ 50; older decays toward 0. |
| **Engagement** | 20 % | `total_timeline_events` — counts notes, calls, meetings, follow-ups, demo attendance, etc. |

Conceptually:

```
score = (sourceQualityWeight   * sourceQualityScore
       + completenessWeight    * completenessScore
       + recencyWeight         * recencyScore
       + engagementWeight      * engagementScore) / 100
```

…where each component score is itself normalized to 0–100. The result is the `best_score` exposed on the profile.

**Recalculation triggers** (inferred — backend-driven): a new form submission against any of the user's campaigns, a new timeline event, a user-profile update. Scores are **frozen once `conversion_status === 'CONVERTED'`** — the badge is hidden in that state in tables like Manage Contacts to avoid showing a stale percentage.

### 11.5 Admin overrides

A counselor can override either field manually from the lead profile sidebar:

- `POST /admin-core-service/v1/audience/user-lead-profile/update-tier` (`UPDATE_LEAD_TIER`) — body: `{ userId, instituteId, tier }` with `tier ∈ {HOT, WARM, COLD}`.
- `POST /admin-core-service/v1/audience/user-lead-profile/update-status` (`UPDATE_LEAD_STATUS`) — sets `conversion_status` to `LEAD | CONVERTED | LOST`.
- `POST /admin-core-service/v1/audience/user-lead-profile/mark-converted` (`MARK_LEAD_CONVERTED`).
- `POST /admin-core-service/v1/audience/user-lead-profile/assign-counselor` (`ASSIGN_COUNSELOR_TO_LEAD`).

These are wired in the lead-profile drawer at [student-lead-profile.tsx](src/routes/manage-students/students-list/-components/students-list/student-side-view/student-lead-profile/student-lead-profile.tsx) — the HOT/WARM/COLD buttons highlight the resolved active tier (explicit `lead_tier`, else inferred from `best_score`).

### 11.6 Visibility flags

Lead settings expose **per-table toggles** so admins can control where badges appear, plus a master switch:

| Flag | Effect |
|---|---|
| `enabled` | Master switch — when off, lead UI is hidden institute-wide. |
| `showScoreInEnquiryTable` | Admissions / Enquiries table; **also gates the Audience-List Campaign-Users table and the Recent-Leads page**. |
| `showScoreInContactsTable` | Manage Contacts table. |
| `showScoreInStudentsTable` | Manage Students table. |

Inside the Campaign-Users table the badge is rendered in the name cell only when (a) `showScoreInEnquiryTable` (or its equivalent flag in this code path) is on, **and** (b) the row's response is linked to a real user — bare form submissions without a `user_id` show no badge.

### 11.7 Where the badge actually appears

| Surface | File |
|---|---|
| Audience-list **Campaign Users** table (the leads table for one campaign) | [campaign-users-columns.tsx](src/routes/audience-manager/list/-components/campaign-users/campaign-users-columns.tsx) — uses `useLeadProfiles` from [campaign-users-table.tsx](src/routes/audience-manager/list/-components/campaign-users/campaign-users-table.tsx) |
| Audience-manager **Recent Leads** page | [recent-leads-page.tsx](src/routes/audience-manager/recent-leads/-components/recent-leads-page.tsx) |
| Student lead-profile drawer (full detail + manual override) | [student-lead-profile.tsx](src/routes/manage-students/students-list/-components/students-list/student-side-view/student-lead-profile/student-lead-profile.tsx) |
| Manage Students list | [students-list-section.tsx](src/routes/manage-students/students-list/-components/students-list/student-list-section/students-list-section.tsx) |
| Manage Contacts list | [contacts-table-columns.tsx](src/routes/manage-contacts/-components/contacts-table-columns.tsx) |

### 11.8 TL;DR

- **Score (0–100)** is calculated by the **backend** using a configurable weighted sum of *Source Quality + Profile Completeness + Recency + Engagement* (defaults 25 / 30 / 25 / 20, must sum to 100).
- **Tier (HOT / WARM / COLD)** comes from the explicit `lead_tier` field if present (manual override or backend-set), otherwise the frontend buckets the score with `>=80 → HOT`, `>=50 → WARM`, `<50 → COLD`.
- The Audience-List campaign-users table fetches profiles in a **batch call** (`useLeadProfiles`) and renders a `LeadScoreBadge` per row, gated by institute lead-settings flags.
- Once a lead is **converted**, score updates are frozen and the badge is hidden in most tables.

---

## 12. What happens when a lead is enrolled to a Package / Course

> **Headline finding — there is a gap.** Enrolling a lead into a package/course does **not** automatically mark the lead as `CONVERTED`. Those are two independent actions wired to two different endpoints. A person can simultaneously be an active student *and* still appear as an open lead in campaign-users/recent-leads/manage-contacts unless an admin explicitly flips the conversion status.

### 12.1 Where the enrollment action lives

The "enroll to a package/course" action does **not** live inside the audience-manager UI. It is reached *through* a lead row by opening the **Student Sidebar** (the same drawer used for lead detail), and switching to the **Enroll/Deroll** tab.

Entry points that open this drawer for a lead:

| Surface | File |
|---|---|
| Audience-list **Campaign Users** table — row click / details | [campaign-users-table.tsx](src/routes/audience-manager/list/-components/campaign-users/campaign-users-table.tsx) |
| **Recent Leads** page — row click | [recent-leads-page.tsx](src/routes/audience-manager/recent-leads/-components/recent-leads-page.tsx) |
| **Manage Contacts** — row click | [contacts-list-section.tsx](src/routes/manage-contacts/-components/contacts-list-section.tsx) |
| **Manage Students** — row click | [students-list-section.tsx](src/routes/manage-students/students-list/-components/students-list/student-list-section/students-list-section.tsx) |

Inside the drawer, the **New Enrollment** section in [student-enroll-deroll.tsx](src/routes/manage-students/students-list/-components/students-list/student-side-view/student-enroll-deroll/student-enroll-deroll.tsx) exposes three buttons:

- **Rent a book** → `RENT`
- **Buy a book** → `BUY`
- **Purchase membership** → `MEMBERSHIP`

Each button opens **`SimpleEnrollmentWizard`** ([simple-enrollment-wizard.tsx](src/components/common/students/enroll-manually/simple-enrollment-wizard.tsx)), which is a search + filter (Level, Session) + multi-select package picker, ending in an **Enroll (N)** confirm button.

### 12.2 What happens on submit

1. The wizard POSTs to **`ENROLL_LEARNER_V2`** — `POST /admin-core-service/v2/learner/enroll`.
2. Service: `enrollLearnerV2()` in [src/services/enrollment-actions.ts](src/services/enrollment-actions.ts).
3. Payload shape:
   ```ts
   {
     userId: string,
     institute_id: string,
     enrollmentType: 'MANUAL',
     learner_package_session_enrollments: [
       { package_session_id, plan_id, payment_option_id, enroll_invite_id }
     ]
   }
   ```
4. On success: toast "Enrolled successfully!", wizard closes, **only `['user-plans', userId]` is invalidated**.

### 12.3 What does **not** happen automatically

This is the part that surprises people:

| Expected? | Actually does it happen? |
|---|---|
| `conversion_status` flips to `CONVERTED` | ❌ No |
| `converted_at` is set | ❌ No |
| `MARK_LEAD_CONVERTED` is called | ❌ No |
| Lead disappears from Campaign-Users table | ❌ No |
| Lead disappears from Recent-Leads page | ❌ No |
| Lead disappears from Manage-Contacts | ❌ No |
| Score / tier badge gets hidden | ❌ No (still rendered, score still updates) |
| `['campaignUsers']` / `['lead-profiles-batch']` / `['contacts']` invalidated | ❌ No |
| `user-plans` for that user invalidated | ✅ Yes |

So immediately after enrollment, the user shows up in **both worlds**: as a `LEAD` in audience-manager and as an enrolled student in manage-students.

### 12.4 The separate "mark converted" path

To actually move the lead out of the active-leads view, an admin must use the conversion controls in the **lead-profile drawer** ([student-lead-profile.tsx](src/routes/manage-students/students-list/-components/students-list/student-side-view/student-lead-profile/student-lead-profile.tsx)):

| Button | Endpoint | Effect |
|---|---|---|
| **Lead** | `POST …/user-lead-profile/update-status` (`UPDATE_LEAD_STATUS`) with `status='LEAD'` | Reverts to active-lead state; score updates resume |
| **Converted** | `UPDATE_LEAD_STATUS` with `status='CONVERTED'` (or `MARK_LEAD_CONVERTED`) | Sets `conversion_status='CONVERTED'`, stamps `converted_at`, freezes score updates, **hides the score badge** in Manage Contacts and other tables |
| **Lost** | `UPDATE_LEAD_STATUS` with `status='LOST'` | Marks the lead as lost |

Conversion is **reversible** — clicking **Lead** again flips it back to `LEAD` and unfreezes score updates. The `UserLeadProfile`, timeline, and communications history are **never deleted** on conversion; they are preserved so the audit trail (campaigns the user came from, notes, calls, demo attendance) survives.

### 12.5 Bulk paths via Admissions module

Two bulk endpoints exist that *do* combine lead capture with enrollment-adjacent flows, but they live under the Admissions module, **not** the audience-manager:

| Constant | URL | File |
|---|---|---|
| `BULK_SUBMIT_APPLICATION_WITH_LEAD` | `/admin-core-service/v1/applicant/bulk-apply` | [submit-application-bulk.ts](src/routes/admissions/-services/submit-application-bulk.ts) |
| `BULK_SUBMIT_ADMISSION_WITH_LEAD` | `/admin-core-service/v1/admission/bulk-submit-with-admission` | [submit-admission-bulk.ts](src/routes/admissions/-services/submit-admission-bulk.ts) |

These accept arrays of leads + target package-session and return a per-row success/failure summary. They handle the application/admission side of things; they are not invoked by `SimpleEnrollmentWizard`.

### 12.6 Cache keys to know

Anything that touches lead/enrollment state typically needs one or more of these invalidated:

- `['user-plans', userId]` — student's active plans (✅ invalidated by `enrollLearnerV2`)
- `['user-lead-profile', userId, instituteId]` — single lead profile
- `['lead-profiles-batch']` — batch profile fetch used by tables
- `['campaignUsers', campaignId, …]` — leads list per campaign
- `['user-audiences', userId]` — which campaigns this user belongs to
- `['cross-stage-timeline', userId, …]` — timeline / activity stream
- `['contacts']` — manage-contacts table

> If you change enrollment behavior to also mark conversion, also invalidate the lead profile + table query keys above so the UI reflects the new status without a manual refresh.

### 12.7 TL;DR

1. **Enroll = `POST /v2/learner/enroll`.** That's it. It only updates plans and invalidates `['user-plans']`.
2. **Convert = a separate manual click** in the lead-profile drawer that POSTs to `…/user-lead-profile/update-status` (or `mark-converted`).
3. The `UserLeadProfile`, timeline, and communications history are preserved across conversion; only score updates are frozen and the badge is hidden in most tables.
4. Conversion is reversible; bulk application/admission flows live in the Admissions module and are decoupled from the audience-manager UI.


---

## 13. Post Submit Configuration (thank-you screen / redirect)

What a respondent sees the instant they submit an audience form. Modelled on the
enroll invite's `postformfillConfiguration`
([PostFormFillConfigurationCard.tsx](src/routes/manage-students/invite/-components/create-invite/-components/PostFormFillConfigurationCard.tsx)) —
same idea, different surface.

### 13.1 Options

**Off by default.** `enabled` is `false` until an admin turns it on. While off,
every respondent-facing surface renders exactly what it rendered before this
feature existed and no redirect fires — whatever else is sitting in the blob.

| Field | Effect |
|---|---|
| `enabled` | Master switch. Off = standard confirmation, unchanged |
| `successTitle` | Heading. Blank hides it |
| `successMessage` | Plain-text body |
| `content` | Optional formatted body (TipTap, with an "Edit HTML source" escape hatch). Replaces `successMessage` when set. Sanitized at render |
| `buttons[]` | Up to `MAX_POST_SUBMIT_BUTTONS` (4) action buttons, each `{text, url, variant}` (solid / outline). External links open in a new tab |
| `allowAnotherResponse` + `anotherResponseText` | "Submit another response" button with a custom label |
| `redirectUrl` + `redirectDelaySeconds` | Sends the respondent elsewhere. `0` = immediate; a delay shows a countdown first |

There is deliberately **no artwork configuration** — no icon picker, accent
colour or banner image. The success icon stays the one each surface already
used; only copy, buttons and the redirect are configurable. That keeps the card
the same shape as the enroll invite's Post Form Fill Configuration.

The card is a single column of stacked fields, and the thank-you screen
**preview sits behind a Preview button** (a dialog), not a permanent
side-by-side pane — the pane cost half the campaign dialog to show a few lines
of text.

`successTitle`, `successMessage`, `content`, button text, button URLs and
`redirectUrl` all support the tokens `{{name}}`, `{{email}}` and
`{{campaignName}}`. In URLs the value is URL-encoded, so `?email={{email}}`
works.

`redirectUrl` and button URLs accept a relative path (`/thank-you`) or an
absolute `http(s)` URL only. `javascript:`, `data:` and protocol-relative
`//host` are rejected — on save in the admin, and again at render time, where an
unsafe button is dropped rather than rendered as a dead control.

### 13.2 Where it is stored

| Scope | Location | Written by |
|---|---|---|
| Per campaign | `audience.setting_json` → `postSubmitConfiguration` | `CreateCampaignForm` (POST/PUT `/v1/audience/campaign`) |
| Institute default | institute setting `AUDIENCE_FORM_SETTING` → `postSubmitConfiguration` | Settings → Lead Settings → **Forms** |

No backend change was needed: `setting_json` already round-trips through
`Audience(dto)` (create), `AudienceService.updateCampaign` (update) and both the
admin and public campaign GETs.

The institute default is prefilled into **new** campaigns only. Editing the
default never rewrites campaigns that are already saved — each keeps the copy it
was created with. `Reset` in the create form restores the institute default, not
a blank block.

`setting_json` also carries unrelated keys (`workflow_setting.offset_day`,
`SCHOOL_SETTING…COUNSELLOR_ALLOCATION_SETTING`), so the save path merges into the
existing blob rather than replacing it — see `applyPostSubmitConfiguration`.

### 13.3 Where it is read

| Surface | File |
|---|---|
| Shared campaign link `/audience-response` | `frontend-learner-dashboard-app/src/routes/audience-response/-components/audience-response-form.tsx` |
| Catalogue inline form + `AudienceFormModal` | `frontend-learner-dashboard-app/src/routes/$tagName/-components/components/LeadFormComponent.tsx` |

Both parse with `parsePostSubmitConfiguration` and share
`resolvePostSubmitButtons` and `usePostSubmitRedirect`, so a campaign behaves
identically wherever its form was filled. Two deliberate differences:

- On the catalogue surface a page-builder `successMessage` prop still wins over
  the campaign message — that override is per-placement.
- Catalogue buttons use catalogue tokens rather than the config's accent, so
  they stay on the hosting page's theme.

Campaigns created before this feature have no `postSubmitConfiguration` (often
no `setting_json` at all); every field falls back to the previous hardcoded copy,
so they render exactly as they did before. The original single-button shape
(`showCtaButton` / `ctaButtonText` / `ctaButtonUrl`) is migrated into
`buttons[0]` on read, in both apps.

### 13.4 Non-regression rules

Three guards keep this from changing behaviour for anyone who never opened the card:

1. **`enabled` is off by default**, and every renderer plus the redirect hook is
   gated on it, so an untouched campaign behaves exactly as before. Validation
   is also skipped while off, so half-finished content can never block a save.
2. **The Zod block is deliberately unfailable** (`.catch()` on every leaf, no
   `.max()` on `buttons`). This block has no error UI, and RHF's `handleSubmit`
   silently skips the success handler when any field fails — a strict rule here
   would turn "Save Changes" into a dead button with nothing on screen. Real
   enforcement lives in `validatePostSubmitConfiguration` (toast) and
   `normalizePostSubmitConfiguration` (coerce + cap).
3. **The catalogue keeps its original block** while
   `isDefaultPostSubmitConfiguration()` is true — which it always is while the
   master switch is off — so live catalogue pages don't gain a heading or change
   copy because a default now exists.
4. **A blank button row never blocks the save.** Adding a button and leaving it
   empty is a change of mind — normalize drops it. Only half-filled rows error.
5. **The card is collapsed by default in the campaign form**, behind a header
   showing an `Off` / `On` chip, so the create flow is visually unchanged for
   anyone who doesn't use it.

One dependency worth knowing: the body editor passes `minimalToolbar` to
`RichTextEditor`, and that is **load-bearing, not cosmetic**. The full toolbar's
"More tools" menu opens a link modal whose Cancel / Apply / Remove buttons carry
no `type="button"`; this card sits inside the campaign `<form>`, so with the full
toolbar those would submit the campaign mid-edit. Same for the math modal. (A
pre-existing quirk of `TipTapEditor` — unreachable in the minimal toolbar, so it
is not fixed here.)

### 13.5 Not covered

The Admissions module's **enquiry** forms (`/enquiry-response`) are a separate
entity with their own creation flow and do not read this block.

### 13.6 Key files

| File | Role |
|---|---|
| [audience-post-submit-settings.ts](src/services/audience-post-submit-settings.ts) | Types, defaults, parse/merge, validation, institute-default fetch/save |
| [PostSubmitConfigurationEditor.tsx](src/components/audience/PostSubmitConfigurationEditor.tsx) | The one editor UI (single column + Preview dialog), used by both the campaign form and Settings |
| [AudienceFormSettings.tsx](src/routes/settings/-components/AudienceFormSettings.tsx) | Settings → Lead Settings → Forms |

## 14. Share QR Code

Every campaign card exposes a **QR** action (button in the card footer, and
**Share QR Code** in the card's ⋮ menu). It opens `ShareQrDialog`: a scannable
preview, the form link with a copy button, **Download PNG** / **Download SVG**,
and **Print**.

### 14.1 The QR encodes the long URL by default

`createCampaignLink(...)` — the same `/audience-response?instituteId=…&audienceId=…`
URL the card already shows — is what goes into the symbol unless the admin
explicitly opts out. It is deliberately **not** routed through the platform
shortener by default.

A short link is revocable: `media_service` can flip a `short_links` row's status
and take every printed copy down with it. A QR that has been printed onto
standees, flyers or a backdrop cannot be reissued, so anything in the middle that
somebody can switch off is a live outage waiting to happen. Encoding the
destination directly means the only way to break the code is to delete the
campaign itself.

The dialog does offer **"Encode the short link in the QR code"** (see §15) —
fewer characters means a lower-version symbol with coarser modules, which scans
from further away. The panel underneath the QR follows the toggle: with it off
the code reads "This QR code never expires"; with it on it says the code depends
on the short link. Whichever value is encoded is the one the preview, the PNG,
the SVG **and** the print sheet all read, via a single `qrValue` — a downloaded
artefact can never disagree with the symbol on screen.

This also holds on the backend side: `AudienceService.getCampaignById` applies
no status filter and no date comparison, and neither the learner route nor the
form component reads `start_date` / `end_date` / `status`. The campaign's date
window is display-only, so the form — and therefore the QR — keeps accepting
submissions past the end date.

### 14.2 Encoding parameters (don't change these casually)

| Constant | Value | Why |
|---|---|---|
| `QR_ERROR_CORRECTION` | `'Q'` | 25% recovery — survives print smudges and a thumb over a corner. `'H'` pushes the URL to version 12 (65×65), and finer modules scan *worse* from a distance. |
| `QR_MARGIN_MODULES` | `4` | The spec's quiet zone. **qrcode.react defaults this to 0**, which produces a symbol most scanners refuse once it sits on a coloured background. Must be passed on every symbol — preview, PNG, SVG and print. |
| `QR_DOWNLOAD_PX` | `1024` | A4 at 300dpi. The PNG comes from a separate off-layout `QRCodeCanvas`, not from rasterising the 216px preview. |

The export canvas is collapsed with `size-0 overflow-hidden`, never `hidden`
(`display:none`), so it is guaranteed to have painted before `toDataURL` reads it.

### 14.3 Key files

| File | Role |
|---|---|
| [ShareQrDialog.tsx](src/routes/audience-manager/list/-components/share-qr-dialog/ShareQrDialog.tsx) | The dialog: preview, copy, PNG/SVG download, print sheet |
| [createCampaignLink.ts](src/routes/audience-manager/list/-utils/createCampaignLink.ts) | Builds the encoded URL (shared with Copy link and the embed code) |
| [audienceManagerShareQrDialog.json](public/locales/en/audienceManagerShareQrDialog.json) | Catalog (also `ar` / `fr` / `hi`) |

---

## 15. Short links

Every share surface on a campaign can hand out a `u.<domain>/s/<code>` URL
alongside the full one:

| Surface | Control |
|---|---|
| Card link row (`CampaignLink`) | **Short** / **Full** toggle beside **Copy** |
| Card ⋮ menu | **Copy Short Link** |
| Share QR dialog | A **Short link** row with its own copy button, plus the optional QR toggle |
| "Share link ready" panel, create/edit dialog | Same **Short** / **Full** toggle |

All four are gated on one institute switch — see §15.2.

The create/edit panel is the highest-intent surface — it appears the moment a campaign goes
live — and it is the one that needs a note. It hands `CampaignLink` an already-built
`presetLink`, which carries no campaign id, and shortening is keyed on that id. So the form
now also tracks `latestCampaignId` beside `latestCampaignShareLink` and passes it through.
`presetLink` still wins for what is *displayed*, so the short link's destination is the preset
URL rather than one rebuilt from the id — pinned by a test.

### 15.3 The code is 6 characters, and NOT the campaign name

`toShortCodeHint(sourceId)` in `short-link.ts` derives a stable 6-character
lowercase code from the campaign id, and `useShortLink` applies it internally —
callers cannot supply one.

The name is deliberately not used. media_service slugifies a hint into up to 50
characters, so "Class 10 Science Olympiad Registration 2026" produces a *short*
link longer than the URL it replaces. Prod carries the evidence: of ~22,400
`short_links` rows, **22,310 are exactly 6 characters**, and every outlier is a
slug — the longest being `/s/dont-believe-everything-you-think`.

It is deterministic rather than random because the code is part of the react-query
key: a fresh random string per render would change the key and refire the request.
Hashing the id gives the same code in every component, on every render, across
reloads. Distribution measured at 5 collisions per 200,000 ids (~0.0025%), and the
server resolves a collision by appending a suffix, so those degrade to a slightly
longer code rather than a wrong one. A `presetLink` with no id (the
only other caller shape) still gets no toggle at all.

**Not wired: `/admissions/enquiries`.** Its Copy button builds an enquiry link via
`createCampaignLink(..., isEnquiry: true)` and would be the natural home for the
`ENQUIRY_CAMPAIGN` source, which exists and is correct but is currently only reachable through
`ShareQrDialog`'s `isEnquiry` prop (a pre-existing prop no caller sets). Left alone
deliberately — enquiries are a different module and were outside the ask.

### 15.1 What the platform already provides

`media_service` has run the shortener since long before this feature — ~22k rows
across `ENROLL_INVITE`, `COUPON_CODE`, `REFERRAL_LINK`, `PRODUCT_PAGE` and
others. Nothing new was needed on the backend:

- `POST /media-service/public/v1/short-link/get-or-create`
  `{ source, sourceId, destinationUrl, instituteId, shortCode }` →
  `{ shortName, absoluteUrl }`. Unauthenticated (`/media-service/public/**` is
  `permitAll`), so the FE calls it with a bare axios rather than the
  authenticated instance — there is no 401 to recover from, and routing it
  through the refresh/logout interceptor would let a shortening hiccup bounce an
  admin out of the app.
- `GET https://u.vacademy.io/s/{code}` → 302 to the destination.
- `instituteId` selects a per-institute short domain from `backend_base_url`
  (7 institutes have one, e.g. `u.shikshanation.com`); everyone else lands on
  `u.vacademy.io`.
- `shortCode` is a **hint**, not a reservation: the server slugifies it
  (`"Open Day 2026"` → `open-day-2026`) and appends a random suffix on collision,
  so callers never have to check.

### 15.2 The institute switch (Settings → Lead Settings → Forms)

`AUDIENCE_FORM_SETTING` → `shortLinksEnabled`, read through
`useAudienceShortLinksEnabled()`.

**It defaults ON, and the read is `!== false`, not `=== true`.** That asymmetry
with its neighbour `formAppearanceEnabled` is deliberate and load-bearing: as of
2026-09-01 exactly **one** institute in prod has an `AUDIENCE_FORM_SETTING` row at
all, and **zero** have a `shortLinksEnabled` key. Copying the `=== true` pattern
from the switch above it would therefore have shipped the feature switched off for
every institute on the platform. Absence must read as ON; only an explicit
`false` hides it.

It also reads ON while the request is in flight, so the controls do not pop in a
beat late for the ~100% of institutes that never touch the setting. That optimism
is safe for *rendering* and unsafe for *writing*, so the hook returns two flags,
not one:

- `enabled` — optimistic. Gates what is DISPLAYED. Showing a control speculatively
  costs nothing.
- `isResolved` — whether the institute's real preference is known. Gates anything
  that can WRITE. Shortening INSERTs a `short_links` row, so an institute that has
  explicitly opted out must not get one minted just because an admin reached a
  share surface before the settings GET came back. All four surfaces gate their
  `useShortLink({ enabled })` on this; two tests pin it by asserting no POST is
  issued while unresolved.

The other cost of the optimism is one transitional state, and it is handled: `CampaignLink`'s
`displayedLink` is gated on `canShorten`, so an admin who toggles to the short URL
just before the switch resolves OFF is dropped back to the full address instead of
being stranded on a short link with the toggle gone.

`saveAudienceFormSettings` POSTs a `setting_data` blob that **REPLACES** the stored
one, so `shortLinksEnabled` has to be written on every save alongside
`postSubmitConfiguration` and `formAppearanceEnabled`. Omitting it would silently
undo an institute's opt-out the next time anything else on that page is saved —
`src/services/__tests__/audience-form-settings/test.ts` pins the exact key set.

### 15.3 Identity, and why shortening is lazy

The server keys a link on `(source, sourceId)` — asking twice returns the code
that already exists. That is what makes a link an admin has printed or broadcast
stable. Sources used here: `AUDIENCE_CAMPAIGN`, and `ENQUIRY_CAMPAIGN` for
enquiry forms, kept distinct because the two point at different learner-portal
routes.

Get-or-create is a **write** — it inserts a row. So `useShortLink` takes an
`enabled` flag that defaults to `false`: a page of campaign cards must not mint a
link for every campaign the moment it renders. The card and the ⋮ menu enable it
on click; the share dialog enables it on open, which is already an explicit
"I want to share this" action.

### 15.4 Failure is never fatal

The hook never retries and never throws at its caller. Every consumer falls back
to the long URL when `shortUrl` is null — the card reverts to **Full** with a
toast, the dialog shows a note in place of the short-link row and hides the QR
toggle. A dead shortener must not cost an admin the ability to share a form.

The hook sets `networkMode: 'always'`. React Query's default `'online'` mode would
**pause** the fetch when the browser reports itself offline — `isFetching` false,
no error, no data — and every consumer here waits on "either a URL or an error",
so a paused query is a dead click that never resolves and never explains itself.
Letting the request fail fast gives them the error path they already handle.

### 15.5 Clipboard

`copyTextToClipboard` ([clipboard.ts](src/lib/clipboard.ts)) is used wherever a
copy happens *after* a network round-trip. `navigator.clipboard.writeText` is
gated on a **recent** user gesture in Safari and Firefox, so waiting on
get-or-create first can get the write rejected even though the user did click;
the hidden-textarea + `execCommand` fallback has no such window.

### 15.6 Key files

| File | Role |
|---|---|
| [short-link.ts](src/services/short-link.ts) | `getOrCreateShortLink` + the `SHORT_LINK_SOURCE` values |
| [use-audience-short-links-enabled.ts](src/hooks/use-audience-short-links-enabled.ts) | The institute switch, shared on the settings page's own query key |
| [AudienceFormSettings.tsx](src/routes/settings/-components/AudienceFormSettings.tsx) | The **Short Links** card in Settings |
| [use-short-link.ts](src/hooks/use-short-link.ts) | Lazy, cached, non-throwing hook around it |
| [clipboard.ts](src/lib/clipboard.ts) | Copy helper with the Safari/Firefox fallback |
| [CampaignLink.tsx](src/routes/audience-manager/list/-components/create-campaign-dialog/CampaignLink.tsx) | Card link row + Short/Full toggle |
| [audience-campaign-card-menu-options.tsx](src/routes/audience-manager/list/-components/audience-invite/audience-campaign-card-menu-options.tsx) | **Copy Short Link** menu item |
| [audience-short-link.test.tsx](src/routes/audience-manager/list/-components/audience-short-link.test.tsx) | Lazy fetch, swap, copy target, both failure paths, retry, the QR toggle and the institute switch |
| [copy-short-link-menu.test.tsx](src/routes/audience-manager/list/-components/copy-short-link-menu.test.tsx) | The ⋮ path, whose dropdown unmounts on select so a toast is the only feedback there is. Two mocking traps live here: the import graph calls `axios.create()` at module scope (a `post`-only axios mock kills the file at import), and Radix opens on **pointerdown**, not click |
| [share-qr-encoding.test.tsx](src/routes/audience-manager/list/-components/share-qr-encoding.test.tsx) | Renders the **real** `QRCodeSVG` and asserts the serialised symbol actually changes (and drops a QR version) when the toggle flips — the stubbed suite above can only prove the right URL was handed to the component |
