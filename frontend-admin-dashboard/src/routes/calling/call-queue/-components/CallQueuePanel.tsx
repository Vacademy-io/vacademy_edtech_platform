/**
 * Call Queue — this institute's own AI calls waiting to go out.
 *
 * AI calls do not all dial at once: a bulk campaign or a workflow burst queues, and
 * calls leave the queue as capacity frees up. This page is where that becomes
 * visible — how many are waiting, roughly how long they will take, which are on a
 * call right now, and what can be called off.
 *
 * <b>No capacity figures are shown.</b> How many simultaneous lines exist, and how
 * many this institute may hold, are internal operating facts; the API does not return
 * them to an institute and this page must not imply them. The wait is expressed as
 * time, which is the part that concerns the person reading it.
 *
 * Institute-scoped end to end — every endpoint behind it validates the caller against
 * the institute server-side.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowsClockwise,
    HourglassMedium,
    Info,
    ListNumbers,
    Pause,
    PauseCircle,
    PhoneCall,
    Play,
    Prohibit,
    Timer,
    UsersThree,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { StatStrip } from '@/components/shared/crm-enhance';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
    cancelAllQueued,
    setQueuePaused,
    cancelQueuedItem,
    fetchQueueItems,
    fetchQueueRuns,
    fetchQueueSummary,
    type QueueFilter,
    type QueueItem,
    type QueueStatus,
} from '../-services/ai-call-queue-service';

/** Poll cadence. The drainer ticks every 2s server-side; this is a human-facing view. */
const REFETCH_MS = 10_000;
const PAGE_SIZE = 25;
// Radix Select cannot hold an empty value, so "All sources" uses a sentinel.
const ALL_SOURCES = '__all__';

const STATUS_FILTERS: Array<{ key: QueueFilter; label: string }> = [
    // Default. Waiting + already dialling: a manual call dials the moment a line is
    // free, so it is never "waiting", and a QUEUED-only default left this table empty
    // whenever calling was working normally.
    { key: 'ACTIVE', label: 'Active' },
    { key: 'QUEUED', label: 'Waiting' },
    // Distinct from Dialled on purpose: a queue row reads DIALED from the instant the
    // provider accepts it until the end of time, so "Dialled" alone mixes a call that is
    // talking right now with one that ended this morning.
    { key: 'LIVE', label: 'On call now' },
    { key: 'DIALED', label: 'Dialled' },
    { key: 'FAILED', label: 'Failed' },
    { key: 'EXPIRED', label: 'Expired' },
    { key: 'CANCELLED', label: 'Cancelled' },
    { key: 'ALL', label: 'All' },
];

