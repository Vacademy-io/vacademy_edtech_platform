# Evalezy app (simple AI copy checking)

Evalezy is the admin portal held inside one small shell, `/evalezy`:

1. **Pick an assessment**, or create one with **New** (`/evalezy/new`): name, total marks and the question
   paper (PDF or photos). The paper is read by AI into questions you review before checking starts.
   The list shows published assessments that are checked by hand (`MANUAL` evaluation).
2. **Add the copies.**
   - **Scan with camera:** page by page, with **Next student** between copies.
   - **Upload files:** each PDF is one copy. Photos picked together make one copy, and **One per photo** splits them.
3. **Check N copies.** Each copy becomes one PDF, is uploaded, and starts the same bulk AI check as
   the portal's *Upload & check copies* (`copy-intake/v1/start`). The AI reads the name, matches the student and checks the copy.
4. **Download checked copies.** The zip button is in the results panel. That panel is the portal's own
   `CopyIntakeBatchPanel`, so it also has progress, picking a student for an unmatched copy, and retry.

It uses the same bundle, login, APIs and credits as the portal.

*Updated 14 Nov 2026:* accounts (sign-up, instant demo, buy), plans and users, invoices and mails are
described below. Changes marked **(14 Nov)** are built but not yet deployed.

## Accounts: three ways in

Every Evalezy account is an institute with `product = evalezy` and one admin. Settings for all three
paths live in the product settings row `product.evalezy`, edited on the health dashboard
(Products → Evalezy).

