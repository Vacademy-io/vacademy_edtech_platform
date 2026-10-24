import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { InsituteCustomField } from "../-services/custom-fields-setup";
import i18n from "@/i18n";

interface CourseMedia {
  type: string; // e.g., 'video', 'image', etc.
  id: string;
}

interface PaymentPlansInterface {
  value: number;
  unit: string;
  price: string;
  features: string[];
  title: string;
  newFeature: string;
}

export interface CourseDetailsJsonDataForInviteLink {
  course: string;
  description: string;
  learningOutcome: string;
  aboutCourse: string;
  targetAudience: string;
  coursePreview: string;
  courseBanner: string;
  courseMedia: CourseMedia;
  coursePreviewBlob: string;
  courseBannerBlob: string;
  courseMediaBlob: string;
  tags: string[];
  showRelatedCourses: boolean;
  includeInstituteLogo: boolean;
  blendHeaderWithBackground: boolean;
  includePaymentPlans: boolean;
  instituteLogoFileId: string;
  restrictToSameBatch: boolean;
  customHtml: string;
}

interface ConvertedCustomField {
  id: string;
  field_name: string;
  field_key: string;
  field_order: number;
  comma_separated_options: string;
  config: string;
  status: string;
  is_mandatory: boolean;
  field_type: string;
  created_at: string;
  updated_at: string;
}

interface CustomField {
  guestId: string | null;
  id: string;
  fieldKey: string;
  fieldName: string;
  fieldType: string; // e.g., 'textfield', 'dropdown', etc.
  defaultValue: string;
  config: string;
  formOrder: number;
  isMandatory: boolean;
  isFilter: boolean;
  isSortable: boolean;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  sessionId: string;
  liveSessionId: string | null;
  customFieldValue: string | null;
}

interface EnrollInviteData {
  id: string;
  institute_id: string;
  type: string; // e.g., 'ENROLL_INVITE'
  type_id: string;
  // Per-form field order on the mapping row (institute_custom_fields.individual_order).
  // This is the order the admin sets for THIS invite; the nested master formOrder is
  // shared across every form and must not drive per-form ordering.
  individual_order?: number | null;
  custom_field: CustomField;
}

export interface PackageSessionData {
  package_session_id: string;
  id: string;
  payment_option: PaymentOption;
  enroll_invite_id: string | null;
  status: string | null;
}

export interface PaymentOption {
  id: string;
  name: string;
  status: string;
  source: string;
  source_id: string;
  tag: string | null;
  type: string;
  require_approval: boolean;
  payment_plans: PaymentPlan[];
  payment_option_metadata_json: string; // You can also parse this into PaymentOptionMetadata if needed
  complex_payment_option_id?: string | null;
}

export interface PaymentPlan {
  id: string;
  name: string;
  status: string;
  validity_in_days: number;
  actual_price: number;
  elevated_price: number;
  currency: string;
  description: string;
  tag: string;
  feature_json: string; // raw stringified array, can be parsed to string[]
  referral_option: {
    id: string;
    referee_discount_json: string;
  };
  referral_option_smapping_status: string | null;
}

export const safeJsonParse = (
  jsonString: string | null | undefined,
  defaultValue: unknown = null
) => {
  if (!jsonString) return defaultValue;
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn("Failed to parse JSON:", jsonString, error);
    return defaultValue;
  }
};

