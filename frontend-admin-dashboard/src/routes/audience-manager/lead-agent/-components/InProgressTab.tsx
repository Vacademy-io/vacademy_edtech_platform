import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { CandidateStatus, LeadAgent } from '../-types';
import { CANDIDATE_STATUS_LABEL, IN_PROGRESS_STATUSES } from '../-utils/lead-agent-options';
import { useCandidates } from '../-hooks/use-lead-agent';
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

/** Where the pipeline is: counts per working status, and the list for the one picked. */
export function InProgressTab({ agent }: { agent: LeadAgent }) {
    const [status, setStatus] = useState<CandidateStatus>('RESEARCHING');
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
            <CandidatesTab key={status} agent={agent} status={status} />
        </div>
    );
}
