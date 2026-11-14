import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useDebounce } from 'use-debounce';
import { toast } from 'sonner';
import { CaretRight, DownloadSimple, Info, ListChecks, WarningCircle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { exportPlanOverview, getPlanOverview } from '../-services/engagement-service';
import type { LearnerProgress, PlanOverview } from '../-types/types';
import { formatDay, formatFraction, formatNumber, formatPercent } from '../-utils/format';
import { typeMeta } from '../-utils/type-meta';
import { OverviewTiles, type OverviewTileCounts } from './overview/OverviewTiles';
import { CompletionByDayChart } from './overview/CompletionByDayChart';
import {
    LEARNER_PAGE_SIZE,
    LearnerTable,
    learnerClassOf,
    type LearnerFilter,
} from './overview/LearnerTable';

/**
 * One task's completion across the batch (server `PlanOverview.tasks[]`).
 * Declared here because the shared `types.ts` does not carry it yet; it matches
 * `EngagementTrackingDTO.TaskProgress` on the server.
 */
export interface OverviewTaskProgress {
    itemId: string;
    slotId?: string | null;
    title: string;
    itemType: string;
    /** yyyy-MM-dd of the occurrence in effect, or the next run. */
    runDate?: string | null;
    state?: 'UPCOMING' | 'OPEN' | 'CATCH_UP' | 'CLOSED' | string | null;
    /** The institute's daily cap hides this task from learners on its day. */
    capHidden?: boolean | null;
    completed: number;
    started?: number | null;
    /** completed / enrolled, 0–1; null for an empty batch. */
    rate?: number | null;
}

/** The overview fields newer servers add beyond the shared `PlanOverview` type. */
type PlanOverviewResponse = PlanOverview & {
    tasks?: OverviewTaskProgress[] | null;
    tasksOpened?: number | null;
    tasksPastDue?: number | null;
    tasksCapHidden?: number | null;
    dailyItemCap?: number | null;
    today?: string | null;
};

const LEAST_COMPLETED_LIMIT = 5;

/** Pure: the opened, visible tasks with the lowest completion first. Exported for tests. */
export function leastCompletedTasks(
    tasks: OverviewTaskProgress[] | null | undefined,
    limit = LEAST_COMPLETED_LIMIT
): { shown: OverviewTaskProgress[]; opened: number } {
    const opened = (tasks ?? []).filter(
        (task) => task.state && task.state !== 'UPCOMING' && !task.capHidden
    );
    const sorted = [...opened].sort((a, b) => {
        const ra = a.rate ?? Number.POSITIVE_INFINITY;
        const rb = b.rate ?? Number.POSITIVE_INFINITY;
        if (ra !== rb) return ra - rb;
        return (a.runDate ?? '').localeCompare(b.runDate ?? '');
    });
    return { shown: sorted.slice(0, limit), opened: opened.length };
}

/**
 * Tile counts. Newer servers send them batch-wide; an older server sends every row,
 * so they are counted from the rows instead.
 */
export function overviewTileCounts(data: PlanOverview): OverviewTileCounts {
    if (data.notStarted != null || data.behind != null || data.onTrack != null) {
        return {
            notStarted: data.notStarted ?? 0,
            behind: data.behind ?? 0,
            onTrack: data.onTrack ?? 0,
            learners: data.learners,
        };
    }
    const counts = { notStarted: 0, behind: 0, onTrack: 0, learners: data.learners };
    for (const row of data.rows) {
        const cls = learnerClassOf(row);
        if (cls === 'NOT_STARTED') counts.notStarted++;
        else if (cls === 'BEHIND') counts.behind++;
        else counts.onTrack++;
    }
    return counts;
}

/**
 * An older server ignores page/q/needsAttention and returns every row: page, search and
 * filter them here so the table behaves the same. Exported for tests.
 */
export function pageRowsLocally(
    rows: LearnerProgress[],
    {
        page,
        size,
        q,
        needsAttention,
    }: { page: number; size: number; q: string; needsAttention: boolean }
): { rows: LearnerProgress[]; totalRows: number; totalPages: number } {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((row) => {
        if (needsAttention && learnerClassOf(row) === 'ON_TRACK') return false;
        if (!needle) return true;
        return [row.fullName, row.username].some((s) => s?.toLowerCase().includes(needle));
    });
    const totalPages = filtered.length === 0 ? 0 : Math.ceil(filtered.length / size);
    const from = Math.min(page, Math.max(0, totalPages - 1)) * size;
    return {
        rows: filtered.slice(from, from + size),
        totalRows: filtered.length,
        totalPages,
    };
}

/**
 * Plan progress: who hasn't started, who is behind, how each day went, which tasks
 * landed worst, and a server-paged learner table sorted most-at-risk first.
 *
 * The tiles, chart and task list are batch-wide on every response; only the learner
 * rows are paged, searched and filtered.
 */
export function PlanOverviewDialog({
    planId,
    open,
    onOpenChange,
    onOpenTask,
}: {
    planId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Opens a task's tracking view. When absent, the task list is read-only. */
    onOpenTask?: (itemId: string) => void;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;

    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<LearnerFilter>('ALL');
    const [q] = useDebounce(search.trim(), 300);
    const needsAttention = filter === 'NEEDS_ATTENTION';

    // The page belongs to one search + filter: a new search or filter starts from the
    // first page in the same render, so no request goes out for a stale page.
    const listKey = `${q}\u0000${needsAttention}`;
    const [pageState, setPageState] = useState({ key: listKey, page: 0 });
    const page = pageState.key === listKey ? pageState.page : 0;
    const setPage = useCallback(
        (next: number) => setPageState({ key: listKey, page: next }),
        [listKey]
    );

    // Closing forgets the table state, so the next open starts from the top.
    useEffect(() => {
        if (open) return;
        setPageState({ key: '', page: 0 });
        setSearch('');
        setFilter('ALL');
    }, [open]);

    const query = useQuery({
        queryKey: [
            'engagement-plan-overview',
            planId,
            { page, size: LEARNER_PAGE_SIZE, q, needsAttention },
        ],
        queryFn: () =>
            getPlanOverview(planId, {
                page,
                size: LEARNER_PAGE_SIZE,
                q: q || undefined,
                needsAttention,
            }) as Promise<PlanOverviewResponse>,
        enabled: open && Boolean(planId),
        placeholderData: keepPreviousData,
    });
    const { data, isLoading, isError, isFetching, refetch } = query;

    const exportCsv = useMutation({
        mutationFn: () => exportPlanOverview(planId, data?.title || planId),
        onError: () => toast.error(t('tracking.exportError')),
    });

    const table = useMemo(() => {
        if (!data) return null;
        if (data.totalRows != null) {
            return {
                rows: data.rows,
                totalRows: data.totalRows,
                totalPages: data.totalPages ?? 0,
            };
        }
        return pageRowsLocally(data.rows, {
            page,
            size: LEARNER_PAGE_SIZE,
            q,
            needsAttention,
        });
    }, [data, page, q, needsAttention]);

    const tiles = data ? overviewTileCounts(data) : null;
    // Before any task opens, every learner is "not started" by definition; say so
    // instead of painting the tiles amber.
    const begun = data
        ? data.tasksOpened != null
            ? data.tasksOpened > 0
            : data.tasksClosed > 0 || Boolean(data.days?.length)
        : false;

    // A page past the end (rows vanished after a refetch) snaps back to the last page.
    useEffect(() => {
        if (table && table.totalPages > 0 && page > table.totalPages - 1) {
            setPage(table.totalPages - 1);
        }
    }, [table, page, setPage]);

    return (
        <MyDialog
            heading={data?.title || t('overview.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-5xl"
        >
            {isLoading && <OverviewSkeleton />}

            {/* A failed background refetch keeps the numbers that did load. */}
            {isError && !data && (
                <Alert className="border-danger-200 bg-danger-50">
                    <WarningCircle size={18} className="text-danger-600" />
                    <AlertDescription className="space-y-3 text-danger-700">
                        <p>{t('overview.loadError')}</p>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disable={isFetching}
                            onClick={() => void refetch()}
                        >
                            {t('overview.retry')}
                        </MyButton>
                    </AlertDescription>
                </Alert>
            )}

            {data && tiles && table && (
                <div className="space-y-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 space-y-0.5">
                            <p className="text-caption font-medium uppercase tracking-wide text-neutral-500">
                                {t('overview.title')}
                            </p>
                            <p className="text-body text-neutral-700">
                                {t('overview.summary.learners', {
                                    count: data.learners,
                                    formatted: formatNumber(data.learners, lang),
                                })}
                                {' · '}
                                {t('overview.summary.tasksOpened', {
                                    opened: formatNumber(
                                        data.tasksOpened ?? data.tasksClosed,
                                        lang
                                    ),
                                    total: formatNumber(data.tasksTotal, lang),
                                })}
                                {data.tasksCapHidden ? (
                                    <span className="text-neutral-500">
                                        {' · '}
                                        {t('overview.summary.capHidden', {
                                            count: data.tasksCapHidden,
                                            formatted: formatNumber(data.tasksCapHidden, lang),
                                        })}
                                    </span>
                                ) : null}
                            </p>
                        </div>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            disable={exportCsv.isPending || data.learners === 0}
                            onClick={() => exportCsv.mutate()}
                            className="shrink-0"
                        >
                            <DownloadSimple size={16} aria-hidden />
                            {exportCsv.isPending ? t('tracking.preparing') : t('tracking.export')}
                        </MyButton>
                    </div>

                    {!begun && data.learners > 0 && (
                        <p className="flex items-start gap-2 rounded-lg border border-info-200 bg-info-50 px-3 py-2 text-body text-info-700">
                            <Info size={16} className="mt-0.5 shrink-0 text-info-600" aria-hidden />
                            {t('overview.notBegun')}
                        </p>
                    )}

                    <OverviewTiles counts={tiles} begun={begun} />

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                        <div className="min-w-0 lg:col-span-3">
                            <CompletionByDayChart days={data.days} today={data.today} />
                        </div>
                        <div className="min-w-0 lg:col-span-2">
                            <LeastCompletedTasks
                                tasks={data.tasks}
                                learners={data.learners}
                                onOpenTask={onOpenTask}
                            />
                        </div>
                    </div>

                    <LearnerTable
                        rows={table.rows}
                        isLoading={false}
                        isFetching={isFetching}
                        isError={isError}
                        onRetry={() => void refetch()}
                        page={page}
                        totalPages={table.totalPages}
                        totalRows={table.totalRows}
                        pageSize={LEARNER_PAGE_SIZE}
                        onPageChange={setPage}
                        search={search}
                        onSearchChange={setSearch}
                        filter={filter}
                        onFilterChange={setFilter}
                        counts={{
                            all: data.learners,
                            needsAttention: tiles.notStarted + tiles.behind,
                        }}
                        enrolled={data.learners}
                    />
                </div>
            )}
        </MyDialog>
    );
}

function OverviewSkeleton() {
    return (
        <div className="space-y-5" aria-busy="true">
            <Skeleton className="h-10 w-2/3 rounded-md" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                <Skeleton className="h-64 w-full rounded-lg lg:col-span-3" />
                <Skeleton className="h-64 w-full rounded-lg lg:col-span-2" />
            </div>
            <Skeleton className="h-48 w-full rounded-lg" />
        </div>
    );
}

function LeastCompletedTasks({
    tasks,
    learners,
    onOpenTask,
}: {
    tasks: OverviewTaskProgress[] | null | undefined;
    learners: number;
    onOpenTask?: (itemId: string) => void;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const { shown, opened } = leastCompletedTasks(tasks);

    return (
        <section
            className="flex h-full min-w-0 flex-col rounded-lg border border-neutral-200 bg-white p-4"
            aria-labelledby="overview-tasks-heading"
        >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3
                    id="overview-tasks-heading"
                    className="text-subtitle font-semibold text-neutral-900"
                >
                    {t('overview.tasks.title')}
                </h3>
                {opened > shown.length && (
                    <span className="text-caption text-neutral-500">
                        {t('overview.tasks.showing', {
                            shown: formatNumber(shown.length, lang),
                            count: opened,
                            formatted: formatNumber(opened, lang),
                        })}
                    </span>
                )}
            </div>
            <p className="mt-0.5 text-caption text-neutral-500">{t('overview.tasks.subtitle')}</p>

            {tasks == null ? (
                <p className="mt-4 text-body text-neutral-500">{t('overview.tasks.unavailable')}</p>
            ) : shown.length === 0 ? (
                <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-neutral-200 px-4 py-8 text-center">
                    <ListChecks size={24} className="text-neutral-400" aria-hidden />
                    <p className="text-body text-neutral-500">{t('overview.tasks.empty')}</p>
                </div>
            ) : (
                <ul className="mt-3 divide-y divide-neutral-100">
                    {shown.map((task) => (
                        <li key={task.itemId}>
                            <TaskRow task={task} learners={learners} onOpenTask={onOpenTask} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function TaskRow({
    task,
    learners,
    onOpenTask,
}: {
    task: OverviewTaskProgress;
    learners: number;
    onOpenTask?: (itemId: string) => void;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const meta = typeMeta(task.itemType);
    const TypeIcon = meta.icon;
    const rate =
        task.rate != null && Number.isFinite(task.rate)
            ? task.rate
            : learners > 0
              ? task.completed / learners
              : null;
    const percent = rate == null ? 0 : Math.round(Math.min(1, Math.max(0, rate)) * 100);
    const stateLabel =
        task.state === 'OPEN' || task.state === 'CATCH_UP' || task.state === 'CLOSED'
            ? t(`overview.tasks.state.${task.state}`)
            : null;
    const meta2 = [task.runDate ? formatDay(task.runDate, lang) : null, stateLabel]
        .filter(Boolean)
        .join(' · ');

    const body = (
        <div className="flex w-full items-start gap-3 py-2.5">
            <span
                className={cn(
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
                    meta.accent.soft
                )}
                title={t(meta.labelKey)}
            >
                <TypeIcon size={14} weight="bold" aria-hidden />
                <span className="sr-only">{t(meta.labelKey)}</span>
            </span>
            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-body font-medium text-neutral-900">{task.title}</p>
                    <span className="shrink-0 text-caption tabular-nums text-neutral-700">
                        {rate == null ? '–' : formatPercent(rate, lang)}
                    </span>
                </div>
                <Progress
                    value={percent}
                    className="h-1.5 !bg-neutral-100"
                    aria-label={t('overview.tasks.doneAria', {
                        done: formatNumber(task.completed, lang),
                        total: formatNumber(learners, lang),
                    })}
                />
                <p className="flex flex-wrap justify-between gap-x-2 text-caption text-neutral-500">
                    <span className="truncate">{meta2}</span>
                    <span className="tabular-nums">
                        {t('overview.tasks.done', {
                            fraction: formatFraction(task.completed, learners, lang),
                        })}
                        {task.started ? (
                            <>
                                {' · '}
                                {t('overview.tasks.started', {
                                    count: task.started,
                                    formatted: formatNumber(task.started, lang),
                                })}
                            </>
                        ) : null}
                    </span>
                </p>
            </div>
            {onOpenTask && (
                <CaretRight
                    size={14}
                    className="mt-1.5 shrink-0 text-neutral-400 rtl:rotate-180"
                    aria-hidden
                />
            )}
        </div>
    );

    if (!onOpenTask) return body;
    return (
        <button
            type="button"
            onClick={() => onOpenTask(task.itemId)}
            className="w-full rounded-md px-1 text-start transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
            {body}
        </button>
    );
}
