import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { OrderDetailPage } from '@/routes/commerce/orders/-components/OrderDetailPage';

export const Route = createLazyFileRoute('/commerce/orders/$orderId/')({
    component: OrderDetailRoute,
});

function OrderDetailRoute() {
    const { orderId } = Route.useParams();
    const { action } = Route.useSearch() as { action?: string };
    return (
        <LayoutContainer>
            <OrderDetailPage key={orderId} orderId={orderId} initialAction={action} />
        </LayoutContainer>
    );
}