export const transformApiDataToCourseDataForInvite = async (
  apiData: CourseDetailsJsonDataForInviteLink
) => {
  // Local cache for fileId -> publicUrl
  const fileUrlCache: Record<string, string> = {};

  async function getUrlOnce(
    fileId: string | null | undefined
  ): Promise<string> {
    if (!fileId) return "";
    // Check if ID looks like a JSON object (garbage data check)
    if (fileId.trim().startsWith("{") || fileId.trim().startsWith("["))
      return "";

    try {
      if (fileUrlCache[fileId] !== undefined) return fileUrlCache[fileId] ?? "";
      const url = (await getPublicUrlWithoutLogin(fileId)) ?? "";
      fileUrlCache[fileId] = url;
      return url;
    } catch (e) {
      console.warn(`[Helper] Failed to fetch URL for fileId: ${fileId}`, e);
      return "";
    }
  }

  try {
    const courseMediaPreview =
      apiData.courseMedia?.type === "youtube"
        ? apiData.courseMedia.id
        : await getUrlOnce(apiData.courseMedia?.id);

    const coursePreviewImageMediaPreview = await getUrlOnce(
      apiData.coursePreview
    );
    const courseBannerMediaPreview = await getUrlOnce(apiData.courseBanner);
    const instituteLogo = await getUrlOnce(apiData.instituteLogoFileId);

    return {
      aboutCourse: apiData.aboutCourse,
      course: apiData.course,
      courseBanner: courseBannerMediaPreview,
      courseMediaId: {
        type: apiData.courseMedia?.type || "",
        id: apiData.courseMedia?.id || "",
      },
      courseMediaPreview: courseMediaPreview ?? "",
      coursePreview: coursePreviewImageMediaPreview,
      customHtml: apiData.customHtml,
      description: apiData.description,
      includeInstituteLogo: apiData.includeInstituteLogo,
      blendHeaderWithBackground: apiData.blendHeaderWithBackground,
      includePaymentPlans: apiData.includePaymentPlans,
      learningOutcome: apiData.learningOutcome,
      restrictToSameBatch: apiData.restrictToSameBatch,
      showRelatedCourses: apiData.showRelatedCourses,
      tags: apiData?.tags ?? [],
      targetAudience: apiData?.targetAudience ?? "",
      instituteLogo: instituteLogo || "",
    };
  } catch (error) {
    console.error("Error getting public URLs:", error);
    return null;
  }
};

export function convertInviteCustomFields(
  data: EnrollInviteData[]
): ConvertedCustomField[] {
  return data?.map((item) => {
    const field = item.custom_field;
    return {
      id: field.id,
      field_name: field.fieldName,
      field_key: field.fieldKey,
      // Prefer the per-form mapping order (individual_order); fall back to the shared
      // master formOrder only when the mapping order is null. `??` (not `||`) so order 0
      // is respected. Mirrors the audience-response form fix.
      field_order: item.individual_order ?? field.formOrder,
      comma_separated_options:
        field.fieldType === "dropdown"
          ? (() => {
            try {
              const parsed = JSON.parse(field.config);
              if (Array.isArray(parsed)) {
                return parsed.map((opt: any) => opt.value).join(",");
              }
              return field.config;
            } catch {
              return field.config;
            }
          })()
          : "",
      config: field.config || "{}",
      status: "ACTIVE",
      is_mandatory: field.isMandatory,
      field_type: field.fieldType,
      created_at: field.createdAt,
      updated_at: field.updatedAt,
    };
  });
}

export const isSystemRequiedCustomFeilds = (field: InsituteCustomField) => {
  const name = (field.field_name || "").toLocaleLowerCase();
  // Exclude explicit "username" fields since they contain "name" substring
  if (name.includes("username")) return false;
  return (
    name.includes("email") || name.includes("name") || name.includes("phone")
  );
};

