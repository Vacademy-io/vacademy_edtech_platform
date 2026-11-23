import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { ReceiptPage } from '@/routes/commerce/inventory/-components/ReceiptPage';

/** I2: one goods receipt, its pieces and labels. */
export const Route = createLazyFileRoute('/commerce/inventory/receipts/$receiptId/')({
    component: () => (
        <LayoutContainer>
            <ReceiptPage />
        </LayoutContainer>
    ),
});
