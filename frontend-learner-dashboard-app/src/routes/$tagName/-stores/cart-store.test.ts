/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory preferences storage.
const storage = new Map<string, string>();

vi.mock("../../../utils/preferences-storage", () => ({
  preferencesGet: async (key: string) => ({ value: storage.has(key) ? storage.get(key)! : null }),
  preferencesSet: async (key: string, value: string) => {
    storage.set(key, value);
  },
}));

const { useCartStore, getPendingCartMode, clearPendingCheckout } = await import("./cart-store");

const book = (id: string) => ({ id, title: id, price: 100, quantity: 1 });
const stored = (key: string) => JSON.parse(storage.get(key) || "[]").map((i: { id: string }) => i.id);
const plan = { id: "membership", title: "Membership", price: 1299 };

beforeEach(() => {
  storage.clear();
  sessionStorage.clear();
  localStorage.clear();
  storage.set("cart_items_buy", JSON.stringify([book("bought")]));
  storage.set("cart_items_rent", JSON.stringify([book("rented")]));
  storage.set("cart_plan", JSON.stringify(plan));
  useCartStore.setState({ items: [book("bought")], membershipPlan: plan });
});

describe("clearCart", () => {
  it("clears the current mode's cart when no mode is given", async () => {
    sessionStorage.setItem("levelFilter", "buy");
    await useCartStore.getState().clearCart();
    expect(stored("cart_items_buy")).toEqual([]);
    expect(stored("cart_items_rent")).toEqual(["rented"]);
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().membershipPlan).toEqual(plan);
  });

  it("a rent order confirmed in a tab that shows the buy cart clears the rent cart, not the buy cart", async () => {
    sessionStorage.setItem("levelFilter", "buy");
    await useCartStore.getState().clearCart("rent");
    expect(stored("cart_items_rent")).toEqual([]);
    expect(storage.get("cart_plan")).toBe("null");
    expect(stored("cart_items_buy")).toEqual(["bought"]);
    // The buy cart on screen stays; the rent plan goes with the rent cart.
    expect(useCartStore.getState().items.map((i) => i.id)).toEqual(["bought"]);
    expect(useCartStore.getState().membershipPlan).toBeNull();
  });

  it("a buy order confirmed in a fresh tab (no cart mode) clears the buy cart and keeps the rent plan", async () => {
    await useCartStore.getState().clearCart("buy");
    expect(stored("cart_items_buy")).toEqual([]);
    expect(stored("cart_items_rent")).toEqual(["rented"]);
    expect(storage.get("cart_plan")).toBe(JSON.stringify(plan));
  });
});

describe("getPendingCartMode", () => {
  it("reads the cart the pending order came from", () => {
    localStorage.setItem("pendingCartMode", "rent");
    expect(getPendingCartMode()).toBe("rent");
  });

  it("is undefined for an order noted before the mode was kept, or an unknown value", () => {
    expect(getPendingCartMode()).toBeUndefined();
    localStorage.setItem("pendingCartMode", "something");
    expect(getPendingCartMode()).toBeUndefined();
  });

  it("is forgotten with the rest of the pending checkout", () => {
    localStorage.setItem("pendingCartMode", "buy");
    clearPendingCheckout();
    expect(getPendingCartMode()).toBeUndefined();
  });
});
