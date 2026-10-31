import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { LiveActivityPage } from './-components/live-activity-page';

export const Route = createLazyFileRoute('/live-activity/')({
    component: LiveActivityRoute,
});

function LiveActivityRoute() {
    return (
        <LayoutContainer>
            <LiveActivityPage />
        </LayoutContainer>
    );
}
