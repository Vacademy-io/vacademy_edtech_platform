# Access Pass — Implementation Plan (Option B)

Status: in progress on `feat/access-pass` (started 2026-10-16)
Related: [BUNDLE_INVITES.md](../BUNDLE_INVITES.md) (how bundled invites work today, and their known gaps)

---

## 1. What we are building

An **Access Pass** is one thing a learner buys that unlocks a set of courses (package sessions). It has its own name, cover, description, tags and price. It appears in the course catalogue (`/$tagName`), in the learner's all-courses page and in the admin course list. The platform manages its full lifecycle: buy → active → renew → grace → expire → re-buy, plus cancel, admin grant/revoke, and **adding or removing courses after people have already bought it**.

### Why it is not called "Membership"
In this codebase "membership" already means a learner's `user_plan`: `/v1/user-plan/membership-details`, `MyMembershipWidget`, the `MEMBERSHIP_EXPIRY` workflow event, the membership-expiry admin page, and the `package_type = MEMBERSHIP` label. Reusing the word for a new entity would make every conversation ambiguous. The UI label can still say "Membership" per institute (see §9 — terminology); the code entity is `access_pass`.

### Why not reuse a bundled invite alone
A bundled invite already gives one `user_plan` → N `ssigm` rows, and renewal/cancel move them together. But an invite is a *sales link*, not a product:
1. Many invites can point at the same courses. A membership defined by "whatever invite X maps" drifts.
2. The catalogue lists package rows with their DEFAULT invite. An invite has no slug, tags or cover to be listed by.
3. Editing an invite never touches learners who already bought. A sync hooked on invite edits would fire for every ordinary invite in the system.
4. `ssigm` only carries `user_plan_id`. Nothing records whether the pass granted a course or the learner bought it separately.
5. Expiry policy lives per package session, not per product.

So the pass is a thin owner record **on top of** a system-managed bundled invite. Checkout, gateways, renewals, autopay and plan change are reused unchanged.

---

## 2. Architecture in one picture

```
access_pass ──1:1──► enroll_invite (tag = ACCESS_PASS, is_bundled = true, system-managed)
   │                     │
   │ 1:N                 │ 1:N  package_session_learner_invitation_to_payment_option
   ▼                     ▼      (one ACTIVE row per included course, all on the pass's payment_option)
access_pass_item ──────► package_session
   (source of truth)        ▲
                            │ ssigm rows (user_plan_id = holder's plan)
user_plan (enroll_invite_id = pass invite) = a HOLDER
   │
   │ 1:N
   ▼
access_pass_grant  (ledger: which course this plan got from the pass, and how)
```

- **`access_pass_item` is the source of truth** for what the pass includes. The invite's mapping rows are *derived* from it on every change. Admins never edit the pass invite directly; it is hidden from the invite list.
- **A holder is any `user_plan` whose `enroll_invite_id` is the pass invite.** No new column on `user_plan` is needed, because the pass owns exactly one invite for its whole life.
- **A *current* holder** is a plan that is ACTIVE, or soft CANCELED (a soft cancel stops renewal but keeps access until `end_date`), and whose `end_date` is in the future or null. Only current holders receive courses added later.
- **Buying uses the normal enroll flow.** The learner opens the pass, clicks Buy and lands on the existing enroll-by-invite page with the pass's invite code. That page already handles bundles ("What's Included"), payment gateways, coupons and custom fields.

---

## 3. Data model (Flyway `V595__access_pass.sql`)

