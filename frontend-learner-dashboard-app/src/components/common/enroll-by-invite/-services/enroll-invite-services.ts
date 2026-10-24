import { isBlankPhone } from "@/lib/phone-validation";
import {
  BASE_URL,
  ENROLL_OPEN_STUDENT_URL,
  ENROLL_USER_INVITE_PAYMENT_URL,
  GET_PAYMENT_GATEWAY_DETAILS_URL,
  PEYMENT_LOG_STATUS_URL,
  ENROLLMENT_FORM_SUBMIT,
  ENROLLMENT_POLICY_URL,
  CPO_OPEN_DUES_URL,
  CPO_OPEN_PAY_INSTALLMENTS_URL,
  CPO_OPEN_SCHEDULE_URL,
  CPO_ENROLL_WITHOUT_PAYMENT_URL,
} from "@/constants/urls";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";
import axios from "axios";
import {
  FieldRenderType,
  getFieldRenderType,
} from "../-utils/custom-field-helpers";
import { format } from "date-fns";

export const getEnrollInviteData = async ({
  instituteId,
  inviteCode,
}: {
  instituteId: string;
  inviteCode: string;
}) => {
  const response = await axios({
    method: "GET",
    url: ENROLL_OPEN_STUDENT_URL,
    params: {
      instituteId,
      inviteCode,
    },
  });
  return response?.data;
};

export const handleGetEnrollInviteData = ({
  instituteId,
  inviteCode,
}: {
  instituteId: string;
  inviteCode: string;
}) => {
  return {
    queryKey: ["GET_ENROLL_INVITE_DETAILS", instituteId, inviteCode],
    queryFn: () => getEnrollInviteData({ instituteId, inviteCode }),
    staleTime: 60 * 60 * 1000,
  };
};

export const getKeyData = async (instituteId: string, vendor: string) => {
  const response = await axios({
    method: "GET",
    url: GET_PAYMENT_GATEWAY_DETAILS_URL,
    params: {
      instituteId,
      vendor,
    },
  });
  return response?.data;
};

export const handlePaymentGatewaykeys = (
  instituteId: string,
  vendor: string
) => {
  return {
    queryKey: ["GET_PAYMENT_GATEWAY_KEYS", instituteId, vendor],
    queryFn: () => getKeyData(instituteId, vendor),
    staleTime: 60 * 60 * 1000,
  };
};

export interface ReferRequest {
  referrer_user_id: string;
  referral_code: string;
  referral_option_id: string;
}

interface RegistrationFieldValue {
  id: string;
  name: string;
  value: string;
  is_mandatory: boolean;
  type: string;
  render_type?: FieldRenderType;
  comma_separated_options?: string[];
}

type RegistrationDataType = Record<string, RegistrationFieldValue>;

interface EnrollLearnerForPaymentProps {
  registrationData: RegistrationDataType;
  // eslint-disable-next-line
  enrollmentData: any;
  paymentMethodId?: string;
  instituteId: string;
  enrollInviteId: string;
  payment_option_id: string;
  package_session_ids: string[];
  allowLearnersToCreateCourses: boolean;
  referRequest: {
    referrer_user_id: string;
    referral_code: string;
    referral_option_id: string;
  } | null;
  /**
   * Discount coupon code the learner entered at checkout. BE re-validates via
   * CouponValidationService + atomically decrements usage_limit at UserPlan
   * creation (see backend V308 / V309). Null/blank = no coupon.
   */
  couponCode?: string | null;
  /**
   * Discount value (in plan currency) computed by the validate endpoint. We
   * subtract this from the selected plan's price to derive the amount the
   * gateway actually charges. The BE separately re-validates and decrements,
   * so the FE-supplied number is only used for the gateway charge — not for
   * the BE-recorded discount. Default 0 = full price.
   */
  couponDiscount?: number;
  /**
   * Autopay mandate authorization method. A recurring order is bound to one method,
   * so the learner picks before the order is created. "card" (default) | "upi".
   */
  mandateMethod?: string;
  returnUrl?: string;
  // Eway-specific payment data
  ewayPaymentData?: {
    encryptedNumber: string;
    encryptedCVN: string;
    cardData: {
      name: string;
      expiryMonth: string;
      expiryYear: string;
    };
  };
  // Razorpay-specific payment data
  razorpayPaymentData?: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  };
  // Payment vendor (STRIPE, EWAY, RAZORPAY, CASHFREE, or PHONEPE)
  paymentVendor?: "STRIPE" | "EWAY" | "RAZORPAY" | "CASHFREE" | "PHONEPE";
  // PhonePe redirect (return) URL — where PhonePe sends the learner back after
  // the hosted checkout. The backend stamps orderId + instituteId onto it.
  phonePeRedirectUrl?: string;
  // Flag to indicate if using institute custom fields (don't exclude from custom_field_values)
  isUsingInstituteCustomFields?: boolean;
  // Optional User ID from form-submit step
  userId?: string;
  // Optional billing contact details captured when the invite enabled the
  // "Collect Billing Contact Details" toggle and the learner ticked "Add a
  // separate billing contact" on the registration step.
  billingContact?: {
    hasSeparate: boolean;
    name: string;
    email: string;
    role: string;
  };
}

