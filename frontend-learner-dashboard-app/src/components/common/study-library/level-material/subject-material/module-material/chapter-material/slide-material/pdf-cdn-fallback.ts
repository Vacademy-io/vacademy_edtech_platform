/**
 * The public media CDN (CloudFront) fronts the public S3 bucket. When a
 * learner's browser cannot fetch a PDF from the CDN (a network that blocks
 * cloudfront.net, or an edge copy without CORS headers), the same object is
 * also served by the bucket itself, with CORS for every origin. This maps a
 * CDN URL to that direct bucket URL so the viewer can try once more; any
 * other URL has no fallback.
 */
const PUBLIC_CDN_HOST = "d1om4dxj9e7kkd.cloudfront.net";
const PUBLIC_BUCKET_ORIGIN = "https://vacademy-media-storage-public.s3.amazonaws.com";

export const toPublicBucketFallbackUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.host.toLowerCase() !== PUBLIC_CDN_HOST) {
      return null;
    }
    return `${PUBLIC_BUCKET_ORIGIN}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
};

/** Load errors a second download cannot fix. */
export const isRetryablePdfLoadError = (name: string | undefined): boolean =>
  name !== "PasswordException" && name !== "InvalidPDFException";
