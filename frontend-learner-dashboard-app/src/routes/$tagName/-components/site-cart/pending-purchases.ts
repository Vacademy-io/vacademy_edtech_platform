/**
 * Site-cart housekeeping for payments that finish somewhere else.
 *
 * A redirect gateway (Cashfree, PhonePe…) takes the visitor away from the
 * product page and confirms the payment by webhook, so the checkout never sees
 * the success. Before redirecting, the checkout notes which package sessions
 * the payment buys (only those that are in the visitor's site cart); the note
 * is settled when the payment is known to be paid — on the payment-result page
 * or on the next visit to the site — and the bought courses leave the cart.
 *
 * Nothing here may ever interfere with a payment: every function swallows its
 * own errors, and a site without a site cart never writes a note at all.
 */
import { preferencesGet, preferencesRemove, preferencesSet } from "@/utils/preferences-storage";
import { siteCartStorageKey } from "../../-utils/site-cart";
import { removePurchasedFromSiteCart, useSiteCartStore } from "../../-stores/site-cart-store";

export const PENDING_PURCHASES_KEY = "site-cart-pending";
/** A gateway that has not settled within this long is not going to. */
export const PENDING_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const PENDING_MAX_ENTRIES = 20;

export interface PendingPurchase {
  /** The payment log the gateway settles (the product page's payment_log_id). */
  paymentLogId: string;
  instituteId: string;
  /** Package sessions this payment buys that were in the site cart. */
  packageSessionIds: string[];
  createdAt: number;
}

export type PaymentOutcome = "paid" | "failed" | "pending";

const isEntry = (e: unknown): e is PendingPurchase => {
  if (!e || typeof e !== "object") return false;
  const p = e as Record<string, unknown>;
  return (
    typeof p.paymentLogId === "string" &&
    !!p.paymentLogId &&
    typeof p.instituteId === "string" &&
    !!p.instituteId &&
    Array.isArray(p.packageSessionIds) &&
    p.packageSessionIds.every((id) => typeof id === "string") &&
    typeof p.createdAt === "number"
  );
};

export const parsePendingPurchases = (raw: string | null | undefined): PendingPurchase[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
};

/** Drops notes too old to settle (and any dated in the future by a skewed clock). */
export const prunePendingPurchases = (
  list: PendingPurchase[],
  now: number,
  maxAgeMs: number = PENDING_MAX_AGE_MS,
): PendingPurchase[] => list.filter((e) => now - e.createdAt <= maxAgeMs && e.createdAt - now <= maxAgeMs);

/** Adds (or replaces) the note for a payment, keeping the list short. */
export const addPendingPurchase = (
  list: PendingPurchase[],
  entry: PendingPurchase,
  now: number,
): PendingPurchase[] => {
  const rest = list.filter((e) => e.paymentLogId !== entry.paymentLogId);
  return prunePendingPurchases([...rest, entry], now).slice(-PENDING_MAX_ENTRIES);
};

/** Removes the note for a payment, returning it (if there was one). */
export const takePendingPurchase = (
  list: PendingPurchase[],
  paymentLogId: string,
): { entry: PendingPurchase | null; rest: PendingPurchase[] } => {
  const entry = list.find((e) => e.paymentLogId === paymentLogId) ?? null;
  return { entry, rest: entry ? list.filter((e) => e !== entry) : list };
};

/** The ids worth noting: only purchases that are actually in the site cart. */
export const cartOverlap = (
  cartItems: Array<{ packageSessionId: string }>,
  packageSessionIds: string[],
): string[] => {
  const inCart = new Set(cartItems.map((i) => i.packageSessionId));
  return [...new Set(packageSessionIds.filter((id) => inCart.has(id)))];
};

/**
 * Reads a payment-status response the way the payment-result page does:
 * PAID / SUCCESS / COMPLETED / FLAGGED are paid, FAILED / CANCELLED /
 * USER_DROPPED are failed, anything else is still pending.
 */
export const classifyPaymentStatus = (data: unknown): PaymentOutcome => {
  if (!data || typeof data !== "object") return "pending";
  const d = data as Record<string, unknown>;
  const raw = (d.payment_status ?? d.paymentStatus ?? d.status) as unknown;
  const status = typeof raw === "string" ? raw.toUpperCase() : "";
  if (["PAID", "SUCCESS", "COMPLETED", "FLAGGED"].includes(status)) return "paid";
  if (["FAILED", "CANCELLED", "USER_DROPPED"].includes(status)) return "failed";
  return "pending";
};

// ─── storage ────────────────────────────────────────────────────────────────

const readList = async (): Promise<PendingPurchase[]> =>
  parsePendingPurchases((await preferencesGet(PENDING_PURCHASES_KEY)).value);

const writeList = async (list: PendingPurchase[]) => {
  if (list.length) await preferencesSet(PENDING_PURCHASES_KEY, JSON.stringify(list));
  else await preferencesRemove(PENDING_PURCHASES_KEY);
};