/**
 * Helper function to dynamically find email field from registration data
 * Searches by FieldRenderType.EMAIL instead of hardcoded key
 */
const getEmailField = (registrationData: RegistrationDataType): string => {
  const emailEntry = Object.entries(registrationData).find(([key, value]) => {
    const renderType =
      value.render_type || getFieldRenderType(key, value.type || "text");
    return renderType === FieldRenderType.EMAIL;
  });
  return emailEntry ? emailEntry[1].value : "";
};

/**
 * Helper function to dynamically find phone field from registration data
 * Searches by FieldRenderType.PHONE instead of hardcoded key
 */
const getPhoneField = (registrationData: RegistrationDataType): string => {
  const phoneEntry = Object.entries(registrationData).find(([key, value]) => {
    const renderType =
      value.render_type || getFieldRenderType(key, value.type || "text");
    return renderType === FieldRenderType.PHONE;
  });
  const value = phoneEntry ? phoneEntry[1].value : "";
  // A form may leave its phone field optional, and the phone widget keeps the selected
  // country's dial code in the box — so a skipped field reads back as "+91". Storing that as
  // the learner's mobile number, or handing it to a payment gateway as their contact, is worse
  // than storing nothing.
  return isBlankPhone(value) ? "" : value;
};

/**
 * Helper function to dynamically find full name from registration data
 * Tries to find a single full_name field first, then combines first_name + last_name
 * Uses keyword matching instead of hardcoded keys
 */
export const getFullNameField = (registrationData: RegistrationDataType): string => {
  // First, try to find a single full name field (e.g., "full_name", "Full Name")
  const fullNameEntry = Object.entries(registrationData).find(([key]) => {
    const lowerKey = key.toLowerCase();
    return (
      lowerKey.includes("full") &&
      (lowerKey.includes("name") || lowerKey.includes("_name"))
    );
  });

  if (fullNameEntry && !isNullOrEmptyOrUndefined(fullNameEntry[1].value)) {
    return fullNameEntry[1].value;
  }

  // Try to find a simple "name" field (common in institute custom fields)
  const nameEntry = Object.entries(registrationData).find(([key, value]) => {
    const lowerKey = key.toLowerCase();
    const lowerName = (value.name || "").toLowerCase();

    // Check both field key and field name for "name"
    const keyMatches =
      lowerKey === "name" ||
      lowerKey === "full_name" ||
      lowerKey === "fullname";

    const nameMatches =
      lowerName === "name" ||
      lowerName === "full name" ||
      lowerName.includes("name");

    // Exclude email, phone, username, first_name, last_name
    const shouldExclude =
      lowerKey.includes("email") ||
      lowerKey.includes("phone") ||
      lowerKey.includes("first") ||
      lowerKey.includes("last") ||
      lowerKey.includes("user") ||
      lowerName.includes("email") ||
      lowerName.includes("phone") ||
      lowerName.includes("first") ||
      lowerName.includes("last") ||
      lowerName.includes("user");

    return (keyMatches || nameMatches) && !shouldExclude;
  });

  if (nameEntry && !isNullOrEmptyOrUndefined(nameEntry[1].value)) {
    return nameEntry[1].value;
  }

  // If no full name field, try to combine first name + last name
  const firstNameEntry = Object.entries(registrationData).find(([key]) => {
    const lowerKey = key.toLowerCase();
    return lowerKey.includes("first") && lowerKey.includes("name");
  });

  const lastNameEntry = Object.entries(registrationData).find(([key]) => {
    const lowerKey = key.toLowerCase();
    return lowerKey.includes("last") && lowerKey.includes("name");
  });

  const firstName = firstNameEntry ? firstNameEntry[1].value || "" : "";
  const lastName = lastNameEntry ? lastNameEntry[1].value || "" : "";

  const combinedName = `${firstName} ${lastName}`.trim();

  return combinedName;
};