### `access_pass`
| column | type | notes |
|---|---|---|
| id | varchar(36) PK | UUID |
| institute_id | varchar(36) not null | |
| name | varchar(255) not null | |
| slug | varchar(255) not null | URL key, unique per institute among non-DELETED passes |
| short_description | text | card subtitle |
| description | text | HTML, details page |
| cover_image_url | text | |
| tags | text | comma-separated, same convention as `package.comma_separated_tags` |
| status | varchar(32) not null default 'DRAFT' | DRAFT \| ACTIVE \| ARCHIVED \| DELETED |
| audience_type | varchar(16) not null default 'B2C' | **B2C**: sold to learners (catalogue + invite checkout). **B2B**: assigned to sub-orgs (`access_pass_sub_org`); its invite never sells. Fixed at create. |
| course_scope | varchar(32) not null default 'SELECTED' | **SELECTED**: the courses an admin picked. **ALL_COURSES**: every ACTIVE, non-organisation batch of the institute, kept current by the sync (new courses join, deleted ones leave). |
| payment_option_id | varchar(255) | the option every included course is sold through |
| enroll_invite_id | varchar(255) | the generated, system-managed invite |
| on_item_removed | varchar(32) not null default 'KEEP_FOR_EXISTING' | KEEP_FOR_EXISTING \| REVOKE |
| display_order | int not null default 0 | |
| settings_json | text | reserved: tiers, drip, landing-page config |
| needs_sync | boolean not null default false | set when items change; cleared by the sync job |
| last_synced_at | timestamp | |
| created_by / updated_by | varchar(255) | |
| created_at / updated_at | timestamp | |

### `access_pass_item`
| column | type | notes |
|---|---|---|
| id | varchar(36) PK | |
| access_pass_id | varchar(36) not null | |
| institute_id | varchar(36) not null | denormalised for tenant-scoped lookups |
| package_session_id | varchar(255) not null | |
| status | varchar(32) not null default 'ACTIVE' | ACTIVE \| REMOVED |
| display_order | int not null default 0 | |
| added_by / removed_by | varchar(255) | |
| added_at / removed_at | timestamp | |
| created_at / updated_at | timestamp | |

There is a partial unique index on (access_pass_id, package_session_id) WHERE status = 'ACTIVE'.

### `access_pass_grant` — the ledger
| column | type | notes |
|---|---|---|
| id | varchar(36) PK | |
| access_pass_id | varchar(36) not null | |
| user_plan_id | varchar(255) not null | the holder's plan |
| user_id | varchar(255) not null | |
| package_session_id | varchar(255) not null | |
| ssigm_id | varchar(255) | the access row this grant refers to |
| grant_type | varchar(32) not null | **GRANTED**: the row carries this plan, so the pass owns it. **COVERED**: the learner already had it from elsewhere, so the pass did not touch it. |
| status | varchar(32) not null default 'ACTIVE' | ACTIVE \| REVOKED |
| granted_at / revoked_at | timestamp | |
| revoke_reason | text | |
| created_at / updated_at | timestamp | |

There is a unique index on (user_plan_id, package_session_id). One ledger row per holder plan per course makes the sync idempotent.

Why a ledger: revoking is only ever safe for GRANTED rows. A COVERED row belongs to a different `user_plan` (a separate purchase), so a pass cancel or a course removal must never touch it. The ledger is also the audit trail ("when did this learner get course X, and why").

---

### `access_pass_sub_org` (B2B)
| column | type | notes |
|---|---|---|
| id | varchar(36) PK | |
| access_pass_id / institute_id / sub_org_id | | |
| status | varchar(32) | ACTIVE \| REMOVED. A partial unique index applies to (pass, sub_org) WHERE ACTIVE. |
| assigned_by / removed_by / assigned_at / removed_at / last_synced_at | | |

## 4. Lifecycle

