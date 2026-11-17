import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { NotificationsPage } from '@/routes/commerce/settings/-components/NotificationsPage';

export const Route = createLazyFileRoute('/commerce/settings/notifications/')({
    component: () => (
        <LayoutContainer>
            <NotificationsPage />
        </LayoutContainer>
    ),
});
