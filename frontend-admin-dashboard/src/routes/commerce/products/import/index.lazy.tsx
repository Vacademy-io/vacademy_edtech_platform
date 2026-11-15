import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { ProductImportPage } from '@/routes/commerce/products/-components/ProductImportPage';

export const Route = createLazyFileRoute('/commerce/products/import/')({
    component: () => (
        <LayoutContainer>
            <ProductImportPage />
        </LayoutContainer>
    ),
});
