import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { SiteAssistantPage } from './-components/SiteAssistantPage';

export const Route = createLazyFileRoute('/manage-pages/site-assistant/')({
    component: () => (
        <LayoutContainer>
            <SiteAssistantPage />
        </LayoutContainer>
    ),
});
