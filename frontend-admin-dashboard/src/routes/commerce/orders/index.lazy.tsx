import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { OrdersPage } from '@/routes/commerce/orders/-components/OrdersPage';
import type { OrdersSearch } from './index';

export const Route = createLazyFileRoute('/commerce/orders/')({
    component: OrdersRoute,
});

function OrdersRoute() {
    const search = Route.useSearch() as OrdersSearch;
    const navigate = useNavigate();
    return (
        <LayoutContainer>
            <OrdersPage
                search={search}
                onSearchChange={(next) =>
                    void navigate({ to: '/commerce/orders', search: next as never, replace: true })
                }
            />
        </LayoutContainer>
    );
}
