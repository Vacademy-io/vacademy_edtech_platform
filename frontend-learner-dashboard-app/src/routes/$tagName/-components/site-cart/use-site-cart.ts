import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSiteCartStore } from "../../-stores/site-cart-store";
import type { SiteCartItem } from "../../-utils/site-cart";
import { useCourseTerms } from "../../-utils/catalogue-naming";
import { useSiteT } from "../../-utils/catalogue-locale";
import { capCartAdd, SITE_CART_MAX_ITEMS, type CapResult } from "./site-cart-items";
import {
  hasSiteCartOpener,
  openSiteCartDrawer,
  subscribeSiteCartOpeners,
  takeSiteCartReopenRequest,
} from "./site-cart-events";

/**
 * Whether the page has a header cart button to open the drawer — live, so a
 * section's own fallback ("View cart" + drawer) appears only on pages without
 * one (header switched off, or a page that hides the site chrome).
 */
export const useHasSiteCartOpener = (): boolean =>
  useSyncExternalStore(subscribeSiteCartOpeners, hasSiteCartOpener, hasSiteCartOpener);

/**
 * A section's own cart drawer reopens after the store checkout's Back, as the
 * header's would — on pages that have no header cart button to do it.
 */
export const useFallbackCartReopen = (enabled: boolean, open: () => void) => {
  useEffect(() => {
    if (enabled && !hasSiteCartOpener() && takeSiteCartReopenRequest()) open();
  }, [enabled, open]);
};

const EMPTY: SiteCartItem[] = [];

/**
 * The site cart as a section sees it: hydrated for this institute, with an
 * `add` that keeps the one-version-per-course rule and the 40-course cap.
 * Inactive (no institute, or the site has no site cart) it holds nothing and
 * every action is a no-op, so a section can call it unconditionally.
 */
export const useSiteCart = (instituteId: string | null | undefined, enabled: boolean) => {
  const active = enabled && !!instituteId;
  const items = useSiteCartStore((s) => (active && s.instituteId === instituteId ? s.items : EMPTY));
  const hydrated = useSiteCartStore((s) => active && s.instituteId === instituteId && s.hydrated);

  useEffect(() => {
    if (active && instituteId) void useSiteCartStore.getState().hydrate(instituteId);
  }, [active, instituteId]);

  const sessionIds = useMemo(() => new Set(items.map((i) => i.packageSessionId)), [items]);
  const has = useCallback((packageSessionId: string) => sessionIds.has(packageSessionId), [sessionIds]);

  const add = useCallback(
    async (incoming: SiteCartItem[]): Promise<CapResult | null> => {
      if (!active || !instituteId || !incoming.length) return null;
      // Never add into a cart that is still loading: hydration would replace
      // the in-memory list (and the stored one) when it lands.
      await useSiteCartStore.getState().hydrate(instituteId);
      const state = useSiteCartStore.getState();
      if (state.instituteId !== instituteId) return null;
      const result = capCartAdd(state.items, incoming);
      if (result.accepted.length) state.addMany(result.accepted);
      return result;
    },
    [active, instituteId],
  );

  const remove = useCallback(
    (packageSessionId: string) => {
      if (active) useSiteCartStore.getState().remove(packageSessionId);
    },
    [active],
  );

  const removeMany = useCallback(
    (packageSessionIds: string[]) => {
      if (active && packageSessionIds.length) useSiteCartStore.getState().removeMany(packageSessionIds);
    },
    [active],
  );

  return { active, items, hydrated, has, add, remove, removeMany };
};

/**
 * Toasts for an add: what went in, what a full cart turned away, and a "View
 * cart" action — the header's drawer when the page has one, else the section's
 * own (`onViewCart`). Course names are translated for display only.
 */
export const useSiteCartNotifier = () => {
  const { t } = useTranslation("coursePlayerB");
  const terms = useCourseTerms();
  const siteT = useSiteT();

  return useCallback(
    (
      result: CapResult | null,
      opts: { previous?: SiteCartItem[]; quiet?: boolean; onViewCart?: () => void } = {},
    ) => {
      if (!result) return;
      const coursesLower = terms.courses.toLocaleLowerCase();
      const onViewCart = hasSiteCartOpener() ? () => void openSiteCartDrawer() : opts.onViewCart;
      const viewCart = onViewCart
        ? { action: { label: t("siteCart.viewCart", "View cart"), onClick: onViewCart } }
        : {};

      if (result.rejected.length && !result.accepted.length) {
        toast.error(
          t("siteCart.full", {
            max: SITE_CART_MAX_ITEMS,
            courses: coursesLower,
            defaultValue: "Your cart is full — up to {{max}} {{courses}} per order.",
          }),
          viewCart,
        );
        return;
      }
      if (result.rejected.length) {
        toast.warning(
          t("siteCart.partiallyAdded", {
            count: result.accepted.length,
            max: SITE_CART_MAX_ITEMS,
            courses: coursesLower,
            defaultValue: "Only {{count}} could be added — a cart holds up to {{max}} {{courses}}.",
          }),
          viewCart,
        );
        return;
      }
      if (opts.quiet || !result.accepted.length) return;

      if (result.accepted.length === 1) {
        const item = result.accepted[0]!;
        const title = siteT(item.title) || terms.course;
        const swapped = (opts.previous || []).some(
          (p) => p.courseId === item.courseId && p.packageSessionId !== item.packageSessionId,
        );
        toast.success(
          swapped
            ? t("siteCart.switchedVersion", { title, defaultValue: "{{title}} updated in your cart" })
            : t("siteCart.added", { title, defaultValue: "{{title}} added to your cart" }),
          viewCart,
        );
        return;
      }
      toast.success(
        t("siteCart.addedMany", {
          count: result.accepted.length,
          courses: coursesLower,
          defaultValue: "{{count}} {{courses}} added to your cart",
        }),
        viewCart,
      );
    },
    [t, terms.course, terms.courses, siteT],
  );
};
