import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { GraduationCap, ArrowCounterClockwise } from "@phosphor-icons/react";
import { FormProvider, UseFormReturn, useWatch } from "react-hook-form";
import { FormControl, FormField, FormItem } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import PhoneInputField from "@/components/design-system/phone-input-field";
import ComboboxField from "@/components/design-system/combobox-field";
import { CustomFieldRenderer } from "@/components/common/custom-fields/CustomFieldRenderer";
import { MyButton } from "@/components/design-system/button";
import { Calendar, CreditCard, Globe } from "@phosphor-icons/react";
import { getCurrencySymbol } from "@/utils/currency";
import { getDefaultPlanFromPaymentsData, PaymentPlan } from "../-utils/helper";
import { SubscriptionPlanSection } from "./subscription-plan-sections";
import { OneTimePlanSection } from "./onetime-plan-section";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import {
  LIVE_SESSION_REQUEST_OTP,
  LIVE_SESSION_VERIFY_OTP,
} from "@/constants/urls";
import axios from "axios";
import {
  FieldRenderType,
  getFieldRenderType,
} from "../-utils/custom-field-helpers";
import { capitalise } from "@/utils/custom-field";
import {
  getCountryCode,
  lookupCountryCode,
  findCountryFieldKey,
} from "../-utils/country-code-mapping";
import { EMAIL_OTP_VERIFICATION_ENABLED } from "@/constants/feature-flags";
// Replace heavy country-state-city with lightweight country-region-data
// import { State, City } from "country-state-city";
import { allCountries } from "country-region-data";

// Course data interface
export interface FinalCourseData {
  aboutCourse: string;
  course: string;
  courseBanner: string;
  customHtml: string;
  description: string;
  includeInstituteLogo: boolean;
  includePaymentPlans: boolean;
  learningOutcome: string;
  restrictToSameBatch: boolean;
  showRelatedCourses: boolean;
  tags: string[];
  targetAudience: string;
}

// Form field value interface
export interface FormFieldValue {
  id: string;
  name: string;
  value: string;
  is_mandatory: boolean;
  type: string;
  render_type?: FieldRenderType; // Add render type to determine how to display the field
  comma_separated_options?: Array<{
    _id: number;
    value: string;
    label: string;
  }>;
  config?: string;
}

// Form values interface
export interface FormValues {
  [key: string]: FormFieldValue;
}

// Invite data interface
export interface InviteData {
  id: string;
  institute_id: string;
  type: string;
  type_id: string;
  custom_field: {
    id: string;
    fieldKey: string;
    fieldName: string;
    fieldType: string;
    defaultValue: string;
    config: string;
    formOrder: number;
    isMandatory: boolean;
    isFilter: boolean;
    isSortable: boolean;
    createdAt: string;
    updatedAt: string;
    sessionId: string;
    liveSessionId: string | null;
    customFieldValue: string | null;
  };
}

// Registration step props interface
export interface BillingContactState {
  hasSeparate: boolean;
  name: string;
  email: string;
  role: string;
}

export const EMPTY_BILLING_CONTACT: BillingContactState = {
  hasSeparate: false,
  name: "",
  email: "",
  role: "",
};

/**
 * Per-field configuration for the billing-contact form. Mirrors the
 * `postformfillConfiguration.billingContactFields` shape written by the admin
 * invite-settings page. Each field has a customizable label + required flag;
 * the role field also takes a comma-separated `options` string which, when
 * non-empty, switches the input from free-text to a dropdown.
 */
export interface BillingContactFieldsConfig {
  name?:  { label?: string; required?: boolean };
  email?: { label?: string; required?: boolean };
  role?:  { label?: string; required?: boolean; options?: string };
}

const getDefaultBillingFieldLabels = (t: TFunction) => ({
  name: t("registrationStep.billingContact.fullNameLabel"),
  email: t("registrationStep.billingContact.emailLabel"),
  role: t("registrationStep.billingContact.roleLabel"),
});

