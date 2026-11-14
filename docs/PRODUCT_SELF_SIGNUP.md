# Product self sign-up playbook

How self sign-up works on Evalezy, every place Evalezy shows up, and what to do to give another product the same flow.

Checked against the code on 7 Nov 2026. File and line references are from that date, so search by name if a line has moved.

## Contents

1. [The idea in short](#1-the-idea-in-short)
2. [The full flow](#2-the-full-flow)
3. [Rules and limits](#3-rules-and-limits)
4. [Where Evalezy shows up](#4-where-evalezy-shows-up)
5. [Product settings](#5-product-settings)
6. [Add sign-up to a new product](#6-add-sign-up-to-a-new-product)
7. [Not built yet](#7-not-built-yet)
8. [Automated tests](#8-automated-tests)
9. [Code map](#9-code-map)

---

## 1. The idea in short

A product is **not a separate backend**. It is three things:

| Piece | What it is |
|---|---|
| Settings row | `ai_platform_settings`, key `product.<key>`, value JSON: sender, trial days, sign-up on/off, return hosts, alerts |
| Marker on the institute | `institutes.product = '<key>'` |
| Front end | The same admin dashboard bundle, optionally held in a small shell (`/evalezy`) |

A visitor proves their email (email OTP or Google), fills one form, and gets an institute, an admin account and a trial straight away, with no manual setup.

```
Website / login page / app
   │  /signup/start?product=evalezy&source=website&plan=starter
   ▼
GET /config ── closed or unknown product ──► "Sign-up is closed right now"
   │
   ├─ Email:  POST /request-otp ─► mail with code ─► POST /verify-otp
   ├─ Google: /oauth2/authorization/google ─► back to /signup/start
   │            account already exists ─► tokens ─► straight into the app
   ▼
Signed proof token (30 minutes)
   ▼
Details form ─► POST /signup
   ▼
Institute + admin + credits + welcome mail + team alert
   ▼
Tokens returned ─► handleLoginFlow ─► redirect to app_path (/evalezy)
```

All endpoints are public, under `/auth-service/v1/self-signup` (allowed at `ApplicationSecurityConfig.java:94`).

---

## 2. The full flow

### Step 1: Entry

| From | Link | State |
|---|---|---|
| Website buttons | `https://dash.vacademy.io/signup/start?product=evalezy&source=website&plan=<plan>` | **Only in `evalezy_landing` PR #5, still open.** `main` has no sign-up link |
| Login page, "Create One" (web, Evalezy mode) | `/signup/start?product=evalezy` | Live |
| Login page, Google (web, Evalezy mode) | Straight into the Google step, `source=login` | Live |
| Evalezy mobile app, "Create One" | Same page, without the Google button | Built; the app is not on the stores |

Query params read by `start.tsx`: `product`, `plan`, `source` or `utm_source`, `campaign` or `utm_campaign`. If `product` is missing, it **defaults to `evalezy`** (`start.tsx:25`), so always send it for a new product.

### Step 2: Load the screen

`GET /config?product=<key>` returns only safe fields. Live answer on 7 Nov 2026:

```json
{"product":"evalezy","display_name":"Evalezy","trial_days":3,"logo_url":"/evalezy-logo.svg","app_path":"/evalezy"}
```

- Unknown key, or `self_signup_enabled` off: 400, and the page shows "Sign-up is closed right now" with a login link.
- The sender address is never exposed here.

### Step 3A: Prove the email by OTP

1. The visitor enters an email. `POST /request-otp {product, email}`.
2. The backend checks the product, email format and rate limits, and refuses if the email already has an account ("Please log in instead").
3. The OTP mail goes out with subject `Your <display_name> verification code`. Sender, name, website, contact and colour all come from the product settings (`OtpBrand.java`). The caller can only name a product, not an address.
4. The visitor enters the code. `POST /verify-otp {product, email, otp}`. The code lasts 10 minutes.
5. The backend returns `signup_token` and moves to the form.

On screen: resend after 30 seconds, 3 resends at most, and a "change email" link.

### Step 3B: Prove the email by Google (web only)

The app has no Google button because Google refuses sign-in inside a WebView.

1. `startGoogleSignup` builds a base64 `state`: `{from: <this page with its params>, account_type: 'signup', user_type: 'admin', product}`.
2. The browser goes to `/auth-service/oauth2/authorization/google?state=...`.
3. `CustomOAuth2SuccessHandler` receives the Google result. It first checks the return URL with `OAuthReturnUrlPolicy`, and an unknown host goes to the admin portal with an error. Then:
   - **Account already exists:** redirects to `from` with `accessToken` and `refreshToken`. The page signs them in and goes to `app_path`.
   - **New account:** redirects with `signupData` (name, email) and adds `signupToken` only if Google marks the email verified, sign-up is open, and the return host is in `return_hosts`.
4. The page reads these params once and removes them from the address bar (`consumeGoogleReturn`).
5. No `signupToken` means "Google failed", and the page stays on the method step.

### Step 4: Details form

| Field | Email OTP | Google | Rule |
|---|---|---|---|
| Email | Read-only | Read-only | Comes from the proof token, never from the form |
| Full name | Asked | Prefilled | Required |
| Phone | Asked | Asked | 10 to 15 digits with country code; format only, **no OTP** |
| Username | Asked, prefilled from the email | Not asked, generated | `^[A-Za-z0-9._-]{4,40}$`, must be free |
| Password | Asked | Not asked, generated (16 characters) | At least 8 characters |
| Institute name | Asked | Asked | Required on screen; the backend falls back to the full name |
| Institute type | Asked | Asked | `school, coaching, college, university, company, other` |
| Teachers | Asked | Asked | Bands stored as `1, 5, 15, 16` |
| City | Asked | Asked | Required on screen |
| State | Asked | Asked | From the GST state list, required on screen |

### Step 5: Create everything

`POST /signup` runs `SelfSignupManager.signup`. It validates first, so a bad username cannot leave an orphan institute.

| Created | Value |
|---|---|
| Institute | `product = <key>`, `lead_tag = FREE_TRIAL`, `demo_expires_at = now + trial_days`, module id `1` (Assess) |
| Admin user | Only the admin role can be created here (`AuthManager.java:151`). Phone is saved on both user and institute |
| Credits | `demo_credits` from settings; if never set, the platform default |
| Welcome mail | From the product sender, with login details and `login_url`. A mail failure does not undo the account |
| Team alert | Async mail and WhatsApp to the recipients in settings; never holds up or fails a sign-up |
| Log line | `[self-signup] signup_completed product= method= institute= trial_ends= plan= source= campaign=` |

**Deliberately not used:** `institute_trial`. That table blocks login when it expires, and these customers must keep their reports and be able to pay.

### Step 6: Enter the app

The response has the tokens. `enterApp` runs `handleLoginFlow({loginMethod: 'signup'})`, then `window.location.href = app_path`. The path is relative, so the user stays on the host they signed up on.

- Signed up on `evalezy.vacademy.io`: they land in the Evalezy shell and stay there.
- Signed up on `dash.vacademy.io`: they land on `/evalezy`, but a later login on `dash` shows the **full portal**.

### Step 7: During and after the trial

`ai_service` `get_trial_status` (`credit_service.py:890`) says an institute is on trial when all of these hold:

- Its `product` has a `product.<key>` settings row.
- `lead_tag = 'FREE_TRIAL'` and `demo_expires_at` is set.
- It has no `PURCHASE` or `ADMIN_GRANT` credit row, and no live AI plan.

| After expiry | Result |
|---|---|
| Login, reports, data | Keep working |
| `TrialBanner` | "Your free trial has ended. Your reports are safe." with Recharge |
| AI calls through `check_credits` | Refused |
| Credit quotes | Zero balance |

Buying or being granted credits ends the trial for good. Closing sign-up does not affect running trials.

---

## 3. Rules and limits

| Limit | Value | Where |
|---|---|---|
| OTP sends per email | 4 in 10 minutes | `SelfSignupRateLimiter.java:27` |
| OTP sends per network | 30 in 10 minutes | `:28` |
| Code guesses per email | 10 in 10 minutes | `:33` |
| Sign-ups per network | 5 a day | `:38` |
| OTP life | 10 minutes | `OTPService.java` |
| Proof token life | 30 minutes, purpose `self-signup` | `SelfSignupTokenService.java:29` |
| Settings cache | 60 seconds; keeps the last good copy if admin-core is down | `ProductConfigClient.java:29` |
| Product key format | `^[a-z0-9_-]{1,32}$` | `ProductConfigClient.java:31` |

---

## 4. Where Evalezy shows up

"Settings" means a new product gets this by filling its row. "Code" means it needs a code or asset change.

### Website: `evalezy_landing`

| Where | What | New product |
|---|---|---|
| `src/lib/site.ts:22-32` (PR #5) | `LOGIN_URL`, `SIGNUP_URL`, `TRIAL_DAYS = 3`, `signupHref()` | Code. **`TRIAL_DAYS` is static**, so changing trial days on the dashboard does not change the website |
| `Nav.tsx:78, 176` (PR #5) | "Start 3-day trial" button, desktop and mobile | Code |
| `pricing/page.tsx:51, 94` (PR #5) | Trial line, plan buttons | Code |
| `Interactive.tsx:244` (PR #5) | Price calculator button | Code |

### Mails

| Mail | What shows | New product |
|---|---|---|
| Sign-up OTP | Subject, From, website, contact, theme colour | Settings |
| Login OTP in Evalezy mode | Same brand (`EmailOtpForm.tsx:122` sends `product: 'evalezy'`) | Code |
| Welcome | From name and address, login link | Settings; read the body once for platform wording |
| New sign-up alert to the team | Template `product_signup_alert`, `{{1}}` is the product name | Settings; one approved template serves all products |

### Sign-up screen

| Where | What | New product |
|---|---|---|
| `SelfSignupFlow.tsx:296` | Logo | Settings |
| Subtitle, button | Trial days | Settings |
| `SelfSignupFlow.tsx:55, 83, 325` | All wording comes from the `evalezy` translation namespace | Code |
| `SelfSignupFlow.tsx:37, 39` | Institute types and teacher bands: school wording | Code, if the product is not for schools |

### Login page and browser tab (Evalezy mode only)

| Where | What | New product |
|---|---|---|
| `evalezy-mode.ts:24` `loginLogo` | Evalezy logo on the login page | Code |
| `index.tsx:303-310` | Tab title "Evalezy", favicon, logo store | Code |
| `login-form.tsx:74` | GitHub login hidden | Code |
| `login-form.tsx:514-517` | Google goes through sign-up | Code |
| `login-form.tsx:527-528`, `:832` | "Create One" always shows and opens `/signup/start` | Code |
| `EmailOtpForm.tsx:519-528` | Same "Create One" on the OTP form | Code |
| `domain-routing.ts:278` | App resolves no institute, keeps its own brand | Code |
| `public/_routes.json:30-31` | Logo and favicon served as static files | Code |

### Evalezy shell

| Where | What | New product |
|---|---|---|
| `routes/evalezy/*` | The whole product UI: list, new, assessment, settings, credits, profile | Code, its own screens |
| `EvalezyHeader.tsx` | Header, credit chip, ⋮ menu | Code |
| `TrialBanner.tsx` (mounted in `evalezy/route.tsx`) | Trial banner; links to `/evalezy/credits` | Code, needs mounting in the new shell |
| `__root.tsx:95, 131, 226` | Keeps signed-in users in the shell; no assistant, dock or popups | Code |
| `evalezy-mode.ts:37-42, 52` | Allowed paths; portal links mapped into the shell | Code |
| `public/locales/{en,hi,fr,ar}/evalezy.json` | All wording | Code |
| Setting `evalezy.enabled` | "Turned off" page per institute | Code |

### Shared portal screens that behave differently in the shell

These check `isInEvalezyShell()`, so a new shell gets the portal behaviour unless it is added:

`TipTapEditor.tsx`, `CopyCheckCriteriaPanel.tsx`, `AiCreditsPanel.tsx`, `TopUpModal.tsx`, `credit-pack-services.ts`, `get-ai-credits.ts`, `QuestionEditorParts.tsx`, `AssessmentQuestionEditDialog.tsx`.

### Full portal

| Where | What | New product |
|---|---|---|
| `sidebar/utils.ts:1236-1242` | Assessments → Evalezy entry | Code |
| `admin-defaults.ts:14`, `teacher-defaults.ts:60` | That entry ships hidden | Code |
| `AssessmentSettings.tsx:219` | Copy-check setting mentions Evalezy | Only if relevant |

### Mobile app

| Where | What | New product |
|---|---|---|
| `flavor.config.ts:108-114` | `appId`, `appName`, `forceEvalezyShell`, `deepLinkHost` | Code |
| `android/app/src/evalezy/res` | Icon, splash | Assets |
| `package.json:58-67` | Build and OTA scripts | Code |
| `public/.well-known/assetlinks.json`, `apple-app-site-association` | App links | Code |
| `scripts/publish-ota.sh:41` | Own OTA version line | Code |
| admin-core `ota.strict-target-app-ids` (`OtaUpdateService.java:34`) | Strict OTA list | Code |
| iOS target, Firebase, Play signing | See the launch checklist in `EVALEZY_APP.md` | Manual |

### Health dashboard: `vacademy-health-check`

Products page: tabs **Sign-ups** (status, credits, extend a trial), **Trial and mail**, **Alerts**, **Pricing**. It lists every `product.*` row (`ProductsPage.tsx:284`), so a new product appears by itself. No code change.

### Hosting

| Where | What | New product |
|---|---|---|
| `evalezy.vacademy.io` | Custom domain on the Cloudflare Pages project `frontend-admin-dashboard`, live since 6 Nov 2026 | Manual, plus code for the host check |
| `institute_domain_routing` | **No row, on purpose.** A row would pin web logins to one institute | Do not add one |

---

## 5. Product settings

One JSON row, edited on the health dashboard. Services read it through `ProductConfigClient`.

| Key | Used for | Evalezy |
|---|---|---|
| `display_name` | Screen, OTP subject, alert | Evalezy |
| `from_email`, `from_name` | Sender of OTP and welcome mail | `hello@evalezy.com`, Evalezy |
| `website_url`, `contact_email` | OTP mail footer | `https://evalezy.com`, `hello@evalezy.com` |
| `theme_color` | OTP mail, format `#RRGGBB` | `#D61C28` |
| `logo_url` | Sign-up screen | `/evalezy-logo.svg` |
| `app_path` | Where the user lands; must be a real route | `/evalezy` |
| `login_url` | Login link in the welcome mail, must be https | `https://evalezy.vacademy.io/login` |
| `trial_days` | Trial for new sign-ups, 0 to 365 | 3 |
| `self_signup_enabled` | Off closes sign-up | true |
| `return_hosts` | Where Google may return; a host covers its subdomains | `vacademy.io,evalezy.com` |
| `demo_credits` | Opening credits, 0 to 100,000; empty means platform default | Set on the page |
| `signup_alert_emails` | Alert mail, up to 20 | Set on the page |
| `signup_alert_whatsapp` | Alert WhatsApp with country code, up to 20 | Set on the page |
| `signup_alert_template`, `signup_alert_language` | Empty means `product_signup_alert`, `en` | Set |
| `whatsapp_waba_id` | Account the template lives on | Set |

Values are the V643 seed and later notes, except the live `/config` fields in step 2. The dashboard is the source of truth.

Admin APIs, under `/admin-core-service/super-admin/v1/products`: list, `PUT /{key}`, `GET /{key}/institutes`, `PUT /{key}/institutes/{id}/trial`, `GET` and `POST /{key}/alert-template`, `POST /{key}/signup-alert/test`.

**There is no "add product" API.** `PUT` on a missing row returns 404, so a new product starts with a migration.

---

## 6. Add sign-up to a new product

### First pick the level

| Level | What the customer gets | Work |
|---|---|---|
| **A. Sign-up only** | Sign-up page and trial, lands in a normal portal page | Settings row, module change, website links |
| **B. Own web shell** | Own host, login look and limited screens | A + the Evalezy mode work for that product |
| **C. Own mobile app** | Store app | B + flavor, assets, app links, OTA, stores |

### Decide these first

- [ ] Product key (lowercase, final, it is stored on institutes)
- [ ] Which modules a new institute gets
- [ ] Trial days and opening credits
- [ ] Sender address and its domain
- [ ] Landing path and login URL
- [ ] Host, if level B
- [ ] Wording of the form: are "institute" and "teachers" right for this customer?

### Step 1: Sender domain

Before any mail, verify the sending domain and check that SPF and DKIM align with the From address. Gmail rejects mail that fails this check (5.7.40), so do not skip it. Send one real OTP to a Gmail address and read the headers.

### Step 2: Settings row (migration in admin-core)

Use the next free `V` number at that time. Keep this inside `admin_core_service/src/main/resources/db/migration`:

```sql
-- Sign-up settings for <Product>.
INSERT INTO ai_platform_settings (setting_key, setting_value, updated_by, updated_at)
VALUES (
    'product.<key>',
    jsonb_build_object(
        'display_name', '<Product>',
        'from_email', 'hello@<domain>',
        'from_name', '<Product>',
        'website_url', 'https://<domain>',
        'contact_email', 'hello@<domain>',
        'theme_color', '#000000',
        'logo_url', '/<key>-logo.svg',
        'app_path', '/<route>',
        'login_url', 'https://<host>/login',
        'trial_days', 3,
        'self_signup_enabled', false,
        'return_hosts', 'vacademy.io,<domain>'),
    'migration',
    now())
ON CONFLICT (setting_key) DO NOTHING;
```

Start with `self_signup_enabled` **false**, and open it from the dashboard after testing.

> **Warning: this row changes the trial check.** Every institute with that `product` value, tagged `FREE_TRIAL` with an end date, comes under the trial gate. Never add `product.vacademy`. Check before reusing any key that already has institutes, such as `vimotion` (`VimotionAuthManager.java:257`):
>
> ```sql
> SELECT count(*) FROM institutes
> WHERE product = '<key>' AND lead_tag = 'FREE_TRIAL' AND demo_expires_at IS NOT NULL;
> ```

### Step 3: Code that is still Evalezy-only

**Needed at level A:**

| File | Change |
|---|---|
| `SelfSignupManager.java:48` | Module id is fixed to `1`. Add a `module_ids` setting (read it through `ProductConfigDTO`) instead of a second constant |
| `SelfSignupManager.java:54` and `SelfSignupFlow.tsx:37, 39` | Institute types and teacher bands, if the audience differs |
| `SelfSignupFlow.tsx:55, 83, 325` | Move sign-up wording out of the `evalezy` namespace, or add a namespace per product |
| `public/<key>-logo.svg`, `public/_routes.json` | Logo and its static route |
| Common library | `ProductConfigDTO` lives in common, so a new field means a common release first |

**Added at level B:**

| File | Change |
|---|---|
| `lib/evalezy-mode.ts` | Generalise this once, into a small list of products with host, home path, allowed paths and logo. **Do not copy the file per product.** The checks below then read from it |
| `__root.tsx:95, 131, 226` | Use the generic mode |
| `index.tsx:303-310` | Title, favicon, logo from the product |
| `login-form.tsx:74, 514-528, 832` | Replace `isEvalezyMode()` and the `'evalezy'` literals |
| `EmailOtpForm.tsx:122, 519-528` | Same |
| `domain-routing.ts:278` | Same |
| `TrialBanner.tsx` | Move out of `routes/evalezy`; credits link from the product |
| Cloudflare Pages | Add the host as a custom domain. No `institute_domain_routing` row |

**Added at level C:** everything under "Mobile app" in section 4, plus the iOS, Firebase and Play steps in `EVALEZY_APP.md`. App stores also expect in-app account deletion, so check that it exists.

**The portal must not change.** Compare the portal login and screens before and after the mode refactor.

### Step 4: Website

- Link to `https://<host>/signup/start?product=<key>&source=website&plan=<plan>`.
- Use the product's own host once it is live, so users land in the right shell.
- Keep the trial days on the site in line with the dashboard: the site does not read the setting.
- A product on its own domain must list it in `return_hosts`, or its Google sign-up is refused.

### Step 5: Deploy order

1. Common library, if changed. A service deployed at the same time can pull the old snapshot and fail; re-run it after common finishes.
2. admin-core (runs the migration).
3. notification, then auth.
4. ai-service, if changed.
5. Admin front end.
6. Website.

### Step 6: Go-live test

Use a `+alias` test email and write down what to clean up.

- [ ] `/config` shows the right name, trial days and logo
- [ ] Sign-up closed: the page says so
- [ ] Sign-up open, email OTP: full sign-up works
- [ ] OTP and welcome mail come from the right address; Gmail headers show SPF and DKIM pass
- [ ] Welcome mail body has no other product's or platform's name, and its login link works
- [ ] Wrong code, expired code, used email, used username each show a clear message
- [ ] Google, new account: returns to the form with name and email filled
- [ ] Google, existing account: signs straight in
- [ ] Check the name on the Google consent screen; it belongs to the shared OAuth client
- [ ] Institute row: `product`, `lead_tag`, `demo_expires_at`, modules, credits
- [ ] Lands on `app_path`; trial banner shows days left
- [ ] Set `demo_expires_at` in the past on the test institute: banner changes, reports open, AI refused
- [ ] Recharge ends the trial
- [ ] Alert mail and WhatsApp arrive ("Send test alert" on the Alerts tab, then a real one)
- [ ] The product shows on the dashboard's Sign-ups tab
- [ ] Portal login on `dash.vacademy.io` unchanged
- [ ] Open sign-up from the dashboard; delete or mark the test institute

---

## 7. Not built yet

| Item | Effect |
|---|---|
| Sign-up link on the Evalezy website | `evalezy_landing` PR #5 is still open |
| `plan`, `source`, `campaign` storage | Only logged; not on the institute, so no funnel numbers |
| Host decides the shell | Sign-ups on `dash.vacademy.io` see the full portal on later login; link to the product's own host |
| Trial reminders, yearly plan payment | Later phase |
| Role and pages-a-month | Not asked: no column for them |

---

## 8. Automated tests

Extend these for a new product:

- `auth_service/.../selfsignup/service/SelfSignupManagerTest.java`
- `auth_service/.../selfsignup/controller/SelfSignupControllerTest.java`
- `auth_service/.../core/config/OAuthReturnUrlPolicyTest.java`, `CustomOAuth2SuccessHandlerReturnUrlTest.java`
- `admin_core_service/.../product_config/service/PlatformProductServiceTest.java`, `ProductAlertServiceTest.java`
- `notification_service/.../email_otp/service/OtpBrandTest.java`
- `ai_service/tests/test_credit_trial_gate.py`
- `frontend-admin-dashboard/src/lib/evalezy-mode.test.ts`

---

## 9. Code map

| Area | Path (in `vacademy_platform` unless noted) |
|---|---|
| Sign-up API | `auth_service/.../feature/selfsignup/` (controller, `SelfSignupManager`, token, rate limit, alert client, DTOs) |
| Create institute and admin | `auth_service/.../feature/auth/manager/AuthManager.java:135` |
| Welcome mail | `auth_service/.../feature/auth/service/AuthService.java:486` |
| Login OTP brand | `AuthManager.java:379` |
| Google return | `auth_service/.../core/config/CustomOAuth2SuccessHandler.java`, `OAuthReturnUrlPolicy.java` |
| Settings read | `common_service/.../internal_api_wrapper/ProductConfigClient.java`, `common_service/.../product/ProductConfigDTO.java` |
| Settings store | `admin_core_service/.../features/product_config/` (`PlatformProductService`, `ProductSignupService`, `ProductAlertService`, `PlatformWhatsAppClient`, controllers) |
| Migrations | `admin_core_service/src/main/resources/db/migration/V643`, `V644` |
| Opening credits | `admin_core_service/.../features/institute/service/UserInstituteService.java:150` |
| OTP mail | `notification_service/.../features/email_otp/service/OTPService.java`, `OtpBrand.java` |
| Trial check | `ai_service/app/services/credit_service.py:890` |
| Sign-up screens | `frontend-admin-dashboard/src/routes/signup/` (`start.tsx`, `-components/SelfSignupFlow.tsx`, `-services/self-signup.ts`) |
| Product mode | `frontend-admin-dashboard/src/lib/evalezy-mode.ts` |
| Product UI | `frontend-admin-dashboard/src/routes/evalezy/` |
| App build | `frontend-admin-dashboard/flavor.config.ts`, `EVALEZY_APP.md` |
| Products page | `vacademy-health-check/src/pages/ProductsPage.tsx`, `src/components/products/` |
| Website | `evalezy_landing/src/lib/site.ts`, PR #5 |
| App launch steps | `frontend-admin-dashboard/EVALEZY_APP.md` |
