# Live store tracking — what each store lets us read, and what it needs

How an institute's App Status page (Settings → App Status) learns that a review started, a
release went live, or a store pulled an app, without anyone typing it in.

Verified against the live APIs on 2026-08-31.

## What is tracked, and by which API

| Platform | API | Auth | What it answers |
|---|---|---|---|
| iOS | App Store Connect `/v1/apps` + `/v1/appStoreVersions` | JWT (ES256) signed with a `.p8` key | Review/release state, version, build |
| **macOS** | **the same API**, `filter[platform]=MAC_OS` | same key | Same, for the Mac App Store release |
| Android | Play Developer API (`androidpublisher`) | Google service account with Play Console access | Production track release status, name, version code |
| **Windows** | Microsoft Store submission API (`manage.devcenter.microsoft.com/v1.0/my`) | Microsoft Entra (Azure AD) client credentials, linked to Partner Center | Submission status of the app's latest/pending submission |

Two things worth knowing before wiring anything up:

- **macOS is not a separate integration.** One App Store Connect app record holds the versions for
  every platform that bundle ships on, so the Mac App Store answer comes from the same key as iOS —
  it is only a matter of asking for the right platform. Shiksha Nation and ZOE both ship iOS and
  macOS under *one* bundle id, and their versions differ (ZOE: iOS 2.5.5, Mac 1.0.1 with a 1.0.2
  still unsubmitted). Without `filter[platform]`, the Mac row silently reports the iPhone version —
  which is what the code did until this was fixed.
- **Windows: use the devcenter API, not the newer one.** Microsoft's newer "Store submission API"
  is for MSI/EXE installers and explicitly does not support MSIX/packaged apps. Both Windows apps
  here are AppX/MSIX built by electron-builder (`ShikshaNation.ShikshaNationApp`,
  `ShikshaNation.ZOEEdtech`, publisher `CN=86D745F8-F119-414C-B1CF-5361E8FE4A25`), so the
  applicable API is the Partner Center / devcenter one the client already targets.

What is **not** live, and deliberately so:

- **OTA bundle** — that is our own `ota_bundle_version` table, read directly by admin_core. No
  store is involved.
- **Reviews/ratings** — no provider implements `getReviews` yet; it answers 501 rather than
  inventing an empty list.
- **Public store pages** give a partial answer with no credential at all (Play: version + updated
  date; App Store: version + date; Microsoft: title, publisher and updated date but *no version*).
  Useful as a cross-check, not as the tracker — none of them expose review state.

## Credentials

Resolution order, per institute and platform (`StoreCredentialResolver`):

1. an institute's own `store_credential` row,
2. the shared default row (`institute_id IS NULL`),
3. **App Store Connect only:** the `APP_STORE_CONNECT_*` env vars from `vacademy-secrets`.

**There are two Apple teams and it matters.** Vidyayatan (`35NLZB49QN`) owns most brands; a second
team (`7XKD5M7288`) owns Shiksha Nation and ZOE — including both Mac apps. The env fallback holds
only one of them, so without an institute-specific row, SN and ZOE resolve to a key that cannot see
their apps. Verified live: every other brand answers under Vidyayatan; `io.shikshanationapp.com`
and `io.zoeedtech.app` answer only under the second team.

A credential that cannot see an app is **not** treated as "app not registered" — the sync leaves
the recorded status untouched and reports "couldn't sync". A scheduled sweep that mistook one for
the other would overwrite verified releases with a falsehood several times a day.

### Table

`store_credential` is created from the JPA entity where `ddl-auto` runs. Where it does not, this is
the equivalent:

```sql
CREATE TABLE IF NOT EXISTS public.store_credential (
    id              varchar(255) PRIMARY KEY,
    institute_id    varchar(255),
    platform        varchar(255) NOT NULL,
    provider        varchar(255) NOT NULL,
    label           varchar(255),
    credential_json jsonb        NOT NULL,
    created_at      timestamp,
    updated_at      timestamp
);
CREATE INDEX IF NOT EXISTS idx_store_credential_lookup
    ON public.store_credential (institute_id, platform, provider);
```

### Rows to add

Placeholders only — paste the real values in at the prompt, never into a file in the repo.

