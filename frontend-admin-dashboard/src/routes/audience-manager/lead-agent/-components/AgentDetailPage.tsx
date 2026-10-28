import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { CaretLeft, Robot } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatRelative } from '@/lib/formatters';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { EmptyState, ErrorState } from '@/routes/manage-pages/site-assistant/-components/TabStates';
import { AGENT_TABS, AGENT_TAB_LABELS, type AgentTab } from '../-utils/agent-tabs';
import { MODE_LABEL } from '../-utils/lead-agent-options';
import { useApprovedWaiting, useLeadAgent, useLeadAgents } from '../-hooks/use-lead-agent';
import { apiErrorMessage, apiErrorStatus } from '../-services/lead-agent-api';
import { ActivityTab } from './ActivityTab';
import { AgentStatusSwitch, WorkersOnline } from './AgentStatusControls';
import { CandidatesTab } from './CandidatesTab';
import { ExtensionTab } from './ExtensionTab';
import { InProgressTab } from './InProgressTab';
import { SettingsTab } from './SettingsTab';

/** /audience-manager/lead-agent/$agentId: one agent, its queues and settings. */
export function AgentDetailPage({ agentId, tab }: { agentId: string; tab: AgentTab }) {
    const navigate = useNavigate();
    const { setNavHeading } = useNavHeadingStore();
    const query = useLeadAgent(agentId);
    // GET /agents carries today's counters and workers online; GET /agents/{id} may not.
    const listRow = useLeadAgents().data?.find((a) => a.id === agentId);
    const approvedWaiting = useApprovedWaiting(agentId).data ?? 0;
    // Memoised: SettingsTab resets its form when this object changes.
    const agent = useMemo(
        () =>
            query.data
                ? {
                      ...query.data,
                      today: query.data.today ?? listRow?.today,
                      workers_online: query.data.workers_online ?? listRow?.workers_online,
                      review_waiting: query.data.review_waiting ?? listRow?.review_waiting,
                  }
                : undefined,
        [query.data, listRow]
    );

    useEffect(() => {
        setNavHeading('Lead Agent');
    }, [setNavHeading]);

    const setTab = (next: AgentTab) =>
        void navigate({
            to: '/audience-manager/lead-agent/$agentId',
            params: { agentId },
            search: { tab: next },
            replace: true,
        });

    const back = (
        <Link
            to="/audience-manager/lead-agent"
            className="inline-flex items-center gap-1 text-caption font-semibold text-neutral-600 hover:text-primary-500"
        >
            <CaretLeft className="size-4" /> All agents
        </Link>
    );

    if (query.isLoading) {
        return (
            <div className="flex flex-col gap-4">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }
    if (query.isError || !agent) {
        return (
            <div className="flex flex-col gap-4">
                {back}
                {apiErrorStatus(query.error) === 404 ? (
                    <EmptyState
                        icon={<Robot className="size-8 text-neutral-400" />}
                        title="Agent not found"
                    >
                        It may have been archived or belong to another institute.
                    </EmptyState>
                ) : (
                    <ErrorState
                        message={apiErrorMessage(query.error, 'Could not load the agent.')}
                        onRetry={() => void query.refetch()}
                    />
                )}
            </div>
        );
    }

    const delivered = agent.today?.delivered;

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-3">
                {back}
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex min-w-0 flex-col gap-1">
                        <h1 className="flex items-center gap-2 truncate text-h3 font-semibold text-neutral-800">
                            <Robot className="size-6 shrink-0 text-primary-500" weight="fill" />
                            <span className="truncate">{agent.name}</span>
                        </h1>
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-neutral-500">
                            <span>
                                List:{' '}
                                <Link
                                    to="/audience-manager/list/campaign-users"
                                    search={{
                                        campaignId: agent.audience_id,
                                        campaignName: agent.audience_name ?? undefined,
                                    }}
                                    className="font-semibold text-primary-500 hover:underline"
                                >
                                    {agent.audience_name || 'Open list'}
                                </Link>
                            </span>
                            <span>
                                Today: {delivered ?? '—'} / {agent.daily_quota} delivered
                            </span>
                            <span>Runs on: {MODE_LABEL[agent.mode]}</span>
                            {agent.mode !== 'REMOTE' && (
                                <WorkersOnline count={agent.workers_online} />
                            )}
                            {agent.last_tick_at && (
                                <span>Last run {formatRelative(agent.last_tick_at)}</span>
                            )}
                        </p>
                    </div>
                    <AgentStatusSwitch agent={agent} />
                </div>
                {agent.last_error && (
                    <p className="rounded-md border border-danger-200 bg-danger-50 p-3 text-caption text-danger-700">
                        Last problem: {agent.last_error}
                    </p>
                )}
            </header>

            <Tabs value={tab} onValueChange={(v) => setTab(v as AgentTab)}>
                <div className="overflow-x-auto">
                    <TabsList>
                        {AGENT_TABS.map((t) => (
                            <TabsTrigger key={t} value={t}>
                                {AGENT_TAB_LABELS[t]}
                                {t === 'review' && agent.review_waiting
                                    ? ` (${agent.review_waiting})`
                                    : ''}
                                {t === 'progress' && approvedWaiting > 0 && (
                                    <span
                                        className="ml-1.5 rounded-full border border-warning-300 bg-warning-50 px-1.5 text-caption font-semibold text-warning-700"
                                        title={`${approvedWaiting} approved, waiting to be delivered`}
                                    >
                                        {approvedWaiting} approved
                                    </span>
                                )}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>
                <div className="pt-4">
                    <TabsContent value="review">
                        <CandidatesTab agent={agent} status="REVIEW" />
                    </TabsContent>
                    <TabsContent value="delivered">
                        <CandidatesTab agent={agent} status="DELIVERED" />
                    </TabsContent>
                    <TabsContent value="rejected">
                        <CandidatesTab agent={agent} status="REJECTED" />
                    </TabsContent>
                    <TabsContent value="progress">
                        <InProgressTab
                            agent={agent}
                            initialStatus={approvedWaiting > 0 ? 'APPROVED' : undefined}
                        />
                    </TabsContent>
                    <TabsContent value="activity">
                        <ActivityTab agentId={agent.id} />
                    </TabsContent>
                    <TabsContent value="settings">
                        <SettingsTab agent={agent} />
                    </TabsContent>
                    <TabsContent value="extension">
                        <ExtensionTab />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
