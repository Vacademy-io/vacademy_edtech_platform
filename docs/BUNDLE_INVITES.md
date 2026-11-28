# Bundle Invites — How They Work (as of 2026-10-13)

## 1. What a "bundle" is
A bundle invite is an ordinary `enroll_invite` row that maps to **more than one package session** (course + level + session batch) in `package_session_learner_invitation_to_payment_option` (PSLITPO). Each mapping row is `(enroll_invite, package_session, payment_option, status)`.

`enroll_invite.is_bundled` (added in V16) is **only a display flag**. No backend code branches on it. It is set by whoever builds the invite:

| Writer | Rule |
|---|---|
| Admin create/edit form (`helper.ts:396`) | `selectedBatches.length > 1`, recomputed on every save |
| `SubOrgSubscriptionService:100` | org-level SUB_ORG invite: `>1` package session requested |
| `SubOrgSubscriptionService:942` (`addSubOrgPackageSessions`) | set to `true` when a session is added; **never set back to false** |
| `SubOrgSubscriptionService:327, :559` | scoped / SUBORG_LEARNER mirror invites: always `false` |
| `SubOrgRegistrationTemplateService:148, :330` | `size > 1` on create and update |
| `DefaultInviteResolver:254` | default invite: `false` |

## 2. Admin side: creating and editing
- UI: `frontend-admin-dashboard/src/routes/manage-students/invite/-components/create-invite/`.
  - The admin can add batches from several courses; changing the course doesn't clear batches already added (`CreateInvite.tsx:72-119`).
  - The first batch added is the "parent". The admin can pick a different one.
- Payload (`convertInviteData`, `helper.ts:375-586`):
  - `package_session_to_payment_options[]` has one entry per batch, and **every entry carries the same `payment_option`** (the one selected plan).
  - `is_bundled = batches > 1`.
  - Name, dates, `learner_access_days`, `setting_json`, `web_page_meta_data_json` and custom fields are invite-wide.
- Endpoints: `POST /admin-core-service/v1/enroll-invite` (create) and `PUT /admin-core-service/v1/enroll-invite/enroll-invite` (update).
- Backend (`EnrollInviteService`):
  - **Create:** saves the invite, creates its short URL, saves custom fields, then writes one PSLITPO row per mapping. It then fires the `INVITE_CREATE` workflow.
  - **Update:** a mapping with an id only gets a status update. A mapping without an id is inserted. Existing mappings missing from the payload are soft-DELETED, along with their referral mappings (`:240-256`).
- Edit form (`InviteCardMenuOptions.tsx:41-83`):
  - Rebuilds batches from the mappings, with every batch marked `isParent:false`.
  - Loads the plan from **session 0's** payment option only.

## 3. Learner side: viewing the invite
- `GET /admin-core-service/open/learner/enroll-invite?instituteId&inviteCode` → `LearnerEnrollInviteService.getEnrollInvite`.
  - Returns ACTIVE or INACTIVE invites with an `availabilityStatus`. The frontend uses it to show either the form or the admin's "unavailable" message.
  - The `INVITE_FORM_FILL` workflow fires only when the invite is available.
- `buildFullEnrollInviteDTO` returns a flat `package_session_to_payment_options` list.
  - `findByInvite` keeps ACTIVE rows and **dedups per package session, keeping the newest row**.
- Learner app, `enroll-by-invite/enroll-form.tsx`:
  - `isBundledInvite = inviteData.is_bundled` (`:654`).
  - **What's Included** (`:3392+`) shows one tab per session, with the course structure preview. It appears on step 0 only.
  - Session names are resolved through the **host** institute's public details (`/public/institute/v1/details/{instituteId}`). A sub-org institute is an empty shell, so its own details would have no batches.

## 4. Learner side: enrolling and paying
**v1 — what the learner app uses.** `POST /admin-core-service/v1/learner/enroll` → `LearnerEnrollRequestService.recordLearnerRequest`.
- The app sends:
  - all `package_session_ids` of the bundle;
  - `payment_option_id` = **`package_session_to_payment_options[0]`** only;
  - one `plan_id`, and one amount/currency.
