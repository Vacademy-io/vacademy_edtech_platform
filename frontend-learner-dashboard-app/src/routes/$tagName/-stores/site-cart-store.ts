import { create } from "zustand";
import { preferencesGet, preferencesSet } from "../../../utils/preferences-storage";
import {
  removeCartItems,
  siteCartStorageKey,
  upsertCartItemsCapped,
  type SiteCartItem,
} from "../-utils/site-cart";

/**
 * The site-wide course cart (see -utils/site-cart.ts for the model). One cart
 * per institute, persisted through preferences storage (localStorage on the
 * web, Capacitor Preferences in the app — same as the book cart).
 *
 * Loading is the delicate part: `hydrate` reads storage asynchronously, and a
 * visitor can add or remove a course before it lands. So nothing is WRITTEN
 * until the stored cart has been read — changes made meanwhile live in memory,
 * and the load merges them in (adds win over the stored version of the same
 * course; removals and a clear made during the load are honoured). Writing
 * earlier would replace the stored cart with just the new item.
 */

interface SiteCartState {
  instituteId: string | null;
  items: SiteCartItem[];
  hydrated: boolean;
  /** Bumped on every successful add, so a cart button can animate. */
  lastAddedAt: number;
  hydrate: (instituteId: string) => Promise<void>;
  add: (item: SiteCartItem) => void;
  addMany: (items: SiteCartItem[]) => void;
  remove: (packageSessionId: string) => void;
  removeMany: (packageSessionIds: string[]) => void;
  clear: () => void;
  has: (packageSessionId: string) => boolean;
  hasCourse: (courseId: string) => boolean;
}

const persist = (instituteId: string | null, items: SiteCartItem[]) => {
  if (!instituteId) return;
  preferencesSet(siteCartStorageKey(instituteId), JSON.stringify(items)).catch(() => {
    // Storage unavailable (private mode): the in-memory cart still works for this visit.
  });
};

const parse = (raw: string | null): SiteCartItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((i) => i && typeof i.packageSessionId === "string" && typeof i.courseId === "string")
      : [];
  } catch {
    return [];
  }
};

/** The load in flight, shared by concurrent hydrate() calls for the same institute. */
let inflight: { instituteId: string; promise: Promise<void> } | null = null;
/** Changes made while the stored cart is still being read (applied when it lands). */
const pendingRemovals = new Set<string>();
let clearedWhileLoading = false;

export const useSiteCartStore = create<SiteCartState>((set, get) => ({
  instituteId: null,
  items: [],
  hydrated: false,
  lastAddedAt: 0,

  hydrate: (instituteId) => {
    if (!instituteId) return Promise.resolve();
    const state = get();
    if (state.instituteId === instituteId && state.hydrated) return Promise.resolve();
    if (inflight && inflight.instituteId === instituteId) return inflight.promise;
    if (state.instituteId !== instituteId) {
      // Another institute's cart never leaks into this one.
      pendingRemovals.clear();
      clearedWhileLoading = false;
      set({ instituteId, items: [], hydrated: false });
    }
    const promise = (async () => {
      const stored = await preferencesGet(siteCartStorageKey(instituteId)).catch(() => ({ value: null }));
      // A different institute may have been hydrated while we waited.
      if (get().instituteId !== instituteId) return;
      const storedItems = clearedWhileLoading
        ? []
        : parse(stored.value).filter((i) => !pendingRemovals.has(i.packageSessionId));
      const merged = upsertCartItemsCapped(storedItems, get().items);
      const changed = clearedWhileLoading || pendingRemovals.size > 0 || get().items.length > 0;
      pendingRemovals.clear();
      clearedWhileLoading = false;
      set({ items: merged, hydrated: true });
      if (changed) persist(instituteId, merged);
    })();
    inflight = { instituteId, promise };
    void promise.finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
    return promise;
  },

  add: (item) => get().addMany([item]),

  addMany: (items) => {
    const stamped = items.map((i, n) => ({ ...i, addedAt: Date.now() + n }));
    const next = upsertCartItemsCapped(get().items, stamped);
    if (next === get().items) return;
    stamped.forEach((i) => pendingRemovals.delete(i.packageSessionId));
    set({ items: next, lastAddedAt: Date.now() });
    if (get().hydrated) persist(get().instituteId, next);
  },

  remove: (packageSessionId) => get().removeMany([packageSessionId]),

  removeMany: (packageSessionIds) => {
    if (!get().hydrated) packageSessionIds.forEach((id) => pendingRemovals.add(id));
    const before = get().items;
    const next = removeCartItems(before, packageSessionIds);
    if (next.length === before.length) return;
    set({ items: next });
    if (get().hydrated) persist(get().instituteId, next);
  },

  clear: () => {
    if (!get().hydrated) clearedWhileLoading = true;
    set({ items: [] });
    if (get().hydrated) persist(get().instituteId, []);
  },

  has: (packageSessionId) => get().items.some((i) => i.packageSessionId === packageSessionId),
  hasCourse: (courseId) => get().items.some((i) => i.courseId === courseId),
}));

/**
 * Removes purchased courses from the stored cart without needing the store to
 * be mounted — for the product-page checkout's success path, which runs on a
 * different route. Safe to call when no site cart exists.
 */
export const removePurchasedFromSiteCart = async (instituteId: string | null | undefined, packageSessionIds: string[]) => {
  if (!instituteId || !packageSessionIds.length) return;
  try {
    const state = useSiteCartStore.getState();
    if (state.instituteId === instituteId) {
      // Loaded: removes and saves. Still loading: remembered and applied when it lands.
      state.removeMany(packageSessionIds);
      if (state.hydrated) return;
    }
    const key = siteCartStorageKey(instituteId);
    const stored = await preferencesGet(key);
    const items = parse(stored.value);
    const next = removeCartItems(items, packageSessionIds);
    if (next.length !== items.length) await preferencesSet(key, JSON.stringify(next));
  } catch {
    // Never let cart housekeeping interfere with a completed payment.
  }
};