| Event | What happens | Code |
|---|---|---|
| **Admin creates pass** | `access_pass` (DRAFT) + items + generated invite (INACTIVE, tag ACCESS_PASS, `is_bundled = items > 1`) + one mapping row per item on the pass's payment option | `AccessPassService.create` |
| **Publish** | status ACTIVE, invite ACTIVE | `AccessPassService.updateStatus` |
| **Learner buys** | Existing enroll flow on the pass invite: one `user_plan`, N `ssigm`. Nothing pass-specific runs in the payment path. | `LearnerEnrollRequestService` (unchanged) |
| **Ledger catch-up** | The sync job finds holder plans missing ledger rows and records GRANTED/COVERED | `AccessPassEntitlementService.reconcilePlan` |
| **Admin adds a course** | Insert item, insert mapping row on the invite, `needs_sync = true`, then an async sync for this pass. Each ACTIVE holder gets an ACTIVE `ssigm` in the new course (`user_plan_id` = holder plan, `expiry_date` = plan `end_date`) and the enrollment workflow fires. If they already had it ACTIVE from elsewhere → COVERED, untouched. | `AccessPassService.addItems` → `AccessPassEntitlementService.syncPass` |
| **Admin removes a course** | Item REMOVED, mapping row DELETED, so new buyers don't get it. `KEEP_FOR_EXISTING` (default): current holders keep it until their plan ends. `REVOKE`: GRANTED rows are set to INACTIVE and the ledger row is set to REVOKED. COVERED rows are never touched. | `AccessPassService.removeItem` → sync |
| **Renew** | Unchanged: `RenewalPaymentService` extends every `ssigm` on the `user_plan_id`. Pass-granted rows carry that id; COVERED rows don't, so they aren't extended. | existing |
| **Stacked renewal** | Unchanged: `activateStackedPlan` moves the mappings to the new plan. The sync then writes ledger rows for the new plan. | existing + sync |
| **Expire** | Unchanged: the expiry scheduler acts on `ssigm.expiry_date`. | existing |
| **Cancel / terminate** | Unchanged: force-cancel moves only rows on this plan. | existing |
| **Covered course lapses while the pass is active** | Next sync: the COVERED row is no longer ACTIVE → the pass grants it on its own plan, and the ledger is updated to GRANTED. | sync |
| **Archive pass** | status ARCHIVED, invite INACTIVE (no new buyers). Holders keep access until their plan ends. Renewal is still possible because it runs on `user_plan`. | `updateStatus` |
| **Change price** | Point the pass to a different payment option: mapping rows are re-created on the new option. Existing holders keep their plan and its price. | `AccessPassService.update` |

### Two pass types

**B2C** (sold to learners): everything above. Only B2C passes are returned by the public `list` / `by-slug` endpoints.

**B2B** (assigned to sub-orgs):
1. The sub-org already exists, created through Manage Sub-Orgs (`create-with-subscription` or a self-registration template). Its own payment, seats and validity are set there.
2. **Assign:** `POST /v1/access-pass/{id}/sub-orgs/{subOrgId}` → `SubOrgSubscriptionService.addSubOrgPackageSessions(subOrgId, instituteId, passCourses)`. This adds a mapping on the sub-org's org-level invite, mirrors its `SUBORG_LEARNER` invites, and grants the sub-org's team staff access. The call throws when the sub-org has no org-level invite in this institute, which doubles as the ownership check. The link row is then recorded.
3. **Course added to the pass:** for every ACTIVE link, the sync does two things.
   - It calls the same method again, so the course is open for **future** enrolments. The call is idempotent, so courses already linked are skipped.
   - It **gives the course to the sub-org's current roster** (`AccessPassSyncService.syncSubOrgRoster` → `AccessPassEntitlementService.reconcileSubOrgMember`):
     - **Roster:** every user with a live access row stamped `sub_org_id = sub-org` (admin "add member", and the root admin), plus every user whose row hangs off a plan on one of the sub-org's invites (`SUBORG_LEARNER` self-enrollees, who carry no stamp). These come from two queries, not one query with an OR.
     - **Template:** the member's newest live row in the sub-org, preferring stamped rows. A new course row copies its plan, sub-org stamp, org roles (so ROOT_ADMIN stays out of seat counts) and expiry.
     - **Overlap rules:** the same GRANTED / COVERED rules as B2C. A course the member already holds elsewhere is left alone.
     - **Ledger key:** the template's plan id, or `SUB_ORG:<subOrgId>:<userId>` when the row has no plan.
     - **Cost:** members whose ledger already covers every course are skipped without a write.
     - **Workflow:** the enrollment workflow fires per new course, with the sub-org.
4. **Unassign:** stops future syncing only. Already-linked courses stay with the sub-org, because the sub-org model has no course removal.
5. The pass's invite stays INACTIVE, so learners can never buy a B2B pass directly.

