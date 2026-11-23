import { Suspense, useEffect, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Preferences } from "@capacitor/preferences";
import { Check } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { applyTabBranding } from "@/utils/branding";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { useInstituteDetailsStore } from "@/stores/study-library/useInstituteDetails";
import { handleGetPublicInstituteDetails } from "@/components/common/enroll-by-invite/-services/enroll-invite-services";
import { InstituteBrandingComponent } from "@/components/common/institute-branding";
import { PaymentGatewayWrapper } from "@/components/common/enroll-by-invite/-components/payment-gateway-wrapper";
import type { PaymentVendor } from "@/components/common/enroll-by-invite/-utils/payment-vendor-helper";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { cn } from "@/lib/utils";
import type {
  SubOrgRegistrationTemplate,
  CustomFieldValuePayload,
} from "../-services/sub-org-registration-services";
import {
  startSubOrgRegistration,
  updateSubOrgRegistrationDetails,
  verifySubOrgRegistrationOtp,
  resendSubOrgRegistrationOtp,
  resumeSubOrgRegistration,
  resumeVerifySubOrgOtp,
  completeSubOrgRegistration,
  getSubOrgApiErrorMessage,
} from "../-services/sub-org-registration-services";
import DetailsStep, { DetailsStepValues } from "./details-step";
import OtpStep from "./otp-step";
import CustomFieldsStep from "./custom-fields-step";
import TncStep from "./tnc-step";
import KycStep from "./kyc-step";
import PaymentStep from "./payment-step";
import SuccessStep from "./success-step";

type WizardPhase =
  | "DETAILS"
  | "OTP"
  | "CUSTOM_FIELDS"
  | "TNC"
  | "KYC"
  | "PAYMENT"
  | "SUCCESS";

interface RegistrationWizardProps {
  template: SubOrgRegistrationTemplate;
  instituteId: string;
  code: string;
}

/**
 * Public sub-org self-registration wizard, driven by the template's `steps`:
 * DETAILS → OTP verify → CUSTOM_FIELDS (if present) → TNC (if present) →
 * KYC (if present; DigiLocker identity verification) → PAYMENT (paid
 * templates; always last) → SUCCESS. registration_id lives in component
 * state.
 *
 * FREE templates call POST /complete from the last non-payment step. Paid
 * templates call /complete exactly once — from the PAYMENT step, with
 * plan_id + payment_initiation_request; earlier steps only collect state.
 */
