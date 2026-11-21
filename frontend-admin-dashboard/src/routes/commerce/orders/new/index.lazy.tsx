import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { NewOrderPage } from '@/routes/commerce/orders/-components/NewOrderPage';

export const Route = createLazyFileRoute('/commerce/orders/new/')({
    component: NewOrderRoute,
});

function NewOrderRoute() {
    const { exchangeReturn, exchangeOrder } = Route.useSearch();
    return (
        <LayoutContainer>
            <NewOrderPage exchangeReturn={exchangeReturn} exchangeOrder={exchangeOrder} />
        </LayoutContainer>
    );
}
