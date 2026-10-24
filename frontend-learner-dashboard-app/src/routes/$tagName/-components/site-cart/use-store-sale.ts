import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { handleGetProductPage } from "@/routes/product-pages/$productPageCode/-services/product-page-service";
import { isSiteCartEnabled, type SiteCartSettings } from "../../-utils/site-cart";
import { storeSaleFrom, type StoreSale } from "./store-sale";

/**
 * Which courses the site's store page sells (see store-sale), for sections
 * that add another product page's courses to the site cart.
 *
 * Read through the product-page query itself — same key and fetch as the
 * store checkout and the cart's pre-check — so one request serves them all
 * and the checkout reuses it. `enabled` false (no site cart, or the section
 * does not use it) reads nothing and makes no request.
 */
export const useStoreSale = (
  instituteId: string | null | undefined,
  settings: SiteCartSettings | null | undefined,
  enabled: boolean,
): StoreSale => {
  const on = enabled && !!instituteId && isSiteCartEnabled(settings);
  const storeCode = on ? settings!.storeProductPageCode!.trim() : "";
  const { data, isError } = useQuery({
    ...handleGetProductPage(storeCode, on ? instituteId! : ""),
    enabled: on,
    // A store page that will not load sends sections to their own checkout;
    // one retry, so their buttons do not wait on it for long.
    retry: 1,
  });
  return useMemo(() => storeSaleFrom(on, { data, isError }), [on, data, isError]);
};
