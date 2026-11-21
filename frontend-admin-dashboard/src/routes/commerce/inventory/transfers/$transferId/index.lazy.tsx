import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { TransferPage } from '@/routes/commerce/inventory/-components/TransferPage';

/** I3: a transfer (draft, dispatch, receive, challan). */
export const Route = createLazyFileRoute('/commerce/inventory/transfers/$transferId/')({
    component: () => (
        <LayoutContainer>
            <TransferPage />
        </LayoutContainer>
    ),
});
