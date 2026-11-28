import { createFileRoute } from '@tanstack/react-router';

export interface PrintSlipsSearch {
    /** Comma list of order ids (1..50). */
    ids?: string;
}

export const Route = createFileRoute('/commerce/orders/print/')({
    validateSearch: (search: Record<string, unknown>): PrintSlipsSearch => ({
        ids: typeof search.ids === 'string' && search.ids ? search.ids : undefined,
    }),
});
