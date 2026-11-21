import { useEffect, useState } from "react";
import { SealCheck } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import {
  displayHost,
  ensureHttp,
  normalizeThemeColor,
} from "../-utils/institute-branding";
import { cn } from "@/lib/utils";
import type { CertificateVerification } from "@/services/certificate-verification";

/**
 * The page a scanned certificate lands on: the institute's own attestation.
 *
 * <p><b>Why this is a template and not a result card.</b> Whoever scans a
 * certificate is usually an employer or a registrar deciding whether to believe
 * a document in their hand. A generic panel of key/value rows reads as "some
 * platform says this is fine"; what actually settles the question is the
 * awarding institute saying so, in its own name, on its own domain. So this
 * renders as a small attestation document — the institute's mark, "Verified by
 * <institute>", the seal, then the particulars — rather than as app UI.
 *
 * <p><b>Where the branding comes from.</b> The verification response carries it
 * (logo file id, brand colour, website). It cannot be resolved from the page's
 * own context the way the rest of the app does it: the visitor is not logged in
 * and the QR may have been opened on any domain. See CertificateVerificationDto.
 *
 * <p>Falls back to unbranded neutrals throughout. An institute that never
 * uploaded a logo still gets a page that says who verified the certificate.
 */
export function VerifiedByCertificate({
  data,
  /** Shown under the seal — "scanned" vs "typed in" are the same claim. */
  verifiedVia,
}: {
  data: CertificateVerification;
  verifiedVia?: string;
}) {
  const { t } = useTranslation("miscRoutesA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const logoUrl = useInstituteLogo(data.institute_logo_file_id);
  const accent = normalizeThemeColor(data.institute_theme_code);
  const issued = data.issued_at ? new Date(data.issued_at) : null;
  const instituteName = data.institute_name || t("verify.certificate.theAwardingInstitute");

  return (
    <article className="mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
      {/* The institute's colour across the top — the first thing that says
          whose page this is, before any text is read. A band rather than a
          border, which rounded corners and the card's own border swallow. */}
      <div
        className={cn("h-2 w-full", !accent && "bg-primary-500")}
        // Institute brand colour: runtime data, so it cannot be a token.
        // design-lint-ignore: dynamic institute branding
        style={accent ? { backgroundColor: accent } : undefined}
      />
      <header className="flex flex-col items-center gap-stack px-6 pb-5 pt-6 text-center">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={instituteName}
            className="size-16 rounded-full object-contain"
          />
        ) : (
          <InstituteMonogram name={instituteName} accent={accent} />
        )}
        <div className="flex flex-col gap-1">
          <p className="text-caption uppercase tracking-widest text-neutral-400">
            {t("verify.certificate.verifiedBy")}
          </p>
          <h1 className="text-h3 font-semibold text-neutral-700 dark:text-neutral-100">
            {instituteName}
          </h1>
        </div>
      </header>

      <div className="flex flex-col items-center gap-2 border-y border-neutral-100 bg-success-50 px-6 py-5 text-center dark:border-neutral-700">
        <SealCheck weight="fill" className="size-9 text-success-500" />
        <p className="text-body font-medium text-neutral-700">
          {data.headline?.trim() || t("verify.certificate.genuine")}
        </p>
        <p className="text-caption text-neutral-500">
          {t("verify.certificate.confirmsIssued", { instituteName })}
          {verifiedVia ? ` ${t("verify.certificate.checkedUsing", { verifiedVia })}` : ""}
        </p>
      </div>

      {/* The masked name and the number are not optional: without them the
          page confirms that *a* certificate exists rather than the one in the
          reader's hand. What else is listed is the institute's to decide, and
          `undefined` means they never decided — so it shows. */}
      <dl className="flex flex-col gap-stack px-6 py-6">
        <Row label={t("verify.certificate.issuedTo")} value={data.learner_name || "—"} />
        {data.show_course !== false && <Row label={course} value={data.course_name || "—"} />}
        <Row label={t("verify.certificate.certificateNumber")} value={data.certificate_id} mono />
        {data.show_issue_date !== false && (
          <Row
            label={t("verify.certificate.issuedOn")}
            value={
              issued
                ? issued.toLocaleDateString(undefined, { dateStyle: "long" })
                : "—"
            }
          />
        )}
        {data.show_completion !== false &&
          typeof data.completion_percentage === "number" && (
            <Row
              label={t("verify.certificate.completion")}
              value={`${data.completion_percentage}%`}
            />
          )}
      </dl>

      {data.institute_note && (
        <div className="border-t border-neutral-100 px-6 py-4 dark:border-neutral-700">
          <p className="text-caption text-neutral-600 dark:text-neutral-300">
            {data.institute_note}
          </p>
        </div>
      )}

      <footer className="flex flex-col gap-2 border-t border-neutral-100 px-6 py-4 dark:border-neutral-700">
        {/* Says plainly why the name is partial, so it doesn't read as a bug. */}
        <p className="text-caption text-neutral-400">{t("verify.certificate.namePartial")}</p>
        {data.institute_website && (
          <a
            href={ensureHttp(data.institute_website)}
            target="_blank"
            rel="noreferrer noopener"
            className="text-caption font-medium text-primary-500 underline underline-offset-2"
          >
            {displayHost(data.institute_website)}
          </a>
        )}
      </footer>
    </article>
  );
}

function InstituteMonogram({
  name,
  accent,
}: {
  name: string;
  accent: string | null;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "•";
  return (
    <div
      className={cn(
        "flex size-16 items-center justify-center rounded-full text-h2 font-semibold text-white",
        !accent && "bg-primary-500",
      )}
      // Institute brand colour: runtime data, so it cannot be a token.
      // design-lint-ignore: dynamic institute branding
      style={accent ? { backgroundColor: accent } : undefined}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-caption text-neutral-400">{label}</dt>
      <dd
        className={cn(
          "text-right text-body font-medium text-neutral-700 dark:text-neutral-100",
          mono && "font-mono tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * A logo file id is not a URL — media-service turns it into one. Resolved
 * without a token, because nobody verifying a certificate is logged in.
 */
function useInstituteLogo(fileId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!fileId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void getPublicUrlWithoutLogin(fileId)
      .then((resolved) => {
        if (!cancelled && typeof resolved === "string" && resolved)
          setUrl(resolved);
      })
      // A missing logo must never keep the verification itself from rendering.
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return url;
}