const readCart = async (instituteId: string): Promise<Array<{ packageSessionId: string }>> => {
  const raw = (await preferencesGet(siteCartStorageKey(instituteId))).value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((i) => i && typeof i.packageSessionId === "string")
      : [];
  } catch {
    return [];
  }
};

/**
 * Notes a redirect payment before the visitor leaves for the gateway. Writes
 * nothing when none of the purchased courses is in a site cart — so sites
 * without one are untouched.
 */
export const stashPendingPurchase = async (input: {
  paymentLogId: string | null | undefined;
  instituteIds: Array<string | null | undefined>;
  packageSessionIds: string[];
  now?: number;
}): Promise<void> => {
  try {
    const paymentLogId = input.paymentLogId?.trim();
    if (!paymentLogId || !input.packageSessionIds.length) return;
    const now = input.now ?? Date.now();
    // One note per payment, under the first institute whose cart holds any of
    // the purchased courses (the page's institute and the route's are the
    // same institute in practice; both are tried in case they are not).
    for (const instituteId of new Set(input.instituteIds.filter((id): id is string => !!id))) {
      const ids = cartOverlap(await readCart(instituteId), input.packageSessionIds);
      if (!ids.length) continue;
      const list = await readList();
      await writeList(
        addPendingPurchase(list, { paymentLogId, instituteId, packageSessionIds: ids, createdAt: now }, now),
      );
      return;
    }
  } catch {
    // Housekeeping only — never in the way of a payment.
  }
};

/**
 * Settles the note for a payment: paid → its courses leave the site cart;
 * failed → the note is dropped and the courses stay, ready to try again.
 * Returns the package sessions removed from the cart.
 */
export const settlePendingPurchase = async (
  paymentLogId: string | null | undefined,
  outcome: Exclude<PaymentOutcome, "pending">,
): Promise<string[]> => {
  try {
    if (!paymentLogId) return [];
    const list = await readList();
    const { entry, rest } = takePendingPurchase(list, paymentLogId);
    if (!entry) return [];
    await writeList(rest);
    if (outcome !== "paid") return [];
    // A cart still loading for this institute would read its stored list
    // back over the removal — let it finish first.
    const state = useSiteCartStore.getState();
    if (state.instituteId === entry.instituteId && !state.hydrated) await state.hydrate(entry.instituteId);
    await removePurchasedFromSiteCart(entry.instituteId, entry.packageSessionIds);
    return entry.packageSessionIds;
  } catch {
    return [];
  }
};

/** Reconciled on page load once per institute — the check costs a request per note. */
const reconciled = new Set<string>();
/** A run in progress per institute: overlapping calls share it instead of asking twice. */
const inFlight = new Map<string, Promise<string[]>>();

const runReconcile = async (
  instituteId: string,
  checkStatus: (paymentLogId: string) => Promise<PaymentOutcome>,
  now: number,
  maxChecks: number,
): Promise<string[]> => {
  const removed: string[] = [];
  try {
    const all = await readList();
    const live = prunePendingPurchases(all, now);
    if (live.length !== all.length) await writeList(live);
    const mine = live
      .filter((e) => e.instituteId === instituteId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, maxChecks);
    // No note for this institute: no request at all.
    for (const entry of mine) {
      const outcome = await checkStatus(entry.paymentLogId).catch(() => "pending" as const);
      if (outcome !== "pending") removed.push(...(await settlePendingPurchase(entry.paymentLogId, outcome)));
    }
  } catch {
    // Never surface housekeeping failures.
  }
  return removed;
};

/**
 * Asks the gateway status of this institute's notes (newest first, a few at
 * most) and settles the ones that finished; expired notes are dropped without
 * a request. Returns the package sessions that left the cart (paid).
 *
 * On a visit (the header's cart button mounting) it runs once per institute
 * per page load. `force` runs it again regardless — when the cart drawer opens
 * and just before checkout — so a payment that was still pending at page load
 * cannot stay in the cart and be bought a second time. Still capped at
 * `maxChecks` requests, and none without a note.
 */
export const reconcilePendingPurchases = async (
  instituteId: string | null | undefined,
  checkStatus: (paymentLogId: string) => Promise<PaymentOutcome>,
  opts: { now?: number; maxChecks?: number; force?: boolean } = {},
): Promise<string[]> => {
  if (!instituteId) return [];
  const running = inFlight.get(instituteId);
  if (running) return running;
  if (!opts.force && reconciled.has(instituteId)) return [];
  reconciled.add(instituteId);
  const run = runReconcile(instituteId, checkStatus, opts.now ?? Date.now(), opts.maxChecks ?? 3).finally(() => {
    inFlight.delete(instituteId);
  });
  inFlight.set(instituteId, run);
  return run;
};

/** Test hook: forget which institutes were reconciled this page load. */
export const __resetPendingReconcileForTests = () => {
  reconciled.clear();
  inFlight.clear();
};
