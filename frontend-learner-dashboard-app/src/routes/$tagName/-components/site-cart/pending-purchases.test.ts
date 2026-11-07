import { beforeEach, describe, expect, it } from "vitest";
import {
  PENDING_MAX_AGE_MS,
  PENDING_PURCHASES_KEY,
  __resetPendingReconcileForTests,
  addPendingPurchase,
  cartOverlap,
  classifyPaymentStatus,
  parsePendingPurchases,
  prunePendingPurchases,
  reconcilePendingPurchases,
  settlePendingPurchase,
  stashPendingPurchase,
  takePendingPurchase,
  type PendingPurchase,
} from "./pending-purchases";
import { siteCartStorageKey } from "../../-utils/site-cart";
import { useSiteCartStore } from "../../-stores/site-cart-store";

// preferences-storage falls back to localStorage on the web; give node one.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

const NOW = Date.parse("2026-10-09T10:00:00Z");
const entry = (paymentLogId: string, extra: Partial<PendingPurchase> = {}): PendingPurchase => ({
  paymentLogId,
  instituteId: "inst",
  packageSessionIds: ["a"],
  createdAt: NOW,
  ...extra,
});

const cartIds = (instituteId: string) =>
  (JSON.parse(storage.getItem(siteCartStorageKey(instituteId)) || "[]") as Array<{ packageSessionId: string }>).map(
    (i) => i.packageSessionId,
  );

const seedCart = (instituteId: string, ids: string[]) =>
  storage.setItem(
    siteCartStorageKey(instituteId),
    JSON.stringify(ids.map((id) => ({ packageSessionId: id, courseId: `course-${id}`, title: id }))),
  );

describe("pending purchase list (pure)", () => {
  it("parses only well-formed notes", () => {
    expect(parsePendingPurchases(null)).toEqual([]);
    expect(parsePendingPurchases("not json")).toEqual([]);
    expect(parsePendingPurchases(JSON.stringify([entry("p1"), { paymentLogId: "p2" }, null]))).toEqual([entry("p1")]);
  });

  it("adds one note per payment and drops expired ones", () => {
    const old = entry("old", { createdAt: NOW - PENDING_MAX_AGE_MS - 1 });
    const list = addPendingPurchase([old, entry("p1")], entry("p1", { packageSessionIds: ["b"] }), NOW);
    expect(list).toEqual([entry("p1", { packageSessionIds: ["b"] })]);
    expect(prunePendingPurchases([entry("future", { createdAt: NOW + PENDING_MAX_AGE_MS + 1 })], NOW)).toEqual([]);
  });

  it("takes the note for a payment", () => {
    const { entry: taken, rest } = takePendingPurchase([entry("p1"), entry("p2")], "p2");
    expect(taken?.paymentLogId).toBe("p2");
    expect(rest.map((e) => e.paymentLogId)).toEqual(["p1"]);
    expect(takePendingPurchase([entry("p1")], "zzz").entry).toBeNull();
  });

  it("notes only purchases that are in the cart", () => {
    expect(cartOverlap([{ packageSessionId: "a" }, { packageSessionId: "b" }], ["b", "c", "b"])).toEqual(["b"]);
  });

  it("reads gateway statuses like the payment-result page", () => {
    expect(classifyPaymentStatus({ payment_status: "PAID", status: "ACTIVE" })).toBe("paid");
    expect(classifyPaymentStatus({ paymentStatus: "flagged" })).toBe("paid");
    expect(classifyPaymentStatus({ payment_status: "USER_DROPPED" })).toBe("failed");
    expect(classifyPaymentStatus({ payment_status: "PAYMENT_PENDING" })).toBe("pending");
    expect(classifyPaymentStatus(null)).toBe("pending");
  });
});

