import { useState } from "react";
import {
  EnvelopeSimple,
  Info,
  SpinnerGap,
  CheckCircle,
  CaretLeft,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";
import { ModernCard } from "@/components/design-system/modern-card";
import { MyButton } from "@/components/design-system/button";
import { cn } from "@/lib/utils";

interface OtpStepProps {
  /** Email the code was sent to (admin email from the details step) */
  email: string;
  /** Verifies through OUR /verify-otp endpoint (registration-scoped). Should throw on failure. */
  onVerify: (otp: string) => Promise<void>;
  onResend: () => Promise<void>;
  onEditDetails: () => void;
  isVerifying: boolean;
  isResending: boolean;
  /**
   * Resuming an in-flight registration — the code came from /resume and
   * verification goes through /resume-verify (copy tweak only; the endpoints
   * are wired by the wizard's callbacks).
   */
  resumeMode?: boolean;
}

/**
 * Step 2 — email OTP verification. Lifted copy of the OTP sub-step from
 * enroll-by-invite/registration-step.tsx, rewired to the sub-org registration
 * /verify-otp + /resend-otp endpoints via the callbacks (NOT the
 * notification-service live-session endpoints).
 */
const OtpStep = ({
  email,
  onVerify,
  onResend,
  onEditDetails,
  isVerifying,
  isResending,
  resumeMode = false,
}: OtpStepProps) => {
  const { t } = useTranslation("registrationB");
  const [otp, setOtp] = useState("");

  const handleVerifyClick = async () => {
    if (!otp.trim() || otp.length < 4) {
      toast.error(t("subOrgRegistration.otp.toast.invalidCode"));
      return;
    }
    await onVerify(otp);
  };

  return (
    <ModernCard
      variant="glass"
      padding="lg"
      rounded="lg"
      className="border border-white/40 bg-white/90 shadow-lg backdrop-blur-md"
    >
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary-50">
          <EnvelopeSimple className="size-8 text-primary-500" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-neutral-700">
          {t("subOrgRegistration.otp.title")}
        </h2>
        <p className="text-sm text-neutral-500">
          {resumeMode
            ? t("subOrgRegistration.otp.sentToResume")
            : t("subOrgRegistration.otp.sentTo")}
        </p>
        <p className="mt-1 text-sm font-medium text-neutral-700">{email}</p>
      </div>

      {/* Instructions */}
      <div className="mb-6 rounded-lg border border-warning-200 bg-warning-50 p-4">
        <div className="flex gap-3">
          <Info className="mt-0.5 size-5 flex-shrink-0 text-warning-600" />
          <div className="text-sm text-warning-700 space-y-1">
            <p className="font-medium">
              {t("subOrgRegistration.otp.cantFindEmail")}
            </p>
            <ul className="list-inside list-disc space-y-1">
              <li>
                <Trans
                  t={t}
                  i18nKey="subOrgRegistration.otp.checkSpam"
                  components={{ b1: <strong />, b2: <strong /> }}
                />
              </li>
              <li>{t("subOrgRegistration.otp.correctEmail")}</li>
              <li>{t("subOrgRegistration.otp.waitRefresh")}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* OTP Input */}
      <div className="space-y-4">
        <div>
          <label
            htmlFor="sub-org-otp-input"
            className="mb-2 block text-sm font-medium text-neutral-600"
          >
            {t("subOrgRegistration.otp.enterCodeLabel")}
          </label>
          <input
            id="sub-org-otp-input"
            type="text"
            inputMode="numeric"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder={t("subOrgRegistration.otp.codePlaceholder")}
            className={cn(
              "w-full rounded-lg border border-neutral-300 px-4 py-3 text-center font-mono text-lg tracking-widest",
              "outline-none transition-all focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
            )}
            maxLength={6}
            autoFocus
            disabled={isVerifying}
          />
        </div>

        {/* Verify Button */}
        <MyButton
          type="button"
          buttonType="primary"
          scale="large"
          layoutVariant="default"
          onClick={handleVerifyClick}
          disable={isVerifying || otp.length < 4}
          className="w-full"
        >
          {isVerifying ? (
            <>
              <SpinnerGap className="me-2 size-4 animate-spin" />
              {t("subOrgRegistration.otp.verifying")}
            </>
          ) : (
            <>
              <CheckCircle className="me-2 size-5" />
              {t("subOrgRegistration.otp.verifyContinue")}
            </>
          )}
        </MyButton>

        {/* Resend & Back Actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={onEditDetails}
            className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-600"
            disabled={isVerifying}
          >
            <CaretLeft className="size-4" />
            {t("subOrgRegistration.otp.editDetails")}
          </button>

          <button
            type="button"
            onClick={() => void onResend()}
            disabled={isResending || isVerifying}
            className="text-sm font-medium text-primary-500 hover:text-primary-400 disabled:opacity-50"
          >
            {isResending
              ? t("subOrgRegistration.otp.resending")
              : t("subOrgRegistration.otp.resendCode")}
          </button>
        </div>
      </div>
    </ModernCard>
  );
};

export default OtpStep;
