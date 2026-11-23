import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { AdPerformancePage } from './-components/ad-performance-page';

export const Route = createLazyFileRoute('/audience-manager/ad-performance/')({
    component: AdPerformanceRoute,
});

function AdPerformanceRoute() {
    return (
        <LayoutContainer>
            <AdPerformancePage />
        </LayoutContainer>
    );
}
