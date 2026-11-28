import { removePurchasedFromSiteCart, useSiteCartStore } from '@/routes/$tagName/-stores/site-cart-store';
import { stashPendingPurchase } from '@/routes/$tagName/-components/site-cart/pending-purchases';
import type { ProductPageEnrollResponse } from '../-types/product-page-types';

/**
 * Keeping the site-wide cart honest after a checkout (see
 * $tagName/-utils/site-cart.ts): what was bought leaves the cart. Every
 * function is a no-op for a visitor without a site cart and never throws, so
 * none of it can get in the way of a payment.
 */

/**
 * Only a confirmed payment clears the cart. INITIATED (manual / offline
 * payment, an async gateway) and PAYMENT_PENDING are not bought yet.
 */
export const isPaidEnrollment = (result: Pick<ProductPageEnrollResponse, 'status'> | null | undefined): boolean =>
    String(result?.status ?? '').toUpperCase() === 'PAID';

/**
 * Whether a CPO installment payment (the cpo-pay-installments response, a
 * PaymentResponseDTO) is confirmed paid: the gateway's
 * `response_data.paymentStatus` — what the enrol-by-invite flow reads — or,
 * without one, the top-level `status` the server's short-circuits set.
 * PAYMENT_PENDING, a redirect gateway's hand-off or an unknown shape is not.
 */
export const isPaidCpoPayment = (result: unknown): boolean => {
    if (!result || typeof result !== 'object') return false;
    const r = result as { status?: unknown; response_data?: { paymentStatus?: unknown } | null };
    const status = r.response_data?.paymentStatus ?? r.status;
    return typeof status === 'string' && status.toUpperCase() === 'PAID';
};

/** What an enrolment bought: the server's list, else the package sessions that were selected. */
export const purchasedPackageSessionIds = (
    result: Pick<ProductPageEnrollResponse, 'enrolled_package_session_ids'> | null | undefined,
    selected: Array<{ package_session_id?: string | null }>
): string[] => {
    const fromServer = Array.isArray(result?.enrolled_package_session_ids)
        ? result!.enrolled_package_session_ids.filter((id): id is string => typeof id === 'string' && !!id)
        : [];
    const ids = fromServer.length
        ? fromServer
        : selected.map((m) => m.package_session_id).filter((id): id is string => !!id);
    return [...new Set(ids)];
};

const distinct = (ids: Array<string | null | undefined>): string[] =>
    [...new Set(ids.filter((id): id is string => !!id))];

/** After a confirmed payment: the bought courses leave the site cart. */
export const clearPurchasedFromSiteCart = async (
    instituteIds: Array<string | null | undefined>,
    packageSessionIds: string[]
): Promise<void> => {
    if (!packageSessionIds.length) return;
    for (const instituteId of distinct(instituteIds)) {
        try {
            // A cart still loading for this institute would have its stored
            // list read back over the removal — let it finish first.
            const state = useSiteCartStore.getState();
            if (state.instituteId === instituteId && !state.hydrated) await state.hydrate(instituteId);
            await removePurchasedFromSiteCart(instituteId, packageSessionIds);
        } catch {
            // Housekeeping only.
        }
    }
};

/**
 * Before handing the visitor to a redirect gateway: note the purchase, so the
 * cart can drop it once the gateway settles (payment-result page, or the next
 * visit). Waits at most `timeoutMs` — the redirect must not hang on storage.
 */
export const notePendingSiteCartPurchase = async (
    input: {
        paymentLogId: string | null | undefined;
        instituteIds: Array<string | null | undefined>;
        packageSessionIds: string[];
    },
    timeoutMs = 500
): Promise<void> => {
    if (!input.paymentLogId || !input.packageSessionIds.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        stashPendingPurchase(input),
        new Promise<void>((resolve) => {
            timer = setTimeout(resolve, timeoutMs);
        }),
    ]);
    if (timer) clearTimeout(timer);
};
