import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { TaxClassesPage } from '@/routes/commerce/settings/-components/TaxClassesPage';

export const Route = createLazyFileRoute('/commerce/settings/tax-classes/')({
    component: () => (
        <LayoutContainer>
            <TaxClassesPage />
        </LayoutContainer>
    ),
});
