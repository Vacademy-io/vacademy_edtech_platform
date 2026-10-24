import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getCurrencySymbol } from "./payment-selection-step";
import { SelectedPayment } from "./types";
import { ReferralCodeComponent, ReferralBenefit } from "./apply-referral";
import { useCouponsEnabled } from "@/components/common/coupon/use-coupons-enabled";
import { useCheckoutCoupon } from "@/components/common/coupon/use-checkout-coupon";
import { CouponInput } from "@/components/common/coupon/CouponInput";
import { useEffect, useState } from "react";
import { safeJsonParse } from "../-utils/helper";
import { ReferRequest } from "../-services/enroll-invite-services";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
interface ReviewStepProps {
  courseData: {
    course: string;
    courseBanner?: string;
  };
  selectedPayment: SelectedPayment | null;
  paymentType?: string;
  package_session_id: string;
  setReferRequest: (referRequest: ReferRequest | null) => void;
  refCode: string | null;
  onUnappliedCodeChange?: (hasUnappliedCode: boolean) => void;
  onReferralApplied?: () => void;
  // Discount-coupon plumbing (§6). Required only to surface the coupon input;
  // payload wiring lives in enroll-form.tsx via onCouponChange.
  instituteId: string;
  enrollInviteId: string;
  userEmail?: string;
  onCouponChange?: (appliedCode: string | null, discount: number) => void;
  // Restored from the parent on remount so the discount survives a
  // Review → Pay → Back round-trip. PaidPlanReview re-runs validate once
  // the plan is loaded.
  initialCouponCode?: string | null;
}

