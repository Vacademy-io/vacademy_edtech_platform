import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ListBullets, MagnifyingGlass } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { MyTable, type TableData } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { MyInput } from '@/components/design-system/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import {
    EMPTY_VALUE,
    formatCount,
    formatRate,
    rateTone,
} from '@/routes/study-library/live-session/-utils/dashboard-format';
import type { AssessmentDashboardRow, AssessmentStatus } from '../-services/assessment-dashboard';
import { playModeKey } from '../-utils/assessment-dashboard-utils';
import { METER_TONE, TONE_TEXT } from './dashboard-highlights';

const PAGE_SIZE = 10;

export const STATUS_STYLE: Record<AssessmentStatus, { pill: string; dot: string }> = {
    LIVE: { pill: 'bg-danger-50 text-danger-600', dot: 'bg-danger-500 animate-pulse' },
    UPCOMING: { pill: 'bg-info-50 text-info-700', dot: 'bg-info-500' },
    CLOSED: { pill: 'bg-success-50 text-success-700', dot: 'bg-success-500' },
    OPEN: { pill: 'bg-primary-50 text-primary-600', dot: 'bg-primary-500' },
};

/** Client-side page of an already-loaded list, in MyTable's shape. */
const pageOf = <T,>(rows: T[], requestedPage: number): TableData<T> => {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    // A refetch can shrink the list under the current page; clamp instead of
    // rendering an empty page with a pager.
    const page = Math.min(Math.max(0, requestedPage), totalPages - 1);
    return {
        content: rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
        total_pages: totalPages,
        page_no: page,
        page_size: PAGE_SIZE,
        total_elements: rows.length,
        last: page >= totalPages - 1,
    };
};

const formatWhen = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
};

type StatusFilter = 'ALL' | AssessmentStatus;
const STATUS_FILTERS: StatusFilter[] = ['ALL', 'CLOSED', 'LIVE', 'UPCOMING', 'OPEN'];

