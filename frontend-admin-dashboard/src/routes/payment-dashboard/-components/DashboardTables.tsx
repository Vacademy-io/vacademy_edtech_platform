import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DownloadSimple, MagnifyingGlass } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { cn } from '@/lib/utils';
import type { DashboardBatchRow } from '@/services/payment-dashboard';
import {
    batchLabel,
    formatCompact,
    formatFull,
    toCourseRows,
    type CourseRow,
} from '../-utils/dashboardMath';
import { SegmentBar } from './DashboardParts';

const money = (v: number, currency: string | null, tone?: string) => (
    <span className={cn('tabular-nums', v > 0 ? tone : 'text-neutral-400')}>
        {formatFull(v, currency)}
    </span>
);

const asTableData = <T,>(rows: T[], page: number, pageSize: number) => ({
    content: rows.slice(page * pageSize, (page + 1) * pageSize),
    total_pages: Math.max(1, Math.ceil(rows.length / pageSize)),
    page_no: page,
    page_size: pageSize,
    total_elements: rows.length,
    last: (page + 1) * pageSize >= rows.length,
});

/**
 * Courses ranked by money collected in the period. Each row shows the course's whole fee
 * position as one bar — collected so far, overdue, still to come — so a course that sells well
 * but collects badly stands out. Clicking a course narrows the whole page to it.
 */