const ReviewStep = ({
  courseData,
  selectedPayment,
  paymentType,
  package_session_id,
  setReferRequest,
  refCode,
  onUnappliedCodeChange,
  onReferralApplied,
  instituteId,
  enrollInviteId,
  userEmail,
  onCouponChange,
  initialCouponCode,
}: ReviewStepProps) => {
  const { t } = useTranslation("enrollmentA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  return (
    <div className="space-y-6">
      {/* Order Summary Card */}
      <Card className="shadow-lg">
        <CardContent className="p-5 sm:p-card-lg space-y-4">
          <div className="flex items-start gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-green-100 rounded-lg flex-shrink-0">
              <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" />
            </div>
            <div>
              <h2 className="text-title-lg font-semibold text-gray-900 leading-tight">
                {t("reviewStep.orderSummary")}
              </h2>
              <p className="text-caption text-muted-foreground mt-1">
                {t("reviewStep.reviewOrder")}
              </p>
            </div>
          </div>

          <div className="space-y-0">
            {/* Course Banner and Name */}
            <div className="flex flex-col items-center gap-4 pb-5">
              {courseData.courseBanner && (
                <div className="rounded-lg relative h-32 sm:h-56 lg:h-72 w-full overflow-hidden">
                  <img
                    src={courseData.courseBanner}
                    alt={t("reviewStep.courseBannerAlt", { course })}
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

              <div className="text-subtitle font-medium">
                <span>{courseData.course}</span>
              </div>
            </div>

            <Separator />
            {paymentType === "ONE_TIME" || paymentType === "SUBSCRIPTION" ? (
              <PaidPlanReview
                plan={selectedPayment}
                package_session_id={package_session_id}
                setReferRequest={setReferRequest}
                refCode={refCode}
                onUnappliedCodeChange={onUnappliedCodeChange}
                onReferralApplied={onReferralApplied}
                instituteId={instituteId}
                enrollInviteId={enrollInviteId}
                userEmail={userEmail}
                onCouponChange={onCouponChange}
                initialCouponCode={initialCouponCode}
              />
            ) : (
              <FreePlanReview
                plan={selectedPayment}
                package_session_id={package_session_id}
                setReferRequest={setReferRequest}
                refCode={refCode}
                onUnappliedCodeChange={onUnappliedCodeChange}
                onReferralApplied={onReferralApplied}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ReviewStep;

// Helper functions for referral benefits
const getReferralDiscountAmount = (
  benefit: ReferralBenefit,
  basePrice: number
): number => {
  if (!benefit) return 0;

  switch (benefit.benefitType) {
    case "PERCENTAGE_DISCOUNT": {
      const discountAmount =
        (basePrice * benefit.benefitValue.percentage) / 100;
      const maxDiscount = benefit.benefitValue.applyMaximumDiscountAmount
        ? benefit.benefitValue.maxDiscountAmount
        : basePrice;
      return Math.min(discountAmount, maxDiscount);
    }
    case "FLAT_DISCOUNT": {
      return benefit.benefitValue.amount;
    }
    default:
      return 0;
  }
};

const isPricingBenefit = (benefit: ReferralBenefit): boolean => {
  return (
    benefit?.benefitType === "PERCENTAGE_DISCOUNT" ||
    benefit?.benefitType === "FLAT_DISCOUNT"
  );
};

const formatNonPricingBenefits = (
  benefit: ReferralBenefit,
  t: TFunction,
  course: string
): string | null => {
  if (!benefit) return null;

  switch (benefit.benefitType) {
    case "FREE_MEMBERSHIP_DAYS":
      return t("reviewStep.benefits.freeMembershipDays", {
        days: benefit.benefitValue.days,
      });
    case "CONTENT": {
      const deliveryText = formatDeliveryMediums(
        benefit.benefitValue.deliveryMediums,
        t
      );
      return t("reviewStep.benefits.bonusContent", { deliveryText, course });
    }
    case "POINTS":
      return t("reviewStep.benefits.rewardPoints", {
        points: benefit.benefitValue.points,
        course,
      });
    default:
      console.log("Unknown benefit type:", benefit.benefitType);
      return null;
  }
};

// Helper function to format delivery mediums
const formatDeliveryMediums = (mediums: string[], t: TFunction) => {
  if (!mediums || mediums.length === 0) return "";

  const formattedMediums = mediums.map((medium) => {
    switch (medium.toUpperCase()) {
      case "EMAIL":
        return t("reviewStep.benefits.mediumEmail");
      case "WHATSAPP":
        return t("reviewStep.benefits.mediumWhatsapp");
      default:
        return medium.toLowerCase();
    }
  });

  if (formattedMediums.length === 1) {
    return t("reviewStep.benefits.onOneMedium", { medium: formattedMediums[0] });
  } else if (formattedMediums.length === 2) {
    return t("reviewStep.benefits.onTwoMediums", {
      medium1: formattedMediums[0],
      medium2: formattedMediums[1],
    });
  }
};

const PaidPlanReview = ({
  plan,
  package_session_id,
  setReferRequest,
  refCode,
  onUnappliedCodeChange,
  onReferralApplied,
  instituteId,
  enrollInviteId,
  userEmail,
  onCouponChange,
  initialCouponCode,
}: {
  plan: SelectedPayment | null;
  package_session_id: string;
  setReferRequest: (referRequest: ReferRequest | null) => void;
  refCode: string | null;
  onUnappliedCodeChange?: (hasUnappliedCode: boolean) => void;
  onReferralApplied?: () => void;
  instituteId: string;
  enrollInviteId: string;
  userEmail?: string;
  onCouponChange?: (appliedCode: string | null, discount: number) => void;
  initialCouponCode?: string | null;
}) => {
  const { t } = useTranslation("enrollmentA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const [couponVerified, setCouponVerified] = useState(false);
  const couponsEnabled = useCouponsEnabled();
  const couponCtx = useCheckoutCoupon({
    buildRequest: (code) => {
      // Mirror the pricing-display fallback chain (actual_price → amount → 0).
      // Some SelectedPayment construction paths only set `amount`, not
      // `actual_price`; without the fallback the validate call sends
      // total_amount=0 and the BE percentage discount comes back as 0.
      const totalAmount =
        typeof plan?.actual_price === "number"
          ? plan.actual_price
          : typeof plan?.amount === "number"
          ? plan.amount
          : 0;
      return {
        couponCode: code,
        instituteId,
        enrollInviteId,
        packageSessionId: package_session_id || null,
        paymentPlanId: plan?.id ?? null,
        userEmail: userEmail || null,
        totalAmount,
      };
    },
  });
  // Bubble the applied code + discount up so enroll-form can both include
  // the code in the payload AND subtract the discount from the gateway
  // amount. Without the discount the BE records the coupon but the gateway
  // charges the full price.
  useEffect(() => {
    onCouponChange?.(
      couponCtx.state.appliedCode,
      couponCtx.state.appliedCode ? couponCtx.state.discount : 0
    );
  }, [couponCtx.state.appliedCode, couponCtx.state.discount, onCouponChange]);

  // Restore a previously-applied coupon after a Review → Pay → Back round-trip.
  // The parent persists the code; we re-run validate once the plan is loaded
  // so the discount and IDs are re-derived. Guarded so we don't loop on
  // failures (e.g. coupon expired since the original apply).
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  useEffect(() => {
    if (restoreAttempted) return;
    if (!initialCouponCode) return;
    if (!plan) return; // wait until the price source exists
    if (couponCtx.state.appliedCode || couponCtx.state.isApplying) return;
    setRestoreAttempted(true);
    couponCtx.setCode(initialCouponCode);
    void couponCtx.apply(initialCouponCode);
  }, [initialCouponCode, plan, couponCtx, restoreAttempted]);

  // If the restore validate fails (coupon got expired / exhausted / scope
  // changed since we last saw it), drop it from the parent so the enroll
  // payload doesn't carry a stale code that the BE would also reject.
  useEffect(() => {
    if (!restoreAttempted) return;
    if (!initialCouponCode) return;
    if (couponCtx.state.isApplying) return;
    if (couponCtx.state.appliedCode) return; // restore succeeded
    if (!couponCtx.state.error) return; // hasn't resolved yet
    onCouponChange?.(null, 0);
  }, [
    restoreAttempted,
    initialCouponCode,
    couponCtx.state.isApplying,
    couponCtx.state.appliedCode,
    couponCtx.state.error,
    onCouponChange,
  ]);

  if (!plan) return null;

  const formatValidity = (validityInDays: number) => {
    if (validityInDays === 365) {
      return t("reviewStep.pricing.months", { count: 12 });
    } else if (validityInDays % 30 === 0 && validityInDays >= 30) {
      const months = validityInDays / 30;
      return t("reviewStep.pricing.months", { count: months });
    } else {
      return t("reviewStep.pricing.days", { count: validityInDays });
    }
  };

  const hasDiscount =
    plan.elevated_price &&
    plan.actual_price &&
    plan.elevated_price > plan.actual_price;
  const discountAmount = hasDiscount
    ? plan.elevated_price - plan.actual_price
    : 0;

  // Check if referral option is available
  const hasReferralOption =
    plan.referral_option && plan.referral_option !== null;

  // Parse the referral benefit from the nested tier structure
  const getReferralBenefit = (): ReferralBenefit | null => {
    if (!plan.referral_option?.referee_discount_json) return null;

    const parsed = safeJsonParse(
      plan.referral_option.referee_discount_json,
      null
    );

    if (
      !parsed ||
      !parsed.tiers ||
      !Array.isArray(parsed.tiers) ||
      parsed.tiers.length === 0
    ) {
      console.log("No valid tiers found");
      return null;
    }

    const firstTier = parsed.tiers[0];

    if (
      !firstTier.benefits ||
      !Array.isArray(firstTier.benefits) ||
      firstTier.benefits.length === 0
    ) {
      console.log("No valid benefits found");
      return null;
    }

    const benefit = firstTier.benefits[0];

    // Map the API format to our internal format
    const mappedBenefit = {
      benefitType: benefit.type,
      benefitValue: benefit.value,
      description: benefit.description,
    };

    return mappedBenefit;
  };

  const refereeDiscount: ReferralBenefit | null = getReferralBenefit();

  return (
    <div className="py-4 space-y-4">
      {/* Plan Details Section */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-stack">
        <h3 className="text-subtitle font-semibold text-gray-900">
          {t("reviewStep.planDetails")}
        </h3>

        <div className="flex flex-col gap-4">
          <div className="flex justify-between">
            <span className="text-gray-600">{t("reviewStep.plan")}</span>
            <div className="font-medium text-gray-900">{plan.name}</div>
          </div>

          {plan.validity_in_days != null && (
            <div className="flex justify-between">
              <span className="text-gray-600">{t("reviewStep.validity")}</span>
              <div className="font-medium text-gray-900">
                {formatValidity(plan.validity_in_days)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Referral Code Section - Only show if referral option is available */}
      {hasReferralOption && (
        <ReferralCodeComponent
          referralOptionId={plan.referral_option.id}
          setCouponVerified={setCouponVerified}
          package_session_id={package_session_id || ""}
          setReferRequest={setReferRequest}
          refCode={refCode}
          onUnappliedCodeChange={onUnappliedCodeChange}
          onReferralApplied={onReferralApplied}
        />
      )}

      {/* Discount Coupon Section — sibling to Referral. Gated by the
          institute-level toggle (admin Settings → Coupons). */}
      {couponsEnabled && (
        <CouponInput
          state={couponCtx.state}
          onChange={couponCtx.setCode}
          onApply={couponCtx.apply}
          onClear={couponCtx.clear}
          currencySymbol={getCurrencySymbol(plan.currency || "")}
        />
      )}

      {/* Pricing Section */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-subtitle font-semibold text-gray-900 mb-3">{t("reviewStep.pricing.title")}</h3>

        <div className="space-y-2">
          {hasDiscount && (
            <div className="flex justify-between items-center">
              <span className="text-gray-600">{t("reviewStep.pricing.price")}</span>
              <span className="line-through text-gray-500">
                {getCurrencySymbol(plan.currency || "")}
                {plan.elevated_price?.toFixed(2)}
              </span>
            </div>
          )}

          {hasDiscount && (
            <div className="flex justify-between items-center">
              <span className="text-gray-600">{t("reviewStep.pricing.discount")}</span>
              <span className="text-green-600 font-medium">
                -{getCurrencySymbol(plan.currency || "")}
                {discountAmount.toFixed(2)}
              </span>
            </div>
          )}

          {/* Referral/Coupon Discount - Only show if coupon is verified and it's a pricing benefit */}
          {couponVerified &&
            refereeDiscount &&
            isPricingBenefit(refereeDiscount) && (
              <div className="flex justify-between items-center">
                <span className="text-gray-600">{t("reviewStep.pricing.referralDiscount")}</span>
                <span className="text-green-600 font-medium">
                  -{getCurrencySymbol(plan.currency || "")}
                  {getReferralDiscountAmount(
                    refereeDiscount,
                    plan.actual_price
                  ).toFixed(2)}
                  {refereeDiscount.benefitType === "PERCENTAGE_DISCOUNT" &&
                    t("reviewStep.pricing.percentageSuffix", {
                      percentage: refereeDiscount.benefitValue.percentage,
                    })}
                </span>
              </div>
            )}

          {/* Discount Coupon line — appears when learner has applied a coupon
              in the section above. The discount value comes from the BE's
              validate response (CouponDiscountUtil math). */}
          {couponCtx.state.appliedCode && couponCtx.state.discount > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-gray-600">
                {t("reviewStep.pricing.couponLabel", { code: couponCtx.state.appliedCode })}
              </span>
              <span className="text-green-600 font-medium">
                -{getCurrencySymbol(plan.currency || "")}
                {couponCtx.state.discount.toFixed(2)}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center border-t pt-2">
            <span className="text-gray-600">{t("reviewStep.pricing.totalPrice")}</span>
            <span className="font-bold text-subtitle text-primary-600">
              {getCurrencySymbol(plan.currency || "")}
              {(() => {
                let finalPrice =
                  typeof plan.actual_price === "number"
                    ? plan.actual_price
                    : typeof plan.amount === "number"
                    ? plan.amount
                    : 0;

                // Apply referral discount if coupon is verified and it's a pricing benefit
                if (
                  couponVerified &&
                  refereeDiscount &&
                  isPricingBenefit(refereeDiscount)
                ) {
                  const discountAmount = getReferralDiscountAmount(
                    refereeDiscount,
                    finalPrice
                  );
                  finalPrice = finalPrice - discountAmount;
                }

                // Subtract applied coupon discount (BE-validated value).
                if (couponCtx.state.appliedCode) {
                  finalPrice = finalPrice - couponCtx.state.discount;
                }

                return Math.max(0, finalPrice).toFixed(2);
              })()}
            </span>
          </div>
        </div>

        {/* Currency note */}
        {plan.currency && (
          <p className="text-xs text-gray-400 mt-3 text-end">
            {t("reviewStep.pricing.allPricesIn", { currency: plan.currency.toUpperCase() })}
          </p>
        )}
      </div>

      {/* Additional Benefits Section - Only show if coupon is verified and there are non-pricing benefits */}
      {couponVerified &&
        refereeDiscount &&
        !isPricingBenefit(refereeDiscount) && (
          <div className="bg-green-50 rounded-lg p-4 space-y-stack">
            <h3 className="text-subtitle font-semibold text-gray-900">
              {t("reviewStep.referralBenefits")}
            </h3>

            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-900 font-medium">
                  {formatNonPricingBenefits(refereeDiscount, t, course)}
                </span>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

const FreePlanReview = ({
  plan,
  package_session_id,
  setReferRequest,
  refCode,
  onUnappliedCodeChange,
  onReferralApplied,
}: {
  plan: SelectedPayment | null;
  package_session_id: string;
  setReferRequest: (referRequest: ReferRequest | null) => void;
  refCode: string | null;
  onUnappliedCodeChange?: (hasUnappliedCode: boolean) => void;
  onReferralApplied?: () => void;
}) => {
  const { t } = useTranslation("enrollmentA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const [couponVerified, setCouponVerified] = useState(false);
  if (!plan) return null;

  // Check if referral option is available
  const hasReferralOption =
    plan.referral_option && plan.referral_option !== null;

  // Parse the referral benefit from the nested tier structure
  const getReferralBenefit = (): ReferralBenefit | null => {
    if (!plan.referral_option?.referee_discount_json) return null;

    const parsed = safeJsonParse(
      plan.referral_option.referee_discount_json,
      null
    );

    if (
      !parsed ||
      !parsed.tiers ||
      !Array.isArray(parsed.tiers) ||
      parsed.tiers.length === 0
    ) {
      console.error("No valid tiers found");
      return null;
    }

    const firstTier = parsed.tiers[0];

    if (
      !firstTier.benefits ||
      !Array.isArray(firstTier.benefits) ||
      firstTier.benefits.length === 0
    ) {
      console.error("No valid benefits found");
      return null;
    }

    const benefit = firstTier.benefits[0];

    // Map the API format to our internal format
    const mappedBenefit = {
      benefitType: benefit.type,
      benefitValue: benefit.value,
      description: benefit.description,
    };

    return mappedBenefit;
  };

  const refereeDiscount: ReferralBenefit | null = getReferralBenefit();
  return (
    <div className="py-4 space-y-4">
      {/* Plan Details Section */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-stack">
        <h3 className="font-semibold text-gray-900 text-lg">
          {t("reviewStep.planDetails")}
        </h3>

        <div className="flex flex-col gap-4">
          <div className="flex justify-between">
            <span className="text-gray-600">{t("reviewStep.plan")}</span>
            <div className="font-medium text-gray-900">{plan.name}</div>
          </div>

          {plan.validity_in_days != null && (
            <div className="flex justify-between">
              <span className="text-gray-600">{t("reviewStep.validity")}</span>
              <div className="font-medium text-gray-900">
                {plan.duration || t("reviewStep.pricing.days", { count: plan.validity_in_days })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Referral Code Section - Only show if referral option is available */}
      {hasReferralOption && (
        <ReferralCodeComponent
          referralOptionId={plan.referral_option.id}
          setCouponVerified={setCouponVerified}
          package_session_id={package_session_id || ""}
          setReferRequest={setReferRequest}
          refCode={refCode}
          onUnappliedCodeChange={onUnappliedCodeChange}
          onReferralApplied={onReferralApplied}
        />
      )}

      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="font-semibold text-gray-900 mb-3 text-lg">{t("reviewStep.pricing.title")}</h3>

        <div className="space-y-2">
          <div className="flex justify-between items-center border-t pt-2">
            <span className="text-gray-600">{t("reviewStep.pricing.totalPrice")}</span>
            {plan.amount === 0 ? (
              <span className="font-bold text-lg text-primary-600">{t("reviewStep.pricing.free")}</span>
            ) : (
              <span className="font-bold text-lg text-primary-600">
                {getCurrencySymbol(plan.currency || "")}
                {plan.amount}
              </span>
            )}
          </div>
        </div>

        {/* Currency note */}
        {plan.currency && plan.amount !== 0 && (
          <p className="text-xs text-gray-400 mt-3 text-end">
            {t("reviewStep.pricing.allPricesIn", { currency: plan.currency.toUpperCase() })}
          </p>
        )}
      </div>

      {/* Additional Benefits Section - Only show if coupon is verified and there are non-pricing benefits */}
      {couponVerified &&
        refereeDiscount &&
        !isPricingBenefit(refereeDiscount) && (
          <div className="bg-green-50 rounded-lg p-4 space-y-stack">
            <h3 className="font-semibold text-gray-900 text-lg">
              {t("reviewStep.referralBenefits")}
            </h3>

            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-gray-900 font-medium">
                  {formatNonPricingBenefits(refereeDiscount, t, course)}
                </span>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};
