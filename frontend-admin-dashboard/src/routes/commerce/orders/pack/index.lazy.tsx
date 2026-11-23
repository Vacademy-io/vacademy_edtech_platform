import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { PackStationPage } from '@/routes/commerce/orders/-components/PackStationPage';

export const Route = createLazyFileRoute('/commerce/orders/pack/')({
    component: PackStationRoute,
});

function PackStationRoute() {
    const { order } = Route.useSearch();
    return (
        <LayoutContainer>
            <PackStationPage initialOrderId={order} />
        </LayoutContainer>
    );
}
