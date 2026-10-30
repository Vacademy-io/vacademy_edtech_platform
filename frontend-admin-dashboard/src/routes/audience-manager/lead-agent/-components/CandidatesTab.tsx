import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, Tray, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/routes/manage-pages/site-assistant/-components/TabStates';
import type { CandidateStatus, CandidateStatusFilter, LeadAgent } from '../-types';
import { useBulkDecide, useCandidates, useDecideCandidate } from '../-hooks/use-lead-agent';
import { apiErrorMessage } from '../-services/lead-agent-api';
import { CandidateCard } from './CandidateCard';
import { RejectDialog } from './RejectDialog';

export const PAGE_SIZE = 25;

type EmptyCopy = { title: string; body: string };

const EMPTY: Partial<Record<CandidateStatus, EmptyCopy>> = {
    APPROVED: {
        title: 'No leads ready to send',
        body: 'Leads that score at least your minimum score wait here until the agent sends them, best first, up to your daily quota.',
    },
    DELIVERED: {
        title: 'No leads delivered yet',
        body: 'Delivered leads appear here once the agent is on and inside its delivery window.',
    },
    REJECTED: {
        title: 'No rejected or skipped leads',
        body: 'Leads that score below your minimum score to send, that lack a buying signal you require, that you reject, or that are skipped (the same organisation as another lead, or already in your leads) are kept here. They are never delivered or charged.',
    },
};

/** The approval queue only ever holds leads at or above the minimum score (lower ones are rejected):
 * every one of them when approval is on, otherwise just those that need a person (possible
 * duplicates, leads judged only from Google Maps). */
const approvalEmpty = (requireApproval: boolean): EmptyCopy => ({
    title: 'Nothing waiting for approval',
    body: requireApproval
        ? 'Leads that score at least your minimum score wait here for one click before they are sent. Approved leads are sent best first, up to your daily quota.'
        : 'Leads that score at least your minimum score are sent automatically. Only the ones that need a person wait here: possible duplicates and leads judged only from Google Maps. To approve every lead first, turn on “Approve leads before they’re sent” in Settings.',
});

/** A paged list of candidates in one status (or several; the first picks the empty state). The REVIEW
 * list adds approve / reject and bulk actions. */
export function CandidatesTab({
    agent,
    status,
}: {
    agent: LeadAgent;
    status: CandidateStatusFilter;
}) {
    const [page, setPage] = useState(0);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [rejectIds, setRejectIds] = useState<string[] | null>(null);
    const query = useCandidates(agent.id, status, page, PAGE_SIZE);
    const decide = useDecideCandidate(agent.id);
    const bulk = useBulkDecide(agent.id);
    const primary = typeof status === 'string' ? status : status[0];
    const reviewing = primary === 'REVIEW';
    const items = useMemo(() => query.data?.items ?? [], [query.data]);
    const total = query.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const busy = decide.isPending || bulk.isPending;

    // Selection only covers what is on screen.
    useEffect(() => {
        setSelected((prev) => {
            const onPage = new Set(items.map((i) => i.id));
            const next = new Set([...prev].filter((id) => onPage.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [items]);

    // A page emptied by decisions falls back to the previous one.
    useEffect(() => {
        if (!query.isFetching && page > 0 && items.length === 0 && total > 0) {
            setPage(Math.max(0, totalPages - 1));
        }
    }, [query.isFetching, page, items.length, total, totalPages]);

    const toggle = (id: string, on: boolean) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (on) next.add(id);
            else next.delete(id);
            return next;
        });

    const approve = (ids: string[]) => {
        if (ids.length === 1 && ids[0]) {
            decide.mutate({ candidateId: ids[0], action: 'APPROVE' });
        } else {
            bulk.mutate({ ids, action: 'APPROVE' }, { onSuccess: () => setSelected(new Set()) });
        }
    };

    const reject = (reason: string) => {
        const ids = rejectIds ?? [];
        const done = {
            onSuccess: () => {
                setRejectIds(null);
                setSelected(new Set());
            },
        };
        if (ids.length === 1 && ids[0]) {
            decide.mutate({ candidateId: ids[0], action: 'REJECT', reason }, done);
        } else if (ids.length > 1) {
            bulk.mutate({ ids, action: 'REJECT', reason }, done);
        }
    };

    const listLink = agent.audience_id ? (
        <Link
            to="/audience-manager/list/campaign-users"
            search={{
                campaignId: agent.audience_id,
                campaignName: agent.audience_name ?? undefined,
            }}
            className="font-semibold text-primary-500 hover:underline"
        >
            Open the list
        </Link>
    ) : null;

    if (query.isLoading) {
        return (
            <div className="flex flex-col gap-3">
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-40 w-full" />
            </div>
        );
    }
    if (query.isError) {
        return (
            <ErrorState
                message={apiErrorMessage(query.error, 'Could not load the leads.')}
                onRetry={() => void query.refetch()}
            />
        );
    }
    if (items.length === 0) {
        const empty =
            primary === 'REVIEW'
                ? approvalEmpty(agent.gate.require_approval)
                : primary
                  ? EMPTY[primary]
                  : undefined;
        return (
            <EmptyState
                icon={<Tray className="size-8 text-neutral-400" />}
                title={empty?.title ?? 'Nothing here'}
            >
                {empty?.body}
            </EmptyState>
        );
    }

    const allOnPage = items.length > 0 && items.every((i) => selected.has(i.id));

    return (
        <div className="flex flex-col gap-4">
            {reviewing && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2">
                    <label className="flex cursor-pointer items-center gap-2 text-body text-neutral-700">
                        <Checkbox
                            checked={allOnPage}
                            onCheckedChange={(on) =>
                                setSelected(
                                    on === true ? new Set(items.map((i) => i.id)) : new Set()
                                )
                            }
                        />
                        {selected.size > 0
                            ? `${selected.size} selected`
                            : 'Select all on this page'}
                    </label>
                    {selected.size > 0 && (
                        <div className="flex gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                disable={busy}
                                onClick={() => setRejectIds([...selected])}
                            >
                                <X className="size-4" /> Reject {selected.size}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="small"
                                disable={busy}
                                onClick={() => approve([...selected])}
                            >
                                <Check className="size-4" /> Approve {selected.size}
                            </MyButton>
                        </div>
                    )}
                </div>
            )}
            <p className="text-caption text-neutral-500">
                {total} {total === 1 ? 'lead' : 'leads'}
                {query.isFetching ? ' · refreshing…' : ''}
            </p>
            <div className="flex flex-col gap-3">
                {items.map((c) => (
                    <CandidateCard
                        key={c.id}
                        candidate={c}
                        selectable={reviewing}
                        selected={selected.has(c.id)}
                        onSelectedChange={(on) => toggle(c.id, on)}
                        onApprove={reviewing ? () => approve([c.id]) : undefined}
                        onReject={reviewing ? () => setRejectIds([c.id]) : undefined}
                        busy={busy}
                        listLink={listLink}
                        sendScore={agent.gate.send_score}
                    />
                ))}
            </div>
            {totalPages > 1 && (
                <MyPagination
                    currentPage={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    totalElements={total}
                    pageSize={PAGE_SIZE}
                />
            )}
            <RejectDialog
                open={rejectIds !== null}
                onOpenChange={(o) => !o && setRejectIds(null)}
                count={rejectIds?.length ?? 0}
                pending={busy}
                onConfirm={reject}
            />
        </div>
    );
}