| Path | Link | What the visitor gives | What they get |
|---|---|---|---|
| Free trial | `/signup/start?product=evalezy` | Email proven by OTP or Google, username and password, institute details | `FREE_TRIAL`, trial days and opening credits from settings |
| **Instant demo (14 Nov)** | `/demo` | Name, email, phone. No code | Same trial, but opening credits from `demo_portal_credits`. Login details by email. One account per email; `+tag` aliases and throwaway inboxes are refused |
| **Buy a plan (14 Nov)** | `/signup/start?product=evalezy&plan=<key>&buy=<key>` (the website's Buy button) | Same as the free trial | **No trial and no credits.** The app shows only the plan screen until the plan is paid |

The trial gate is in ai_service: a `FREE_TRIAL` institute past `demo_expires_at`, with nothing bought,
cannot run AI; its reports stay readable.

## Plans, payment and users (14 Nov)

- **Plans** are set on the health dashboard (Products → Evalezy → Pricing) and sold through the AI plans
  storefront as `evalezy_<key>` (for example `evalezy_starter`, `evalezy_team`), offered to the segment
  `product_evalezy`. Payment is the AI plans checkout on the **platform Razorpay account**, the same
  account as AI credit packs. In the app it opens from `/evalezy/credits?buy=<key>`.
- **What a workspace bought** comes from admin-core
  `GET /admin-core-service/product/v1/institutes/{id}/plan-access`:

| Status | When | Users | App |
|---|---|---|---|
| `TRIAL` | Free trial, no plan | 1 | Everything; plan cards to buy |
| `PAYMENT_PENDING` | Signed up through Buy, not paid | 1 | Only `/evalezy/plan`, `/evalezy/credits`, `/evalezy/profile` |
| `PLAN` | A product plan is live | The plan's `users` (e.g. 1 or 15) | Everything; teachers list on a multi-user plan |
| `MANAGED` | Set up by the team (paid by hand) | Not limited | Everything |

- **Teachers:** on a plan with more than one user, **Plan & teachers** (`/evalezy/plan`, in the ⋮ menu)
  lists them and lets the owner add (name + email, full Evalezy access) or remove one. auth-service
  refuses an invite past the plan's limit (`ProductSeatGuard`). Buy, add and remove show only to the
  owner (the sign-up email). Purchase buttons are hidden in the iOS app.
- **Trial banner** links to the Plan page ("Buy a plan"; "Plan & teachers" on iOS).

## Invoices and mails (14 Nov)

- **Payment → GST invoice.** A paid plan creates the platform tax invoice. For Evalezy the mail comes from
  the product's sender with the Evalezy name and logo, the **PDF attached**, and a link to the Plan page.
  The PDF names the legal supplier with "Trade name: Evalezy". Refunds create credit notes the same way.
- **Where to find them:** Plan & teachers → Invoices, and the plan section of AI credits.
- **Mail logo:** product setting `email_logo_url` (a public https PNG or JPG; SVG does not show in mail
  clients) heads the OTP mail and the invoice mail and sits on the invoice PDF.
- **Team alert:** every sign-up (method: Email OTP, Google or Demo portal) is mailed and sent on WhatsApp
  to the recipients set on the dashboard.
- **Demo leads:** each instant-demo sign-up also becomes a lead in one CRM list ("Product Evalezy
  ( Instant - Demo )") in the institute set as `demo_leads_institute_id`.

## Where Evalezy runs

| Where | How it turns on |
|---|---|
| `https://evalezy.vacademy.io` | The host's first label is `evalezy` (`src/lib/evalezy-mode.ts`). |
| The Evalezy mobile app (`io.evalezy.app`) | Flavor `evalezy` has `forceEvalezyShell` (`flavor.config.ts`). |
| Full portal, any host | `/evalezy` route. The **Assessments → Evalezy** sidebar entry ships hidden; turn it on in Display Settings. |

In Evalezy mode (host or app), the root route guard keeps a signed-in user inside `/evalezy`:

- The "copies checked" email link (`…/assessment-details/<id>/…?intake=<batch>`) opens `/evalezy/<id>?intake=<batch>`.
- Any other portal page opens `/evalezy`.
- The assistant, dock and popups are not rendered.

No institute owns Evalezy, so it resolves no domain-routing row and shows the Evalezy name, logo and
favicon. Any institute's admin signs in, as on `dash.vacademy.io`.

**Do not** add an `institute_domain_routing` row for `evalezy.vacademy.io`. A host row would pin web
logins to that one institute.

## Institute control (Settings → Assessment → Evalezy app)

Stored in `ASSESSMENT_SETTING.evalezy`. All switches default to on, except scan quality.

| Setting | Effect |
|---|---|
| `enabled` | Off: Evalezy shows "turned off for your institute". |
| `allowCamera` / `allowUpload` | Shows or hides the two ways to add copies. |
| `notifyEmail` | The sender gets an email when the batch is checked. |
| `scanQuality` | `STANDARD` = 2400 px long edge, JPEG 0.8 (what the AI reads). `HIGH` = 3200 px, 0.9. |

How the AI marks still comes from **AI copy checking** (template, instructions, language feedback). It
can also be changed per batch under **Checking settings**.

## Deep links

- **Android App Links:** `https://<deepLinkHost>/…` opens the app.
  - The intent filter is in `src/main/AndroidManifest.xml`; the host comes per flavor from `mobile-flavors.json`.
  - Verified against `public/.well-known/assetlinks.json`, which this web build serves on every admin host.
- **iOS Universal Links:** `App/Evalezy.entitlements` declares `applinks:evalezy.vacademy.io`.
  - `public/.well-known/apple-app-site-association` covers `/evalezy` and `/evalezy/*`.
- **Routing in the app:** `src/native/deepLinks.ts` maps `https://<flavor deepLinkHost>/<path>` to the in-app `<path>`.
  The root route's `NativeDeepLinks` navigates there.

## Launch checklist (not doable from the repo)

1. **DNS / hosting:** done (Nov 2026). `evalezy.vacademy.io` is a custom domain of the admin dashboard deployment
   (the same build as `dash.vacademy.io`). Check `https://evalezy.vacademy.io/.well-known/assetlinks.json` returns JSON.
2. **Firebase (push):**
   - Register Android + iOS apps `io.evalezy.app` in the Firebase project.
   - Put `google-services.json` in `android/app/GoogleServiceConfigs/evalezy/` and `GoogleService-Info.plist`
     in `ios/App/GoogleServiceConfigs/evalezy/`.
   - Android builds without it (push off; `missingGoogleServicesStrategy = WARN`). **iOS crashes on launch
     without a plist** (see CAPACITOR_VACADEMY_ADMIN.md).
3. **Play signing:**
   - `assetlinks.json` lists the upload key (`94:23:B0:…:6B:A8`).
   - After the first Play upload, add the **app signing** key's SHA-256 (Play Console → App integrity) to the
     `io.evalezy.app` entry. Ship it with the web deploy.
4. **iOS target** (Xcode can't be data-driven). Duplicate the **App** target as **Evalezy** and set:
   - `PRODUCT_BUNDLE_IDENTIFIER = io.evalezy.app`, display name `Evalezy`.
   - `ASSETCATALOG_COMPILER_APPICON_NAME = EvalezyIcon`; the launch screen image is `EvalezySplash`.
   - `CODE_SIGN_ENTITLEMENTS = App/Evalezy.entitlements`, and the Associated Domains capability on the App ID.
   - Its `GoogleService-Info.plist` points at `GoogleServiceConfigs/evalezy/`.
5. **OTA:** `io.evalezy.app` is a strict OTA app (admin-core `ota.strict-target-app-ids`). Publish with
   `OTA_VERSION=<n> pnpm run ota:publish:evalezy`; the script targets `io.evalezy.app` and refuses to run
   without `OTA_VERSION`. Use a version line no other app uses (e.g. `5.0.x`) that stays above the native
   `versionName`.

## Build

```bash
pnpm run cap:run:evalezy:android          # build + sync + run (flavor evalezy)
pnpm run android:bundle:evalezy:release   # .aab for Play
pnpm run build:evalezy && VITE_CAP_FLAVOR=evalezy npx cap sync ios && npx cap open ios   # archive the Evalezy scheme
```

## Files

- `src/routes/evalezy/`: the shell.
  - `route.tsx`: layout, the `enabled` gate, and the payment-pending lock (14 Nov).
  - `index.tsx`: the assessment list. `new.tsx`: create from a question paper.
  - `$assessmentId.tsx`: add copies, send them, results.
  - `credits.tsx`: AI credits, recharge and the plan checkout. `plan.tsx`: Plan & teachers and invoices (14 Nov).
  - `profile.tsx`, `settings.tsx`: profile (with account deletion) and checking settings.
  - `-hooks/usePlanAccess.ts`: plan status and user limit (14 Nov).
  - `-components/CameraScanner.tsx`, `-components/CopyTray.tsx`, `-lib/scan-pdf.ts` (photos → one PDF per copy).
  - `-components/TrialBanner.tsx`, `-components/EvalezyHeader.tsx` (credit chip and ⋮ menu).
- `src/routes/signup/`: `start.tsx` (trial and buy), `-components/SelfSignupFlow.tsx`, `-components/DemoSignup.tsx`;
  `src/routes/demo.tsx` (instant demo, 14 Nov).
- `src/lib/evalezy-mode.ts`: mode detection and the path mapping used by the root guard.
- `src/lib/save-blob.ts`: a browser download on the web; the share sheet in the apps (a WebView can't download a blob).
- `src/routes/settings/-components/EvalezySettingsCard.tsx`: the Settings card.
