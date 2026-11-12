import { describe, expect, it } from "vitest";
import type { ChargeLine } from "./additional-charges-util";
import {
  DEPOSIT_MISSING_TOKEN,
  DEPOSIT_NOT_DUE_TOKEN,
  buildRentV2Payload,
  findDepositErrorToken,
  rentOrderAmount,
  waivedKeysFromStatus,
  withoutOncePerUserCharges,
  type RentV2PayloadInput,
} from "./rent-checkout-payload";

const deposit: ChargeLine = {
  key: "SECURITY_DEPOSIT",
  label: "Security Deposit",
  amount: 300,
  planId: "plan-deposit",
  packageSessionId: "ps-deposit",
  enrollInviteId: "invite-deposit",
  paymentOptionId: "po-deposit",
  tier: null,
  refundable: true,
  oncePerUser: true,
};

const input = (charges: ChargeLine[]): RentV2PayloadInput => ({
  user: { full_name: "Asha", email: "asha@example.com", root_user: true },
  instituteId: "inst-1",
  catalogueTag: "books",
  membership: {
    packageSessionId: "ps-membership-2m",
    planId: "plan-2m",
    paymentOptionId: "po-2m",
    enrollInviteId: "invite-2m",
    price: 349,
  },
  booksPreferenceFieldId: "field-books",
  books: [
    { title: "Wings of Fire", packageSessionId: "ps-book-a" },
    { title: "Godan", packageSessionId: "ps-book-b" },
    // Same rent session again (another copy line): held once.
    { title: "Wings of Fire", packageSessionId: "ps-book-a" },
    { name: "No Title Field", packageSessionId: " " },
  ],
  charges,
  redirectUrl: "https://shop.example.com/books/cart",
});

const membershipEntry = {
  package_session_id: "ps-membership-2m",
  plan_id: "plan-2m",
  payment_option_id: "po-2m",
  enroll_invite_id: "invite-2m",
  requested_quantity: 1,
  custom_field_values: [
    {
      custom_field_id: "field-books",
      value: "Wings of Fire, Godan, Wings of Fire, No Title Field",
    },
  ],
  requested_book_package_session_ids: ["ps-book-a", "ps-book-b"],
};

const depositEntry = {
  package_session_id: "ps-deposit",
  plan_id: "plan-deposit",
  payment_option_id: "po-deposit",
  enroll_invite_id: "invite-deposit",
  requested_quantity: 1,
};

const axiosError = (status: number, data: unknown) => ({ response: { status, data } });

describe("buildRentV2Payload", () => {
  it("linked and due: the membership first, then the deposit, for plan + deposit", () => {
    expect(buildRentV2Payload(input([deposit]))).toEqual({
      user: { full_name: "Asha", email: "asha@example.com", root_user: true },
      institute_id: "inst-1",
      vendor_id: "RAZORPAY",
      catalogue_tag: "books",
      learner_package_session_enrollments: [membershipEntry, depositEntry],
      payment_initiation_request: {
        amount: 649,
        currency: "INR",
        redirect_url: "https://shop.example.com/books/cart",
        razorpay_request: { redirect_url: "https://shop.example.com/books/cart" },
      },
    });
  });

  it("linked but not due: the membership alone, for the plan price", () => {
    const payload = buildRentV2Payload(input([]));
    expect(payload.learner_package_session_enrollments).toEqual([membershipEntry]);
    expect(payload.payment_initiation_request.amount).toBe(349);
    expect(payload).toHaveProperty("catalogue_tag", "books");
  });

  it("sends no order id, so the server gives the order its multi-item id", () => {
    expect(buildRentV2Payload(input([deposit])).payment_initiation_request).not.toHaveProperty("order_id");
  });

  it("leaves catalogue_tag out when there is no tag", () => {
    expect(buildRentV2Payload({ ...input([deposit]), catalogueTag: undefined })).not.toHaveProperty(
      "catalogue_tag",
    );
  });
});

