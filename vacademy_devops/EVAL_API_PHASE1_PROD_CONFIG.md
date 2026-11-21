# AI Evaluation API, Phase 1: prod config checklist

Status: DRAFT, nothing applied. Written 2026-10-01 against the Phase 1 contracts
(C1 to C8) in `docs/AI_EVALUATION_PUBLIC_API.md`. No secret values belong in
this file or anywhere in the repo.

Phase 1 adds only **two** prod settings: `SUPER_ADMIN_USER_IDS` and the
`assessment.open-api.enabled` flag. Everything else it needs is already
configured, comes from a migration, or is fixed in code by contract. Those
items are listed below so each one gets checked once before the first
partner key is issued.

## Where prod config lives

| Place | What it is | How to change it | Read by |
|---|---|---|---|
| ConfigMap `myconfigmapv1.0` (namespace `default`) | Non-secret env, maintained by hand on prod | `kubectl patch configmap myconfigmapv1.0 --type merge -p '{"data":{"KEY":"value"}}'`, then restart the deployments that read it (envFrom is read when a pod starts) | every service (`envFrom: configMapRef`) |
| Secret `vacademy-secrets` | Secret env, maintained by hand on prod | `kubectl patch secret vacademy-secrets --type merge -p '{"stringData":{"KEY":"value"}}'`, then restart | every service (`envFrom: secretRef`) |
| Deployment env (`kubectl set env deployment/<svc>`) | Set by each service's deploy workflow from GitHub secrets on every deploy; a manual `kubectl set env` of another name stays in place, because the workflows only set the names they list | `kubectl set env deployment/<svc> KEY=value` (this starts a rolling restart by itself) | that one service; **overrides** ConfigMap/Secret values of the same name |
| Helm chart `vacademy_devops/vacademy-services` (`values.yaml`, `templates/configmap.yaml`) | Source of truth for standalone/stage installs only | **Never `helm upgrade` the prod `vac` release** (it renders `vacademy-secrets` with blanks and resets images to `:latest`) | n/a on prod |

The GitHub repo is at its 100-secret limit, so a new prod value goes into the
ConfigMap, the Secret or a manual deployment env, not into a new GitHub secret
plus a workflow line.

Lesson from 2026-10-01 (memory note "Live DB update: assert the NEW value"):
after every patch, read the value back and compare it with what you meant to
write **before** restarting anything:

```bash
kubectl get configmap myconfigmapv1.0 -o jsonpath='{.data.SUPER_ADMIN_USER_IDS}'; echo
```

## 1. New settings (must be set)

| Name | Service(s) | Where on prod | Value | When | Rollback |
|---|---|---|---|---|---|
| `SUPER_ADMIN_USER_IDS` | admin_core (`SuperAdminAuthUtil`, every `/admin-core-service/super-admin/v1/**` endpoint incl. the new api-access and key endpoints, C5), ai_service (`core.security.is_platform_staff`, every `/ai-service/super-admin/v1/**` endpoint incl. per-institute pricing, C4). Any other Java service that calls `SuperAdminAuthUtil` reads it too. | ConfigMap `myconfigmapv1.0` (the chart already defines this key: `values.yaml` `env.superAdminUserIds`). Not secret: it holds user ids, not credentials. | Comma-separated `auth_service` `users.id` values (exact, case-sensitive) of the health-check portal accounts in its `PORTAL_ALLOWED_USERS` Cloudflare Pages secret. Look the ids up read-only: `SELECT id, username FROM users WHERE username IN (...)` on `auth_service`. | **Before** the Phase 1 admin_core deploy (deploy order step 1), so the rollout picks it up. Fails closed: unset or empty means nobody gets super-admin, and the health-check "Pricing & API" tab returns 403. | Restore the previous value (record it before patching), restart admin-core-service and ai-service. |
| `assessment.open-api.enabled` (env form `ASSESSMENT_OPENAPI_ENABLED`; Spring also accepts `ASSESSMENT_OPEN_API_ENABLED`) | assessment_service (the facade under `/assessment-service/open/evaluation/v1/**`, C7) | Deployment env on `assessment-service`: `kubectl set env deployment/assessment-service ASSESSMENT_OPENAPI_ENABLED=true`. Scoped to the one service, and the change restarts it by itself. **Do not add it to `maven-publish-assessment-service.yml`**: that step runs on every deploy and would reset a manual flip. | Code default `false` (facade track). Deploy with `false`, set `true` at deploy order step 6 after super-admin has enabled the pilot institute. | Deploy order step 6 only. | `kubectl set env deployment/assessment-service ASSESSMENT_OPENAPI_ENABLED=false` (rolling restart, about 2 min, no downtime with 2 pods). |

