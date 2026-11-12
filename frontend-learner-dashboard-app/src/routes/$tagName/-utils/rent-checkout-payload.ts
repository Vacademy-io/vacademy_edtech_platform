import { ChargeLine, buildChargeEnrollmentEntries, sumChargeAmounts } from "./additional-charges-util";

/**
 * The rent (membership) checkout once the catalogue links a rent-mode charge, such as the
 * refundable security deposit: one v2 order (`/v2/learner/enroll`) carrying the membership plan
 * first — it is the item that initiates the payment — then one entry per charge due.
 *
 * Pure, so the request shape is testable without the checkout dialog.
 */

/** A 4xx from the enroll call whose body names one of these is about a once-per-user charge. */
export const DEPOSIT_NOT_DUE_TOKEN = "SECURITY_DEPOSIT_NOT_DUE";
export const DEPOSIT_MISSING_TOKEN = "SECURITY_DEPOSIT_MISSING";
export type DepositErrorToken = typeof DEPOSIT_NOT_DUE_TOKEN | typeof DEPOSIT_MISSING_TOKEN;

/** A book in the rent cart: what its picks are noted and held by. */
export interface RentBookLine {
  title?: string;
  name?: string;
  packageSessionId?: string;
}

/** The membership plan the learner picked, resolved to the ids the order enrolls it by. */
export interface RentMembershipLine {
  packageSessionId: string;
  planId: string;
  paymentOptionId: string;
  enrollInviteId: string;
  /** The plan's price alone, without any charge. */
  price: number;
}

export interface RentV2PayloadInput {
  user: Record<string, unknown>;
  instituteId: string;
  /** The storefront catalogue tag: the server reads its rent-mode charges from it. */
  catalogueTag?: string;
  membership: RentMembershipLine;
  /** The institute's "Books Preference" custom field, which notes the picked titles. */
  booksPreferenceFieldId: string;
  books: RentBookLine[];
  /** The charges this order pays (a deposit the learner no longer owes left out). */
  charges: ChargeLine[];
  redirectUrl: string;
}

/** The picked titles as the Books Preference field stores them: "A, B, C". */
export const rentBooksPreferenceValue = (books: RentBookLine[]): string =>
  books.map((book) => book.title || book.name || "Unknown Book").join(", ");

/** The rent package session of each picked book, which the server holds one of while the
 *  learner pays. De-duplicated, blanks dropped. */
export const rentRequestedBookPackageSessionIds = (books: RentBookLine[]): string[] => [
  ...new Set(
    books
      .map((book) => book.packageSessionId)
      .filter((id): id is string => typeof id === "string" && id.trim() !== ""),
  ),
];

/** Plan price plus the charges, to the paisa (the server compares within 0.01). */
export const rentOrderAmount = (planPrice: number, charges: ChargeLine[]): number =>
  Math.round((planPrice + sumChargeAmounts(charges)) * 100) / 100;

export const buildRentV2Payload = (input: RentV2PayloadInput) => ({
  user: input.user,
  institute_id: input.instituteId,
  vendor_id: "RAZORPAY",
  ...(input.catalogueTag ? { catalogue_tag: input.catalogueTag } : {}),
  learner_package_session_enrollments: [
    {
      package_session_id: input.membership.packageSessionId,
      plan_id: input.membership.planId,
      payment_option_id: input.membership.paymentOptionId,
      enroll_invite_id: input.membership.enrollInviteId,
      requested_quantity: 1,
      custom_field_values: [
        {
          custom_field_id: input.booksPreferenceFieldId,
          value: rentBooksPreferenceValue(input.books),
        },
      ],
      requested_book_package_session_ids: rentRequestedBookPackageSessionIds(input.books),
    },
    ...buildChargeEnrollmentEntries(input.charges),
  ],
  // No order_id: the server then gives the order its "MP…" id, which invoicing reads as one
  // multi-item order (a client id would invoice the deposit apart from the plan).
  payment_initiation_request: {
    amount: rentOrderAmount(input.membership.price, input.charges),
    currency: "INR",
    redirect_url: input.redirectUrl,
    razorpay_request: {
      redirect_url: input.redirectUrl,
    },
  },
});

/** The charges left once the ones charged only on a user's first order are dropped. */
export const withoutOncePerUserCharges = (charges: ChargeLine[]): ChargeLine[] =>
  charges.filter((charge) => !charge.oncePerUser);

/**
 * Which deposit token a failed enroll call carries, if any. The server wraps its message in an
 * error DTO (`{ ex, responseCode, … }`), so the whole body is searched. A 5xx is never one.
 */
export const findDepositErrorToken = (error: unknown): DepositErrorToken | null => {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (!response || response.data === undefined || response.data === null) return null;
  if (typeof response.status === "number" && response.status >= 500) return null;
  let body: string;
  try {
    body = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  } catch {
    return null;
  }
  if (body.includes(DEPOSIT_NOT_DUE_TOKEN)) return DEPOSIT_NOT_DUE_TOKEN;
  if (body.includes(DEPOSIT_MISSING_TOKEN)) return DEPOSIT_MISSING_TOKEN;
  return null;
};

/**
 * The once-per-user charge keys the security-deposit status says the learner no longer owes:
 * only an explicit `due: false` waives anything (missing / odd answers leave it due). When the
 * answer names its `charge_key`, only that charge is waived.
 */
export const waivedKeysFromStatus = (status: unknown, oncePerUserKeys: string[]): string[] => {
  if (!status || typeof status !== "object") return [];
  const { due, charge_key: chargeKey } = status as { due?: unknown; charge_key?: unknown };
  if (due !== false) return [];
  if (typeof chargeKey === "string" && chargeKey !== "") {
    return oncePerUserKeys.filter((key) => key === chargeKey);
  }
  return [...oncePerUserKeys];
};