```sql
-- Apple, second team: Shiksha Nation + ZOE, iOS and macOS.
-- The p8 is the whole PEM including the BEGIN/END lines.
INSERT INTO store_credential (id, institute_id, platform, provider, label, credential_json)
VALUES
 (gen_random_uuid()::text, '35675130-7c65-41d6-a869-0811d2e1753e', 'IOS',   'APP_STORE_CONNECT',
  'Shiksha Nation Apple team 7XKD5M7288',
  jsonb_build_object('issuerId','<issuer>','keyId','<key id>','p8','<p8 contents>')),
 (gen_random_uuid()::text, '35675130-7c65-41d6-a869-0811d2e1753e', 'MACOS', 'APP_STORE_CONNECT',
  'Shiksha Nation Apple team 7XKD5M7288',
  jsonb_build_object('issuerId','<issuer>','keyId','<key id>','p8','<p8 contents>')),
 (gen_random_uuid()::text, 'c34c472c-2433-4a2c-aae2-fad1ce5e47d7', 'IOS',   'APP_STORE_CONNECT',
  'ZOE Apple team 7XKD5M7288',
  jsonb_build_object('issuerId','<issuer>','keyId','<key id>','p8','<p8 contents>')),
 (gen_random_uuid()::text, 'c34c472c-2433-4a2c-aae2-fad1ce5e47d7', 'MACOS', 'APP_STORE_CONNECT',
  'ZOE Apple team 7XKD5M7288',
  jsonb_build_object('issuerId','<issuer>','keyId','<key id>','p8','<p8 contents>'));

-- Google Play, shared default (institute_id NULL): one service account that the Play Console has
-- granted "View app information" on every app. Create it in Google Cloud, then invite its email
-- under Play Console → Users and permissions.
INSERT INTO store_credential (id, institute_id, platform, provider, label, credential_json)
VALUES (gen_random_uuid()::text, NULL, 'ANDROID', 'GOOGLE_PLAY', 'Play Developer API service account',
        jsonb_build_object('serviceAccountJson','<the whole service-account JSON, as a string>'));

-- Microsoft Partner Center: an Entra app registration added to the Partner Center account that
-- owns publisher CN=86D745F8-… (Shiksha Nation). Partner Center → Account settings → User
-- management → Azure AD applications.
INSERT INTO store_credential (id, institute_id, platform, provider, label, credential_json)
VALUES (gen_random_uuid()::text, NULL, 'WINDOWS', 'PARTNER_CENTER', 'Shiksha Nation Partner Center',
        jsonb_build_object('tenantId','<tenant>','clientId','<client id>','clientSecret','<secret>'));
```

Google Play and Partner Center have **no env fallback** — without a row, those platforms simply
never sync, which is why they have never been exercised against a real account.

### Per-app identifiers the sync needs

The sync looks the app up by the identifier recorded on that platform, so an app with the field
blank is skipped:

| Platform | Registry field |
|---|---|
| iOS / macOS | `bundle_id` |
| Android | `package_name` |
| Windows | `store_id` (e.g. `9MV551BT3G1D`) |

## Getting the two missing credentials

### Google Play

The apps are spread over **three Play developer accounts**, and a service account is invited per
account — so one service account has to be invited three times:

| Play account | Apps |
|---|---|
| Vidyayatan Technologies LLP | HCCA, The 7Cs, Edzumo, Uplift, iThinkers, Elevate, SSDC, Chanakya |
| SHIKSHA NATION | Shiksha Nation, ZOE |
| STEMX INNOVATIONS PRIVATE LIMITED | STEMx — the client's own account |

1. **Google Cloud** → pick or create a project → *APIs & Services → Library* → enable
   **Google Play Android Developer API**.
2. *IAM & Admin → Service Accounts* → **Create service account** (e.g. `play-status-reader`). No
   IAM project role is needed — Play grants its own permissions. Then **Keys → Add key → JSON** and
   keep the file.
3. In **each** of the three Play accounts: *Users and permissions → Invite new users* → paste the
   service account's `…@….iam.gserviceaccount.com` address → grant **View app information** and
   **Release apps to testing tracks** → All apps. Service accounts accept automatically.

The second permission is not decoration: the status read goes through the Play *edits* API
(`POST edits` → `GET edits/{id}/tracks/production` → `DELETE edits/{id}`), and creating an edit is
refused to a view-only account. Nothing is ever committed — the edit is deleted, so it cannot
publish or change a release.

### Microsoft Partner Center

Do this in the **Shiksha Nation** Partner Center account (the one that owns publisher
`CN=86D745F8-F119-414C-B1CF-5361E8FE4A25`); the apps live there, not under Vidyayatan.

1. *Settings → Account settings → Tenants* — associate a Microsoft Entra tenant if none is linked.
2. *Account settings → User management → Azure AD applications* → **Add Azure AD application** →
   create a new one (e.g. `vacademy-store-status`) → role **Manager**.
3. Collect **Tenant ID**, **Client ID**, and a **client secret** (Partner Center's "Add new key" on
   that application shows the value once; Entra → App registrations → Certificates & secrets works
   too).

## Schedule

`StoreStatusScheduler` sweeps every enabled platform of every non-archived app at 00:10, 06:10,
12:10 and 18:10 IST (`appregistry.store-sync.cron`), and can be turned off with
`appregistry.store-sync.enabled=false`. Store review states move over hours, not minutes, and each
sweep spends one API call per platform against quotas shared with the release tooling. A sweep is
idempotent: one that changes nothing writes the same values back.

Ops can still pull a single app's status on demand from health-check; the schedule only means
nobody has to.
