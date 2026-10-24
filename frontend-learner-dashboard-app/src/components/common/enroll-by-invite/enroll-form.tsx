import { Route } from "@/routes/learner-invitation-response";
import { cn } from "@/lib/utils";
import {
  syncThemeRoleSettingsFromSettingJson,
  applyInstituteBackground,
  applyInstituteFont,
  applyInstituteUiAxes,
} from "@/utils/institute-theme-roles";
import { Preferences } from "@capacitor/preferences";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { applyTabBranding } from "@/utils/branding";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import {
  handleEnrollLearnerForPayment,
  handleGetEnrollInviteData,
  handleGetPublicInstituteDetails,
  handleGetPublicInstituteDetailsWithBatches,
  ReferRequest,
  submitEnrollmentForm,
  getEnrollmentPolicy,
  getPasswordField,
} from "./-services/enroll-invite-services";
import { handleGetInstituteCustomFields } from "./-services/custom-fields-setup";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { GraduationCap } from "@phosphor-icons/react";
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { loginEnrolledUser } from "@/services/signup-api";
import { performFullAuthCycle } from "@/services/auth-cycle-service";
import { BASE_URL_LEARNER_DASHBOARD } from "@/constants/urls";
import {
  convertInviteCustomFields,
  convertInstituteCustomFields,
  getDefaultPlanFromPaymentsData,
  safeJsonParse,
  transformApiDataToCourseDataForInvite,
} from "./-utils/helper";
import { useInstituteDetailsStore } from "@/stores/study-library/useInstituteDetails";
import type { BatchForSessionType } from "@/stores/study-library/institute-schema";
import { getDynamicSchema } from "@/routes/register/-utils/helper";
import z from "zod";
import { AssessmentCustomFieldOpenRegistration } from "@/types/assessment-open-registration";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { RazorpayCheckoutFormRef } from "./-components/razorpay-checkout-form";
import { InstituteBrandingComponent } from "@/components/common/institute-branding";
import {
  initiateCashfreePayment,
  getCashfreeReturnUrl,
} from "@/services/cashfree-payment";
import { load as loadCashfree } from "@cashfreepayments/cashfree-js";
import { getPhonePeReturnUrl } from "@/services/phonepe-payment";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";

import {
  RegistrationStep,
  PaymentSelectionStep,
  ReviewStep,
  PaymentInfoStep,
  PaymentPendingStep,
  SuccessStep,
  CourseInfoCard,
  NavigationButtons,
  FinalCourseData,
  EnrollmentData,
  SelectedPayment,
  getSelectedPaymentPrice,
  EnrollmentPolicyDialog,
  EnrollmentPolicyResponse,
  EnrollmentPolicyDialogType,
  EMPTY_BILLING_CONTACT,
  BillingContactState,
  CpoInstallmentSelectionStep,
} from "./-components";
import { getCurrencySymbol } from "./-components/payment-selection-step";
import {
  detectEnrollmentConflict,
  hasEnrollmentPolicyContent,
} from "./-utils/enrollment-conflict";
import {
  enrollCpoWithoutPayment,
  enrollCpoLearnerForPaymentViaInvite,
  fetchCpoDues,
  fetchCpoSchedule,
  mapCpoScheduleToDues,
  payCpoInstallments,
  getFullNameField,
  CpoInstallmentDue,
} from "./-services/enroll-invite-services";
import {
  getPaymentVendor,
  PaymentVendor,
} from "./-utils/payment-vendor-helper";
import {
  injectGtm,
  pushPageView,
  pushRegistrationCompleted,
  pushPlanSelected,
  pushReviewStepViewed,
  pushPaymentInitiated,
  pushPaymentFailed,
  pushEnrollmentSuccess,
} from "./-utils/gtm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CourseStructureDetails as CatalogCourseStructureDetails } from "@/routes/$tagName/-components/CourseStructureDetails";
import { useTranslation } from "react-i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { trackUtmAttribution } from "@/lib/utm-attribution";
import { resolveLearnerIdentity } from "@/lib/learner-identity";

// SUBSCRIPTION, FREE, UPFRONT, DONATION

// Helper function to check if HTML content has actual visible text
// Returns false for empty HTML like "<p></p>", "<p> </p>", or just whitespace
const hasContent = (htmlString: string | undefined | null): boolean => {
  if (!htmlString) return false;
  // Strip HTML tags and decode HTML entities
  const textContent = htmlString
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/&nbsp;/gi, " ") // Replace &nbsp; with space
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
  return textContent.length > 0;
};

interface EnrollByInviteProps {
  vendor?: PaymentVendor;
  utmParams?: Record<string, string>;
}

type BundledSessionMeta = {
  packageSessionId: string;
  paymentOptionName?: string;
};

type InvitePackageSession =
  | {
      package_session_id?: string;
      payment_option?: {
        name?: string;
      } | null;
    }
  | null
  | undefined;

