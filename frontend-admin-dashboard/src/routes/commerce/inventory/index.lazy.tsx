import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { CommerceComingSoonPage } from '@/routes/commerce/-components/CommerceComingSoonPage';

export const Route = createLazyFileRoute('/commerce/inventory/')({
    component: () => (
        <LayoutContainer>
            <CommerceComingSoonPage navId="commerce-inventory" />
        </LayoutContainer>
    ),
});
