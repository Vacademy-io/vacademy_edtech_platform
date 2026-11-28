import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { LocationsPage } from '@/routes/commerce/settings/-components/LocationsPage';

export const Route = createLazyFileRoute('/commerce/settings/locations/')({
    component: () => (
        <LayoutContainer>
            <LocationsPage />
        </LayoutContainer>
    ),
});