export function CourseLeaderboard({
    batches,
    currency,
    courseTerm,
    onSelectCourse,
}: {
    batches: DashboardBatchRow[];
    currency: string | null;
    courseTerm: string;
    onSelectCourse?: (course: CourseRow) => void;
}) {
    const rows = useMemo(() => toCourseRows(batches), [batches]);
    const [showAll, setShowAll] = useState(false);
    const periodTotal = rows.reduce((s, r) => s + r.collected, 0);
    const shown = showAll ? rows : rows.slice(0, LEADERBOARD_SIZE);

    if (rows.length === 0) {
        return (
            <p className="py-8 text-center text-caption text-neutral-500">
                No payments or balances to show.
            </p>
        );
    }
    return (
        <div>
            <ul className="divide-y divide-neutral-100">
                {shown.map((r, i) => {
                    const unlinked = r.key === '__none__';
                    const share =
                        periodTotal > 0 ? Math.round((r.collected / periodTotal) * 100) : 0;
                    const clickable = !unlinked && !!onSelectCourse;
                    return (
                        <li key={r.key}>
                            <button
                                type="button"
                                disabled={!clickable}
                                onClick={() => clickable && onSelectCourse?.(r)}
                                className={cn(
                                    'flex w-full items-center gap-4 rounded-lg px-2 py-3 text-left transition-colors',
                                    clickable ? 'hover:bg-neutral-50' : 'cursor-default'
                                )}
                            >
                                <span
                                    className={cn(
                                        'flex size-8 shrink-0 items-center justify-center rounded-full text-caption font-bold',
                                        i === 0 && !unlinked
                                            ? 'bg-primary-500 text-white'
                                            : 'bg-neutral-100 text-neutral-600'
                                    )}
                                >
                                    {unlinked ? '–' : i + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span
                                            className={cn(
                                                'truncate text-body font-semibold',
                                                unlinked ? 'text-neutral-500' : 'text-neutral-800'
                                            )}
                                            title={r.name}
                                        >
                                            {r.name}
                                        </span>
                                        <span className="shrink-0 tabular-nums">
                                            <span className="text-body font-bold text-neutral-900">
                                                {formatFull(r.collected, currency)}
                                            </span>
                                            {periodTotal > 0 && (
                                                <span className="ml-1.5 text-caption text-neutral-400">
                                                    {share}%
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                    <SegmentBar
                                        className="mt-2 h-2"
                                        segments={[
                                            {
                                                key: 'collected',
                                                value: r.collectedAllTime,
                                                className: 'bg-primary-500',
                                            },
                                            {
                                                key: 'overdue',
                                                value: r.overdue,
                                                className: 'bg-danger-400',
                                            },
                                            {
                                                key: 'to_come',
                                                value: r.stillToCome,
                                                className: 'bg-success-400',
                                            },
                                        ]}
                                    />
                                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-caption text-neutral-500">
                                        <span>
                                            {formatCompact(r.collectedAllTime, currency)} collected
                                            in all
                                        </span>
                                        <span className={r.overdue > 0 ? 'text-danger-600' : ''}>
                                            {formatCompact(r.overdue, currency)} overdue
                                        </span>
                                        <span
                                            className={r.stillToCome > 0 ? 'text-success-700' : ''}
                                        >
                                            {formatCompact(r.stillToCome, currency)} still to come
                                        </span>
                                    </div>
                                </div>
                            </button>
                        </li>
                    );
                })}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3">
                <div className="flex flex-wrap items-center gap-4 text-caption text-neutral-500">
                    <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-sm bg-primary-500" /> Collected
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-sm bg-danger-400" /> Overdue
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-sm bg-success-400" /> Still to come
                    </span>
                </div>
                {rows.length > LEADERBOARD_SIZE && (
                    <MyButton buttonType="text" scale="small" onClick={() => setShowAll((v) => !v)}>
                        {showAll
                            ? 'Show fewer'
                            : `Show all ${rows.length} ${courseTerm.toLowerCase()}s`}
                    </MyButton>
                )}
            </div>
        </div>
    );
}

const LEADERBOARD_SIZE = 6;

const csvCell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every batch with a balance or a payment, sorted by the money still to collect. */
export function BatchesTable({
    batches,
    currency,
    courseTerm,
    batchTerm,
}: {
    batches: DashboardBatchRow[];
    currency: string | null;
    courseTerm: string;
    batchTerm: string;
}) {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    // New data (another period or filter) starts from the first page, or a short list could
    // leave the table on a page that no longer exists.
    useEffect(() => setPage(0), [batches]);
    const pageSize = 10;

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return batches
            .filter((b) => {
                if (!q) return true;
                return `${b.package_name ?? ''} ${batchLabel(b)}`.toLowerCase().includes(q);
            })
            .sort((a, b) => {
                if (!a.package_session_id) return 1;
                if (!b.package_session_id) return -1;
                return (
                    b.overdue + b.still_to_come - (a.overdue + a.still_to_come) ||
                    b.collected - a.collected
                );
            });
    }, [batches, search]);

    const columns = useMemo<ColumnDef<DashboardBatchRow>[]>(
        () => [
            {
                id: 'batch',
                header: batchTerm,
                size: 320,
                cell: ({ row }) => {
                    const label = batchLabel(row.original);
                    const course = row.original.package_name;
                    return (
                        <div className="min-w-0">
                            <div className="truncate font-medium text-neutral-800" title={label}>
                                {label}
                            </div>
                            {/* The course line only when the label isn't already the course. */}
                            {course && course !== label && (
                                <div className="truncate text-caption text-neutral-500">
                                    {course}
                                </div>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'collected',
                header: 'Collected',
                size: 160,
                cell: ({ row }) =>
                    money(row.original.collected, currency, 'font-semibold text-neutral-800'),
            },
            {
                id: 'overdue',
                header: 'Overdue',
                size: 150,
                cell: ({ row }) =>
                    money(row.original.overdue, currency, 'font-medium text-danger-600'),
            },
            {
                id: 'still_to_come',
                header: 'Still to come',
                size: 150,
                cell: ({ row }) => money(row.original.still_to_come, currency, 'text-success-700'),
            },
            {
                id: 'learners',
                header: 'Learners owing',
                size: 130,
                cell: ({ row }) => <span className="tabular-nums">{row.original.learners}</span>,
            },
        ],
        [batchTerm, currency]
    );

    const downloadCsv = () => {
        if (rows.length === 0) {
            toast.info('Nothing to export.');
            return;
        }
        const header = [
            courseTerm,
            batchTerm,
            'Collected',
            'Collected (all time)',
            'Overdue',
            'Still to come',
            'Learners owing',
        ];
        const lines = rows.map((b) =>
            [
                b.package_name ?? '',
                batchLabel(b),
                b.collected.toFixed(2),
                b.collected_all_time.toFixed(2),
                b.overdue.toFixed(2),
                b.still_to_come.toFixed(2),
                b.learners,
            ]
                .map(csvCell)
                .join(',')
        );
        const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n')], {
            type: 'text/csv;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `batch-balances-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                    <MagnifyingGlass
                        size={16}
                        className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                    />
                    <MyInput
                        inputType="text"
                        input={search}
                        onChangeFunction={(e) => {
                            setSearch(e.target.value);
                            setPage(0);
                        }}
                        inputPlaceholder={`Search ${batchTerm.toLowerCase()} or ${courseTerm.toLowerCase()}`}
                        className="w-full pl-9"
                        size="medium"
                    />
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    className="gap-2"
                    onClick={downloadCsv}
                >
                    <DownloadSimple size={16} />
                    CSV
                </MyButton>
            </div>
            {rows.length === 0 ? (
                <p className="py-8 text-center text-caption text-neutral-500">
                    {search ? 'No batch matches your search.' : 'No payments or balances to show.'}
                </p>
            ) : (
                <>
                    <MyTable<DashboardBatchRow>
                        data={asTableData(rows, page, pageSize)}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        currentPage={page}
                        enableColumnResizing={false}
                        enableColumnPinning={false}
                        scrollable
                    />
                    {rows.length > pageSize && (
                        <MyPagination
                            currentPage={page}
                            totalPages={Math.ceil(rows.length / pageSize)}
                            onPageChange={setPage}
                            totalElements={rows.length}
                            pageSize={pageSize}
                        />
                    )}
                </>
            )}
        </div>
    );
}
