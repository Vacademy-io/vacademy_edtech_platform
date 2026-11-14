import { createFileRoute } from '@tanstack/react-router';
import { AGENT_TABS, type AgentTab } from '../-utils/agent-tabs';

/** One Lead Agent. `?tab=` opens a tab (review, delivered, rejected, progress, activity, settings, extension). */
export const Route = createFileRoute('/audience-manager/lead-agent/$agentId/')({
    validateSearch: (search: Record<string, unknown>): { tab?: AgentTab } => ({
        tab: AGENT_TABS.find((t) => t === search.tab),
    }),
});
