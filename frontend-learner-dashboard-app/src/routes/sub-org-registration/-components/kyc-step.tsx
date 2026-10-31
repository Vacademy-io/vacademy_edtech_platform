import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowSquareOut,
  CheckCircle,
  IdentificationCard,
  Info,
  ShieldCheck,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { ModernCard } from "@/components/design-system/modern-card";
import { MyButton } from "@/components/design-system/button";
import { Separator } from "@/components/ui/separator";
import {
  getTerminology,
} from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";
import type {
  KycStatus,
  KycSummary,
} from "../-services/sub-org-registration-services";
import {
  startKyc,
  getKycStatus,
  getSubOrgApiErrorMessage,
} from "../-services/sub-org-registration-services";
import { renderSafeLinkText } from "../-utils/safe-link-text";

const POLL_INTERVAL_MS = 4000;

type KycUiState = "CHECKING" | "INTRO" | "WAITING" | "VERIFIED" | "FAILED";

const isTerminalFailure = (
  status: KycStatus
): status is "CONSENT_DENIED" | "EXPIRED" | "FAILED" =>
  status === "CONSENT_DENIED" || status === "EXPIRED" || status === "FAILED";

interface KycStepProps {
  registrationId: string | null;
  /** Template's kyc_documents — e.g. ["AADHAAR"] or ["AADHAAR","PAN"]. */
  kycDocuments?: string[] | null;
  /** Template's kyc_instructions — replaces the default consent callout when set. */
  kycInstructions?: string | null;
  /** Final post-OTP step — Continue submits the registration. */
  isFinalStep: boolean;
  /** Wizard is running /complete after this step. */
  isSubmitting: boolean;
  onContinue: () => Promise<void> | void;
  onSessionMissing: () => void;
  /** Returns to the previous wizard step without losing entered state. */
  onBack?: () => void;
}

/**
 * KYC step — verifies the org admin's identity via DigiLocker. Mints the
 * consent URL on button click (it expires in ~10 minutes), opens it in a new
 * tab, then polls /kyc/status every 4s until VERIFIED or a terminal failure.
 * Continue is gated on VERIFIED so /complete never 4xxs on a skipped KYC.
 */
