import { createLazyFileRoute } from '@tanstack/react-router';
import { CommerceGate } from '@/routes/commerce/-components/CommercePage';
import { PrintSlipsPage } from '@/routes/commerce/orders/-components/PrintSlipsPage';

/** Full page without the app frame: the slips are what gets printed. */
export const Route = createLazyFileRoute('/commerce/orders/print/')({
    component: PrintRoute,
});

function PrintRoute() {
    const { ids } = Route.useSearch();
    return (
        <CommerceGate navId="commerce-orders">
            <PrintSlipsPage ids={ids} />
        </CommerceGate>
    );
}
