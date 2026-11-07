import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { LeadAgentListPage } from './-components/LeadAgentListPage';

export const Route = createLazyFileRoute('/audience-manager/lead-agent/')({
    component: () => (
        <LayoutContainer>
            <LeadAgentListPage />
        </LayoutContainer>
    ),
});
