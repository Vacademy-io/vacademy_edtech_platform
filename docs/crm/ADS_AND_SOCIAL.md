# Ad performance + social posting

Two CRM screens under **CRM → Leads**. Both are institute-admin only in the sidebar.

| Screen | Route | What it answers |
|---|---|---|
| **Ad performance** | `/audience-manager/ad-performance` | What did Meta, Google and YouTube ads cost, and how many **enquiries** and **admissions** in *this CRM* did each produce? |
| **Social posts** | `/audience-manager/social-posts` | Write once, then schedule or post to Facebook Pages, Instagram, Google Business Profile and YouTube from one calendar, with an approval step. |

Status (2026-11-09): built on branch `feat/ads-social`, not deployed. Meta and Google approvals are pending; see [ADS_AND_SOCIAL_APP_REVIEWS.md](ADS_AND_SOCIAL_APP_REVIEWS.md). LinkedIn and X come later.

Everything below is in `admin_core_service`, package `features/marketing`, and in the dashboard, `src/routes/audience-manager/{-marketing,ad-performance,social-posts}`.

---

## 1. Connecting accounts (OAuth)

There is one OAuth flow for four **providers**. Each grant is stored as one `marketing_connection` row:

| Provider | Consent | Scopes | Creates |
|---|---|---|---|
| `META_ADS` | Facebook Login | `ads_read, business_management` | `ad_account` (platform `META`) |
| `GOOGLE_ADS` | Google, dedicated marketing client | `adwords openid email` | `ad_account` (platform `GOOGLE`, MCC children included) |
| `META_SOCIAL` | Facebook Login | `pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, business_management` | `social_account` FACEBOOK (+ INSTAGRAM if linked to the Page) |
| `GOOGLE_BUSINESS` | Google, dedicated marketing client | `business.manage openid email` | `social_account` GOOGLE_BUSINESS (verified locations only) |

YouTube is **not** connected here. It reuses Settings → YouTube Integration (`institute_youtube_credentials`), and the social account list mirrors that connection into a `YOUTUBE` row.

**Flow** (`MarketingOAuthController`, `/admin-core-service/v1/marketing/oauth`):

1. The dashboard calls `POST /initiate?instituteId&provider&frontendOrigin` **with credentials**. This needs an institute admin.
   - It saves an `oauth_connect_state` row (vendor `MKT_<provider>`, 10 min TTL).
   - It returns `{oauth_url, session_key}`.
   - It sets an HttpOnly cookie `mkt_oauth_<state>` holding a random nonce. The nonce's SHA-256 is stored in `oauth_connect_state.browser_nonce_hash` (V661).
2. The browser goes to the consent screen, which redirects to the public `GET /meta/callback` or `/google/callback`.
   - The callback refuses with `invalid_state` unless the cookie matches. This stops an attacker from sending their consent link to someone else and capturing that person's Page or ad account.
   - It exchanges the code server-side; tokens are AES-GCM encrypted (`TokenEncryptionService`) and never reach the browser.
   - It upserts the connection and redirects (302) to the screen with `?mkt_session=<state>&mkt_provider=` or `?mkt_error=`.
3. `use-oauth-return.ts` sees `mkt_session` and opens `ConnectAccountsDialog`. That dialog calls `GET /session/{key}/options` and then `POST /session/{key}/select {external_ids}`.
   - Only the admin who started the flow may call these two endpoints.
   - `select` re-fetches the options server-side and never trusts client-supplied names or tokens.
   - Choosing an already connected account re-binds it and refreshes its Page token. Reconnect works this way.

CORS: `CorsConfig` has one extra mapping for `/…/marketing/oauth/initiate`. It allows credentials and echoes the origin. Every other path keeps `*` without credentials.

Token health: `MarketingConnectionMonitorJob` runs daily at 03:10. It warns 7 days before a Meta token's 60-day expiry and marks expired ones `RECONNECT_NEEDED`. Google access tokens are refreshed per call (`GoogleOAuthTokenService`, 50 min cache). `invalid_grant` marks the connection `RECONNECT_NEEDED`.

---

## 2. Ad performance

### 2.1 Spend sync

`AdSpendSyncService` writes one row per account, campaign and day into `ad_spend_daily`, upserted on `(ad_account_id, campaign_id, day)`. The day is in the ad account's time zone and amounts are in the account currency.

