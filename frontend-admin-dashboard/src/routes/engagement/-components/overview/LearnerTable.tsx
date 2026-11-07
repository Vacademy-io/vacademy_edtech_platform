import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { MagnifyingGlass, UsersThree, WarningCircle, X } from '@phosphor-icons/react';
import { MyTable, type TableData } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { MyButton } from '@/components/design-system/button';
import { ChipToggleGroup } from '@/components/design-system/chips';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { LearnerClass, LearnerProgress } from '../../-types/types';
import { formatDateTime, formatFraction, formatNumber, formatRelative } from '../../-utils/format';

/**
 * The plan overview's learner table: server-paged, searchable, most-at-risk first
 * (the server sorts), with an "All / Needs attention" filter.
 *
 * Every control is owned by the caller (the dialog keeps page, search and filter in
 * its query key); this component only renders them and reports changes.
 */

export type LearnerFilter = 'ALL' | 'NEEDS_ATTENTION';

export const LEARNER_PAGE_SIZE = 20;

/**
 * A learner's class. Newer servers send it; for an older one we derive it the way the
 * server does (nothing done = not started; under half of what has opened = behind).
 */
export function learnerClassOf(row: LearnerProgress): LearnerClass {
    if (row.class) return row.class;
    const done = row.done ?? row.completed ?? 0;
    if (done <= 0) return 'NOT_STARTED';
    const available = row.available ?? 0;
    if (available > 0 && done * 2 < available) return 'BEHIND';
    return 'ON_TRACK';
}

const CLASS_STATUS: Record<LearnerClass, StatusType> = {
    NOT_STARTED: 'WARNING',
    BEHIND: 'WARNING',
    ON_TRACK: 'SUCCESS',
};

export interface LearnerTableProps {
    /** The rows of the current page. */
    rows: LearnerProgress[];
    /** First load: shows skeleton rows. */
    isLoading: boolean;
    /** A page, search or filter change is in flight (previous rows stay visible). */
    isFetching?: boolean;
    /** The last page request failed; the previous rows (if any) stay visible. */
    isError?: boolean;
    onRetry?: () => void;
    /** Zero-indexed. */
    page: number;
    totalPages: number;
    totalRows: number;
    pageSize?: number;
    onPageChange: (page: number) => void;
    search: string;
    onSearchChange: (value: string) => void;
    filter: LearnerFilter;
    onFilterChange: (filter: LearnerFilter) => void;
    /** Batch-wide counts for the filter chips. */
    counts: { all: number; needsAttention: number };
    /** Enrolled learners in the batch (0 = nobody to show at all). */
    enrolled: number;
    /** The plan's timezone, for "Last active" hover text. */
    timeZone?: string;
}

