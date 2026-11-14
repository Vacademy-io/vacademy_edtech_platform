import { PaymentPlan } from "../-utils/helper";

export interface FinalCourseData {
  aboutCourse: string;
  course: string;
  courseBanner: string;
  courseMedia: string;
  courseMediaId: {
    type: string;
    id: string;
  };
  coursePreview: string;
  customHtml: string;
  description: string;
  includeInstituteLogo: boolean;
  /** Header + invite title sit on the page/theme background instead of white. */
  blendHeaderWithBackground: boolean;
  includePaymentPlans: boolean;
  instituteLogo: string;
  learningOutcome: string;
  restrictToSameBatch: boolean;
  showRelatedCourses: boolean;
  tags: string[];
  targetAudience: string;
}

export interface PaymentOption {
  id: string;
  name: string;
  amount: number;
  currency: string;
  description: string;
  duration: string;
  features: string[];
}

export interface PaymentInfo {
  cardholderName: string;
  cardNumber: string;
  expiryDate: string;
  cvv: string;
}

export type SelectedPayment = PaymentPlan & {
  type: string;
  amount?: number;
  duration?: string;
  /**
   * Set only by the auto-preselect paths (which used to store a pre-built
   * `duration` string). Formatted at render via formatPlanDuration.
   */
  plan_duration?: { validityInDays: number | null | undefined; unit?: string };
};

/**
 * Canonical price source for a SelectedPayment. `actual_price` is the field
 * populated on every construction path (helper.ts and the plan-section
 * spreads alike); `amount` is set only on some paths and historically caused
 * pricing/gateway mismatches when callers read one but not the other.
 *
 * Reading order: actual_price → amount → 0. Always returns a number so
 * callers can do math without nullish checks. Use this anywhere you'd
 * otherwise inline `selectedPayment?.actual_price ?? selectedPayment?.amount`.
 */
export const getSelectedPaymentPrice = (
  selectedPayment: SelectedPayment | null | undefined
): number => {
  if (!selectedPayment) return 0;
  if (typeof selectedPayment.actual_price === "number") {
    return selectedPayment.actual_price;
  }
  if (typeof selectedPayment.amount === "number") {
    return selectedPayment.amount;
  }
  return 0;
};

export interface EnrollmentData {
  registrationData: Record<
    string,
    {
      name: string;
      value: string;
      is_mandatory: boolean;
      type: string;
      comma_separated_options?: string[];
    }
  >;
  selectedPayment: SelectedPayment | null;
  paymentInfo: PaymentInfo;
}