| Platform | Call | Spend | `platform_leads` (reference only) |
|---|---|---|---|
| Meta | `act_<id>/insights?level=campaign&time_increment=1`, filtered to effective_status ACTIVE, PAUSED, ARCHIVED, DELETED, IN_PROCESS, WITH_ISSUES so that stopped campaigns still count | `spend` | max of the `lead` / `onsite_conversion.lead_grouped` / `leadgen_grouped` actions |
| Google | `googleAds:searchStream`, `FROM campaign` by `segments.date` | `cost_micros / 1e6` | `metrics.conversions` |

- First sync backfills `marketing.ads.sync.backfill-days` (180). Later syncs re-fetch the last `refresh-days` (7) through today, because platforms restate recent days.
- `AdSpendSyncJob` runs at `0 20 */6 * * ?` under ShedLock `MarketingAdSpendSyncJob`. A new account is backfilled on a background thread (`marketingSyncExecutor`). "Sync now" in the UI syncs that one account synchronously.
- An auth error sets the account to `ERROR` and the connection to `RECONNECT_NEEDED`. Outcomes are written with targeted UPDATEs, so a disconnect that happens during a sync is not overwritten.
- **Nothing ever writes to an ad account.** The budget suggestion is advice only.

### 2.2 The report: `GET /v1/marketing/ads/performance?from&to`

SQL is in `AdPerformanceSql`; assembly is in `AdPerformanceReportService`. Dates are inclusive, in the institute's lead-report time zone (default Asia/Kolkata), and the range is at most 400 days.

- **Spend** = `ad_spend_daily` of accounts that are not `DISCONNECTED`.
- **YouTube** = Google campaigns whose channel is `VIDEO`. It is reported as its own platform.
- **Enquiries** = active, non-duplicate, non-opted-out `audience_response` rows submitted in the window. Each is attributed in this order:
  1. `source_type`: Meta lead-ad types → META; `GOOGLE_LEAD_ADS` / `GOOGLE_ADS` → GOOGLE, or YOUTUBE when its campaign is a VIDEO campaign.
  2. Otherwise the person's first-touch `utm_attribution.utm_source`: facebook/fb/instagram/ig/meta → META, google/adwords/gads → GOOGLE, youtube/yt → YOUTUBE.

  The campaign is `source_id`, or else a numeric `utm_campaign`. Anything that matches no campaign goes into a per-platform "Other / not matched" row.
- **Admissions** = `user_lead_profile.conversion_status = 'CONVERTED'` with `converted_at` in the window. Each is attributed through that person's **earliest** ad-attributed response of any date. `audience_response.conversion_status` is never written, so do not use it.
- `unattributed` = enquiries and admissions with no ad platform, shown for context.
- **Suggestion**:
  - best = lowest cost per admission among platforms with ≥ 3 admissions;
  - worst = highest cost per admission among other platforms with ≥ 5% of spend;
  - amount = 15% of the worst platform's last-7-day spend, rounded down to ₹1,000.
  - There is no suggestion when spend is in more than one currency.
- The report is cached for 2 minutes. The cache key includes a version built from the institute's accounts (ids, status, `last_synced_at`), and every pod drops it when a sync finishes, connects or disconnects.

Known limitation: organic social traffic tagged `utm_source=instagram` counts as META, the same as paid traffic. Tag organic links with a different source (for example `ig_organic`) if that matters.

Meta lead-ad intake (`MetaLeadAdsStrategy`) now also requests `campaign_id` and `adset_id` so leads join to spend. If Meta rejects those fields, it retries once with the old field list, so lead intake cannot break.

---

## 3. Social posting

### 3.1 Post lifecycle

```
DRAFT ──submit──▶ NEEDS_APPROVAL ──approve (admin)──▶ SCHEDULED ──job──▶ PUBLISHING ──▶ POSTED | PARTIAL | FAILED
   └───────── schedule / post now (admin) ───────────────▲                                   └─ retry (admin) ─▶ SCHEDULED
any editable state ──cancel──▶ CANCELLED        delete = soft (deleted_at), never while PUBLISHING
```

- Staff can draft and submit. Only admins schedule, approve, post now or retry. A staff edit of a SCHEDULED post sends it back to NEEDS_APPROVAL.
- One `social_post` has one `social_post_target` per account, with its own status, attempts, permalink and error. Text per target = `overrides[platform]` if set, else `body`.
- `POST /posts/ai-draft` writes a draft with per-network variants through `LLMService` (use case `marketing`). It saves nothing.

### 3.2 Validation

Rules are in `SocialPostRules`. The composer (`social-utils.ts`) mirrors them and counts characters the same way.

