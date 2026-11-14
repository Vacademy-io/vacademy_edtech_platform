import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowRight,
  ShoppingCartSimple,
  SpinnerGap,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { PriceWithMrp, formatPriceAmount } from "@/components/common/price-with-mrp";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { cartTotals, type SiteCartItem, type SiteCartSettings } from "../../-utils/site-cart";
import type { CourseLanguageOption } from "../../-utils/course-variants";
import { useCourseTerms } from "../../-utils/catalogue-naming";
import { useSiteT } from "../../-utils/catalogue-locale";
import { CourseThumbnail } from "./CourseThumbnail";
import {
  CLOSED_DRAWER_THEME,
  nextDrawerTheme,
  readCatalogueTheme,
  type DrawerThemeState,
} from "./catalogue-theme-snapshot";
import { fetchPaymentOutcome } from "./payment-status";
import { reconcilePendingPurchases } from "./pending-purchases";
import { SITE_CART_MAX_ITEMS, versionLabel } from "./site-cart-items";
import {
  readyAtStorePrices,
  reviewSummary,
  unavailableSessionIds,
  type PrecheckIssue,
  type PriceChange,
} from "./site-cart-precheck";
import { useSiteCart } from "./use-site-cart";
import { useSiteCartCheckout } from "./use-site-cart-checkout";

/** One toast however many times a settled payment is reported (drawer open + checkout). */
const PAID_REMOVED_TOAST_ID = "site-cart-paid-removed";

export interface SiteCartDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instituteId: string;
  tagName?: string;
  /** globalSettings.siteCart of the site. */
  settings: SiteCartSettings;
  /** The site's course languages (globalSettings.courseLanguages), for version chips. */
  languages?: CourseLanguageOption[];
  /** Any element inside the catalogue's theme wrapper — the drawer wears that theme. */
  themeAnchor?: HTMLElement | null;
  /**
   * Bumped by a "Buy now" open request: once the drawer is open with the
   * course in it, run the same checkout as its button (store pre-check, then
   * the store checkout) — problems still show here, nothing is skipped.
   */
  checkoutRequest?: number;
}

/**
 * The site-wide cart: every course added from the Courses page, a learning path
 * or a course page, with one checkout through the site's store product page.
 * A side panel on desktop, a bottom sheet on phones.
 */
