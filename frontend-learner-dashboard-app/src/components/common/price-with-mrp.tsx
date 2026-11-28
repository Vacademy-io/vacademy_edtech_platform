import { useTranslation } from "react-i18next";
import { formatCurrency, getCurrencySymbol } from "@/utils/currency";
import { cn } from "@/lib/utils";
import { Sparkle } from "@phosphor-icons/react";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";

export interface PriceWithMrpProps {
  actual?: number | null;
  elevated?: number | null;
  currency?: string | null;
  /** Visual size for the price text. Defaults to "md". */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /**
   * "stacked" — small struck-through MRP on top, big offer price below with a
   *   "% off" badge (e-commerce default).
   * "inline" — offer price, struck-through MRP and badge all on one line. Good
   *   for tight horizontal layouts (cart rows, etc.).
   * Defaults to "stacked".
   */
  layout?: "stacked" | "inline";
  /** Hide the percent-off badge when true. Defaults to false. */
  hideBadge?: boolean;
  /** When actual is 0, render "Free" instead of a zero amount. Defaults to true. */
  freeForZero?: boolean;
  className?: string;
}

const sizeClassMap: Record<NonNullable<PriceWithMrpProps["size"]>, { actual: string; mrp: string }> = {
  xs: { actual: "text-sm font-semibold", mrp: "text-3xs" },
  sm: { actual: "text-base font-semibold", mrp: "text-xs" },
  md: { actual: "text-lg font-bold", mrp: "text-sm" },
  lg: { actual: "text-2xl font-bold", mrp: "text-base" },
  xl: { actual: "text-3xl font-bold", mrp: "text-lg" },
};

export const computeMrpPercent = (
  actual?: number | null,
  elevated?: number | null
): number | null => {
  if (
    actual == null ||
    elevated == null ||
    elevated <= 0 ||
    actual >= elevated
  ) {
    return null;
  }
  return Math.round(((elevated - actual) / elevated) * 100);
};

/**
 * Format an amount as currency. Falls back to the rupee symbol when no
 * currency code is provided — matches the legacy inline formatting in
 * the catalogue/cart components.
 */
export const formatPriceAmount = (
  amount: number,
  currency?: string | null
): string => {
  if (currency) return formatCurrency(amount, currency);
  const isInt = Number.isInteger(amount);
  return `₹${isInt ? amount : amount.toFixed(2)}`;
};

/**
 * Renders an actual price with a struck-through MRP and a "% off" badge
 * when the actual price is below the elevated price. Falls back to a
 * single price when there is no discount.
 */
export const PriceWithMrp = ({
  actual,
  elevated,
  currency,
  size = "md",
  layout = "stacked",
  hideBadge = false,
  freeForZero = true,
  className,
}: PriceWithMrpProps) => {
  const { t } = useTranslation("layoutCommonA");
  // Reader mode (iOS / reader-mode institutes): hide all pricing. This is the
  // global choke point for every price / MRP / "% off" in the app.
  if (shouldHidePaidPurchaseUI()) {
    return null;
  }

  if (actual == null) {
    return <span className={className}>—</span>;
  }

  if (freeForZero && actual === 0) {
    return (
      <span className={cn("text-green-600 font-semibold", className)}>
        {t("priceWithMrp.free")}
      </span>
    );
  }

  const percent = computeMrpPercent(actual, elevated);
  const sizing = sizeClassMap[size];
  const hasMrp = percent != null;

  if (layout === "inline") {
    return (
      <span className={cn("inline-flex items-baseline flex-wrap gap-x-2 gap-y-0.5", className)}>
        <span className={cn(sizing.actual, "text-gray-900 tracking-tight")}>
          {formatPriceAmount(actual, currency)}
        </span>
        {hasMrp && (
          <>
            <span className={cn(sizing.mrp, "text-gray-500 line-through")}>
              {formatPriceAmount(elevated as number, currency)}
            </span>
            {!hideBadge && (
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700">
                {t("priceWithMrp.percentOff", { percent })}
              </span>
            )}
          </>
        )}
      </span>
    );
  }

  // Stacked: MRP on top (small, struck), actual + badge below (big).
  return (
    <span className={cn("inline-flex flex-col items-start gap-0.5", className)}>
      {hasMrp && (
        <span className={cn(sizing.mrp, "text-gray-500")}>
          {t("priceWithMrp.mrpLabel")}{" "}
          <span className="line-through">
            {formatPriceAmount(elevated as number, currency)}
          </span>
        </span>
      )}
      <span className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
        <span className={cn(sizing.actual, "text-gray-900 tracking-tight")}>
          {formatPriceAmount(actual, currency)}
        </span>
        {hasMrp && !hideBadge && (
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700">
            {t("priceWithMrp.percentOff", { percent })}
          </span>
        )}
      </span>
    </span>
  );
};

/**
 * Small corner ribbon for book / course thumbnails. Renders only when
 * actual < elevated. Intended for absolute positioning on image overlays.
 */
export interface OfferBadgeProps {
  actual?: number | null;
  elevated?: number | null;
  className?: string;
}

export const OfferBadge = ({ actual, elevated, className }: OfferBadgeProps) => {
  const { t } = useTranslation("layoutCommonA");
  // Reader mode: hide all offer/discount/FREE ribbons alongside pricing.
  if (shouldHidePaidPurchaseUI()) {
    return null;
  }
  // Free course → show a "FREE" ribbon instead of a discount percentage.
  // (A 0-priced course would otherwise read as "100% OFF", or show nothing
  //  when there's no elevated price.) Green to match the "Free" price text.
  if (actual === 0) {
    // Solid green pill with a sparkle icon — playful, eye-catching "FREE".
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-green-600 py-1 ps-2 pe-2.5 text-3xs font-bold uppercase tracking-wide text-white shadow-sm",
          className
        )}
      >
        <Sparkle weight="fill" className="size-3" />
        {t("priceWithMrp.freeRibbon")}
      </span>
    );
  }
  const percent = computeMrpPercent(actual, elevated);
  if (percent == null) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-red-500 px-2 py-0.5 text-3xs font-bold uppercase tracking-wide text-white shadow-sm",
        className
      )}
    >
      {t("priceWithMrp.percentOffRibbon", { percent })}
    </span>
  );
};

// Avoid unused-import lint when callers only need the symbol elsewhere.
export { getCurrencySymbol };