export function convertInstituteCustomFields(
  data: InsituteCustomField[]
): ConvertedCustomField[] {
  // Filter to only include system required fields (email, name, phone).
  // NOTE: deliberately no client-side dedup here — duplicate/clean fields are
  // controlled in the data (institute custom fields), not the frontend.
  const filteredFields = data?.filter((field) =>
    isSystemRequiedCustomFeilds(field)
  );

  return filteredFields?.map((field, idx) => {
    return {
      id: field.custom_field_id,
      field_name: field.field_name,
      field_key: field.field_key,
      field_order: field.form_order ?? idx + 1,
      comma_separated_options:
        field.comma_separated_options || field.config || "",
      config: field.config || "{}",
      status: field.status || "ACTIVE",
      is_mandatory: field.is_mandatory ?? false,
      field_type: field.field_type,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}

export function convertPlansToPaymentOptions(rawPlans: PackageSessionData) {
  const paymentOption = rawPlans.payment_option;
  const unit = JSON.parse(paymentOption.payment_option_metadata_json)?.unit;
  return paymentOption?.payment_plans?.map((plan) => {
    let features: string[];

    try {
      const parsed = JSON.parse(plan.feature_json);
      features = Array.isArray(parsed) && parsed.length > 0 ? parsed : []; // fallback
    } catch {
      features = []; // fallback
    }

    return {
      id: plan.id,
      name: plan.name,
      amount: plan.actual_price,
      currency: plan.currency,
      description: plan.description,
      duration:
        unit === "days"
          ? i18n.t("enrollmentB:planDuration.days", { count: plan.validity_in_days })
          : i18n.t("enrollmentB:planDuration.months", { count: Math.floor(plan.validity_in_days / 30) }),
      features,
    };
  });
}

export function getDefaultPlanFromPaymentsData(item: PaymentOption) {
  // Safe parse — CPO options may have empty or minimal metadata JSON
  let parsedData: Record<string, unknown> = {};
  try {
    parsedData = JSON.parse(item.payment_option_metadata_json || "{}") || {};
  } catch {
    parsedData = {};
  }

  if (item.type === "CPO") {
    return {
      id: item.id,
      name: item.name,
      description: i18n.t("enrollmentB:planDescriptions.payInInstallments"),
      currency: (parsedData?.currency as string) || "INR",
      type: item.type,
      complex_payment_option_id: item.complex_payment_option_id,
      payment_options: item.payment_plans,
    };
  }

  if (item.type === "donation") {
    return {
      id: item.id,
      name: item.name,
      description: i18n.t("enrollmentB:planDescriptions.donationPlan"),
      suggestedAmount:
        parsedData?.donationData?.suggestedAmounts
          ?.split(",")
          ?.map((x: string) => Number(x.trim())) || [],
      minAmount: Number(parsedData?.donationData?.minimumAmount) || 0,
      currency: parsedData?.currency || "",
      type: item.type,
    };
  } else if (
    item.type === "free" ||
    item.type === "FREE" ||
    item.type === "Free"
  ) {
    return {
      id: item.id,
      name: item.name,
      description: i18n.t("enrollmentB:planDescriptions.freePlan"),
      days: parsedData?.freeData?.validityDays || 0,
      type: item.type,
    };
  } else if (item.type === "ONE_TIME") {
    return {
      id: item.id,
      name: item.name,
      description: i18n.t("enrollmentB:planDescriptions.oneTimePlan"),
      price: parsedData?.upfrontData?.fullPrice || "",
      currency: parsedData?.currency || "",
      type: item.type,
      payment_options: item.payment_plans,
      discount_json: parsedData?.upfrontData?.planDiscounts.upfront,
      options_metadata: parsedData?.upfrontData,
    };
  } else {
    const subData = parsedData?.subscriptionData as Record<string, unknown> | undefined;
    return {
      id: item.id,
      name: item.name,
      description: i18n.t("enrollmentB:planDescriptions.subscriptionPlan"),
      currency: (parsedData?.currency as string) || "",
      type: item.type,
      payment_options: item.payment_plans,
      discount_json: subData?.planDiscounts,
      options_metadata:
        ((subData?.customIntervals as PaymentPlansInterface[] | undefined) || []).map(
          (interval: PaymentPlansInterface) => {
            return {
              value: interval.value || 0,
              unit: interval.unit || "",
              price: interval.price || "",
              features: interval.features || [],
              title: interval.title || "",
              newFeature: interval.newFeature || "",
            };
          }
        ) || [],
    };
  }
}
