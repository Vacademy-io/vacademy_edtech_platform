import { getInstituteId } from '@/constants/helper';

/**
 * Courier names remembered per browser and shop (owner default Q5: no shop
 * setting). Storage can be unavailable (private window, blocked site data):
 * every access is guarded and a failure reads as "nothing remembered".
 */
export const MAX_COURIERS = 20;

const storageKey = () => `commerce.couriers.${getInstituteId() ?? 'none'}`;

export function readCouriers(): string[] {
    try {
        const raw = globalThis.localStorage?.getItem(storageKey());
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed)
            ? parsed.filter((name): name is string => typeof name === 'string' && name.trim() !== '').slice(0, MAX_COURIERS)
            : [];
    } catch {
        return [];
    }
}

/** Most recent first, without duplicates (case-insensitive), at most 20. */
export function rememberCourier(name: string): void {
    const clean = name.trim().slice(0, 100);
    if (!clean) return;
    try {
        const next = [clean, ...readCouriers().filter((n) => n.toLowerCase() !== clean.toLowerCase())].slice(
            0,
            MAX_COURIERS
        );
        globalThis.localStorage?.setItem(storageKey(), JSON.stringify(next));
    } catch {
        // Nothing remembered; the field still works.
    }
}
