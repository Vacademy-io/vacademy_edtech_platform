import { describe, expect, it } from "vitest";
import type { MembershipPlan } from "../../-services/membership-plan-service";
import type { GlobalSettings } from "../../-types/course-catalogue-types";
import type { ResolvedCharge } from "../../-utils/additional-charges-util";
import {
  buildDepositNotes,
  planDurationMonths,
  refreshSelectedMembershipPlan,
  sortMembershipPlans,
  toCartMembershipPlan,
  toMembershipPlanCard,
} from "./membership-plans-utils";

const plan = (over: Partial<MembershipPlan> = {}): MembershipPlan => ({
  id: "pkg-1",
  package_name: "Store Pick Up and Drop 2 Months",
  min_plan_actual_price: 649,
  currency: "INR",
  package_type: "MEMBERSHIP",
  enroll_invite_id: "invite-1",
  package_session_id: "ps-1",
  level_id: "level-1",
  level_name: "Rent",
  ...over,
});

describe("planDurationMonths", () => {
  it("reads the month count from the plan name", () => {
    expect(planDurationMonths("Home Delivery Service 12 Months")).toBe(12);
    expect(planDurationMonths("Store Pick Up and Drop 1 month")).toBe(1);
    expect(planDurationMonths("Yearly")).toBe(0);
    expect(planDurationMonths(undefined)).toBe(0);
  });
});

