# Ad Performance + Social Posting: App Reviews and Registration

What has to be registered, applied for and approved on the Meta and Google side before institutes can connect their ad accounts and social profiles in the CRM. Without these approvals, everything works only for accounts owned by people who have a role on our own developer apps.

> Written 2026-11-09 for the first release (Meta and Google only). LinkedIn and X come later; their requirements are listed at the end so nobody is surprised.
>
> Platform rules change often. Every requirement below was true when written. Check the linked console page before you submit.

Related: [ADS_AND_SOCIAL.md](ADS_AND_SOCIAL.md) (how the feature works).

---

## 0. Start these today

Approvals take one to six weeks and run in parallel. The code can ship before they land, but no customer can connect until they do.

| # | What | Where | Typical wait | Blocks |
|---|---|---|---|---|
| 1 | Meta Business Verification (if not already green) | Meta Business Manager → Security Centre | 2–10 days | Every Meta Advanced Access request below |
| 2 | Meta App Review for the ads and posting permissions | developers.facebook.com → Vacademy CRM app → App Review | 1–3 weeks; resubmits are common | Meta Ads dashboard + FB/IG posting for other institutes |
| 3 | ~~Meta Access Verification~~ | Probably retired. Meta reportedly dropped it in October 2026 (unconfirmed on Meta's own site). The panel used to sit at App Dashboard → **Basics → Verifications → Access verification**; it is not under App Review. If the panel is gone, skip this step. | — | — |
| 4 | Google Ads API access level for the Cloud project | Google Cloud Console → Google Ads API → Overview → apply | Explorer: usually instant. Basic: ~1–3 weeks | Every Google Ads call (we are blocked today: `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`) |
| 5 | Google OAuth consent-screen verification for the new sensitive scopes | Cloud Console → Google Auth Platform → Data access + Verification centre | 1–4 weeks | Removes the "unverified app" warning and the 100-user cap |
| 6 | Google Business Profile API access | GBP API access request form (project number) | 1–3 weeks; denials happen | Posting to Google Business Profile |

---

## 1. Meta (Facebook, Instagram, Meta Ads)

We extend the existing **Vacademy CRM** Meta app (app id `963481532943035`, already used for Lead Ads). We do not need a new app.

### 1.1 Permissions we request

Status as of the 17 Aug 2026 approved submission:

| Permission | Used for | Status |
|---|---|---|
| `ads_read` | Read spend, clicks and impressions per campaign per day (`/act_{id}/insights`) | **Submit** |
| `business_management` | List ad accounts and Pages owned through a Business Manager. Our connect flows ask for it. | **Submit.** It is in the Lead Ads scope list but was never approved, so non-role users never actually get it. |
| `pages_manage_posts` | Publish posts, photos and videos to the Page | **Submit** |
| `instagram_basic` | Read the linked Instagram business account (username, followers) | **Submit** |
| `instagram_content_publish` | Publish images and Reels to Instagram | **Submit** |
| `pages_show_list` | List the Pages the admin manages | Approved (May 2026), renewed Aug |
| `pages_read_engagement` | Page name, follower count, Page access token | Approved (Aug 2026) |
| `pages_manage_metadata`, `pages_manage_ads`, `leads_retrieval`, `public_profile` | Lead Ads (existing) | Approved, renewed Aug 2026 |

Each submission re-reviews the existing permissions as "Existing access for renewal", so the screencast must still show Lead Ads working.

To add the five new ones: App Dashboard → **App Review → Permissions and Features** → search each name → **Request advanced access**. They then show up in the "Not submitted" box on the App Review page; fill in the usage text and the screencast for each, then submit.

We do **not** request `ads_management`. The dashboard reads spend only. The "move budget" suggestion is advice; nothing writes to the ad account.

### 1.1a Unlock "Request advanced access" (test calls first)

The button stays grey until the app has made **at least one successful API call with that permission**. The counter shows as "Ready to use (0)", and it can take up to 24 hours after the first call to update. Each permission already has Standard access, which works for anyone with a role on the app, so make the calls yourself:

1. Open **Graph API Explorer** (developers.facebook.com/tools/explorer). Pick the **Vacademy CRM** app and **User Token**, tick `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` and `instagram_content_publish`, then click **Generate Access Token** and approve the Vacademy Page and its Instagram account.
2. Run these, one per permission:

| Permission | Call | Side effect |
|---|---|---|
| `business_management` | `GET me/businesses` | none |
| `ads_read` | `GET me/adaccounts?fields=account_id,name`, then `GET act_<id>/insights?date_preset=last_7d&level=campaign&fields=campaign_name,spend` | none |
| `instagram_basic` | `GET me/accounts?fields=name,instagram_business_account`, then `GET <ig-id>?fields=username,followers_count` | none |
| `instagram_content_publish` | `GET <ig-id>/content_publishing_limit` (or `POST <ig-id>/media` with an `image_url`, which creates a container and never publishes it) | none |
| `pages_manage_posts` | Switch the token to the **Page** token (token dropdown), then `POST <page-id>/feed` with `message=API test` and `published=false`, then `DELETE <post-id>` | a hidden post, deleted right after |

3. Come back the next day. Each row should show "Ready to use (1+)", and the button becomes clickable.

Once the feature is deployed, connecting the Vacademy Page from **CRM → Social posts** and sending one post makes the same calls through our own code. That counts as well, and it doubles as the screencast recording.

### 1.2 Marketing API access tier

Reading other businesses' ad accounts at volume needs the **Ads Management Standard Access** feature (App Review → Permissions and Features). Meta grants it only after the app shows real usage: when last checked, roughly 1,500 successful Marketing API calls in 15 days with a low error rate. Until then we run on the development tier's lower rate limits. That is fine for a daily sync of a few dozen institutes.

Plan: launch on development-tier limits with our own and a few pilot accounts (people with a role on the app), let the daily sync build call history, then apply.

### 1.3 Before submitting

- [ ] Business Verification is complete for Vidyayatan Technologies LLP.
- [ ] App is in **Live** mode; privacy policy URL, terms URL, data-deletion URL and app icon are set (App settings → Basic).
- [ ] Facebook Login → Settings → **Valid OAuth Redirect URIs** includes the new callback paths (section 4).
- [ ] App Domains include `vacademy.io` and `backend-stage.vacademy.io`.
- [ ] Business Verification shows green under App Dashboard → Basics → Verifications. If an "Access verification" panel also appears there, complete it; Meta reportedly retired it in October 2026.
- [ ] A test institute on prod has a connected Page, Instagram business account and ad account, so the screencast shows real data.

### 1.4 The screencast (one per permission, or one walkthrough covering all)

Reviewers reject vague videos. Record in English UI, show the Meta login dialog, and show each permission being used:

1. Admin opens **CRM → Ad performance → Connect Meta Ads**. The Meta login dialog lists `ads_read` and `business_management`.
2. Admin picks the ad account. The dashboard fills with spend, clicks and cost per enquiry. Point at a Meta row.
3. Admin opens **CRM → Social posts → Connect Facebook & Instagram**. The dialog lists the Page and Instagram permissions.
4. Admin picks the Page. Facebook and Instagram appear as connected, with follower counts (`pages_read_engagement`, `instagram_basic`).
5. Admin creates a post with an image, ticks Facebook and Instagram, and clicks **Post now**. Then show the live post on the Page and on Instagram (`pages_manage_posts`, `instagram_content_publish`).

Use-case text for each permission: one or two sentences, for example:

> `ads_read`: Education institutes connect their own Meta ad account so our CRM can show how much each campaign spent next to the enquiries and admissions that campaign produced. We read campaign-level spend, impressions and clicks once a day. We never change campaigns.

### 1.5 Instagram rules that cause failed posts

- The Instagram account must be a **Business or Creator** account **linked to the Facebook Page** being connected.
- Images must be **JPEG** and reachable at a public URL Meta can fetch. Videos post as **Reels**.
- Instagram caps API publishes at **100 per account per rolling 24 hours** (read live from `/{ig-user-id}/content_publishing_limit`, checked 2026-11-09).
- An Instagram post must have media; text-only goes to Facebook only.

---

## 2. Google (Google Ads, YouTube Ads, Google Business Profile)

Google Ads and Business Profile sign-in must use a Web OAuth client in our Cloud project **`vacademy-ads-reporting`**, the project the API access is granted to (section 4.2). YouTube keeps its existing client.

### 2.1 Google Ads API access level

Since API v25 the access level belongs to the **Cloud project**, not the developer token. Our project is currently not approved (`CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`).

| Level | Daily operations | Enough for |
|---|---|---|
| Explorer | 2,880 | Pilot: a daily sync for ~50 institutes (one search call per account per day, plus backfill) |
| Basic | 15,000 | Full rollout |
| Standard | Unlimited | Not needed |

Steps:

1. Cloud Console → project `vacademy-ads-reporting` → **Google Ads API → Overview** → apply for **Explorer**. It is usually automated; a project with no billing account can be rejected, so attach billing first.
2. Once live, apply for **Basic** on the same page. Have ready: a short design doc (what we read, how often, that we never write), the screenshot of the dashboard, and the company website.
3. Set the developer token from the manager account **108-442-5700** in prod config (section 4).

Two ways institutes can connect:

- **OAuth (built):** the institute admin signs in with Google and picks a customer id. Works for any account they can access.
- **Manager link (no build needed):** the institute accepts a link request from our manager account 108-442-5700. Useful when an agency runs their ads. The connection then uses our manager login with `login-customer-id`.

### 2.2 OAuth consent screen: new sensitive scopes

| Scope | Feature | Class |
|---|---|---|
| `https://www.googleapis.com/auth/adwords` | Ad spend sync | Sensitive |
| `https://www.googleapis.com/auth/business.manage` | Google Business Profile posting | Sensitive |
| `https://www.googleapis.com/auth/youtube.upload` | YouTube posting (already in use) | Sensitive |

Sensitive scopes need **OAuth app verification**: a verified domain, a privacy policy that names the Google data we use, and a YouTube demo video showing the consent screen and each scope in use. They do **not** need the paid CASA security assessment; that is only for restricted scopes (Gmail, Drive).

Until verified, users see an "unverified app" warning and the app is capped at 100 users.

Checklist:

- [ ] Add both new scopes under **Data access** on the consent screen.
- [ ] Add the new redirect URIs to the OAuth client (section 4).
- [ ] Update the privacy policy page to mention Google Ads reporting data and Business Profile posting, and the Google API Services User Data Policy (Limited Use).
- [ ] Record the demo video (same flow as the Meta one, with Google screens) and submit in the **Verification centre**.

### 2.3 Google Business Profile API

The GBP API starts with **zero quota**. Google must approve the project first.

1. Enable in the Cloud project: **My Business Account Management API**, **My Business Business Information API** and **Google My Business API** (v4, still used for `localPosts`).
2. Submit the **GBP API access request form** with the Cloud **project number**. Requirements Google checks: a verified Business Profile managed by the applicant for 60+ days, a website that matches the business, and a clear use case ("education institutes schedule updates to their own profiles from our CRM").
3. Approval shows as non-zero quota on the API's Quotas page. A denial names the rule that failed; fix it and reapply.

Posting rules:

- Media must be a public URL Google can fetch. Video is not supported in `localPosts`; we send image posts only.
- Use call-to-action `LEARN_MORE` with the link.
- Posts can be rejected after publish for policy (phone numbers in the text, for example). The post's state comes back as `REJECTED`.

### 2.4 YouTube

YouTube upload already exists for course videos (`features/youtube`). Social posts that target YouTube reuse the same connection and upload worker, so there is nothing new to register beyond what that feature already needed.

YouTube Ads spend is not a separate integration: YouTube in-stream ads are Google Ads **video** campaigns and arrive through the Google Ads sync, split out by campaign type.

---

## 3. Who owns what

| Item | Owner | Status |
|---|---|---|
| Meta Business Verification | (assign) | Check |
| Meta App Review submission | (assign) | Not started |
| Google Ads API Explorer → Basic | (assign) | Explorer pending since 10-31 |
| Google OAuth verification | (assign) | Not started |
| GBP API access form | (assign) | Not started |
| Privacy policy update (vacademy.io) | (assign) | Not started |

---

## 4. Config and callback URLs

Filled from the code in this release; see [ADS_AND_SOCIAL.md](ADS_AND_SOCIAL.md) for the full config list.

### 4.1 Redirect URIs to register

| Where | URI |
|---|---|
| Meta app → Facebook Login → Settings → **Valid OAuth Redirect URIs** | `https://backend-stage.vacademy.io/admin-core-service/v1/marketing/oauth/meta/callback` |
| Google Cloud project **vacademy-ads-reporting** → Credentials → the **Web** OAuth client → **Authorized redirect URIs** | `https://backend-stage.vacademy.io/admin-core-service/v1/marketing/oauth/google/callback` |

The existing Lead Ads callback (`/v1/oauth/meta/callback`) and YouTube callback stay as they are.

### 4.2 Which Google OAuth client

Since Google Ads API v25, the API access level belongs to the **Cloud project that owns the OAuth client** making the call, and GBP API quota is granted per project too. So the marketing Google flows must use a client from the project we get approved, **`vacademy-ads-reporting`**:

1. In that project, create an OAuth client of type **Web application**. The existing one there is a Desktop client, used only by the local reporting scripts; Desktop clients can't take a web redirect URI. Add the redirect URI from 4.1.
2. In the same project, enable **Google Ads API**, **My Business Account Management API**, **My Business Business Information API** and **Google My Business API**.
3. Put the client id and secret in the GitHub secrets `MARKETING_GOOGLE_OAUTH_CLIENT_ID` / `MARKETING_GOOGLE_OAUTH_CLIENT_SECRET`.

There is no fallback to the Google Meet / Workspace client (`GOOGLE_OAUTH_CLIENT_ID`). Until those secrets exist, connecting Google Ads or Business Profile answers "Google sign-in is not configured". Sharing the Meet client would merge both grants for a Google user, so disconnecting Meet would also revoke Ads and Business Profile access. The new client needs its own consent screen (adwords, business.manage, openid, email) and the redirect URI `/admin-core-service/v1/marketing/oauth/google/callback`.

### 4.3 Secrets and properties

| GitHub secret / env var | Property | Default | Needed for |
|---|---|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | `marketing.google.ads.developer-token` | empty → Google Ads connect returns 503 "not configured" | Google Ads. Token from manager account 108-442-5700 → API Center |
| `MARKETING_GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | `marketing.google.oauth.client-id` / `-secret` | empty → Google marketing connect returns 503 "not configured" (no fallback to the Meet client) | Google Ads + GBP sign-in (see 4.2) |
| `META_APP_ID` / `META_APP_SECRET` (existing) | `meta.app.id` / `meta.app.secret` | — | All Meta flows (same Vacademy CRM app) |
| `OAUTH_TOKEN_ENCRYPTION_KEY` (existing) | `oauth.token.encryption.key` | — | Encrypting every stored token |
| `MARKETING_META_OAUTH_REDIRECT_URI` | `marketing.meta.oauth.redirect-uri` | the backend-stage URI in 4.1 | Only if the backend host changes |
| `MARKETING_GOOGLE_OAUTH_REDIRECT_URI` | `marketing.google.oauth.redirect-uri` | the backend-stage URI in 4.1 | Only if the backend host changes |
| `MARKETING_META_ADS_CONFIG_ID` / `MARKETING_META_SOCIAL_CONFIG_ID` | `marketing.meta.{ads,social}.config-id` | empty → classic `scope=` login | Only if we move to Facebook Login for Business configurations |
| `MARKETING_META_GRAPH_VERSION` | `marketing.meta.graph-version` | `v23.0` | Bump when Meta deprecates it |
| `GOOGLE_ADS_API_VERSION` | `marketing.google.ads.api-version` | `v26` | Bump when Google sunsets it (roughly yearly) |
| `MARKETING_ADS_SYNC_ENABLED` / `_CRON` | `marketing.ads.sync.*` | on, every 6 h at :20 | Spend sync job |
| `MARKETING_SOCIAL_PUBLISH_ENABLED` | `marketing.social.publish.enabled` | on | Scheduled post publishing |

Only the first two rows need new GitHub secrets. Both are already wired into `.github/workflows/maven-publish-admin-core-service.yml`.

---

## 5. Later: LinkedIn and X

Not built. Requirements, for planning:

- **LinkedIn company pages:** posting as an organization needs `w_organization_social`, which comes only with the **Community Management API**, a restricted product. Apply in the LinkedIn developer portal with a screencast of posts being created for an organization. Approval is not guaranteed, and some reports say the product is closed to new requests; check before building. The person connecting must be a Page admin.
- **X:** no approval process, but posting is pay-per-use. When last checked: about $0.015 per post and about $0.20 per post containing a link (the link price rose 20× in April 2026). Check docs.x.com pricing before committing.
- **Fallback for both:** a posting aggregator (upload-post, bundle.social and similar) skips both approval processes for a monthly fee.
