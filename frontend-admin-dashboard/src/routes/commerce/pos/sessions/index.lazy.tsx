import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { PosSessionsPage } from '@/routes/commerce/pos/-components/PosSessionsPage';

/** P7: counter sessions of the shop (manager). */
export const Route = createLazyFileRoute('/commerce/pos/sessions/')({
    component: () => (
        <LayoutContainer>
            <PosSessionsPage />
        </LayoutContainer>
    ),
});
