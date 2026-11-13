/**
 * A "Buy <plan>" click on a product website (evalezy.com/pricing → /signup/start?plan=team)
 * has to survive sign-up, a Google round trip, or "I already have an account" → log in.
 * The sign-up page remembers it here; the product's app picks it up once and opens that
 * plan's checkout. Expires after a day so a stale click never pops a payment screen.
 */
const KEY = 'plan-buy-intent';
const TTL_MS = 24 * 60 * 60 * 1000;
/** Plan keys as the website writes them (starter, team); anything else is ignored. */
const PLAN_KEY = /^[a-z0-9_-]{1,48}$/;

/** "trial" (or nothing) means the free trial: not a purchase. */
export function isPaidPlanKey(plan: string | null | undefined): plan is string {
    const k = (plan ?? '').trim().toLowerCase();
    return PLAN_KEY.test(k) && k !== 'trial' && k !== 'free';
}

export function rememberPlanBuyIntent(plan: string, product: string) {
    if (!isPaidPlanKey(plan)) return;
    try {
        localStorage.setItem(
            KEY,
            JSON.stringify({ plan: plan.trim().toLowerCase(), product, at: Date.now() })
        );
    } catch {
        // Storage blocked: the buyer opens the plan from the Credits page instead.
    }
}

/** A trial sign-up (no plan) must not pick up an older "Buy" click. */
export function clearPlanBuyIntent() {
    try {
        localStorage.removeItem(KEY);
    } catch {
        // nothing stored
    }
}

/** The pending plan for this product, cleared on read. */
export function takePlanBuyIntent(product: string): string | null {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        localStorage.removeItem(KEY);
        const v = JSON.parse(raw) as { plan?: string; product?: string; at?: number };
        if (v.product !== product || !v.at || Date.now() - v.at > TTL_MS) return null;
        return isPaidPlanKey(v.plan) ? v.plan : null;
    } catch {
        return null;
    }
}
