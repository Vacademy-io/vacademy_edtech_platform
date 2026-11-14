# Institute Modules & Configuration — Spec

Status: DRAFT for review · 2026-10-13
Owners: platform (super-admin team), admin dashboard, super-admin portal (`vacademy-health-check`)

## 1. Problem

- Which product an institute gets (CRM, LMS, ERP, AI…) is decided by the platform team, but there is
  no place to record it. Staff log into each client's admin account and hand-edit Display Settings.
- `sub_modules` (signup-time ASSESS/LMS/VOLT/VSMART) is written once and the API returns `[]`; the
  frontend module filter is never called. There is no CRM module at all.
- `institutes.setting_json` is one tenant-writable blob that is also returned by the public details
  endpoint — it cannot hold anything the platform controls.
- Result: CRM-only clients see LMS quick actions and an LMS setup checklist; nothing is hidden by
  plan, only by per-role hand edits; locks are bypassable from ⌘K/Recent/URL.

## 2. Decisions (founder, 2026-10-13)

1. The platform team sets modules **and sub-modules (features)** per institute from the super-admin
   portal. A module/feature that is off is **hidden**, not shown as locked.
2. Modules are **not** tied to roles. The institute admin keeps deciding which role sees what.
3. Role display settings (tabs, categories, widgets…) become editable from the super-admin portal
   **as well as** from the institute's own Settings, which stays open.
4. The platform team needs a clear picture of what each role at an institute actually sees.
5. Not linked to pricing quotes/plans. Module keys are chosen independently.
6. Everything is catalogue-driven: adding a module or feature is a catalogue entry, not code in
   three apps.

## 3. Model — three layers, one rule

| Layer | Question | Set by | Store |
|---|---|---|---|
| Entitlement | What does this institute have? | Platform team (portal) | `institute_module_*` tables (new, super-admin-only writes) |
| Access | Which role sees which of those? | Institute admin **or** platform team | Existing role display settings in `setting_json` |
| Personal | Order, recent, dismissed cards | The user | Browser / user prefs |

**Visible = entitled ∩ role-allowed ∩ personal**, always evaluated for the **current institute**
(never roles flattened across institutes).

Entitlement is a ceiling: the institute admin's Display Settings editor does not show items whose
feature is off, and nothing the admin saves can turn them back on.

## 4. Capability catalogue

One versioned file, `admin_core_service/src/main/resources/capabilities/catalog.json`, served by the
API. It is the only place module and feature keys are defined.

```jsonc
{
  "version": 1,
  "modules": [
    {
      "key": "crm",
      "label": "CRM",
      "description": "Leads, admissions, calling",
      "rail": "CRM",                    // sidebar category it lives under
      "core": false,                    // core modules cannot be switched off
      "features": [
        {
          "key": "crm.leads",
          "label": "Leads & follow-ups",
          "defaultOn": true,            // state when the module is switched on
          "governs": {
            "nav": ["leads"],           // tab id, or "tab/sub" for a sub-tab
            "widgets": [],
            "quickActions": [],
            "assistantGroups": [],
            "setupSteps": [],
            "routes": ["/audience-manager"]
          },
          "settingKeys": ["LEAD_SETTING"]   // institute settings this feature owns (§8)
        }
      ]
    }
  ]
}
```

Rules:
- A UI element governed by several features is visible only if **all** of them are on.
- A UI element **not** listed anywhere is ungoverned (always available). A frontend unit test fails
  if a sidebar id from `getSidebarItemsData()` is neither governed nor in an explicit `ungoverned`
  list, so new pages cannot silently skip the catalogue.
- Keys are permanent. Renaming = add new key + migrate rows.

### 4.1 Proposed module map (v1 — for review)

