import { Check, Tag, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CheckoutCouponState } from "./use-checkout-coupon";

export interface CouponInputProps {
    state: CheckoutCouponState;
    onChange: (code: string) => void;
    onApply: () => void;
    onClear: () => void;
    currencySymbol?: string;
    /** Card background colour — mirrors {@code ReferralCodeComponent}'s {@code bg-blue-50}
     *  so referral + coupon cards look like siblings on the enroll-by-invite review step.
     *  Override on other surfaces if their visual context calls for something different. */
    surfaceClassName?: string;
    headingLabel?: string;
    placeholder?: string;
}

/**
 * Shared learner-side coupon input. Used by:
 *   - Product page CartStep (planned migration; legacy inline coupon card still exists)
 *   - Enroll-by-invite review step (sibling to ReferralCodeComponent)
 *   - Catalogue EnrollmentPaymentDialog (above the gateway form)
 *
 * The component is dumb — all state flows through the {@link CheckoutCouponState}
 * passed via {@code state}. The owning surface uses {@link useCheckoutCoupon}
 * to manage it and forwards the resolved discount into its own price math.
 */
export const CouponInput = ({
    state,
    onChange,
    onApply,
    onClear,
    currencySymbol = "₹",
    surfaceClassName,
    headingLabel,
    placeholder,
}: CouponInputProps) => {
    const { t, i18n } = useTranslation("layoutCommonB");
    const isApplied = !!state.appliedCode;
    const resolvedHeadingLabel = headingLabel ?? t("couponInput.heading");
    const resolvedPlaceholder = placeholder ?? t("couponInput.placeholder");

    return (
        <div className={cn("rounded-lg bg-blue-50 p-4", surfaceClassName)}>
            <div className="mb-3 flex items-center gap-2">
                <Tag className="size-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-gray-900">{resolvedHeadingLabel}</h3>
            </div>

            <div className="space-y-3">
                {isApplied ? (
                    <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-2">
                        <div className="flex items-center gap-2">
                            <Check className="size-4 text-green-700" />
                            <span className="font-mono text-sm font-semibold text-green-800">
                                {state.appliedCode}
                            </span>
                            {state.discount > 0 && (
                                <span className="text-sm text-green-700">
                                    {t("couponInput.discountOff", {
                                        amount: `${currencySymbol}${state.discount.toLocaleString(i18n.language)}`,
                                    })}
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={onClear}
                            aria-label={t("couponInput.removeCoupon")}
                            className="rounded p-1 text-gray-500 hover:text-red-500"
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                ) : (
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <Input
                                type="text"
                                placeholder={resolvedPlaceholder}
                                value={state.code}
                                disabled={state.isApplying}
                                onChange={(e) => onChange(e.target.value.toUpperCase())}
                                className="!w-full font-mono uppercase"
                                aria-label={t("couponInput.couponCode")}
                            />
                        </div>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={() => onApply()}
                            disable={state.isApplying || !state.code.trim()}
                            className="whitespace-nowrap"
                        >
                            {state.isApplying ? t("couponInput.applying") : t("couponInput.apply")}
                        </MyButton>
                    </div>
                )}

                {state.error && (
                    <div className="flex items-center gap-2 text-sm text-danger-600">
                        <X className="size-4" />
                        <span>{state.error}</span>
                    </div>
                )}
            </div>
        </div>
    );
};