export interface RegistrationStepProps {
  /** Course data containing all course-related information */
  courseData: FinalCourseData;
  /** Invite data containing custom field configurations */
  inviteData: InviteData | null;
  /** Institute ID for OTP verification */
  instituteId: string;
  /** Callback function called when form is submitted */
  onSubmit: (values: FormValues) => void;
  /** React Hook Form instance */
  form: UseFormReturn<FormValues>;
  /** Admin gate: invite enabled "Collect Billing Contact Details" */
  collectBillingContact?: boolean;
  /** Controlled billing-contact state (lifted to enroll-form) */
  billingContact?: BillingContactState;
  /** Callback fired when any billing-contact field changes */
  onBillingContactChange?: (next: BillingContactState) => void;
  /** Per-field config from invite's settingJson (label, required, role options) */
  billingContactFields?: BillingContactFieldsConfig;
}

// Currency symbols come from the shared currency util so every flow stays in sync.
export { getCurrencySymbol };

export const getPaymentPlanIcon = (type: string) => {
  switch (type) {
    case "SUBSCRIPTION":
      return <Calendar className="size-5" />;
    case "FREE":
      return <Globe className="size-5" />;
    default:
      return <CreditCard className="size-5" />;
  }
};

export const getAllUniqueFeatures = (
  paymentOptions: PaymentPlan[]
): string[] => {
  const allFeatures = new Set<string>();
  paymentOptions?.map((option) => {
    const features = JSON.parse(option.feature_json || "[]") as string[];
    features?.forEach((feature: string) => {
      allFeatures.add(feature);
    });
  });
  return Array.from(allFeatures);
};