| Network | Rule |
|---|---|
| Facebook | needs text, a link or media |
| Instagram | needs ≥ 1 image (JPEG) or one video; caption ≤ 2,200 chars including the appended link; ≤ 30 hashtags; at most 100 posts per 24 h per account (Meta limit) |
| Google Business Profile | text required, ≤ 1,500 chars; JPG/PNG photos only; no video |
| YouTube | exactly one video; title ≤ 100 chars, description ≤ 5,000 UTF-8 bytes, `<` and `>` stripped |
| All | ≤ 10 media; images and video cannot be mixed |

### 3.3 Publishing

`SocialPostPublishJob` runs at a fixed delay of 60 s under ShedLock `MarketingSocialPublishJob` (lockAtMostFor 10 min). It calls `SocialPublishService.runPublishCycle`:

1. **Claim** due posts with `FOR UPDATE SKIP LOCKED` (20 per pass) and set them to PUBLISHING. Then read them on the **primary**, because a read-only transaction goes to the replica, which may not have the claim yet.
2. **Fast targets first.** Facebook, Instagram and Business Profile publish first. The reaper runs next, and YouTube uploads run last. A slow upload therefore never delays other posts.
3. **Retry only what is safe to retry.**
   - Rate limits and connection failures are retried, up to 3 attempts with backoff 2^n minutes.
   - A timeout or 5xx on the call that *creates* the post is `OUTCOME_UNKNOWN`. The target fails with "it may already be live: check the Page before retrying". Retrying could create a duplicate public post.
   - An auth error fails the target and marks the account `RECONNECT_NEEDED`.
4. **Instagram video** returns a container. Later passes poll its `status_code` and publish it when it reaches FINISHED, giving up after 30 min. If `media_publish` fails transiently, the same container is re-checked; a second one is never built.
5. **Reaper.** A target stuck in PUBLISHING for more than 30 min (3 h for YouTube) becomes FAILED "Interrupted, retry". The post status is then recomputed.

Attempt counts and outcomes are written with targeted UPDATEs (`RETURNING attempts`, `saveTargetOutcome`), never by saving the whole entity.

| Network | API |
|---|---|
| Facebook | Page token. `/{page}/feed` for text or link, `/photos` for one image, unpublished photos plus `attached_media` for several, `/videos` with `file_url` (120 s timeout) |
| Instagram | Page token of the linked Page. `/media` then `/media_publish`, with carousel and REELS containers |
| Google Business Profile | v4 `{account}/{location}/localPosts`, STANDARD topic, optional photo, LEARN_MORE button for the link |
| YouTube | `YoutubeUploadService.publishVideo(...)`, the same code path as recording uploads; privacy `public` |

The dashboard polls the post list every 15 s while anything is PUBLISHING or just came due, every 60 s while posts are scheduled, and not at all otherwise.

---

## 4. Data model

Migrations: `V660__Marketing_ads_and_social.sql` (tables) and `V661__Marketing_oauth_browser_binding.sql` (adds `oauth_connect_state.browser_nonce_hash`).

| Table | Key columns |
|---|---|
| `marketing_connection` | institute, provider, external user, encrypted access/refresh token, `token_expires_at`, status `ACTIVE/RECONNECT_NEEDED/REVOKED` |
| `ad_account` | unique (institute, platform, external_account_id); `login_customer_id` (Google MCC); currency, time zone; status `ACTIVE/ERROR/DISCONNECTED`; `last_synced_at`, `synced_from` |
| `ad_spend_daily` | unique (ad_account_id, campaign_id, day); channel; spend, impressions, clicks, platform_leads |
| `social_account` | unique (institute, platform, external_id); Page token (encrypted) for FB and IG; `parent_external_id` (IG → Page, GBP → account) |
| `social_post` | body, link, `media_json`, `overrides_json`, `scheduled_at`, status, source `MANUAL/AGENT`, approval columns, soft delete |
| `social_post_target` | unique (post, account); status, `container_id`, attempts, `next_attempt_at`, permalink, error |

Disconnecting keeps history: spend rows stay, and the report ignores DISCONNECTED accounts.

---

## 5. API summary

All endpoints are under `/admin-core-service/v1/marketing`, take `?instituteId=`, and return snake_case JSON. Authorisation uses `InstituteAccessValidator.requireInstituteAdmin` or `requireInstituteStaff`, never `validateUserAccess`.

