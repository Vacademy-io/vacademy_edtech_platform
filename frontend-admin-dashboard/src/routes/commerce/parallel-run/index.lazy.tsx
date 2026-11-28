import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { ParallelRunPage } from '@/routes/commerce/parallel-run/-components/ParallelRunPage';

/** WP-53: switch-over days, one row per day, the clean-day streak and the export. */
export const Route = createLazyFileRoute('/commerce/parallel-run/')({
    component: () => (
        <LayoutContainer>
            <ParallelRunPage />
        </LayoutContainer>
    ),
});
