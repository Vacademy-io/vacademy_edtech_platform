import { createFileRoute } from '@tanstack/react-router';

/** An exchange opens the page with the received return and its original order. */
export interface NewOrderRouteSearch {
    exchangeReturn?: string;
    exchangeOrder?: string;
}

const id = (value: unknown): string | undefined =>
    typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : undefined;

export const Route = createFileRoute('/commerce/orders/new/')({
    validateSearch: (search: Record<string, unknown>): NewOrderRouteSearch => ({
        exchangeReturn: id(search.exchangeReturn),
        exchangeOrder: id(search.exchangeOrder),
    }),
});
