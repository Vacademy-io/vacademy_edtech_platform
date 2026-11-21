import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { CaretLeft, CaretRight, X } from "@phosphor-icons/react";
import axios from "axios";
import { LIVE_SESSION_REQUEST_OTP, LIVE_SESSION_VERIFY_OTP, CATALOGUE_LEAD_SUBMIT_URL } from "@/constants/urls";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/bootstrap.css";
import { isValidPhoneValue } from "@/lib/phone-validation";
import {
  phoneFieldHasInput,
  usePreferredPhoneCountries,
} from "@/hooks/use-preferred-phone-countries";
import { useSiteT } from "../-utils/catalogue-locale";

interface FieldOption {
  label: string;
  value: string;
  levelId?: string;
  packageSessionId?: string;
}

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'chips' | 'dropdown';
  required: boolean;
  step: number;
  options?: FieldOption[];
  style?: {
    variant?: 'filled' | 'outlined';
    chipColor?: string;
    allowMultiple?: boolean;
  };
}

interface FormStyle {
  type: 'single' | 'multiStep';
  showProgress: boolean;
  progressType: 'bar' | 'dots' | 'steps';
  transition: 'slide' | 'fade';
}

interface LeadCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
  settings: {
    enabled: boolean;
    mandatory: boolean;
    inviteLink: string | null;
    formStyle?: FormStyle;
    fields: FormField[];
  };
  instituteId: string;
  mandatory: boolean;
  /** Package session of the course this modal was opened from (course-detail
   *  context). Used as a fallback for the lead payload when the form itself
   *  doesn't carry one via a Level dropdown. */
  packageSessionId?: string;
}

interface FormData {
  [key: string]: string;
}

