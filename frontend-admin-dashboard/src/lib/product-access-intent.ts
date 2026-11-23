/**
 * How the visitor picked to use a product sold two ways (Telleo: the dashboard or the API), from the
 * website's pricing toggle (telleo.ai/pricing → /signup/start?product=telleo&mode=api). Like a
 * "Buy" click (plan-buy-intent.ts) it has to survive sign-up, a Google round trip or a log-in, so
 * the sign-up page remembers it and the product's setup reads it once. Expires after a day.
 */
export type AccessIntent = 'PLATFORM' | 'API';

const KEY = 'product-access-intent';
const TTL_MS = 24 * 60 * 60 * 1000;

/** The website writes mode=api or mode=dashboard; anything else is no choice. */
export function parseAccessIntent(mode: string | null | undefined): AccessIntent | null {
    const m = (mode ?? '').trim().toLowerCase();
    if (m === 'api') return 'API';
    if (m === 'dashboard' || m === 'platform' || m === 'portal') return 'PLATFORM';
    return null;
}

/** A website plan id names its kind: api-pro is an API plan, pro a dashboard one. */
export function accessIntentOfPlan(plan: string | null | undefined): AccessIntent | null {
    const p = (plan ?? '').trim().toLowerCase();
    if (!p) return null;
    return p === 'api' || p.startsWith('api-') || p.startsWith('api_') ? 'API' : 'PLATFORM';
}

export function rememberAccessIntent(mode: AccessIntent, product: string) {
    try {
        localStorage.setItem(KEY, JSON.stringify({ mode, product, at: Date.now() }));
    } catch {
        // Storage blocked: the setup page asks instead.
    }
}

/** A sign-up with no choice must not pick up an older one. */
export function clearAccessIntent() {
    try {
        localStorage.removeItem(KEY);
    } catch {
        // nothing stored
    }
}

/** The pending choice for this product, cleared on read. */
export function takeAccessIntent(product: string): AccessIntent | null {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        localStorage.removeItem(KEY);
        const v = JSON.parse(raw) as { mode?: string; product?: string; at?: number };
        if (v.product !== product || !v.at || Date.now() - v.at > TTL_MS) return null;
        return v.mode === 'API' || v.mode === 'PLATFORM' ? v.mode : null;
    } catch {
        return null;
    }
}
