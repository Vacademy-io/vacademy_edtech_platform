import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { StaffPage } from '@/routes/commerce/settings/-components/StaffPage';

export const Route = createLazyFileRoute('/commerce/settings/staff/')({
    component: () => (
        <LayoutContainer>
            <StaffPage />
        </LayoutContainer>
    ),
});
