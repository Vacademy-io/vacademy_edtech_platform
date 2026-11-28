import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearPurchasedFromSiteCart,
    isPaidCpoPayment,
    isPaidEnrollment,
    notePendingSiteCartPurchase,
    purchasedPackageSessionIds,
} from './site-cart-housekeeping';
import { siteCartStorageKey } from '@/routes/$tagName/-utils/site-cart';
import { useSiteCartStore } from '@/routes/$tagName/-stores/site-cart-store';
import {
    PENDING_PURCHASES_KEY,
    parsePendingPurchases,
} from '@/routes/$tagName/-components/site-cart/pending-purchases';

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

const seedCart = (instituteId: string, ids: string[]) =>
    storage.setItem(
        siteCartStorageKey(instituteId),
        JSON.stringify(ids.map((id) => ({ packageSessionId: id, courseId: `course-${id}`, title: id })))
    );
const cartIds = (instituteId: string) =>
    (JSON.parse(storage.getItem(siteCartStorageKey(instituteId)) || '[]') as Array<{ packageSessionId: string }>).map(
        (i) => i.packageSessionId
    );

describe('what clears the site cart', () => {
    it('only a PAID enrolment counts as bought', () => {
        expect(isPaidEnrollment({ status: 'PAID' })).toBe(true);
        expect(isPaidEnrollment({ status: 'paid' })).toBe(true);
        expect(isPaidEnrollment({ status: 'INITIATED' })).toBe(false);
        expect(isPaidEnrollment({ status: 'PAYMENT_PENDING' })).toBe(false);
        expect(isPaidEnrollment(null)).toBe(false);
    });

    it('only a PAID installment payment counts as bought (CPO)', () => {
        expect(isPaidCpoPayment({ response_data: { paymentStatus: 'PAID' }, order_id: 'log-1' })).toBe(true);
        // The server's idempotent short-circuit sets both; status alone also counts.
        expect(isPaidCpoPayment({ status: 'paid' })).toBe(true);
        // A redirect gateway's hand-off (payment page in response_data) is not paid.
        expect(
            isPaidCpoPayment({ response_data: { paymentStatus: 'PAYMENT_PENDING', paymentUrl: 'https://pay' }, order_id: 'log-2' })
        ).toBe(false);
        expect(isPaidCpoPayment({ response_data: { status: 'ACTIVE' }, order_id: 'log-3' })).toBe(false);
        expect(isPaidCpoPayment({ response_data: { paymentStatus: 'PAYMENT_PENDING' }, status: 'PAID' })).toBe(false);
        expect(isPaidCpoPayment(undefined)).toBe(false);
        expect(isPaidCpoPayment('PAID')).toBe(false);
    });

    it("uses the server's enrolled sessions, falling back to the selection", () => {
        const selected = [{ package_session_id: 'a' }, { package_session_id: 'b' }, { package_session_id: null }];
        expect(purchasedPackageSessionIds({ enrolled_package_session_ids: ['b', 'b', ''] }, selected)).toEqual(['b']);
        expect(purchasedPackageSessionIds({ enrolled_package_session_ids: [] }, selected)).toEqual(['a', 'b']);
        expect(purchasedPackageSessionIds(null, selected)).toEqual(['a', 'b']);
    });
});

describe('site cart housekeeping', () => {
    beforeEach(() => {
        storage.clear();
        useSiteCartStore.setState({ instituteId: null, items: [], hydrated: false });
    });

    it('removes bought courses from a stored cart without the store mounted', async () => {
        seedCart('inst', ['a', 'b', 'c']);
        await clearPurchasedFromSiteCart(['inst', 'inst', undefined], ['a', 'c']);
        expect(cartIds('inst')).toEqual(['b']);
    });

    it('waits for a cart that is still loading before removing', async () => {
        seedCart('inst', ['a', 'b']);
        useSiteCartStore.setState({ instituteId: 'inst', items: [], hydrated: false });
        await clearPurchasedFromSiteCart(['inst'], ['a']);
        expect(useSiteCartStore.getState().items.map((i) => i.packageSessionId)).toEqual(['b']);
        expect(cartIds('inst')).toEqual(['b']);
    });

    it('does nothing for a visitor without a site cart', async () => {
        await clearPurchasedFromSiteCart(['inst'], ['a']);
        expect(storage.getItem(siteCartStorageKey('inst'))).toBeNull();
        await notePendingSiteCartPurchase({ paymentLogId: 'p1', instituteIds: ['inst'], packageSessionIds: ['a'] });
        expect(storage.getItem(PENDING_PURCHASES_KEY)).toBeNull();
    });

    it('notes a redirect purchase that is in the cart', async () => {
        seedCart('inst', ['a', 'b']);
        await notePendingSiteCartPurchase({ paymentLogId: 'p1', instituteIds: ['inst'], packageSessionIds: ['b', 'x'] });
        expect(parsePendingPurchases(storage.getItem(PENDING_PURCHASES_KEY))).toEqual([
            expect.objectContaining({ paymentLogId: 'p1', instituteId: 'inst', packageSessionIds: ['b'] }),
        ]);
    });
});
