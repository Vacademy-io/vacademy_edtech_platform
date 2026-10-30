# Media CDN: drop the origin failover, then move to the flat-rate Pro plan

**Status:** code on branch `feat/cdn-public-bucket-only`, not deployed. Cut over
after the 31 Oct – 2 Nov exams.

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

   ```bash
   aws s3 sync s3://vacademy-media-storage s3://vacademy-media-storage-public \
     --exclude "BBB_RECORDING/*" --exclude "PRIVATE_UPLOAD/*" --exclude "ADMIN_UPLOAD/*" \
     --exclude "AI_CALL_RECORDING/*" --exclude "eval-api/*"
   ```

   Run it a second time right before step 4, to pick up late uploads.
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