const EnrollByInvite = ({
  vendor: propVendor,
  utmParams,
}: EnrollByInviteProps = {}) => {
  // Ensure domain resolution runs on this public route to fetch fontFamily/tab branding from /resolve
  const domainRouting = useDomainRouting();
  const { t } = useTranslation("enrollmentB");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const [paymentType, setPaymentType] = useState<string>("");
  const [orderId, setOrderId] = useState<string>("");
  const [paymentCompletionResponse, setPaymentCompletionResponse] =
    useState(null);
  const [donationAmountValid, setDonationAmountValid] = useState(false);
  const [ewayEncryptedData, setEwayEncryptedData] = useState<{
    encryptedNumber: string;
    encryptedCVN: string;
    cardData: {
      name: string;
      expiryMonth: string;
      expiryYear: string;
    };
  } | null>(null);
  const [isAutoLoggingIn, setIsAutoLoggingIn] = useState(false);
  const [stripePaymentProcessor, setStripePaymentProcessor] = useState<
    | (() => Promise<{
        success: boolean;
        paymentMethodId?: string;
        error?: string;
      }>)
    | null
  >(null);
  const [razorpayPaymentData, setRazorpayPaymentData] = useState<{
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  } | null>(null);
  const razorpayRef = useRef<RazorpayCheckoutFormRef>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashfreeSessionData, setCashfreeSessionData] = useState<{
    paymentSessionId: string;
    orderId: string;
    /** "sandbox" | "production" from the backend — must match the session. */
    environment: string | null;
  } | null>(null);
  const [cashfreeInitLoading, setCashfreeInitLoading] = useState(false);
  const cashfreeInitAttemptedRef = useRef(false);
  // Ref to prevent double auto-enrollment for FREE courses
  const hasAutoEnrolledRef = useRef(false);
  // Ref to track if prefill data has been applied (prevents double reset)
  const hasPrefillAppliedRef = useRef(false);
  const [activePackageSessionId, setActivePackageSessionId] = useState<
    string | null
  >(null);
  const [submittedUserId, setSubmittedUserId] = useState<string | null>(null);
  // Per-learner, from the form-submit response. True until the backend says otherwise.
  const [trialAvailable, setTrialAvailable] = useState(true);

  // CPO-specific state
  const [cpoUserId, setCpoUserId] = useState<string | null>(null);
  const [cpoUserPlanId, setCpoUserPlanId] = useState<string | null>(null);
  const [cpoDues, setCpoDues] = useState<CpoInstallmentDue[]>([]);
  const [cpoSelectedSfpIds, setCpoSelectedSfpIds] = useState<string[]>([]);
  const [cpoSelectedTotal, setCpoSelectedTotal] = useState<number>(0);
  const [cpoCustomAmount, setCpoCustomAmount] = useState<number | undefined>(
    undefined,
  );
  const [cpoUserEmail, setCpoUserEmail] = useState<string>("");
  const [cpoEnrolling, setCpoEnrolling] = useState(false);
  // Real SFP IDs (set after enrollment, used for payment calls)
  const [cpoRealSfpIds, setCpoRealSfpIds] = useState<string[]>([]);
  // Stable ref so Razorpay handler (registered before re-render) always reads fresh enrolled data
  const cpoEnrolledRef = useRef<{
    userId: string;
    userPlanId: string;
    email: string;
    name: string;
    sfpIds: string[];
    customAmount: number;
  } | null>(null);

  // Enrollment Policy Dialog state
  const [enrollmentPolicyDialogOpen, setEnrollmentPolicyDialogOpen] =
    useState(false);
  const [enrollmentPolicyDialogType, setEnrollmentPolicyDialogType] =
    useState<EnrollmentPolicyDialogType>("success_with_actions");
  // The message the backend returned for this failure. The re-enrollment dialog
  // needs it because the institute's configured copy is a {{allowed_date}}
  // template that only the backend has resolved.
  const [enrollmentPolicyServerMessage, setEnrollmentPolicyServerMessage] =
    useState<string | undefined>(undefined);
  const [enrollmentPolicyResponse, setEnrollmentPolicyResponse] =
    useState<EnrollmentPolicyResponse | null>(null);

  const [currentStep, setCurrentStep] = useState(0); // 0: Registration, 1: Payment Selection, 2: Review, 3: Payment Details, 4: Payment Pending, 5: Success
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState<string | null>(null);
  const [termsAndConditionUrl, setTermsAndConditionUrl] = useState<
    string | null
  >(null);
  const [courseData, setCourseData] = useState<FinalCourseData>({
    aboutCourse: "",
    course: "",
    courseBanner: "",
    courseMedia: "",
    coursePreview: "",
    courseMediaId: {
      type: "",
      id: "",
    },
    customHtml: "",
    description: "",
    includeInstituteLogo: false,
    blendHeaderWithBackground: false,
    includePaymentPlans: false,
    instituteLogo: "",
    learningOutcome: "",
    restrictToSameBatch: false,
    showRelatedCourses: false,
    tags: [],
    targetAudience: "",
  });
  const [referRequest, setReferRequest] = useState<ReferRequest | null>(null);
  // Ref to track the latest referRequest value (to avoid closure issues)
  const referRequestRef = useRef<ReferRequest | null>(null);
  // Applied discount coupon code + discount value (resolved by CouponInput
  // inside the review step). BE re-validates + fetches the AppliedCouponDiscount
  // + atomically decrements at UserPlan creation. The discount value is also
  // subtracted from payment_initiation_request.amount so the gateway charges
  // the discounted total — without that, BE records the coupon but the gateway
  // captures the full price.
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(
    null,
  );
  const [couponDiscount, setCouponDiscount] = useState<number>(0);
  const handleCouponChange = useCallback(
    (code: string | null, discount: number) => {
      setAppliedCouponCode(code);
      setCouponDiscount(code ? discount : 0);
    },
    [],
  );
  const [billingContact, setBillingContact] = useState<BillingContactState>(EMPTY_BILLING_CONTACT);
  const [enrollmentData, setEnrollmentData] = useState<EnrollmentData>({
    registrationData: {},
    selectedPayment: null,
    paymentInfo: {
      cardholderName: "",
      cardNumber: "",
      expiryDate: "",
      cvv: "",
    },
  });

  const { instituteId, inviteCode, ref } = Route.useSearch();

  // Keep ref in sync with state for referRequest (to avoid closure issues)
  useEffect(() => {
    referRequestRef.current = referRequest;
    console.log("[enroll-form] referRequest state updated:", referRequest);
  }, [referRequest]);

  const { data: instituteData, isLoading: isInstituteLoading } =
    useSuspenseQuery(handleGetPublicInstituteDetails({ instituteId }));

  const { getDetailsFromPackageSessionId, setInstituteDetails } =
    useInstituteDetailsStore();

  // Login link for an already-registered learner: the institute's own learner
  // portal (learner_portal_base_url is served host-only, so add the scheme),
  // falling back to this app's own /login when the institute has none.
  const learnerLoginUrl = useMemo(() => {
    const host = (instituteData as { learner_portal_base_url?: string } | undefined)
      ?.learner_portal_base_url?.trim();
    if (!host) return "/login";
    const origin = /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `https://${host}`;
    return `${origin.replace(/\/+$/, "")}/login`;
  }, [instituteData]);

  const { data: inviteData, isLoading } = useSuspenseQuery(
    handleGetEnrollInviteData({ instituteId, inviteCode }),
  );

  const inviteConfig = useMemo(() => {
    try {
      if (inviteData?.setting_json) {
        const settings = JSON.parse(inviteData.setting_json);
        return settings?.postformfillConfiguration || {};
      }
    } catch (e) {
      console.warn("Failed to parse setting_json", e);
    }
    return {};
  }, [inviteData?.setting_json]);

  const collectBillingContact = Boolean(
    (inviteConfig as { collectBillingContactDetails?: boolean })
      ?.collectBillingContactDetails
  );

  // Autopay: read the invite's AUTOPAY_SETTING so we can require an explicit
  // auto-renewal consent before payment for recurring subscriptions.
  const autopayConfig = useMemo(() => {
    try {
      if (inviteData?.setting_json) {
        const settings = JSON.parse(inviteData.setting_json);
        return (settings?.setting?.AUTOPAY_SETTING ?? null) as {
          ENABLED?: boolean;
          TRIAL_DAYS?: number;
          MAX_AMOUNT?: number;
          AUTH_AMOUNT?: number;
          AUTH_REFUNDABLE?: boolean;
        } | null;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, [inviteData?.setting_json]);
  const isAutopay = Boolean(autopayConfig?.ENABLED);
  const [autopayConsent, setAutopayConsent] = useState(false);
  // A recurring order is bound to one authorization method, so the learner must
  // choose before the order is created — it can't be picked inside Checkout.
  const [mandateMethod, setMandateMethod] = useState<"card" | "upi">("upi");
  const authAmount = autopayConfig?.AUTH_AMOUNT ?? 1;

  // Per-field config for the billing-contact form. The admin writes this under
  // postformfillConfiguration.billingContactFields in the invite settingJson;
  // RegistrationStep falls back to the legacy hard-coded labels + required
  // semantics when the key is absent so older invites keep their current UX.
  const billingContactFields = (inviteConfig as {
    billingContactFields?: {
      name?:  { label?: string; required?: boolean };
      email?: { label?: string; required?: boolean };
      role?:  { label?: string; required?: boolean; options?: string };
    };
  })?.billingContactFields;

  // Inject GTM if the institute has configured a container ID
  useEffect(() => {
    const gtmId = inviteData?.gtm_container_id;
    if (gtmId) injectGtm(gtmId);
  }, [inviteData?.gtm_container_id]);

  // Fire enrollment_page_view once course data is loaded
  const hasFiredPageView = useRef(false);
  useEffect(() => {
    if (
      inviteData?.gtm_container_id &&
      courseData.course &&
      !hasFiredPageView.current
    ) {
      hasFiredPageView.current = true;
      pushPageView(courseData.course, paymentType, utmParams);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteData?.gtm_container_id, courseData.course]);

  // Fire GTM funnel events on step transitions
  const hasFiredEnrollmentEvent = useRef(false);
  const lastTrackedStep = useRef(-1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (
      !inviteData?.gtm_container_id ||
      currentStep === lastTrackedStep.current
    )
      return;
    lastTrackedStep.current = currentStep;

    if (currentStep === 2) {
      pushReviewStepViewed(courseData.course || "", paymentType);
    }

    if (currentStep === 5 && !hasFiredEnrollmentEvent.current) {
      hasFiredEnrollmentEvent.current = true;
      pushEnrollmentSuccess({
        courseName: courseData.course || "",
        paymentType,
        currency: enrollmentData.selectedPayment?.currency,
        amount: getSelectedPaymentPrice(enrollmentData.selectedPayment),
        utmParams,
      });
    }
  }, [currentStep]);

  // Fetch custom fields from institute if not available in inviteData
  const hasCustomFieldsInInvite =
    inviteData?.institute_custom_fields &&
    inviteData.institute_custom_fields.length > 0;

  const { data: instituteCustomFields } = useQuery({
    ...handleGetInstituteCustomFields({ instituteId }),
    enabled: !hasCustomFieldsInInvite, // Only fetch if not in inviteData
  });

  // Merge custom fields: prioritize inviteData fields, fallback to institute fields
  const finalCustomFields = useMemo(() => {
    if (hasCustomFieldsInInvite) {
      const converted = convertInviteCustomFields(
        inviteData.institute_custom_fields,
      );
      return converted;
    }
    // Use convertInstituteCustomFields for institute API response
    if (instituteCustomFields && instituteCustomFields.length > 0) {
      const converted = convertInstituteCustomFields(instituteCustomFields);
      return converted;
    }
    return [];
  }, [
    hasCustomFieldsInInvite,
    inviteData?.institute_custom_fields,
    instituteCustomFields,
  ]);

  // Track whether we're using institute custom fields (not from invite)
  const isUsingInstituteCustomFields =
    !hasCustomFieldsInInvite &&
    instituteCustomFields &&
    instituteCustomFields.length > 0;

  // Determine payment vendor from invite data or prop
  // const vendor = propVendor || getPaymentVendor(inviteData);

  const paymentOptions = getDefaultPlanFromPaymentsData(
    inviteData?.package_session_to_payment_options?.[0]?.payment_option,
  );
  const zodSchema = getDynamicSchema(finalCustomFields || []);

  type FormValues = z.infer<typeof zodSchema>;

  // Helper function to generate default values from custom fields
  const generateDefaultValues = useCallback(
    (fields: AssessmentCustomFieldOpenRegistration[]) => {
      return fields
        .sort((a, b) => a.field_order - b.field_order)
        .reduce(
          (
            defaults: Record<
              string,
              {
                id: string;
                name: string;
                value: string;
                is_mandatory: boolean;
                type: string;
                config?: string;
                comma_separated_options?: string[];
              }
            >,
            field,
          ) => {
            // Always pass config so non-dropdown types (radio, multi_select,
            // date, file, checkbox, etc.) can read their metadata.
            defaults[field.field_key] = {
              id: field.id,
              name: field.field_name,
              value: "",
              is_mandatory: field.is_mandatory || false,
              type: field.field_type,
              config: field.config || "{}",
            };
            return defaults;
          },
          {} as Record<
            string,
            {
              id: string;
              name: string;
              value: string;
              is_mandatory: boolean;
              type: string;
              config?: string;
              comma_separated_options?: string[];
            }
          >,
        );
    },
    [],
  );

  // Helper to safely get allowLearnersToCreateCourses from instituteData settings
  const getAllowLearnersToCreateCourses = useCallback(() => {
    try {
      if (!instituteData?.setting) return false;
      const parsed = JSON.parse(instituteData.setting);
      return (
        parsed?.setting?.COURSE_SETTING?.data?.permissions
          ?.allowLearnersToCreateCourses || false
      );
    } catch {
      console.warn("Failed to parse institute settings, defaulting to false");
      return false;
    }
  }, [instituteData?.setting]);

  const form = useForm<FormValues>({
    resolver: zodResolver(zodSchema),
    defaultValues: generateDefaultValues(finalCustomFields || []),
    mode: "onChange",
  });

  // Update form when finalCustomFields changes (e.g., when instituteCustomFields loads)
  useEffect(() => {
    if (finalCustomFields && finalCustomFields.length > 0) {
      const newDefaultValues = generateDefaultValues(finalCustomFields);
      let shouldResetForm = false;
      let hasPrefillData = false;

      // Check for prefill data from previous upgrade flow
      try {
        const prefillDataStr = localStorage.getItem("enrollment_prefill_data");
        if (prefillDataStr) {
          console.log("[Prefill] Found prefill data in LocalStorage");
          const prefillData = JSON.parse(prefillDataStr);
          hasPrefillData = true;

          Object.keys(prefillData).forEach((key) => {
            // value is the string value
            const val = prefillData[key];

            // 1. Try exact key match
            if (newDefaultValues[key]) {
              console.log(`[Prefill] Exact match for ${key}`);
              newDefaultValues[key].value = val;
            }
            // 2. Try Smart Matching for standard fields if not a "smart" key itself
            else if (!key.startsWith("__smart_")) {
              // Skip non-matching standard keys
            }
          });

          // 3. Apply Smart Keys if exist and target field is empty
          if (prefillData["__smart_email"]) {
            const emailKey = Object.keys(newDefaultValues).find(
              (k) =>
                k.toLowerCase().includes("email") ||
                k.toLowerCase().includes("mail"),
            );
            if (emailKey && !newDefaultValues[emailKey].value) {
              console.log(`[Prefill] Smart match for Email -> ${emailKey}`);
              newDefaultValues[emailKey].value = prefillData["__smart_email"];
            }
          }

          if (prefillData["__smart_phone"]) {
            const phoneKey = Object.keys(newDefaultValues).find(
              (k) =>
                k.toLowerCase().includes("phone") ||
                k.toLowerCase().includes("mobile") ||
                k.toLowerCase().includes("contact"),
            );
            if (phoneKey && !newDefaultValues[phoneKey].value) {
              console.log(`[Prefill] Smart match for Phone -> ${phoneKey}`);
              newDefaultValues[phoneKey].value = prefillData["__smart_phone"];
            }
          }

          if (prefillData["__smart_name"]) {
            const nameKey = Object.keys(newDefaultValues).find(
              (k) =>
                k.toLowerCase().includes("name") ||
                k.toLowerCase().includes("full_name"),
            );
            if (nameKey && !newDefaultValues[nameKey].value) {
              console.log(`[Prefill] Smart match for Name -> ${nameKey}`);
              newDefaultValues[nameKey].value = prefillData["__smart_name"];
            }
          }

          // Remove from localStorage after reading
          localStorage.removeItem("enrollment_prefill_data");

          // Mark that prefill has been applied
          hasPrefillAppliedRef.current = true;
          shouldResetForm = true;
        } else {
          console.log("[Prefill] No prefill data found");
          // Only reset form with empty values if prefill was never applied before
          // This prevents React Strict Mode / double-render from clearing prefilled values
          if (!hasPrefillAppliedRef.current) {
            shouldResetForm = true;
          } else {
            console.log(
              "[Prefill] Skipping form reset to preserve prefilled values",
            );
          }
        }
      } catch (e) {
        console.error("Error applying prefill data", e);
        // On error, still allow form reset if no prefill was applied
        if (!hasPrefillAppliedRef.current) {
          shouldResetForm = true;
        }
      }

      if (shouldResetForm) {
        console.log("[Prefill] Resetting form with values:", newDefaultValues);
        form.reset(newDefaultValues);
      }
    }
  }, [finalCustomFields, form, generateDefaultValues]);

  form.watch();

  const isBundledInvite = Boolean(inviteData?.is_bundled);

  // True when the invite exposes exactly one payment plan to choose from.
  // Mirrors the skip condition in handleNext() (L818-824) and handlePrevious()
  // (L850-855) — the Plan-selection step never appears, so the wizard should
  // collapse to 2 pills (Details + Pay) instead of pretending the user picked.
  const hasSinglePlan =
    (inviteData?.package_session_to_payment_options?.[0]?.payment_option
      ?.payment_plans?.length || 0) === 1;

  const bundledPackageSessions = useMemo<BundledSessionMeta[]>(() => {
    const sessions =
      (inviteData?.package_session_to_payment_options as
        | InvitePackageSession[]
        | undefined) ?? [];
    const seen = new Set<string>();

    return sessions.reduce<BundledSessionMeta[]>((acc, current) => {
      const packageSessionId = current?.package_session_id;
      if (!packageSessionId || seen.has(packageSessionId)) {
        return acc;
      }
      seen.add(packageSessionId);

      acc.push({
        packageSessionId,
        paymentOptionName: current?.payment_option?.name ?? undefined,
      });

      return acc;
    }, []);
  }, [inviteData?.package_session_to_payment_options]);

  // ── Bundled "What's Included" course resolution ─────────────────────────────
  // The enroll form loads branding/settings via the lightweight
  // `details-non-batches` endpoint, which returns `batches_for_sessions: []`.
  // That leaves bundled package sessions with no course/level/session names —
  // labels fall back to "Course N" and the structure preview never resolves a
  // course id ("Course details loading..." forever). Fetch the host institute's
  // full `details` payload (batches included) to recover them.
  //
  // NOTE: the bundled package sessions belong to the HOST institute (the
  // `instituteId` in the invite URL = enroll_invite.institute_id), NOT the
  // sub-org. For "Sub-Org Subscription" invites the `sub_org` is only a
  // branding/grouping label — that institute is an empty shell with no batches.
  const { data: bundleInstituteData } = useQuery(
    handleGetPublicInstituteDetailsWithBatches({
      instituteId,
      enabled: isBundledInvite && bundledPackageSessions.length > 0,
    }),
  );

  const bundleSessionDetailsMap = useMemo(() => {
    const map = new Map<string, BatchForSessionType>();
    const batches: BatchForSessionType[] =
      bundleInstituteData?.batches_for_sessions ?? [];
    for (const batch of batches) {
      if (batch?.id) map.set(batch.id, batch);
    }
    return map;
  }, [bundleInstituteData?.batches_for_sessions]);

  // Resolve a package session's course/level/session details, preferring the
  // batches fetched for the bundle's owning institute and falling back to the
  // global institute store (covers already-cached non-bundled details).
  const getBundleSessionDetails = useCallback(
    (packageSessionId: string): BatchForSessionType | null =>
      bundleSessionDetailsMap.get(packageSessionId) ??
      getDetailsFromPackageSessionId({ packageSessionId }),
    [bundleSessionDetailsMap, getDetailsFromPackageSessionId],
  );

  const currentLevelName = useMemo(() => {
    const pId =
      activePackageSessionId ??
      inviteData?.package_session_to_payment_options?.[0]?.package_session_id ??
      "";
    return getBundleSessionDetails(pId)?.level?.level_name || "-";
  }, [
    activePackageSessionId,
    inviteData?.package_session_to_payment_options,
    getBundleSessionDetails,
  ]);

  const hasLevelName = useMemo(() => {
    const normalized = (currentLevelName || "").trim().toLowerCase();
    return normalized && normalized !== "default" && normalized !== "-";
  }, [currentLevelName]);

  // Check if right section (CourseInfoCard) has meaningful data beyond just the course name
  const hasRightSectionContent = useMemo(() => {
    return (
      hasContent(courseData.aboutCourse) ||
      hasContent(courseData.learningOutcome) ||
      hasLevelName
    );
  }, [courseData.aboutCourse, courseData.learningOutcome, hasLevelName]);

  useEffect(() => {
    if (bundledPackageSessions.length > 0) {
      setActivePackageSessionId(bundledPackageSessions[0]?.packageSessionId);
    } else {
      setActivePackageSessionId(null);
    }
  }, [bundledPackageSessions]);

  // Placeholder level/session names ("default"/"DEFAULT") carry no meaning for
  // single-course catalogue packages — treat them as absent so the tab label is
  // just the course name instead of "Course Name · default".
  const meaningfulName = (name?: string | null) => {
    const normalized = (name || "").trim().toLowerCase();
    return normalized && normalized !== "default" && normalized !== "-"
      ? (name || "").trim()
      : undefined;
  };

  const resolvePackageSessionLabel = (
    packageSessionId: string,
    fallbackIndex: number,
  ) => {
    const details = getBundleSessionDetails(packageSessionId);
    const courseName = meaningfulName(details?.package_dto?.package_name);
    const levelName = meaningfulName(details?.level?.level_name);
    const sessionName = meaningfulName(details?.session?.session_name);

    if (courseName && levelName) {
      return `${courseName} · ${levelName}`;
    }

    if (courseName && sessionName) {
      return `${courseName} · ${sessionName}`;
    }

    return (
      courseName ||
      levelName ||
      sessionName ||
      t("bundledCourses.fallbackLabel", { course, index: fallbackIndex + 1 })
    );
  };

  async function onSubmit(values: FormValues) {
    setEnrollmentData((prev) => ({
      ...prev,
      registrationData: values,
    }));

    // Detect single plan (non-donation)
    const paymentOptionMeta =
      inviteData?.package_session_to_payment_options?.[0]?.payment_option;
    const plans = paymentOptionMeta?.payment_plans || [];
    const hasSinglePlan = plans.length === 1;

    let targetStep = 1;

    // ─── CPO flow: fetch installment schedule first, then show selection ───────
    if (paymentType === "CPO") {
      setLoading(true);
      setCpoEnrolling(true);
      try {
        const paymentOptionId =
          inviteData?.package_session_to_payment_options[0]?.payment_option
            ?.id || "";
        if (!paymentOptionId) throw new Error(t("errors.noCpoPaymentOptionFound"));

        const cpoDto = await fetchCpoSchedule(paymentOptionId);
        setCpoDues(mapCpoScheduleToDues(cpoDto));
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const errorData = err?.response?.data;
        setError(
          errorData?.ex ||
            t("errors.failedToLoadInstallmentSchedule"),
        );
        setLoading(false);
        setCpoEnrolling(false);
        return;
      } finally {
        setLoading(false);
        setCpoEnrolling(false);
      }
      setCurrentStep(1); // CPO installment selection step
      return;
    }

    // If there's exactly one plan, preselect and skip selection step
    if (hasSinglePlan && paymentType !== "DONATION") {
      if (!enrollmentData.selectedPayment) {
        const onlyPlan = plans[0];
        try {
          const metadata = JSON.parse(
            paymentOptionMeta?.payment_option_metadata_json || "{}",
          );
          const unit = metadata?.unit || "days";
          const duration =
            unit === "days"
              ? t("planDuration.days", { count: onlyPlan.validity_in_days })
              : t("planDuration.months", { count: Math.floor(onlyPlan.validity_in_days / 30) });

          // @ts-expect-error // TODO: strong type SelectedPayment mapping
          const preselected: SelectedPayment = {
            id: onlyPlan.id,
            name: onlyPlan.name,
            amount: onlyPlan.actual_price,
            currency: onlyPlan.currency,
            description: onlyPlan.description,
            duration,
            // include numeric pricing fields for summary calculations
            actual_price: onlyPlan.actual_price,
            elevated_price: onlyPlan.elevated_price,
            validity_in_days: onlyPlan.validity_in_days,
            referral_option: onlyPlan.referral_option,
          };
          setEnrollmentData((prev) => ({
            ...prev,
            selectedPayment: preselected,
          }));
        } catch {
          // ignore parse errors and continue normal flow
        }
      }
      targetStep = 2;
    } else if (paymentType === "FREE") {
      targetStep = 2; // For FREE payments, go directly to review step
    }

    // Step 1: Submit Form API (Abandoned Cart Tracking) - SKIP for FREE courses
    if (paymentType !== "FREE") {
      setLoading(true);
      try {
        const packageSessionIds =
          inviteData?.package_session_to_payment_options.map(
            (ps: { package_session_id: string }) => ps?.package_session_id,
          ) || [""];

        const response = await submitEnrollmentForm({
          registrationData: values,
          instituteId,
          enrollInviteId: inviteData?.id,
          package_session_ids: packageSessionIds,
          isUsingInstituteCustomFields,
        });

        if (response?.user_id) {
          setSubmittedUserId(response.user_id);
        }
        // The invite's TRIAL_DAYS says the invite OFFERS a trial; it says nothing about
        // whether THIS learner still has one. Someone who already used theirs is charged the
        // full plan price at checkout, so promising "start your trial for Rs 1" here was the
        // screen disagreeing with the money. Absent (older backend) = behave as before.
        if (response?.trial_available === false) {
          setTrialAvailable(false);
        } else {
          setTrialAvailable(true);
        }
        // Attribute HERE, not after payment: the next thing the browser does
        // is leave for the gateway, so a report fired later would be lost on
        // every abandoned cart — exactly the population a campaign report has
        // to be able to see.
        // Contact details ride along so a missing user_id degrades to a
        // contact-matched row rather than dropping the touch: the server
        // refuses a touch it cannot attach to anyone.
        const paidDetails = getUserDetails();
        trackUtmAttribution({
          instituteId,
          userId: response?.user_id,
          email: paidDetails.email || undefined,
          mobileNumber: paidDetails.contact || undefined,
          sourceType: "ENROLL_INVITE",
          sourceId: inviteData?.id,
        });
      } catch (error) {
        const errorData = (
          error as {
            response?: { data?: { ex?: string; responseCode?: string } };
          }
        )?.response?.data;

        // A repeated phone-identifier submission is an enrollment conflict, not an
        // abandoned-cart telemetry failure. Stop before the checkout step and
        // show the same conflict UI used by the enrollment endpoint.
        if (errorData?.responseCode?.includes("ENROLLMENT_CONFLICT:")) {
          const dialogOpened = await fetchAndHandleEnrollmentPolicy(
            "error_already_enrolled",
            errorData?.ex,
            errorData?.responseCode,
          );
          if (!dialogOpened) {
            toast.error(errorData?.ex || t("errors.enrollmentFailed"));
          }
          setError(errorData?.ex || t("errors.enrollmentFailed"));
          return;
        }

        console.error("Form submission failed (non-blocking):", error);
        // Tracking failures remain non-blocking; the authoritative enrollment
        // endpoint repeats the invite-submission guard before it creates any payment.
      } finally {
        setLoading(false);
      }
    }

    if (inviteData?.gtm_container_id) {
      pushRegistrationCompleted(courseData.course || "");
    }
    setCurrentStep(targetStep);
  }

  const handlePaymentSelection = (payment: SelectedPayment) => {
    setEnrollmentData((prev) => ({
      ...prev,
      selectedPayment: payment,
    }));
    if (inviteData?.gtm_container_id) {
      pushPlanSelected({
        courseName: courseData.course || "",
        planName: payment.name || "",
        amount: payment.amount || 0,
        currency: payment.currency || "",
      });
    }
  };

  const handleDonationAmountChange = (amount: number) => {
    setEnrollmentData((prev) => ({
      ...prev,
      selectedPayment: prev.selectedPayment
        ? {
            ...prev.selectedPayment,
            amount: amount,
          }
        : null,
    }));
  };

  const handleDonationValidationChange = (isValid: boolean) => {
    setDonationAmountValid(isValid);
  };

  const handleNext = () => {
    if (currentStep < 5) {
      // CPO: step 1 (installment selection) → step 3 (payment info); skip review
      if (currentStep === 1 && paymentType === "CPO") {
        setCurrentStep(3);
        return;
      }
      // If payment type is FREE and we're on registration step, skip payment selection
      if (currentStep === 0 && paymentType === "FREE") {
        setCurrentStep(2); // Skip to review step
      } else if (
        currentStep === 0 &&
        paymentType !== "DONATION" &&
        (inviteData?.package_session_to_payment_options?.[0]?.payment_option
          ?.payment_plans?.length || 0) === 1
      ) {
        setCurrentStep(2); // Skip selection when only one plan
      } else if (currentStep === 2 && paymentType === "FREE") {
        setCurrentStep(5); // Skip payment steps and go directly to success
      } else {
        setCurrentStep(currentStep + 1);
      }
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      // CPO: payment info (3) → installment selection (1)
      if (currentStep === 3 && paymentType === "CPO") {
        setCurrentStep(1);
        return;
      }
      // Reset auto-enroll flag when going back from review step or success step
      if (currentStep === 2 || currentStep === 5) {
        hasAutoEnrolledRef.current = false;
      }
      // If payment type is FREE and we're on success step, go back to review
      if (currentStep === 5 && paymentType === "FREE") {
        setCurrentStep(2);
      } else if (currentStep === 2 && paymentType === "FREE") {
        setCurrentStep(0);
      } else if (
        currentStep === 2 &&
        paymentType !== "DONATION" &&
        (inviteData?.package_session_to_payment_options?.[0]?.payment_option
          ?.payment_plans?.length || 0) === 1
      ) {
        setCurrentStep(0); // Skip selection on back when only one plan
      } else {
        setCurrentStep(currentStep - 1);
      }
    }
  };

  const handleAutoLogin = async (response: any) => {
    // Check for direct tokens first (most automatic flow)
    const directAccessToken =
      response?.payment_response?.response_data?.accessToken;
    const directRefreshToken =
      response?.payment_response?.response_data?.refreshToken;

    if (directAccessToken && directRefreshToken) {
      try {
        setIsAutoLoggingIn(true);
        console.log("[EnrollByInvite] Using direct tokens from response");
        await performFullAuthCycle(
          { accessToken: directAccessToken, refreshToken: directRefreshToken },
          instituteId,
        );

        toast.success(t("toast.enrollmentSuccessRedirecting"));
        setTimeout(() => {
          window.location.href =
            inviteConfig?.redirectPath ||
            `${BASE_URL_LEARNER_DASHBOARD}/study-library/courses`;
        }, 1500);
        return;
      } catch (error) {
        console.error(
          "[EnrollByInvite] Auth cycle with direct tokens failed:",
          error,
        );
        // Fallback to credential-based login if token login fails
      }
    }

    const userEmail = response?.user?.email;
    const userPassword = response?.user?.password;

    if (userEmail && userPassword) {
      try {
        setIsAutoLoggingIn(true);
        console.log("[EnrollByInvite] Performing auto-login using credentials");
        const loginResponse = await loginEnrolledUser(
          userEmail,
          userPassword,
          instituteId,
        );
        await performFullAuthCycle(loginResponse, instituteId);

        toast.success(t("toast.loginSuccessRedirecting"));
        setTimeout(() => {
          window.location.href =
            inviteConfig?.redirectPath ||
            `${BASE_URL_LEARNER_DASHBOARD}/study-library/courses`;
        }, 1500);
      } catch (error) {
        console.error("[EnrollByInvite] Auto-login failed:", error);
        setIsAutoLoggingIn(false);
      }
    } else {
      // If no credentials, user might be already logged in or it's an existing user
      // We still wait a bit then redirect
      setTimeout(() => {
        window.location.href =
          inviteConfig?.redirectPath ||
          `${BASE_URL_LEARNER_DASHBOARD}/study-library/courses`;
      }, 2000);
    }
  };

  // Helper function to fetch enrollment policy and show appropriate dialog
  // Helper function to fetch enrollment policy and show appropriate dialog
  const fetchAndHandleEnrollmentPolicy = async (
    scenario: "success" | "error_already_enrolled" = "success",
    enrollmentErrorMessage?: string,
    enrollmentResponseCode?: string,
  ): Promise<boolean> => {
    try {
      const packageSessionId =
        inviteData?.package_session_to_payment_options?.[0]?.package_session_id;

      if (!packageSessionId) {
        console.log(
          "[EnrollByInvite] No package session ID available for enrollment policy",
        );
        return false;
      }

      const policyResponse = await getEnrollmentPolicy({ packageSessionId });

      // A conflict the backend tagged explicitly (ENROLLMENT_CONFLICT:<TYPE>) is a
      // conflict whether or not this package session has a policy configured.
      // Gating it on policy content below meant an institute with no policy --
      // the common case -- got the message as a toast with no way to sign in,
      // while the dialog with "Login now" only appeared for institutes that had
      // set one up.
      if (
        scenario === "error_already_enrolled" &&
        enrollmentResponseCode?.includes("ENROLLMENT_CONFLICT:")
      ) {
        const dialogType = detectEnrollmentConflict({
          policyResponse,
          errorMessage: enrollmentErrorMessage,
          responseCode: enrollmentResponseCode,
        });
        if (dialogType) {
          setEnrollmentPolicyResponse(policyResponse ?? null);
          setEnrollmentPolicyServerMessage(enrollmentErrorMessage);
          setEnrollmentPolicyDialogType(dialogType);
          setEnrollmentPolicyDialogOpen(true);
          return true;
        }
      }

      console.log(
        "[EnrollByInvite] Enrollment policy response:",
        policyResponse,
      );

      // A package session with no enrollment policy configured does NOT come back
      // as `{}` -- older backends serialize the empty DTO as five null keys, so the
      // previous `Object.keys(...).length > 0` check read as "policy exists" and
      // every enrollment failure reached the dialog below.
      if (hasEnrollmentPolicyContent(policyResponse)) {
        setEnrollmentPolicyResponse(policyResponse);

        if (scenario === "success") {
          // Check if there are frontend actions to show
          const hasFrontendActions =
            policyResponse?.workflow?.enabled &&
            policyResponse?.workflow?.frontendActions &&
            Object.keys(policyResponse.workflow.frontendActions).length > 0;

          if (hasFrontendActions) {
            setEnrollmentPolicyServerMessage(undefined);
            setEnrollmentPolicyDialogType("success_with_actions");
            setEnrollmentPolicyDialogOpen(true);
            return true;
          }
        } else if (scenario === "error_already_enrolled") {
          // Only a real enrollment conflict gets a dialog. HTTP 510 is this
          // backend's generic business-error status, so an unrelated failure
          // (payment mandate rejected, seat limit reached, plan/invite mismatch)
          // arrives here looking identical to a conflict. Returning null lets the
          // caller surface the actual error instead of "Already Enrolled".
          const dialogType = detectEnrollmentConflict({
            policyResponse,
            errorMessage: enrollmentErrorMessage,
            responseCode: enrollmentResponseCode,
          });

          if (!dialogType) {
            return false;
          }

          setEnrollmentPolicyServerMessage(enrollmentErrorMessage);
          setEnrollmentPolicyDialogType(dialogType);
          setEnrollmentPolicyDialogOpen(true);
          return true;
        }
      }
    } catch (err) {
      console.error("[EnrollByInvite] Failed to fetch enrollment policy:", err);
      // Non-blocking - we don't prevent the enrollment flow if policy fetch fails.
      // A tagged conflict still deserves the dialog even when the policy read failed.
      if (
        scenario === "error_already_enrolled" &&
        enrollmentResponseCode?.includes("ENROLLMENT_CONFLICT:")
      ) {
        setEnrollmentPolicyResponse(null);
        setEnrollmentPolicyServerMessage(enrollmentErrorMessage);
        setEnrollmentPolicyDialogType("already_enrolled");
        setEnrollmentPolicyDialogOpen(true);
        return true;
      }
    }
    return false;
  };

  const handleUpgrade = (url: string) => {
    // Reader mode (iOS / reader-mode institutes): never redirect to an external
    // paid-upgrade URL (Apple 3.1.1). Defense-in-depth — the route is already
    // blocked in reader mode.
    if (shouldHidePaidPurchaseUI()) return;
    // Save form data to LocalStorage for prefilling the next form
    const formData = form.getValues();
    const prefillData: Record<string, string> = {};

    console.log("[Prefill] Saving form data for upgrade:", formData);

    // First, save all form values with their original keys for exact matching
    Object.keys(formData).forEach((key) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const field = formData[key];
      const val = field?.value;

      if (val) {
        prefillData[key] = val;
      }
    });

    // Use getUserDetails for reliable extraction of Name, Email, and Phone
    // This ensures smart keys are set correctly regardless of field key variations
    const userDetails = getUserDetails();

    if (userDetails.email) {
      prefillData["__smart_email"] = userDetails.email;
      console.log("[Prefill] Smart Email:", userDetails.email);
    }
    if (userDetails.contact) {
      prefillData["__smart_phone"] = userDetails.contact;
      console.log("[Prefill] Smart Phone:", userDetails.contact);
    }
    if (userDetails.name) {
      prefillData["__smart_name"] = userDetails.name;
      console.log("[Prefill] Smart Name:", userDetails.name);
    }

    try {
      localStorage.setItem(
        "enrollment_prefill_data",
        JSON.stringify(prefillData),
      );
      console.log("[Prefill] Saved to LocalStorage:", prefillData);
    } catch (e) {
      console.error("Failed to save prefill data", e);
    }

    if (url) {
      window.open(url, "_blank");
    }
  };

  const handleSubmitEnrollment = async () => {
    if (isAutopay && !autopayConsent) {
      toast.error(t("toast.autoRenewalConsentRequired"));
      return;
    }
    // ─── CPO payment flow ─────────────────────────────────────────────────────
    // Two-phase: enroll without payment (creates UserPlan + SFP rows) → pay the
    // selected amount via payCpoInstallments which has its own customAmount path.
    // This avoids ComplexPaymentOptionOperation overriding the amount with duesNow.
    if (paymentType === "CPO") {
      if (!cpoCustomAmount && cpoSelectedSfpIds.length === 0) {
        setError(t("errors.selectAtLeastOneInstallment"));
        return;
      }
      const payAmount =
        cpoCustomAmount !== undefined ? cpoCustomAmount : cpoSelectedTotal;
      if (payAmount <= 0) {
        setError(t("errors.paymentAmountMustBePositive"));
        return;
      }

      const vendor = getPaymentVendor(inviteData);
      const currency = inviteData?.currency || "INR";

      if (inviteData?.gtm_container_id) {
        pushPaymentInitiated({
          courseName: courseData.course || "",
          paymentType,
          vendor: vendor || "STRIPE",
          currency,
          amount: payAmount,
          utmParams,
        });
      }

      const learnerFullName = getFullNameField(form.getValues());

      // Enroll without payment (once) → get real SFP IDs, then payCpoInstallments
      const getOrEnrollCpoSfpIds = async (): Promise<{
        userId: string;
        userPlanId: string;
        email: string;
        name: string;
        sfpIds: string[];
      }> => {
        // Use ref first — avoids stale closure when called from within Razorpay handlers
        if (cpoEnrolledRef.current) {
          return cpoEnrolledRef.current;
        }
        if (cpoRealSfpIds.length > 0 && cpoUserId && cpoUserPlanId) {
          const cached = {
            userId: cpoUserId,
            userPlanId: cpoUserPlanId,
            email: cpoUserEmail,
            name: learnerFullName,
            sfpIds: cpoRealSfpIds,
            customAmount: payAmount,
          };
          cpoEnrolledRef.current = cached;
          return cached;
        }
        const packageSessionIds =
          inviteData?.package_session_to_payment_options.map(
            (ps: { package_session_id: string }) => ps?.package_session_id,
          ) || [""];
        const paymentOptionId =
          inviteData?.package_session_to_payment_options[0]?.payment_option
            ?.id || "";
        if (!paymentOptionId) throw new Error(t("errors.noCpoPaymentOptionFound"));

        const result = await enrollCpoWithoutPayment({
          registrationData: form.getValues(),
          instituteId,
          enrollInviteId: inviteData?.id,
          paymentOptionId,
          packageSessionIds,
          allowLearnersToCreateCourses: getAllowLearnersToCreateCourses(),
          isUsingInstituteCustomFields,
        });
        if (!result.userId || !result.userPlanId) {
          throw new Error(
            t("errors.enrollmentSucceededNoUserPlanId"),
          );
        }
        // Write to state (triggers re-render later) AND ref (immediately readable in callbacks)
        setCpoUserId(result.userId);
        setCpoUserPlanId(result.userPlanId);
        setCpoUserEmail(result.userEmail);

        const sfpDues = await fetchCpoDues({
          userId: result.userId,
          userPlanId: result.userPlanId,
        });
        const pendingIds = sfpDues
          .filter((d) => d.status !== "PAID" && d.status !== "WAIVED")
          .map((d) => d.id);
        if (pendingIds.length === 0)
          throw new Error(
            t("errors.noPendingInstallmentsGenerated"),
          );
        setCpoRealSfpIds(pendingIds);

        const enrolled = {
          userId: result.userId,
          userPlanId: result.userPlanId,
          email: result.userEmail,
          name: learnerFullName,
          sfpIds: pendingIds,
          customAmount: payAmount,
        };
        cpoEnrolledRef.current = enrolled;
        return enrolled;
      };

      if (vendor === "RAZORPAY") {
        setLoading(true);
        setError(null);
        try {
          const enrolled = await getOrEnrollCpoSfpIds();
          const paymentResponse = await payCpoInstallments({
            userId: enrolled.userId,
            userPlanId: enrolled.userPlanId,
            instituteId,
            studentFeePaymentIds: enrolled.sfpIds,
            customAmount: payAmount,
            paymentVendor: "RAZORPAY",
            currency,
            email: enrolled.email,
            name: enrolled.name,
            razorpayPaymentData: razorpayPaymentData || undefined,
          });
          const orderDetails =
            paymentResponse?.payment_response?.response_data ||
            paymentResponse?.response_data;
          if (!orderDetails?.razorpayKeyId || !orderDetails?.razorpayOrderId)
            throw new Error(t("errors.failedToCreateRazorpayOrder"));
          setOrderId(
            paymentResponse?.payment_response?.order_id ||
              paymentResponse?.order_id,
          );
          setPaymentCompletionResponse(paymentResponse);
          if (razorpayRef.current) {
            razorpayRef.current.openPayment({
              razorpayKeyId: orderDetails.razorpayKeyId,
              razorpayOrderId: orderDetails.razorpayOrderId,
              amount: orderDetails.amount,
              currency: orderDetails.currency || currency,
              contact: "",
              email: enrolled.email,
            });
          }
          setLoading(false);
        } catch (err) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          const errorData = err?.response?.data;
          const msg =
            errorData?.ex ||
            (err instanceof Error ? err.message : null) ||
            t("errors.failedToInitiatePayment");
          setError(msg);
          if (inviteData?.gtm_container_id)
            pushPaymentFailed({
              courseName: courseData.course || "",
              vendor: "RAZORPAY",
              errorMessage: msg,
              utmParams,
            });
          setLoading(false);
        }
        return;
      }

      if (vendor === "STRIPE") {
        if (
          !stripePaymentProcessor ||
          typeof stripePaymentProcessor !== "function"
        ) {
          setError(
            t("errors.stripeNotReady"),
          );
          return;
        }
        setLoading(true);
        setError(null);
        const stripeResult = await stripePaymentProcessor();
        if (!stripeResult.success || !stripeResult.paymentMethodId) {
          setError(stripeResult.error || t("errors.paymentProcessingFailed"));
          setLoading(false);
          return;
        }
        try {
          const enrolled = await getOrEnrollCpoSfpIds();
          const paymentResponse = await payCpoInstallments({
            userId: enrolled.userId,
            userPlanId: enrolled.userPlanId,
            instituteId,
            studentFeePaymentIds: enrolled.sfpIds,
            customAmount: payAmount,
            paymentVendor: "STRIPE",
            currency,
            email: enrolled.email,
            name: enrolled.name,
            paymentMethodId: stripeResult.paymentMethodId,
          });
          setOrderId(paymentResponse?.payment_response?.order_id);
          setPaymentCompletionResponse(paymentResponse);
          setTimeout(async () => {
            if (
              paymentResponse?.payment_response?.response_data
                ?.paymentStatus === "PAID"
            ) {
              setCurrentStep(5);
              await fetchAndHandleEnrollmentPolicy();
            } else setCurrentStep(4);
          }, 100);
        } catch (err) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          const errorData = err?.response?.data;
          const msg =
            errorData?.ex ||
            (err instanceof Error ? err.message : null) ||
            t("errors.paymentFailed");
          setError(msg);
          if (inviteData?.gtm_container_id)
            pushPaymentFailed({
              courseName: courseData.course || "",
              vendor: "STRIPE",
              errorMessage: msg,
              utmParams,
            });
        } finally {
          setLoading(false);
        }
        return;
      }

      if (vendor === "EWAY") {
        if (!ewayEncryptedData) {
          setError(t("errors.completePaymentForm"));
          return;
        }
        setLoading(true);
        setError(null);
        try {
          const enrolled = await getOrEnrollCpoSfpIds();
          const paymentResponse = await payCpoInstallments({
            userId: enrolled.userId,
            userPlanId: enrolled.userPlanId,
            instituteId,
            studentFeePaymentIds: enrolled.sfpIds,
            customAmount: payAmount,
            paymentVendor: "EWAY",
            currency: "aud",
            email: enrolled.email,
            name: enrolled.name,
            ewayPaymentData: ewayEncryptedData,
          });
          setOrderId(paymentResponse?.payment_response?.order_id);
          setPaymentCompletionResponse(paymentResponse);
          setTimeout(async () => {
            if (
              paymentResponse?.payment_response?.response_data
                ?.paymentStatus === "PAID"
            ) {
              setCurrentStep(5);
              await fetchAndHandleEnrollmentPolicy();
            } else setCurrentStep(4);
          }, 100);
        } catch (err) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          const errorData = err?.response?.data;
          setError(
            errorData?.ex ||
              (err instanceof Error ? err.message : null) ||
              t("errors.paymentFailed"),
          );
        } finally {
          setLoading(false);
        }
        return;
      }

      // Default / unsupported vendor for CPO
      setError(
        t("errors.cpoVendorNotSupported"),
      );
      return;
    }

    // Fire payment_initiated GTM event (skip for FREE — no payment involved)
    if (inviteData?.gtm_container_id && paymentType !== "FREE") {
      pushPaymentInitiated({
        courseName: courseData.course || "",
        paymentType,
        vendor: getPaymentVendor(inviteData) || "STRIPE",
        currency: enrollmentData.selectedPayment?.currency,
        amount: getSelectedPaymentPrice(enrollmentData.selectedPayment),
        utmParams,
      });
    }

    // For FREE payments, skip payment processing and go directly to success
    if (paymentType === "FREE") {
      setLoading(true);
      try {
        // Use ref to get the latest referRequest value (avoids closure issues)
        const currentReferRequest = referRequestRef.current;
        console.log(
          "[FREE Enrollment] Using referRequest:",
          currentReferRequest,
        );

        const paymentResponse = await handleEnrollLearnerForPayment({
          registrationData: form.getValues(),
          enrollmentData: enrollmentData,
          // No paymentMethodId for FREE payments
          instituteId,
          enrollInviteId: inviteData?.id,
          payment_option_id:
            inviteData?.package_session_to_payment_options[0].payment_option.id,
          package_session_ids:
            inviteData?.package_session_to_payment_options.map(
              (ps: { package_session_id: string }) => ps?.package_session_id,
            ) || [""],
          allowLearnersToCreateCourses: getAllowLearnersToCreateCourses(),
          referRequest: currentReferRequest,
          couponCode: appliedCouponCode,
          couponDiscount,
          paymentVendor: "STRIPE", // Default for FREE payments
          isUsingInstituteCustomFields: isUsingInstituteCustomFields,
          billingContact: collectBillingContact ? billingContact : undefined,
          // userId: submittedUserId || undefined,
        });
        setPaymentCompletionResponse(paymentResponse);
        // A FREE enrolment skips the abandoned-cart submit above, so this is
        // the only place its campaign touch can be recorded. Before the
        // redirect branch — a configured redirectPath leaves the page.
        // Identity via getUserDetails(), NOT form.getValues().email: this form
        // is custom-field driven, so its values are {value: ...} objects keyed
        // by whatever the institute named the field. Reading `.email` off it
        // yielded an object (or undefined), which the server rejected — so the
        // FREE path recorded nothing at all.
        const freeUser = paymentResponse?.user;
        const freeDetails = getUserDetails();
        trackUtmAttribution({
          instituteId,
          userId: freeUser?.id || submittedUserId || undefined,
          email: freeUser?.email || freeDetails.email || undefined,
          mobileNumber: freeDetails.contact || undefined,
          sourceType: "ENROLL_INVITE",
          sourceId: inviteData?.id,
        });
        if (inviteConfig?.redirectPath) {
          window.location.href = inviteConfig.redirectPath;
          return;
        }
        setCurrentStep(5); // Go directly to success for FREE payments

        // Fetch and handle enrollment policy (shows dialog if needed)
        await fetchAndHandleEnrollmentPolicy();
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const errorData = err?.response?.data;
        if (errorData?.responseCode?.includes("510")) {
          const dialogOpened = await fetchAndHandleEnrollmentPolicy(
            "error_already_enrolled",
            errorData?.ex,
            errorData?.responseCode,
          );
          if (!dialogOpened) {
            toast.error(errorData?.ex || t("errors.enrollmentFailed"));
          }
        }
        setError(errorData?.ex);
        if (inviteData?.gtm_container_id) {
          pushPaymentFailed({
            courseName: courseData.course || "",
            vendor: "NONE",
            errorMessage: errorData?.ex || "Enrollment failed",
            utmParams,
          });
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    // Determine payment vendor
    const vendor = getPaymentVendor(inviteData);
    // For EWAY payments
    if (vendor === "EWAY") {
      if (!ewayEncryptedData) {
        setError(t("errors.completePaymentForm"));
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const paymentResponse = await handleEnrollLearnerForPayment({
          registrationData: form.getValues(),
          enrollmentData: enrollmentData,
          instituteId,
          enrollInviteId: inviteData?.id,
          payment_option_id:
            inviteData?.package_session_to_payment_options[0].payment_option.id,
          package_session_ids:
            inviteData?.package_session_to_payment_options.map(
              (ps: { package_session_id: string }) => ps?.package_session_id,
            ) || [""],
          allowLearnersToCreateCourses: getAllowLearnersToCreateCourses(),
          referRequest: referRequest,
          couponCode: appliedCouponCode,
          couponDiscount,
          ewayPaymentData: ewayEncryptedData,
          paymentVendor: "EWAY",
          isUsingInstituteCustomFields: isUsingInstituteCustomFields,
          billingContact: collectBillingContact ? billingContact : undefined,
          // userId: submittedUserId || undefined,
        });
        setOrderId(paymentResponse?.payment_response?.order_id);
        setPaymentCompletionResponse(paymentResponse);
        setTimeout(async () => {
          if (
            paymentResponse?.payment_response?.response_data?.paymentStatus ===
            "PAID"
          ) {
            if (inviteConfig?.redirectPath) {
              window.location.href = inviteConfig.redirectPath;
              return;
            }
            setCurrentStep(5);
            // Fetch and handle enrollment policy (shows dialog if needed)
            await fetchAndHandleEnrollmentPolicy();
          } else setCurrentStep(4);
        }, 100);
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const errorData = err?.response?.data;
        if (errorData?.responseCode?.includes("510")) {
          const dialogOpened = await fetchAndHandleEnrollmentPolicy(
            "error_already_enrolled",
            errorData?.ex,
            errorData?.responseCode,
          );
          if (!dialogOpened) {
            toast.error(errorData?.ex || t("errors.paymentFailed"));
          }
        }
        setError(errorData?.ex);
        if (inviteData?.gtm_container_id) {
          pushPaymentFailed({
            courseName: courseData.course || "",
            vendor: "EWAY",
            errorMessage: errorData?.ex || "Payment failed",
            utmParams,
          });
        }
        console.error(err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // For PHONEPE payments — Standard Checkout full-page redirect flow.
    // Enrollment (user + user plan, payment pending) is created, then the learner
    // is sent to PhonePe's hosted page; the payment-result page polls status and
    // logs them in once PhonePe confirms the payment.
    if (vendor === "PHONEPE") {
      setLoading(true);
      setError(null);

      try {
        const phonePeRedirectUrl = getPhonePeReturnUrl(instituteId);
        const paymentResponse = await handleEnrollLearnerForPayment({
          registrationData: form.getValues(),
          enrollmentData: enrollmentData,
          instituteId,
          enrollInviteId: inviteData?.id,
          payment_option_id:
            inviteData?.package_session_to_payment_options[0].payment_option.id,
          package_session_ids:
            inviteData?.package_session_to_payment_options.map(
              (ps: { package_session_id: string }) => ps?.package_session_id,
            ) || [""],
          allowLearnersToCreateCourses: getAllowLearnersToCreateCourses(),
          referRequest: referRequest,
          couponCode: appliedCouponCode,
          couponDiscount,
          paymentVendor: "PHONEPE",
          phonePeRedirectUrl,
          isUsingInstituteCustomFields: isUsingInstituteCustomFields,
          billingContact: collectBillingContact ? billingContact : undefined,
        });

        const ordId =
          paymentResponse?.payment_response?.order_id ||
          paymentResponse?.order_id ||
          "";
        const redirectUrl =
          paymentResponse?.payment_response?.response_data?.redirectUrl ||
          paymentResponse?.payment_response?.response_data?.redirect_url;

        if (!redirectUrl) {
          throw new Error(
            t("errors.phonepeCheckoutFailed"),
          );
        }

        setOrderId(ordId);
        setPaymentCompletionResponse(paymentResponse);

        // Persist credentials + order id so the payment-result page can auto-login
        // the learner and resolve the order after PhonePe redirects back.
        const username =
          paymentResponse?.user?.username ??
          paymentResponse?.user?.email ??
          getUserDetails().email;
        const userPassword =
          paymentResponse?.user?.password ?? getPasswordField(form.getValues());
        if (ordId && username && userPassword) {
          try {
            sessionStorage.setItem(
              `enroll_payment_creds_${ordId}`,
              JSON.stringify({ username, password: userPassword }),
            );
          } catch {
            /* ignore */
          }
        }
        if (ordId) {
          try {
            localStorage.setItem(
              "phonepe_pending_order",
              JSON.stringify({ orderId: ordId, instituteId }),
            );
          } catch {
            /* ignore */
          }
        }

        // Hand off to PhonePe's hosted checkout page (full-page redirect).
        window.location.href = redirectUrl;
        return;
      } catch (err) {
        const errorData = (
          err as {
            response?: { data?: { ex?: string; responseCode?: string } };
          }
        )?.response?.data;
        if (errorData?.responseCode?.includes("510")) {
          const dialogOpened = await fetchAndHandleEnrollmentPolicy(
            "error_already_enrolled",
            errorData?.ex,
            errorData?.responseCode,
          );
          if (!dialogOpened) {
            toast.error(errorData?.ex || t("errors.paymentFailed"));
          }
        }
        const phonePeErrorMsg =
          errorData?.ex ||
          (err instanceof Error ? err.message : null) ||
          t("errors.failedToInitiatePhonepePayment");
        setError(phonePeErrorMsg);
        if (inviteData?.gtm_container_id) {
          pushPaymentFailed({
            courseName: courseData.course || "",
            vendor: "PHONEPE",
            errorMessage: phonePeErrorMsg,
            utmParams,
          });
        }
        console.error("PhonePe enrollment error:", err);
        setLoading(false);
      }
      return;
    }

    // For CASHFREE payments - inline card flow (order created when entering step 3)
    if (vendor === "CASHFREE") {
      if (cashfreeSessionData || cashfreeInitLoading) {
        return; // Payment is via inline Pay Now; or still initializing
      }
      setLoading(true);
      setError(null);

      try {
        // Step 1: Create enrollment (user + user plan with payment pending)
        const paymentResponse = await handleEnrollLearnerForPayment({
          registrationData: form.getValues(),
          enrollmentData: enrollmentData,
          instituteId,
          enrollInviteId: inviteData?.id,
          payment_option_id:
            inviteData?.package_session_to_payment_options[0].payment_option.id,
          package_session_ids:
            inviteData?.package_session_to_payment_options.map(
              (ps: { package_session_id: string }) => ps?.package_session_id,
            ) || [""],
          allowLearnersToCreateCourses: getAllowLearnersToCreateCourses(),
          referRequest: referRequest,
          couponCode: appliedCouponCode,
          couponDiscount,
          paymentVendor: "CASHFREE",
          isUsingInstituteCustomFields: isUsingInstituteCustomFields,
          billingContact: collectBillingContact ? billingContact : undefined,
        });

        // Extract userPlanId from response (backend creates enrollment and returns it)
        const userPlanId =
          paymentResponse?.payment_response?.user_plan_id ||
          paymentResponse?.user_plan_id ||
          paymentResponse?.learner_package_session_enroll?.user_plan_id;

        if (!userPlanId) {
          throw new Error(
            t("errors.enrollmentCreatedNoUserPlanId"),
          );
        }

        const userEmail = getUserDetails().email;
        if (!userEmail) {
          throw new Error(t("errors.emailRequiredForPayment"));
        }

        const token = await getTokenFromStorage(TokenKey.accessToken);
        if (!token) {
          throw new Error(t("errors.loginRequiredForPayment"));
        }

        const returnUrl = getCashfreeReturnUrl();
        const amount = getSelectedPaymentPrice(enrollmentData.selectedPayment);
        const currency = enrollmentData.selectedPayment?.currency || "INR";

        // Step 2: Call user-plan-payment API to get paymentSessionId
        const cfResponse = await initiateCashfreePayment(
          instituteId,
          userPlanId,
          {
            amount,
            currency,
            email: userEmail,
            returnUrl,
            token,
          },
        );

        const paymentSessionId =
          cfResponse?.responseData?.paymentSessionId ??
          cfResponse?.responseData?.payment_session_id;

        if (!paymentSessionId) {
          throw new Error(
            t("errors.failedToInitializePaymentContactSupport"),
          );
        }

        setOrderId(cfResponse.orderId);
        setPaymentCompletionResponse(paymentResponse);

        // Step 3: Launch Cashfree checkout (redirects to return_url on success/failure)
        // SDK mode must match the environment the session was minted in;
        // VITE_CASHFREE_SANDBOX=true forces sandbox against older backends.
        const cfEnv = cfResponse?.responseData?.environment;
        const mode =
          cfEnv === "sandbox" || cfEnv === "production"
            ? cfEnv
            : import.meta.env.VITE_CASHFREE_SANDBOX === "true"
              ? "sandbox"
              : "production";
        const cashfree = await loadCashfree({ mode });

        if (!cashfree) {
          throw new Error(t("errors.failedToLoadCashfree"));
        }

        const checkoutResult = await cashfree.checkout({
          paymentSessionId,
          returnUrl: `${returnUrl}?orderId=${cfResponse.orderId}&instituteId=${instituteId}`,
        });

        if (checkoutResult?.error) {
          throw new Error(
            checkoutResult.error.message || t("errors.paymentInitializationFailed"),
          );
        }
        // On success, checkout redirects to return_url - no further action needed
      } catch (err) {
        const errorData = (
          err as {
            response?: { data?: { ex?: string; responseCode?: string } };
          }
        )?.response?.data;
        if (errorData?.responseCode?.includes("510")) {
          const dialogOpened = await fetchAndHandleEnrollmentPolicy(
            "error_already_enrolled",
            errorData?.ex,
            errorData?.responseCode,
          );
          if (!dialogOpened) {
            toast.error(errorData?.ex || t("errors.paymentFailed"));
          }
        }
        const cashfreeErrorMsg =
          (err as Error)?.message ||
          errorData?.ex ||
          t("errors.failedToInitiateCashfreePayment");
        setError(cashfreeErrorMsg);
        if (inviteData?.gtm_container_id) {
          pushPaymentFailed({
            courseName: courseData.course || "",
            vendor: "CASHFREE",
            errorMessage: cashfreeErrorMsg,
            utmParams,
          });
        }
        console.error("Cashfree enrollment error:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // For RAZORPAY payments
    if (vendor === "RAZORPAY") {
      setLoading(true);
      setError(null);

      try {
        // Step 1: Call enrollment API to create order (without payment data)
        const paymentResponse = await handleEnrollLearnerForPayment({
          registrationData: form.getValues(),
          enrollmentData: enrollmentData,
          instituteId,
          enrollInviteId: inviteData?.id,
          payment_option_id:
            inviteData?.package_session_to_payment_options[0].payment_option.id,
          package_session_ids:
            inviteData?.package_session_to_payment_options.map(
              (ps: { package_session_id: string }) => ps?.package_session_id,
            ) || [""],
          allowLearnersToCreateCourses: getAllowLearnersToCreateCourses(),
          referRequest: referRequest,
          couponCode: appliedCouponCode,
          couponDiscount,
          razorpayPaymentData: razorpayPaymentData || undefined, // Will be undefined on first call
          paymentVendor: "RAZORPAY",
          // Binds the recurring order to the learner's chosen authorization method.
          ...(isAutopay ? { mandateMethod } : {}),
          isUsingInstituteCustomFields: isUsingInstituteCustomFields,
          billingContact: collectBillingContact ? billingContact : undefined,
          // userId: submittedUserId || undefined,
        });

        // Step 2: Extract order details from response
        const orderDetails = paymentResponse?.payment_response?.response_data;

        if (
          !orderDetails ||
          !orderDetails.razorpayKeyId ||
          !orderDetails.razorpayOrderId
        ) {
          throw new Error(t("errors.failedToCreateRazorpayOrder"));
        }

        // Store order ID for later use
        setOrderId(paymentResponse?.payment_response?.order_id);
        setPaymentCompletionResponse(paymentResponse);

        // Step 3: Open Razorpay payment modal
        if (razorpayRef.current) {
          razorpayRef.current.openPayment({
            razorpayKeyId: orderDetails.razorpayKeyId,
            razorpayOrderId: orderDetails.razorpayOrderId,
            amount: orderDetails.amount,
            currency: orderDetails.currency || "INR",
            contact: orderDetails.contact || "",
            email: orderDetails.email || "",
            // Autopay: present when the backend registered a recurring mandate;
            // drives Checkout into UPI-Autopay / card-mandate mode.
            recurring: orderDetails.recurring,
            customerId: orderDetails.customerId,
          });
        } else {
          throw new Error(t("errors.razorpayComponentNotReady"));
        }

        setLoading(false);
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const errorData = err?.response?.data;
        if (errorData?.responseCode?.includes("510")) {
          const dialogOpened = await fetchAndHandleEnrollmentPolicy(
            "error_already_enrolled",
            errorData?.ex,
            errorData?.responseCode,
          );
          if (!dialogOpened) {
            toast.error(errorData?.ex || t("errors.failedToInitiatePayment"));
          }
        }
        setError(errorData?.ex || t("errors.failedToInitiatePayment"));
        if (inviteData?.gtm_container_id) {
          pushPaymentFailed({
            courseName: courseData.course || "",
            vendor: "RAZORPAY",
            errorMessage: errorData?.ex || "Failed to initiate payment",
            utmParams,
          });
        }
        console.error("Razorpay enrollment error:", err);
        setLoading(false);
      }
      return;
    }

    if (
      !stripePaymentProcessor ||
      typeof stripePaymentProcessor !== "function"
    ) {
      setError(t("errors.stripeNotReady"));
      console.error("Stripe payment processor not ready:", {
        value: stripePaymentProcessor,
        type: typeof stripePaymentProcessor,
      });
      return;
    }

    setLoading(true);
    setError(null);

    // Process Stripe payment
    const stripeResult = await stripePaymentProcessor();

    if (!stripeResult.success || !stripeResult.paymentMethodId) {
      setError(stripeResult.error || t("errors.paymentProcessingFailed"));
      setLoading(false);
      return;
    }

    try {
      const paymentResponse = await handleEnrollLearnerForPayment({
        registrationData: form.getValues(),
        enrollmentData: enrollmentData,
        paymentMethodId: stripeResult.paymentMethodId,
        instituteId,
        enrollInviteId: inviteData?.id,
        payment_option_id:
          inviteData?.package_session_to_payment_options[0].payment_option.id,
        package_session_ids: inviteData?.package_session_to_payment_options.map(
          (ps: { package_session_id: string }) => ps?.package_session_id,
        ) || [""],
        allowLearnersToCreateCourses: getAllowLearnersToCreateCourses(),
        referRequest: referRequest,
        couponCode: appliedCouponCode,
        couponDiscount,
        paymentVendor: "STRIPE",
        isUsingInstituteCustomFields: isUsingInstituteCustomFields,
        billingContact: collectBillingContact ? billingContact : undefined,
        // userId: submittedUserId || undefined,
      });
      setOrderId(paymentResponse?.payment_response?.order_id);
      setPaymentCompletionResponse(paymentResponse);
      setTimeout(async () => {
        if (
          paymentResponse?.payment_response?.response_data?.paymentStatus ===
          "PAID"
        ) {
          if (inviteConfig?.redirectPath) {
            window.location.href = inviteConfig.redirectPath;
            return;
          }
          setCurrentStep(5);
          // Fetch and handle enrollment policy (shows dialog if needed)
          await fetchAndHandleEnrollmentPolicy();
        } else setCurrentStep(4);
      }, 100);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      const errorData = err?.response?.data;
      if (errorData?.responseCode?.includes("510")) {
        const dialogOpened = await fetchAndHandleEnrollmentPolicy(
          "error_already_enrolled",
          errorData?.ex,
          errorData?.responseCode,
        );
        if (!dialogOpened) {
          toast.error(errorData?.ex || t("errors.paymentFailed"));
        }
      }
      setError(errorData?.ex);
      if (inviteData?.gtm_container_id) {
        pushPaymentFailed({
          courseName: courseData.course || "",
          vendor: "STRIPE",
          errorMessage: errorData?.ex || "Payment failed",
          utmParams,
        });
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Complete enrollment after Razorpay payment is successful
  useEffect(() => {
    const vendor = propVendor || getPaymentVendor(inviteData);

    if (
      vendor === "RAZORPAY" &&
      razorpayPaymentData &&
      !loading &&
      currentStep === 3
    ) {
      const completeRazorpayEnrollment = async () => {
        setLoading(true);
        setError(null);

        try {
          // CPO: second Razorpay call goes to cpo-pay-installments
          if (paymentType === "CPO" && cpoEnrolledRef.current) {
            const enrolled = cpoEnrolledRef.current;
            const paymentResponse = await payCpoInstallments({
              userId: enrolled.userId,
              userPlanId: enrolled.userPlanId,
              instituteId,
              studentFeePaymentIds: enrolled.sfpIds,
              customAmount: enrolled.customAmount,
              paymentVendor: "RAZORPAY",
              currency: inviteData?.currency || "INR",
              email: enrolled.email,
              name: enrolled.name,
              razorpayPaymentData,
            });
            setPaymentCompletionResponse(paymentResponse);
            setTimeout(async () => {
              // cpo-pay-installments returns a flat PaymentResponseDTO (top-level
              // `response_data`), unlike the non-CPO enroll endpoint which nests it under
              // `payment_response`. Check both so the idempotent PAID short-circuit (when the
              // settlement webhook already ran) is detected and we advance to success.
              const cpoPaymentStatus =
                paymentResponse?.payment_response?.response_data?.paymentStatus ??
                paymentResponse?.response_data?.paymentStatus;
              if (cpoPaymentStatus === "PAID") {
                setCurrentStep(5);
                await fetchAndHandleEnrollmentPolicy();
              } else setCurrentStep(4);
            }, 100);
            return;
          }

          // Regular non-CPO Razorpay completion
          const paymentResponse = await handleEnrollLearnerForPayment({
            registrationData: form.getValues(),
            enrollmentData: enrollmentData,
            instituteId,
            enrollInviteId: inviteData?.id,
            payment_option_id:
              inviteData?.package_session_to_payment_options[0].payment_option
                .id,
            package_session_ids:
              inviteData?.package_session_to_payment_options.map(
                (ps: { package_session_id: string }) => ps?.package_session_id,
              ) || [""],
            allowLearnersToCreateCourses: getAllowLearnersToCreateCourses(),
            referRequest: referRequest,
            couponCode: appliedCouponCode,
            couponDiscount,
            razorpayPaymentData: razorpayPaymentData, // Now includes payment details
            paymentVendor: "RAZORPAY",
            isUsingInstituteCustomFields: isUsingInstituteCustomFields,
            billingContact: collectBillingContact ? billingContact : undefined,
            // userId: submittedUserId || undefined,
          });

          setPaymentCompletionResponse(paymentResponse);

          setTimeout(async () => {
            if (
              paymentResponse?.payment_response?.response_data
                ?.paymentStatus === "PAID"
            ) {
              if (inviteConfig?.redirectPath) {
                window.location.href = inviteConfig.redirectPath;
                return;
              }
              setCurrentStep(5);
              await fetchAndHandleEnrollmentPolicy();
            } else {
              setCurrentStep(4);
            }
          }, 100);
        } catch (err) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          const errorData = err?.response?.data;
          if (errorData?.responseCode?.includes("510")) {
            const dialogOpened = await fetchAndHandleEnrollmentPolicy(
              "error_already_enrolled",
              errorData?.ex,
              errorData?.responseCode,
            );
            if (!dialogOpened) {
              toast.error(errorData?.ex || t("errors.failedToCompleteEnrollment"));
            }
          }
          setError(errorData?.ex || t("errors.failedToCompleteEnrollment"));
          if (inviteData?.gtm_container_id) {
            pushPaymentFailed({
              courseName: courseData.course || "",
              vendor: "RAZORPAY",
              errorMessage: errorData?.ex || "Failed to complete enrollment",
              utmParams,
            });
          }
          console.error("Razorpay completion error:", err);
        } finally {
          setLoading(false);
        }
      };

      completeRazorpayEnrollment();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [razorpayPaymentData]);

  // Initialize Cashfree payment (create enrollment + get paymentSessionId) when entering step 3
  useEffect(() => {
    const vendor = propVendor || getPaymentVendor(inviteData);
    if (
      vendor !== "CASHFREE" ||
      currentStep !== 3 ||
      cashfreeSessionData ||
      cashfreeInitLoading ||
      cashfreeInitAttemptedRef.current
    ) {
      return;
    }

    cashfreeInitAttemptedRef.current = true;
    setCashfreeInitLoading(true);
    setError(null);

    const init = async () => {
      try {
        const paymentResponse = await handleEnrollLearnerForPayment({
          registrationData: form.getValues(),
          enrollmentData: enrollmentData,
          instituteId,
          enrollInviteId: inviteData?.id,
          payment_option_id:
            inviteData?.package_session_to_payment_options[0].payment_option.id,
          package_session_ids:
            inviteData?.package_session_to_payment_options.map(
              (ps: { package_session_id: string }) => ps?.package_session_id,
            ) || [""],
          allowLearnersToCreateCourses: getAllowLearnersToCreateCourses(),
          referRequest: referRequestRef.current,
          couponCode: appliedCouponCode,
          couponDiscount,
          paymentVendor: "CASHFREE",
          isUsingInstituteCustomFields: isUsingInstituteCustomFields,
          billingContact: collectBillingContact ? billingContact : undefined,
        });

        const userPlanId =
          paymentResponse?.user_plan_id ||
          paymentResponse?.payment_response?.user_plan_id ||
          paymentResponse?.learner_package_session_enroll?.user_plan_id;

        const responseData = paymentResponse?.payment_response?.response_data;
        let paymentSessionId =
          responseData?.paymentSessionId ?? responseData?.payment_session_id;
        let cfEnvironment =
          typeof responseData?.environment === "string"
            ? responseData.environment
            : null;
        // Use top-level orderId (paymentLogId) for status API – backend looks up by payment_log.id
        let cfOrderId =
          paymentResponse?.orderId ??
          paymentResponse?.payment_response?.order_id ??
          responseData?.orderId ??
          responseData?.order_id;

        if (!paymentSessionId) {
          if (!userPlanId) throw new Error(t("errors.userPlanIdNotReceived"));
          const token = await getTokenFromStorage(TokenKey.accessToken);
          if (!token) {
            throw new Error(
              t("errors.paymentSessionMissingLoginRequired"),
            );
          }
          const userEmail = getUserDetails().email;
          if (!userEmail) throw new Error(t("errors.emailRequired"));

          const amount = getSelectedPaymentPrice(enrollmentData.selectedPayment);
          const cfResponse = await initiateCashfreePayment(
            instituteId,
            userPlanId,
            {
              amount,
              currency: enrollmentData.selectedPayment?.currency || "INR",
              email: userEmail,
              returnUrl: getCashfreeReturnUrl(),
              token,
            },
          );

          paymentSessionId =
            cfResponse?.responseData?.paymentSessionId ??
            cfResponse?.responseData?.payment_session_id;
          cfOrderId = cfResponse?.orderId ?? cfOrderId;
          cfEnvironment =
            typeof cfResponse?.responseData?.environment === "string"
              ? cfResponse.responseData.environment
              : cfEnvironment;
        }

        if (!paymentSessionId) throw new Error(t("errors.failedToInitializePayment"));

        const ordId =
          cfOrderId ??
          paymentResponse?.orderId ??
          paymentResponse?.payment_response?.order_id ??
          "";
        setCashfreeSessionData({
          paymentSessionId,
          orderId: ordId,
          environment: cfEnvironment,
        });
        setOrderId(ordId);
        setPaymentCompletionResponse(paymentResponse);
        // Store username and password from enrollment response for post-payment login
        // Prefer user.username (required by login API), fallback to user.email or form data
        const username =
          paymentResponse?.user?.username ??
          paymentResponse?.user?.email ??
          getUserDetails().email;
        const userPassword =
          paymentResponse?.user?.password ?? getPasswordField(form.getValues());
        if (ordId && username && userPassword) {
          try {
            sessionStorage.setItem(
              `enroll_payment_creds_${ordId}`,
              JSON.stringify({ username, password: userPassword }),
            );
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        const errData = (
          err as {
            response?: { data?: { ex?: string; responseCode?: string } };
          }
        )?.response?.data;
        if (errData?.responseCode?.includes("510")) {
          const dialogOpened = await fetchAndHandleEnrollmentPolicy(
            "error_already_enrolled",
            errData?.ex,
            errData?.responseCode,
          );
          if (!dialogOpened) {
            toast.error(errData?.ex || t("errors.paymentFailed"));
          }
        }
        setError(
          (err as Error)?.message ||
            errData?.ex ||
            t("errors.failedToInitializePaymentFallback"),
        );
      } finally {
        setCashfreeInitLoading(false);
      }
    };

    init();
  }, [
    currentStep,
    inviteData,
    enrollmentData,
    instituteId,
    cashfreeSessionData,
    cashfreeInitLoading,
  ]);

  useEffect(() => {
    if (currentStep !== 3) {
      cashfreeInitAttemptedRef.current = false;
    }
  }, [currentStep]);

  useEffect(() => {
    const loadCourseData = async () => {
      try {
        const transformedData = await safeJsonParse(
          inviteData?.web_page_meta_data_json,
          {},
        );
        const paymentTypeValue =
          inviteData?.package_session_to_payment_options[0]?.payment_option
            ?.type || "";
        setPaymentType(paymentTypeValue);

        // If payment type is FREE, ONE_TIME, or DONATION, automatically set the default payment plan
        // CPO does not pre-select a payment plan — installments are loaded after enrollment
        if (
          paymentTypeValue === "FREE" ||
          paymentTypeValue === "ONE_TIME" ||
          paymentTypeValue === "DONATION"
        ) {
          const paymentOptionMeta =
            inviteData?.package_session_to_payment_options[0]?.payment_option;
          const plans = paymentOptionMeta?.payment_plans || [];
          const defaultPaymentPlan = plans[0];
          if (defaultPaymentPlan) {
            // Get the unit from payment option metadata to format duration correctly
            const paymentOptionMetadata = JSON.parse(
              paymentOptionMeta?.payment_option_metadata_json || "{}",
            );
            const unit = paymentOptionMetadata?.unit || "days";

            const duration =
              unit === "days"
                ? t("planDuration.days", { count: defaultPaymentPlan.validity_in_days })
                : t("planDuration.months", {
                    count: Math.floor(defaultPaymentPlan.validity_in_days / 30),
                  });

            // @ts-expect-error // TODO:fix this
            const preselectedPayment: SelectedPayment = {
              id: defaultPaymentPlan.id,
              name: defaultPaymentPlan.name,
              amount: defaultPaymentPlan.actual_price,
              currency: defaultPaymentPlan.currency,
              description: defaultPaymentPlan.description,
              duration: duration,
              // Include referral option for free plans
              referral_option: defaultPaymentPlan.referral_option,
              // features: [],
            };
            setEnrollmentData((prev) => ({
              ...prev,
              selectedPayment: preselectedPayment,
            }));
          }
        }
        const transformedJsonData =
          await transformApiDataToCourseDataForInvite(transformedData);
        setCourseData({
          aboutCourse: transformedJsonData?.aboutCourse || "",
          course: transformedJsonData?.course || "",
          courseBanner: transformedJsonData?.courseBanner || "",
          courseMedia: transformedJsonData?.courseMediaPreview || "",
          coursePreview: transformedJsonData?.coursePreview || "",
          courseMediaId: {
            type: transformedJsonData?.courseMediaId.type || "",
            id: transformedJsonData?.courseMediaId.id || "",
          },
          customHtml: transformedJsonData?.customHtml || "",
          description: transformedJsonData?.description || "",
          includeInstituteLogo:
            transformedJsonData?.includeInstituteLogo || false,
          blendHeaderWithBackground:
            transformedJsonData?.blendHeaderWithBackground || false,
          includePaymentPlans:
            transformedJsonData?.includePaymentPlans || false,
          instituteLogo: transformedJsonData?.instituteLogo || "",
          learningOutcome: transformedJsonData?.learningOutcome || "",
          restrictToSameBatch:
            transformedJsonData?.restrictToSameBatch || false,
          showRelatedCourses: transformedJsonData?.showRelatedCourses || false,
          tags: transformedJsonData?.tags ?? [],
          targetAudience: transformedJsonData?.targetAudience ?? "",
        });
      } catch (error) {
        console.error("Error transforming course data:", error);
      }
    };

    loadCourseData();
  }, [inviteData]);

  // Helper function to get user details from registration data
  /**
   * The learner's OWN email / phone / name out of a custom-field-driven form.
   *
   * Delegates to the shared resolver rather than substring-matching field keys
   * here. The old local version asked only "does the key contain 'email'?",
   * which silently returns nothing on an institute that names the field
   * anything else — and a UTM touch with no identity is dropped by the server,
   * so the campaign that produced the enrolment disappears with no error. The
   * shared resolver matches the platform's storage KEY first, falls back to the
   * label, prefers a field the visitor actually FILLED IN over an empty match,
   * and knows that "School Name" is not the learner's name.
   */
  const getUserDetails = () => {
    const registrationData = form.getValues();
    const candidates = Object.entries(registrationData ?? {}).map(
      ([key, field]) => {
        const f = field as { value?: unknown; name?: string; type?: string } | undefined;
        return {
          key,
          name: f?.name ?? key,
          type: f?.type ?? "",
          value: f?.value == null ? "" : String(f.value),
        };
      }
    );

    const { email, phone, name } = resolveLearnerIdentity(candidates);
    return { email, contact: phone, name };
  };

  // State to track if there is unapplied referral code text
  const [hasUnappliedReferral, setHasUnappliedReferral] = useState(false);

  // Wrapper function to update both state and ref for referRequest
  const updateReferRequest = (newReferRequest: ReferRequest | null) => {
    console.log(
      "[enroll-form] updateReferRequest called with:",
      newReferRequest,
    );
    referRequestRef.current = newReferRequest; // Update ref immediately
    setReferRequest(newReferRequest); // Also update state
  };

  // Handler for when referral is successfully applied - auto-enroll for FREE courses
  const handleReferralApplied = () => {
    // For FREE courses, auto-submit enrollment after referral is applied
    if (
      paymentType === "FREE" &&
      currentStep === 2 &&
      !hasAutoEnrolledRef.current
    ) {
      hasAutoEnrolledRef.current = true;
      // Small delay to ensure UI has updated
      setTimeout(() => {
        console.log(
          "[handleReferralApplied] Triggering auto-enrollment, referRequestRef.current:",
          referRequestRef.current,
        );
        handleSubmitEnrollment();
      }, 500);
    }
  };

  // Auto-enroll for FREE courses when there's no referral option
  // (when ref code is in URL and referral is applied, handleReferralApplied handles it)
  useEffect(() => {
    if (
      paymentType === "FREE" &&
      currentStep === 2 &&
      enrollmentData.selectedPayment &&
      !loading &&
      !hasAutoEnrolledRef.current
    ) {
      // Check if there's a referral option available
      const hasReferralOption =
        enrollmentData.selectedPayment?.referral_option &&
        enrollmentData.selectedPayment?.referral_option !== null;

      // If no referral option exists, auto-proceed immediately for FREE courses
      if (!hasReferralOption) {
        hasAutoEnrolledRef.current = true;
        setTimeout(() => {
          handleSubmitEnrollment();
        }, 300);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentType, currentStep, enrollmentData.selectedPayment, loading]);

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <RegistrationStep
            courseData={courseData}
            inviteData={inviteData}
            instituteId={instituteId}
            onSubmit={onSubmit}
            form={form}
            collectBillingContact={collectBillingContact}
            billingContact={billingContact}
            onBillingContactChange={setBillingContact}
            billingContactFields={billingContactFields}
          />
        );
      case 1: {
        // CPO installment selection step
        if (paymentType === "CPO") {
          return (
            <CpoInstallmentSelectionStep
              dues={cpoDues}
              currency={inviteData?.currency || "INR"}
              selectedSfpIds={cpoSelectedSfpIds}
              onSelectionChange={(ids, total) => {
                setCpoSelectedSfpIds(ids);
                setCpoSelectedTotal(total);
              }}
              customAmount={cpoCustomAmount}
              onCustomAmountChange={setCpoCustomAmount}
              loading={cpoEnrolling}
            />
          );
        }

        // Skip payment selection step for FREE payments
        if (paymentType === "FREE") {
          return (
            <ReviewStep
              courseData={{
                course: courseData.course,
                courseBanner: courseData.courseBanner,
              }}
              selectedPayment={enrollmentData.selectedPayment}
              paymentType={paymentType}
              package_session_id={
                inviteData?.package_session_to_payment_options[0]
                  ?.package_session_id
              }
              setReferRequest={updateReferRequest}
              refCode={ref || ""}
              onUnappliedCodeChange={setHasUnappliedReferral}
              onReferralApplied={handleReferralApplied}
              instituteId={instituteId}
              enrollInviteId={inviteData?.id || ""}
              userEmail={
                enrollmentData.registrationData?.email?.value as
                  | string
                  | undefined
              }
              onCouponChange={handleCouponChange}
              initialCouponCode={appliedCouponCode}
            />
          );
        }

        // Parse donation metadata for DONATION payment type
        let donationMetadata = undefined;
        if (paymentType === "DONATION") {
          try {
            const metadata = JSON.parse(
              inviteData?.package_session_to_payment_options[0]?.payment_option
                ?.payment_option_metadata_json || "{}",
            );
            donationMetadata = {
              allowCustomAmount:
                metadata.donationData?.allowCustomAmount || false,
              suggestedAmounts: metadata.donationData?.suggestedAmounts || "",
              minimumAmount: metadata.donationData?.minimumAmount || "0",
            };
          } catch (error) {
            console.error("Error parsing donation metadata:", error);
          }
        }

        return (
          <PaymentSelectionStep
            // @ts-expect-error : //TODO: Create interface for this
            paymentOptions={paymentOptions}
            selectedPayment={enrollmentData.selectedPayment}
            onPaymentSelect={handlePaymentSelection}
            paymentType={paymentType}
            donationMetadata={donationMetadata}
            onAmountChange={handleDonationAmountChange}
            onValidationChange={handleDonationValidationChange}
          />
        );
      }
      case 2:
        return (
          <>
          {isAutopay && autopayConfig?.TRIAL_DAYS && trialAvailable ? (
            <div className="mb-4 rounded-xl border border-primary-200 bg-primary-50 p-4 text-center text-sm font-medium text-primary-600">
              {t("autopay.trialBanner", {
                trialDays: autopayConfig.TRIAL_DAYS,
                authAmount,
              })}
            </div>
          ) : null}
          {/* For autopay invites the mandate-method choice and the consent come
              BEFORE the plan review: Next stays disabled until consent is ticked,
              and on mobile the consent must be visible without scrolling past a
              long plan review first. */}
          {isAutopay && (propVendor || getPaymentVendor(inviteData)) === "RAZORPAY" && (
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-700">
                {t("autopay.setupHeading")}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                {(
                  [
                    { key: "upi", label: t("autopay.upiLabel"), hint: t("autopay.upiHint") },
                    { key: "card", label: t("autopay.cardLabel"), hint: t("autopay.cardHint") },
                  ] as const
                ).map((option) => (
                  <label
                    key={option.key}
                    className={cn(
                      "flex flex-1 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
                      mandateMethod === option.key
                        ? "border-primary-500 bg-primary-50"
                        : "border-gray-200"
                    )}
                  >
                    <input
                      type="radio"
                      name="mandate-method"
                      className="mt-1 size-4"
                      checked={mandateMethod === option.key}
                      onChange={() => setMandateMethod(option.key)}
                    />
                    <span>
                      <span className="font-medium text-gray-700">{option.label}</span>
                      <span className="block text-xs text-gray-500">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {isAutopay && (
            <label className="mt-4 flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={autopayConsent}
                onChange={(e) => setAutopayConsent(e.target.checked)}
              />
              <span>
                {autopayConfig?.TRIAL_DAYS ? (
                  <>
                    {t("autopay.consentTrial.agreePrefix")}{" "}
                    <span className="font-semibold">₹{authAmount}</span>{" "}
                    {t("autopay.consentTrial.authorizedToday")}
                    {autopayConfig?.AUTH_REFUNDABLE ? ` ${t("autopay.consentTrial.refundedSuffix")}` : ""}{" "}
                    {t("autopay.consentTrial.toStartMy")}{" "}
                    <span className="font-semibold">
                      {t("autopay.consentTrial.trialDaysLabel", { days: autopayConfig.TRIAL_DAYS })}
                    </span>
                    {t("autopay.consentTrial.fromDay")}{" "}
                    <span className="font-semibold">
                      {Number(autopayConfig.TRIAL_DAYS) + 1}
                    </span>
                    {t("autopay.consentTrial.listSeparator")}{" "}
                    <span className="font-semibold">
                      {enrollmentData.selectedPayment?.currency || "INR"}{" "}
                      {getSelectedPaymentPrice(enrollmentData.selectedPayment)}
                    </span>{" "}
                    {t("autopay.consentTrial.willBeChargedCycle")}
                  </>
                ) : (
                  <>
                    {t("autopay.consentAutoRenew.agreePrefix")}{" "}
                    <span className="font-semibold">
                      {enrollmentData.selectedPayment?.currency || "INR"}{" "}
                      {getSelectedPaymentPrice(enrollmentData.selectedPayment)}
                    </span>{" "}
                    {t("autopay.consentAutoRenew.willBeChargedPeriod")}
                  </>
                )}
              </span>
            </label>
          )}
          <div className={isAutopay ? "mt-4" : undefined}>
            <ReviewStep
              courseData={{
                course: courseData.course,
                courseBanner: courseData.courseBanner,
              }}
              selectedPayment={enrollmentData.selectedPayment}
              paymentType={paymentType}
              package_session_id={
                inviteData?.package_session_to_payment_options[0]
                  ?.package_session_id
              }
              setReferRequest={updateReferRequest}
              refCode={ref || ""}
              onUnappliedCodeChange={setHasUnappliedReferral}
              onReferralApplied={handleReferralApplied}
              instituteId={instituteId}
              enrollInviteId={inviteData?.id || ""}
              userEmail={
                enrollmentData.registrationData?.email?.value as
                  | string
                  | undefined
              }
              onCouponChange={handleCouponChange}
              initialCouponCode={appliedCouponCode}
            />
          </div>
          </>
        );
      case 3: {
        const vendor = propVendor || getPaymentVendor(inviteData);
        const userDetails =
          paymentType === "CPO"
            ? { name: "", email: cpoUserEmail, contact: "" }
            : getUserDetails();
        const cpoPayAmount =
          cpoCustomAmount !== undefined ? cpoCustomAmount : cpoSelectedTotal;
        return (
          <PaymentInfoStep
            error={error}
            vendor={vendor}
            amount={
              paymentType === "CPO"
                ? cpoPayAmount
                : isAutopay && autopayConfig?.TRIAL_DAYS && trialAvailable
                  ? authAmount // free trial: only the mandate authorization is charged now
                  : Math.max(
                      0,
                      getSelectedPaymentPrice(enrollmentData.selectedPayment) -
                        (appliedCouponCode ? couponDiscount : 0),
                    )
            }
            currency={
              paymentType === "CPO"
                ? inviteData?.currency || "INR"
                : enrollmentData.selectedPayment?.currency
            }
            onEwayPaymentReady={setEwayEncryptedData}
            onEwayError={setError}
            onStripePaymentReady={(processor) => {
              setStripePaymentProcessor(() => processor);
            }}
            onRazorpayPaymentReady={setRazorpayPaymentData}
            onRazorpayError={setError}
            isProcessing={loading}
            userName={userDetails.name}
            userEmail={userDetails.email}
            userContact={userDetails.contact}
            courseName={
              courseData.course ||
              enrollmentData.selectedPayment?.name ||
              t("defaultCourseEnrollmentName", { course })
            }
            // Razorpay caps `description` at 255 chars, and courseData.description
            // is the invite's rich-text course description — routinely far longer,
            // which made checkout fail outright. Send the invite name instead: it
            // is short, identifies the purchase, and still gets capped downstream.
            courseDescription={
              inviteData?.name ||
              courseData.course ||
              enrollmentData.selectedPayment?.name ||
              t("defaultCourseEnrollmentDescription", { course })
            }
            razorpayRef={razorpayRef}
            cashfreePaymentSessionId={cashfreeSessionData?.paymentSessionId}
            cashfreeEnvironment={cashfreeSessionData?.environment}
            cashfreeReturnUrl={getCashfreeReturnUrl()}
            cashfreeOrderId={cashfreeSessionData?.orderId}
            cashfreeInitLoading={cashfreeInitLoading}
            cashfreeInstituteId={instituteId}
            onCashfreePayClick={() => setLoading(true)}
            onCashfreePayError={() => setLoading(false)}
          />
        );
      }
      case 4:
        return (
          <PaymentPendingStep
            paymentCompletionResponse={paymentCompletionResponse!}
            selectedPayment={enrollmentData.selectedPayment}
            orderId={orderId}
            setCurrentStep={setCurrentStep}
          />
        );
      case 5:
        return (
          <SuccessStep
            courseName={courseData.course}
            approvalRequired={
              inviteData?.package_session_to_payment_options[0]?.payment_option
                ?.require_approval || false
            }
            email={enrollmentData?.registrationData?.email?.value || ""}
            isAutoLoggingIn={isAutoLoggingIn}
            config={inviteConfig}
            amountDisplay={
              enrollmentData.selectedPayment
                ? `${getCurrencySymbol(
                    enrollmentData.selectedPayment.currency || ""
                  )}${
                    enrollmentData.selectedPayment.actual_price ??
                    enrollmentData.selectedPayment.amount ??
                    ""
                  }`
                : ""
            }
          />
        );
      default:
        return (
          <RegistrationStep
            courseData={courseData}
            inviteData={inviteData}
            instituteId={instituteId}
            onSubmit={onSubmit}
            form={form}
            collectBillingContact={collectBillingContact}
            billingContact={billingContact}
            onBillingContactChange={setBillingContact}
            billingContactFields={billingContactFields}
          />
        );
    }
  };

  useEffect(() => {
    if (instituteData) {
      setInstituteDetails(instituteData);
    }
  }, [instituteData, setInstituteDetails]);

  // Ensure branding is applied on invitation pages using public institute details
  useEffect(() => {
    const syncBranding = async () => {
      try {
        if (!instituteId || !instituteData) return;

        // Persist minimal institute context for branding utilities
        await Preferences.set({ key: "InstituteId", value: instituteId });

        // Map public details to the structure expected elsewhere
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

        // Merge-write so we don't clobber fields owned by other writers
        // (use-domain-routing, useSidebar). Lazy-imported so the change is
        // local to this file and doesn't reorganize the top-of-file imports.
        const { upsertInstituteDetails } = await import(
          "@/services/institute-settings-cache"
        );
        await upsertInstituteDetails(
          mappedDetails as unknown as Record<string, unknown>,
        );

        // Load the institute's role-based theme (page background) the same way
        // the logged-in path does — otherwise an admin-set background never
        // reaches the invite page (its --background stays the stylesheet
        // default). Runs before applyTabBranding; the ThemeProvider also
        // re-applies it whenever the brand color is (re)set.
        syncThemeRoleSettingsFromSettingJson(instituteData?.setting);
        applyInstituteBackground();
        applyInstituteFont();
        applyInstituteUiAxes();

        // Store learner branding subset used by applyTabBranding
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

        // Apply tab title, favicon, and font
        await applyTabBranding(document.title);
      } catch (e) {
        // best-effort; do not block invitation flow
        console.warn("[Invite] Branding sync failed", e);
      }
    };

    void syncBranding();
  }, [instituteId, instituteData]);

  // Load policy URLs from per-institute learner settings stored by domain resolution
  useEffect(() => {
    const loadPolicyLinks = async () => {
      try {
        if (!instituteId) return;
        const key = `LEARNER_${instituteId}`;
        const stored = await Preferences.get({ key });
        if (stored?.value) {
          const parsed = JSON.parse(stored.value);
          setPrivacyPolicyUrl(parsed?.privacyPolicyUrl || null);
          setTermsAndConditionUrl(parsed?.termsAndConditionUrl || null);
        }
      } catch {
        // ignore
      }
    };
    void loadPolicyLinks();
  }, [instituteId]);

  if (
    isLoading ||
    isInstituteLoading ||
    (loading && paymentType === "FREE") ||
    cpoEnrolling
  )
    return <DashboardLoader />;

  // Helper to extract YouTube video ID from URL
  const getYouTubeVideoId = (url: string): string | null => {
    if (!url) return null;
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };

  // Keep the header, course-info bar, and main body on one centered column so
  // the institute logo + plan title line up with the form below. Only widen to
  // the full grid when the step-0 course-info rail is actually shown.
  const isWideLayout = hasRightSectionContent && currentStep === 0;
  const pageContainerWidth = isWideLayout ? "max-w-6xl" : "max-w-2xl";

  return (
    // Canvas follows --background (white by default, institute-tinted when a
    // background role is set) instead of a hardcoded gray, so an admin-set
    // page background reaches the invite flow. The header/cards stay white.
    <div className="min-h-screen w-full bg-background">
      {/* Compact Header. White by default. When the invite opts into
          `blendHeaderWithBackground`, the header and the invite title below it
          instead take the page canvas token so logo → title → page read as one
          themed band and only the form cards stay white. It stays OPAQUE
          either way because it is sticky: a transparent sticky bar would let
          the white form scroll through underneath and break the band. */}
      <header
        className={cn(
          "sticky top-0 z-50",
          courseData.blendHeaderWithBackground
            ? "bg-background"
            : "bg-white border-b border-gray-200"
        )}
      >
        <div className={`${pageContainerWidth} mx-auto px-4 sm:px-6`}>
          <div className="flex items-center justify-between h-14">
            {/* Left: Institute Branding */}
            {courseData.includeInstituteLogo ? (
              <InstituteBrandingComponent
                branding={{
                  instituteId: instituteId || null,
                  instituteName:
                    inviteData?.sub_org?.name ??
                    instituteData?.institute_name ??
                    instituteData?.name ??
                    null,
                  instituteLogoFileId:
                    inviteData?.sub_org?.logo_file_id ??
                    instituteData?.institute_logo_file_id ??
                    null,
                  instituteThemeCode:
                    (instituteData?.institute_theme_code as string) ||
                    (instituteData?.theme as string) ||
                    null,
                  homeIconClickRoute: domainRouting.homeIconClickRoute ?? null,
                  // Honour the institute's own setting, as the login page does.
                  // An institute whose logo already contains its name doesn't
                  // want it spelled out beside the mark.
                  hideInstituteName: domainRouting.hideInstituteName,
                  // Same institute_domain_routing sizing the sidebar and login
                  // page use — without these the mark falls back to the generic
                  // `size` classes and ignores the tenant's configured box.
                  logoWidthPx: domainRouting.logoWidthPx,
                  logoHeightPx: domainRouting.logoHeightPx,
                }}
                size="large"
                showName={true}
                className="!flex-row !items-center !gap-2"
              />
            ) : (
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-primary" />
                <span className="font-medium text-sm text-gray-900 truncate max-w-reg-200">
                  {inviteData?.name || courseData.course || t("defaultCourseEnrollmentName", { course })}
                </span>
              </div>
            )}

            {/* Step count badge - minimal, right-aligned */}
            <div className="text-xs text-gray-400 sm:hidden">
              {paymentType !== "FREE"
                ? t("stepBadge.ofThree", { step: Math.min(currentStep + 1, 3) })
                : t("stepBadge.ofTwo", { step: currentStep === 0 ? 1 : 2 })}
            </div>
          </div>
        </div>
      </header>

      {/* Compact Course Info Bar — the invite name. Follows the header's
          surface (see above): white band by default, page canvas when blended. */}
      {currentStep === 0 && (
        <div
          className={
            courseData.blendHeaderWithBackground
              ? "bg-background"
              : "bg-white border-b border-gray-100"
          }
        >
          <div className={`${pageContainerWidth} mx-auto px-4 sm:px-6 py-4`}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              {/* Course Thumbnail */}
              {courseData.courseBanner && (
                <div className="w-full sm:w-48 rounded-md overflow-hidden flex-shrink-0">
                  <img
                    src={courseData.courseBanner}
                    alt={courseData.course}
                    className="w-full h-auto object-cover"
                  />
                </div>
              )}

              {/* Course Title & Info */}
              <div className="flex-1 min-w-0">
                <h1 className="text-lg sm:text-xl font-semibold text-gray-900 truncate">
                  {inviteData?.name || courseData.course}
                </h1>
                {courseData.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                    {courseData.description.replace(/<[^>]*>/g, "")}
                  </p>
                )}
                {courseData.tags && courseData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {courseData.tags.map((tag, i) => (
                      <span
                        key={i}
                        className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Price Badge - Show only if not FREE */}
              {paymentType === "CPO" && (
                <div className="flex-shrink-0">
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 text-sm font-medium rounded-full">
                    {t("badges.installmentPlan")}
                  </span>
                </div>
              )}
              {paymentType !== "FREE" &&
                paymentType !== "CPO" &&
                enrollmentData.selectedPayment && (
                  <div className="flex-shrink-0 text-end">
                    <div className="text-lg font-semibold text-gray-900">
                      {enrollmentData.selectedPayment.currency?.toUpperCase()}{" "}
                      {getSelectedPaymentPrice(enrollmentData.selectedPayment)}
                    </div>
                    {enrollmentData.selectedPayment.duration && (
                      <div className="text-xs text-gray-500">
                        {enrollmentData.selectedPayment.duration}
                      </div>
                    )}
                  </div>
                )}
              {paymentType === "FREE" && (
                <div className="flex-shrink-0">
                  <span className="px-3 py-1 bg-green-50 text-green-700 text-sm font-medium rounded-full">
                    {t("badges.free")}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className={`${pageContainerWidth} mx-auto px-4 sm:px-6 py-6`}>
        {/* Progress Steps - Centered above content */}
        {currentStep < 5 && (
          <div className="mb-6">
            {(() => {
              // Build the wizard pills. The Plan-selection step is only a real
              // user-facing step when there are >=2 payment plans to choose
              // between (and the flow isn't FREE). When the invite exposes a
              // single plan or is FREE, handleNext skips currentStep === 1
              // entirely — so we drop the pill instead of flashing it.
              const showPlanPill =
                paymentType !== "FREE" &&
                !(paymentType !== "DONATION" && hasSinglePlan);
              const finalLabel = paymentType === "FREE" ? t("wizardPills.confirm") : t("wizardPills.pay");

              type Pill = {
                label: string;
                // currentStep value at which this pill is "active" (highlighted)
                activeFrom: number;
                activeUntil: number;
                // currentStep value at which this pill flips to ✓ (done)
                doneFrom: number;
              };
              const pills: Pill[] = [
                { label: t("wizardPills.details"), activeFrom: 0, activeUntil: 0, doneFrom: 1 },
              ];
              if (showPlanPill) {
                pills.push({
                  label: t("wizardPills.plan"),
                  activeFrom: 1,
                  activeUntil: 1,
                  doneFrom: 2,
                });
              }
              pills.push({
                label: finalLabel,
                activeFrom: 2,
                activeUntil: 4,
                // FREE flow exits to step 5 (success) immediately after confirm;
                // paid flow doesn't tick the final pill until success either.
                doneFrom: paymentType === "FREE" ? 3 : 5,
              });

              return (
                <div className="flex items-center justify-center gap-0">
                  {pills.map((pill, idx) => {
                    const isActive =
                      currentStep >= pill.activeFrom &&
                      currentStep <= pill.activeUntil;
                    const isDone = currentStep >= pill.doneFrom;
                    const showCheck = isDone;
                    const number = String(idx + 1);
                    const isLast = idx === pills.length - 1;
                    return (
                      <div key={pill.label} className="flex items-center">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold ${
                              isActive || isDone
                                ? "bg-primary text-white"
                                : "bg-gray-200 text-gray-500"
                            }`}
                          >
                            {showCheck ? "✓" : number}
                          </div>
                          <span
                            className={`text-xs sm:text-sm font-medium ${
                              isActive
                                ? "text-primary"
                                : isDone
                                  ? "text-gray-700"
                                  : "text-gray-400"
                            }`}
                          >
                            {pill.label}
                          </span>
                        </div>
                        {!isLast && (
                          <div
                            className={`w-8 sm:w-16 h-0.5 mx-1 sm:mx-2 ${
                              isDone ? "bg-primary" : "bg-gray-200"
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        <div
          className={`grid grid-cols-1 ${isWideLayout ? "lg:grid-cols-3" : ""} gap-6`}
        >
          {/* Main Form Area */}
          <div
            className={`${isWideLayout ? "lg:col-span-2 lg:sticky lg:top-20 lg:self-start" : "w-full"} space-y-4`}
          >
            {/* Step Content */}
            {renderCurrentStep()}

            {/* Course Structure Preview - Bundled Courses */}
            {currentStep === 0 &&
              isBundledInvite &&
              bundledPackageSessions.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h3 className="text-base font-medium text-gray-900 mb-3">
                    {t("bundledCourses.whatsIncluded")}
                  </h3>

                  {bundledPackageSessions.length > 1 ? (
                    <Tabs
                      value={
                        activePackageSessionId ??
                        bundledPackageSessions[0]?.packageSessionId
                      }
                      onValueChange={setActivePackageSessionId}
                    >
                      <TabsList className="grid w-full grid-cols-2 gap-2 h-auto bg-transparent p-0 mb-4 sm:grid-cols-3">
                        {bundledPackageSessions.map((session, index) => {
                          const label = resolvePackageSessionLabel(
                            session.packageSessionId,
                            index,
                          );
                          return (
                            <TabsTrigger
                              key={session.packageSessionId}
                              value={session.packageSessionId}
                              title={label}
                              className="h-auto w-full items-start justify-start whitespace-normal break-words rounded-md border border-gray-200 bg-white px-3 py-2 text-start text-xs font-medium leading-snug text-gray-600 transition-colors hover:border-gray-300 data-[state=active]:border-primary-500 data-[state=active]:bg-primary-50 data-[state=active]:text-primary-600 data-[state=active]:shadow-none"
                            >
                              <span className="line-clamp-2">{label}</span>
                            </TabsTrigger>
                          );
                        })}
                      </TabsList>

                      {bundledPackageSessions.map((session) => (
                        <TabsContent
                          key={session.packageSessionId}
                          value={session.packageSessionId}
                          className="focus-visible:outline-none focus-visible:ring-0 mt-0"
                        >
                          {activePackageSessionId === session.packageSessionId
                            ? (() => {
                                const sessionDetails = getBundleSessionDetails(
                                  session.packageSessionId,
                                );
                                const previewCourseId =
                                  sessionDetails?.package_dto?.id ?? "";
                                const previewLevelId =
                                  sessionDetails?.level?.id ?? undefined;

                                if (!previewCourseId) {
                                  return (
                                    <p className="text-sm text-gray-500 py-4 text-center">
                                      {t("bundledCourses.detailsLoading", { course })}
                                    </p>
                                  );
                                }

                                return (
                                  <CatalogCourseStructureDetails
                                    key={session.packageSessionId}
                                    courseDepth={5}
                                    courseId={previewCourseId}
                                    instituteId={instituteId ?? ""}
                                    packageSessionId={session.packageSessionId}
                                    levelId={previewLevelId}
                                  />
                                );
                              })()
                            : null}
                        </TabsContent>
                      ))}
                    </Tabs>
                  ) : (
                    (() => {
                      const singleSessionId =
                        bundledPackageSessions[0]?.packageSessionId ?? "";
                      if (!singleSessionId) return null;

                      const sessionDetails =
                        getBundleSessionDetails(singleSessionId);
                      const previewCourseId =
                        sessionDetails?.package_dto?.id ?? "";
                      const previewLevelId =
                        sessionDetails?.level?.id ?? undefined;

                      if (!previewCourseId) return null;

                      return (
                        <CatalogCourseStructureDetails
                          courseDepth={5}
                          courseId={previewCourseId}
                          instituteId={instituteId ?? ""}
                          packageSessionId={singleSessionId}
                          levelId={previewLevelId}
                        />
                      );
                    })()
                  )}
                </div>
              )}

            {/* YouTube Video - Compact */}
            {currentStep === 0 &&
              courseData.courseMedia &&
              courseData.courseMediaId?.type === "youtube" && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div
                    className="relative w-full"
                    style={{ paddingBottom: "56.25%" }}
                  >
                    <iframe
                      className="absolute top-0 start-0 w-full h-full"
                      src={`https://www.youtube.com/embed/${getYouTubeVideoId(courseData.courseMediaId.id)}`}
                      title={courseData.course}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </div>
              )}

            {/* Navigation Buttons */}
            {currentStep > 0 &&
              currentStep < 4 &&
              !(currentStep === 1 && paymentType === "FREE") && (
                <NavigationButtons
                  currentStep={currentStep}
                  selectedPayment={
                    paymentType === "CPO"
                      ? cpoSelectedSfpIds.length > 0 ||
                        (cpoCustomAmount !== undefined && cpoCustomAmount > 0)
                        ? ({
                            amount: cpoCustomAmount ?? cpoSelectedTotal,
                            currency: inviteData?.currency || "INR",
                          } as SelectedPayment)
                        : null
                      : enrollmentData.selectedPayment
                  }
                  onPrevious={handlePrevious}
                  onNext={handleNext}
                  onSubmitEnrollment={handleSubmitEnrollment}
                  autopayConsentPending={isAutopay && !autopayConsent}
                  loading={loading || cpoEnrolling}
                  paymentType={paymentType}
                  donationAmountValid={donationAmountValid}
                  paymentVendor={
                    currentStep === 3 ? getPaymentVendor(inviteData) : undefined
                  }
                  isPaymentDataReady={
                    currentStep === 3
                      ? getPaymentVendor(inviteData) === "EWAY"
                        ? !!ewayEncryptedData
                        : getPaymentVendor(inviteData) === "STRIPE"
                          ? !!stripePaymentProcessor
                          : getPaymentVendor(inviteData) === "RAZORPAY"
                            ? !!razorpayPaymentData
                            : false
                      : false
                  }
                  hasUnappliedReferral={hasUnappliedReferral}
                  hidePrimaryButton={
                    currentStep === 3 &&
                    getPaymentVendor(inviteData) === "CASHFREE" &&
                    !!cashfreeSessionData
                  }
                />
              )}
          </div>

          {/* Sidebar - Course Details */}
          {hasRightSectionContent && currentStep === 0 && (
            <div className="lg:col-span-1">
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <CourseInfoCard
                  courseData={{
                    ...courseData,
                    instituteLogo: "",
                    course: inviteData?.name || courseData.course,
                  }}
                  levelName={currentLevelName}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Links */}
        <div className="flex items-center justify-center gap-3 text-xs text-gray-400 mt-8 pt-6 border-t border-gray-100">
          <a
            href={privacyPolicyUrl || "/privacy-policy"}
            target={privacyPolicyUrl ? "_blank" : undefined}
            rel={privacyPolicyUrl ? "noopener noreferrer" : undefined}
            className="hover:text-gray-600"
          >
            {t("footer.privacyPolicy")}
          </a>
          <span>•</span>
          <a
            href={termsAndConditionUrl || "/terms-and-conditions"}
            target={termsAndConditionUrl ? "_blank" : undefined}
            rel={termsAndConditionUrl ? "noopener noreferrer" : undefined}
            className="hover:text-gray-600"
          >
            {t("footer.termsAndConditions")}
          </a>
        </div>
      </main>

      {/* Enrollment Policy Dialog */}
      <EnrollmentPolicyDialog
        open={enrollmentPolicyDialogOpen}
        onOpenChange={setEnrollmentPolicyDialogOpen}
        dialogType={enrollmentPolicyDialogType}
        policyResponse={enrollmentPolicyResponse}
        serverMessage={enrollmentPolicyServerMessage}
        loginUrl={learnerLoginUrl}
        courseName={courseData.course || inviteData?.name || t("defaultThisCourse", { course })}
        onContinue={() => {
          // Navigate to dashboard after dialog is closed
          window.location.href = `${BASE_URL_LEARNER_DASHBOARD}/study-library/courses`;
        }}
        onUpgrade={handleUpgrade}
      />
    </div>
  );
};

export default EnrollByInvite;
