import { useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { CandidateStatus, LeadAgent } from '../-types';
import { CANDIDATE_STATUS_LABEL, IN_PROGRESS_STATUSES } from '../-utils/lead-agent-options';
import { useApprovedWaiting, useCandidates, useDeliverNow } from '../-hooks/use-lead-agent';
import { CandidatesTab } from './CandidatesTab';

function CountTile({
    agentId,
    status,
    active,
    onSelect,
}: {
    agentId: string;
    status: CandidateStatus;
    active: boolean;
    onSelect: () => void;
}) {
    // size=1: only the total is needed for the tile.
    const q = useCandidates(agentId, status, 0, 1);
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={active}
            className={cn(
                'flex flex-col items-start gap-1 rounded-lg border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                active
                    ? 'border-primary-300 bg-primary-50'
                    : 'border-neutral-200 bg-card hover:border-primary-200'
            )}
        >
            <span className="text-h3 font-semibold text-neutral-800">
                {q.isLoading ? '…' : q.isError ? '—' : q.data?.total ?? 0}
            </span>
            <span className="text-caption text-neutral-600">{CANDIDATE_STATUS_LABEL[status]}</span>
        </button>
    );
}

/** Approved leads go out on the agent's own runs; Sync now delivers them straight away. */
function SyncApprovedBar({ agent }: { agent: LeadAgent }) {
    const waiting = useApprovedWaiting(agent.id).data ?? 0;
    const sync = useDeliverNow(agent.id);
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-caption text-neutral-600">
                {agent.status === 'PAUSED'
                    ? 'The agent is paused, so approved leads are not delivered on their own. '
                    : 'Approved leads are delivered on the agent’s runs, inside the delivery window. '}
                Sync now sends them all to the lead list straight away, up to today’s daily limit;
                to send only some, tick them below and press Deliver.
            </p>
            <MyButton
                type="button"
                buttonType="secondary"
                disable={sync.isPending || waiting === 0 || agent.status === 'ARCHIVED'}
                onClick={() => sync.mutate()}
                className="shrink-0"
            >
                <ArrowsClockwise className={cn('size-4', sync.isPending && 'animate-spin')} />{' '}
                {sync.isPending ? 'Syncing…' : 'Sync now'}
            </MyButton>
        </div>
    );
}

/** Where the pipeline is: counts per working status, and the list for the one picked. */
export function InProgressTab({
    agent,
    initialStatus = 'RESEARCHING',
}: {
    agent: LeadAgent;
    initialStatus?: CandidateStatus;
}) {
    const [status, setStatus] = useState<CandidateStatus>(initialStatus);
    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {IN_PROGRESS_STATUSES.map((s) => (
                    <CountTile
                        key={s}
                        agentId={agent.id}
                        status={s}
                        active={s === status}
                        onSelect={() => setStatus(s)}
                    />
                ))}
            </div>
            {status === 'APPROVED' && <SyncApprovedBar agent={agent} />}
            <CandidatesTab key={status} agent={agent} status={status} />
        </div>
    );
}