export function LearnerTable({
    rows,
    isLoading,
    isFetching = false,
    isError = false,
    onRetry,
    page,
    totalPages,
    totalRows,
    pageSize = LEARNER_PAGE_SIZE,
    onPageChange,
    search,
    onSearchChange,
    filter,
    onFilterChange,
    counts,
    enrolled,
    timeZone,
}: LearnerTableProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;

    const columns = useMemo<ColumnDef<LearnerProgress>[]>(
        () => [
            {
                id: 'learner',
                size: 244,
                header: () => t('overview.learner'),
                cell: ({ row }) => {
                    const r = row.original;
                    return (
                        <div className="min-w-0">
                            <p className="truncate font-medium text-neutral-900">
                                {r.fullName || t('overview.table.unnamed')}
                            </p>
                            {r.username && (
                                <p className="truncate text-caption text-neutral-500">
                                    {r.username}
                                </p>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'status',
                size: 130,
                header: () => t('overview.table.status'),
                cell: ({ row }) => {
                    const cls = learnerClassOf(row.original);
                    return (
                        <StatusChip
                            text={t(`overview.class.${cls}`)}
                            textSize="text-caption"
                            status={CLASS_STATUS[cls]}
                            showIcon={false}
                        />
                    );
                },
            },
            {
                id: 'done',
                size: 150,
                header: () => t('overview.done'),
                cell: ({ row }) => {
                    const r = row.original;
                    const done = r.done ?? r.completed;
                    const available = r.available;
                    if (available == null) {
                        return (
                            <span className="tabular-nums text-neutral-900">
                                {formatNumber(done, lang)}
                            </span>
                        );
                    }
                    const percent =
                        available > 0 ? Math.round(Math.min(1, done / available) * 100) : 0;
                    return (
                        <div className="min-w-0 space-y-1">
                            <span className="block tabular-nums text-neutral-900">
                                {formatFraction(done, available, lang)}
                            </span>
                            <Progress
                                value={percent}
                                className="h-1.5 !bg-neutral-100"
                                aria-label={t('overview.table.doneAria', {
                                    done: formatNumber(done, lang),
                                    available: formatNumber(available, lang),
                                })}
                            />
                        </div>
                    );
                },
            },
            {
                id: 'overdue',
                size: 100,
                header: () => (
                    <span title={t('overview.table.overdueHint')}>
                        {t('overview.table.overdue')}
                    </span>
                ),
                cell: ({ row }) => (
                    <CountCell value={row.original.overdue ?? null} tone="warning" lang={lang} />
                ),
            },
            {
                id: 'missed',
                size: 100,
                header: () => (
                    <span title={t('overview.table.missedHint')}>{t('overview.missed')}</span>
                ),
                cell: ({ row }) => (
                    <CountCell value={row.original.missed} tone="danger" lang={lang} />
                ),
            },
            {
                id: 'points',
                size: 90,
                header: () => t('overview.points'),
                cell: ({ row }) => (
                    <span className="tabular-nums text-neutral-900">
                        {formatNumber(row.original.pointsEarned, lang)}
                    </span>
                ),
            },
            {
                id: 'lastActive',
                size: 150,
                header: () => t('overview.lastActive'),
                cell: ({ row }) => {
                    const at = row.original.lastCompletedAt;
                    if (!at) {
                        return (
                            <span className="text-neutral-400">{t('overview.table.never')}</span>
                        );
                    }
                    return (
                        <span
                            className="whitespace-nowrap text-neutral-600"
                            title={formatDateTime(at, lang, timeZone)}
                        >
                            {formatRelative(at, lang)}
                        </span>
                    );
                },
            },
        ],
        [t, lang, timeZone]
    );

    const tableData: TableData<LearnerProgress> = {
        content: rows,
        total_pages: totalPages,
        page_no: page,
        page_size: pageSize,
        total_elements: totalRows,
        last: page >= totalPages - 1,
    };

    const trimmed = search.trim();
    const showEmpty = !isLoading && rows.length === 0;

    return (
        <section className="space-y-3" aria-labelledby="overview-learners-heading">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                    <h3
                        id="overview-learners-heading"
                        className="text-subtitle font-semibold text-neutral-900"
                    >
                        {t('overview.table.title')}
                    </h3>
                    <ChipToggleGroup<LearnerFilter>
                        value={filter}
                        onChange={onFilterChange}
                        ariaLabel={t('overview.table.filterLabel')}
                        variant="outline"
                        disabled={enrolled === 0}
                        options={[
                            {
                                value: 'ALL',
                                label: t('overview.table.filterAll', {
                                    count: counts.all,
                                    formatted: formatNumber(counts.all, lang),
                                }),
                            },
                            {
                                value: 'NEEDS_ATTENTION',
                                label: t('overview.table.filterNeedsAttention', {
                                    count: counts.needsAttention,
                                    formatted: formatNumber(counts.needsAttention, lang),
                                }),
                            },
                        ]}
                    />
                </div>
                <div className="relative w-full sm:w-64">
                    <MagnifyingGlass
                        size={16}
                        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                        aria-hidden="true"
                    />
                    <Input
                        type="search"
                        value={search}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder={t('overview.table.search')}
                        aria-label={t('overview.table.search')}
                        disabled={enrolled === 0}
                        className="pe-9 ps-9"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => onSearchChange('')}
                            aria-label={t('overview.table.clearSearch')}
                            className="absolute end-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        >
                            <X size={14} aria-hidden="true" />
                        </button>
                    )}
                </div>
            </div>

            {isError && (
                <div
                    role="alert"
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-body text-danger-700"
                >
                    <WarningCircle size={16} className="shrink-0 text-danger-600" aria-hidden />
                    <span className="flex-1">{t('overview.table.pageError')}</span>
                    {onRetry && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disable={isFetching}
                            onClick={onRetry}
                        >
                            {t('overview.retry')}
                        </MyButton>
                    )}
                </div>
            )}

            {showEmpty ? (
                <EmptyRows
                    enrolled={enrolled}
                    search={trimmed}
                    filter={filter}
                    onClearSearch={() => onSearchChange('')}
                    onShowAll={() => onFilterChange('ALL')}
                />
            ) : (
                <div
                    className={cn('transition-opacity', isFetching && !isLoading && 'opacity-60')}
                    aria-busy={isFetching || isLoading}
                >
                    <MyTable<LearnerProgress>
                        data={tableData}
                        columns={columns}
                        isLoading={isLoading}
                        error={null}
                        currentPage={page}
                        enableColumnResizing={false}
                        enableColumnPinning={false}
                    />
                </div>
            )}

            {!showEmpty && totalPages > 1 && (
                <MyPagination
                    currentPage={page}
                    totalPages={totalPages}
                    onPageChange={onPageChange}
                    totalElements={totalRows}
                    pageSize={pageSize}
                />
            )}
        </section>
    );
}

function CountCell({
    value,
    tone,
    lang,
}: {
    value: number | null;
    tone: 'warning' | 'danger';
    lang: string;
}) {
    if (value == null) return <span className="text-neutral-400">–</span>;
    if (value <= 0) {
        return <span className="tabular-nums text-neutral-400">{formatNumber(0, lang)}</span>;
    }
    return (
        <span
            className={cn(
                'inline-flex min-w-6 justify-center rounded-md px-1.5 py-0.5 text-caption font-semibold tabular-nums',
                tone === 'warning'
                    ? 'bg-warning-50 text-warning-700'
                    : 'bg-danger-50 text-danger-700'
            )}
        >
            {formatNumber(value, lang)}
        </span>
    );
}

function EmptyRows({
    enrolled,
    search,
    filter,
    onClearSearch,
    onShowAll,
}: {
    enrolled: number;
    search: string;
    filter: LearnerFilter;
    onClearSearch: () => void;
    onShowAll: () => void;
}) {
    const { t } = useTranslation('engagement');

    let message: string;
    let action: { label: string; onClick: () => void } | null = null;
    if (enrolled === 0) {
        message = t('overview.noLearners');
    } else if (search) {
        message = t('overview.table.noMatch', { q: search });
        action = { label: t('overview.table.clearSearch'), onClick: onClearSearch };
    } else if (filter === 'NEEDS_ATTENTION') {
        message = t('overview.table.allOnTrack');
        action = { label: t('overview.table.showAll'), onClick: onShowAll };
    } else {
        message = t('overview.noLearners');
    }

    return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center">
            <UsersThree size={28} className="text-neutral-400" aria-hidden />
            <p className="text-body text-neutral-600">{message}</p>
            {action && (
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={action.onClick}
                >
                    {action.label}
                </MyButton>
            )}
        </div>
    );
}
