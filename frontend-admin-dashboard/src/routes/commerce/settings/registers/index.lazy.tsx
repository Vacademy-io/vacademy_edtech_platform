import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { RegistersPage } from '@/routes/commerce/settings/-components/RegistersPage';

/** P9: billing counters, paper bill books and the counter limits. */
export const Route = createLazyFileRoute('/commerce/settings/registers/')({
    component: () => (
        <LayoutContainer>
            <RegistersPage />
        </LayoutContainer>
    ),
});
