import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { BusinessTaxPage } from '@/routes/commerce/settings/-components/BusinessTaxPage';

export const Route = createLazyFileRoute('/commerce/settings/business/')({
    component: () => (
        <LayoutContainer>
            <BusinessTaxPage />
        </LayoutContainer>
    ),
});