const RegistrationStep = ({
  courseData,
  inviteData,
  instituteId,
  onSubmit,
  form,
  collectBillingContact = false,
  billingContact = EMPTY_BILLING_CONTACT,
  onBillingContactChange,
  billingContactFields,
}: RegistrationStepProps) => {
  const { t } = useTranslation("enrollmentA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const defaultBillingFieldLabels = getDefaultBillingFieldLabels(t);
  // Resolve the per-field billing config once. Falls back to the previously
  // hard-coded labels + required-ness so invites written before the admin
  // schema landed continue to render exactly as they used to.
  const billingFieldConfig = {
    name: {
      label: billingContactFields?.name?.label || defaultBillingFieldLabels.name,
      required: billingContactFields?.name?.required ?? true,
    },
    email: {
      label: billingContactFields?.email?.label || defaultBillingFieldLabels.email,
      required: billingContactFields?.email?.required ?? true,
    },
    role: {
      label: billingContactFields?.role?.label || defaultBillingFieldLabels.role,
      required: billingContactFields?.role?.required ?? true,
      options: (billingContactFields?.role?.options || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };

  const updateBillingContact = (patch: Partial<BillingContactState>) => {
    if (!onBillingContactChange) return;
    onBillingContactChange({ ...billingContact, ...patch });
  };
  // Sub-step: 0 = fill details, 1 = verify OTP
  const [subStep, setSubStep] = useState(0);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [otp, setOtp] = useState("");
  const [isLoadingOtp, setIsLoadingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  
  const planInfo =
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    inviteData?.package_session_to_payment_options?.[0]?.payment_option;
  const selectedPlan = getDefaultPlanFromPaymentsData(planInfo);

  // Find the country field key dynamically (memoized)
  const countryFieldKey = useMemo(() => {
    const values = form.getValues();
    return findCountryFieldKey(values);
  }, [form]);

  // Watch all form values to detect country field changes
  const formValues = useWatch({
    control: form.control,
  });

  // A country field in this form, when there is one, is the strongest signal
  // — the visitor just told us where they are.
  //
  // Undefined means "no such signal", and PhoneInputField then resolves the
  // country itself through the portal's chain (institute preference, else the
  // region the form is opened in). It has to be undefined rather than that
  // chain's answer read here: a `country` prop overrides the field's own
  // resolution, so passing a value read before domain routing replied would
  // pin the field to the platform fallback (+91) even after the real
  // preference arrived.
  const getPhoneCountryCode = (): string | undefined => {
    if (countryFieldKey && formValues) {
      const countryField = formValues[countryFieldKey];
      if (countryField && typeof countryField.value === "string") {
        return lookupCountryCode(countryField.value);
      }
    }
    return undefined;
  };

  // Memoize state and city options to prevent recalculation on every render
  // This fixes the "Maximum call stack size exceeded" error on mobile
  // Extract specific values needed for options calculation
  // We use formValues from useWatch or fall back to getValues
  const currentValues = formValues || form.getValues();
  const currentCountryValue = countryFieldKey ? currentValues[countryFieldKey]?.value : undefined;

  // Memoize state and city options to prevent recalculation on every render
  // heavily optimized to run ONLY when country or state actually changes
  // Use state + useEffect for heavy calculations to avoid blocking render stack
  const [availableStateOptions, setAvailableStateOptions] = useState<{ _id: number; value: string; label: string }[]>([]);
  const [availableCityOptions, setAvailableCityOptions] = useState<{ _id: number; value: string; label: string }[]>([]);

  useEffect(() => {
    // If no country, clear options immediately
    if (!currentCountryValue) {
      setAvailableStateOptions([]);
      setAvailableCityOptions([]);
      return;
    }

    try {
      const countryCode = getCountryCode(String(currentCountryValue)).toUpperCase();
      
      // Find country in the lightweight dataset
      // Format: [CountryName, CountrySlug, Regions[]]
      const countryData = allCountries.find(c => c[1] === countryCode);
      
      let stateOptions: { _id: number; value: string; label: string }[] = [];

      if (countryData) {
        const regions = countryData[2]; // Index 2 is the regions array
         stateOptions = regions.map((region, index) => ({
            _id: index,
            value: region[0], // Index 0 is Region Name
            label: region[0],
         }));
      }

      setAvailableStateOptions(stateOptions);
      // Clear city options as they are not supported by this library
      setAvailableCityOptions([]);
      
    } catch (error) {
      console.error("Error calculating location options:", error);
    }
  }, [currentCountryValue]);

  // Helper function to find the email field dynamically
  const getEmailField = () => {
    const formData = form.getValues();
    const emailEntry = Object.entries(formData).find(([key, value]) => {
      const renderType =
        value.render_type || getFieldRenderType(key, value.type || "text");
      return renderType === FieldRenderType.EMAIL;
    });
    return emailEntry
      ? { key: emailEntry[0], value: emailEntry[1].value }
      : null;
  };

  // Check if all required fields are filled (excluding email verification)
  const areAllFieldsFilled = () => {
    return Object.entries(form.getValues()).every(
      ([, value]: [string, FormFieldValue]) =>
        !value.is_mandatory || value.value
    );
  };

  // Handle "Next" click - validate form and send OTP (or skip if disabled)
  const handleNextClick = async () => {
    // Validate all fields first
    const isValid = await form.trigger();
    if (!isValid) {
      toast.error(t("registrationStep.errors.fillRequiredFields"));
      return;
    }

    if (!areAllFieldsFilled()) {
      toast.error(t("registrationStep.errors.fillRequiredFields"));
      return;
    }

    const emailField = getEmailField();
    if (!emailField || !emailField.value) {
      toast.error(t("registrationStep.errors.enterEmail"));
      return;
    }

    const email = emailField.value;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error(t("registrationStep.errors.enterValidEmail"));
      return;
    }

    if (collectBillingContact && billingContact.hasSeparate) {
      const trimmedName = billingContact.name.trim();
      const trimmedEmail = billingContact.email.trim();
      const trimmedRole = billingContact.role.trim();
      // Per-field required check honours the invite's billingContactFields config.
      // A field marked required=false is allowed to be empty; the rest still need
      // to be filled. Email format is only validated when a value is present
      // (matches the spirit of "optional but valid").
      if (billingFieldConfig.name.required && !trimmedName) {
        toast.error(t("registrationStep.errors.pleaseEnterField", { field: billingFieldConfig.name.label.toLowerCase() }));
        return;
      }
      if (billingFieldConfig.email.required && !trimmedEmail) {
        toast.error(t("registrationStep.errors.pleaseEnterField", { field: billingFieldConfig.email.label.toLowerCase() }));
        return;
      }
      if (billingFieldConfig.role.required && !trimmedRole) {
        toast.error(t("registrationStep.errors.pleaseEnterField", { field: billingFieldConfig.role.label.toLowerCase() }));
        return;
      }
      if (trimmedEmail && !emailRegex.test(trimmedEmail)) {
        toast.error(t("registrationStep.errors.pleaseEnterValidField", { field: billingFieldConfig.email.label.toLowerCase() }));
        return;
      }
    }

    // If email OTP verification is disabled, skip directly to form submission
    if (!EMAIL_OTP_VERIFICATION_ENABLED) {
      setIsEmailVerified(true);
      form.handleSubmit(onSubmit, (err) => console.error(err))();
      return;
    }

    setUserEmail(email);
    setIsLoadingOtp(true);

    try {
      await axios.post(
        LIVE_SESSION_REQUEST_OTP,
        { to: email },
        {
          headers: {
            accept: "*/*",
            "Content-Type": "application/json",
          },
          params: { instituteId },
        }
      );

      setSubStep(1);
      toast.success(t("registrationStep.otp.codeSent"));
    } catch (error) {
      toast.error(t("registrationStep.otp.sendFailed"));
      console.error("Send OTP Error:", error);
    } finally {
      setIsLoadingOtp(false);
    }
  };

  // Resend OTP
  const handleResendOTP = async () => {
    setIsLoadingOtp(true);
    try {
      await axios.post(
        LIVE_SESSION_REQUEST_OTP,
        { to: userEmail },
        {
          headers: {
            accept: "*/*",
            "Content-Type": "application/json",
          },
          params: { instituteId },
        }
      );
      toast.success(t("registrationStep.otp.codeResent"));
    } catch (error) {
      toast.error(t("registrationStep.otp.resendFailed"));
      console.error("Resend OTP Error:", error);
    } finally {
      setIsLoadingOtp(false);
    }
  };

  // Verify OTP
  const handleVerifyOTP = async () => {
    if (!otp.trim() || otp.length < 4) {
      toast.error(t("registrationStep.otp.enterValidCode"));
      return;
    }

    setIsVerifyingOtp(true);
    try {
      await axios.post(
        LIVE_SESSION_VERIFY_OTP,
        {
          to: userEmail,
          otp: otp,
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

      setIsEmailVerified(true);
      toast.success(t("registrationStep.otp.verifiedSuccess"));

      // Auto-submit the form after successful verification
      setTimeout(() => {
        form.handleSubmit(onSubmit, (err) => console.error(err))();
      }, 500);
    } catch (error) {
      toast.error(t("registrationStep.otp.invalidCode"));
      console.error("Verify Email Error:", error);
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Go back to details form
  const handleBackToDetails = () => {
    setSubStep(0);
    setOtp("");
  };

  // Render OTP Verification Step
  if (subStep === 1) {
    return (
      <Card id="registration-card" className="overflow-hidden border border-gray-200 w-full">
        <CardContent className="p-card-lg sm:p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {t("registrationStep.otp.title")}
            </h2>
            <p className="text-sm text-gray-500">
              {t("registrationStep.otp.sentTo")}
            </p>
            <p className="text-sm font-medium text-gray-900 mt-1">
              {userEmail}
            </p>
          </div>

          {/* Instructions */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <div className="flex gap-3">
              <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-amber-800 space-y-1">
                <p className="font-medium">{t("registrationStep.otp.cantFindEmail")}</p>
                <ul className="list-disc list-inside space-y-1 text-amber-700">
                  <li>
                    {t("registrationStep.otp.checkSpamPrefix")}{" "}
                    <strong>{t("registrationStep.otp.spam")}</strong>{" "}
                    {t("registrationStep.otp.orWord")}{" "}
                    <strong>{t("registrationStep.otp.junk")}</strong>{" "}
                    {t("registrationStep.otp.folderSuffix")}
                  </li>
                  <li>{t("registrationStep.otp.checkEmailCorrect")}</li>
                  <li>{t("registrationStep.otp.waitAndRefresh")}</li>
                </ul>
              </div>
            </div>
          </div>

          {/* OTP Input */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                {t("registrationStep.otp.enterCodeLabel")}
              </label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={t("registrationStep.otp.enterCodePlaceholder")}
                className="w-full px-4 py-3 text-center text-lg font-mono tracking-widest border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                maxLength={6}
                autoFocus
                disabled={isVerifyingOtp || isEmailVerified}
              />
            </div>

            {/* Verify Button */}
            <MyButton
              type="button"
              buttonType="primary"
              scale="large"
              layoutVariant="default"
              onClick={handleVerifyOTP}
              disable={isVerifyingOtp || otp.length < 4 || isEmailVerified}
              className="w-full"
            >
              {isVerifyingOtp ? (
                <>
                  <svg className="animate-spin -ms-1 me-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t("registrationStep.otp.verifying")}
                </>
              ) : isEmailVerified ? (
                <>
                  <svg className="w-5 h-5 me-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {t("registrationStep.otp.verifiedProceeding")}
                </>
              ) : (
                t("registrationStep.otp.verifyAndContinue")
              )}
            </MyButton>

            {/* Resend & Back Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={handleBackToDetails}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                disabled={isVerifyingOtp}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {t("registrationStep.otp.editDetails")}
              </button>

              <button
                type="button"
                onClick={handleResendOTP}
                disabled={isLoadingOtp || isVerifyingOtp}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
              >
                {isLoadingOtp ? t("registrationStep.sending") : t("registrationStep.otp.resendCode")}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Render Registration Details Form (subStep === 0)
  return (
    <>
      <Card id="registration-card" className="overflow-hidden border border-gray-200 w-full">
        <CardContent className="p-card sm:p-5 md:p-card-lg space-y-5">
          <div className="flex items-start gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-gray-100 rounded-lg flex-shrink-0">
              <GraduationCap className="w-5 h-5 sm:w-6 sm:h-6 text-gray-700" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 leading-tight">
                {t("registrationStep.title")}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {t("registrationStep.subtitle", { course })}
              </p>
            </div>
          </div>

          <Separator />

          <FormProvider {...form}>
            <form className="w-full flex flex-col gap-4">
              {Object.entries((formValues || form.getValues()) as Record<string, FormFieldValue>).map(
                ([key, value]) => {
                  const renderType = value.render_type
                    ? value.render_type
                    : getFieldRenderType(key, value.type || "text");

                  // Render Phone Input (keep special case for dynamic country-code detection)
                  if (renderType === FieldRenderType.PHONE) {
                    const phoneCountryCode = getPhoneCountryCode();
                    return (
                      <FormField
                        key={key}
                        control={form.control}
                        name={`${key}.value`}
                        render={() => (
                          <FormItem>
                            <FormControl>
                              <PhoneInputField
                                label={capitalise(value.name)}
                                placeholder={t("registrationStep.phonePlaceholder")}
                                name={`${key}.value`}
                                control={form.control}
                                country={phoneCountryCode}
                                required={value.is_mandatory}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    );
                  }

                  // Render State Dropdown if country is selected (keep combobox special case)
                  const isStateField =
                    key.toLowerCase().includes("state") &&
                    !key.toLowerCase().includes("statement");

                  if (isStateField && availableStateOptions.length > 0) {
                    return (
                      <ComboboxField
                        key={key}
                        label={capitalise(value.name)}
                        name={`${key}.value`}
                        options={availableStateOptions}
                        control={form.control}
                        required={value.is_mandatory}
                        className="!w-full"
                      />
                    );
                  }

                  // Render City Combobox if city options are available (keep special case)
                  const isCityField =
                    key.toLowerCase().includes("city") &&
                    !key.toLowerCase().includes("ethnicity");

                  if (isCityField && availableCityOptions.length > 0) {
                    return (
                      <ComboboxField
                        key={key}
                        label={capitalise(value.name)}
                        name={`${key}.value`}
                        options={availableCityOptions}
                        control={form.control}
                        required={value.is_mandatory}
                        className="!w-full"
                      />
                    );
                  }

                  // All other types — shared renderer handles text, number,
                  // email, url, date, textarea, checkbox, radio, dropdown, file
                  return (
                    <FormField
                      key={key}
                      control={form.control}
                      name={`${key}.value`}
                      render={({ field: formField }) => (
                        <FormItem>
                          <div className="flex flex-col gap-1">
                            {/* Checkbox fields render their own inline label
                                (and optional description block) inside the
                                renderer, so skip the label-above to avoid a
                                duplicate. */}
                            {renderType !== FieldRenderType.CHECKBOX && (
                              <label className="text-subtitle font-regular">
                                {capitalise(value.name)}
                                {value.is_mandatory && (
                                  <span className="text-danger-600"> *</span>
                                )}
                              </label>
                            )}
                            <FormControl>
                              <CustomFieldRenderer
                                type={renderType}
                                name={value.name}
                                value={formField.value || ""}
                                onChange={(val) => formField.onChange(val)}
                                config={value.config}
                                options={value.comma_separated_options}
                                required={value.is_mandatory}
                              />
                            </FormControl>
                          </div>
                        </FormItem>
                      )}
                    />
                  );
                }
              )}

              {collectBillingContact && (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="billing-contact-toggle"
                      checked={billingContact.hasSeparate}
                      onCheckedChange={(checked) =>
                        updateBillingContact({ hasSeparate: Boolean(checked) })
                      }
                      className="mt-1"
                    />
                    <label
                      htmlFor="billing-contact-toggle"
                      className="flex-1 cursor-pointer select-none"
                    >
                      <div className="text-sm font-semibold text-gray-900">
                        {t("registrationStep.billingContact.addSeparate")}
                      </div>
                      <p className="mt-1 text-xs text-gray-600">
                        {t("registrationStep.billingContact.addSeparateHint")}
                      </p>
                    </label>
                  </div>

                  {billingContact.hasSeparate && (
                    <div className="mt-4 space-y-3 border-t border-gray-200 pt-4">
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="billing-contact-name"
                          className="text-sm font-medium text-gray-800"
                        >
                          {billingFieldConfig.name.label}
                          {billingFieldConfig.name.required && (
                            <span className="text-danger-600"> *</span>
                          )}
                        </label>
                        <Input
                          id="billing-contact-name"
                          type="text"
                          value={billingContact.name}
                          onChange={(e) =>
                            updateBillingContact({ name: e.target.value })
                          }
                          placeholder={t("registrationStep.billingContact.namePlaceholder")}
                          required={billingFieldConfig.name.required}
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="billing-contact-email"
                          className="text-sm font-medium text-gray-800"
                        >
                          {billingFieldConfig.email.label}
                          {billingFieldConfig.email.required && (
                            <span className="text-danger-600"> *</span>
                          )}
                        </label>
                        <Input
                          id="billing-contact-email"
                          type="email"
                          value={billingContact.email}
                          onChange={(e) =>
                            updateBillingContact({ email: e.target.value })
                          }
                          required={billingFieldConfig.email.required}
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="billing-contact-role"
                          className="text-sm font-medium text-gray-800"
                        >
                          {billingFieldConfig.role.label}
                          {billingFieldConfig.role.required && (
                            <span className="text-danger-600"> *</span>
                          )}
                        </label>
                        {billingFieldConfig.role.options.length > 0 ? (
                          <select
                            id="billing-contact-role"
                            value={billingContact.role}
                            onChange={(e) =>
                              updateBillingContact({ role: e.target.value })
                            }
                            required={billingFieldConfig.role.required}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="">{t("registrationStep.billingContact.selectPlaceholder")}</option>
                            {billingFieldConfig.role.options.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            id="billing-contact-role"
                            type="text"
                            value={billingContact.role}
                            onChange={(e) =>
                              updateBillingContact({ role: e.target.value })
                            }
                            required={billingFieldConfig.role.required}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Next Button */}
              <div className="flex items-center justify-between pt-4">
                <button
                  type="button"
                  className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                  onClick={() => form.reset()}
                >
                  <ArrowCounterClockwise className="w-4 h-4" />
                  {t("registrationStep.reset")}
                </button>
                
                <MyButton
                  type="button"
                  buttonType="primary"
                  scale="large"
                  layoutVariant="default"
                  onClick={handleNextClick}
                  disable={isLoadingOtp || form.formState.isSubmitting}
                  className="min-w-reg-150"
                >
                  {isLoadingOtp || form.formState.isSubmitting ? (
                    <>
                      <svg className="animate-spin -ms-1 me-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {t("registrationStep.sending")}
                    </>
                  ) : (
                    <>
                      {t("registrationStep.next")}
                      <svg className="w-4 h-4 ms-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </>
                  )}
                </MyButton>
              </div>
            </form>
          </FormProvider>
        </CardContent>
      </Card>
      
      {courseData?.customHtml && (
        <Card className="overflow-hidden border border-gray-200 w-full mt-4">
          <CardContent className="p-card sm:p-5 md:p-card-lg">
            <div
              className="w-full h-full"
              dangerouslySetInnerHTML={{
                __html: courseData?.customHtml || "",
              }}
            />
          </CardContent>
        </Card>
      )}
      
      {/* Show selected plan in a card */}
      {(selectedPlan?.type === "SUBSCRIPTION" ||
        selectedPlan?.type === "ONE_TIME") &&
        courseData.includePaymentPlans && (
          <Card className="mt-4 flex flex-col gap-0 border border-gray-200">
            <div className="flex flex-col items-start gap-stack p-3 sm:p-4">
              <div className="flex items-center gap-3">
                {getPaymentPlanIcon(selectedPlan?.type || "")}
                <div className="flex flex-1 flex-col font-semibold">
                  <span>{selectedPlan?.name}</span>
                </div>
              </div>
              {selectedPlan?.type === "ONE_TIME" && (
                <OneTimePlanSection
                  payment_options={selectedPlan?.payment_options || []}
                  currency={getCurrencySymbol(selectedPlan?.currency || "")}
                  discount_json={selectedPlan?.discount_json || null}
                  selectedPayment={null}
                  onSelect={() => {}}
                />
              )}
              {selectedPlan?.type === "SUBSCRIPTION" && (
                <SubscriptionPlanSection
                  payment_options={selectedPlan?.payment_options || []}
                  currency={getCurrencySymbol(selectedPlan?.currency || "")}
                  features={getAllUniqueFeatures(
                    selectedPlan.payment_options || []
                  )}
                  discount_json={selectedPlan?.discount_json}
                  selectedPayment={null}
                  onSelect={() => {}}
                />
              )}
            </div>
          </Card>
        )}
    </>
  );
};

export default RegistrationStep;
