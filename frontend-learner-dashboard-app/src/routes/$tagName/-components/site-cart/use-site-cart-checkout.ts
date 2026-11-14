import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { handleGetProductPage } from "@/routes/product-pages/$productPageCode/-services/product-page-service";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { storeCheckoutTarget, type SiteCartItem, type SiteCartSettings } from "../../-utils/site-cart";
import { useCatalogueLocale } from "../../-utils/catalogue-locale";
import { canCheckOutDirectly, precheckSiteCart, type SiteCartPrecheck } from "./site-cart-precheck";
import { isStoreCheckoutPath, SITE_CART_CHECKOUT_SOURCE, SITE_CART_MAX_ITEMS } from "./site-cart-items";

export type CheckoutState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "overLimit" }
  | { status: "error" }
  /**
   * The visitor decides first: some items cannot go to checkout as they are,
   * or a price changed since it was added (checkout charges the store's).
   */
  | { status: "review"; result: SiteCartPrecheck };

/** How fresh the store page must be for the pre-check (the checkout then reuses it). */
const STORE_STALE_MS = 30_000;

/**
 * "Checkout" for the site cart: confirms the store product page can sell every
 * item (see site-cart-precheck), then opens its checkout on the cart step with
 * exactly those courses. Anything the store cannot sell — and any price that
 * changed since it was added — is put in front of the visitor instead of being
 * dropped or charged silently.
 */
export const useSiteCartCheckout = ({
  instituteId,
  tagName,
  settings,
  onNavigate,
  beforeCheckout,
}: {
  instituteId: string;
  tagName?: string;
  settings: SiteCartSettings | null | undefined;
  /** Called just before navigating (e.g. to close the drawer). */
  onNavigate?: () => void;
  /**
   * Runs first on "Checkout": settles redirect payments noted earlier and
   * returns the package sessions that left the cart as already paid. When it
   * removed any, the checkout stops — the cart changed under the visitor, who
   * sees it before going on (and never pays for a course twice).
   */
  beforeCheckout?: () => Promise<string[]>;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const { enabled: languagesEnabled, locale, baseLocale } = useCatalogueLocale();
  const [state, setState] = useState<CheckoutState>({ status: "idle" });
  // Bumped by reset(): a check still in flight when the drawer closes or the
  // cart changes must neither navigate nor show a stale result.
  const runRef = useRef(0);

  const storeCode = settings?.storeProductPageCode?.trim() || "";

  const goToCheckout = useCallback(
    (items: SiteCartItem[]) => {
      if (!storeCode || !items.length) return;
      const target = storeCheckoutTarget(storeCode, items, { instituteId, tagName });
      // The visitor's language rides along, so the checkout opens in it.
      const lang = languagesEnabled && locale !== baseLocale ? locale : undefined;
      onNavigate?.();
      setState({ status: "idle" });
      void navigate({
        ...target,
        search: {
          ...target.search,
          // Marks a site-cart arrival: the checkout's Back returns to the page
          // the cart was opened on (with the drawer), not to the site's home.
          source: SITE_CART_CHECKOUT_SOURCE,
          ...(lang ? { lang } : {}),
        },
        replace: isStoreCheckoutPath(router.state?.location?.pathname, storeCode),
      });
    },
    [storeCode, instituteId, tagName, languagesEnabled, locale, baseLocale, onNavigate, navigate, router],
  );

  const runCheckout = useCallback(
    async (items: SiteCartItem[]): Promise<SiteCartPrecheck | null> => {
      if (!storeCode || !items.length) return null;
      if (items.length > SITE_CART_MAX_ITEMS) {
        setState({ status: "overLimit" });
        return null;
      }
      const run = ++runRef.current;
      setState({ status: "checking" });
      try {
        const settled = beforeCheckout ? await beforeCheckout().catch(() => [] as string[]) : [];
        if (run !== runRef.current) return null;
        if (settled.length) {
          setState({ status: "idle" });
          return null;
        }
        const { queryKey, queryFn } = handleGetProductPage(storeCode, instituteId);
        const page = await queryClient.fetchQuery({ queryKey, queryFn, staleTime: STORE_STALE_MS });
        if (run !== runRef.current) return null;
        const result = precheckSiteCart(items, page?.mappings);
        // Prices hidden (Apple store builds): there is no price to confirm.
        if (canCheckOutDirectly(result, { pricesShown: !shouldHidePaidPurchaseUI() })) goToCheckout(result.ready);
        else setState({ status: "review", result });
        return result;
      } catch {
        if (run === runRef.current) setState({ status: "error" });
        return null;
      }
    },
    [storeCode, instituteId, queryClient, goToCheckout, beforeCheckout],
  );

  const reset = useCallback(() => {
    runRef.current += 1;
    setState({ status: "idle" });
  }, []);

  return { state, runCheckout, goToCheckout, reset, storeCode };
};
