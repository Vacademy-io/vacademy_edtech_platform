import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShoppingCartSimple } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { isSiteCartEnabled, type SiteCartSettings } from "../../-utils/site-cart";
import { useSiteCartStore } from "../../-stores/site-cart-store";
import type { CourseLanguageOption } from "../../-utils/course-variants";
import { SiteCartDrawer } from "./SiteCartDrawer";
import { registerSiteCartOpener } from "./site-cart-events";
import { reconcilePendingPurchases } from "./pending-purchases";
import { fetchPaymentOutcome } from "./payment-status";
import { useSiteCart } from "./use-site-cart";

/**
 * Header cart button for the site-wide course cart (-stores/site-cart-store.ts):
 * a cart icon with a count, opening the cart drawer. Renders nothing unless the
 * site has a site cart (globalSettings.siteCart with a store product page), so
 * sites without one are unaffected.
 *
 * Other sections open the drawer with
 * `window.dispatchEvent(new CustomEvent('siteCartOpen'))` (see site-cart-events).
 */
export interface SiteCartButtonProps {
  instituteId?: string;
  tagName?: string;
  /** globalSettings.siteCart of the site being rendered. */
  settings?: SiteCartSettings | null;
  /** globalSettings.courseLanguages languages, for the drawer's version chips. */
  languages?: CourseLanguageOption[];
  className?: string;
  /**
   * Hide the icon while the cart is empty (header cartDisplay "whenNotEmpty").
   * The drawer and its opener stay mounted, so "Add to cart" / "Buy now"
   * elsewhere still open it, and the icon appears with the first item.
   * Absent = always shown, as before.
   */
  hideWhenEmpty?: boolean;
}

const SiteCartButtonInner: React.FC<
  Required<Pick<SiteCartButtonProps, "instituteId">> & SiteCartButtonProps & { settings: SiteCartSettings }
> = ({ instituteId, tagName, settings, languages, className, hideWhenEmpty }) => {
  const { t } = useTranslation("coursePlayerB");
  const { items, hydrated } = useSiteCart(instituteId, true);
  const lastAddedAt = useSiteCartStore((s) => (s.instituteId === instituteId ? s.lastAddedAt : 0));
  const [open, setOpen] = useState(false);
  // Bumped by a "Buy now" open request: the drawer goes straight on to checkout once.
  const [checkoutRequest, setCheckoutRequest] = useState(0);
  const [bump, setBump] = useState(false);
  // State, not a ref: the drawer reads the theme wrapper through this node.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  // The drawer opens from anywhere: a learning path, a course card.
  useEffect(
    () =>
      registerSiteCartOpener((request) => {
        setOpen(true);
        if (request?.intent === "checkout") setCheckoutRequest((n) => n + 1);
      }),
    [],
  );

  // A payment that left for a redirect gateway may have settled since: drop
  // what it bought from the cart (no request unless such a payment is noted).
  useEffect(() => {
    if (hydrated) void reconcilePendingPurchases(instituteId, fetchPaymentOutcome);
  }, [hydrated, instituteId]);

  // A short pulse on the badge when something is added.
  const firstAdd = useRef(lastAddedAt);
  useEffect(() => {
    if (!lastAddedAt || lastAddedAt === firstAdd.current) return;
    setBump(true);
    const timer = window.setTimeout(() => setBump(false), 600);
    return () => window.clearTimeout(timer);
  }, [lastAddedAt]);

  const count = hydrated ? items.length : 0;
  const label =
    count > 0
      ? t("siteCart.openWithCount", { count, defaultValue: "Open cart, {{count}} in cart" })
      : t("siteCart.open", "Open cart");

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "relative rounded-catalogue-sm p-2 text-catalogue-text-secondary transition-colors duration-200 hover:bg-catalogue-interactive-hover hover:text-catalogue-text-primary",
          className,
          hideWhenEmpty && count === 0 && "hidden",
        )}
      >
        <ShoppingCartSimple className="size-5" aria-hidden="true" />
        {count > 0 && (
          <span
            className={cn(
              "absolute -end-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-500 px-1 text-caption font-semibold text-white transition-transform duration-200",
              bump && "scale-125",
            )}
            aria-hidden="true"
          >
            {count}
          </span>
        )}
      </button>
      <SiteCartDrawer
        open={open}
        onOpenChange={setOpen}
        instituteId={instituteId}
        tagName={tagName}
        settings={settings}
        languages={languages}
        themeAnchor={anchor}
        checkoutRequest={checkoutRequest}
      />
    </>
  );
};

export const SiteCartButton: React.FC<SiteCartButtonProps> = (props) => {
  if (!props.instituteId || !isSiteCartEnabled(props.settings)) return null;
  return <SiteCartButtonInner {...props} instituteId={props.instituteId} settings={props.settings!} />;
};

export default SiteCartButton;