const RegistrationWizard = ({
  template,
  instituteId,
  code,
}: RegistrationWizardProps) => {
  const { t } = useTranslation("registrationB");
  const domainRouting = useDomainRouting();
  const { setInstituteDetails } = useInstituteDetailsStore();

  const { data: instituteData } = useSuspenseQuery(
    handleGetPublicInstituteDetails({ instituteId })
  );

  // ─── Template-driven step configuration ────────────────────────────────────
  const templateSteps = useMemo(
    () => (template.steps ?? []).map((s) => String(s).toUpperCase()),
    [template.steps]
  );
  const hasCustomFieldsStep =
    templateSteps.includes("CUSTOM_FIELDS") &&
    (template.custom_fields?.length ?? 0) > 0;
  const hasTncStep = templateSteps.includes("TNC");
  // Identity verification via DigiLocker (after TNC, before PAYMENT).
  const hasKycStep = templateSteps.includes("KYC");
  // Payment requires the payment section with at least one plan to pay with.
  const hasPaymentStep =
    templateSteps.includes("PAYMENT") &&
    !!template.payment &&
    (template.payment.payment_plans?.length ?? 0) > 0;

  /** Ordered post-OTP steps, honoring the template's ordering. */
  const postOtpSteps = useMemo(
    () =>
      templateSteps.filter(
        (step): step is "CUSTOM_FIELDS" | "TNC" | "KYC" | "PAYMENT" =>
          (step === "CUSTOM_FIELDS" && hasCustomFieldsStep) ||
          (step === "TNC" && hasTncStep) ||
          (step === "KYC" && hasKycStep) ||
          (step === "PAYMENT" && hasPaymentStep)
      ),
    [templateSteps, hasCustomFieldsStep, hasTncStep, hasKycStep, hasPaymentStep]
  );

  // ─── Wizard state ──────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<WizardPhase>("DETAILS");
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [detailsValues, setDetailsValues] = useState<DetailsStepValues | null>(
    null
  );
  const [customFieldValues, setCustomFieldValues] = useState<
    CustomFieldValuePayload[]
  >([]);
  const [completedEmail, setCompletedEmail] = useState<string | null>(null);
  // Registration passed OTP verification — Details edits now go through
  // /update-details (a changed email flips this back to false via DRAFT).
  const [otpVerified, setOtpVerified] = useState(false);
  // TNC was accepted once this session — re-entering the step via Back keeps
  // the checkboxes pre-checked.
  const [tncAcceptedOnce, setTncAcceptedOnce] = useState(false);
  // Resume flow: /start rejected this email as already in flight — the details
  // step shows the inline "Resume registration" door for it.
  const [resumeEmail, setResumeEmail] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  // OTP phase verifies via /resume-verify (code sent by /resume) instead of
  // /verify-otp; cleared once verification succeeds or a fresh /start lands.
  const [isResumeMode, setIsResumeMode] = useState(false);
  // Resumed registration is PENDING_PAYMENT — the payment step skips plan
  // selection and re-initiates via /retry-payment (plan is locked server-side).
  const [isPaymentRetry, setIsPaymentRetry] = useState(false);

  const [isStarting, setIsStarting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  // ─── Branding (same sync as audience-response) ─────────────────────────────
  useEffect(() => {
    if (instituteData) {
      setInstituteDetails(instituteData);
    }
  }, [instituteData, setInstituteDetails]);

  useEffect(() => {
    const syncBranding = async () => {
      try {
        if (!instituteId || !instituteData) return;

        await Preferences.set({ key: "InstituteId", value: instituteId });

        const mappedDetails = {
          id: instituteId,
          institute_name:
            instituteData?.institute_name ?? instituteData?.name ?? "",
          institute_logo_file_id: instituteData?.institute_logo_file_id ?? null,
          institute_theme_code:
            instituteData?.institute_theme_code ??
            (instituteData?.theme as string) ??
            "primary",
          institute_settings_json: instituteData?.setting ?? "",
        } as unknown as {
          id: string;
          institute_name: string;
          institute_logo_file_id: string | null;
          institute_theme_code: string;
          institute_settings_json: string;
        };

        await Preferences.set({
          key: "InstituteDetails",
          value: JSON.stringify(mappedDetails),
        });

        const learnerKey = `LEARNER_${instituteId}`;
        const learnerSettings = {
          tabText:
            instituteData?.tabText ?? instituteData?.institute_name ?? null,
          tabIconFileId:
            instituteData?.tabIconFileId ??
            instituteData?.institute_logo_file_id ??
            null,
          fontFamily: instituteData?.fontFamily ?? null,
          theme: instituteData?.institute_theme_code ?? null,
          privacyPolicyUrl: null,
          termsAndConditionUrl: null,
          allowSignup: null,
          allowGoogleAuth: null,
          allowGithubAuth: null,
          allowEmailOtpAuth: null,
          allowUsernamePasswordAuth: null,
        };
        await Preferences.set({
          key: learnerKey,
          value: JSON.stringify(learnerSettings),
        });

        await applyTabBranding(document.title);
      } catch (e) {
        console.warn("[Sub-Org Registration] Branding sync failed", e);
      }
    };

    void syncBranding();
  }, [instituteId, instituteData]);

  // ─── Flow handlers ─────────────────────────────────────────────────────────

  const runComplete = async (
    values: CustomFieldValuePayload[],
    tncAccepted: boolean
  ) => {
    if (!registrationId) {
      toast.error(t("common.sessionMissing"));
      setPhase("DETAILS");
      return;
    }
    setIsCompleting(true);
    try {
      const response = await completeSubOrgRegistration({
        registration_id: registrationId,
        tnc_accepted: tncAccepted,
        custom_field_values: values,
      });
      setCompletedEmail(
        response?.admin_email || detailsValues?.adminEmail || ""
      );
      setPhase("SUCCESS");
    } catch (error) {
      toast.error(
        getSubOrgApiErrorMessage(
          error,
          t("subOrgRegistration.wizard.toast.completeError")
        )
      );
    } finally {
      setIsCompleting(false);
    }
  };

  /**
   * Advances past a completed step; runs /complete when nothing remains.
   * Paid templates never hit runComplete here: PAYMENT is always their last
   * step, so this only ever advances INTO it — the payment step then issues
   * the single /complete with the payment initiation payload.
   */
  const advanceAfter = async (
    completedStep: "OTP" | "CUSTOM_FIELDS" | "TNC" | "KYC",
    values: CustomFieldValuePayload[]
  ) => {
    const startIndex =
      completedStep === "OTP"
        ? 0
        : postOtpSteps.indexOf(completedStep) + 1;
    const nextStep = postOtpSteps[startIndex];
    if (nextStep) {
      setPhase(nextStep);
    } else {
      // No further wizard steps — the just-finished action is the final one.
      // TNC (when present) is always acceptance-gated before reaching here.
      await runComplete(values, hasTncStep);
    }
  };

  const collectAddress = template.collect_address === true;

  /** Address fields only travel when the template collects them (ignored otherwise). */
  const buildAddressFields = (values: DetailsStepValues) =>
    collectAddress
      ? {
          address_line1: values.addressLine1?.trim() || null,
          address_line2: values.addressLine2?.trim() || null,
          city: values.city?.trim() || null,
          state: values.state?.trim() || null,
          pincode: values.pincode?.trim() || null,
        }
      : {};

  const isEditingAfterVerification = !!registrationId && otpVerified;

  const handleDetailsSubmit = async (values: DetailsStepValues) => {
    setIsStarting(true);
    // Any (re)submit supersedes a pending resume offer for the previous email.
    setResumeEmail(null);
    setResumeError(null);
    try {
      if (registrationId && otpVerified) {
        // Already OTP-verified — edit the SAME registration via
        // /update-details. A changed email resets the status to DRAFT (fresh
        // OTP to the new address); otherwise continue forward as normal.
        const response = await updateSubOrgRegistrationDetails({
          registration_id: registrationId,
          org_name: values.orgName.trim(),
          org_logo_file_id: values.orgLogoFileId,
          admin_name: values.adminName.trim(),
          admin_email: values.adminEmail.trim(),
          admin_phone: values.adminPhone?.trim() || null,
          ...buildAddressFields(values),
        });
        setDetailsValues(values);
        if (response.status === "DRAFT") {
          setOtpVerified(false);
          setPhase("OTP");
          toast.success(t("subOrgRegistration.wizard.toast.codeSentNewEmail"));
        } else {
          toast.success(t("subOrgRegistration.wizard.toast.detailsUpdated"));
          await advanceAfter("OTP", customFieldValues);
        }
        return;
      }

      const response = await startSubOrgRegistration({
        institute_id: instituteId,
        code,
        org_name: values.orgName.trim(),
        org_logo_file_id: values.orgLogoFileId,
        admin_name: values.adminName.trim(),
        admin_email: values.adminEmail.trim(),
        admin_phone: values.adminPhone?.trim() || null,
        ...buildAddressFields(values),
      });
      setRegistrationId(response.registration_id);
      setDetailsValues(values);
      setIsResumeMode(false);
      setIsPaymentRetry(false);
      setPhase("OTP");
      toast.success(t("subOrgRegistration.wizard.toast.codeSent"));
    } catch (error) {
      // Duplicate email (and other 4xx) messages come from the backend
      const message = getSubOrgApiErrorMessage(
        error,
        isEditingAfterVerification
          ? t("subOrgRegistration.wizard.toast.saveError")
          : t("subOrgRegistration.wizard.toast.startError")
      );
      // /start's in-flight-duplicate rejection gets a door, not a dead end:
      // keep the typed values and offer to resume that registration inline.
      if (!isEditingAfterVerification && /already exists/i.test(message)) {
        setDetailsValues(values);
        setResumeEmail(values.adminEmail.trim());
        return;
      }
      toast.error(message);
    } finally {
      setIsStarting(false);
    }
  };

  /** Sends (or re-sends) the resume OTP and tracks the resumed registration. */
  const sendResumeCode = async (email: string) => {
    const response = await resumeSubOrgRegistration({
      institute_id: instituteId,
      code,
      admin_email: email,
    });
    setRegistrationId(response.registration_id);
  };

  /** Details-step "Resume registration" — fresh OTP via /resume, then OTP phase. */
  const handleResume = async () => {
    if (!resumeEmail) return;
    setIsResuming(true);
    setResumeError(null);
    try {
      await sendResumeCode(resumeEmail);
      setIsResumeMode(true);
      setOtpVerified(false);
      setPhase("OTP");
      toast.success(t("subOrgRegistration.wizard.toast.codeSent"));
    } catch (error) {
      // e.g. "No registration found for this email on this link"
      setResumeError(
        getSubOrgApiErrorMessage(
          error,
          t("subOrgRegistration.wizard.toast.resumeError")
        )
      );
    } finally {
      setIsResuming(false);
    }
  };

  /**
   * Resume-mode OTP verification — /resume-verify returns the saved details
   * plus where the registration left off; prefill, then route there:
   * OTP_VERIFIED → first post-OTP step (KYC self-detects VERIFIED on mount),
   * PENDING_PAYMENT → payment retry, COMPLETED → success panel.
   */
  const handleResumeVerify = async (otp: string) => {
    if (!registrationId) {
      toast.error(t("common.sessionMissing"));
      setPhase("DETAILS");
      return;
    }
    setIsVerifying(true);
    try {
      const response = await resumeVerifySubOrgOtp({ registrationId, otp });
      const details = response.details;
      const restoredEmail =
        details?.admin_email?.trim() ||
        resumeEmail ||
        detailsValues?.adminEmail ||
        "";
      setDetailsValues({
        orgName: details?.org_name ?? detailsValues?.orgName ?? "",
        orgLogoFileId: details?.org_logo_file_id ?? null,
        adminName: details?.admin_name ?? detailsValues?.adminName ?? "",
        adminEmail: restoredEmail,
        adminPhone: details?.admin_phone ?? "",
        addressLine1: details?.address_line1 ?? "",
        addressLine2: details?.address_line2 ?? "",
        city: details?.city ?? "",
        state: details?.state ?? "",
        pincode: details?.pincode ?? "",
      });
      setOtpVerified(true);
      setIsResumeMode(false);
      setResumeEmail(null);
      setResumeError(null);
      toast.success(t("subOrgRegistration.wizard.toast.emailVerified"));

      const status = (response.status || "").toUpperCase();
      const isRetry = status === "PENDING_PAYMENT" && hasPaymentStep;
      setIsPaymentRetry(isRetry);
      if (status === "COMPLETED") {
        // Payment webhook (or free completion) landed while the user was away.
        setCompletedEmail(restoredEmail);
        setPhase("SUCCESS");
      } else if (isRetry) {
        setPhase("PAYMENT");
      } else {
        await advanceAfter("OTP", customFieldValues);
      }
    } catch (error) {
      toast.error(
        getSubOrgApiErrorMessage(
          error,
          t("subOrgRegistration.wizard.toast.invalidOtp")
        )
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerifyOtp = async (otp: string) => {
    if (!registrationId) {
      toast.error(t("common.sessionMissing"));
      setPhase("DETAILS");
      return;
    }
    setIsVerifying(true);
    try {
      await verifySubOrgRegistrationOtp({ registrationId, otp });
      setOtpVerified(true);
      toast.success(t("subOrgRegistration.wizard.toast.emailVerified"));
      await advanceAfter("OTP", customFieldValues);
    } catch (error) {
      toast.error(
        getSubOrgApiErrorMessage(
          error,
          t("subOrgRegistration.wizard.toast.invalidOtp")
        )
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    if (!registrationId) return;
    setIsResending(true);
    try {
      if (isResumeMode && resumeEmail) {
        // /resend-otp guards on row status (COMPLETED throws) which is unknown
        // before verification — /resume always re-sends for a resumable row.
        await sendResumeCode(resumeEmail);
      } else {
        await resendSubOrgRegistrationOtp({ registrationId });
      }
      toast.success(t("subOrgRegistration.wizard.toast.codeResent"));
    } catch (error) {
      toast.error(
        getSubOrgApiErrorMessage(
          error,
          t("subOrgRegistration.wizard.toast.resendError")
        )
      );
    } finally {
      setIsResending(false);
    }
  };

  const handleCustomFieldsContinue = async (
    values: CustomFieldValuePayload[]
  ) => {
    setCustomFieldValues(values);
    await advanceAfter("CUSTOM_FIELDS", values);
  };

  const handleTncContinue = async () => {
    setTncAcceptedOnce(true);
    await advanceAfter("TNC", customFieldValues);
  };

  /** Only invoked by the KYC step once /kyc/status reports VERIFIED. */
  const handleKycContinue = async () => {
    await advanceAfter("KYC", customFieldValues);
  };

  /**
   * Back navigation — previous post-OTP step, or DETAILS from the first one
   * (OTP never needs re-entry: Details edits after verification go through
   * /update-details, which only re-triggers OTP when the email changed).
   */
  const goBackFrom = (
    step: "CUSTOM_FIELDS" | "TNC" | "KYC" | "PAYMENT"
  ) => {
    const index = postOtpSteps.indexOf(step);
    const previous = index > 0 ? postOtpSteps[index - 1] : undefined;
    setPhase(previous ?? "DETAILS");
  };

  /** Back from CUSTOM_FIELDS keeps whatever was typed (unvalidated). */
  const handleCustomFieldsBack = (values: CustomFieldValuePayload[]) => {
    setCustomFieldValues(values);
    goBackFrom("CUSTOM_FIELDS");
  };

  // ─── Progress indicator ────────────────────────────────────────────────────
  const progressSteps = useMemo(() => {
    const labels: { key: WizardPhase; label: string }[] = [
      { key: "DETAILS", label: t("subOrgRegistration.wizard.steps.details") },
      { key: "OTP", label: t("subOrgRegistration.wizard.steps.verifyEmail") },
    ];
    postOtpSteps.forEach((step) => {
      labels.push(
        step === "CUSTOM_FIELDS"
          ? {
              key: "CUSTOM_FIELDS",
              label: t("subOrgRegistration.wizard.steps.additionalInfo"),
            }
          : step === "TNC"
            ? { key: "TNC", label: t("subOrgRegistration.wizard.steps.terms") }
            : step === "KYC"
              ? {
                  key: "KYC",
                  label: t(
                    "subOrgRegistration.wizard.steps.identityVerification"
                  ),
                }
              : {
                  key: "PAYMENT",
                  label: t("subOrgRegistration.wizard.steps.payment"),
                }
      );
    });
    return labels;
  }, [postOtpSteps, t]);

  const currentStepIndex = progressSteps.findIndex((s) => s.key === phase);

  // Previously collected custom field values keyed by id (for back/forward)
  const customFieldValueMap = useMemo(
    () =>
      customFieldValues.reduce<Record<string, string>>((map, entry) => {
        map[entry.custom_field_id] = entry.value;
        return map;
      }, {}),
    [customFieldValues]
  );

  const isFinalPostOtpStep = (
    step: "CUSTOM_FIELDS" | "TNC" | "KYC" | "PAYMENT"
  ) => postOtpSteps[postOtpSteps.length - 1] === step;

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-neutral-50 to-primary-50">
      {/* Navbar Header */}
      <nav className="sticky top-0 z-50 border-b border-neutral-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-6">
          <div className="flex h-18 items-center justify-start p-3 py-3 sm:h-16 sm:py-4">
            <InstituteBrandingComponent
              branding={{
                instituteId: instituteId || null,
                instituteName:
                  instituteData?.institute_name ?? instituteData?.name ?? null,
                instituteLogoFileId:
                  instituteData?.institute_logo_file_id ?? null,
                instituteThemeCode:
                  (instituteData?.institute_theme_code as string) ||
                  (instituteData?.theme as string) ||
                  null,
                homeIconClickRoute: domainRouting.homeIconClickRoute ?? null,
                hideInstituteName: domainRouting.hideInstituteName,
                logoWidthPx: domainRouting.logoWidthPx,
                logoHeightPx: domainRouting.logoHeightPx,
              }}
              size="medium"
              showName={true}
              className="!flex-row !items-center !gap-3 sm:!gap-4"
            />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Header + progress */}
          {phase !== "SUCCESS" && (
            <div className="space-y-5">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-neutral-700 sm:text-3xl">
                  {template.template_name ||
                    t("subOrgRegistration.wizard.defaultTemplateName")}
                </h1>
                <p className="mt-1 text-sm text-neutral-500">
                  {t("subOrgRegistration.wizard.subtitle", {
                    instituteName:
                      instituteData?.institute_name ??
                      t("subOrgRegistration.wizard.defaultInstituteName"),
                  })}
                </p>
              </div>

              {/* Step progress */}
              <ol className="flex items-center justify-center gap-2 sm:gap-3">
                {progressSteps.map((step, index) => {
                  const isDone = currentStepIndex > index;
                  const isActive = currentStepIndex === index;
                  return (
                    <li key={step.key} className="flex items-center gap-2 sm:gap-3">
                      {index > 0 && (
                        <span
                          className={cn(
                            "h-px w-4 sm:w-8",
                            isDone || isActive
                              ? "bg-primary-400"
                              : "bg-neutral-300"
                          )}
                        />
                      )}
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "flex size-6 items-center justify-center rounded-full text-caption font-semibold",
                            isDone && "bg-success-500 text-white",
                            isActive && "bg-primary-500 text-white",
                            !isDone &&
                              !isActive &&
                              "border border-neutral-300 bg-white text-neutral-400"
                          )}
                        >
                          {isDone ? <Check className="size-3.5" /> : index + 1}
                        </span>
                        <span
                          className={cn(
                            "hidden text-caption sm:inline",
                            isActive
                              ? "font-semibold text-neutral-700"
                              : "text-neutral-500"
                          )}
                        >
                          {step.label}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {/* Step content */}
          {phase === "DETAILS" && (
            <DetailsStep
              initialValues={detailsValues}
              onSubmit={handleDetailsSubmit}
              isSubmitting={isStarting}
              orgNameHint={template.org_name_hint}
              collectAddress={collectAddress}
              isEditingAfterVerification={isEditingAfterVerification}
              resumeEmail={resumeEmail}
              onResume={handleResume}
              isResuming={isResuming}
              resumeError={resumeError}
            />
          )}

          {phase === "OTP" && detailsValues && (
            <OtpStep
              email={detailsValues.adminEmail}
              onVerify={isResumeMode ? handleResumeVerify : handleVerifyOtp}
              onResend={handleResendOtp}
              onEditDetails={() => setPhase("DETAILS")}
              isVerifying={isVerifying || isCompleting}
              isResending={isResending}
              resumeMode={isResumeMode}
            />
          )}

          {phase === "CUSTOM_FIELDS" && (
            <CustomFieldsStep
              customFields={template.custom_fields ?? []}
              initialValues={customFieldValueMap}
              isFinalStep={isFinalPostOtpStep("CUSTOM_FIELDS")}
              isSubmitting={isCompleting}
              onContinue={handleCustomFieldsContinue}
              onBack={handleCustomFieldsBack}
            />
          )}

          {phase === "TNC" && (
            <TncStep
              tncFileId={template.tnc_file_id}
              tncConsentItems={template.tnc_consent_items}
              isSubmitting={isCompleting}
              onContinue={handleTncContinue}
              continueLabel={
                isFinalPostOtpStep("TNC") ? undefined : t("common.continue")
              }
              onBack={() => goBackFrom("TNC")}
              initialAccepted={tncAcceptedOnce}
            />
          )}

          {phase === "KYC" && (
            <KycStep
              registrationId={registrationId}
              kycDocuments={template.kyc_documents}
              kycInstructions={template.kyc_instructions}
              isFinalStep={isFinalPostOtpStep("KYC")}
              isSubmitting={isCompleting}
              onContinue={handleKycContinue}
              onSessionMissing={() => setPhase("DETAILS")}
              onBack={() => goBackFrom("KYC")}
            />
          )}

          {phase === "PAYMENT" && template.payment && detailsValues && (
            <Suspense fallback={<DashboardLoader />}>
              <PaymentGatewayWrapper
                vendor={
                  (template.payment.vendor || "").toUpperCase() as PaymentVendor
                }
                instituteId={instituteId}
              >
                <PaymentStep
                  payment={template.payment}
                  templateName={
                    template.template_name ||
                    t("subOrgRegistration.wizard.defaultTemplateName")
                  }
                  instituteId={instituteId}
                  code={code}
                  registrationId={registrationId}
                  tncAccepted={hasTncStep}
                  customFieldValues={customFieldValues}
                  adminName={detailsValues.adminName}
                  adminEmail={detailsValues.adminEmail}
                  adminPhone={detailsValues.adminPhone ?? ""}
                  retryMode={isPaymentRetry}
                  onRegistered={(email) => {
                    setCompletedEmail(email || detailsValues.adminEmail || "");
                    setPhase("SUCCESS");
                  }}
                  onSessionMissing={() => setPhase("DETAILS")}
                  onBack={
                    // A resumed PENDING_PAYMENT session has no earlier wizard
                    // steps to go back to — the plan is locked server-side.
                    isPaymentRetry ? undefined : () => goBackFrom("PAYMENT")
                  }
                />
              </PaymentGatewayWrapper>
            </Suspense>
          )}

          {phase === "SUCCESS" && (
            <SuccessStep
              orgName={detailsValues?.orgName ?? ""}
              adminEmail={completedEmail ?? detailsValues?.adminEmail ?? ""}
              paid={hasPaymentStep}
              template={template}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default RegistrationWizard;
