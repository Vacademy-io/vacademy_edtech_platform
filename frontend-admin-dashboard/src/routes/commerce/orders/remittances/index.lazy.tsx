import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { RemittancesPage } from '@/routes/commerce/orders/-components/RemittancesPage';

export const Route = createLazyFileRoute('/commerce/orders/remittances/')({
    component: () => (
        <LayoutContainer>
            <RemittancesPage />
        </LayoutContainer>
    ),
});
