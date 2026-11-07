/**
 * Short money labels for filter options and chips ("Under ₹1,000"), in the
 * visitor's site language. Whole amounts get no decimals. Pure.
 */
export const formatAmountLabel = (
  amount: number,
  currency: string | null | undefined,
  locale: string | null | undefined,
): string => {
  const code = (currency || "INR").trim().toUpperCase();
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(locale || "en", {
      style: "currency",
      currency: code,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${code} ${whole ? amount : amount.toFixed(2)}`;
  }
};

/** "₹500 – ₹2,000", "≥ ₹500" or "≤ ₹2,000" for the price-range chip. */
export const formatRangeLabel = (
  range: { min?: number; max?: number },
  currency: string | null | undefined,
  locale: string | null | undefined,
): string => {
  const fmt = (n: number) => formatAmountLabel(n, currency, locale);
  if (range.min !== undefined && range.max !== undefined) return `${fmt(range.min)} – ${fmt(range.max)}`;
  if (range.min !== undefined) return `≥ ${fmt(range.min)}`;
  return `≤ ${fmt(range.max ?? 0)}`;
};