- `validateEnrollmentReferences` (`:1013-1053`): every submitted session must have an ACTIVE PSLITPO row on (invite, **that same payment option**). A bundle whose sessions use different options therefore fails with "Selected batch is not part of this invite".
- Gap validation (`:397-433`) silently drops blocked sessions, which can leave a partial bundle.
- Writes for the whole bundle:
  - **one `user_plan`** (linked to `enroll_invite_id`);
  - **one `payment_log`**;
  - **one ssigm row per package session**, all sharing that `user_plan_id`.
- Price is **one plan's `actual_price`**, not a per-course sum. The coupon is checked against the first session only (`:1136`).
- How the ssigm rows are written depends on the payment type:
  - **FREE** (`FreePaymentOptionOperation:144-183`): ACTIVE directly in the real session. If `require_approval` is on or a workflow exists, the row goes into the INVITED session with `destination_package_session_id` instead.
  - **ONE_TIME / SUBSCRIPTION:** INVITED placeholder rows with a destination, status INVITED or PENDING_FOR_APPROVAL. They are promoted when payment succeeds.
- **Expiry:**
  - `user_plan.end_date` = `plan.validity_in_days`, falling back to `invite.learner_access_days` (`UserPlanService:429-440`).
  - ssigm expiry uses `learner_access_days` for FREE and `plan.validityInDays` for paid. The request's `accessDays` is ignored.
- **Stacking:** if the learner already has an ACTIVE or PENDING plan on the same invite, the new plan is stacked after it (`UserPlanService:378-424`). Batch enrollment is then deferred (`LearnerBatchEnrollService:100-111`).
- **First payment** (`UserPlanService.applyOperationsOnFirstPayment:718-883`):
  - Resolves **all ACTIVE sessions on the invite**, not just the ones bought.
  - Terminates policy sessions, moves INVITED/ABANDONED_CART rows to ACTIVE, and falls back to `reviveLapsedEnrollment`.
  - Decrements available seats on every session of the invite.

**v2 — multi-item.** `POST /admin-core-service/v2/learner/enroll` → `MultiPackageLearnerEnrollService`.
- Each item has its own package session, plan, payment option and invite.
- Each item runs through v1 as a single session, so you get **one `user_plan` per session**.
- Item 0 charges the gateway with the **total**. The other items skip the gateway and link through `PARENT_PAYMENT_LOG_ID`.
- The learner app does **not** use v2 for invite bundles today.

## 5. After enrollment
- **Renewal** (`RenewalPaymentService:311-400`): extends or reactivates every ssigm on the `user_plan_id`. A v1 bundle renews as one unit.
- **Cancel** (`UserPlanService.cancelUserPlan:1519`):
  - CANCELED only changes the plan's status.
  - TERMINATED moves every ACTIVE row on the plan back to INVITED.
  - There is no way to cancel one course inside a bundle.
- **Approval:** `approve-learner-request`, single or bulk, promotes only the `packageSessionIds` the admin passes in. Partial approval is possible.
- **Sub-org flows:**
  - The org-level SUB_ORG invite is the "bundle" of courses the sub-org bought.
  - `addSubOrgPackageSessions` links each new session: it creates the PSLITPO row, mirrors the SUBORG_LEARNER invites, grants FSPSSM access to the team, and sets `is_bundled=true`.

## 6. Known gaps and bugs

