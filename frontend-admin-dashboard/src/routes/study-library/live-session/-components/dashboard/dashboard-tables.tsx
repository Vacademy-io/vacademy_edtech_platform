import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ListBullets, MagnifyingGlass, Star } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyTable, type TableData } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { MyInput } from '@/components/design-system/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type {
    DashboardClassRow,
    DashboardClassStatus,
    DashboardInstructorRef,
} from '../../-services/live-class-dashboard';
import { formatMeetingDate, formatTimeRange } from '../../-utils/live-sesstions';
import {
    EMPTY_VALUE,
    formatCount,
    formatDuration,
    formatRate,
    formatRating,
    platformLabelKey,
    rateTone,
    type RateTone,
} from '../../-utils/dashboard-format';
import { EmptyChart, SectionCard } from './dashboard-charts';
import { Avatar } from './dashboard-highlights';

const PAGE_SIZE = 10;

const METER_TONE: Record<RateTone, string> = {
    success: '[&>div]:bg-success-500',
    warning: '[&>div]:bg-warning-500',
    danger: '[&>div]:bg-danger-500',
    neutral: '[&>div]:bg-neutral-300',
};

const STATUS_STYLE: Record<DashboardClassStatus, { pill: string; dot: string }> = {
    LIVE: { pill: 'bg-danger-50 text-danger-600', dot: 'bg-danger-500 animate-pulse' },
    UPCOMING: { pill: 'bg-info-50 text-info-700', dot: 'bg-info-500' },
    COMPLETED: { pill: 'bg-success-50 text-success-700', dot: 'bg-success-500' },
};

export const instructorLabel = (ref: DashboardInstructorRef): string =>
    ref.name || ref.email || EMPTY_VALUE;

export const instructorNames = (refs: DashboardInstructorRef[] | undefined): string =>
    (refs ?? []).map(instructorLabel).join(', ');

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

type StatusFilter = 'ALL' | DashboardClassStatus;
const STATUS_FILTERS: StatusFilter[] = ['ALL', 'COMPLETED', 'LIVE', 'UPCOMING'];