export function AssessmentsTable({
    rows,
    truncated,
    limit,
    batchLabel,
    subjectLabel,
    checkedBy,
    onOpen,
}: {
    rows: AssessmentDashboardRow[];
    truncated: boolean;
    limit: number;
    batchLabel: (id: string) => string;
    subjectLabel: (id: string | null) => string | null;
    /** Teachers who checked the test's copies. */
    checkedBy: (row: AssessmentDashboardRow) => string[];
    onOpen: (row: AssessmentDashboardRow) => void;
}) {
    const { t } = useTranslation('assessmentDashboard');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<StatusFilter>('ALL');
    const [page, setPage] = useState(0);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter((row) => {
            if (status !== 'ALL' && row.status !== status) return false;
            if (!q) return true;
            return [row.name, subjectLabel(row.subject_id), ...row.batch_ids.map(batchLabel)]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(q));
        });
    }, [rows, search, status, batchLabel, subjectLabel]);

    const data = useMemo(() => pageOf(filtered, page), [filtered, page]);

    const columns = useMemo<ColumnDef<AssessmentDashboardRow>[]>(
        () => [
            {
                id: 'when',
                size: 120,
                header: t('table.when'),
                cell: ({ row }) => {
                    const start = formatWhen(row.original.start_time);
                    if (row.original.status === 'OPEN' || !start) {
                        return (
                            <span className="whitespace-nowrap font-semibold text-neutral-800">
                                {t('table.anytime')}
                            </span>
                        );
                    }
                    const end = formatWhen(row.original.end_time);
                    return (
                        <div className="flex flex-col">
                            <span className="whitespace-nowrap font-semibold text-neutral-800">
                                {format(start, 'dd MMM yyyy')}
                            </span>
                            <span className="whitespace-nowrap text-caption text-neutral-500">
                                {format(start, 'h:mm a')}
                                {end ? ` – ${format(end, 'h:mm a')}` : ''}
                            </span>
                        </div>
                    );
                },
            },
            {
                id: 'test',
                size: 180,
                header: t('table.test'),
                cell: ({ row }) => (
                    <div className="flex min-w-0 flex-col">
                        <span
                            className="truncate font-semibold text-neutral-900"
                            title={row.original.name}
                        >
                            {row.original.name || t('table.untitled')}
                        </span>
                        <span
                            className="truncate text-caption text-neutral-500"
                            title={row.original.batch_ids.map(batchLabel).join('\n')}
                        >
                            {[
                                t(`playModes.${playModeKey(row.original.play_mode)}`),
                                subjectLabel(row.original.subject_id),
                                row.original.batch_ids.map(batchLabel).join(', '),
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                    </div>
                ),
            },
            {
                id: 'status',
                size: 100,
                header: t('table.status'),
                cell: ({ row }) => {
                    const style = STATUS_STYLE[row.original.status];
                    return (
                        <span
                            className={cn(
                                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-caption font-semibold',
                                style.pill
                            )}
                        >
                            <span className={cn('size-1.5 rounded-full', style.dot)} aria-hidden />
                            {t(`status.${row.original.status}`)}
                        </span>
                    );
                },
            },
            {
                id: 'participation',
                size: 140,
                header: t('table.participation'),
                cell: ({ row }) => {
                    const r = row.original;
                    if (r.status === 'UPCOMING' || r.participation_rate === null) {
                        return (
                            <span className="text-neutral-400">
                                {r.status === 'UPCOMING' ? EMPTY_VALUE : formatCount(r.attempted)}
                            </span>
                        );
                    }
                    const tone = r.status === 'CLOSED' ? rateTone(r.participation_rate) : 'neutral';
                    return (
                        <div className="flex flex-col gap-1">
                            <div className="flex items-baseline justify-between gap-2 tabular-nums">
                                <span className="font-semibold text-neutral-800">
                                    {formatRate(r.participation_rate)}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {`${formatCount(r.attempted)}/${formatCount(r.expected)}`}
                                </span>
                            </div>
                            <Progress
                                value={Math.min(100, r.participation_rate * 100)}
                                className={cn('h-1.5 !bg-neutral-100', METER_TONE[tone])}
                                aria-hidden
                            />
                        </div>
                    );
                },
            },
            {
                id: 'score',
                size: 120,
                header: t('table.avgScore'),
                cell: ({ row }) => {
                    const r = row.original;
                    if (r.avg_score === null) {
                        return (
                            <span className="block text-right text-neutral-400">{EMPTY_VALUE}</span>
                        );
                    }
                    return (
                        <span className="flex flex-col items-end tabular-nums">
                            <span className={cn('font-semibold', TONE_TEXT[rateTone(r.avg_score)])}>
                                {formatRate(r.avg_score)}
                            </span>
                            <span className="whitespace-nowrap text-caption text-neutral-400">
                                {t('table.range', {
                                    low: formatRate(r.lowest_score),
                                    high: formatRate(r.highest_score),
                                })}
                            </span>
                        </span>
                    );
                },
            },
            {
                id: 'submissions',
                size: 85,
                header: t('table.submissions'),
                cell: ({ row }) => (
                    <span className="block text-right tabular-nums text-neutral-700">
                        {formatCount(row.original.submissions)}
                        {row.original.in_progress > 0 ? (
                            <span className="block text-caption text-warning-700">
                                {t('table.writing', { n: row.original.in_progress })}
                            </span>
                        ) : null}
                    </span>
                ),
            },
            {
                id: 'evaluation',
                size: 140,
                header: t('table.evaluation'),
                cell: ({ row }) => {
                    const r = row.original;
                    if (r.submissions === 0) {
                        return (
                            <span className="block text-right text-neutral-400">{EMPTY_VALUE}</span>
                        );
                    }
                    const names = checkedBy(r);
                    const done = r.awaiting_evaluation === 0 && r.awaiting_release === 0;
                    return (
                        <span className="flex flex-col items-end text-caption font-semibold">
                            {done && <span className="text-success-700">{t('table.allDone')}</span>}
                            {r.awaiting_evaluation > 0 && (
                                <span className="whitespace-nowrap text-warning-700">
                                    {t('queue.toEvaluate', {
                                        n: formatCount(r.awaiting_evaluation),
                                    })}
                                </span>
                            )}
                            {r.awaiting_release > 0 && (
                                <span className="whitespace-nowrap text-info-700">
                                    {t('queue.toRelease', { n: formatCount(r.awaiting_release) })}
                                </span>
                            )}
                            {names.length > 0 && (
                                <span
                                    className="max-w-full truncate font-regular text-neutral-500"
                                    title={names.join(', ')}
                                >
                                    {t('queue.by', { names: names.join(', ') })}
                                </span>
                            )}
                        </span>
                    );
                },
            },
        ],
        [t, batchLabel, subjectLabel, checkedBy]
    );

    return (
        <SectionCard
            icon={ListBullets}
            title={t('table.title')}
            subtitle={
                truncated
                    ? t('table.truncated', { limit })
                    : t('table.subtitle', { n: formatCount(filtered.length) })
            }
            right={
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Tabs
                        value={status}
                        onValueChange={(v) => {
                            setStatus(v as StatusFilter);
                            setPage(0);
                        }}
                    >
                        <TabsList className="h-auto flex-wrap">
                            {STATUS_FILTERS.map((s) => (
                                <TabsTrigger key={s} value={s} className="text-caption">
                                    {t(`status.${s}`)}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                    <div className="relative w-full sm:w-64">
                        <MagnifyingGlass
                            size={16}
                            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                        />
                        <MyInput
                            input={search}
                            inputPlaceholder={t('table.search')}
                            onChangeFunction={(e) => {
                                setSearch(e.target.value);
                                setPage(0);
                            }}
                            size="medium"
                            className="w-full pl-9"
                        />
                    </div>
                </div>
            }
        >
            {filtered.length === 0 ? (
                <EmptyChart className="h-32" text={t('empty.noMatch')} />
            ) : (
                <>
                    <MyTable<AssessmentDashboardRow>
                        data={data}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        currentPage={data.page_no}
                        scrollable
                        enableColumnResizing={false}
                        onCellClick={(row) => onOpen(row)}
                    />
                    {data.total_pages > 1 && (
                        <div className="mt-4 flex justify-center">
                            <MyPagination
                                currentPage={data.page_no}
                                totalPages={data.total_pages}
                                onPageChange={setPage}
                            />
                        </div>
                    )}
                </>
            )}
        </SectionCard>
    );
}
