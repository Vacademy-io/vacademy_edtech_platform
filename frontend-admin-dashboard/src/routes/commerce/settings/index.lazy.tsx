import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { SettingsPage } from '@/routes/commerce/settings/-components/SettingsPage';

export const Route = createLazyFileRoute('/commerce/settings/')({
    component: () => (
        <LayoutContainer>
            <SettingsPage />
        </LayoutContainer>
    ),
});