export function ClassesTable({
    classes,
    truncated,
    limit,
    batchLabel,
    classesTerm,
    batchesTerm,
    teachersTerm,
    onOpen,
}: {
    classes: DashboardClassRow[];
    truncated: boolean;
    limit: number;
    batchLabel: (id: string) => string;
    classesTerm: string;
    batchesTerm: string;
    teachersTerm: string;
    onOpen: (row: DashboardClassRow) => void;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<StatusFilter>('ALL');
    const [page, setPage] = useState(0);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return classes.filter((row) => {
            if (status !== 'ALL' && row.status !== status) return false;
            if (!q) return true;
            return [row.title, row.subject, instructorNames(row.instructors)]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(q));
        });
    }, [classes, search, status]);

    const data = useMemo(() => pageOf(filtered, page), [filtered, page]);

    const columns = useMemo<ColumnDef<DashboardClassRow>[]>(() => {
        const units = { h: t('units.hourShort'), m: t('units.minuteShort') };
        return [
            {
                id: 'when',
                size: 115,
                header: t('table.when'),
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="whitespace-nowrap font-semibold text-neutral-800">
                            {formatMeetingDate(row.original.meeting_date)}
                        </span>
                        <span className="whitespace-nowrap text-caption text-neutral-500">
                            {formatTimeRange(row.original.start_time, row.original.end_time)}
                        </span>
                    </div>
                ),
            },
            {
                id: 'class',
                size: 180,
                header: t('table.class'),
                cell: ({ row }) => (
                    <div className="flex min-w-0 flex-col">
                        <span
                            className="truncate font-semibold text-neutral-900"
                            title={row.original.title ?? ''}
                        >
                            {row.original.title || t('table.untitled')}
                        </span>
                        <span className="truncate text-caption text-neutral-500">
                            {[
                                row.original.subject,
                                t(`platforms.names.${platformLabelKey(row.original.platform)}`),
                                row.original.batch_ids.map(batchLabel).join(', '),
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                    </div>
                ),
            },
            {
                id: 'teacher',
                size: 125,
                header: teachersTerm,
                cell: ({ row }) => {
                    const first = row.original.instructors[0];
                    if (!first) return <span className="text-neutral-400">{EMPTY_VALUE}</span>;
                    const more = row.original.instructors.length - 1;
                    return (
                        <span className="flex min-w-0 items-center gap-2">
                            <Avatar
                                id={first.user_id}
                                name={instructorLabel(first)}
                                className="size-7"
                            />
                            <span
                                className="truncate text-neutral-800"
                                title={instructorNames(row.original.instructors)}
                            >
                                {instructorLabel(first)}
                                {more > 0 && <span className="text-neutral-400"> +{more}</span>}
                            </span>
                        </span>
                    );
                },
            },
            {
                id: 'status',
                size: 110,
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
                id: 'attendance',
                size: 140,
                header: t('table.attendance'),
                cell: ({ row }) => {
                    const r = row.original;
                    if (r.status === 'UPCOMING') {
                        return <span className="text-neutral-400">{EMPTY_VALUE}</span>;
                    }
                    const tone = r.status === 'COMPLETED' ? rateTone(r.attendance_rate) : 'neutral';
                    const share =
                        r.status === 'COMPLETED'
                            ? r.attendance_rate ?? 0
                            : r.expected > 0
                              ? r.joined / r.expected
                              : 0;
                    return (
                        <div className="flex flex-col gap-1">
                            <div className="flex items-baseline justify-between gap-2 tabular-nums">
                                <span className="font-semibold text-neutral-800">
                                    {r.status === 'COMPLETED'
                                        ? formatRate(r.attendance_rate)
                                        : t('status.LIVE')}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {r.expected > 0
                                        ? `${formatCount(r.joined)}/${formatCount(r.expected)}`
                                        : formatCount(r.joined)}
                                </span>
                            </div>
                            <Progress
                                value={Math.min(100, share * 100)}
                                className={cn('h-1.5 !bg-neutral-100', METER_TONE[tone])}
                                aria-hidden
                            />
                        </div>
                    );
                },
            },
            {
                id: 'avgTime',
                size: 95,
                header: t('table.avgTime'),
                cell: ({ row }) => (
                    <span className="block whitespace-nowrap text-right tabular-nums text-neutral-700">
                        {formatDuration(row.original.avg_attended_minutes, units)}
                        {row.original.scheduled_minutes &&
                        row.original.avg_attended_minutes !== null ? (
                            <span className="text-caption text-neutral-400">
                                {' '}
                                / {formatDuration(row.original.scheduled_minutes, units)}
                            </span>
                        ) : null}
                    </span>
                ),
            },
            {
                id: 'engagement',
                size: 90,
                header: t('table.engagement'),
                cell: ({ row }) => (
                    <span className="block text-right tabular-nums text-neutral-700">
                        {formatRate(row.original.engagement_rate)}
                    </span>
                ),
            },
            {
                id: 'feedback',
                size: 70,
                header: t('table.feedback'),
                cell: ({ row }) =>
                    row.original.avg_rating === null ? (
                        <span className="block text-right text-neutral-400">{EMPTY_VALUE}</span>
                    ) : (
                        <span className="flex items-center justify-end gap-1 whitespace-nowrap tabular-nums">
                            <Star size={12} weight="fill" className="text-warning-500" />
                            <span className="font-semibold text-neutral-800">
                                {formatRating(row.original.avg_rating)}
                            </span>
                            <span className="text-caption text-neutral-400">
                                ({row.original.feedback_count})
                            </span>
                        </span>
                    ),
            },
        ];
    }, [t, batchLabel, teachersTerm]);

    return (
        <SectionCard
            icon={ListBullets}
            title={t('table.title', { term: classesTerm })}
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
                            inputPlaceholder={t('table.search', {
                                term: teachersTerm.toLowerCase(),
                            })}
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
                <EmptyChart
                    className="h-32"
                    text={t('empty.noMatch', {
                        term: classesTerm.toLowerCase(),
                        batches: batchesTerm.toLowerCase(),
                    })}
                />
            ) : (
                <>
                    <MyTable<DashboardClassRow>
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
