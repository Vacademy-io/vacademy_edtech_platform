import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus, Robot } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { EmptyState, ErrorState } from '@/routes/manage-pages/site-assistant/-components/TabStates';
import type { LeadAgent } from '../-types';
import { MODE_LABEL } from '../-utils/lead-agent-options';
import { useLeadAgents } from '../-hooks/use-lead-agent';
import { apiErrorMessage, apiErrorStatus } from '../-services/lead-agent-api';
import { AgentStatusSwitch, WorkersOnline } from './AgentStatusControls';
import { CreateAgentDialog } from './CreateAgentDialog';

const WHAT_IT_DOES =
    'A Lead Agent is attached to one lead list. It reads your brief (what you sell, who buys it and where), finds organisations on the web, reads their websites, scores how good a fit they are and finds a way to reach a decision maker. Every day the best leads go into the list, best first, up to your daily limit and inside your working hours. You can ask to approve leads before they are sent. From there the list’s own automations take over.';

const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-col">
        <span className="text-caption text-neutral-500">{label}</span>
        <span className="text-subtitle font-semibold text-neutral-800">{value}</span>
    </div>
);

function AgentCard({ agent }: { agent: LeadAgent }) {
    const delivered = agent.today?.delivered ?? 0;
    const review = agent.review_waiting ?? agent.today?.review;
    return (
        <Card className="flex flex-col">
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4">
                <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle className="truncate text-title">
                        <Link
                            to="/audience-manager/lead-agent/$agentId"
                            params={{ agentId: agent.id }}
                            className="hover:text-primary-500 hover:underline"
                        >
                            {agent.name}
                        </Link>
                    </CardTitle>
                    <span className="truncate text-caption text-neutral-500">
                        List: {agent.audience_name || 'Unnamed list'}
                    </span>
                </div>
                <AgentStatusSwitch agent={agent} />
            </CardHeader>
            <CardContent className="flex flex-col gap-4 p-4 pt-0">
                <div className="grid grid-cols-3 gap-3">
                    <Stat label="Delivered today" value={`${delivered} / ${agent.daily_quota}`} />
                    <Stat
                        label={
                            agent.review_waiting !== undefined
                                ? 'Waiting for approval'
                                : 'To approve today'
                        }
                        value={review === undefined ? '—' : String(review)}
                    />
                    <Stat label="Runs on" value={MODE_LABEL[agent.mode]} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    {agent.mode !== 'REMOTE' ? (
                        <WorkersOnline count={agent.workers_online} />
                    ) : (
                        <span className="text-caption text-neutral-500">Runs on our servers</span>
                    )}
                    <Link
                        to="/audience-manager/lead-agent/$agentId"
                        params={{ agentId: agent.id }}
                        className="text-caption font-semibold text-primary-500 hover:underline"
                    >
                        Open
                    </Link>
                </div>
                {agent.last_error && (
                    <p className="line-clamp-2 rounded-md bg-danger-50 p-2 text-caption text-danger-700">
                        Last problem: {agent.last_error}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

/** /audience-manager/lead-agent: every agent of the institute, plus "New Lead Agent". */
export function LeadAgentListPage() {
    const { setNavHeading } = useNavHeadingStore();
    const [createOpen, setCreateOpen] = useState(false);
    const agentsQuery = useLeadAgents();
    const agents = (agentsQuery.data ?? []).filter((a) => a.status !== 'ARCHIVED');

    useEffect(() => {
        setNavHeading('Lead Agent');
    }, [setNavHeading]);

    const notEnabled = [403, 404].includes(apiErrorStatus(agentsQuery.error) ?? 0);

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                    <h1 className="flex items-center gap-2 text-h3 font-semibold text-neutral-800">
                        <Robot className="size-6 text-primary-500" weight="fill" />
                        Lead Agent
                    </h1>
                    <p className="max-w-2xl text-body text-neutral-600">
                        Finds organisations that fit what you sell and puts the good ones into a
                        lead list every day.
                    </p>
                </div>
                {!notEnabled && (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        onClick={() => setCreateOpen(true)}
                        disable={agentsQuery.isLoading}
                        className="shrink-0"
                    >
                        <Plus className="size-4" /> New Lead Agent
                    </MyButton>
                )}
            </header>

            {agentsQuery.isLoading ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Skeleton className="h-44 w-full" />
                    <Skeleton className="h-44 w-full" />
                </div>
            ) : agentsQuery.isError ? (
                notEnabled ? (
                    <EmptyState
                        icon={<Robot className="size-8 text-neutral-400" />}
                        title="Lead Agent is not on for your institute yet"
                    >
                        {WHAT_IT_DOES} Ask your account manager to turn it on.
                    </EmptyState>
                ) : (
                    <ErrorState
                        message={apiErrorMessage(agentsQuery.error, 'Could not load your agents.')}
                        onRetry={() => void agentsQuery.refetch()}
                    />
                )
            ) : agents.length === 0 ? (
                <EmptyState
                    icon={<Robot className="size-8 text-neutral-400" />}
                    title="No Lead Agent yet"
                >
                    <p>{WHAT_IT_DOES}</p>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        className="mt-4"
                        onClick={() => setCreateOpen(true)}
                    >
                        <Plus className="size-4" /> New Lead Agent
                    </MyButton>
                </EmptyState>
            ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {agents.map((a) => (
                        <AgentCard key={a.id} agent={a} />
                    ))}
                </div>
            )}

            <CreateAgentDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                agents={agentsQuery.data}
            />
        </div>
    );
}