| Module | Features (sub-modules) | Sidebar it governs |
|---|---|---|
| `core` (always on) | dashboard, contacts, teams, settings, activity logs | dashboard, manage-contacts (all-contacts, user-tags-main, link-tag, invite), manage-institute/teams, settings, admin-activity-logs |
| `lms` | `lms.courses`, `lms.batches`, `lms.course_planning`, `lms.reports`, `lms.student_ai`, `lms.doubts`, `lms.engagement`, `lms.mentorship` | courses, course-creation, manage-institute/batches, manage-institute/sessions, manage-contacts/linked-contacts, course-planning-logging, learning-reports, institute-pulse, student-ai, doubt-management, learning-engagement, mentorship |
| `assessments` | `assessments.tests`, `assessments.question_banks`, `assessments.scanned_evaluation` | assessments-tests, question-banks |
| `live_classes` | `live_classes.sessions`, `live_classes.meetings` | live-sessions, meetings |
| `crm` | `crm.leads`, `crm.admissions`, `crm.calling`, `crm.ai_calling`, `crm.call_intelligence`, `crm.live_activity` | leads, admissions, calling (+ leads/call-log), leads/ai-intelligence, live-activity |
| `communications` | `comms.announcements`, `comms.email`, `comms.whatsapp`, `comms.chat`, `comms.notification_hub` | communications/* |
| `automation` | `automation.workflows`, `automation.chatbot_flows`, `automation.engagement_engines` | automations/workflow-list, automations/chatbot-flows, engagement-engines |
| `website` | `website.builder`, `website.product_pages`, `website.blog` | automations/website-builder, product-pages, blog |
| `finance` | `finance.fees`, `finance.memberships`, `finance.packages` | fee-management, membership-management, manage-institute/manage-packages |
| `sub_orgs` | `sub_orgs.partners` | manage-institute/suborg-teams, manage-institute/manage-institute-suborgs |
| `inventory` | `inventory.items` | manage-institute/inventory-management |
| `erp` | `erp.people`, `erp.leave`, `erp.attendance`, `erp.payroll`, `erp.compliance`, `erp.finance`, `erp.my_hr` | erp-* |
| `ai` | `ai.tools`, `ai.knowledge_base`, `ai.instructor_copilot`, `ai.course_creator`, `ai.content_studio`, `ai.content_api` | ai-* tabs |

Rail categories follow from this: a rail category with no visible items is not drawn.

## 5. Data model (admin_core, new tables only — no ALTER on `institutes`)

```sql
institute_module_policy (
  institute_id   varchar PRIMARY KEY,
  mode           varchar NOT NULL DEFAULT 'LEGACY',   -- LEGACY | MANAGED
  updated_by     varchar, updated_at timestamptz
);
institute_module_entitlement (
  institute_id   varchar, key varchar,                -- module key or feature key
  enabled        boolean NOT NULL,
  expires_at     timestamptz NULL,                    -- trials / time-boxed add-ons
  note           text,
  updated_by     varchar, updated_at timestamptz,
  PRIMARY KEY (institute_id, key)
);
institute_module_entitlement_log (id, institute_id, key, old_enabled, new_enabled,
  old_expires_at, new_expires_at, reason, actor, created_at);
module_preset (key PK, name, description, entitlements jsonb, updated_by, updated_at);
institute_setting_history (id, institute_id, setting_key, old_value text, new_value text,
  actor, source varchar /* TENANT | PLATFORM */, created_at);
