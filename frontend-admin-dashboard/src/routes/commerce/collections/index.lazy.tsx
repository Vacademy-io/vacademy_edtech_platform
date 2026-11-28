import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { CollectionsPage } from '@/routes/commerce/collections/-components/CollectionsPage';

export const Route = createLazyFileRoute('/commerce/collections/')({
    component: () => (
        <LayoutContainer>
            <CollectionsPage />
        </LayoutContainer>
    ),
});
