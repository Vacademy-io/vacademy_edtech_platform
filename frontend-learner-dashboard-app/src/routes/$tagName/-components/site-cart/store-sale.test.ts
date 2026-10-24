import { describe, expect, it } from "vitest";
import { pageSells, sameOffer, storeCartRoute, storeSaleFrom } from "./store-sale";

const store = {
  mappings: [
    { package_session_id: "sold", status: "ACTIVE" },
    { package_session_id: "twice", status: "ACTIVE" },
    { package_session_id: "twice", status: "ACTIVE" },
    { package_session_id: "retired", status: "DELETED" },
  ],
};

describe("storeSaleFrom", () => {
  it("is off without a site cart, whatever the query holds", () => {
    const sale = storeSaleFrom(false, { data: store, isError: false });
    expect(sale.status).toBe("off");
    expect(sale.sells("sold")).toBe(false);
    expect(sale.lists("sold")).toBe(false);
  });

  it("is loading until the store page arrives, and an error when it cannot", () => {
    expect(storeSaleFrom(true, { data: undefined, isError: false }).status).toBe("loading");
    const failed = storeSaleFrom(true, { data: undefined, isError: true });
    expect(failed.status).toBe("error");
    expect(failed.sells("sold")).toBe(false);
    expect(failed.lists("sold")).toBe(false);
  });

  it("sells what the store maps exactly once — a page it has already read stays readable after a failed refetch", () => {
    for (const isError of [false, true]) {
      const sale = storeSaleFrom(true, { data: store, isError });
      expect(sale.status).toBe("ready");
      expect(sale.sells("sold")).toBe(true);
      expect(sale.sells("twice")).toBe(false);
      expect(sale.sells("retired")).toBe(false);
      expect(sale.sells("never")).toBe(false);
      expect(sale.sells(undefined)).toBe(false);
    }
  });

  it("lists what the store maps at all, once or more", () => {
    const sale = storeSaleFrom(true, { data: store, isError: false });
    expect(sale.lists("sold")).toBe(true);
    expect(sale.lists("twice")).toBe(true);
    expect(sale.lists("retired")).toBe(false);
    expect(sale.lists("never")).toBe(false);
    expect(sale.lists(null)).toBe(false);
  });
});

describe("pageSells", () => {
  it("is a page's own versions with exactly one ACTIVE mapping", () => {
    const sells = pageSells(store.mappings);
    expect(sells("sold")).toBe(true);
    expect(sells("twice")).toBe(false);
    expect(sells("retired")).toBe(false);
    expect(sells(undefined)).toBe(false);
    expect(pageSells(null)("sold")).toBe(false);
  });
});

describe("storeCartRoute", () => {
  const ready = storeSaleFrom(true, { data: store, isError: false });
  /** A section whose own page lists each of its courses once. */
  const ownSellsAll = () => true;
  /** The section shows the store page itself. */
  const ownIsStore = pageSells(store.mappings);

  it("goes to the cart only when the store sells every course", () => {
    expect(storeCartRoute(ready, ["sold"], ownSellsAll)).toBe("cart");
    expect(storeCartRoute(ready, ["sold"], ownIsStore)).toBe("cart");
    expect(storeCartRoute(ready, ["sold", "never"], ownSellsAll)).toBe("page");
    expect(storeCartRoute(ready, ["twice"], ownSellsAll)).toBe("page");
    expect(storeCartRoute(ready, ["sold", "twice"], ownSellsAll)).toBe("page");
    expect(storeCartRoute(ready, [], ownSellsAll)).toBe("page");
  });

  it("never sends a course listed twice to a checkout that would charge it twice", () => {
    // The section shows the store page itself: its checkout would select both
    // mappings, so the cart's pre-check holds the course back instead.
    expect(storeCartRoute(ready, ["twice"], ownIsStore)).toBe("cart");
    expect(storeCartRoute(ready, ["sold", "twice"], ownIsStore)).toBe("cart");
    // Its own page lists the course twice as well.
    const ownTwice = pageSells([
      { package_session_id: "twice", status: "ACTIVE" },
      { package_session_id: "twice", status: "ACTIVE" },
      { package_session_id: "sold", status: "ACTIVE" },
    ]);
    expect(storeCartRoute(ready, ["twice", "sold"], ownTwice)).toBe("cart");
    // A course the store does not list at all keeps the own page, as without a site cart.
    expect(storeCartRoute(ready, ["twice", "never"], ownTwice)).toBe("page");
    expect(storeCartRoute(ready, ["never"], () => false)).toBe("page");
  });

  it("offers nothing while the store loads, and the own page when it cannot be read", () => {
    const loading = storeSaleFrom(true, { data: undefined, isError: false });
    const failed = storeSaleFrom(true, { data: undefined, isError: true });
    const off = storeSaleFrom(false, { data: store, isError: false });
    for (const own of [ownSellsAll, ownIsStore]) {
      expect(storeCartRoute(loading, ["sold"], own)).toBe("pending");
      expect(storeCartRoute(failed, ["twice"], own)).toBe("page");
      expect(storeCartRoute(off, ["twice"], own)).toBe("page");
    }
  });
});

describe("store offer for a product page visit", () => {
  const priced = {
    mappings: [
      { package_session_id: "pdf", status: "ACTIVE", payment_plan: { actual_price: 10, currency: "INR" } },
      { package_session_id: "twice", status: "ACTIVE", payment_plan: { actual_price: 5, currency: "INR" } },
      { package_session_id: "twice", status: "ACTIVE", payment_plan: { actual_price: 5, currency: "INR" } },
    ],
  };

  it("is the price the store charges for a version it sells once, else nothing", () => {
    const sale = storeSaleFrom(true, { data: priced, isError: false });
    expect(sale.offer?.("pdf")).toEqual({ price: 10, currency: "INR" });
    expect(sale.offer?.("twice")).toBeNull();
    expect(sale.offer?.("missing")).toBeNull();
    expect(storeSaleFrom(true, { isError: false }).offer?.("pdf")).toBeNull();
    expect(storeSaleFrom(false, { data: priced, isError: false }).offer?.("pdf")).toBeNull();
  });

  it("matches the page's price only when the store charges the same", () => {
    const sale = storeSaleFrom(true, { data: priced, isError: false });
    expect(sameOffer(sale.offer!("pdf"), { price: 10, currency: "INR" })).toBe(true);
    expect(sameOffer(sale.offer!("pdf"), { price: 10, currency: "inr" })).toBe(true);
    expect(sameOffer(sale.offer!("pdf"), { price: 10 })).toBe(true);
    // A promo page at its own price keeps its own checkout.
    expect(sameOffer(sale.offer!("pdf"), { price: 8, currency: "INR" })).toBe(false);
    expect(sameOffer(sale.offer!("pdf"), { price: 10, currency: "USD" })).toBe(false);
    expect(sameOffer(sale.offer!("pdf"), { price: null })).toBe(false);
    expect(sameOffer(null, { price: 10 })).toBe(false);
    expect(sameOffer({ price: null, currency: "INR" }, { price: 10 })).toBe(false);
  });
});
