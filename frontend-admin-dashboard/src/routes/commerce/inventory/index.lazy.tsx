import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { InventoryPage } from '@/routes/commerce/inventory/-components/InventoryPage';

/** I1: stock, movements, receive, transfers, counts, low stock and labels. */
export const Route = createLazyFileRoute('/commerce/inventory/')({
    component: () => (
        <LayoutContainer>
            <InventoryPage />
        </LayoutContainer>
    ),
});