/**
 * Helper function to find password field from registration data
 * Used for storing credentials before Cashfree redirect (login after payment)
 */
export const getPasswordField = (
  registrationData: RegistrationDataType
): string => {
  const passwordEntry = Object.entries(registrationData).find(([key, value]) => {
    const lowerKey = key.toLowerCase();
    const lowerName = (value.name || "").toLowerCase();
    return (
      lowerKey.includes("password") ||
      lowerName.includes("password")
    );
  });
  return passwordEntry ? String(passwordEntry[1]?.value || "") : "";
};

/**
 * Helper function to get keys that should be excluded from custom field values
 * Dynamically identifies email, phone, and name fields
 */
const getKeysToExclude = (registrationData: RegistrationDataType): string[] => {
  const keysToExclude: string[] = [];

  Object.entries(registrationData).forEach(([key, value]) => {
    const lowerKey = key.toLowerCase();
    const renderType =
      value.render_type || getFieldRenderType(key, value.type || "text");

    // Exclude email fields
    if (renderType === FieldRenderType.EMAIL) {
      keysToExclude.push(key);
    }

    // Exclude phone fields
    if (renderType === FieldRenderType.PHONE) {
      keysToExclude.push(key);
    }

    // Exclude name-related fields
    if (
      (lowerKey.includes("name") &&
        (lowerKey.includes("full") ||
          lowerKey.includes("first") ||
          lowerKey.includes("last"))) ||
      lowerKey === "name"
    ) {
      keysToExclude.push(key);
    }
  });

  return keysToExclude;
};

/**
 * Helper to extract learner extra details from registration data
 */
const getLearnerExtraDetails = (registrationData: RegistrationDataType) => {
  const getKey = (searchTerms: string[]) => {
    const entry = Object.entries(registrationData).find(([key]) => {
      const lowerKey = key.toLowerCase();
      return searchTerms.some((term) => lowerKey.includes(term));
    });
    return entry ? entry[1].value : "";
  };

  return {
    fathers_name: getKey(["father_name", "fathers_name", "father name"]),
    mothers_name: getKey(["mother_name", "mothers_name", "mother name"]),
    parents_mobile_number: getKey(["parent_mobile", "parent_phone"]),
    parents_email: getKey(["parent_email"]),
    parents_to_mother_mobile_number: "", // Less common, leave empty
    parents_to_mother_email: "",
    linked_institute_name: "",
  };
};

export const submitEnrollmentForm = async ({
  registrationData,
  instituteId,
  enrollInviteId,
  package_session_ids,
  isUsingInstituteCustomFields = false,
}: {
  registrationData: RegistrationDataType;
  instituteId: string;
  enrollInviteId: string;
  package_session_ids: string[];
  isUsingInstituteCustomFields?: boolean;
}) => {
  // Extract user details
  const email = getEmailField(registrationData);
  const phoneNumber = getPhoneField(registrationData);
  const fullName = getFullNameField(registrationData);
  const extraDetails = getLearnerExtraDetails(registrationData);

  // Identify keys to exclude from custom fields
  const keysToExclude = isUsingInstituteCustomFields
    ? []
    : getKeysToExclude(registrationData);

  // Filter custom fields
  const customFieldValues = Object.entries(registrationData)
    .filter(([key]) => !keysToExclude.includes(key))
    .map(([, field]) => ({
      custom_field_id: field.id,
      value: field.value,
    }));

  const payload = {
    enroll_invite_id: enrollInviteId,
    institute_id: instituteId,
    package_session_ids: package_session_ids,
    user_details: {
      email: email,
      username: email, // Use email as username by default
      mobile_number: phoneNumber,
      full_name: fullName,
      address_line: "",
      region: "",
      city: "",
      pin_code: "",
      date_of_birth: format(new Date(), "yyyy-MM-dd"), // Default to current date if not found
      gender: "",
    },
    learner_extra_details: extraDetails,
    custom_field_values: customFieldValues,
  };

  const response = await axios({
    method: "POST",
    url: ENROLLMENT_FORM_SUBMIT,
    data: payload,
  });

  return response?.data;
};

