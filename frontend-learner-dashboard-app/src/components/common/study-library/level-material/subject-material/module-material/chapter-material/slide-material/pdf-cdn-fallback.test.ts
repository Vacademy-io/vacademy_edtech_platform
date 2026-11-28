import { describe, expect, it } from "vitest";
import { isRetryablePdfLoadError, toPublicBucketFallbackUrl } from "./pdf-cdn-fallback";

describe("toPublicBucketFallbackUrl", () => {
  it("maps a public CDN URL to the same key on the public bucket", () => {
    expect(
      toPublicBucketFallbackUrl(
        "https://d1om4dxj9e7kkd.cloudfront.net/inst/PDF_DOCUMENTS/abc-file%20name.pdf",
      ),
    ).toBe(
      "https://vacademy-media-storage-public.s3.amazonaws.com/inst/PDF_DOCUMENTS/abc-file%20name.pdf",
    );
  });

  it("keeps a query string", () => {
    expect(toPublicBucketFallbackUrl("https://d1om4dxj9e7kkd.cloudfront.net/a.pdf?v=2")).toBe(
      "https://vacademy-media-storage-public.s3.amazonaws.com/a.pdf?v=2",
    );
  });

  it("has no fallback for anything else", () => {
    for (const url of [
      "https://vacademy-media-storage-public.s3.amazonaws.com/a.pdf",
      "https://other.cloudfront.net/a.pdf",
      "http://d1om4dxj9e7kkd.cloudfront.net/a.pdf",
      "blob:https://parchamclasses.in/123",
      "/local/file.pdf",
      "",
      null,
      undefined,
    ]) {
      expect(toPublicBucketFallbackUrl(url)).toBeNull();
    }
  });
});

describe("isRetryablePdfLoadError", () => {
  it("retries network-style failures but not a password or a broken file", () => {
    expect(isRetryablePdfLoadError(undefined)).toBe(true);
    expect(isRetryablePdfLoadError("UnknownErrorException")).toBe(true);
    expect(isRetryablePdfLoadError("PasswordException")).toBe(false);
    expect(isRetryablePdfLoadError("InvalidPDFException")).toBe(false);
  });
});
