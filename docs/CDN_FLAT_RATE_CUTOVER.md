# Media CDN: drop the origin failover, then move to the flat-rate Pro plan

**Status:** steps 1–4 DONE on 30 Oct 2026. Watching (step 5) until ~4 Nov, then Pro.
- Code: merged to main in 3d2b850170 and deployed 16:37 UTC. It includes 2da3997172,
  which checks a batch's files in parallel (the catalogue API gives a batch 5 s).
- Access logs before the cut-over: 74% of default-behavior requests (17.0k of 22.9k,
  1,585 keys) were served by the failover. 403 baseline: 1.25%.
- Backfill: 56,612 objects (490 GB) copied, 0 failed; a second pass found 0 missing.
- CloudFront: origin group removed at 16:47 UTC, deployed at 16:57 UTC, on
  pay-as-you-go. WAF still attached.
- On the Mac in `~/cdn-cutover-backup/`: the configs before the change
  (`cf-precutover-20261030-1637.json` is the rollback),
  `analyze_cdn_logs.py` (step 1) and `backfill_public.py` (step 3).
- CloudFront access logs: on since 30 Oct, writing to
  `s3://vacademy-cloudfront-logs/E2R7SGQ1KNIW31/` (kept 60 days).

## Why

The media distribution (`d1om4dxj9e7kkd.cloudfront.net`) sends its default path
to an origin group: the public bucket first, then the private bucket on 403/404.

- CloudFront's flat-rate plans have no origin failover, so the group blocks the
  $15 Pro plan, which covers 50 TB a month. Today we pay per GB.
- Through the failover, CDN links to private files work without a signature,
  including "signed" links that the default behavior never checks.

About 56,000 files (≈490 GB) exist only in the private bucket and are reached
through the failover today.

## What the code changes (media_service)

- **Permanent URLs** (`getPublicUrl`, `getPublicUrlWithExpiryAndId`,
  `getPublicBucketUrl`): a file that is only in the private bucket is copied to
  the public bucket before its CDN link is returned, as acknowledge-get-details
  already does. These files are never copied:
  - AI Evaluation API files;
  - keys under the prefixes the CDN routes to the private bucket.
- **Signed URLs:** CloudFront-signed only for the prefixes routed to the private
  bucket (`cdn.private-routed-prefixes`, default `PRIVATE_UPLOAD/`,
  `ADMIN_UPLOAD/`, `BBB_RECORDING/`, `AI_CALL_RECORDING/`).
  - Every other private key gets an S3 presigned URL.
  - That URL is capped at the SigV4 maximum of 7 days; a longer request no
    longer throws.
  - `cdn.private-routed-prefixes` must match the distribution's cache behaviors.

The code is safe to deploy while the failover still exists: every URL resolves
as before.

## Cut-over

1. **Read the access logs** (bucket `vacademy-cloudfront-logs`, on since 30 Oct).
   - Look for requests to keys outside the routed prefixes that are not in the
     public bucket.
   - The backfill below must cover them.
2. **Merge to main.** CI deploys media_service. Then check that the new image is
   the one running.
3. **Backfill.** This is a server-side copy, with no transfer charge and no
   downtime.
   - Use `~/cdn-cutover-backup/backfill_public.py`, not `aws s3 sync`.
   - The script copies only keys missing from the public bucket.
   - `aws s3 sync` also overwrites a public object when the private copy is newer
     or a different size, which could replace a newer public file with a stale one.
   - It skips the same prefixes: the routed ones and `eval-api/`.
   - Run it a second time right before step 4, to pick up late uploads.
4. **CloudFront, still on pay-as-you-go:**
   - Save the distribution config, for rollback.
   - Point the default behavior at the public-bucket origin.
   - Delete the origin group.
5. **Watch 3–5 days.**
   - Check the logs for 403/404 on the default behavior, and for complaints.
   - Rollback means re-applying the saved config, which takes minutes.
   - While on pay-as-you-go nothing is committed.
6. **Subscribe to Pro.** In the console: Distribution → Pricing plan → Pro.
   - The WAF web ACL must stay attached.
   - Downgrading back only takes effect at the next billing cycle, which is why
     step 5 comes first.

## Not covered here

- Files copied to the public bucket are readable by anyone who has the key. That
  is the same exposure the failover gives today.
- Sensitive folders should move to signed URLs only: evaluations, reports,
  recordings, student documents.
- `BBB_RECORDING/` and `AI_CALL_RECORDING/` behaviors check no signature today.
