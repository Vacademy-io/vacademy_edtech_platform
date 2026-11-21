import { createFileRoute } from '@tanstack/react-router';

export const CUSTOMER_TABS = ['overview', 'orders', 'addresses'] as const;
export type CustomerTab = (typeof CUSTOMER_TABS)[number];

export interface CustomerProfileSearch {
    tab?: CustomerTab;
}

export const Route = createFileRoute('/commerce/customers/$customerId/')({
    validateSearch: (search: Record<string, unknown>): CustomerProfileSearch => ({
        tab: (CUSTOMER_TABS as readonly string[]).includes(String(search.tab))
            ? (search.tab as CustomerTab)
            : undefined,
    }),
});