describe("sortMembershipPlans", () => {
  it("orders like the rent cart: by name without duration, then shortest first", () => {
    const names = [
      "Store Pick Up and Drop 12 Months",
      "Home Delivery Service 12 Months",
      "Store Pick Up and Drop 2 Months",
      "Home Delivery Service 6 Months",
    ];
    const sorted = sortMembershipPlans(names.map((n, i) => plan({ id: `p${i}`, package_name: n })));
    expect(sorted.map((p) => p.package_name)).toEqual([
      "Home Delivery Service 6 Months",
      "Home Delivery Service 12 Months",
      "Store Pick Up and Drop 2 Months",
      "Store Pick Up and Drop 12 Months",
    ]);
  });

  it("leaves the input untouched", () => {
    const input = [plan({ id: "b", package_name: "B 2 Months" }), plan({ id: "a", package_name: "A 2 Months" })];
    sortMembershipPlans(input);
    expect(input.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("toMembershipPlanCard", () => {
  it("strikes out the MRP only when it is above the price", () => {
    expect(toMembershipPlanCard(plan({ min_plan_elevated_price: 799 })).elevatedPrice).toBe(799);
    expect(toMembershipPlanCard(plan({ min_plan_elevated_price: 649 })).elevatedPrice).toBeUndefined();
    expect(toMembershipPlanCard(plan({ min_plan_elevated_price: 500 })).elevatedPrice).toBeUndefined();
    expect(toMembershipPlanCard(plan()).elevatedPrice).toBeUndefined();
  });

  it("maps available_slots to books at a time and max_seats to books per period", () => {
    const card = toMembershipPlanCard(plan({ available_slots: 2, max_seats: 8 }));
    expect(card).toMatchObject({ key: "pkg-1", price: 649, currency: "INR", booksAtOnce: 2, booksPerPeriod: 8 });
  });

  it("reads a missing or zero limit as unlimited", () => {
    expect(toMembershipPlanCard(plan({ available_slots: null, max_seats: undefined }))).toMatchObject({
      booksAtOnce: null,
      booksPerPeriod: null,
    });
    expect(toMembershipPlanCard(plan({ available_slots: 0, max_seats: 0 }))).toMatchObject({
      booksAtOnce: null,
      booksPerPeriod: null,
    });
  });

  it("treats a missing price as zero and a missing name as empty", () => {
    const card = toMembershipPlanCard(plan({ package_name: "", min_plan_actual_price: undefined as unknown as number }));
    expect(card.price).toBe(0);
    expect(card.name).toBe("");
  });
});

describe("toCartMembershipPlan", () => {
  it("stores what the cart's own plan card stores", () => {
    expect(toCartMembershipPlan(plan({ available_slots: 2, max_seats: 8 }))).toEqual({
      id: "invite-1",
      title: "Store Pick Up and Drop 2 Months",
      price: 649,
      numberOfBooks: 2,
      maxSeats: 8,
      packageSessionId: "ps-1",
      enrollInviteId: "invite-1",
    });
  });

  it("falls back to the package id and drops null limits", () => {
    const stored = toCartMembershipPlan(plan({ enroll_invite_id: "", available_slots: null, max_seats: null }));
    expect(stored.id).toBe("pkg-1");
    expect(stored.numberOfBooks).toBeUndefined();
    expect(stored.maxSeats).toBeUndefined();
  });
});

describe("refreshSelectedMembershipPlan", () => {
  // What the cart stored when the plan was picked, before a price cut.
  const stored = toCartMembershipPlan(plan({ available_slots: 2, max_seats: 8 }));

  it("takes today's price and title for the same plan", () => {
    const fresh = plan({ min_plan_actual_price: 349, package_name: "Store Pick Up 2 Months", available_slots: 2, max_seats: 8 });
    expect(refreshSelectedMembershipPlan(stored, [plan({ id: "pkg-2", enroll_invite_id: "invite-2" }), fresh])).toEqual({
      ...stored,
      price: 349,
      title: "Store Pick Up 2 Months",
    });
  });

  it("changes nothing when the plan is unchanged (so the cart never rewrites it in a loop)", () => {
    expect(refreshSelectedMembershipPlan(stored, [plan({ available_slots: 2, max_seats: 8 })])).toBeUndefined();
    // A pick stored before optional limits existed reads the same as one without them.
    const bare = toCartMembershipPlan(plan());
    expect(refreshSelectedMembershipPlan(JSON.parse(JSON.stringify(bare)), [plan()])).toBeUndefined();
  });

  it("drops the pick when its plan is gone", () => {
    expect(refreshSelectedMembershipPlan(stored, [plan({ id: "pkg-2", enroll_invite_id: "invite-2" })])).toBeNull();
    expect(refreshSelectedMembershipPlan(stored, [])).toBeNull();
  });

  it("does nothing without a pick", () => {
    expect(refreshSelectedMembershipPlan(null, [plan()])).toBeUndefined();
    expect(refreshSelectedMembershipPlan(undefined, [])).toBeUndefined();
  });

  it("matches a plan without an invite by its package id, as the cart stores it", () => {
    const noInvite = plan({ enroll_invite_id: "" });
    const storedNoInvite = toCartMembershipPlan(noInvite);
    expect(refreshSelectedMembershipPlan(storedNoInvite, [{ ...noInvite, min_plan_actual_price: 300 }])?.price).toBe(300);
  });
});

describe("buildDepositNotes", () => {
  const deposit: ResolvedCharge = {
    key: "SECURITY_DEPOSIT",
    label: "Security Deposit",
    amount: 300,
    planId: "plan-d",
    packageSessionId: "ps-d",
    enrollInviteId: "invite-d",
    paymentOptionId: "po-d",
    tier: null,
  };
  const settingsWith = (flags: { refundable?: boolean; oncePerUser?: boolean }) =>
    ({
      payment: {
        additionalCharges: [
          {
            key: "SECURITY_DEPOSIT",
            label: "Security Deposit",
            applicableTo: ["MEMBERSHIP"],
            packageSessionId: "ps-d",
            enrollInviteId: "invite-d",
            paymentOptionId: "po-d",
            planId: "plan-d",
            amount: 300,
            ...flags,
          },
        ],
      },
    }) as unknown as GlobalSettings;

  it("is empty when there is no rent-mode charge", () => {
    expect(buildDepositNotes([], settingsWith({ refundable: true }))).toEqual([]);
  });

  it("says refundable / one-time only when the config entry says so", () => {
    const keyFor = (flags: { refundable?: boolean; oncePerUser?: boolean }) =>
      buildDepositNotes([deposit], settingsWith(flags))[0].i18nKey;
    expect(keyFor({})).toBe("membershipPlans.depositNote");
    expect(keyFor({ oncePerUser: true })).toBe("membershipPlans.depositNoteOneTime");
    expect(keyFor({ refundable: true })).toBe("membershipPlans.depositNoteRefundable");
    expect(keyFor({ refundable: true, oncePerUser: true })).toBe("membershipPlans.depositNoteRefundableOneTime");
  });

  it("carries the charge's amount and label", () => {
    expect(buildDepositNotes([deposit], undefined)[0]).toMatchObject({
      key: "SECURITY_DEPOSIT",
      label: "Security Deposit",
      amount: 300,
      i18nKey: "membershipPlans.depositNote",
    });
  });
});
