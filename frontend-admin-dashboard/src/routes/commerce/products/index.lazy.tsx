import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { ProductsListPage } from '@/routes/commerce/products/-components/ProductsListPage';

export const Route = createLazyFileRoute('/commerce/products/')({
    component: () => (
        <LayoutContainer>
            <ProductsListPage />
        </LayoutContainer>
    ),
});
