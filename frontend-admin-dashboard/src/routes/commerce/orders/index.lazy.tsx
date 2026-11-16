import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { CommerceComingSoonPage } from '@/routes/commerce/-components/CommerceComingSoonPage';

export const Route = createLazyFileRoute('/commerce/orders/')({
    component: () => (
        <LayoutContainer>
            <CommerceComingSoonPage navId="commerce-orders" />
        </LayoutContainer>
    ),
});