export const SiteCartDrawer: React.FC<SiteCartDrawerProps> = ({
  open,
  onOpenChange,
  instituteId,
  tagName,
  settings,
  languages,
  themeAnchor,
  checkoutRequest = 0,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const terms = useCourseTerms();
  const siteT = useSiteT();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const hidePrices = shouldHidePaidPurchaseUI();
  const { items, hydrated, remove, removeMany } = useSiteCart(instituteId, true);

  // A redirect payment noted earlier (see pending-purchases) may have settled
  // since the page loaded: ask again when the drawer opens and just before
  // checkout, so a course already paid for leaves the cart instead of being
  // bought twice. No request unless such a payment is noted.
  const announcePaid = useCallback(
    (count: number) =>
      toast.success(
        t("siteCart.paidRemoved", {
          count,
          course: (count === 1 ? terms.course : terms.courses).toLocaleLowerCase(),
          defaultValue: "Removed {{count}} {{course}} you've already paid for.",
        }),
        { id: PAID_REMOVED_TOAST_ID },
      ),
    [t, terms.course, terms.courses],
  );
  const announcePaidRef = useRef(announcePaid);
  useEffect(() => {
    announcePaidRef.current = announcePaid;
  }, [announcePaid]);
  const settlePaid = useCallback(async (): Promise<string[]> => {
    const removed = await reconcilePendingPurchases(instituteId, fetchPaymentOutcome, { force: true });
    if (removed.length) announcePaidRef.current(removed.length);
    return removed;
  }, [instituteId]);
  useEffect(() => {
    if (open) void settlePaid();
  }, [open, settlePaid]);

  const { state, runCheckout, goToCheckout, reset } = useSiteCartCheckout({
    instituteId,
    tagName,
    settings,
    onNavigate: () => onOpenChange(false),
    beforeCheckout: settlePaid,
  });

  // The site's palette, read when the drawer opens and kept while it animates
  // closed (see nextDrawerTheme) — the closing sheet never flashes to the
  // app's default colours.
  const [themeState, setThemeState] = useState<DrawerThemeState<HTMLElement>>(() =>
    nextDrawerTheme<HTMLElement>(CLOSED_DRAWER_THEME, open, themeAnchor, readCatalogueTheme),
  );
  const nextTheme = nextDrawerTheme(themeState, open, themeAnchor, readCatalogueTheme);
  if (nextTheme !== themeState) setThemeState(nextTheme);
  const theme = nextTheme.theme;

  // A changed cart (or a reopened drawer) invalidates the last availability check.
  const itemsKey = items.map((i) => `${i.packageSessionId}:${i.courseId}`).join(",");
  useEffect(() => {
    reset();
  }, [itemsKey, open, reset]);

  // "Buy now": checkout once per request, after the reset above and only when
  // the cart has loaded with something to buy.
  const handledCheckoutRequest = useRef(checkoutRequest);
  useEffect(() => {
    if (!open || !hydrated || !items.length) return;
    if (checkoutRequest === handledCheckoutRequest.current) return;
    handledCheckoutRequest.current = checkoutRequest;
    void runCheckout(items);
  }, [open, hydrated, items, checkoutRequest, runCheckout]);

  // Stable row keys; a duplicated version (only possible in a hand-edited
  // store) gets a suffix instead of colliding.
  const rowKeys = useMemo(() => {
    const seen = new Map<string, number>();
    return items.map((i) => {
      const n = seen.get(i.packageSessionId) ?? 0;
      seen.set(i.packageSessionId, n + 1);
      return n ? `${i.packageSessionId}#${n}` : i.packageSessionId;
    });
  }, [items]);

  const review = state.status === "review" ? state.result : null;
  const issues = useMemo(() => {
    const map = new Map<SiteCartItem, PrecheckIssue>();
    for (const f of review?.flagged || []) map.set(f.item, f.issue);
    return map;
  }, [review]);
  const priceChanges = useMemo(() => {
    const map = new Map<SiteCartItem, PriceChange>();
    if (!hidePrices) for (const c of review?.priceChanges || []) map.set(c.item, c);
    return map;
  }, [review, hidePrices]);
  const summary = review ? reviewSummary(review) : null;
  // The total for what the button does: during a review, the courses that go
  // on to checkout at the prices it charges; otherwise (or when none can) the
  // cart as added.
  const totals = useMemo(
    () => cartTotals(review?.ready.length ? readyAtStorePrices(review) : items),
    [review, items],
  );

  const coursesLower = terms.courses.toLocaleLowerCase();
  const countLabel = (count: number) =>
    t("siteCart.itemCount", {
      count,
      course: (count === 1 ? terms.course : terms.courses).toLocaleLowerCase(),
      defaultValue: "{{count}} {{course}}",
    });

  const issueText = (issue: PrecheckIssue) => {
    switch (issue) {
      case "notInStore":
        return t("siteCart.issue.notInStore", "Not available for online checkout.");
      case "listedTwice":
        return t(
          "siteCart.issue.listedTwice",
          "Listed twice at checkout — please contact the institute before buying it.",
        );
      case "otherCurrency":
        return t("siteCart.issue.otherCurrency", "Priced in a different currency — check it out separately.");
      default:
        return t("siteCart.issue.duplicateInCart", "Already in your cart above — remove one.");
    }
  };
  const priceText = (amount: number, currency?: string | null) =>
    amount === 0 ? t("productPageOffer.free", "Free") : formatPriceAmount(amount, currency);

  const checking = state.status === "checking";
  const full = items.length >= SITE_CART_MAX_ITEMS;
  const removable = review ? unavailableSessionIds(review) : [];

  const panelClass = cn(
    "flex flex-col gap-0 border-catalogue-border bg-catalogue-bg p-0 text-catalogue-text-primary",
    // sm:max-w-md (not a reg-* size) so cn() replaces the sheet's own sm:max-w-sm.
    isDesktop ? "w-full sm:max-w-md" : "max-h-screen-85 rounded-t-catalogue-xl",
    theme?.dark && "dark",
  );

  const body = !hydrated ? (
    <ul className="space-y-3" aria-busy="true" aria-label={t("siteCart.loading", "Loading your cart…")}>
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex gap-3">
          <div className="catalogue-skeleton-shimmer size-14 shrink-0 rounded-catalogue-md" />
          <div className="flex-1 space-y-2 py-1">
            <div className="catalogue-skeleton-shimmer h-4 w-3/4 rounded-catalogue-xs" />
            <div className="catalogue-skeleton-shimmer h-3 w-1/3 rounded-catalogue-xs" />
          </div>
        </li>
      ))}
    </ul>
  ) : items.length === 0 ? (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-50 text-catalogue-brand-ink">
        <ShoppingCartSimple className="size-7" weight="duotone" aria-hidden="true" />
      </span>
      <p className="text-base font-semibold text-catalogue-text-primary">
        {t("siteCart.empty.title", "Your cart is empty")}
      </p>
      <p className="mt-1 max-w-xs text-sm text-catalogue-text-muted">
        {t("siteCart.empty.body", {
          courses: coursesLower,
          defaultValue: "Add {{courses}} here to buy them together in one payment.",
        })}
      </p>
      <SheetClose asChild>
        <button type="button" className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm mt-5">
          {t("siteCart.continue", "Continue browsing")}
        </button>
      </SheetClose>
    </div>
  ) : (
    <ul className="divide-y divide-catalogue-border">
      {items.map((item, index) => {
        const issue = issues.get(item);
        const change = priceChanges.get(item);
        const title = siteT(item.title) || terms.course;
        const version = versionLabel(item, languages, siteT);
        return (
          <li key={rowKeys[index]} className="flex gap-3 py-3">
            <CourseThumbnail image={item.image} className="size-14" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold leading-snug text-catalogue-text-primary">
                {title}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {version && (
                  <span
                    title={siteT(version.label)}
                    className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-semibold text-catalogue-brand-ink ring-1 ring-primary-100"
                  >
                    {siteT(version.chip)}
                  </span>
                )}
                {version?.level && (
                  <span className="text-xs font-medium text-catalogue-text-secondary">{version.level}</span>
                )}
                {change && typeof item.price === "number" ? (
                  // The price the cart showed → what checkout charges now.
                  <span className="inline-flex flex-wrap items-center gap-1 text-xs">
                    <span className="sr-only">
                      {t("siteCart.priceChangedFromTo", {
                        from: priceText(item.price, item.currency),
                        to: priceText(change.storePrice, change.currency),
                        defaultValue: "Price changed from {{from}} to {{to}}",
                      })}
                    </span>
                    <span aria-hidden="true" className="text-catalogue-text-muted line-through">
                      {priceText(item.price, item.currency)}
                    </span>
                    <ArrowRight
                      className="size-3 text-catalogue-text-muted rtl:rotate-180"
                      weight="bold"
                      aria-hidden="true"
                    />
                    <span aria-hidden="true" className="font-semibold text-catalogue-text-primary">
                      {priceText(change.storePrice, change.currency)}
                    </span>
                  </span>
                ) : (
                  !hidePrices &&
                  typeof item.price === "number" && (
                    <PriceWithMrp
                      actual={item.price}
                      elevated={item.elevatedPrice}
                      currency={item.currency}
                      size="xs"
                      layout="inline"
                      hideBadge
                    />
                  )
                )}
              </div>
              {issue && (
                <p
                  className={cn(
                    "mt-1.5 flex items-start gap-1.5 text-xs font-medium",
                    issue === "otherCurrency" ? "text-warning-700" : "text-danger-600",
                  )}
                >
                  <WarningCircle className="mt-px size-3.5 shrink-0" weight="bold" aria-hidden="true" />
                  {issueText(issue)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => remove(item.packageSessionId)}
              disabled={checking}
              aria-label={t("siteCart.remove", { title, defaultValue: "Remove {{title}}" })}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-catalogue-text-muted transition-colors hover:bg-catalogue-interactive-hover hover:text-catalogue-text-primary disabled:opacity-40"
            >
              <Trash className="size-4" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );

  const notice = (tone: "danger" | "warning" | "info", message: string) => (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-catalogue-md px-3 py-2 text-xs font-medium",
        tone === "danger" && "bg-danger-50 text-danger-700",
        tone === "warning" && "bg-warning-50 text-warning-700",
        tone === "info" && "bg-info-50 text-info-700",
      )}
    >
      <WarningCircle className="mt-px size-4 shrink-0" weight="bold" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );

  const footer = hydrated && items.length > 0 && (
    // On phones the bottom sheet's footer clears the home indicator.
    <footer
      className={cn(
        "space-y-3 border-t border-catalogue-border px-5 pt-4",
        isDesktop ? "pb-4" : "catalogue-mobile-cta",
      )}
    >
      {full &&
        state.status !== "overLimit" &&
        notice(
          "info",
          t("siteCart.full", {
            max: SITE_CART_MAX_ITEMS,
            courses: coursesLower,
            defaultValue: "Your cart is full — up to {{max}} {{courses}} per order.",
          }),
        )}
      {state.status === "overLimit" &&
        notice(
          "danger",
          t("siteCart.overLimit", {
            max: SITE_CART_MAX_ITEMS,
            courses: coursesLower,
            defaultValue: "One order holds up to {{max}} {{courses}}. Remove some to check out.",
          }),
        )}
      {state.status === "error" &&
        notice("danger", t("siteCart.storeError", "Checkout is unavailable right now. Please try again."))}
      {review &&
        summary &&
        summary.blocked.length > 0 &&
        notice(
          "warning",
          review.ready.length
            ? t("siteCart.issuesSummary", {
                courses: coursesLower,
                defaultValue: "Some {{courses}} can't be checked out right now — see the notes above.",
              })
            : t("siteCart.noneAvailable", {
                courses: coursesLower,
                defaultValue: "None of these {{courses}} can be checked out online yet.",
              }),
        )}
      {summary &&
        summary.otherCurrency.length > 0 &&
        notice(
          "warning",
          t("siteCart.otherCurrencySummary", {
            courses: coursesLower,
            defaultValue: "Some {{courses}} are priced in a different currency — check them out separately.",
          }),
        )}
      {priceChanges.size > 0 &&
        notice("info", t("siteCart.priceChanged", "Some prices have changed — checkout shows the current price."))}

      {!hidePrices && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-catalogue-text-muted">{t("siteCart.total", "Total")}</span>
          {totals.total === null ? (
            <span className="text-sm text-catalogue-text-muted">
              {t("siteCart.totalAtCheckout", "Shown at checkout")}
            </span>
          ) : (
            <span className="flex items-baseline gap-2">
              {totals.elevatedTotal !== null && totals.elevatedTotal > totals.total && (
                <span className="text-xs text-catalogue-text-muted line-through">
                  {formatPriceAmount(totals.elevatedTotal, totals.currency)}
                </span>
              )}
              <span className="text-lg font-bold text-catalogue-text-primary">
                {totals.total === 0
                  ? t("productPageOffer.free", "Free")
                  : formatPriceAmount(totals.total, totals.currency)}
              </span>
            </span>
          )}
        </div>
      )}

      {review ? (
        <div className="flex flex-col gap-2">
          {review.ready.length > 0 && (
            <button
              type="button"
              onClick={() => goToCheckout(review.ready)}
              className="catalogue-btn catalogue-btn-primary w-full justify-center"
            >
              {/* Only prices changed: everything goes on, at the store's prices. */}
              {summary?.priceOnly
                ? t("siteCart.continueAtCurrentPrices", "Continue at current prices")
                : t("siteCart.checkoutAvailable", {
                    count: review.ready.length,
                    defaultValue: "Check out {{count}} available",
                  })}
              <ArrowRight className="size-4 rtl:rotate-180" weight="bold" aria-hidden="true" />
            </button>
          )}
          {removable.length > 0 && (
            <button
              type="button"
              onClick={() => removeMany(removable)}
              className="catalogue-btn catalogue-btn-secondary w-full justify-center"
            >
              {t("siteCart.removeUnavailable", "Remove unavailable")}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void runCheckout(items)}
          disabled={checking || state.status === "overLimit"}
          aria-busy={checking || undefined}
          className="catalogue-btn catalogue-btn-primary w-full justify-center disabled:opacity-60"
        >
          {checking ? (
            <>
              <SpinnerGap className="size-4 animate-spin" aria-hidden="true" />
              {t("siteCart.checking", "Checking availability…")}
            </>
          ) : (
            <>
              {state.status === "error" ? t("siteCart.retry", "Try again") : t("siteCart.checkout", "Checkout")}
              <ArrowRight className="size-4 rtl:rotate-180" weight="bold" aria-hidden="true" />
            </>
          )}
        </button>
      )}
    </footer>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        hideCloseButton
        aria-describedby={undefined}
        {...(theme?.attrs ?? {})}
        // design-lint-ignore: the site's own palette, copied from its theme wrapper (data-driven)
        style={theme?.vars}
        className={panelClass}
      >
        <header className="flex items-center justify-between gap-3 border-b border-catalogue-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-lg font-semibold text-catalogue-text-primary">
              {t("siteCart.title", "Your cart")}
            </SheetTitle>
            {hydrated && items.length > 0 && (
              <p className="text-xs text-catalogue-text-muted">{countLabel(items.length)}</p>
            )}
          </div>
          <SheetClose asChild>
            <button
              type="button"
              aria-label={t("siteCart.close", "Close cart")}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-catalogue-text-secondary transition-colors hover:bg-catalogue-interactive-hover hover:text-catalogue-text-primary"
            >
              <X className="size-5" weight="bold" aria-hidden="true" />
            </button>
          </SheetClose>
        </header>
        {/* min-h-0: lets the list scroll inside the sheet's max height. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{body}</div>
        {footer}
      </SheetContent>
    </Sheet>
  );
};

export default SiteCartDrawer;
