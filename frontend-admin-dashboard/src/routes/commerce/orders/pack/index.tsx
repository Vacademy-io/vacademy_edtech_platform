import { createFileRoute } from '@tanstack/react-router';

export interface PackStationSearch {
    /** Order id to load straight away (from the desk's Pack button). */
    order?: string;
}

export const Route = createFileRoute('/commerce/orders/pack/')({
    validateSearch: (search: Record<string, unknown>): PackStationSearch => ({
        order: typeof search.order === 'string' && search.order ? search.order : undefined,
    }),
});