export const LeadCollectionModal: React.FC<LeadCollectionModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  settings,
  instituteId,
  mandatory,
  packageSessionId,
}) => {
  const { t } = useTranslation("coursePlayerA");
  // Field and option LABELS are shown in the visitor's language; names and
  // option values (what is matched and submitted) always stay as authored.
  const siteT = useSiteT();
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
  const [formData, setFormData] = useState<FormData>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedPackageSessionId, setSelectedPackageSessionId] = useState<string | null>(null);
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtp, setEmailOtp] = useState('');
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const successCloseRef = useRef<HTMLButtonElement>(null);
  const showSuccessPopupRef = useRef(false);

  // When the success popup appears it manages its own focus; move focus to its
  // Close button and let the dialog focus-trap stand down (see onKeyDown below).
  useEffect(() => {
    showSuccessPopupRef.current = showSuccessPopup;
    if (showSuccessPopup) successCloseRef.current?.focus();
  }, [showSuccessPopup]);

  // Resend-OTP cooldown countdown
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setTimeout(() => setOtpCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [otpCooldown]);

  // Debug logging
  console.log("[LeadCollectionModal] Props received:", {
    isOpen,
    mandatory,
    settings,
    instituteId
  });

  // Get form style configuration
  const formStyle = settings.formStyle || {
    type: 'single',
    showProgress: false,
    progressType: 'bar',
    transition: 'slide'
  };

  // Get total steps
  const totalSteps = Math.max(...settings.fields.map(field => field.step), 1);

  // Get fields for current step
  const currentStepFields = settings.fields.filter(field => field.step === currentStep);

  // Initialize form data when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({});
      setCurrentStep(1);
      setSelectedPackageSessionId(null);
      setEmailOtpSent(false);
      setEmailOtp('');
      setIsVerifyingOtp(false);
      setEmailVerified(false);
    }
  }, [isOpen]);

  // Validation functions
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Validate the full number for the selected country (libphonenumber) — not a
  // hardcoded 10-digit rule. India → 10 digits, other countries → their length.
  const validatePhone = (phone: string): boolean => isValidPhoneValue(phone);

  // Detect the phone field even when the page-builder config doesn't type it as
  // "tel" (some configs use "text" or rely on the field name/label).
  const isPhoneField = (field: FormField) =>
    field.type === "tel" ||
    /phone|mobile|contact|whatsapp/i.test(field.name || "") ||
    /phone|mobile|contact|whatsapp/i.test(field.label || "");

  // What this phone field starts on: the institute's configured preferred
  // countries, or — when it configured none, or the portal is on GEO_FIRST —
  // the country the visitor is opening this page from.
  //
  // Declared below `isPhoneField` because the freeze flag needs it. Catalogue
  // pages are public and can render before domain routing replies, which used to
  // leave the field on the platform fallback (+91) for every visitor; this takes
  // the institute's answer whenever it lands, and never once a number has been
  // typed into any phone field on the form.
  // `isPhoneField` alone is NOT the right test here: `renderField` returns early
  // for a chips field, so one named e.g. "preferred_contact" matches that regex
  // but renders as buttons, never as a phone input. Counting it would let a chip
  // value with digits in it trip the hook's permanent freeze latch and stop the
  // real phone field from ever picking up the institute's preference. Mirror the
  // renderer's own precedence instead.
  const rendersAsPhoneInput = (field: FormField) =>
    !(field.type === "chips" && field.options) && isPhoneField(field);

  const hasTypedPhone = settings.fields.some(
    (field) => rendersAsPhoneInput(field) && phoneFieldHasInput(formData[field.name]),
  );
  const { defaultCountry: defaultPhoneCountry, preferredCountries } =
    usePreferredPhoneCountries({ freeze: hasTypedPhone });

  // OTP verification functions
  const handleSendOtp = async () => {
    const email = formData.email;
    console.log("[LeadCollectionModal] Sending OTP for email:", email);
    console.log("[LeadCollectionModal] Institute ID:", instituteId);
    console.log("[LeadCollectionModal] API URL:", LIVE_SESSION_REQUEST_OTP);
    
    if (!email || !validateEmail(email)) {
      toast.error(t("common.invalidEmail"));
      return;
    }

    try {
      const response = await axios.post(
        LIVE_SESSION_REQUEST_OTP,
        {
          to: email.trim(),
        },
        {
          headers: {
            accept: "*/*",
            "Content-Type": "application/json",
          },
          params: {
            instituteId,
          },
        }
      );

      setEmailOtpSent(true);
      setOtpCooldown(30);
      toast.success(t("common.otpSent"));
    } catch (error) {
      console.error("[LeadCollectionModal] Error sending OTP:", error);
      console.error("[LeadCollectionModal] Error details:", {
        message: error instanceof Error ? error.message : 'Unknown error',
        response: error instanceof Error && 'response' in error ? (error as any).response : null
      });
      toast.error(t("common.otpSendFailed"));
    }
  };

  const handleVerifyOtp = async () => {
    if (!emailOtp || emailOtp.length !== 6) {
      toast.error(t("leadCollectionModal.otpIncomplete"));
      return;
    }

    setIsVerifyingOtp(true);
    try {
      await axios.post(
        LIVE_SESSION_VERIFY_OTP,
        {
          to: formData.email,
          otp: emailOtp,
          client_name: "LEARNER",
          institute_id: instituteId,
        },
        {
          headers: {
            accept: "*/*",
            "Content-Type": "application/json",
          },
        }
      );

      setEmailVerified(true);
      setEmailOtpSent(false);
      setEmailOtp("");
      toast.success(t("common.emailVerified"));
    } catch (error) {
      console.error("Error verifying OTP:", error);
      toast.error(t("common.otpVerifyFailed"));
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
    
    // Reset email verification if email changes
    if (field === 'email') {
      setEmailVerified(false);
      setEmailOtpSent(false);
      setEmailOtp('');
    }
  };

  const handleChipSelection = (field: FormField, option: FieldOption) => {
    setFormData((prev) => ({
      ...prev,
      [field.name]: option.value,
    }));
    
    // Store package session ID for this level
    if (option.packageSessionId) {
      setSelectedPackageSessionId(option.packageSessionId);
    }
  };

  const canProceedToNextStep = () => {
    const requiredFields = currentStepFields.filter(field => field.required);
    return requiredFields.every(field => {
      const value = formData[field.name];
      if (!value || value.toString().trim() === '') {
        return false;
      }
      
      // Additional validation for specific field types
      if (field.type === 'email' && !validateEmail(value)) {
        return false;
      }
      if (isPhoneField(field) && !validatePhone(value)) {
        return false;
      }
      
      // For email field, also check if OTP is verified
      if (field.type === 'email' && !emailVerified) {
        return false;
      }
      
      return true;
    });
  };

  const handleNextStep = () => {
    if (canProceedToNextStep() && currentStep < totalSteps) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePreviousStep = () => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check all required fields across all steps
    const allRequiredFields = settings.fields.filter(field => field.required);
    const missingRequiredFields = allRequiredFields.filter(field => 
      !formData[field.name]?.trim()
    );
    
    if (missingRequiredFields.length > 0) {
      toast.error(t("leadCollectionModal.requiredFieldsMissing"));
      return;
    }

    // Validate formats (email + phone) before submitting — don't submit bad data.
    for (const field of settings.fields) {
      const value = formData[field.name];
      if (!value) continue;
      if (field.type === "email" && !validateEmail(value)) {
        toast.error(t("common.invalidEmail"));
        return;
      }
      if (isPhoneField(field) && !validatePhone(value)) {
        toast.error(t("leadCollectionModal.invalidPhone"));
        return;
      }
    }

    setIsSubmitting(true);
    
    try {
      // Carry every filled form field as a custom field value so the Recent
      // Leads table can show them (name/email/phone are also sent top-level).
      const customFieldValues: Record<string, string> = {};
      settings.fields.forEach((field) => {
        const value = formData[field.name];
        if (value != null && String(value).trim() !== "") {
          customFieldValues[field.name] = String(value);
        }
      });

      // Public catalogue-lead endpoint: creates an audience_response so the lead
      // shows up in admin Audience Manager → Recent Leads (and triggers lead
      // workflows). The backend resolves/creates the per-institute audience.
      const payload = {
        institute_id: instituteId,
        full_name: formData.name || "",
        email: formData.email || "",
        mobile_number: formData.phone || "",
        // package_session of the course the lead came from (empty on the catalogue home)
        source_id: selectedPackageSessionId || packageSessionId || "",
        custom_field_values: customFieldValues,
      };

      const response = await axios.post(CATALOGUE_LEAD_SUBMIT_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log("Lead collection response:", response.data);

      const alreadySubmitted =
        typeof response.data === "string" &&
        response.data.toLowerCase().includes("already submitted");
      setSuccessMessage(
        alreadySubmitted
          ? t("leadCollectionModal.success.alreadySubmitted")
          : t("leadCollectionModal.success.submitted")
      );
      setShowSuccessPopup(true);
    } catch (error: any) {
      console.error("Error collecting lead data:", error);
      toast.error(t("leadCollectionModal.submitFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (mandatory) {
      // If mandatory, don't allow closing
      return;
    }
    onClose();
  };

  // Accessibility: focus the dialog on open, trap Tab within it, close on Escape
  // (Escape no-ops when mandatory, mirroring the backdrop/close-button behavior),
  // and restore focus to the previously-focused element on close.
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const getFocusable = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    (getFocusable()[0] || node)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      // The success popup overlays the form and owns focus; don't trap.
      if (showSuccessPopupRef.current) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node?.addEventListener("keydown", onKeyDown);
    return () => {
      node?.removeEventListener("keydown", onKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Progress bar component
  const renderProgressBar = () => {
    if (!formStyle.showProgress || formStyle.type === 'single') return null;

    const progress = (currentStep / totalSteps) * 100;

    if (formStyle.progressType === 'bar') {
      return (
        <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
          <div 
            className="bg-primary-500 h-2 rounded-full transition-all duration-300 ease-in-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      );
    }

    if (formStyle.progressType === 'dots') {
      return (
        <div className="flex justify-center space-x-2 mb-6">
          {Array.from({ length: totalSteps }, (_, index) => (
            <div
              key={index}
              className={`w-3 h-3 rounded-full transition-all duration-300 ${
                index + 1 <= currentStep ? 'bg-primary-500' : 'bg-gray-300'
              }`}
            />
          ))}
        </div>
      );
    }

    if (formStyle.progressType === 'steps') {
      return (
        <div className="flex justify-between items-center mb-6">
          {Array.from({ length: totalSteps }, (_, index) => (
            <div key={index} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
                  index + 1 <= currentStep
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-300 text-gray-600'
                }`}
              >
                {index + 1}
              </div>
              {index < totalSteps - 1 && (
                <div
                  className={`w-12 h-0.5 mx-2 transition-all duration-300 ${
                    index + 1 < currentStep ? 'bg-primary-500' : 'bg-gray-300'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      );
    }

    return null;
  };

  // Render field based on type
  const renderField = (field: FormField) => {
    const fieldValue = formData[field.name] || "";

    if (field.type === 'chips' && field.options) {
      return (
        <div key={field.name} className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            {siteT(field.label)} {field.required && "*"}
          </label>
          <div className="flex flex-wrap gap-2">
            {field.options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleChipSelection(field, option)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                  fieldValue === option.value
                    ? 'bg-primary-500 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                }`}
                style={{
                  backgroundColor: fieldValue === option.value ? field.style?.chipColor : undefined,
                }}
              >
                {siteT(option.label)}
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div key={field.name} className="space-y-3">
        <label htmlFor={field.name} className="block text-sm font-medium text-gray-700 mb-1">
          {siteT(field.label)} {field.required && "*"}
        </label>
        <div className="space-y-2">
          {isPhoneField(field) ? (
            <PhoneInput
              country={defaultPhoneCountry}
              enableSearch={true}
              value={fieldValue}
              onChange={(value) => handleInputChange(field.name, value)}
              inputClass="!w-full !h-11 !rounded-catalogue-sm !border-gray-300"
              buttonClass="!rounded-s-catalogue-sm !border-gray-300"
              containerClass="!w-full"
              placeholder={t("leadCollectionModal.phonePlaceholder")}
              countryCodeEditable={false}
              enableAreaCodes={false}
              preferredCountries={preferredCountries}
            />
          ) : (
            <input
              type={field.type}
              id={field.name}
              value={fieldValue}
              onChange={(e) => handleInputChange(field.name, e.target.value)}
              className={`w-full px-3 py-2 border rounded-catalogue-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent ${
                field.type === 'email' && fieldValue && !validateEmail(fieldValue)
                  ? 'border-red-300'
                  : 'border-gray-300'
              }`}
              placeholder={t("leadCollectionModal.enterYourField", { field: siteT(field.label).toLowerCase() })}
              required={field.required}
            />
          )}
          
           {/* OTP Buttons - Responsive layout */}
           {field.type === 'email' && fieldValue && validateEmail(fieldValue) && !emailVerified && (
             <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
               {!emailOtpSent ? (
                 <button
                   type="button"
                   onClick={handleSendOtp}
                   className="catalogue-btn catalogue-btn-primary catalogue-btn-sm w-full sm:w-auto"
                 >
                   {t("leadCollectionModal.sendOtp")}
                 </button>
               ) : (
                 <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
                   <span className="inline-flex items-center px-3 py-2 bg-green-100 text-green-800 rounded-catalogue-sm text-sm" role="status" aria-live="polite">
                     {t("leadCollectionModal.otpSentToEmail")}
                   </span>
                   <button
                     type="button"
                     onClick={handleSendOtp}
                     disabled={otpCooldown > 0}
                     className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                     {otpCooldown > 0 ? t("leadCollectionModal.resendIn", { seconds: otpCooldown }) : t("leadCollectionModal.resendOtp")}
                   </button>
                 </div>
               )}
             </div>
           )}

          {field.type === 'email' && emailVerified && (
            <div className="flex items-center justify-center sm:justify-start px-3 py-2 bg-green-100 text-green-800 rounded-catalogue-sm text-sm" role="status" aria-live="polite">
              {t("leadCollectionModal.emailVerifiedConfirm")}
            </div>
          )}
        </div>

         {/* OTP Verification Section */}
         {field.type === 'email' && emailOtpSent && !emailVerified && (
           <div className="space-y-2">
             <label htmlFor="lead-otp-input" className="block text-sm font-medium text-gray-700">
               {t("leadCollectionModal.enterOtpLabel")}
             </label>
             <div className="space-y-2">
               <input
                 id="lead-otp-input"
                 type="text"
                 inputMode="numeric"
                 autoComplete="one-time-code"
                 value={emailOtp}
                 onChange={(e) => setEmailOtp(e.target.value)}
                 placeholder={t("leadCollectionModal.otpPlaceholder")}
                 maxLength={6}
                 className="w-full px-3 py-2 border border-gray-300 rounded-catalogue-sm focus:ring-2 focus:ring-primary-400 focus:border-transparent"
               />
               <div className="flex justify-end">
                 <button
                   type="button"
                   onClick={handleVerifyOtp}
                   disabled={isVerifyingOtp || emailOtp.length !== 6}
                   className="catalogue-btn catalogue-btn-primary catalogue-btn-sm w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                   {isVerifyingOtp ? t("leadCollectionModal.verifying") : t("leadCollectionModal.verifyOtp")}
                 </button>
               </div>
             </div>
           </div>
         )}

        {/* Helper Text for Phone Numbers */}
        {isPhoneField(field) && (
          <p className="text-gray-500 text-xs">{t("leadCollectionModal.phoneHelper")}</p>
        )}

        {/* Validation Messages */}
        {field.type === 'email' && fieldValue && !validateEmail(fieldValue) && (
          <p className="text-red-500 text-sm">{t("common.invalidEmail")}</p>
        )}
        {isPhoneField(field) && fieldValue && !validatePhone(fieldValue) && (
          <p className="text-red-500 text-sm">{t("leadCollectionModal.invalidPhoneCountry")}</p>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={handleClose}
        />

        {/* Modal */}
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="lead-modal-title"
          tabIndex={-1}
          className="relative bg-white rounded-catalogue-md shadow-xl max-w-md w-full mx-auto outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200">
            <h2 id="lead-modal-title" className="text-lg sm:text-xl font-semibold text-gray-900">
              {mandatory
                ? t("leadCollectionModal.completeRegistration")
                : t("common.getCourseDetails", { course })}
            </h2>
            <div className="flex items-center gap-2">
            {!mandatory && (
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                  <X className="w-6 h-6" aria-hidden="true" />
              </button>
            )}
            </div>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="p-4 sm:p-6">
            <div className="mb-4">
              <p className="text-gray-600 text-sm">
                {mandatory
                  ? t("leadCollectionModal.mandatoryHint", { courses })
                  : t("leadCollectionModal.optionalHint", { course })
                }
              </p>
              
            </div>

            {/* Progress Bar */}
            {renderProgressBar()}

            {/* Form Fields */}
            <div className="space-y-4 min-h-48">
              {formStyle.type === 'multiStep' ? (
                <div className={`transition-all duration-300 ${
                  formStyle.transition === 'slide' ? 'transform' : ''
                }`}>
                  {currentStepFields.map(renderField)}
                </div>
              ) : (
                settings.fields.map(renderField)
              )}
            </div>

            {/* Navigation Footer */}
            <div className="flex justify-between items-center gap-3 mt-6">
              {/* Left side - Previous and Cancel buttons */}
              <div className="flex gap-3">
                {formStyle.type === 'multiStep' && currentStep > 1 && (
                  <button
                    type="button"
                    onClick={handlePreviousStep}
                    className="flex items-center px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-catalogue-sm transition-colors"
                  >
                    <CaretLeft className="w-4 h-4 me-1" />
                    {t("common.previous")}
                  </button>
                )}
                {!mandatory && formStyle.type === 'single' && (
                <button
                  type="button"
                  onClick={handleClose}
                    className="catalogue-btn catalogue-btn-secondary"
                >
                    {t("common.cancel")}
                </button>
              )}
              </div>
              
              {/* Right side - Next and Submit buttons */}
              <div className="flex gap-3">
                {formStyle.type === 'multiStep' && currentStep < totalSteps ? (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    disabled={!canProceedToNextStep()}
                    className="catalogue-btn catalogue-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t("common.next")}
                    <CaretRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                ) : (
              <button
                type="submit"
                    disabled={isSubmitting || (formStyle.type === 'multiStep' && !canProceedToNextStep())}
                    className="catalogue-btn catalogue-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? t("leadCollectionModal.submitting") : t("common.submit")}
              </button>
                )}
              </div>
            </div>
          </form>

          {/* Invite Link */}
          {settings.inviteLink && (
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
              <p className="text-xs text-gray-500 text-center">
                {t("leadCollectionModal.haveInviteCode")}{" "}
                <a
                  href={settings.inviteLink}
                  className="text-primary-600 hover:text-primary-700 underline"
                >
                  {t("leadCollectionModal.clickHere")}
                </a>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Success Popup */}
      {showSuccessPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-catalogue-md shadow-xl max-w-md w-full mx-4 p-6">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">{t("leadCollectionModal.requestSent")}</h3>
              <p className="text-sm text-gray-600 mb-6">{successMessage}</p>
              <button
                ref={successCloseRef}
                onClick={() => {
                  setShowSuccessPopup(false);
                  onSubmit();
                }}
                className="catalogue-btn catalogue-btn-primary w-full"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
