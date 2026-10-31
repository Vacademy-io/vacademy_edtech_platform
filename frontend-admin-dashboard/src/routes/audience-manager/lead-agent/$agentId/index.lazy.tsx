import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { AgentDetailPage } from '../-components/AgentDetailPage';

export const Route = createLazyFileRoute('/audience-manager/lead-agent/$agentId/')({
    component: AgentDetailRoute,
});

function AgentDetailRoute() {
    const { agentId } = Route.useParams();
    const { tab } = Route.useSearch();
    return (
        <LayoutContainer>
            <AgentDetailPage agentId={agentId} tab={tab ?? 'review'} />
        </LayoutContainer>
    );
}
