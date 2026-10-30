import { AdditionalCharge, AdditionalChargeTier, GlobalSettings } from "../-types/course-catalogue-types";

export type CartMode = "buy" | "rent";

const MODE_TO_APPLICABLE: Record<CartMode, "COURSE" | "MEMBERSHIP"> = {
  buy: "COURSE",
  rent: "MEMBERSHIP",
};

/**
 * A single resolved charge ready for display + enrollment:
 *   - `amount` is what the user pays
 *   - `planId` is the PaymentPlan whose `actualPrice` MUST equal `amount`
 *     (backend verifies this; cart math and backend must agree)
 *   - `tier` is the matched tier when the charge is qty-based, else null
 */
export interface ResolvedCharge {
  key: string;
  label: string;
  amount: number;
  planId: string;
  packageSessionId: string;
  enrollInviteId: string;
  paymentOptionId: string;
  tier: AdditionalChargeTier | null;
}

const isTiered = (charge: AdditionalCharge): boolean =>
  Array.isArray(charge.tiers) && charge.tiers.length > 0;

/**
 * Picks the tier whose [minQty, maxQty] contains `qty`. `maxQty: null` is unbounded.
 * If no tier matches (e.g. qty=0 and minQty starts at 1), returns null and the
 * charge is skipped — empty cart should not be charged shipping.
 */
const matchTier = (tiers: AdditionalChargeTier[], qty: number): AdditionalChargeTier | null => {
  for (const tier of tiers) {
    const minOk = qty >= tier.minQty;
    const maxOk = tier.maxQty === null || tier.maxQty === undefined || qty <= tier.maxQty;
    if (minOk && maxOk) return tier;
  }
  return null;
};

const isApplicable = (charge: AdditionalCharge, mode: CartMode): boolean => {
  if (!Array.isArray(charge.applicableTo) || charge.applicableTo.length === 0) return false;
  return charge.applicableTo.includes(MODE_TO_APPLICABLE[mode]);
};

/**
 * Returns charges (shipping etc.) resolved against the current cart for the given mode.
 * A charge missing its DB linkage (packageSessionId / enrollInviteId / paymentOptionId
 * / planId) is skipped — without those it cannot be enrolled, so displaying its amount
 * would mislead the user. `qty = 0` returns [] for the same reason.
 */
export const resolveAdditionalCharges = (
  globalSettings: GlobalSettings | undefined | null,
  mode: CartMode,
  qty: number,
): ResolvedCharge[] => {
  if (!globalSettings || qty <= 0) return [];
  const charges = globalSettings.payment?.additionalCharges;
  if (!Array.isArray(charges) || charges.length === 0) return [];

  const resolved: ResolvedCharge[] = [];
  for (const charge of charges) {
    if (!isApplicable(charge, mode)) continue;
    if (!charge.packageSessionId || !charge.enrollInviteId || !charge.paymentOptionId) continue;

    if (isTiered(charge)) {
      const tier = matchTier(charge.tiers!, qty);
      if (!tier || !tier.planId) continue;
      resolved.push({
        key: charge.key,
        label: charge.label,
        amount: tier.amount,
        planId: tier.planId,
        packageSessionId: charge.packageSessionId,
        enrollInviteId: charge.enrollInviteId,
        paymentOptionId: charge.paymentOptionId,
        tier,
      });
    } else if (charge.planId && typeof charge.amount === "number") {
      resolved.push({
        key: charge.key,
        label: charge.label,
        amount: charge.amount,
        planId: charge.planId,
        packageSessionId: charge.packageSessionId,
        enrollInviteId: charge.enrollInviteId,
        paymentOptionId: charge.paymentOptionId,
        tier: null,
      });
    }
  }
  return resolved;
};

export const sumChargeAmounts = (charges: ResolvedCharge[]): number =>
  charges.reduce((sum, c) => sum + c.amount, 0);

/**
 * Maps resolved charges to v2 `learner_package_session_enrollments[]` entries.
 * Shape matches the existing entries CheckoutForm builds for books, so the backend
 * treats them uniformly (creates UserPlan + PaymentLog per entry, sums per
 * `PaymentPlan.actualPrice` for amount verification).
 *
 * A charge is always one unit: the tier already prices the whole cart, so its
 * entry carries `requested_quantity: 1` (the server rejects more on a charge).
 */
export const buildChargeEnrollmentEntries = (charges: ResolvedCharge[]) =>
  charges.map((c) => ({
    package_session_id: c.packageSessionId,
    plan_id: c.planId,
    payment_option_id: c.paymentOptionId,
    enroll_invite_id: c.enrollInviteId,
    requested_quantity: 1,
  }));
