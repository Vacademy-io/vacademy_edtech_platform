// Marketplace / external-payment route prefixes that are hidden when the app
// is in App-Store "reader mode" (native iOS always, or a Mac App Store build).
// Apple Guideline 3.1.1 — no external-gateway purchases in-app.
// Used by the root route's guard and by the learner home's link resolver, so
// both agree on what a "selling" path is.
export const READER_BLOCKED_PATH_PREFIXES = [
  "/courses",
  "/product-pages",
  "/admission/payment",
  "/pay",
  "/payment-result",
  // Sub-org self-registration ends in a Razorpay/Cashfree checkout wizard
  // (and /sub-org-registration/payment-result) — an external-gateway purchase.
  "/sub-org-registration",
  // Parent portal "Payment" tab embeds Razorpay for admission/fee payment.
  // Only the payment sub-route is blocked; the rest of /parent stays reachable.
  "/parent/payment",
] as const;

export const isReaderBlockedPath = (pathname: string): boolean =>
  READER_BLOCKED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