export const handleEnrollLearnerForPayment = async ({
  registrationData,
  enrollmentData,
  paymentMethodId,
  instituteId,
  enrollInviteId,
  payment_option_id,
  package_session_ids,
  allowLearnersToCreateCourses,
  referRequest,
  returnUrl,
  ewayPaymentData,
  razorpayPaymentData,
  paymentVendor = "STRIPE",
  phonePeRedirectUrl,
  isUsingInstituteCustomFields = false,
  userId,
  couponCode,
  couponDiscount = 0,
  mandateMethod,
  billingContact,
}: EnrollLearnerForPaymentProps) => {
  // Dynamically extract email, phone, full name, and password using helper functions
  const email = getEmailField(registrationData);
  const phoneNumber = getPhoneField(registrationData);
  const fullName = getFullNameField(registrationData);
  const password = getPasswordField(registrationData);

  // Dynamically identify keys to exclude from custom field values
  // If using institute custom fields, don't exclude name, email, phone
  const keysToExclude = isUsingInstituteCustomFields
    ? []
    : getKeysToExclude(registrationData);
  // Prepare payment request based on vendor
  const stripe_request =
    paymentVendor === "STRIPE"
      ? {
        payment_method_id: paymentMethodId,
        card_last4: null,
        customer_id: null,
        return_url: returnUrl || "",
      }
      : {};

  const eway_request =
    paymentVendor === "EWAY" && ewayPaymentData
      ? {
        customer_id: null,
        card_name: ewayPaymentData.cardData.name,
        expiry_month: ewayPaymentData.cardData.expiryMonth,
        expiry_year: ewayPaymentData.cardData.expiryYear,
        card_number: ewayPaymentData.encryptedNumber, // Already has "eCrypted:" prefix
        cvn: ewayPaymentData.encryptedCVN, // Already has "eCrypted:" prefix
        country_code: "au",
      }
      : {};

  // For Razorpay: First call sends empty request to create order,
  // Second call (after payment) includes payment_id, order_id, signature
  const razorpay_request =
    paymentVendor === "RAZORPAY"
      ? razorpayPaymentData
        ? {
          customer_id: null,
          contact: phoneNumber,
          email: email,
          razorpay_payment_id: razorpayPaymentData.razorpay_payment_id,
          razorpay_order_id: razorpayPaymentData.razorpay_order_id,
          razorpay_signature: razorpayPaymentData.razorpay_signature,
        }
        : {
          customer_id: null,
          contact: phoneNumber,
          email: email,
          // Only meaningful for autopay orders; the backend ignores it otherwise.
          ...(mandateMethod ? { mandate_method: mandateMethod } : {}),
        }
      : {};

  // For Cashfree: Creates enrollment with payment pending; return_url is set when calling user-plan-payment
  const cashfree_request =
    paymentVendor === "CASHFREE"
      ? {
        return_url: "", // Set by frontend when calling user-plan-payment API
      }
      : {};

  // For PhonePe: redirect (Standard Checkout) flow. redirect_url is where PhonePe
  // sends the learner back; the backend stamps orderId + instituteId onto it.
  const phonepe_request =
    paymentVendor === "PHONEPE"
      ? {
        contact: phoneNumber,
        email: email,
        redirect_url: phonePeRedirectUrl || "",
      }
      : {};

  const convertedData = {
    user: {
      email: email,
      full_name: fullName,
      address_line: "",
      city: "",
      region: "",
      pin_code: "",
      mobile_number: phoneNumber,
      date_of_birth: "",
      gender: "",
      password: password || "",
      profile_pic_file_id: "",
      roles: allowLearnersToCreateCourses
        ? ["STUDENT", "TEACHER"]
        : ["STUDENT"],
      root_user: true,
      ...(userId ? { id: userId } : {}),
    },
    institute_id: instituteId,
    subject_id: "",
    vendor_id: paymentVendor,
    learner_package_session_enroll: {
      package_session_ids: package_session_ids,
      plan_id: enrollmentData.selectedPayment.id,
      payment_option_id: payment_option_id,
      enroll_invite_id: enrollInviteId,
      refer_request: referRequest,
      // Backend re-validates this and runs the atomic decrement inside the
      // UserPlan-creation transaction. Null = no coupon applied.
      coupon_code: couponCode || null,
      payment_initiation_request: {
        vendor: paymentVendor,
        // Mirror the pricing-display fallback chain (actual_price → amount → 0)
        // — some SelectedPayment construction paths only populate one field.
        // Then subtract the validated coupon discount so the gateway charges
        // what the learner agreed to pay. Floored at 0 to prevent negatives.
        amount: Math.max(
          0,
          (typeof enrollmentData.selectedPayment.actual_price === "number"
            ? enrollmentData.selectedPayment.actual_price
            : typeof enrollmentData.selectedPayment.amount === "number"
            ? enrollmentData.selectedPayment.amount
            : 0) - (couponCode ? couponDiscount : 0)
        ),
        currency:
          paymentVendor === "EWAY"
            ? "aud"
            : enrollmentData.selectedPayment.currency,
        description: "",
        charge_automatically: true,
        institute_id: instituteId,
        stripe_request,
        razorpay_request,
        cashfree_request,
        phonepe_request,
        pay_pal_request: {},
        eway_request,
        include_pending_items: true,
      },
      custom_field_values: Object.entries(registrationData)
        .filter(([key]) => !keysToExclude.includes(key))
        .map(([, field]) => ({
          custom_field_id: field.id,
          source_type: null,
          source_id: null,
          type: "ENROLL_INVITE",
          type_id: enrollInviteId,
          value: field.value,
        })),
    },
    ...(billingContact?.hasSeparate &&
    (billingContact.name || billingContact.email || billingContact.role)
      ? {
          learner_extra_details: {
            billing_contact_name: billingContact.name || null,
            billing_contact_email: billingContact.email || null,
            billing_contact_role: billingContact.role || null,
          },
        }
      : {}),
  };

  const response = await axios({
    method: "POST",
    url: ENROLL_USER_INVITE_PAYMENT_URL,
    data: convertedData,
  });
  return response?.data;
};

