import { MyButton } from "@/components/design-system/button";
import { Input } from "@/components/ui/input";
import { VERIFY_COUPON_URL } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { AxiosResponse } from "axios";
import { Check, Tag, X } from "@phosphor-icons/react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ReferRequest } from "../-services/enroll-invite-services";

// Common base interface
interface Benefit {
  benefitType: string;
  benefitValue: Record<string, unknown>;
  description?: string;
}

// Flat discount interface
export interface FlatBenefit extends Benefit {
  benefitType: "FLAT_DISCOUNT";
  benefitValue: {
    amount: number;
  };
}

// Percentage discount interface
export interface PercentageDiscountBenefit extends Benefit {
  benefitType: "PERCENTAGE_DISCOUNT";
  benefitValue: {
    percentage: number;
    maxDiscountAmount: number;
    applyMaximumDiscountAmount: boolean;
  };
}

// Free membership days interface
export interface FreeMembershipDaysBenefit extends Benefit {
  benefitType: "FREE_MEMBERSHIP_DAYS";
  benefitValue: {
    days: number;
  };
}

// Content benefit interface
export interface ContentBenefit extends Benefit {
  benefitType: "CONTENT";
  benefitValue: {
    deliveryMediums: string[];
    templateId?: string;
    subject?: string;
    body?: string;
    fileIds?: string[];
    contentUrl?: string;
  };
}

// Points benefit interface
export interface PointsBenefit extends Benefit {
  benefitType: "POINTS";
  benefitValue: {
    points: number;
  };
}

// Union type for all benefits
export type ReferralBenefit =
  | FlatBenefit
  | PercentageDiscountBenefit
  | FreeMembershipDaysBenefit
  | ContentBenefit
  | PointsBenefit;

export // Referral Code Component
const ReferralCodeComponent = ({
  referralOptionId,
  setCouponVerified,
  package_session_id,
  setReferRequest,
  refCode,
  onUnappliedCodeChange,
  onReferralApplied,
}: {
  referralOptionId: string;
  setCouponVerified: (value: boolean) => void;
  package_session_id: string;
  setReferRequest: (referRequest: ReferRequest | null) => void;
  refCode: string | null;
  onUnappliedCodeChange?: (hasUnappliedCode: boolean) => void;
  onReferralApplied?: () => void;
}) => {
  const { t } = useTranslation("enrollmentA");
  const [referralCode, setReferralCode] = useState(refCode || "");
  const [isApplying, setIsApplying] = useState(false);
  const [isApplied, setIsApplied] = useState(false);
  const [error, setError] = useState("");
  const [hasAutoApplied, setHasAutoApplied] = useState(false);

  // Auto-apply referral code when provided via URL
  useEffect(() => {
    if (refCode && refCode.trim().length > 0 && !isApplied && !hasAutoApplied && !isApplying) {
      if (onUnappliedCodeChange) {
        onUnappliedCodeChange(true);
      }
      // Auto-apply the referral code
      setHasAutoApplied(true);
      applyReferralCodeInternal(refCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refCode, isApplied, hasAutoApplied, isApplying]);

  const applyReferralCodeInternal = async (codeToApply: string) => {
    if (!codeToApply.trim()) {
      setError(t("applyReferral.errors.empty"));
      return;
    }

    setIsApplying(true);
    setError("");

    try {
      const response: AxiosResponse<{
        verified: boolean;
        source_type: string;
        source_id: string;
        message: string;
      }> = await authenticatedAxiosInstance({
        method: "POST",
        url: VERIFY_COUPON_URL,
        params: {
          couponCode: codeToApply,
          referralOptionId: referralOptionId,
        },
        data: {
          package_session_id: [package_session_id],
        },
      });

      if (response.data.verified) {
        setCouponVerified(true);
        setIsApplied(true);
        if (onUnappliedCodeChange) onUnappliedCodeChange(false);

        // Create and set the ReferRequest when coupon is verified
        const referRequest: ReferRequest = {
          referrer_user_id: response.data.source_id,
          referral_code: codeToApply,
          referral_option_id: referralOptionId,
        };
        setReferRequest(referRequest);

        // Notify parent that referral was successfully applied
        if (onReferralApplied) {
          onReferralApplied();
        }
      } else {
        setError(t("applyReferral.errors.invalid"));
        setCouponVerified(false);
        setIsApplied(false);
        setReferRequest(null);
        if (onUnappliedCodeChange) onUnappliedCodeChange(true);
      }
    } catch {
      setError(t("applyReferral.errors.applyFailed"));
      setCouponVerified(false);
      setReferRequest(null);
      setIsApplied(false);
      if (onUnappliedCodeChange) onUnappliedCodeChange(true);
    } finally {
      setIsApplying(false);
    }
  };

  const applyReferralCode = async () => {
    applyReferralCodeInternal(referralCode);
  };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setReferralCode(value);

      // Check if there is text and it's not applied
      // If user is typing, it's considered unapplied until they click Apply or it matches the applied code (which isn't possible here since edit resets applied state)
      const hasText = value.trim().length > 0;
      if (onUnappliedCodeChange) {
        onUnappliedCodeChange(hasText);
      }

      // Reset states on edit
      if (isApplied) {
        setIsApplied(false);
        setCouponVerified(false);
        setReferRequest(null);
        if (onUnappliedCodeChange) onUnappliedCodeChange(true);
      }
      if (error) setError("");
    };

  return (
    <div className="bg-blue-50 rounded-lg p-4 space-y-stack">
      <div className="flex items-center gap-2">
        <Tag className="w-5 h-5 text-blue-600" />
        <h3 className="font-semibold text-gray-900 text-lg">{t("applyReferral.title")}</h3>
      </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                type="text"
                placeholder={t("applyReferral.placeholder")}
                value={referralCode}
                onChange={handleInputChange}
                className="!w-full"
                disabled={isApplying}
              />
            </div>
            <MyButton
              type="button"
              buttonType="primary"
              scale="medium"
              onClick={applyReferralCode}
              disable={isApplying || !referralCode.trim() || isApplied}
              className="whitespace-nowrap"
            >
              {isApplied ? (
                <>
                  <Check className="w-4 h-4 me-1" />
                  {t("applyReferral.applied")}
                </>
              ) : isApplying ? (
                t("applyReferral.applying")
              ) : (
                t("applyReferral.apply")
              )}
            </MyButton>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-danger-600 text-sm">
              <X className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    );
  };