```

Resolution (server, one function):
- `mode = LEGACY` → every feature is on (exactly today's behaviour).
- `mode = MANAGED` → feature on ⇔ module row enabled (core = always) **and** feature row enabled
  (no row → catalogue `defaultOn`) **and** neither is past `expires_at`.

Every institute starts in `LEGACY`. The platform team configures an institute, previews it, and
flips it to `MANAGED`. Rollback = flip back to `LEGACY`.

## 6. APIs

Tenant (admin dashboard), `/admin-core-service/capabilities/v1`:
- `GET /catalog` — the catalogue.
- `GET /me?instituteId=` — membership-checked. Returns
  `{ mode, features: {key: bool}, modules: {key: bool}, catalogVersion, displaySettingsVersion }`.
  `displaySettingsVersion` = last-change stamp of the role display keys, so the admin app busts its
  24 h localStorage cache when the platform team edits settings.

Platform, `/admin-core-service/super-admin/v1` (gated by `SUPER_ADMIN_USER_IDS`):
- `GET  /institutes/{id}/modules` — policy + rows + resolved state.
- `PUT  /institutes/{id}/modules` — batch `{ mode?, changes:[{key, enabled, expiresAt?}], reason }`;
  reason required; writes the log.
- `GET  /institutes/{id}/modules/history`
- `GET/PUT /module-presets`, `POST /module-presets/{key}/apply` `{ instituteIds[], reason }`
- `GET  /institutes/{id}/roles` — Admin, Teacher, built-in staff roles, custom roles.
- `GET  /institutes/{id}/display-settings/{roleKey}` — saved blob + last-change stamp.
- `PUT  /institutes/{id}/display-settings/{roleKey}` — `{ data, expectedVersion, reason }`;
  rejects with 409 if the tenant saved in between; writes `institute_setting_history` (PLATFORM).
- `GET  /institutes/{id}/settings/history?key=` and `POST …/restore/{historyId}`.
- Preview is computed in the portal from the generated nav manifest (§12.4).

Exact shapes for all of the above: §12.

Tenant `save-setting` gains: membership check (any key), ADMIN-in-this-institute for role display
keys, history row (TENANT), and server-side stripping of entries for non-entitled features.

## 7. Super-admin portal UX (institute detail page)

New tabs, all driven by the catalogue — no hard-coded module lists in the portal:

1. **Modules** — one card per module (toggle, expiry, note); expand for feature toggles. "Apply
   preset" and "Import from current settings" (pre-fills from the admin role's visible rail
   categories/tabs). Mode badge `LEGACY / MANAGED` with a guarded switch. Every save asks for a
   reason. History drawer.
2. **Roles & navigation** — a matrix: rows = rail categories → tabs → sub-tabs (grouped by module,
   non-entitled rows shown greyed "module off"); columns = roles. Cell = Visible / Hidden / Locked.
   Side panel per role for the rest: post-login page, UI toggles (sidebar, AI credits, status,
   settings gear, assist dock), dashboard widgets. Saves go through the platform display-settings
   endpoint with conflict detection.
3. **Preview** — pick a role; see the rail and sidebar exactly as that role sees it, with a reason
   on every hidden item.
4. **History** — module changes and setting changes (tenant and platform), with restore.

Bulk: institutes list gets a "Modules" column and multi-select "Apply preset".

## 8. Feature settings (sub-module configuration)

Each feature lists the institute setting keys it owns (`settingKeys`). Phase 1 shows them read-only
inside the feature card ("configured / not configured", last changed, by whom). Phase 3 adds
editable forms per key, driven by a JSON schema shipped in the catalogue, so a new feature's
settings get a portal form without portal code.

## 9. Admin dashboard changes

- One resolver hook `useCapabilities()` → `can(featureKey)`; roles from the current institute only.
- Rail, sidebar, ⌘K search, Recent, quick actions, assistant chips, dashboard widgets and the setup
  checklist all filter through the catalogue. Locked/hidden routes are guarded at the route, not
  only on click.
- Display Settings editor hides non-entitled rows; built-in staff roles (Evaluator, Content
  Creator, Assessment Creator) become configurable.
- In-app institute switcher in the avatar menu.
- If `/capabilities/me` fails, the app behaves as LEGACY (fail-open in UI); the server enforces.

## 10. Server enforcement (Phase 3)

`@RequiresFeature("crm.ai_calling")` in common_service, backed by a cached (60 s) per-institute
lookup; 403 with `{code:"FEATURE_DISABLED", feature}`. Rolled out per controller, newest first.

## 11. Phases

| Phase | Scope | User-visible change |
|---|---|---|
| 0 | Bugs + security: role scope per institute, STUDENT label, fee KPI queries, PENDING_FOR_APPROVAL, COURSE/CONTENT CREATOR key, inverted teacher defaults, duplicate dashboard requests, save-setting + custom-role authz, no tokens on clipboard | Correct numbers and labels |
| 1 | Catalogue, tables, APIs, setting history; portal Modules / Roles & navigation / Preview / History tabs; admin app reads `/me` only for cache busting | Platform team configures from portal; tenants see no change (all LEGACY) |
| 2 | Admin app gates by entitlement in MANAGED mode; switcher; editor scoped; route guards | Institutes flipped to MANAGED one by one after review in prod |
| 3 | Server enforcement; feature-settings forms; platform locks on individual settings; dashboard rebuilt on the widget catalogue | — |

## 12. Phase 1 contract (binding for backend, admin app and portal)

All admin_core JSON is **snake_case**. Timestamps ISO-8601 UTC.

### 12.1 Files (admin_core `src/main/resources/capabilities/`)
- `catalog.json` — hand-authored modules/features (§4), snake_case:
  `{version, modules:[{key,label,description,rail,core,features:[{key,label,description,default_on,
  governs:{nav,widgets,quick_actions,assistant_groups,setup_steps,routes},setting_keys}]}]}`.
  `nav` entries are a tab id or `"tab/sub"`.
- `nav-manifest.json` — **generated** by a vitest in the admin app from `getSidebarItemsData()` +
  admin/teacher defaults + `filterSidebarByRole` rules (`UPDATE_NAV_MANIFEST=1` rewrites it; the
  test fails on drift):
  `{generated_at, categories:[{id,label,default_visible}], always_admin_only_tab_ids:[],
  tabs:[{id,label,category,route,order,default_visible:{ADMIN,TEACHER},
  sub_tabs:[{id,label,route,order,admin_only,default_visible:{ADMIN,TEACHER}}]}]}`.
  Custom roles use the TEACHER defaults (as the admin app does).

### 12.2 Tenant API
- `GET /admin-core-service/capabilities/v1/catalog` → `{catalog, nav}` (`nav` null if the manifest
  is absent). Any signed-in user.
- `GET /admin-core-service/capabilities/v1/me?instituteId=` (member of that institute) →
  `{mode, catalog_version, modules:{key:bool}, features:{key:bool}, display_settings_version}`;
  `display_settings_version` = hash of the stored ADMIN/TEACHER/ROLE display keys (null if none).

### 12.3 Super-admin API (`/admin-core-service/super-admin/v1`, SUPER_ADMIN_USER_IDS)
- `GET /institutes/{id}/modules` → `{institute_id, mode, mode_updated_by, mode_updated_at,
  catalog_version, entitlements:[{key,enabled,expires_at,note,updated_by,updated_at}],
  resolved:{modules:{key:bool}, features:{key:bool}}}`. `resolved` is what MANAGED mode would
  apply, even while LEGACY.
- `PUT /institutes/{id}/modules` body `{mode?, changes:[{key,enabled,expires_at?,note?}], reason}`
  → same shape as GET. 400 on unknown key, on disabling a `core` module, or blank reason.
- `GET /institutes/{id}/modules/history?page=0&size=20` → page `{content:[{id,key,old_value,
  new_value,reason,actor_user_id,created_at}], total_elements,total_pages,number,size}`;
  `old_value`/`new_value` are JSON strings (`{"enabled":true,"expires_at":null}`; key `_mode`
  for mode changes).
- `GET /modules/overview?institute_ids=a,b,c` → `{"<id>":{mode, enabled_modules:[key]}}`.
- `GET /module-presets` → `[{key,name,description,modules:[key],updated_by,updated_at}]`;
  `PUT /module-presets/{key}` `{name,description,modules}`; `DELETE /module-presets/{key}`;
  `POST /module-presets/{key}/apply` `{institute_ids:[], reason}` →
  `{applied:[id], failed:[{institute_id,error}]}`. Applying = listed modules enabled, every other
  non-core module disabled; feature rows untouched; mode untouched. Seeded: `full_suite`,
  `lms_suite`, `crm_suite`.
- `GET /institutes/{id}/display-settings?role_key=ADMIN|TEACHER|CUSTOM:<roleId>` →
  `{role_key, data, version}` (`data` = stored blob for that role or null; `version` = hash).
- `PUT /institutes/{id}/display-settings?role_key=…` `{data, expected_version, reason}` → same
  shape; **409** `{code:"VERSION_CONFLICT"}` when `expected_version` ≠ current. Custom roles
  update only that role's entry inside ROLE_DISPLAY_SETTINGS.
- `GET /institutes/{id}/settings/history?setting_key=&page=&size=` → page of
  `{id,setting_key,actor_user_id,source,created_at}`; `GET …/settings/history/{hid}` adds
  `old_value,new_value`; `POST …/settings/history/{hid}/restore` `{reason}` restores `old_value`.
  Every tenant and platform write of any setting key records a row.

auth_service (`/auth-service/super-admin/v1`, same allowlist):
- `GET /institutes/{id}/roles` → `[{role_id, role_name, kind:"ADMIN"|"TEACHER"|"SYSTEM"|"CUSTOM",
  user_count}]`.

**Note — how display settings are stored (the platform write uses exactly this, so the admin app
reads a portal edit unchanged).** In `institutes.setting_json` = `{institute_id, setting:{<KEY>:
{key, name, data}}}`:
- `ADMIN` → `setting.ADMIN_DISPLAY_SETTINGS = {key, name:"Admin Display Settings", data:<DisplaySettingsData>}`
- `TEACHER` → `setting.TEACHER_DISPLAY_SETTINGS = {key, name:"Teacher Display Settings", data:<DisplaySettingsData>}`
- `CUSTOM:<roleId>` → `setting.ROLE_DISPLAY_SETTINGS = {key, name:"Role Display Settings",
  data:{"<auth roles.id>": <DisplaySettingsData>, …}}` — one map for all custom roles; the admin
  app re-posts the whole map with one entry replaced. The key is `ROLE_DISPLAY_SETTINGS` (plural);
  `SettingKeyEnums.ROLE_DISPLAY_SETTING` is a different, unused-by-the-app key.

The admin app writes all three via `POST /institute/setting/v1/save-setting?settingKey=<KEY>` with
`{setting_name, setting_data}` (generic strategy). `data` returned by the platform endpoint is the
`DisplaySettingsData` blob itself (for custom roles: that role's entry), not the wrapper.

**Phase 1 backend details (additive to the shapes above).**
- `version` = first 32 hex chars of SHA-256 over the role blob's canonical JSON (keys sorted); a
  role with no stored blob still has a version (of `null`). Edits to *another* custom role do not
  change this role's version. `display_settings_version` (§12.2) = same hash over the stored
  ADMIN/TEACHER/ROLE keys, null when none is stored.
- Display-settings PUT: `expected_version` is required (400 when absent); `data: null` removes the
  role's blob (app falls back to defaults); the 409 body is `{code:"VERSION_CONFLICT", message,
  current_version}`. The write takes a row lock on the institute.
- Module `PUT`: an absent `expires_at`/`note` keeps the stored value, explicit `null` clears it;
  404 for an unknown institute. History `old_value` is null when the row did not exist; values
  also carry `note`. Mode rows: `{"mode":"LEGACY"|"MANAGED"}`.
- `overview.enabled_modules` = the `resolved` (MANAGED-rule) modules, core included, also for
  LEGACY institutes.
- Presets: `PUT` needs no reason (none in the body); `DELETE` → 204; apply leaves `expires_at`
  and `note` of module rows untouched and creates no row for a module that is already off; the
  log reason is `"<reason> [preset <key>]"`.
- Setting history: `old_value`/`new_value` are JSON strings of `setting.<KEY>` (`{key,name,data}`),
  null = key absent. The detail also returns `reason` (platform writes). Restore → `{restored_from,
  setting_key, changed, history:<detail of the new row>|null}`; it writes a new PLATFORM row with
  reason `"<reason> [restore of <hid>]"`. Tenant writes made outside a request (e.g. institute
  setup jobs) have `actor_user_id` null.
- Tables add `institute_setting_history.reason` and `institute_module_entitlement_log.old_note /
  new_note` to §5 (V567).

### 12.4 Preview
Computed in the portal from `nav` + the role's stored blob + `resolved` features, mirroring the
admin app (merge saved blob over role defaults by id; admin sees every tab; non-admins lose
`always_admin_only_tab_ids` and `admin_only` sub-tabs unless explicitly `visible: true`; hidden
categories hide their tabs). Each hidden row carries a reason: `MODULE_OFF`, `FEATURE_OFF`,
`HIDDEN_FOR_ROLE`, `ADMIN_ONLY`, `CATEGORY_HIDDEN`; locked rows are marked `LOCKED`.

## 13. Verification

- Unit: resolver truth table (LEGACY, MANAGED, expiry, core, multi-feature governance); catalogue
  coverage test against `getSidebarItemsData()`; merge-with-defaults parity fixtures shared by the
  Java preview and the TS sidebar.
- Probe on prod per institute before flipping to MANAGED: preview each role in the portal, then log
  in as each role and compare.
- Rollback: flip to LEGACY (instant, no deploy).