export const getPaymentCompletionStatus = async ({
  paymentLogId,
}: {
  paymentLogId: string;
}) => {
  const response = await axios({
    method: "GET",
    url: PEYMENT_LOG_STATUS_URL,
    params: {
      paymentLogId,
    },
  });
  return response?.data;
};

export const handleGetPaymentCompletionStatus = ({
  paymentLogId,
}: {
  paymentLogId: string;
}) => {
  return {
    queryKey: ["GET_PAYMENT_COMPLETION_STATUS", paymentLogId],
    queryFn: () => getPaymentCompletionStatus({ paymentLogId }),
    staleTime: 60 * 60 * 1000,
  };
};

// Enrollment Policy API 

export const getEnrollmentPolicy = async ({
  packageSessionId,
}: {
  packageSessionId: string;
}) => {
  const response = await axios({
    method: "GET",
    url: `${ENROLLMENT_POLICY_URL}/${packageSessionId}`,
  });
  return response?.data;
};

export const getPublicInstituteDetails = async ({
  instituteId,
}: {
  instituteId: string;
}) => {
  const response = await axios({
    method: "GET",
    url: `${BASE_URL}/admin-core-service/public/institute/v1/details-non-batches/${instituteId}`,
  });
  return response?.data;
};

export const handleGetPublicInstituteDetails = ({
  instituteId,
}: {
  instituteId: string;
}) => {
  return {
    queryKey: ["GET_PUBLIC_INSTITUTE_DETAILS", instituteId],
    queryFn: () => getPublicInstituteDetails({ instituteId }),
    staleTime: 60 * 60 * 1000,
    enabled: !!instituteId,
  };
};

/**
 * Same institute payload as getPublicInstituteDetails but hits `/details/{id}`
 * (includeBatches=true) instead of `/details-non-batches/{id}` — so the response
 * actually carries `batches_for_sessions`. The enroll form uses the lighter
 * non-batches endpoint for branding/settings, which means bundled "What's
 * Included" courses can't resolve their names from it (batches come back empty).
 * Pass the HOST institute id (the invite's instituteId) — the bundled package
 * sessions belong to it, even for "Sub-Org Subscription" invites where the
 * sub-org is only a branding label backed by an empty institute shell.
 */
export const getPublicInstituteDetailsWithBatches = async ({
  instituteId,
}: {
  instituteId: string;
}) => {
  const response = await axios({
    method: "GET",
    url: `${BASE_URL}/admin-core-service/public/institute/v1/details/${instituteId}`,
  });
  return response?.data;
};

export const handleGetPublicInstituteDetailsWithBatches = ({
  instituteId,
  enabled = true,
}: {
  instituteId: string;
  enabled?: boolean;
}) => {
  return {
    queryKey: ["GET_PUBLIC_INSTITUTE_DETAILS_WITH_BATCHES", instituteId],
    queryFn: () => getPublicInstituteDetailsWithBatches({ instituteId }),
    staleTime: 60 * 60 * 1000,
    enabled: enabled && !!instituteId,
  };
};