describe("pending purchases (storage)", () => {
  beforeEach(() => {
    storage.clear();
    __resetPendingReconcileForTests();
    useSiteCartStore.setState({ instituteId: null, items: [], hydrated: false });
  });

  it("writes nothing when the purchase is not in any site cart", async () => {
    await stashPendingPurchase({ paymentLogId: "p1", instituteIds: ["inst"], packageSessionIds: ["a"], now: NOW });
    expect(storage.getItem(PENDING_PURCHASES_KEY)).toBeNull();
  });

  it("stashes the in-cart part of a redirect payment and settles it once paid", async () => {
    seedCart("inst", ["a", "b", "c"]);
    await stashPendingPurchase({
      paymentLogId: "p1",
      instituteIds: ["inst", "inst", null],
      packageSessionIds: ["a", "c", "zzz"],
      now: NOW,
    });
    expect(parsePendingPurchases(storage.getItem(PENDING_PURCHASES_KEY))).toEqual([
      entry("p1", { packageSessionIds: ["a", "c"] }),
    ]);

    expect(await settlePendingPurchase("p1", "paid")).toEqual(["a", "c"]);
    expect(cartIds("inst")).toEqual(["b"]);
    expect(storage.getItem(PENDING_PURCHASES_KEY)).toBeNull();
    // Settling twice is harmless.
    expect(await settlePendingPurchase("p1", "paid")).toEqual([]);
  });

  it("keeps the courses when the payment failed", async () => {
    seedCart("inst", ["a"]);
    await stashPendingPurchase({ paymentLogId: "p1", instituteIds: ["inst"], packageSessionIds: ["a"], now: NOW });
    expect(await settlePendingPurchase("p1", "failed")).toEqual([]);
    expect(cartIds("inst")).toEqual(["a"]);
    expect(storage.getItem(PENDING_PURCHASES_KEY)).toBeNull();
  });

  it("waits for a cart that is still loading before removing a paid purchase", async () => {
    seedCart("inst", ["a", "b"]);
    await stashPendingPurchase({ paymentLogId: "p1", instituteIds: ["inst"], packageSessionIds: ["a"], now: NOW });
    useSiteCartStore.setState({ instituteId: "inst", items: [], hydrated: false });
    await settlePendingPurchase("p1", "paid");
    expect(useSiteCartStore.getState().items.map((i) => i.packageSessionId)).toEqual(["b"]);
    expect(cartIds("inst")).toEqual(["b"]);
  });

  it("removes from the live store when the cart is mounted for that institute", async () => {
    seedCart("inst", ["a", "b"]);
    await useSiteCartStore.getState().hydrate("inst");
    await stashPendingPurchase({ paymentLogId: "p1", instituteIds: ["inst"], packageSessionIds: ["a"], now: NOW });
    await settlePendingPurchase("p1", "paid");
    expect(useSiteCartStore.getState().items.map((i) => i.packageSessionId)).toEqual(["b"]);
  });

  it("reconciles this institute's notes on a later visit, once per page load", async () => {
    seedCart("inst", ["a", "b"]);
    storage.setItem(
      PENDING_PURCHASES_KEY,
      JSON.stringify([
        entry("paid-1", { packageSessionIds: ["a"] }),
        entry("waiting", { packageSessionIds: ["b"], createdAt: NOW - 1000 }),
        entry("other-institute", { instituteId: "other" }),
        entry("expired", { createdAt: NOW - PENDING_MAX_AGE_MS - 1 }),
      ]),
    );
    const asked: string[] = [];
    const check = async (id: string) => {
      asked.push(id);
      return id === "paid-1" ? ("paid" as const) : ("pending" as const);
    };
    expect(await reconcilePendingPurchases("inst", check, { now: NOW })).toEqual(["a"]);
    expect(asked).toEqual(["paid-1", "waiting"]);
    expect(cartIds("inst")).toEqual(["b"]);
    expect(parsePendingPurchases(storage.getItem(PENDING_PURCHASES_KEY)).map((e) => e.paymentLogId)).toEqual([
      "waiting",
      "other-institute",
    ]);

    expect(await reconcilePendingPurchases("inst", check, { now: NOW })).toEqual([]);
    expect(asked).toHaveLength(2);
  });

  it("re-checks a payment still pending at page load when forced (drawer open, checkout)", async () => {
    seedCart("inst", ["a", "b"]);
    storage.setItem(PENDING_PURCHASES_KEY, JSON.stringify([entry("late", { packageSessionIds: ["a"] })]));
    let webhookLanded = false;
    const asked: string[] = [];
    const check = async (id: string) => {
      asked.push(id);
      return webhookLanded ? ("paid" as const) : ("pending" as const);
    };

    // Page load: still pending, the course stays.
    expect(await reconcilePendingPurchases("inst", check, { now: NOW })).toEqual([]);
    expect(cartIds("inst")).toEqual(["a", "b"]);
    // The once-per-load guard holds for unforced calls…
    webhookLanded = true;
    expect(await reconcilePendingPurchases("inst", check, { now: NOW })).toEqual([]);
    expect(asked).toEqual(["late"]);
    // …but opening the drawer / checking out asks again, and the paid course leaves.
    expect(await reconcilePendingPurchases("inst", check, { now: NOW, force: true })).toEqual(["a"]);
    expect(cartIds("inst")).toEqual(["b"]);
    // Settled: nothing left to ask about.
    expect(await reconcilePendingPurchases("inst", check, { now: NOW, force: true })).toEqual([]);
    expect(asked).toEqual(["late", "late"]);
  });

  it("shares one run between overlapping calls, and asks nothing without a note", async () => {
    seedCart("inst", ["a"]);
    storage.setItem(PENDING_PURCHASES_KEY, JSON.stringify([entry("p1")]));
    let calls = 0;
    const check = async () => {
      calls += 1;
      return "paid" as const;
    };
    const [first, second] = await Promise.all([
      reconcilePendingPurchases("inst", check, { now: NOW, force: true }),
      reconcilePendingPurchases("inst", check, { now: NOW, force: true }),
    ]);
    expect(calls).toBe(1);
    expect(first).toEqual(["a"]);
    expect(second).toEqual(["a"]);

    await reconcilePendingPurchases("other", check, { now: NOW, force: true });
    expect(calls).toBe(1);
  });

  it("never throws when the status check fails", async () => {
    seedCart("inst", ["a"]);
    storage.setItem(PENDING_PURCHASES_KEY, JSON.stringify([entry("p1")]));
    await expect(
      reconcilePendingPurchases("inst", async () => {
        throw new Error("offline");
      }, { now: NOW }),
    ).resolves.toEqual([]);
    expect(cartIds("inst")).toEqual(["a"]);
  });
});
