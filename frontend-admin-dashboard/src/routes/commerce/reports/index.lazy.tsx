import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { ReportsScreen } from '@/routes/commerce/reports/-components/ReportsScreen';

/** WP-51: the reports home and the report pages. */
export const Route = createLazyFileRoute('/commerce/reports/')({
    component: () => (
        <LayoutContainer>
            <ReportsScreen />
        </LayoutContainer>
    ),
});