// ─── CPO (Complex Payment Option) open enrollment helpers ────────────────────

export interface CpoInstallmentDue {
  id: string;
  user_id: string;
  user_plan_id: string;
  cpo_id: string;
  cpo_name: string;
  fee_type_name: string;
  fee_type_code: string;
  fee_type_description: string;
  amount_expected: number;
  adjustment_amount: number;
  adjustment_reason: string;
  adjustment_type: string;
  adjustment_status: string;
  amount_paid: number;
  due_date: string | null;
  status: string;
  amount_due: number;
  is_overdue: boolean;
  days_overdue: number | null;
}

/**
 * Enroll the learner via CPO invite WITHOUT initiating payment.
 * Creates the user + UserPlan + StudentFeePayment rows, returns userId + userPlanId.
 * Called as the first step in the CPO flow before showing the installment selection UI.
 */
export const enrollCpoWithoutPayment = async ({
  registrationData,
  instituteId,
  enrollInviteId,
  paymentOptionId,
  packageSessionIds,
  allowLearnersToCreateCourses,
  isUsingInstituteCustomFields = false,
}: {
  registrationData: RegistrationDataType;
  instituteId: string;
  enrollInviteId: string;
  paymentOptionId: string;
  packageSessionIds: string[];
  allowLearnersToCreateCourses: boolean;
  isUsingInstituteCustomFields?: boolean;
}): Promise<{ userId: string; userPlanId: string; userEmail: string; userPassword: string }> => {
  const email = getEmailField(registrationData);
  const phoneNumber = getPhoneField(registrationData);
  const fullName = getFullNameField(registrationData);
  const password = getPasswordField(registrationData);
  const keysToExclude = isUsingInstituteCustomFields ? [] : getKeysToExclude(registrationData);

  const payload = {
    user: {
      email,
      full_name: fullName,
      address_line: "",
      city: "",
      region: "",
      pin_code: "",
      mobile_number: phoneNumber,
      date_of_birth: "",
      gender: "",
      password: password || "",
      profile_pic_file_id: "",
      roles: allowLearnersToCreateCourses ? ["STUDENT", "TEACHER"] : ["STUDENT"],
      root_user: true,
    },
    institute_id: instituteId,
    subject_id: "",
    vendor_id: "STRIPE",
    learner_package_session_enroll: {
      package_session_ids: packageSessionIds,
      plan_id: null,
      payment_option_id: paymentOptionId,
      enroll_invite_id: enrollInviteId,
      refer_request: null,
      // No payment_initiation_request → backend creates UserPlan (ACTIVE) + SFP rows without charging
      custom_field_values: Object.entries(registrationData)
        .filter(([key]) => !keysToExclude.includes(key))
        .map(([, field]) => ({
          custom_field_id: field.id,
          source_type: null,
          source_id: null,
          type: "ENROLL_INVITE",
          type_id: enrollInviteId,
          value: field.value,
        })),
    },
  };

  const response = await axios({ method: "POST", url: CPO_ENROLL_WITHOUT_PAYMENT_URL, data: payload });
  const data = response?.data;
  return {
    userId: data?.user?.id || "",
    userPlanId: data?.user_plan_id || "",
    userEmail: data?.user?.email || email,
    userPassword: data?.user?.password || password,
  };
};

/**
 * Enroll a CPO learner WITH payment in a single call (same endpoint as regular enrollment).
 * Backend creates User + UserPlan + SFP rows + initiates gateway payment atomically.
 * Use this instead of the two-step enroll-then-pay dance.
 */
