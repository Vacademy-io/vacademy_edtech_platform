import type { MembershipPlan } from "../../-services/membership-plan-service";
import type { MembershipPlan as CartMembershipPlan } from "../../-stores/cart-store";
import type { GlobalSettings } from "../../-types/course-catalogue-types";
import { isOncePerUserCharge, type ResolvedCharge } from "../../-utils/additional-charges-util";

/**
 * Pure logic behind the `membershipPlans` section. The rent cart (CartComponent) lists the same
 * plans, so every rule here mirrors it: the order, the books-at-a-time / books-per-period fields
 * and the plan object the cart store keeps.
 */

/** The month count in a plan name ("… 12 Months" → 12), 0 when it names none. */
export const planDurationMonths = (name: string | null | undefined): number => {
  const match = (name || "").match(/(\d+)\s*months?/i);
  return match ? parseInt(match[1], 10) : 0;
};

const planNamePrefix = (name: string | null | undefined): string =>
  (name || "").replace(/\d+\s*months?/i, "").trim().toLowerCase();

/**
 * The cart's plan order: by the name without its duration ("Home Delivery Service" before
 * "Store Pick Up and Drop"), then shortest duration first. Returns a new array.
 */
export const sortMembershipPlans = <P extends Pick<MembershipPlan, "package_name">>(plans: P[]): P[] =>
  [...plans].sort((a, b) => {
    const prefixCmp = planNamePrefix(a.package_name).localeCompare(planNamePrefix(b.package_name));
    if (prefixCmp !== 0) return prefixCmp;
    return planDurationMonths(a.package_name) - planDurationMonths(b.package_name);
  });

/** A positive count, or null for "no limit" (absent, zero or not a number). */
const limitOf = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

export interface MembershipPlanCardModel {
  key: string;
  /** The package name; empty when the package has none (the card shows a default). */
  name: string;
  price: number;
  /** The MRP, only when it is above the price (else nothing is struck out). */
  elevatedPrice?: number;
  currency?: string;
  /** Books a member may hold at once; null = unlimited. */
  booksAtOnce: number | null;
  /** Books a member may rent over the plan period; null = unlimited. */
  booksPerPeriod: number | null;
}

/**
 * What a plan card shows. Books at a time is `available_slots`, books per period `max_seats`, as
 * on the cart's plan card; a missing or zero limit reads as unlimited, which is how the cart's
 * checkout treats `maxSeats`.
 */
export const toMembershipPlanCard = (plan: MembershipPlan): MembershipPlanCardModel => {
  const price = plan.min_plan_actual_price || 0;
  const elevated = plan.min_plan_elevated_price;
  return {
    key: plan.id,
    name: plan.package_name || "",
    price,
    elevatedPrice: typeof elevated === "number" && elevated > price ? elevated : undefined,
    currency: plan.currency || undefined,
    booksAtOnce: limitOf(plan.available_slots),
    booksPerPeriod: limitOf(plan.max_seats),
  };
};

/** The plan object the rent cart keeps — exactly what the cart's own plan card stores. */
export const toCartMembershipPlan = (plan: MembershipPlan): CartMembershipPlan => ({
  id: plan.enroll_invite_id || plan.id,
  title: plan.package_name,
  price: plan.min_plan_actual_price,
  numberOfBooks: plan.available_slots ?? undefined,
  maxSeats: plan.max_seats ?? undefined,
  packageSessionId: plan.package_session_id,
  enrollInviteId: plan.enroll_invite_id,
});

export type DepositNoteKey =
  | "membershipPlans.depositNote"
  | "membershipPlans.depositNoteOneTime"
  | "membershipPlans.depositNoteRefundable"
  | "membershipPlans.depositNoteRefundableOneTime";

export interface DepositNote {
  key: string;
  label: string;
  amount: number;
  /** The i18n key of the line, worded from the charge's config flags. */
  i18nKey: DepositNoteKey;
}

const depositNoteKey = (refundable: boolean, oncePerUser: boolean): DepositNoteKey => {
  if (refundable && oncePerUser) return "membershipPlans.depositNoteRefundableOneTime";
  if (refundable) return "membershipPlans.depositNoteRefundable";
  if (oncePerUser) return "membershipPlans.depositNoteOneTime";
  return "membershipPlans.depositNote";
};

/**
 * One line per rent-mode charge (e.g. the security deposit), worded from its config entry: it
 * says "refundable" / "one-time" only when the entry's `refundable` / `oncePerUser` flag is set.
 */
export const buildDepositNotes = (
  charges: ResolvedCharge[],
  globalSettings: GlobalSettings | undefined | null,
): DepositNote[] =>
  charges.map((charge) => {
    const config = globalSettings?.payment?.additionalCharges?.find((c) => c.key === charge.key);
    return {
      key: charge.key,
      label: charge.label,
      amount: charge.amount,
      i18nKey: depositNoteKey(Boolean(config?.refundable), isOncePerUserCharge(globalSettings, charge.key)),
    };
  });
