import { describe, expect, it } from "vitest";
import type {
  AdditionalCharge,
  AdditionalChargeZone,
  GlobalSettings,
} from "../-types/course-catalogue-types";
import {
  buildChargeEnrollmentEntries,
  matchZone,
  normalizeDeliveryPin,
  resolveAdditionalCharges,
  resolveChargesForPin,
  resolveZoneCharges,
  sumChargeAmounts,
} from "./additional-charges-util";

const MAHARASHTRA: AdditionalChargeZone = {
  key: "MAHARASHTRA",
  label: "Within Maharashtra",
  pinPrefixes: ["40", "41", "42", "43", "44"],
  excludePinPrefixes: ["403"],
  planId: "plan-mh",
  amount: 70,
};

const REST_OF_INDIA: AdditionalChargeZone = {
  key: "REST_OF_INDIA",
  label: "Rest of India",
  planId: "plan-roi",
  amount: 90,
};

const ZONES = [MAHARASHTRA, REST_OF_INDIA];

const linkage = {
  packageSessionId: "ps-ship",
  enrollInviteId: "inv-ship",
  paymentOptionId: "po-ship",
};

const zoneCharge = (overrides: Partial<AdditionalCharge> = {}): AdditionalCharge => ({
  key: "SHIPPING",
  label: "Shipping",
  applicableTo: ["COURSE"],
  ...linkage,
  zones: ZONES,
  ...overrides,
});

const tierCharge = (overrides: Partial<AdditionalCharge> = {}): AdditionalCharge => ({
  key: "SHIPPING",
  label: "Shipping",
  applicableTo: ["COURSE"],
  ...linkage,
  tiers: [
    { minQty: 1, maxQty: 2, planId: "plan-t1", amount: 50 },
    { minQty: 3, maxQty: null, planId: "plan-t2", amount: 80 },
  ],
  ...overrides,
});

const flatCharge = (overrides: Partial<AdditionalCharge> = {}): AdditionalCharge => ({
  key: "HANDLING",
  label: "Handling",
  applicableTo: ["COURSE"],
  ...linkage,
  planId: "plan-flat",
  amount: 25,
  ...overrides,
});

const settings = (...charges: AdditionalCharge[]): GlobalSettings =>
  ({ payment: { enabled: true, provider: "razorpay", fields: [], additionalCharges: charges } }) as unknown as GlobalSettings;

