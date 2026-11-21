import { createFileRoute } from '@tanstack/react-router';

export interface RemittancesSearch {
    from?: string;
    to?: string;
    page?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute('/commerce/orders/remittances/')({
    validateSearch: (search: Record<string, unknown>): RemittancesSearch => {
        const page = Number(search.page);
        return {
            from: typeof search.from === 'string' && DATE.test(search.from) ? search.from : undefined,
            to: typeof search.to === 'string' && DATE.test(search.to) ? search.to : undefined,
            page: Number.isInteger(page) && page > 0 ? page : undefined,
        };
    },
});