Check that no deployment env shadows the ConfigMap value (deployment env wins):

```bash
for d in admin-core-service ai-service assessment-service; do
  echo "$d: $(kubectl set env deployment/$d --list | grep -E '^SUPER_ADMIN_USER_IDS=' || echo 'not set on deployment (good)')"
done
```

Check the flag took effect by behaviour, not by reading env:
`curl -s https://api.evalezy.com/v1/exams` returns
`{"error":{"code":"missing_api_key",...}}` when it is on.

## 2. Existing settings Phase 1 depends on (verify, do not change)

| Name / item | Service(s) | Where today | Phase 1 use | Check (read-only) |
|---|---|---|---|---|
| `INTERNAL_SERVICE_TOKEN` | assessment_service (`internal.service.token`), ai_service, admin_core (also as `AI_SERVICE_INTERNAL_TOKEN`) | Deployment env, set by each deploy workflow from GitHub secret `INTERNAL_SERVICE_TOKEN` | assessment to ai_service: `/copy-check/inspect`, `/copy-check/grade`, `PATCH /copy-check/rubric/{id}`, credit estimate/quote (C4); ai_service callbacks to assessment | `kubectl set env deployment/assessment-service --list \| grep -c '^INTERNAL_SERVICE_TOKEN='` and the same for `ai-service` (expect 1 each). Compare hashes, never print the value: `... \| sed -n 's/^INTERNAL_SERVICE_TOKEN=//p' \| shasum -a 256` must match across the two. |
| HMAC client row `assessment_service` in `client_secret_key` | admin_core DB, media DB | Seeded rows | assessment to admin_core `POST /admin-core-service/internal/api-keys/v1/verify` (C2); assessment to media `/media-service/internal/eval-api/v1/**` (C3, **new**: assessment does not call media internal routes today) | Read-only, on `admin_core_service` and on `media_service`: `SELECT client_name, md5(secret_key) FROM client_secret_key WHERE client_name = 'assessment_service';` Both must return one row whose md5 equals the one in `assessment_service`'s own `client_secret_key` (the caller signs with its own DB's secret). If media has no row, it must be added before the media/assessment deploys, copying the secret DB-to-DB in one statement (never through the repo or chat) and checking the md5 after. |
| `ADMIN_CORE_SERVICE_BASE_URL`, `MEDIA_SERVICE_BASE_URL`, `AI_SERVICE_BASE_URL` | assessment_service | ConfigMap (in-cluster `http://<svc>:<port>`) | verify, presign/head/signed-url, inspect/grade/rubric/credits | `kubectl get cm myconfigmapv1.0 -o yaml \| grep -E 'ADMIN_CORE_SERVICE_BASE_URL\|MEDIA_SERVICE_BASE_URL\|AI_SERVICE_BASE_URL'` shows `http://admin-core-service:8072`, `http://media-service:8075`, `http://ai-service:8077`. A public host here would break once `internal-paths-block.yaml` (G16) is applied. |
| `ADMIN_CORE_SERVICE_DB_URL` / ai_service DB (`DB_NAME=admin_core_service`) | ai_service | ConfigMap | ai_service reads `institute_tool_pricing` and `ai_tool_pricing_history` (admin_core V545) from the admin_core DB for pricing resolution (C4) | none; same DB ai_service already uses for `ai_tool_pricing` |
| `AWS_BUCKET_NAME`, `CDN_PRIVATE_BASE_URL`, `CDN_PRIVATE_KEY_PAIR_ID`, `CDN_PRIVATE_KEY_B64` | media_service | ConfigMap / deployment env | `eval-api/{institute_id}/` objects live in the main (private) bucket; signed GET for checked copies (`?redirect=true`) needs the private CDN, otherwise the API streams through assessment_service | `kubectl get cm myconfigmapv1.0 -o jsonpath='{.data.CDN_PRIVATE_BASE_URL}'` (blank = streaming only, which is fine for Phase 1) |
| `SENTRY_DSN`, `sentry.send-default-pii=false` | assessment_service | Deployment env / properties (Phase 0a T0.15) | `X-API-Key` must never reach Sentry (G17) | Check one real Sentry event from assessment_service after the deploy: no `X-API-Key` header in it. |

## 3. Fixed in code by contract (no prod setting)

These are constants or migration seeds in Phase 1. If a track turns one into a
setting, its report must name it and a row goes into section 1 before merge.

