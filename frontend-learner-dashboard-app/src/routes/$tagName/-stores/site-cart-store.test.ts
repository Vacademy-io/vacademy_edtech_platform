import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory preferences storage whose reads can be held open, to replay the
// "visitor acts while the stored cart is still loading" races.
const storage = new Map<string, string>();
let releaseRead: (() => void) | null = null;
let holdReads = false;

vi.mock("../../../utils/preferences-storage", () => ({
  preferencesGet: async (key: string) => {
    if (holdReads) await new Promise<void>((resolve) => (releaseRead = resolve));
    return { value: storage.has(key) ? storage.get(key)! : null };
  },
  preferencesSet: async (key: string, value: string) => {
    storage.set(key, value);
  },
}));

const { useSiteCartStore, removePurchasedFromSiteCart } = await import("./site-cart-store");
const { siteCartStorageKey, SITE_CART_MAX_ITEMS } = await import("../-utils/site-cart");

const item = (course: string, version = "en") => ({
  packageSessionId: `${course}-${version}`,
  courseId: course,
  title: course,
});
const stored = (inst: string) => JSON.parse(storage.get(siteCartStorageKey(inst)) || "[]").map((i: any) => i.packageSessionId);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  storage.clear();
  holdReads = false;
  releaseRead = null;
  useSiteCartStore.setState({ instituteId: null, items: [], hydrated: false, lastAddedAt: 0 });
});

describe("site cart store", () => {
  it("keeps the stored cart when a course is added while it is still loading", async () => {
    storage.set(siteCartStorageKey("inst"), JSON.stringify([item("a"), item("b")]));
    holdReads = true;
    const loading = useSiteCartStore.getState().hydrate("inst");
    useSiteCartStore.getState().add(item("c"));
    // Nothing is written before the stored cart has been read.
    expect(stored("inst")).toEqual(["a-en", "b-en"]);
    releaseRead!();
    await loading;
    expect(useSiteCartStore.getState().items.map((i) => i.packageSessionId).sort()).toEqual(["a-en", "b-en", "c-en"]);
    await flush();
    expect(stored("inst").sort()).toEqual(["a-en", "b-en", "c-en"]);
  });

  it("an added language version wins over the stored version of the same course", async () => {
    storage.set(siteCartStorageKey("inst"), JSON.stringify([item("a", "en")]));
    holdReads = true;
    const loading = useSiteCartStore.getState().hydrate("inst");
    useSiteCartStore.getState().add(item("a", "hi"));
    releaseRead!();
    await loading;
    expect(useSiteCartStore.getState().items.map((i) => i.packageSessionId)).toEqual(["a-hi"]);
  });

  it("honours removals and purchases made while loading", async () => {
    storage.set(siteCartStorageKey("inst"), JSON.stringify([item("a"), item("b")]));
    holdReads = true;
    const loading = useSiteCartStore.getState().hydrate("inst");
    useSiteCartStore.getState().remove("a-en");
    releaseRead!();
    await loading;
    expect(useSiteCartStore.getState().items.map((i) => i.packageSessionId)).toEqual(["b-en"]);
    await removePurchasedFromSiteCart("inst", ["b-en"]);
    expect(useSiteCartStore.getState().items).toEqual([]);
    await flush();
    expect(stored("inst")).toEqual([]);
  });

  it("shares one load between concurrent callers and never mixes institutes", async () => {
    storage.set(siteCartStorageKey("one"), JSON.stringify([item("a")]));
    storage.set(siteCartStorageKey("two"), JSON.stringify([item("z")]));
    const first = useSiteCartStore.getState().hydrate("one");
    const second = useSiteCartStore.getState().hydrate("one");
    expect(second).toBe(first);
    await first;
    expect(useSiteCartStore.getState().items.map((i) => i.courseId)).toEqual(["a"]);
    await useSiteCartStore.getState().hydrate("two");
    expect(useSiteCartStore.getState().items.map((i) => i.courseId)).toEqual(["z"]);
  });

  it("never grows past the cap, but always lets a course switch version", async () => {
    await useSiteCartStore.getState().hydrate("inst");
    useSiteCartStore.getState().addMany(Array.from({ length: SITE_CART_MAX_ITEMS + 5 }, (_, n) => item(`c${n}`)));
    expect(useSiteCartStore.getState().items).toHaveLength(SITE_CART_MAX_ITEMS);
    useSiteCartStore.getState().add(item("c0", "hi"));
    expect(useSiteCartStore.getState().items).toHaveLength(SITE_CART_MAX_ITEMS);
    expect(useSiteCartStore.getState().has("c0-hi")).toBe(true);
  });
});