describe("retry without the deposit", () => {
  const shipping: ChargeLine = {
    ...deposit,
    key: "RENT_SHIPPING",
    label: "Delivery",
    amount: 50,
    planId: "plan-ship",
    packageSessionId: "ps-ship",
    refundable: false,
    oncePerUser: false,
  };

  it("a NOT_DUE refusal is recognised in the wrapped error body", () => {
    const error = axiosError(400, {
      url: "https://api.example.com/admin-core-service/v2/learner/enroll",
      ex: `${DEPOSIT_NOT_DUE_TOKEN}: the security deposit is already paid`,
      responseCode: "400",
    });
    expect(findDepositErrorToken(error)).toBe(DEPOSIT_NOT_DUE_TOKEN);
  });

  it("the resubmitted order drops only the once-per-user charge and its amount", () => {
    const first = buildRentV2Payload(input([deposit, shipping]));
    expect(first.payment_initiation_request.amount).toBe(699);

    const remaining = withoutOncePerUserCharges([deposit, shipping]);
    expect(remaining).toEqual([shipping]);

    const retry = buildRentV2Payload(input(remaining));
    expect(retry.learner_package_session_enrollments).toEqual([
      membershipEntry,
      {
        package_session_id: "ps-ship",
        plan_id: "plan-ship",
        payment_option_id: "po-deposit",
        enroll_invite_id: "invite-deposit",
        requested_quantity: 1,
      },
    ]);
    expect(retry.payment_initiation_request.amount).toBe(399);
  });

  it("with only the deposit, the retry is the membership alone at the plan price", () => {
    const retry = buildRentV2Payload(input(withoutOncePerUserCharges([deposit])));
    expect(retry.learner_package_session_enrollments).toEqual([membershipEntry]);
    expect(retry.payment_initiation_request.amount).toBe(349);
  });
});

describe("findDepositErrorToken", () => {
  it("finds MISSING", () => {
    expect(findDepositErrorToken(axiosError(400, { ex: DEPOSIT_MISSING_TOKEN }))).toBe(
      DEPOSIT_MISSING_TOKEN,
    );
  });

  it("reads a plain-text body", () => {
    expect(findDepositErrorToken(axiosError(400, `Refused: ${DEPOSIT_NOT_DUE_TOKEN}`))).toBe(
      DEPOSIT_NOT_DUE_TOKEN,
    );
  });

  it("ignores other refusals, server errors and network failures", () => {
    expect(findDepositErrorToken(axiosError(409, { ex: "Only 1 left of Godan" }))).toBeNull();
    expect(findDepositErrorToken(axiosError(500, { ex: DEPOSIT_NOT_DUE_TOKEN }))).toBeNull();
    expect(findDepositErrorToken(new Error("Network Error"))).toBeNull();
    expect(findDepositErrorToken(null)).toBeNull();
  });
});

describe("waivedKeysFromStatus", () => {
  const keys = ["SECURITY_DEPOSIT"];

  it("waives the named charge when it is not due", () => {
    expect(waivedKeysFromStatus({ due: false, charge_key: "SECURITY_DEPOSIT", amount: 300 }, keys)).toEqual(
      keys,
    );
  });

  it("waives every once-per-user charge when the answer names none", () => {
    expect(waivedKeysFromStatus({ due: false }, keys)).toEqual(keys);
  });

  it("keeps a charge due when due, unknown, or named differently", () => {
    expect(waivedKeysFromStatus({ due: true, charge_key: "SECURITY_DEPOSIT" }, keys)).toEqual([]);
    expect(waivedKeysFromStatus({}, keys)).toEqual([]);
    expect(waivedKeysFromStatus(null, keys)).toEqual([]);
    expect(waivedKeysFromStatus({ due: false, charge_key: "OTHER" }, keys)).toEqual([]);
  });
});

describe("rentOrderAmount", () => {
  it("adds charges to the plan price without float drift", () => {
    expect(rentOrderAmount(349.1, [{ ...deposit, amount: 300.2 }])).toBe(649.3);
  });
});
