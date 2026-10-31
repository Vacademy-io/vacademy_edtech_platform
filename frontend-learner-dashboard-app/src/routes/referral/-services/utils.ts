import type { TFunction } from "i18next";

export type BenefitType =
  | "POINTS"
  | "FREE_MEMBERSHIP_DAYS"
  | "PERCENTAGE_DISCOUNT"
  | "FLAT_DISCOUNT"
  | "CONTENT";

const parseBenefitLog = (benefit_value: string, type: string) => {
  switch (type) {
    case "POINTS": {
      const parse: { points: number } = JSON.parse(benefit_value);
      return { ...parse, type: type as BenefitType };
    }
    case "FREE_MEMBERSHIP_DAYS": {
      const parse: { days: number } = JSON.parse(benefit_value);
      return { ...parse, type: type as BenefitType };
    }
    default:
      return { type: type as BenefitType };
  }
};

const getBenefitText = (type: BenefitType, t: TFunction) => {
  switch (type) {
    case "PERCENTAGE_DISCOUNT":
      return t("referral.benefit.percentageDiscountText");
    case "FLAT_DISCOUNT":
      return t("referral.benefit.flatDiscountText");
    case "CONTENT":
      return t("referral.benefit.contentText");
    default:
      return t("referral.benefit.unknown");
  }
};

const getBenefitTypeLabel = (type: string, t: TFunction) => {
  switch (type) {
    case "PERCENTAGE_DISCOUNT":
      return t("referral.benefit.percentageDiscount");
    case "FLAT_DISCOUNT":
      return t("referral.benefit.flatDiscount");
    case "FREE_MEMBERSHIP_DAYS":
      return t("referral.benefit.freeMembershipDays");
    case "CONTENT":
      return t("referral.benefit.contentBenefit");
    case "POINTS":
      return t("referral.benefit.rewardPoints");
    default:
      return type;
  }
};

const getStatusIcon = (status: string) => {
  switch (status.toLowerCase()) {
    case "active":
      return "✅";
    case "pending":
      return "⏳";
    default:
      return "ℹ️";
  }
};

export { parseBenefitLog, getBenefitText, getBenefitTypeLabel, getStatusIcon };
