import { createFileRoute } from '@tanstack/react-router';

/** Search and page (1-based) live in the address. */
export interface CustomersSearch {
    q?: string;
    page?: number;
}

export const Route = createFileRoute('/commerce/customers/')({
    validateSearch: (search: Record<string, unknown>): CustomersSearch => {
        const page = Number(search.page);
        return {
            q: typeof search.q === 'string' && search.q.trim() ? search.q.trim().slice(0, 64) : undefined,
            page: Number.isInteger(page) && page > 0 ? page : undefined,
        };
    },
});