| # | Severity | Gap | Where |
|---|---|---|---|
| G1 | **Critical (security)** | v2: when `amount` is missing or 0, the "calculate total" loop fetches plans but never adds them up. `totalAmount` stays 0, which skips amount verification and sets `SKIP_PAYMENT_INITIATION` + `FORCE_PAID_STATUS`. **Any learner can enroll in paid courses for free.** | `MultiPackageLearnerEnrollService.java:106-136, 148-211` |
| G2 | **High** | v1 enroll never checks invite availability (dates/INACTIVE). The comment at `LearnerEnrollInviteService:52` says it does, but `EnrollInviteAvailabilityUtil` is only used for display. Expired or deactivated links still enroll through the API. | `LearnerEnrollRequestService.getValidatedEnrollInvite` |
| G3 | High | First payment acts on **every** ACTIVE session on the invite, not the ones submitted. It over-decrements seats and can grant sessions that gap validation dropped. | `UserPlanService:762-812` |
| G4 | High | A bundle is single-priced: one plan, one payment option. The learner app reads `[0]` everywhere. Mixed-option bundles fail in v1. The edit form flattens all sessions onto session 0's option. | `helper.ts:421-436`, `enroll-form.tsx:661,1601,2137`, `LearnerEnrollRequestService:1013` |
| G5 | Medium | A learner who holds part of a bundle can't buy the rest. The new plan is stacked as PENDING, and the phone-identifier guard blocks with ALREADY_ENROLLED. | `UserPlanService:378-410`, `PhoneIdentifierInviteSubmissionGuard:63-77` |
| G6 | Medium | `ensureEnrollmentExists` skips repair if the learner is active in any one bundle session, so partial enrollments stay broken. | `UserPlanService:684-716` |
| G7 | Medium | No per-course cancel or refund inside a bundle. Termination is all-or-nothing. | `UserPlanService:1585-1647` |
| G8 | Low | `is_bundled` can go stale: sub-org add sets it, removal never clears it. Two separate "is bundle" tests in the admin picker. | `SubOrgSubscriptionService:942`, `invite-picker-row.tsx:333 vs 394` |
| G9 | Low | Expiry source differs between FREE and paid. The coupon only checks session 0. | `FreePaymentOptionOperation:142`, `LearnerEnrollRequestService:1136` |
| G10 | Low | Frontend: `[0].payment_option.id` has no optional chaining (crashes on an empty list). The parent batch is lost on edit. `selectedCourse.id` is set to `package_name`. A single-session invite still shows "What's Included". | `enroll-form.tsx:1601`, `InviteCardMenuOptions.tsx:58,77` |

## 7. Enhancement roadmap

### Phase 0 — Fix before extending (correctness and security)
- **E1. Close the v2 free-enroll hole (G1).** Sum `plan.actualPrice` in the calculate loop. Never infer "free" from a client-supplied amount: derive free from the server-side plan prices or `MANUAL` + admin auth. Add a unit test.
- **E2. Enforce availability on enroll (G2).** Call `EnrollInviteAvailabilityUtil.isAvailable` in `getValidatedEnrollInvite`, for v1 and v2 both.
- **E3. Scope first-payment operations to the purchased sessions (G3).** Store the submitted `package_session_ids` on the `user_plan`, or derive them from the plan's ssigm rows, and only activate and decrement those.

### Phase 1 — Make "bundle" a real product
- **E4. Bundle pricing model.** Choose one per invite: (a) a single bundle price (today's behaviour, made explicit), or (b) the sum of per-course prices with an optional bundle discount (% or flat).
  - Store it in `setting_json.bundle`, so no migration is needed.
  - Alternatively, use a `bundle_pricing` column added through a Flyway migration.
  - Show "₹X if bought separately → ₹Y bundle" on the learner page.
- **E5. Per-course payment options.** Let the admin form set a plan per batch.
  - The learner app routes mixed-option bundles through **v2**, which already supports one parent charge plus child logs.
  - Fix the v2 same-invite stacking (G5) by keying the stack check on (invite, package_session).
- **E6. Bundle-level coupons.** Validate a coupon against the bundle, or against any of its sessions, instead of session 0.

### Phase 2 — Learner flexibility
- **E7. "Pick N of M" bundles.** The admin marks courses required or optional and sets a minimum and maximum. The learner chooses at checkout, and the price follows E4.
- **E8. Upgrade / complete the bundle.** A learner who already owns some courses pays only the difference for the rest. Needs G5 fixed, and pro-rating rules.
- **E9. Partial cancel/refund.** Remove one course from a bundle `user_plan`: terminate that ssigm, with an optional pro-rated refund. Keep the rest active.

### Phase 3 — Admin experience and visibility
- **E10. Bundle analytics.** Conversions per bundle; per-course drop-off; seats left per session.
- **E11. Staggered access / drip across courses.** Course 2 unlocks N days after course 1, or after course 1 is completed. Reuse the course-drip settings.
- **E12. Per-course access duration within a bundle.** Today one expiry applies to the whole bundle.
- **E13. Clean-ups:**
  - compute `is_bundled` server-side from the ACTIVE mapping count, on every write path (G8);
  - unify the expiry source (G9);
  - fix the frontend issues listed in G10;
  - hide "What's Included" for single-session invites.

### Recommended order
**E1 → E2 → E3** (bugs; E1 is urgent) → **E4 + E5** (the core bundle product) → E6 / E13 → Phase 2 → Phase 3.

