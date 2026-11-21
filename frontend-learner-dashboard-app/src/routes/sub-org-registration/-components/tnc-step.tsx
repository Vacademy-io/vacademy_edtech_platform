import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  ArrowLeft,
  ArrowSquareOut,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ModernCard } from "@/components/design-system/modern-card";
import { MyButton } from "@/components/design-system/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { renderSafeLinkText } from "../-utils/safe-link-text";

interface TncStepProps {
  tncFileId: string | null;
  /** Consent statements, each a required checkbox; inline links via [label](url). */
  tncConsentItems?: string[] | null;
  isSubmitting: boolean;
  onContinue: () => void;
  /** Overrides the button label when TNC isn't the final step (e.g. payment follows). */
  continueLabel?: string;
  /** Returns to the previous wizard step without losing entered state. */
  onBack?: () => void;
  /**
   * The user already accepted the terms in this session (back/forward
   * navigation) — pre-check everything so their acceptance isn't lost.
   */
  initialAccepted?: boolean;
}

/** Step 4 — Terms & Conditions review + required acceptance (PDF and/or consent statements). */
const TncStep = ({
  tncFileId,
  tncConsentItems,
  isSubmitting,
  onContinue,
  continueLabel,
  onBack,
  initialAccepted = false,
}: TncStepProps) => {
  const { t } = useTranslation("registrationB");
  const consentItems = useMemo(
    () => (tncConsentItems ?? []).filter((item) => item.trim().length > 0),
    [tncConsentItems],
  );
  const hasConsentItems = consentItems.length > 0;

  const [pdfAccepted, setPdfAccepted] = useState(initialAccepted);
  const [itemsAccepted, setItemsAccepted] = useState<boolean[]>(() =>
    consentItems.map(() => initialAccepted),
  );

  const {
    data: tncUrl,
    isLoading: isTncUrlLoading,
    isError: isTncUrlError,
  } = useQuery({
    queryKey: ["SUB_ORG_REGISTRATION_TNC_URL", tncFileId],
    queryFn: () => getPublicUrlWithoutLogin(tncFileId),
    enabled: !!tncFileId,
    staleTime: 60 * 60 * 1000,
  });

  // PDF (when present) needs its own accept; every consent statement must be checked.
  // When neither is configured (legacy edge) the generic PDF-accept checkbox gates.
  const allAccepted =
    (tncFileId || !hasConsentItems ? pdfAccepted : true) &&
    (!hasConsentItems || itemsAccepted.every(Boolean));

  const toggleItem = (index: number, checked: boolean) => {
    setItemsAccepted((prev) => {
      const next = [...prev];
      next[index] = checked;
      return next;
    });
  };

  return (
    <ModernCard
      variant="glass"
      padding="lg"
      rounded="lg"
      className="border border-white/40 bg-white/90 shadow-lg backdrop-blur-md"
    >
      <div className="mb-5 flex items-start gap-2 sm:gap-3">
        <div className="flex-shrink-0 rounded-lg bg-primary-50 p-1.5 sm:p-2">
          <FileText className="size-5 text-primary-500 sm:size-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight text-neutral-700">
            {t("subOrgRegistration.tnc.title")}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            {t("subOrgRegistration.tnc.subtitle")}
          </p>
        </div>
      </div>

      <Separator className="mb-5" />

      {/* Document viewer (optional) */}
      {tncFileId ? (
        isTncUrlLoading ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50">
            <SpinnerGap className="size-6 animate-spin text-neutral-400" />
            <span className="ms-2 text-sm text-neutral-500">
              {t("subOrgRegistration.tnc.loadingDocument")}
            </span>
          </div>
        ) : isTncUrlError || !tncUrl ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 text-center">
            <WarningCircle className="size-6 text-warning-600" />
            <p className="text-sm text-neutral-500">
              {t("subOrgRegistration.tnc.loadError")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <iframe
              src={tncUrl}
              title={t("subOrgRegistration.tnc.title")}
              className="h-72 w-full rounded-lg border border-neutral-200 bg-white sm:h-96"
            />
            <a
              href={tncUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 self-end text-sm font-medium text-primary-500 hover:text-primary-400"
            >
              {t("subOrgRegistration.tnc.openInNewTab")}
              <ArrowSquareOut className="size-4" />
            </a>
          </div>
        )
      ) : hasConsentItems ? null : (
        <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
          {t("subOrgRegistration.tnc.noDocNoConsent")}
        </p>
      )}

      {/* PDF acceptance (only when a document exists, or legacy fallback) */}
      {(tncFileId || !hasConsentItems) && (
        <div className="mt-5 flex items-start gap-3">
          <Checkbox
            id="sub-org-tnc-accept"
            checked={pdfAccepted}
            onCheckedChange={(checked) => setPdfAccepted(checked === true)}
            disabled={isSubmitting}
            className="mt-0.5"
          />
          <label
            htmlFor="sub-org-tnc-accept"
            className="cursor-pointer text-sm text-neutral-600"
          >
            {t("subOrgRegistration.tnc.acceptCheckboxLabel")}
            <span className="text-danger-600"> *</span>
          </label>
        </div>
      )}

      {/* Consent statements — each its own required checkbox, links open in new tabs */}
      {hasConsentItems && (
        <div className="mt-5 flex flex-col gap-4">
          {consentItems.map((item, index) => (
            <div key={index} className="flex items-start gap-3">
              <Checkbox
                id={`sub-org-tnc-consent-${index}`}
                checked={itemsAccepted[index] ?? false}
                onCheckedChange={(checked) => toggleItem(index, checked === true)}
                disabled={isSubmitting}
                className="mt-0.5"
              />
              <label
                htmlFor={`sub-org-tnc-consent-${index}`}
                className="cursor-pointer text-sm leading-relaxed text-neutral-600"
              >
                {renderSafeLinkText(item)}
                <span className="text-danger-600"> *</span>
              </label>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-col-reverse gap-stack sm:flex-row sm:justify-between">
        {onBack ? (
          <MyButton
            type="button"
            buttonType="secondary"
            scale="large"
            layoutVariant="default"
            onClick={onBack}
            disable={isSubmitting}
            className="w-full sm:w-auto"
          >
            <ArrowLeft className="me-2 size-4" />
            {t("common.back")}
          </MyButton>
        ) : (
          <span className="hidden sm:block" />
        )}
        <MyButton
          type="button"
          buttonType="primary"
          scale="large"
          layoutVariant="default"
          onClick={onContinue}
          disable={!allAccepted || isSubmitting}
          className="w-full min-w-32 sm:w-auto"
        >
          {isSubmitting ? (
            <>
              <SpinnerGap className="me-2 size-4 animate-spin" />
              {t("common.submitting")}
            </>
          ) : (
            continueLabel ?? t("common.submitRegistration")
          )}
        </MyButton>
      </div>
    </ModernCard>
  );
};

export default TncStep;
