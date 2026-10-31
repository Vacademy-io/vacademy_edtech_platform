import {
  AdditionalCharge,
  AdditionalChargeTier,
  AdditionalChargeZone,
  GlobalSettings,
} from "../-types/course-catalogue-types";

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
 *   - `zone` is the matched delivery zone when the charge is PIN-based, else null
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
  zone: AdditionalChargeZone | null;
}

/**
 * Why a PIN-priced (zone) charge has no amount yet:
 *   - `NEED_PIN` — no valid 6-digit delivery PIN has been entered
 *   - `NOT_DELIVERABLE` — the PIN is valid but no zone delivers to it
 */
export type UnresolvedChargeReason = "NEED_PIN" | "NOT_DELIVERABLE";

export interface UnresolvedCharge {
  key: string;
  label: string;
  reason: UnresolvedChargeReason;
}

export interface ChargeResolution {
  resolved: ResolvedCharge[];
  unresolved: UnresolvedCharge[];
}

const DELIVERY_PIN_PATTERN = /^\d{6}$/;

/**
 * The delivery PIN as the server reads it: trimmed, and valid only when it is
 * exactly 6 digits. Returns null for anything else (blank, partial, non-numeric).
 */
export const normalizeDeliveryPin = (pin: string | null | undefined): string | null => {
  if (typeof pin !== "string") return null;
  const trimmed = pin.trim();
  return DELIVERY_PIN_PATTERN.test(trimmed) ? trimmed : null;
};

const isZoned = (charge: AdditionalCharge): boolean =>
  Array.isArray(charge.zones) && charge.zones.length > 0;

const isTiered = (charge: AdditionalCharge): boolean =>
  Array.isArray(charge.tiers) && charge.tiers.length > 0;

const startsWithAny = (pin: string, prefixes: unknown[]): boolean =>
  prefixes.some((prefix) => typeof prefix === "string" && pin.startsWith(prefix));

/**
 * Picks the delivery zone for `pin`, or null when the PIN is not a valid 6-digit
 * PIN or no zone delivers to it. A zone matches when
 *   (`pinPrefixes` is absent/empty OR the PIN starts with any of them)
 *   AND NOT (the PIN starts with any of `excludePinPrefixes`).
 * Zones are tried in array order and the first match wins, so an exclusion beats
 * an inclusion within the same zone and a narrow zone listed first beats a
 * catch-all after it. Mirrors the server's rule; keep the two in step.
 */
export const matchZone = (
  zones: AdditionalChargeZone[] | undefined | null,
  pin: string | null | undefined,
): AdditionalChargeZone | null => {
  const normalized = normalizeDeliveryPin(pin);
  if (!normalized || !Array.isArray(zones)) return null;

  for (const zone of zones) {
    if (!zone) continue;
    const include = zone.pinPrefixes;
    const exclude = zone.excludePinPrefixes;
    const included = !Array.isArray(include) || include.length === 0 || startsWithAny(normalized, include);
    const excluded = Array.isArray(exclude) && startsWithAny(normalized, exclude);
    if (included && !excluded) return zone;
  }
  return null;
};

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
 * Resolves every applicable charge (zone, tiered and flat) against the cart and
 * the delivery PIN. A zone charge that cannot be priced is reported in
 * `unresolved` with a reason instead of being dropped, so the UI can tell the
 * learner what is missing. Everything else behaves as `resolveAdditionalCharges`.
 *
 * A zone charge is charged ONCE per order (the zone already prices the whole
 * delivery) whenever the cart holds at least one book; `qty` only gates that.
 * A matched zone that has no usable plan (missing `planId` / numeric `amount`)
 * is reported as `NOT_DELIVERABLE` rather than shipping for free.
 */