export const enrollCpoLearnerForPaymentViaInvite = async ({
  registrationData,
  cpoAmount,
  currency,
  instituteId,
  enrollInviteId,
  paymentOptionId,
  packageSessionIds,
  allowLearnersToCreateCourses,
  razorpayPaymentData,
  paymentVendor = "RAZORPAY",
  isUsingInstituteCustomFields = false,
}: {
  registrationData: RegistrationDataType;
  cpoAmount: number;
  currency: string;
  instituteId: string;
  enrollInviteId: string;
  paymentOptionId: string;
  packageSessionIds: string[];
  allowLearnersToCreateCourses: boolean;
  razorpayPaymentData?: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string } | null;
  paymentVendor?: "RAZORPAY" | "STRIPE" | "EWAY" | "CASHFREE";
  isUsingInstituteCustomFields?: boolean;
}) => {
  const email = getEmailField(registrationData);
  const phoneNumber = getPhoneField(registrationData);
  const fullName = getFullNameField(registrationData);
  const password = getPasswordField(registrationData);
  const keysToExclude = isUsingInstituteCustomFields ? [] : getKeysToExclude(registrationData);

  const razorpay_request =
    paymentVendor === "RAZORPAY"
      ? razorpayPaymentData
        ? { customer_id: null, contact: phoneNumber, email, razorpay_payment_id: razorpayPaymentData.razorpay_payment_id, razorpay_order_id: razorpayPaymentData.razorpay_order_id, razorpay_signature: razorpayPaymentData.razorpay_signature }
        : { customer_id: null, contact: phoneNumber, email }
      : {};

  const payload = {
    user: {
      email, full_name: fullName, address_line: "", city: "", region: "", pin_code: "",
      mobile_number: phoneNumber, date_of_birth: "", gender: "",
      password: password || "", profile_pic_file_id: "",
      roles: allowLearnersToCreateCourses ? ["STUDENT", "TEACHER"] : ["STUDENT"],
      root_user: true,
    },
    institute_id: instituteId,
    subject_id: "",
    vendor_id: paymentVendor,
    learner_package_session_enroll: {
      package_session_ids: packageSessionIds,
      plan_id: null,
      payment_option_id: paymentOptionId,
      enroll_invite_id: enrollInviteId,
      refer_request: null,
      payment_initiation_request: {
        vendor: paymentVendor,
        amount: cpoAmount,
        currency,
        description: "",
        charge_automatically: true,
        institute_id: instituteId,
        stripe_request: {},
        razorpay_request,
        cashfree_request: {},
        pay_pal_request: {},
        eway_request: {},
        include_pending_items: true,
      },
      custom_field_values: Object.entries(registrationData)
        .filter(([key]) => !keysToExclude.includes(key))
        .map(([, field]) => ({
          custom_field_id: field.id,
          source_type: null,
          source_id: null,
          type: "ENROLL_INVITE",
          type_id: enrollInviteId,
          value: field.value,
        })),
    },
  };

  const response = await axios({ method: "POST", url: ENROLL_USER_INVITE_PAYMENT_URL, data: payload });
  return response?.data;
};

/** Fetch CPO installment dues for a user plan (open, no JWT required). */
export const fetchCpoDues = async ({
  userId,
  userPlanId,
}: {
  userId: string;
  userPlanId: string;
}): Promise<CpoInstallmentDue[]> => {
  const response = await axios({
    method: "GET",
    url: CPO_OPEN_DUES_URL,
    params: { userId, userPlanId },
  });
  return response?.data || [];
};

export interface CpoPayInstallmentsRequest {
  userId: string;
  userPlanId: string;
  instituteId: string;
  studentFeePaymentIds: string[];
  customAmount?: number;
  paymentVendor?: "STRIPE" | "EWAY" | "RAZORPAY" | "CASHFREE";
  currency?: string;
  email?: string;
  name?: string;
  // gateway-specific
  paymentMethodId?: string;
  razorpayPaymentData?: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
  ewayPaymentData?: { encryptedNumber: string; encryptedCVN: string; cardData: { name: string; expiryMonth: string; expiryYear: string } };
}

/** Pay selected CPO installments via gateway (open, no JWT required). */
export const payCpoInstallments = async (req: CpoPayInstallmentsRequest) => {
  const vendor = req.paymentVendor || "STRIPE";

  const stripe_request = vendor === "STRIPE" ? { payment_method_id: req.paymentMethodId, card_last4: null, customer_id: null, return_url: "" } : {};
  const razorpay_request = vendor === "RAZORPAY"
    ? req.razorpayPaymentData
      ? { customer_id: null, email: req.email, razorpay_payment_id: req.razorpayPaymentData.razorpay_payment_id, razorpay_order_id: req.razorpayPaymentData.razorpay_order_id, razorpay_signature: req.razorpayPaymentData.razorpay_signature }
      : { customer_id: null, email: req.email }
    : {};
  const eway_request = vendor === "EWAY" && req.ewayPaymentData
    ? { customer_id: null, card_name: req.ewayPaymentData.cardData.name, expiry_month: req.ewayPaymentData.cardData.expiryMonth, expiry_year: req.ewayPaymentData.cardData.expiryYear, card_number: req.ewayPaymentData.encryptedNumber, cvn: req.ewayPaymentData.encryptedCVN, country_code: "au" }
    : {};

  const payload = {
    user_id: req.userId,
    user_plan_id: req.userPlanId,
    institute_id: req.instituteId,
    name: req.name || "",
    student_fee_payment_ids: req.studentFeePaymentIds,
    ...(req.customAmount !== undefined ? { custom_amount: req.customAmount } : {}),
    payment_initiation_request: {
      vendor,
      currency: req.currency || "INR",
      description: "",
      charge_automatically: true,
      institute_id: req.instituteId,
      email: req.email || "",
      stripe_request,
      razorpay_request,
      eway_request,
      cashfree_request: vendor === "CASHFREE" ? { return_url: "" } : {},
      pay_pal_request: {},
      include_pending_items: true,
    },
  };

  const response = await axios({ method: "POST", url: CPO_OPEN_PAY_INSTALLMENTS_URL, data: payload });
  return response?.data;
};