**Not yet covered for B2B (next step):**
- **Removal** for B2B: no revoke. The sub-org model has no course removal.
- **Self-registration** through a pass-owned `SUB_ORG_REGISTRATION` template, i.e. a school buying the pass itself.
- **Per-seat pricing** on the pass (`payment_plan.member_count`; the admin plan editor doesn't send it today).

**Known sub-org bugs (separate PR, not in this branch).** All three were found by reading the code and haven't been confirmed on data.
- **C1:** `findScopedInviteForSubOrgAndPackageSession` also matches the org invite, so scoped FREE invites are never created.
- **C2:** seat caps stored in `settingJson.MEMBER_COUNT` are never read by the seat checks.
- **C3:** `deactivateScopedInvites` deletes the org invite as well, and runs on any `SUB_ORG` plan's expiry.

### Course scope
- **ALL_COURSES:** every sync first runs `AccessPassService.refreshAllCourses`, which adds an item and mapping for each new ACTIVE batch and removes items whose batch is no longer ACTIVE. Holders are then reconciled in the same run, so a newly published course reaches them within one sync.
  - Manual add/remove is rejected for an ALL_COURSES pass.
- **Switching scope:**
  - SELECTED → ALL_COURSES queues a sync.
  - ALL_COURSES → SELECTED keeps the current items as the selection.
- The admin picker for SELECTED offers **Select all / Clear**.

### Pricing
- Every pass has its own payment option: pick an existing one, or **Create pricing for this pass**.
  - The second opens the Settings → Payment plan editor (`PaymentPlanCreator`), saves through `POST /v1/payment-option` (source INSTITUTE), and selects the new option.
- Fee plans (CPO) are created in Financial Management and picked from the list.
- Changing the option re-prices the pass for new buyers only.

### The sync job
- `AccessPassSyncJob`: `@Scheduled` every 10 minutes with `@SchedulerLock`. It also runs on demand (async) after item changes and from `POST /{id}/sync`.
- One pass for one pass:
  1. Load ACTIVE items.
  2. Find ACTIVE holder plans that need work — a plan with an ACTIVE item that has no ACTIVE ledger row, a COVERED row whose cover lapsed, or (REVOKE policy) a GRANTED row for a removed item. This is one SQL query, so a pass with 10k up-to-date holders costs one query, not 10k.
  3. `reconcilePlan` each one, in its own transaction, so one learner's failure (for example a re-enrollment policy that throws) never blocks the rest.
  4. Clear `needs_sync` when everything succeeded.
- Idempotent: re-running changes nothing.

---

### Access rows and course-content visibility

A learner's course access is one `student_session_institute_group_mapping` (ssigm) row per course batch. The pass never copies content. Subjects, modules, chapters and slides hang off the **package session** (`subject_package_session` → modules → `chapter_package_session_mapping` → slides). Any learner with a live ssigm row for that batch sees the same tree as a normal enrollee.

**What a pass grant writes** (`AccessPassEntitlementService.grantCourse`, through `StudentRegistrationManager.linkStudentToInstitute`):

| ssigm column | Value | Why it matters |
|---|---|---|
| `package_session_id` | the course batch | The key every content and "my courses" query joins on |
| `institute_id` | the pass's institute | Required by the login-time enrolled list (`getStudentWithInstituteAndUserId`), batch-details and drip |
| `status` | `ACTIVE` | Live "my courses" (`/learner-packages/v1/search`, PROGRESS) needs ACTIVE |
| `type` | `PACKAGE_SESSION` | Only ABANDONED_CART / PAYMENT_FAILED are excluded |
| `user_plan_id` | the holder's pass plan | Renewal extends it; expiry/terminate processes it |
| `expiry_date` | plan `end_date` | |
| `enrolled_date` | now (new row) | Drip `relative_date` rules start from the grant day, which is right for a newly added course |

- An existing row for (user, batch, institute) is **revived, not duplicated** (`getExistingMapping`). The sync only grants when the learner has no ACTIVE row in that batch, so it never creates two ACTIVE rows. Two ACTIVE rows would break `/user-plan-status`.
- **LMS:** the grant fires `LEARNER_BATCH_ENROLLMENT` after commit (Moodle / LearnDash provisioning and the welcome message), just as checkout does.

**Revoke** (REVOKE policy, GRANTED rows only) does the following:
- Sets `status = INACTIVE` and `expiry_date = now`, which is what the admin "make inactive" operation writes. The course drops out of the learner's lists and appears under Past.
- **Fires `LEARNER_TERMINATION` after commit** through `LearnerTerminationWorkflowHelper`, for LMS de-provisioning. Before this fix it fired nothing.

**When the learner sees it:**
- **Grant:** within ~1–2 minutes (30s service memo, 60s client cache, refetch on window focus).
- **Revoke:** the learner app keeps a login-time snapshot of enrolled sessions and lets it win when merging. A revoked course can therefore stay listed **until the learner logs in again**.

**Content guard, built and OFF by default.** `LearnerContentAccessGuard` runs on the authenticated `learner-study-library` endpoints that take a package session: `init-details`, `modules-with-chapters`, `slides-by-package-session` and `modules-chapters-slides`.
- Turn it on with `learner.content.enrollment-guard.enabled=true`.
- It blocks a learner who has no live membership in that package session. Root users and staff (ADMIN / TEACHER / EVALUATOR / COURSE_CREATOR) are never checked.
- **Not covered yet:** endpoints keyed only by chapter (`get-slides/{chapterId}`, `slides?chapterId=`) and the open `/open/v1/learner-study-library/*` previews.
- **Before turning it on**, confirm no learner screen reads content for a course the learner isn't enrolled in.

**Platform gap (not pass-specific; the guard above closes most of it once enabled):** no learner content endpoint checks ssigm. `learner-study-library/*` and the open `/open/v1/learner-study-library/*` variants serve content by package-session id alone, and enrollment is only enforced in the frontend. So revoke (and expiry) remove a course from the UI, not from the API. That's a separate hardening task: add a server-side ssigm check on the learner content and slide endpoints.

**Institutes with the renewal scheduler on** (`packageSessionRenewalSchedulerEnabled`): at final expiry, the 04:00 sweep treats pass plans like any plan. It sets the ACTIVE rows to DELETED and creates INVITED rows with source=EXPIRED, which is the normal expiry path.

## 5. APIs

### Admin (JWT) — `/admin-core-service/v1/access-pass`
| Method | Path | Purpose |
|---|---|---|
| POST | `?instituteId=` | Create (body: name, slug?, descriptions, cover, tags, payment_option_id, on_item_removed, package_session_ids) |
| GET | `/list?instituteId=&status=` | List with item count and active-holder count |
| GET | `/{id}?instituteId=` | Detail, including items with course/level/session names |
| PUT | `/{id}?instituteId=` | Update metadata / payment option / removal policy |
| PUT | `/{id}/status?instituteId=&status=` | DRAFT → ACTIVE → ARCHIVED, or DELETED |
| POST | `/{id}/items?instituteId=` | Add courses (body: package_session_ids). Triggers the sync. |
| DELETE | `/{id}/items/{packageSessionId}?instituteId=` | Remove a course. Triggers the sync. |
| GET | `/{id}/holders?instituteId=&pageNo=&pageSize=` | Holder plans: status, start/end, autopay |
| POST | `/{id}/sync?instituteId=` | Run the sync now and return its report (synchronous, under the pass lock) |
| POST | `/by-courses?instituteId=` | Which passes include these courses (body: package_session_ids) — for the course-list badge |

### Public — `/admin-core-service/open/v1/access-pass`
| Method | Path | Purpose |
|---|---|---|
| GET | `/list?instituteId=&tag=` | ACTIVE passes for catalogue cards: name, slug, cover, short description, tags, course count, min price + currency, invite code |
| GET | `/by-slug?instituteId=&slug=` | Details page: everything above + description + included courses (package/level/session names, thumbnail) |

---

## 6. Frontend

### Admin dashboard (`frontend-admin-dashboard`) — built
- **Route `/access-passes`** (`src/routes/access-passes/`). The sidebar entry is a top-level **LMS → Access Passes** tab (`access-passes`), **hidden for every role by default**: it is in `OPT_IN_TAB_IDS` (admin), the teacher defaults and `controlledTabs`, so an institute turns it on per role in Settings → Display Settings. The nav manifest has been updated by hand.
  - Pass list on the left. On the right, the selected pass: header (status, price, course and holder counts), Publish / Stop selling / Delete, the sell link (short URL and invite code), and **Included courses**. That section lets you add batches (multi-select over `batches_for_sessions`, with organisation batches filtered out), remove a batch (the confirm text follows the removal policy), and **Sync holders now**. Below that, a **Holders** table, paginated, showing pass-granted vs own-course counts.
  - `AccessPassEditorDialog` handles create and edit:
    - fields: name, slug, short description, description, cover upload (`UploadFileInS3` + `getPublicUrl`), tags, payment option (`handleGetPaymentDetails`), and removal policy;
    - courses are chosen on create only.
- API client: `src/services/access-pass.ts`. Strings: `public/locales/en/manageAccessPasses.json`. Every `t()` call also carries an English default.
- **Page builder:** new section type `accessPassGrid`, registered in `component-templates.ts`, `component-labels.ts`, `ComponentLibrary.tsx` (Courses & selling), `PropertyPanel.tsx` (`AccessPassGridEditor`) and `ComponentPreviews.tsx` (`AccessPassGridPreview`).
  - Props: `title`, `subtitle`, `tag`, `columns` (2–4), `buyLabel`, `showCourses`, `showPrice`.
- `routeTree.gen.ts` was edited by hand to mirror `/membership-expiry/`. The generator could not run, because the local `node_modules` is missing `tslib`. The next `vite dev` / `pnpm gen:routes` will reorder the entries but produce the same tree.

### Learner app (`frontend-learner-dashboard-app`) — built
- **Catalogue section `accessPassGrid`** (`$tagName/-components/components/AccessPassGridComponent.tsx`, registered in `JsonRenderer.tsx`).
  - Cards come from `GET /open/v1/access-pass/list` and show the cover, name, short description, course count and price.
  - A card opens a **details dialog**: description, "What's included", validity and price, plus a **Buy** button.
  - The dialog is deep-linkable through `?pass=<slug>`, the same pattern as the folder browser's `?folder=`. There is no new route, which avoids the root-mounted-host redirect issue and a hand-edited learner route tree.
  - **Buy** → `/learner-invitation-response?instituteId=&inviteCode=<pass invite>`, the same entry `MyMembershipWidget` uses. Checkout therefore runs on the existing enroll-by-invite page, and that page already renders "What's Included" for bundled invites.
  - It is hidden in reader mode (`shouldHidePaidPurchaseUI`). An empty section renders nothing for visitors and shows a hint in the builder preview.
- Service: `$tagName/-services/access-pass-service.ts`.

### Frontend — not built yet
- The "In N passes" badge on the admin course list. The backend `POST /v1/access-pass/by-courses` is ready.
- A **Passes** custom tab type on the learner all-courses page (`StudentAllCoursesCustomTabType`, which needs both apps' types and normalizers).
- `MyMembershipWidget` only lists plans whose package is `package_type = MEMBERSHIP`. Pass holders manage renew/cancel from the subscriptions page (`/learner/subscription/v1`, which lists every plan). Showing passes in the widget would mean matching on the plan's invite tag `ACCESS_PASS`, which needs that tag on the subscription DTO.
- Translations for languages other than English. Keys fall back to the English defaults.

## 7. Prerequisite fixes (Phase 0 — bundle bugs a pass would inherit)

| # | Fix | Where |
|---|---|---|
| E1 | v2 enroll: sum plan prices when the client omits the amount (the loop fetched plans but never added them, so a missing amount meant "free" and FORCE_PAID). Reject negative amounts. Require a resolvable plan for every non-FREE option. | `MultiPackageLearnerEnrollService` |
| E2 | Enforce invite availability (status + date window) on the learner enroll endpoint. Skipped for gateway phase-2 confirmations (money already taken) and for internal callers. | `LearnerEnrollRequestService`, `LearnerEnrollRequestController` |
| E3 | First payment decrements seats only for the courses actually activated on this plan, not every course on the invite. | `UserPlanService.applyOperationsOnFirstPayment` |
| — | Hide `ACCESS_PASS` invites from the admin invite list | `EnrollInviteRepository` |

**Open security item, not fixed here — needs a decision:** `/v2/learner/enroll` is `permitAll` in `ApplicationSecurityConfig`, and the client-supplied `enrollment_type = MANUAL` skips payment entirely. Anyone can therefore enrol into a paid course for free by sending MANUAL. The admin enrol wizard (`ENROLL_LEARNER_V2`) relies on MANUAL, so the fix is either to require an admin JWT when `enrollment_type = MANUAL`, or to split a separate authenticated admin endpoint. That's tracked separately so this branch stays reviewable.

---

## 8. Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | E1, E2, E3, invite-list hiding | in this branch |
| 1 | Migration, entities, repositories, `AccessPassService`, `AccessPassEntitlementService`, sync job, admin + public APIs | in this branch |
| 2 | Admin UI: pass manager, page-builder section | built (course-list badge pending) |
| 3 | Learner UI: catalogue section + details dialog → invite checkout | built (all-courses tab, widget pending) |
| 4 | Tiers + upgrade (via `PlanChangeService`), drip (stagger courses by days), analytics, product-page landing pages | later |

---

## 9. Decisions taken (defaults; change here if needed)
- **"All courses" follows the catalogue.** Courses published later join automatically. SELECTED passes get a select-all button.
- **B2B v1 = admin assigns a pass to an existing sub-org.** Self-registration and per-seat pricing come next.
- **Sub-org bugs C1–C3** go in a separate PR.
1. **Course removed** → existing holders keep it until their plan ends (`KEEP_FOR_EXISTING`). REVOKE is available per pass.
2. **Pricing** → whatever the selected payment option is: ONE_TIME with validity, or SUBSCRIPTION with autopay. Both already work.
3. **Overlap** → if the learner already has the course from elsewhere, the pass records COVERED and leaves the row alone. The later expiry effectively wins, and nothing is extended or shortened.
4. **No tiers in v1.** `settings_json` is reserved for them.
5. **Terminology** → entity `access_pass`. The UI label is configurable later through institute terminology settings, so an institute can call it "Membership" or "Pass".

## 10. Known limitations (v1)
- **Organisation batches** (`is_org_associated`) are rejected as pass items. Enrolling into one creates a sub-org per learner, which a background grant cannot do.
- **Sync concurrency.** Every pass sync, whether from the job, an item change or the `/sync` button, takes a ShedLock named `AccessPassSync-<passId>`. A second run that finds the lock held is skipped and reported as `skipped_locked`.
- **Overlap at purchase time** follows the existing enroll flow. If the learner already holds course X ACTIVE from a separate plan and then buys the pass, the standard enroll/shift logic decides what happens to that row (repurchase/STACK semantics in `StudentRegistrationManager.updateExistingMapping`). The ledger then records what it finds. Only courses **added later** get the strict COVERED handling.
- **Sync timing.** A course added later reaches holders on the next sync. The add call triggers it immediately, but the work is async, so a large pass can take minutes.
- **Payment option per pass.** One payment option prices the whole pass. Per-course pricing inside a pass is out of scope; that's a product page.

## 11. Verification checklist
- Create a pass with 2 courses on a FREE option, publish it, enrol through the invite code → 1 `user_plan`, 2 ACTIVE `ssigm`. After one sync, 2 GRANTED ledger rows.
- Add a 3rd course → after the sync, the holder has an ACTIVE `ssigm` in course 3 with expiry = plan end, and the enrollment workflow fired.
- A learner who already owns course 3 separately → COVERED, and their row is unchanged.
- Remove course 3 under KEEP → holders keep it, and new buyers don't get it. Under REVOKE → GRANTED rows become INACTIVE and COVERED rows stay.
- Renew a holder → all GRANTED rows are extended, COVERED rows are untouched.
- The admin invite list does not show the pass invite.
- v2 enroll without an amount on a paid plan → payment is initiated for the real total, not FORCE_PAID.
- An expired invite → v1 enroll is rejected; a Razorpay phase-2 confirmation on the same invite still completes.
