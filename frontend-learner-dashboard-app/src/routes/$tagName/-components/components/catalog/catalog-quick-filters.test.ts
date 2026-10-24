import { describe, expect, it } from "vitest";
import type { ResolvedQuickFilter } from "./catalog-config";
import { isQuickFilterActive, toggleQuickFilter, type QuickFilterState } from "./catalog-quick-filters";

const qf = (kind: ResolvedQuickFilter["kind"], value?: string | number): ResolvedQuickFilter => ({
  id: kind,
  label: "",
  kind,
  ...(value !== undefined ? { value } : {}),
});

const S: QuickFilterState = { languages: [], price: null, badges: [], sort: "Newest" };

describe("quick filters drive the same state as the sidebar and sort", () => {
  it("Popular toggles the Popular sort and back to the default", () => {
    const popular = qf("popular");
    expect(isQuickFilterActive(popular, S)).toBe(false);
    expect(toggleQuickFilter(popular, S, "Price: Low to High")).toEqual({ sort: "Popular" });
    const on = { ...S, sort: "Popular" as const };
    expect(isQuickFilterActive(popular, on)).toBe(true);
    expect(toggleQuickFilter(popular, on, "Price: Low to High")).toEqual({ sort: "Price: Low to High" });
    expect(toggleQuickFilter(popular, on, "Popular")).toEqual({ sort: "Newest" });
  });

  it("New and Bestseller toggle badge filters without touching the others", () => {
    const withBest = { ...S, badges: ["bestseller" as const] };
    expect(toggleQuickFilter(qf("new"), withBest, "Newest")).toEqual({ badges: ["bestseller", "new"] });
    expect(isQuickFilterActive(qf("bestseller"), withBest)).toBe(true);
    expect(toggleQuickFilter(qf("bestseller"), withBest, "Newest")).toEqual({ badges: [] });
  });

  it("Free is the price filter's Free", () => {
    expect(toggleQuickFilter(qf("free"), S, "Newest")).toEqual({ price: { kind: "free" } });
    const free = { ...S, price: { kind: "free" as const } };
    expect(isQuickFilterActive(qf("free"), free)).toBe(true);
    expect(toggleQuickFilter(qf("free"), free, "Newest")).toEqual({ price: null });
    // Turning on "Under 1000" replaces Free — the price filter is single-choice.
    expect(toggleQuickFilter(qf("priceMax", 1000), free, "Newest")).toEqual({ price: { kind: "max", max: 1000 } });
  });

  it("Under X is lit only for exactly that amount", () => {
    const under = { ...S, price: { kind: "max" as const, max: 1000 } };
    expect(isQuickFilterActive(qf("priceMax", 1000), under)).toBe(true);
    expect(isQuickFilterActive(qf("priceMax", 500), under)).toBe(false);
    expect(toggleQuickFilter(qf("priceMax", 1000), under, "Newest")).toEqual({ price: null });
  });

  it("a language chip adds to or removes from the language filter", () => {
    const en = { ...S, languages: ["en"] };
    expect(toggleQuickFilter(qf("language", "hi"), en, "Newest")).toEqual({ languages: ["en", "hi"] });
    expect(isQuickFilterActive(qf("language", "en"), en)).toBe(true);
    expect(toggleQuickFilter(qf("language", "en"), en, "Newest")).toEqual({ languages: [] });
    expect(toggleQuickFilter(qf("language"), en, "Newest")).toEqual({});
  });
});
