import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, PaperPlaneTilt, Tray, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/routes/manage-pages/site-assistant/-components/TabStates';
import type { CandidateStatus, CandidateStatusFilter, LeadAgent } from '../-types';
import {
    useBulkDecide,
    useCandidates,
    useDecideCandidate,
    useDeliverNow,
} from '../-hooks/use-lead-agent';
import { apiErrorMessage } from '../-services/lead-agent-api';
import { CandidateCard } from './CandidateCard';
import { RejectDialog } from './RejectDialog';

export const PAGE_SIZE = 25;

const EMPTY: Partial<Record<CandidateStatus, { title: string; body: string }>> = {
    REVIEW: {
        title: 'Nothing to review',
        body: 'Leads that score between your review and auto-deliver scores wait here for one click.',
    },
    DELIVERED: {
        title: 'No leads delivered yet',
        body: 'Delivered leads appear here once the agent is on and inside its delivery window.',
    },
    REJECTED: {
        title: 'No rejected or skipped leads',
        body: 'Leads that score too low, that you reject, or that are skipped (the same organisation as another lead, or already in your leads) are kept here. They are never delivered or charged.',
    },
};

/** A paged list of candidates in one status (or several; the first picks the empty state). The REVIEW
 * list adds approve / reject and bulk actions; the APPROVED list, delivering the selected leads now. */
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
    const deliver = useDeliverNow(agent.id);
    const reviewing = primary === 'REVIEW';
    const delivering = primary === 'APPROVED' && agent.status !== 'ARCHIVED';
    const selectable = reviewing || delivering;
    const items = useMemo(() => query.data?.items ?? [], [query.data]);
    const total = query.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const busy = decide.isPending || bulk.isPending || deliver.isPending;

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
        const empty = primary ? EMPTY[primary] : undefined;
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
            {selectable && (
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
                    {delivering && selected.size > 0 && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="small"
                            disable={busy}
                            onClick={() =>
                                deliver.mutate([...selected], {
                                    onSuccess: () => setSelected(new Set()),
                                })
                            }
                        >
                            <PaperPlaneTilt className="size-4" />{' '}
                            {deliver.isPending ? 'Delivering…' : `Deliver ${selected.size}`}
                        </MyButton>
                    )}
                    {reviewing && selected.size > 0 && (
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
                        selectable={selectable}
                        selected={selected.has(c.id)}
                        onSelectedChange={(on) => toggle(c.id, on)}
                        onApprove={reviewing ? () => approve([c.id]) : undefined}
                        onReject={reviewing ? () => setRejectIds([c.id]) : undefined}
                        busy={busy}
                        listLink={listLink}
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