| Endpoint | Who |
|---|---|
| `POST oauth/initiate`, `GET oauth/session/{key}/options`, `POST oauth/session/{key}/select` | admin (options/select: the initiator only) |
| `GET oauth/meta/callback`, `GET oauth/google/callback` | public (state + browser cookie) |
| `GET ads/accounts`, `DELETE ads/accounts/{id}`, `POST ads/accounts/{id}/sync`, `POST ads/sync`, `GET ads/performance` | admin |
| `GET social/accounts`, `GET social/posts`, `GET social/posts/{id}`, `POST social/posts`, `PUT social/posts/{id}`, `POST social/posts/{id}/cancel`, `DELETE social/posts/{id}`, `POST social/posts/ai-draft` | staff (own posts for authors) |
| `DELETE social/accounts/{id}`, `POST social/posts/{id}/approve`, `…/post-now`, `…/retry` | admin |

---

## 6. Configuration

| Property (env) | Default | Notes |
|---|---|---|
| `marketing.meta.graph-version` (`MARKETING_META_GRAPH_VERSION`) | `v23.0` | |
| `marketing.meta.oauth.redirect-uri` | `https://backend-stage.vacademy.io/admin-core-service/v1/marketing/oauth/meta/callback` | register in the Meta app |
| `marketing.meta.{ads,social}.config-id` | empty | empty = classic `scope=` (prod has `META_LOGIN_CONFIG_ENABLED=false`) |
| `marketing.google.oauth.client-id/secret` (`MARKETING_GOOGLE_OAUTH_CLIENT_ID/_SECRET`) | empty | **Web** client in Cloud project `vacademy-ads-reporting`. No fallback: Google connect returns "not configured" until these are set |
| `marketing.google.oauth.redirect-uri` | `…/marketing/oauth/google/callback` | register on that client |
| `marketing.google.ads.developer-token` (`GOOGLE_ADS_DEVELOPER_TOKEN`) | empty | |
| `marketing.google.ads.api-version` | `v26` | |
| `marketing.oauth.frontend-base-url` | `https://dash.vacademy.io` | used when the requesting origin is not allowed |
| `marketing.ads.sync.{enabled,cron,backfill-days,refresh-days}` | `true`, `0 20 */6 * * ?`, `180`, `7` | |
| `marketing.social.publish.{enabled,interval-ms}` | `true`, `60000` | |

The Meta app id and secret reuse `meta.app.id` / `meta.app.secret`. The deploy workflow passes the three Google secrets.

---

## 7. Runbook

| Symptom | Look at |
|---|---|
| Connect returns to the screen with `mkt_error=invalid_state` | The browser did not keep the `mkt_oauth_*` cookie. Check: the dashboard sent initiate with credentials; the consent was finished in the same browser within 10 min; third-party cookies on a white-label domain in Safari or Firefox (the dashboard and backend are different sites there). |
| Google connect: "not configured" | `MARKETING_GOOGLE_OAUTH_CLIENT_ID/SECRET` are not set. |
| Google Ads options: `DEVELOPER_TOKEN_NOT_APPROVED` / `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` | The OAuth client is not in the project the developer token is approved for, or the token is still at Explorer access. |
| Business Profile options empty or 403 | GBP API access has not been granted, or the location is unverified (only locations that can post are offered). |
| Spend looks low for old campaigns | Accounts connected before the effective_status filter need a backfill. Clear `ad_account.synced_from` and sync. |
| Every Meta sync fails with error #100 | Meta rejected a value in the effective_status filter (`MetaGraphClient` / `AdSpendSyncService`). |
| Post FAILED with "may already be live" | Outcome unknown. Check the Page first, then Retry only if the post is not there. |
| IG post FAILED with a 9004/limit error | The account hit the 100 posts per 24 h cap. |
| Numbers stale after a sync | The cache is versioned by `last_synced_at`. If they are still stale, check that the sync actually wrote (`ad_account.last_sync_status`). |

Useful SQL (read replica):

```sql
-- sync health per institute
SELECT platform, name, status, last_sync_status, last_synced_at, synced_from, status_detail
FROM ad_account WHERE institute_id = :inst ORDER BY platform, name;

-- stuck or failed targets
SELECT p.id, p.status, t.platform, t.status, t.attempts, t.next_attempt_at, t.error_message
FROM social_post p JOIN social_post_target t ON t.post_id = p.id
WHERE p.institute_id = :inst AND p.status IN ('PUBLISHING','FAILED','PARTIAL')
ORDER BY p.updated_at DESC LIMIT 50;
```