// ─── ComplexPaymentOptionDTO (CPO template schedule) ─────────────────────────

export interface AftInstallmentDTO {
  id: string;
  installment_number: number | null;
  amount: number;
  start_date: string | null;
  end_date: string | null;
  due_date: string | null;
  status: string | null;
}

export interface AssignedFeeValueDTO {
  id: string;
  amount: number;
  original_amount: number | null;
  discount_type: string | null;
  discount_value: number | null;
  no_of_installments: number | null;
  has_installment: boolean;
  is_refundable: boolean | null;
  has_penalty: boolean | null;
  penalty_percentage: number | null;
  status: string | null;
  installments: AftInstallmentDTO[];
}

export interface FeeTypeDTO {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: string | null;
  assigned_fee_value: AssignedFeeValueDTO | null;
}

export interface ComplexPaymentOptionDTO {
  id: string;
  name: string;
  institute_id: string;
  default_payment_option_id: string | null;
  status: string | null;
  fee_types: FeeTypeDTO[];
}

/**
 * Fetch the full CPO installment schedule for a PaymentOption (open, no JWT).
 * Used to show the installment template to the learner BEFORE enrollment.
 */
export const fetchCpoSchedule = async (paymentOptionId: string): Promise<ComplexPaymentOptionDTO> => {
  const response = await axios({
    method: "GET",
    url: CPO_OPEN_SCHEDULE_URL,
    params: { paymentOptionId },
  });
  return response?.data;
};

/**
 * Map a ComplexPaymentOptionDTO (template) to CpoInstallmentDue[] for display.
 * The IDs will be template installment IDs (not SFP IDs).
 */
export const mapCpoScheduleToDues = (cpo: ComplexPaymentOptionDTO): CpoInstallmentDue[] => {
  const today = new Date();
  const dues: CpoInstallmentDue[] = [];
  for (const feeType of cpo.fee_types ?? []) {
    const afv = feeType.assigned_fee_value;
    if (!afv) continue;
    const installments = afv.installments ?? [];
    if (installments.length === 0) {
      // Single lump-sum payment — represent as one installment
      const amount = afv.amount ?? 0;
      dues.push({
        id: afv.id,
        user_id: '',
        user_plan_id: '',
        cpo_id: cpo.id,
        cpo_name: cpo.name,
        fee_type_name: feeType.name,
        fee_type_code: feeType.code || '',
        fee_type_description: feeType.description || '',
        amount_expected: amount,
        adjustment_amount: 0,
        adjustment_reason: '',
        adjustment_type: '',
        adjustment_status: '',
        amount_paid: 0,
        due_date: null,
        status: 'PENDING',
        amount_due: amount,
        is_overdue: false,
        days_overdue: null,
      });
    } else {
      for (const inst of installments) {
        const amount = inst.amount ?? 0;
        const dueDate = inst.due_date ? new Date(inst.due_date) : null;
        const isOverdue = dueDate != null && dueDate < today;
        const daysOverdue = isOverdue && dueDate
          ? Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000)
          : null;
        dues.push({
          id: inst.id,
          user_id: '',
          user_plan_id: '',
          cpo_id: cpo.id,
          cpo_name: cpo.name,
          fee_type_name: feeType.name,
          fee_type_code: feeType.code || '',
          fee_type_description: feeType.description || '',
          amount_expected: amount,
          adjustment_amount: 0,
          adjustment_reason: '',
          adjustment_type: '',
          adjustment_status: '',
          amount_paid: 0,
          due_date: inst.due_date,
          status: inst.status || 'PENDING',
          amount_due: amount,
          is_overdue: isOverdue,
          days_overdue: daysOverdue,
        });
      }
    }
  }
  return dues;
};