const KycStep = ({
  registrationId,
  kycDocuments,
  kycInstructions,
  isFinalStep,
  isSubmitting,
  onContinue,
  onSessionMissing,
  onBack,
}: KycStepProps) => {
  const { t } = useTranslation("registrationB");
  const admin = getTerminology(
    RoleTerms.Admin,
    SystemTerms.Admin
  ).toLocaleLowerCase();
  const failureMessages: Record<string, string> = {
    CONSENT_DENIED: t("subOrgRegistration.kyc.failure.consentDenied"),
    EXPIRED: t("subOrgRegistration.kyc.failure.expired"),
    FAILED: t("subOrgRegistration.kyc.failure.failed"),
  };
  const [uiState, setUiState] = useState<KycUiState>("CHECKING");
  const [summary, setSummary] = useState<KycSummary | null>(null);
  const [failureStatus, setFailureStatus] = useState<string | null>(null);
  const [isStartingKyc, setIsStartingKyc] = useState(false);
  /** Consent URL shown as a link when window.open was popup-blocked. */
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const requiredDocuments = (kycDocuments ?? []).map((doc) =>
    String(doc).toUpperCase()
  );
  const requiresPan = requiredDocuments.includes("PAN");

  // Institute-authored instructions win; otherwise the default PAN+Aadhaar
  // consent note (only relevant when PAN is among the required documents).
  const instructionText =
    kycInstructions?.trim() ||
    (requiresPan ? t("subOrgRegistration.kyc.defaultPanInstructions") : null);

  const instructionsCallout = instructionText ? (
    <div className="rounded-lg border border-primary-200 bg-primary-50 p-4">
      <div className="flex gap-3">
        <Info className="mt-0.5 size-5 flex-shrink-0 text-primary-500" />
        <p className="text-sm leading-relaxed text-neutral-600">
          {renderSafeLinkText(instructionText)}
        </p>
      </div>
    </div>
  ) : null;

  const backButton = onBack ? (
    <MyButton
      type="button"
      buttonType="secondary"
      scale="large"
      layoutVariant="default"
      onClick={onBack}
      disable={isSubmitting || isStartingKyc}
      className="w-full sm:w-auto"
    >
      <ArrowLeft className="me-2 size-4" />
      {t("common.back")}
    </MyButton>
  ) : (
    <span className="hidden sm:block" />
  );

  // One status fetch on mount: a user who refreshed after verifying jumps
  // straight to the success state without minting a fresh consent URL.
  const didInitialCheckRef = useRef(false);
  useEffect(() => {
    if (didInitialCheckRef.current) return;
    didInitialCheckRef.current = true;

    if (!registrationId) {
      toast.error(t("common.sessionMissing"));
      onSessionMissing();
      return;
    }

    let cancelled = false;
    const checkExistingStatus = async () => {
      try {
        const response = await getKycStatus(registrationId);
        if (cancelled) return;
        if (response.kyc_status === "VERIFIED") {
          setSummary(response.summary ?? null);
          setUiState("VERIFIED");
        } else {
          setUiState("INTRO");
        }
      } catch {
        // Status probe is best-effort — fall back to the intro state.
        if (!cancelled) setUiState("INTRO");
      }
    };
    void checkExistingStatus();
    return () => {
      cancelled = true;
    };
  }, [registrationId, onSessionMissing]);

  // Poll while waiting for the user to finish in the DigiLocker tab. The
  // cleanup clears the interval on unmount and whenever uiState leaves
  // WAITING (i.e. on terminal states).
  useEffect(() => {
    if (uiState !== "WAITING" || !registrationId) return;

    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await getKycStatus(registrationId);
        if (cancelled) return;
        if (response.kyc_status === "VERIFIED") {
          setSummary(response.summary ?? null);
          setUiState("VERIFIED");
        } else if (isTerminalFailure(response.kyc_status)) {
          setFailureStatus(response.kyc_status);
          setUiState("FAILED");
        }
      } catch {
        // Transient poll failures are ignored; the next tick retries.
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [uiState, registrationId]);

  const handleStartVerification = async () => {
    if (!registrationId) {
      toast.error(t("common.sessionMissing"));
      onSessionMissing();
      return;
    }
    setIsStartingKyc(true);
    setFallbackUrl(null);
    try {
      const response = await startKyc(
        registrationId,
        `${window.location.origin}/kyc-complete`
      );
      // noopener: the DigiLocker tab must not get a handle on this wizard.
      const opened = window.open(response.url, "_blank", "noopener");
      if (!opened) {
        // Popup blocked — surface the consent URL as a clickable link instead.
        setFallbackUrl(response.url);
      }
      setFailureStatus(null);
      setUiState("WAITING");
    } catch (error) {
      toast.error(
        getSubOrgApiErrorMessage(
          error,
          t("subOrgRegistration.kyc.startVerificationFailed")
        )
      );
    } finally {
      setIsStartingKyc(false);
    }
  };

  const documentChips = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-caption font-medium text-primary-500">
        <IdentificationCard className="size-3.5" />
        {t("subOrgRegistration.kyc.aadhaar")}
      </span>
      {requiresPan && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-caption font-medium text-primary-500">
          <IdentificationCard className="size-3.5" />
          {t("subOrgRegistration.kyc.pan")}
        </span>
      )}
    </div>
  );

  const startButtonContent = isStartingKyc ? (
    <>
      <SpinnerGap className="me-2 size-4 animate-spin" />
      {t("subOrgRegistration.kyc.preparingVerification")}
    </>
  ) : (
    <>
      <ShieldCheck className="me-2 size-5" />
      {t("subOrgRegistration.kyc.verifyWithDigiLocker")}
    </>
  );

  return (
    <ModernCard
      variant="glass"
      padding="lg"
      rounded="lg"
      className="border border-white/40 bg-white/90 shadow-lg backdrop-blur-md"
    >
      {/* Header */}
      <div className="mb-5 flex items-start gap-2 sm:gap-3">
        <div className="flex-shrink-0 rounded-lg bg-primary-50 p-1.5 sm:p-2">
          <ShieldCheck className="size-5 text-primary-500 sm:size-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight text-neutral-700">
            {t("subOrgRegistration.kyc.title")}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            {t("subOrgRegistration.kyc.subtitle", { admin })}
          </p>
        </div>
      </div>

      <Separator className="mb-5" />

      {/* Initial status probe */}
      {uiState === "CHECKING" && (
        <div className="flex h-40 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50">
          <SpinnerGap className="size-6 animate-spin text-neutral-400" />
          <span className="ms-2 text-sm text-neutral-500">
            {t("subOrgRegistration.kyc.checkingStatus")}
          </span>
        </div>
      )}

      {/* Intro — explain + start */}
      {uiState === "INTRO" && (
        <div className="space-y-5">
          <p className="text-sm text-neutral-600">
            {t("subOrgRegistration.kyc.intro", { admin })}
          </p>

          <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
              {t("subOrgRegistration.kyc.requiredDocuments")}
            </p>
            {documentChips}
          </div>

          {instructionsCallout}

          <div className="flex flex-col-reverse gap-stack sm:flex-row sm:justify-between">
            {backButton}
            <MyButton
              type="button"
              buttonType="primary"
              scale="large"
              layoutVariant="default"
              onClick={() => void handleStartVerification()}
              disable={isStartingKyc}
              className="w-full min-w-32 sm:w-auto"
            >
              {startButtonContent}
            </MyButton>
          </div>
        </div>
      )}

      {/* Waiting — user is completing consent in the DigiLocker tab */}
      {uiState === "WAITING" && (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-stack rounded-lg border border-primary-200 bg-primary-50 px-4 py-8 text-center">
            <SpinnerGap className="size-8 animate-spin text-primary-500" />
            <div>
              <p className="text-sm font-medium text-neutral-700">
                {t("subOrgRegistration.kyc.completeInTab")}
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                {t("subOrgRegistration.kyc.autoUpdateHint")}
              </p>
            </div>
          </div>

          {fallbackUrl && (
            <div className="rounded-lg border border-warning-200 bg-warning-50 p-4">
              <div className="flex gap-3">
                <WarningCircle className="mt-0.5 size-5 flex-shrink-0 text-warning-600" />
                <div className="text-sm text-warning-700 space-y-1">
                  <p className="font-medium">
                    {t("subOrgRegistration.kyc.tabBlocked")}
                  </p>
                  <a
                    href={fallbackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary-500 underline hover:text-primary-400"
                  >
                    {t("subOrgRegistration.kyc.openVerification")}
                    <ArrowSquareOut className="size-4" />
                  </a>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void handleStartVerification()}
              disabled={isStartingKyc}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary-500 hover:text-primary-400 disabled:opacity-50"
            >
              <ArrowClockwise className="size-4" />
              {isStartingKyc
                ? t("subOrgRegistration.kyc.preparingNewLink")
                : t("subOrgRegistration.kyc.restartVerification")}
            </button>
          </div>
        </div>
      )}

      {/* Verified — show extracted details + gated Continue */}
      {uiState === "VERIFIED" && (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-stack rounded-lg border border-success-200 bg-success-50 px-4 py-6 text-center">
            <CheckCircle weight="fill" className="size-10 text-success-600" />
            <p className="text-base font-semibold text-neutral-700">
              {t("subOrgRegistration.kyc.verifiedSuccess")}
            </p>
          </div>

          {(summary?.name ||
            summary?.masked_aadhaar ||
            summary?.pan_number) && (
            <dl className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              {summary?.name && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <dt className="text-sm text-neutral-500">
                    {t("subOrgRegistration.kyc.verifiedName")}
                  </dt>
                  <dd className="text-sm font-medium text-neutral-700">
                    {summary.name}
                  </dd>
                </div>
              )}
              {summary?.masked_aadhaar && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <dt className="text-sm text-neutral-500">
                    {t("subOrgRegistration.kyc.aadhaar")}
                  </dt>
                  <dd className="font-mono text-sm font-medium text-neutral-700">
                    {summary.masked_aadhaar}
                  </dd>
                </div>
              )}
              {summary?.pan_number && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <dt className="text-sm text-neutral-500">
                    {t("subOrgRegistration.kyc.pan")}
                  </dt>
                  <dd className="font-mono text-sm font-medium text-neutral-700">
                    {summary.pan_number}
                  </dd>
                </div>
              )}
            </dl>
          )}

          <div className="flex flex-col-reverse gap-stack sm:flex-row sm:justify-between">
            {backButton}
            <MyButton
              type="button"
              buttonType="primary"
              scale="large"
              layoutVariant="default"
              onClick={() => void onContinue()}
              disable={isSubmitting}
              className="w-full min-w-32 sm:w-auto"
            >
              {isSubmitting ? (
                <>
                  <SpinnerGap className="me-2 size-4 animate-spin" />
                  {t("common.submitting")}
                </>
              ) : isFinalStep ? (
                t("common.submitRegistration")
              ) : (
                t("common.continue")
              )}
            </MyButton>
          </div>
        </div>
      )}

      {/* Terminal failure — explain + retry (mints a fresh consent URL) */}
      {uiState === "FAILED" && (
        <div className="space-y-5">
          <div className="rounded-lg border border-warning-200 bg-warning-50 p-4">
            <div className="flex gap-3">
              <WarningCircle className="mt-0.5 size-5 flex-shrink-0 text-warning-600" />
              <div className="text-sm text-warning-700 space-y-1">
                <p className="font-medium">
                  {t("subOrgRegistration.kyc.verificationNotCompleted")}
                </p>
                <p>
                  {failureMessages[failureStatus ?? "FAILED"] ??
                    failureMessages.FAILED}
                </p>
              </div>
            </div>
          </div>

          {instructionsCallout}

          <div className="flex flex-col-reverse gap-stack sm:flex-row sm:justify-between">
            {backButton}
            <MyButton
              type="button"
              buttonType="primary"
              scale="large"
              layoutVariant="default"
              onClick={() => void handleStartVerification()}
              disable={isStartingKyc}
              className="w-full min-w-32 sm:w-auto"
            >
              {isStartingKyc ? (
                <>
                  <SpinnerGap className="me-2 size-4 animate-spin" />
                  {t("subOrgRegistration.kyc.preparingVerification")}
                </>
              ) : (
                <>
                  <ArrowClockwise className="me-2 size-5" />
                  {t("subOrgRegistration.kyc.tryAgain")}
                </>
              )}
            </MyButton>
          </div>
        </div>
      )}
    </ModernCard>
  );
};

export default KycStep;
