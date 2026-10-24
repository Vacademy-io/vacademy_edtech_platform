import { SealWarning, WifiSlash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * The not-verified cards both verification entry points share — the QR landing
 * page (`/verify/$certificateId`) and the scan/paste page (`/verify`).
 *
 * They live here rather than in either route because the two must agree: an
 * employer who scans and an employer who types the code are looking at the same
 * certificate, and any difference in wording between the two reads as one of
 * them being the "real" check.
 *
 * <p>A *successful* verification is not rendered here — it gets the institute's
 * own attestation template instead. See VerifiedByCertificate.
 */

export function Shell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "neutral" | "success" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white p-6 shadow-sm dark:bg-neutral-800",
        tone === "success" && "border-success-200",
        tone === "danger" && "border-danger-200",
        tone === "neutral" && "border-neutral-200",
      )}
    >
      {children}
    </div>
  );
}

export function VerifyingCard() {
  const { t } = useTranslation("miscRoutesA");
  return (
    <Shell tone="neutral">
      <div className="flex flex-col items-center gap-stack py-6">
        <div
          className="size-8 animate-spin rounded-full border-2 border-neutral-200 border-t-primary-500 motion-reduce:animate-none"
          role="status"
          aria-label={t("verify.cards.checkingAriaLabel")}
        />
        <p className="text-body text-neutral-500">{t("verify.cards.checking")}</p>
      </div>
    </Shell>
  );
}

export function InvalidCard({
  certificateId,
  children,
}: {
  /** Omitted on the scan page, where there may be no recognisable number. */
  certificateId?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation("miscRoutesA");
  return (
    <Shell tone="danger">
      <div className="flex flex-col items-center gap-2 pb-4">
        <SealWarning weight="fill" className="size-10 text-danger-500" />
        <h1 className="text-h3 font-semibold text-neutral-700 dark:text-neutral-100">
          {t("verify.cards.invalidTitle")}
        </h1>
      </div>
      {children ?? (
        <p className="text-center text-body text-neutral-500">
          {t("verify.cards.noRecordPrefix")}{" "}
          <span className="font-mono text-neutral-700 dark:text-neutral-200">
            {certificateId}
          </span>{" "}
          {t("verify.cards.noRecordSuffix")}
        </p>
      )}
      <p className="mt-4 text-center text-caption text-neutral-400">
        {t("verify.cards.linksMustBeFull")}
      </p>
    </Shell>
  );
}

export function ErrorCard() {
  const { t } = useTranslation("miscRoutesA");
  return (
    <Shell tone="neutral">
      <div className="flex flex-col items-center gap-2 pb-4">
        <WifiSlash weight="fill" className="size-10 text-neutral-400" />
        <h1 className="text-h3 font-semibold text-neutral-700 dark:text-neutral-100">
          {t("verify.cards.errorTitle")}
        </h1>
      </div>
      {/* Deliberately not "invalid" — a dropped connection must never make a
          genuine certificate look fake. */}
      <p className="text-center text-body text-neutral-500">
        {t("verify.cards.errorDescription")}
      </p>
    </Shell>
  );
}