export default function CallQueuePanel({ instituteId }: { instituteId: string }) {
    const queryClient = useQueryClient();
    const [status, setStatus] = useState<QueueFilter>('ACTIVE');
    // Which bulk run to show. '' = everything. Narrowing is how you find the campaign
    // whose progress dialog you closed, and it is also what scopes "cancel the rest".
    const [runId, setRunId] = useState('');
    const [page, setPage] = useState(0);

    const runs = useQuery({
        queryKey: ['ai-call-queue-runs', instituteId],
        queryFn: () => fetchQueueRuns(instituteId),
        enabled: !!instituteId,
    });
    const runName = runs.data?.find((r) => r.audienceId === runId)?.name;

    const summaryQuery = useQuery({
        queryKey: ['ai-call-queue-summary', instituteId],
        queryFn: () => fetchQueueSummary(instituteId),
        enabled: !!instituteId,
        refetchInterval: REFETCH_MS,
    });

    const itemsQuery = useQuery({
        queryKey: ['ai-call-queue-items', instituteId, status, runId, page],
        queryFn: () =>
            fetchQueueItems({
                instituteId,
                status,
                sourceRef: runId || undefined,
                page,
                size: PAGE_SIZE,
            }),
        enabled: !!instituteId,
        refetchInterval: REFETCH_MS,
    });

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['ai-call-queue-summary', instituteId] });
        queryClient.invalidateQueries({ queryKey: ['ai-call-queue-items', instituteId] });
        queryClient.invalidateQueries({ queryKey: ['ai-call-queue-runs', instituteId] });
    };

    const cancelAll = useMutation({
        // Scoped to the selected campaign when one is chosen. Unscoped it cancels
        // EVERYTHING waiting — other campaigns, automations, counsellors' own calls —
        // so the button below says which it will be rather than leaving it to be found out.
        mutationFn: () =>
            cancelAllQueued(instituteId, 'Cancelled from the call queue', runId || undefined),
        onSuccess: (r) => {
            toast.success(`${r.cancelled} queued call${r.cancelled === 1 ? '' : 's'} cancelled`);
            invalidate();
        },
        onError: () => toast.error('Could not cancel the queue'),
    });

    // Pause/resume is deliberately separate from cancel: it stops calls going out
    // without giving up any of them, so an admin can look at what the last batch did
    // before letting the rest run.
    const togglePause = useMutation({
        mutationFn: (paused: boolean) => setQueuePaused(instituteId, paused),
        onSuccess: (r) => {
            toast.success(
                r.paused
                    ? 'Queue paused — waiting calls are held, nothing cancelled'
                    : 'Queue resumed — calls will start dialling again'
            );
            invalidate();
        },
        onError: () => toast.error('Could not change the queue state'),
    });

    const cancelOne = useMutation({
        mutationFn: (id: string) =>
            cancelQueuedItem(instituteId, id, 'Cancelled from the call queue'),
        onSuccess: (r) => {
            // A false here is not a failure: the call started dialling between the
            // render and the click, and there is nothing left to take back.
            if (r.cancelled) {
                toast.success('Call removed from the queue');
            } else {
                toast.info('That call has already gone out');
            }
            invalidate();
        },
        onError: () => toast.error('Could not cancel that call'),
    });

    const summary = summaryQuery.data;
    // A count on each status filter, from the summary this panel
    // already polls. "Active" has no single honest number, so it stays bare.
    const queueCount = (key: QueueFilter): number | undefined => {
        if (!summary) return undefined;
        if (key === 'QUEUED') return summary.queued;
        if (key === 'LIVE') return summary.inFlight;
        if (key === 'ACTIVE') return undefined;
        return summary.byStatus?.[key];
    };
    const rows = itemsQuery.data?.content ?? [];
    const totalPages = itemsQuery.data?.totalPages ?? 0;

    return (
        <div className="flex flex-col gap-4">
            {/* Depth, what is live, and the honest wait. Deliberately no capacity
                figures and no "x of y" — the size of the calling pool is internal, and
                a denominator here would disclose it. */}
            <StatStrip
                items={[
                    {
                        key: 'waiting',
                        icon: HourglassMedium,
                        label: 'Waiting',
                        value: summary ? String(summary.queued) : '—',
                        detail: 'calls queued',
                        loading: summaryQuery.isLoading,
                    },
                    {
                        key: 'live',
                        icon: PhoneCall,
                        tint: 'success',
                        label: 'On a call now',
                        value: summary ? String(summary.inFlight) : '—',
                        detail: 'calls in progress',
                        loading: summaryQuery.isLoading,
                    },
                    {
                        key: 'eta',
                        icon: Timer,
                        tint: 'info',
                        label: 'Clears in',
                        value: summary ? formatEta(summary.etaMinutes) : '—',
                        detail: 'estimated · at the current pace',
                        loading: summaryQuery.isLoading,
                    },
                ]}
            />

            {summary?.paused && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning-200 bg-warning-50 p-3 text-body text-warning-700">
                    <PauseCircle size={18} weight="fill" className="shrink-0" />
                    <span className="min-w-0 flex-1">
                        <span className="font-semibold">Calling is paused for this institute</span>{' '}
                        — {summary.queued} queued call
                        {summary.queued === 1 ? ' is' : 's are'} held and will dial when you resume.
                        Nothing has been cancelled.
                    </span>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={togglePause.isPending}
                        onClick={() => togglePause.mutate(false)}
                    >
                        <Play size={12} className="mr-1" />
                        Resume queue
                    </MyButton>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1">
                    {STATUS_FILTERS.map((f) => (
                        <button
                            key={f.key}
                            type="button"
                            onClick={() => {
                                setStatus(f.key);
                                setPage(0);
                            }}
                            className={cn(
                                'rounded-md px-2.5 py-1 text-caption font-medium transition-colors',
                                status === f.key
                                    ? 'bg-primary-500 text-white'
                                    : 'text-neutral-600 hover:bg-neutral-50'
                            )}
                        >
                            {f.label}
                            {queueCount(f.key) !== undefined && (
                                <span className="ml-1.5 tabular-nums opacity-80">
                                    {queueCount(f.key)}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                {/* Campaign filter. Without it a hundred-lead run is a hundred rows you
                    scan by eye, and there is no way back to the run whose progress
                    dialog you closed. */}
                {(runs.data?.length ?? 0) > 0 && (
                    <Select
                        value={runId || ALL_SOURCES}
                        onValueChange={(v) => {
                            setRunId(v === ALL_SOURCES ? '' : v);
                            setPage(0);
                        }}
                    >
                        <SelectTrigger
                            className="h-9 w-full bg-white sm:w-64"
                            aria-label="Source (campaign run)"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_SOURCES}>All sources</SelectItem>
                            {runs.data?.map((r) => (
                                <SelectItem key={r.audienceId} value={r.audienceId}>
                                    {r.name} ({r.total})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                <span className="text-caption text-neutral-500">Ordered by place in line</span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        className="gap-1.5"
                        onClick={() => invalidate()}
                        disable={itemsQuery.isFetching}
                    >
                        <ArrowsClockwise
                            size={14}
                            className={cn(itemsQuery.isFetching && 'animate-spin')}
                        />
                        Refresh
                    </MyButton>
                    {/* The label names its own blast radius. Unscoped, this stops every
                        waiting call the institute has — including automations and other
                        people's manual calls — which is not what someone stopping one
                        campaign expects. */}
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        className="gap-1.5"
                        disable={togglePause.isPending || !summary}
                        onClick={() => togglePause.mutate(!summary?.paused)}
                        title={
                            summary?.paused
                                ? 'Let the queue dial again'
                                : 'Hold every waiting call — nothing is cancelled'
                        }
                    >
                        {summary?.paused ? <Play size={14} /> : <Pause size={14} />}
                        {summary?.paused ? 'Resume queue' : 'Pause queue'}
                    </MyButton>

                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        className="gap-1.5 !text-danger-600"
                        disable={!summary?.queued || cancelAll.isPending}
                        onClick={() => {
                            const scope = runName
                                ? `Cancel the calls still waiting in "${runName}"?`
                                : 'Cancel EVERY call this institute has waiting — including other campaigns and automations?';
                            if (window.confirm(scope)) cancelAll.mutate();
                        }}
                    >
                        <Prohibit size={14} />
                        {runName ? 'Cancel this campaign' : 'Cancel all waiting'}
                    </MyButton>
                </div>
            </div>

            <Card className="overflow-hidden rounded-xl border-neutral-200 shadow-sm">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-16">#</TableHead>
                                <TableHead>Lead</TableHead>
                                <TableHead>Agent</TableHead>
                                <TableHead>Queued by</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Waits</TableHead>
                                <TableHead className="w-24" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {itemsQuery.isLoading ? (
                                [0, 1, 2].map((i) => (
                                    <TableRow key={i}>
                                        <TableCell colSpan={7}>
                                            <Skeleton className="h-8 w-full" />
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : rows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="py-12">
                                        <div className="flex flex-col items-center gap-2 text-center">
                                            <ListNumbers
                                                size={32}
                                                weight="duotone"
                                                className="text-neutral-300"
                                            />
                                            <p className="text-body font-medium text-neutral-600">
                                                {status === 'ACTIVE'
                                                    ? 'Nothing in the queue — no AI calls are waiting or in progress.'
                                                    : status === 'QUEUED'
                                                      ? 'Nothing is waiting — AI calls are going out as they are requested.'
                                                      : status === 'LIVE'
                                                        ? 'No AI calls are on a call right now.'
                                                        : 'No calls in this state.'}
                                            </p>
                                            <p className="max-w-md text-caption text-neutral-500">
                                                Calls enter the queue from a bulk AI call, a
                                                workflow AI-call step, or a manual AI call when
                                                every line is busy.
                                            </p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                rows.map((item) => (
                                    <QueueRow
                                        key={item.id}
                                        item={item}
                                        onCancel={() => cancelOne.mutate(item.id)}
                                        cancelling={cancelOne.isPending}
                                    />
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {totalPages > 1 && (
                    <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-4 py-3">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={page <= 0}
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                        >
                            Previous
                        </MyButton>
                        <span className="text-caption text-neutral-600">
                            Page {page + 1} of {totalPages}
                        </span>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={page + 1 >= totalPages}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            Next
                        </MyButton>
                    </div>
                )}
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* The runs this page already loads for the source filter, as a list
                    you can jump back into. */}
                <Card className="rounded-xl border-neutral-200 p-4 shadow-sm lg:col-span-2">
                    <div className="mb-3 flex items-center gap-2">
                        <UsersThree size={16} className="text-neutral-500" />
                        <h3 className="text-subtitle font-semibold text-neutral-800">
                            Campaign runs
                        </h3>
                        <span className="text-caption text-neutral-500">· latest bulk runs</span>
                    </div>
                    {runs.isLoading ? (
                        <div className="flex flex-col gap-2">
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                    ) : (runs.data?.length ?? 0) === 0 ? (
                        <p className="text-body text-neutral-500">
                            No bulk AI-call runs yet. A run appears here when you call a list of
                            leads with AI.
                        </p>
                    ) : (
                        <div className="flex flex-col divide-y divide-neutral-100">
                            {runs.data?.map((r) => (
                                <div
                                    key={r.audienceId}
                                    className="flex flex-wrap items-center gap-3 py-2.5"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-body font-medium text-neutral-800">
                                            {r.name}
                                        </p>
                                        <p className="text-caption text-neutral-500">
                                            {r.total} call{r.total === 1 ? '' : 's'} queued
                                            {r.startedAt
                                                ? ` · started ${new Date(r.startedAt).toLocaleString()}`
                                                : ''}
                                        </p>
                                    </div>
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        disable={runId === r.audienceId}
                                        onClick={() => {
                                            setRunId(r.audienceId);
                                            setStatus('ALL');
                                            setPage(0);
                                        }}
                                    >
                                        {runId === r.audienceId ? 'Showing' : 'Show calls'}
                                    </MyButton>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                <Card className="rounded-xl border-neutral-200 p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                        <Info size={16} className="text-neutral-500" />
                        <h3 className="text-subtitle font-semibold text-neutral-800">
                            How the queue works
                        </h3>
                    </div>
                    <ul className="flex list-disc flex-col gap-1.5 pl-4 text-caption text-neutral-600">
                        <li>
                            <span className="font-semibold">Only AI calls</span> queue. A
                            counsellor&apos;s click-to-call never waits here.
                        </li>
                        <li>
                            <span className="font-semibold">Pause</span> holds every waiting call;
                            nothing is cancelled. <span className="font-semibold">Cancel</span>{' '}
                            removes calls for good.
                        </li>
                        <li>
                            &ldquo;#&rdquo; is the place in your institute&apos;s line;{' '}
                            <span className="font-semibold">Waits</span> is an estimated time.
                        </li>
                        <li>Calls outside the calling shift wait until the next shift.</li>
                    </ul>
                </Card>
            </div>
        </div>
    );
}

function QueueRow({
    item,
    onCancel,
    cancelling,
}: {
    item: QueueItem;
    onCancel: () => void;
    cancelling: boolean;
}) {
    const waiting = item.status === 'QUEUED';
    return (
        <TableRow>
            {/* Position is per LANE, not per page — an institute drains at its own rate
                regardless of what other institutes have queued. */}
            <TableCell className="text-sm text-neutral-500">
                {waiting && item.aheadInLane != null ? item.aheadInLane + 1 : '—'}
            </TableCell>
            {/* Name first; the number is the subtitle. Showing only a number made the
                column read as empty to anyone scanning for a person. */}
            <TableCell className="text-sm text-neutral-900">
                <div className="flex flex-col">
                    <span>{item.leadName || item.phoneNumber || item.userId || '—'}</span>
                    {item.leadName && item.phoneNumber && (
                        <span className="text-xs text-neutral-500">{item.phoneNumber}</span>
                    )}
                </div>
            </TableCell>
            <TableCell className="text-sm text-neutral-700">{item.agentName || '—'}</TableCell>
            <TableCell className="text-sm text-neutral-600">{sourceLabel(item)}</TableCell>
            <TableCell>
                <div className="flex flex-col gap-0.5">
                    {/* A live call gets its OWN badge rather than the queue's DIALED,
                        which would otherwise read the same as a call that ended hours ago. */}
                    {item.live ? (
                        <Badge
                            variant="outline"
                            className="w-fit border-0 bg-success-50 text-xs text-success-600"
                        >
                            <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-success-500" />
                            On call
                            {item.callDurationSeconds
                                ? ` · ${formatDuration(item.callDurationSeconds)}`
                                : ''}
                        </Badge>
                    ) : (
                        <StatusBadge status={item.status} />
                    )}
                    {item.statusReason && (
                        <span className="text-xs text-neutral-500">{item.statusReason}</span>
                    )}
                    {/* The call's own outcome, which the queue row never records. */}
                    {!item.live && item.callStatus && item.status === 'DIALED' && (
                        <span className="text-xs text-neutral-500">
                            {prettyCallStatus(item.callStatus)}
                            {item.callDurationSeconds
                                ? ` · ${formatDuration(item.callDurationSeconds)}`
                                : ''}
                        </span>
                    )}
                </div>
            </TableCell>
            <TableCell className="text-sm text-neutral-600">
                {waiting && item.etaMinutes != null ? formatEta(item.etaMinutes) : '—'}
            </TableCell>
            <TableCell>
                {waiting && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger-600"
                        disabled={cancelling}
                        onClick={onCancel}
                    >
                        Cancel
                    </Button>
                )}
            </TableCell>
        </TableRow>
    );
}

function StatusBadge({ status }: { status: QueueStatus }) {
    const tone: Record<QueueStatus, string> = {
        QUEUED: 'bg-primary-50 text-primary-600',
        DISPATCHING: 'bg-primary-50 text-primary-600',
        DIALED: 'bg-success-50 text-success-600',
        FAILED: 'bg-danger-50 text-danger-600',
        EXPIRED: 'bg-warning-50 text-warning-700',
        CANCELLED: 'bg-neutral-100 text-neutral-600',
    };
    const label: Record<QueueStatus, string> = {
        QUEUED: 'Waiting',
        DISPATCHING: 'Connecting',
        DIALED: 'Dialled',
        FAILED: 'Failed',
        EXPIRED: 'Expired',
        CANCELLED: 'Cancelled',
    };
    return (
        <Badge variant="outline" className={cn('w-fit border-0 text-xs', tone[status])}>
            {label[status]}
        </Badge>
    );
}

/**
 * Where the call came from, in the words an admin would use.
 *
 * A bulk row names its campaign. Without that, a hundred rows all read "Bulk campaign"
 * and two concurrent runs are indistinguishable — including the one whose progress
 * dialog you just closed, which this page is meant to let you pick back up.
 */
function sourceLabel(item: QueueItem): string {
    switch (item.source) {
        case 'MANUAL':
            return 'Manual click';
        case 'BULK':
            return item.sourceName ? `Campaign · ${item.sourceName}` : 'Bulk campaign';
        case 'WORKFLOW':
            return 'Automation';
        case 'API':
            return 'API (your systems)';
        default:
            return item.source || '—';
    }
}

/** Call length, as a person would read it off a phone. */
function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

/** The call log's own status vocabulary, softened for a queue screen. */
function prettyCallStatus(status: string): string {
    switch (status) {
        case 'COMPLETED':
            return 'Completed';
        case 'NO_ANSWER':
            return 'No answer';
        case 'BUSY':
            return 'Busy';
        case 'FAILED':
            return 'Call failed';
        case 'CANCELLED':
            return 'Cancelled';
        default:
            return status;
    }
}

/** "2h 40m" reads better than "160 minutes" on a queue that runs for hours. */
function formatEta(minutes?: number | null): string {
    if (minutes == null) return '—';
    if (minutes <= 0) return 'Next up';
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
