import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { verifyCertificate, type VerificationResult } from "@/services/certificate-verification";
import { BASE_URL } from "@/constants/urls";
import {
  ErrorCard,
  InvalidCard,
  VerifyingCard,
} from "../-components/verification-cards";
import { VerifiedByCertificate } from "../-components/verified-by-certificate";

/**
 * Public certificate verification page — where a scanned certificate QR lands.
 *
 * <p>Renders the institute's own attestation template rather than an app
 * screen: this is opened by strangers judging a document, and "verified by
 * <institute>" over the institute's mark is the thing that answers their
 * question. See VerifiedByCertificate.
 *
 * <p>Served from the institute's learner portal, so a white-labelled school
 * sends its graduates' verifiers to its own domain — the QR is built as
 * `<learnerPortalBaseUrl>/verify/<number>?t=<token>` in
 * CertificateVerificationService.buildVerificationUrl.
 *
 * Reachable without logging in. `/verify` is in the public-route allowlist in
 * use-domain-routing.ts (both copies), so domain routing does not bounce an
 * anonymous visitor to the courses page.
 */
export const Route = createFileRoute("/verify/$certificateId/")({
  component: CertificateVerificationPage,
});

/**
 * The document to show instead of the page, or null to render the page.
 *
 * <p>An HTML document comes back as a path on the API rather than an absolute
 * URL, because the scan lands on whichever domain the institute configured and
 * there is no single correct host to bake into the response. A PDF is already an
 * absolute media URL. Falling back to null on anything unexpected means a
 * malformed configuration shows the verification page rather than a blank frame.
 */
function documentSrc(data: {
  verification_mode?: string | null;
  document_type?: string | null;
  document_url?: string | null;
}): string | null {
  if (data.verification_mode !== "DOCUMENT" || !data.document_url) return null;
  if (data.document_type === "PDF") return data.document_url;
  // Carry the credential through: the document names a learner, so the API
  // requires the same proof the page did.
  const params = new URLSearchParams(window.location.search);
  const credential = params.get("t") ?? params.get("c");
  const query = credential
    ? `?${params.get("t") ? "t" : "c"}=${encodeURIComponent(credential)}`
    : "";
  return `${BASE_URL}${data.document_url}${query}`;
}

function CertificateVerificationPage() {
  const { t } = useTranslation("miscRoutesA");
  const { certificateId } = Route.useParams();
  const [result, setResult] = useState<VerificationResult | null>(null);

  useEffect(() => {
    // The credential lives in ?t= (the QR's long token) or ?c= (the barcode's
    // short code). The number alone is deliberately not enough, since
    // certificate numbers are sequential and would be enumerable.
    const params = new URLSearchParams(window.location.search);
    const credential = params.get("t") ?? params.get("c");
    let cancelled = false;
    void verifyCertificate(certificateId, credential).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [certificateId]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-10 dark:bg-neutral-900">
      <div className="w-full max-w-xl">
        {result === null && <VerifyingCard />}
        {result?.status === "valid" &&
          (documentSrc(result.data) ? (
            /* The institute supplied its own document, so show that instead of
               the built-in page. Sandboxed: it is admin-authored markup, and the
               API already serves it under a script-blocking CSP — this is the
               second half of the same guarantee, so a document can never script
               against the portal it is framed in. */
            <iframe
              src={documentSrc(result.data)!}
              title={t("verify.certificateVerificationTitle")}
              sandbox=""
              className="h-screen-80 w-full rounded-lg border bg-white shadow-sm"
            />
          ) : (
            <VerifiedByCertificate data={result.data} verifiedVia={t("verify.verifiedVia.qrCode")} />
          ))}
        {result?.status === "invalid" && (
          <>
            <InvalidCard certificateId={certificateId} />
            {/* A link that was truncated in an email, or a number typed by
                hand, both land here. Sending them to the scan page is the one
                thing that can still verify the certificate. */}
            <p className="mt-4 text-center text-caption text-neutral-500">
              <Link
                to="/verify"
                className="font-medium text-primary-500 underline underline-offset-2"
              >
                {t("verify.enterCodeInstead")}
              </Link>
            </p>
          </>
        )}
        {result?.status === "error" && <ErrorCard />}
      </div>
    </main>
  );
}