describe("normalizeDeliveryPin", () => {
  it("accepts exactly six digits and trims the edges", () => {
    expect(normalizeDeliveryPin("400001")).toBe("400001");
    expect(normalizeDeliveryPin(" 400001 ")).toBe("400001");
    expect(normalizeDeliveryPin("\t110001\n")).toBe("110001");
  });

  it("rejects anything else", () => {
    for (const bad of ["4000", "", "   ", "abcdef", "4000011", "40 0001", "40000a", null, undefined]) {
      expect(normalizeDeliveryPin(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe("matchZone", () => {
  it("puts Maharashtra PINs in the Maharashtra zone", () => {
    for (const pin of ["400001", "411001", "440001", "445001"]) {
      expect(matchZone(ZONES, pin)?.key).toBe("MAHARASHTRA");
    }
  });

  it("sends Goa (403 is excluded) and the rest of the country to the catch-all", () => {
    for (const pin of ["403001", "110001", "560001"]) {
      expect(matchZone(ZONES, pin)?.key).toBe("REST_OF_INDIA");
    }
  });

  it("treats a malformed PIN as no match, even with a catch-all zone", () => {
    for (const bad of ["4000", "", "abcdef", "4000011", null, undefined]) {
      expect(matchZone(ZONES, bad as string | null | undefined)).toBeNull();
    }
  });

  it("trims the PIN before matching", () => {
    expect(matchZone(ZONES, " 400001 ")?.key).toBe("MAHARASHTRA");
  });

  it("returns the first matching zone in array order", () => {
    const catchAllFirst = [REST_OF_INDIA, MAHARASHTRA];
    expect(matchZone(catchAllFirst, "400001")?.key).toBe("REST_OF_INDIA");
    expect(matchZone(ZONES, "400001")?.key).toBe("MAHARASHTRA");
  });

  it("lets an exclusion beat an inclusion", () => {
    const only: AdditionalChargeZone[] = [
      { key: "A", label: "A", pinPrefixes: ["40"], excludePinPrefixes: ["400"], planId: "p", amount: 1 },
    ];
    expect(matchZone(only, "400001")).toBeNull();
    expect(matchZone(only, "401001")?.key).toBe("A");

    const sameBoth: AdditionalChargeZone[] = [
      { key: "B", label: "B", pinPrefixes: ["403"], excludePinPrefixes: ["403"], planId: "p", amount: 1 },
    ];
    expect(matchZone(sameBoth, "403001")).toBeNull();
  });

  it("treats absent or empty pinPrefixes as every PIN", () => {
    const empty: AdditionalChargeZone[] = [{ key: "E", label: "E", pinPrefixes: [], planId: "p", amount: 1 }];
    expect(matchZone(empty, "999999")?.key).toBe("E");
    expect(matchZone([REST_OF_INDIA], "999999")?.key).toBe("REST_OF_INDIA");
  });

  it("applies an exclusion to a zone that has no inclusion list", () => {
    const noGoa: AdditionalChargeZone[] = [
      { key: "NOT_GOA", label: "Not Goa", excludePinPrefixes: ["403"], planId: "p", amount: 1 },
    ];
    expect(matchZone(noGoa, "403001")).toBeNull();
    expect(matchZone(noGoa, "110001")?.key).toBe("NOT_GOA");
  });

  it("returns null when no zone delivers to the PIN, or there are no zones", () => {
    expect(matchZone([MAHARASHTRA], "110001")).toBeNull();
    expect(matchZone([], "400001")).toBeNull();
    expect(matchZone(undefined, "400001")).toBeNull();
    expect(matchZone(null, "400001")).toBeNull();
  });
});

describe("resolveChargesForPin (zone charges)", () => {
  it("asks for a PIN until a valid one is entered", () => {
    for (const pin of [undefined, null, "", "4000", "abcdef"]) {
      const out = resolveChargesForPin(settings(zoneCharge()), "buy", 2, pin);
      expect(out.resolved).toEqual([]);
      expect(out.unresolved).toEqual([{ key: "SHIPPING", label: "Shipping", reason: "NEED_PIN" }]);
    }
  });

  it("prices the matched zone once, whatever the book quantity", () => {
    for (const qty of [1, 2, 7]) {
      const out = resolveChargesForPin(settings(zoneCharge()), "buy", qty, "400001");
      expect(out.unresolved).toEqual([]);
      expect(out.resolved).toHaveLength(1);
      expect(out.resolved[0]).toMatchObject({
        key: "SHIPPING",
        label: "Shipping",
        amount: 70,
        planId: "plan-mh",
        ...linkage,
        tier: null,
      });
      expect(out.resolved[0].zone?.key).toBe("MAHARASHTRA");
    }
  });

  it("prices Goa and the rest of the country at the catch-all rate", () => {
    for (const pin of ["403001", "110001", "560001"]) {
      const [charge] = resolveChargesForPin(settings(zoneCharge()), "buy", 1, pin).resolved;
      expect(charge.amount).toBe(90);
      expect(charge.planId).toBe("plan-roi");
      expect(charge.zone?.key).toBe("REST_OF_INDIA");
    }
  });

  it("accepts a PIN with surrounding spaces", () => {
    const [charge] = resolveChargesForPin(settings(zoneCharge()), "buy", 1, " 411001 ").resolved;
    expect(charge.planId).toBe("plan-mh");
  });

  it("reports NOT_DELIVERABLE when a valid PIN falls in no zone", () => {
    const only = zoneCharge({ zones: [MAHARASHTRA] });
    const out = resolveChargesForPin(settings(only), "buy", 1, "110001");
    expect(out.resolved).toEqual([]);
    expect(out.unresolved).toEqual([{ key: "SHIPPING", label: "Shipping", reason: "NOT_DELIVERABLE" }]);
  });

  it("does not ship for free when the matched zone has no usable plan", () => {
    const broken = zoneCharge({
      zones: [{ ...MAHARASHTRA, planId: "" }, REST_OF_INDIA],
    });
    const out = resolveChargesForPin(settings(broken), "buy", 1, "400001");
    expect(out.resolved).toEqual([]);
    expect(out.unresolved[0].reason).toBe("NOT_DELIVERABLE");
  });

  it("ignores tiers and a flat plan on a charge that has zones", () => {
    const mixed = zoneCharge({
      tiers: [{ minQty: 1, maxQty: null, planId: "plan-t", amount: 1 }],
      planId: "plan-flat",
      amount: 2,
    });
    const noPin = resolveChargesForPin(settings(mixed), "buy", 1, null);
    expect(noPin.resolved).toEqual([]);
    expect(noPin.unresolved[0].reason).toBe("NEED_PIN");
    const withPin = resolveChargesForPin(settings(mixed), "buy", 1, "560001");
    expect(withPin.resolved[0]).toMatchObject({ planId: "plan-roi", amount: 90 });
  });

  it("treats an empty zones array as an ordinary tiered or flat charge", () => {
    const out = resolveChargesForPin(settings(tierCharge({ zones: [] })), "buy", 1, null);
    expect(out.unresolved).toEqual([]);
    expect(out.resolved[0]).toMatchObject({ planId: "plan-t1", amount: 50, zone: null });
  });

  it("charges nothing for an empty cart, another mode, or a charge with no linkage", () => {
    expect(resolveChargesForPin(settings(zoneCharge()), "buy", 0, "400001")).toEqual({ resolved: [], unresolved: [] });
    expect(
      resolveChargesForPin(settings(zoneCharge({ applicableTo: ["MEMBERSHIP"] })), "buy", 1, "400001"),
    ).toEqual({ resolved: [], unresolved: [] });
    expect(
      resolveChargesForPin(settings(zoneCharge({ enrollInviteId: "" })), "buy", 1, "400001"),
    ).toEqual({ resolved: [], unresolved: [] });
    expect(resolveChargesForPin(null, "buy", 1, "400001")).toEqual({ resolved: [], unresolved: [] });
    expect(resolveChargesForPin(undefined, "buy", 1, "400001")).toEqual({ resolved: [], unresolved: [] });
  });
});

describe("resolveAdditionalCharges (tiers and flat, unchanged)", () => {
  it("picks the tier that holds the book quantity", () => {
    const gs = settings(tierCharge());
    expect(resolveAdditionalCharges(gs, "buy", 1)[0]).toMatchObject({ planId: "plan-t1", amount: 50, zone: null });
    expect(resolveAdditionalCharges(gs, "buy", 2)[0].amount).toBe(50);
    expect(resolveAdditionalCharges(gs, "buy", 3)[0]).toMatchObject({ planId: "plan-t2", amount: 80 });
    expect(resolveAdditionalCharges(gs, "buy", 40)[0].amount).toBe(80);
    expect(resolveAdditionalCharges(gs, "buy", 1)[0].tier?.planId).toBe("plan-t1");
  });

  it("resolves a flat charge", () => {
    expect(resolveAdditionalCharges(settings(flatCharge()), "buy", 1)[0]).toMatchObject({
      key: "HANDLING",
      planId: "plan-flat",
      amount: 25,
      tier: null,
      zone: null,
    });
  });

  it("returns nothing for an empty cart or the wrong mode", () => {
    expect(resolveAdditionalCharges(settings(tierCharge()), "buy", 0)).toEqual([]);
    expect(resolveAdditionalCharges(settings(tierCharge()), "rent", 2)).toEqual([]);
    expect(resolveAdditionalCharges(settings(tierCharge({ applicableTo: ["MEMBERSHIP"] })), "rent", 2)).toHaveLength(1);
  });

  it("skips a charge missing its linkage or plan", () => {
    expect(resolveAdditionalCharges(settings(tierCharge({ paymentOptionId: "" })), "buy", 1)).toEqual([]);
    expect(resolveAdditionalCharges(settings(flatCharge({ planId: undefined })), "buy", 1)).toEqual([]);
    expect(resolveAdditionalCharges(settings(flatCharge({ amount: undefined })), "buy", 1)).toEqual([]);
  });

  it("leaves a PIN-priced charge out, since it has no amount before checkout", () => {
    expect(resolveAdditionalCharges(settings(zoneCharge()), "buy", 2)).toEqual([]);
    const both = resolveAdditionalCharges(settings(flatCharge(), zoneCharge()), "buy", 2);
    expect(both.map((c) => c.key)).toEqual(["HANDLING"]);
  });

  it("copes with missing settings", () => {
    expect(resolveAdditionalCharges(null, "buy", 1)).toEqual([]);
    expect(resolveAdditionalCharges(undefined, "buy", 1)).toEqual([]);
    expect(resolveAdditionalCharges({ payment: {} } as unknown as GlobalSettings, "buy", 1)).toEqual([]);
  });
});

describe("resolveZoneCharges", () => {
  it("returns only the zone charges, leaving tiered and flat ones to the cart", () => {
    const gs = settings(tierCharge({ key: "TIERED" }), flatCharge(), zoneCharge());
    const noPin = resolveZoneCharges(gs, "buy", 2, "");
    expect(noPin.resolved).toEqual([]);
    expect(noPin.unresolved.map((u) => u.key)).toEqual(["SHIPPING"]);

    const withPin = resolveZoneCharges(gs, "buy", 2, "411001");
    expect(withPin.unresolved).toEqual([]);
    expect(withPin.resolved.map((c) => c.key)).toEqual(["SHIPPING"]);
    expect(withPin.resolved[0].zone?.key).toBe("MAHARASHTRA");
  });

  it("is empty when there is no zone charge", () => {
    expect(resolveZoneCharges(settings(tierCharge(), flatCharge()), "buy", 2, "400001")).toEqual({
      resolved: [],
      unresolved: [],
    });
  });
});

describe("charge enrollment entries and totals", () => {
  it("sends the matched zone's plan as one unit, and totals its amount", () => {
    const { resolved } = resolveZoneCharges(settings(zoneCharge()), "buy", 5, "560001");
    expect(buildChargeEnrollmentEntries(resolved)).toEqual([
      {
        package_session_id: "ps-ship",
        plan_id: "plan-roi",
        payment_option_id: "po-ship",
        enroll_invite_id: "inv-ship",
        requested_quantity: 1,
      },
    ]);
    expect(sumChargeAmounts(resolved)).toBe(90);
  });

  it("adds a tiered charge and a zone charge together", () => {
    const gs = settings(tierCharge({ key: "TIERED" }), zoneCharge());
    const all = [...resolveAdditionalCharges(gs, "buy", 3), ...resolveZoneCharges(gs, "buy", 3, "400001").resolved];
    expect(sumChargeAmounts(all)).toBe(80 + 70);
    expect(buildChargeEnrollmentEntries(all).map((e) => e.plan_id)).toEqual(["plan-t2", "plan-mh"]);
  });
});