export const resolveChargesForPin = (
  globalSettings: GlobalSettings | undefined | null,
  mode: CartMode,
  qty: number,
  deliveryPin: string | null | undefined,
): ChargeResolution => {
  const result: ChargeResolution = { resolved: [], unresolved: [] };
  if (!globalSettings || qty <= 0) return result;
  const charges = globalSettings.payment?.additionalCharges;
  if (!Array.isArray(charges) || charges.length === 0) return result;

  for (const charge of charges) {
    if (!isApplicable(charge, mode)) continue;
    if (!charge.packageSessionId || !charge.enrollInviteId || !charge.paymentOptionId) continue;

    if (isZoned(charge)) {
      if (!normalizeDeliveryPin(deliveryPin)) {
        result.unresolved.push({ key: charge.key, label: charge.label, reason: "NEED_PIN" });
        continue;
      }
      const zone = matchZone(charge.zones, deliveryPin);
      if (!zone || !zone.planId || typeof zone.amount !== "number") {
        result.unresolved.push({ key: charge.key, label: charge.label, reason: "NOT_DELIVERABLE" });
        continue;
      }
      result.resolved.push({
        key: charge.key,
        label: charge.label,
        amount: zone.amount,
        planId: zone.planId,
        packageSessionId: charge.packageSessionId,
        enrollInviteId: charge.enrollInviteId,
        paymentOptionId: charge.paymentOptionId,
        tier: null,
        zone,
      });
    } else if (isTiered(charge)) {
      const tier = matchTier(charge.tiers!, qty);
      if (!tier || !tier.planId) continue;
      result.resolved.push({
        key: charge.key,
        label: charge.label,
        amount: tier.amount,
        planId: tier.planId,
        packageSessionId: charge.packageSessionId,
        enrollInviteId: charge.enrollInviteId,
        paymentOptionId: charge.paymentOptionId,
        tier,
        zone: null,
      });
    } else if (charge.planId && typeof charge.amount === "number") {
      result.resolved.push({
        key: charge.key,
        label: charge.label,
        amount: charge.amount,
        planId: charge.planId,
        packageSessionId: charge.packageSessionId,
        enrollInviteId: charge.enrollInviteId,
        paymentOptionId: charge.paymentOptionId,
        tier: null,
        zone: null,
      });
    }
  }
  return result;
};

/**
 * Returns the quantity-based and flat charges (shipping etc.) resolved against the
 * current cart for the given mode. A charge missing its DB linkage
 * (packageSessionId / enrollInviteId / paymentOptionId / planId) is skipped —
 * without those it cannot be enrolled, so displaying its amount would mislead the
 * user. `qty = 0` returns [] for the same reason.
 *
 * PIN-priced (zone) charges are NOT returned: they have no amount until the
 * learner enters a delivery PIN at checkout. Use `resolveZoneCharges` for those.
 */
export const resolveAdditionalCharges = (
  globalSettings: GlobalSettings | undefined | null,
  mode: CartMode,
  qty: number,
): ResolvedCharge[] => resolveChargesForPin(globalSettings, mode, qty, null).resolved;

/**
 * Only the PIN-priced (zone) charges, resolved against the delivery PIN.
 * `resolved` holds those the PIN prices; `unresolved` holds the rest, each with
 * its reason. With no valid PIN every zone charge is `NEED_PIN`, which is also
 * how the cart page learns that a "calculated at checkout" row is needed.
 */
export const resolveZoneCharges = (
  globalSettings: GlobalSettings | undefined | null,
  mode: CartMode,
  qty: number,
  deliveryPin: string | null | undefined,
): ChargeResolution => {
  const { resolved, unresolved } = resolveChargesForPin(globalSettings, mode, qty, deliveryPin);
  return { resolved: resolved.filter((charge) => charge.zone !== null), unresolved };
};

export const sumChargeAmounts = (charges: ResolvedCharge[]): number =>
  charges.reduce((sum, c) => sum + c.amount, 0);

/**
 * Maps resolved charges to v2 `learner_package_session_enrollments[]` entries.
 * Shape matches the existing entries CheckoutForm builds for books, so the backend
 * treats them uniformly (creates UserPlan + PaymentLog per entry, sums per
 * `PaymentPlan.actualPrice` for amount verification).
 *
 * A charge is always one unit: the tier (or delivery zone) already prices the whole
 * cart, so its entry carries `requested_quantity: 1` (the server rejects more on a
 * charge). For a zone charge `plan_id` is the matched zone's plan.
 */
export const buildChargeEnrollmentEntries = (charges: ResolvedCharge[]) =>
  charges.map((c) => ({
    package_session_id: c.packageSessionId,
    plan_id: c.planId,
    payment_option_id: c.paymentOptionId,
    enroll_invite_id: c.enrollInviteId,
    requested_quantity: 1,
  }));