| Item | Value | Owner |
|---|---|---|
| Key format / header / storage | `vak_eval_<48 hex>`, `X-API-Key`, SHA-256 hex `key_hash` (C1) | admin_core, common |
| Verify cache | refresh 60 s, expire 10 min, negative 30 s, max 10k; verify RestTemplate 500 ms connect / 1.5 s read (spec 6.4) | assessment |
| Tool pricing seeds | `copy_check_evaluation_api`: per page, flat 0, per_unit 1, `{"fixed_price":true,"typed_per_answer":1}`; `copy_check_evaluation` unchanged. Seeded by admin_core V545 (`ON CONFLICT DO NOTHING`), edited afterwards in health-check, never by env | admin_core, ai_service |
| Inspect caps | 200 pages, 10 s, 60 MB (C4) | ai_service |
| Upload limits | PDF <= 50 MB, image <= 10 MB, presigned PUT valid 1 h, key prefix `eval-api/{institute_id}/`, `source=AI_EVAL_API` (C3, spec 7.5) | media, assessment |
| Signed GET expiry bounds | 60 to 3600 s (C3) | media |
| Daily quota defaults | segment presets in `institute_api_access` (spec 6.1), edited in health-check | admin_core |
| Public base URL in docs/OpenAPI `servers` | `https://api.evalezy.com/v1` | assessment (facade) |

No new secret in Phase 1. Webhook signing (`WEBHOOK_SECRET_KEY`, spec 9.3) is
Phase 2.

## 4. Infrastructure (not env)

| Item | Where | Before |
|---|---|---|
| `api.evalezy.com` DNS record + TLS + ingress | `vacademy_devops/evalezy-api-ingress.yaml` (header has the founder's exact Cloudflare record, the certificate steps and the curl checks) | Deploy order step 6, before the pilot gets the base URL. Can be applied earlier: with the flag off, `/v1` only reaches Spring's 401/403/404. |
| `/*/internal/` blocked at the public edge (G16) | `vacademy_devops/internal-paths-block.yaml` (its own prerequisites list) | Before the first partner key is issued. The new verify endpoint and the media `eval-api` endpoints are `/internal/` routes. |
| Public CDN cannot serve `eval-api/*` (G12) | AWS CloudFront: the public distribution has an origin-failover group (public bucket, then main bucket, per `FileServiceImpl.getPublicUrl`). Either add a behaviour for `eval-api/*` that returns 403 (CloudFront Function) on the public distribution, or drop the main-bucket failover origin. | Before the first partner upload. Check with a test object: `curl -s -o /dev/null -w '%{http_code}' "$CDN_PUBLIC_BASE_URL/eval-api/<test-institute>/<test-file>"` must not be 200. |
| Cloudflare zone `evalezy.com` settings | Bot Fight Mode off (or WAF skip on Pro+), Configuration Rule for `api.evalezy.com` (SSL Full (strict), Browser Integrity Check off), Cache Rule bypass. Details in the ingress file header. | With the DNS record. |
| S3 lifecycle for abandoned uploads (optional) | Main bucket, prefix `eval-api/`: abort incomplete multipart uploads after 1 day. Object retention is a product decision (spec section 13 #25); do not add an expiry rule without it. | Any time |

## 5. Rollout order (spec section 16, Phase 1) with the config steps

1. Set `SUPER_ADMIN_USER_IDS` in the ConfigMap, read it back. Verify section 2.
   Deploy admin_core (V545, V546, verify endpoint, key admin, api-access).
2. Deploy ai_service (pricing resolution, inspect, rubric PATCH). Outside exam
   hours: about 3 min of 503s, running copies recovered by the sweeper.
3. Add the media `client_secret_key` row if section 2 found it missing; deploy media.
4. Deploy assessment_service with the flag off (`ASSESSMENT_OPENAPI_ENABLED`
   unset or `false`; migrations V52 to V54 run on boot).
5. Frontend + health-check.
6. Apply `internal-paths-block.yaml` if not yet applied; apply
   `evalezy-api-ingress.yaml` and finish its DNS/TLS steps; CloudFront `eval-api/*`
   check; super-admin enables the pilot institute in health-check; then
   `kubectl set env deployment/assessment-service ASSESSMENT_OPENAPI_ENABLED=true`
   and run the curl checks in the ingress file header.

Kill switches, fastest first: super-admin "Revoke all" keys for one institute
(within 60 s, cache refresh); disable the product for the institute;
`ASSESSMENT_OPENAPI_ENABLED=false` (whole API, about 2 min);
`kubectl delete -f vacademy_devops/evalezy-api-ingress.yaml` (public host only;
the backend-stage path stays reachable while the flag is on).
