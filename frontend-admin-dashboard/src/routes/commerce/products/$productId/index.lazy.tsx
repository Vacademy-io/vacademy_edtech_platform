import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { ProductEditorPage } from '@/routes/commerce/products/-components/ProductEditorPage';

function ProductEditorRoute() {
    const { productId } = Route.useParams();
    return (
        <LayoutContainer>
            <ProductEditorPage productId={productId} />
        </LayoutContainer>
    );
}

export const Route = createLazyFileRoute('/commerce/products/$productId/')({
    component: ProductEditorRoute,
});
