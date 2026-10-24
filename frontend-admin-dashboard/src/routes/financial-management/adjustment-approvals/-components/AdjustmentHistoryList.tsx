import { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { CaretLeft, CaretRight, MagnifyingGlass, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    fetchInstituteAdjustmentHistory,
    getInstituteAdjustmentHistoryQueryKey,
} from '@/services/manage-finances';
import {
    EnrichedAdjustmentHistoryDTO,
    InstituteAdjustmentHistoryFilter,
} from '@/types/manage-finances';
import { cn } from '@/lib/utils';

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

const EVENT_STYLES: Record<string, { bg: string; text: string }> = {
    SUBMITTED: { bg: 'bg-blue-100', text: 'text-blue-700' },
    APPROVED: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
    REJECTED: { bg: 'bg-red-100', text: 'text-red-700' },
    RETRACTED: { bg: 'bg-gray-200', text: 'text-gray-700' },
};

const PAGE_SIZE = 20;

type AdjustmentTypeFilter = 'ALL' | 'CONCESSION' | 'PENALTY';

interface AdjustmentHistoryListProps {
    /**
     * Pre-applied event type filter. Tabs pass e.g. ['APPROVED'] to scope the list
     * to that status. 'All History' tab passes undefined for unfiltered.
     */
    eventTypes?: ('SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETRACTED')[];
    /**
     * Pre-applied resulting_status filter. The Pending-history view would pass
     * ['PENDING_FOR_APPROVAL'] for example. Optional.
     */
    resultingStatuses?: ('PENDING_FOR_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RETRACTED')[];
}

export function AdjustmentHistoryList({
    eventTypes,
    resultingStatuses,
}: AdjustmentHistoryListProps) {
    const { t } = useTranslation('financialManagementAdjustmentHistoryList');
    const [page, setPage] = useState(0);

    const [studentSearchInput, setStudentSearchInput] = useState('');
    const [studentSearch, setStudentSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => {
        debounceRef.current = setTimeout(() => {
            setStudentSearch(studentSearchInput.trim());
            setPage(0);
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [studentSearchInput]);

    const [adjustmentTypeFilter, setAdjustmentTypeFilter] =
        useState<AdjustmentTypeFilter>('ALL');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Reset to first page whenever an on-screen filter changes
    useEffect(() => {
        setPage(0);
    }, [adjustmentTypeFilter, startDate, endDate, eventTypes, resultingStatuses]);

    const filter = useMemo<InstituteAdjustmentHistoryFilter>(
        () => ({
            page,
            size: PAGE_SIZE,
            event_types: eventTypes,
            resulting_statuses: resultingStatuses,
            adjustment_types:
                adjustmentTypeFilter === 'ALL' ? undefined : [adjustmentTypeFilter],
            start_date: startDate || undefined,
            end_date: endDate || undefined,
            student_search: studentSearch || undefined,
        }),
        [
            page,
            eventTypes,
            resultingStatuses,
            adjustmentTypeFilter,
            startDate,
            endDate,
            studentSearch,
        ]
    );

    const { data, isLoading, isFetching, error } = useQuery({
        queryKey: getInstituteAdjustmentHistoryQueryKey(filter),
        queryFn: () => fetchInstituteAdjustmentHistory(filter),
        placeholderData: keepPreviousData,
        staleTime: 15000,
    });

    const totalPages = data?.total_pages ?? data?.totalPages ?? 0;
    const totalElements = data?.total_elements ?? data?.totalElements ?? 0;
    const hasActiveFilters =
        adjustmentTypeFilter !== 'ALL' || startDate || endDate || studentSearch;

    const clearFilters = () => {
        setAdjustmentTypeFilter('ALL');
        setStartDate('');
        setEndDate('');
        setStudentSearchInput('');
        setStudentSearch('');
    };

    return (
        <div className="space-y-4">
            {/* Filter bar */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative min-w-[220px]">
                        <MagnifyingGlass
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                        <input
                            type="text"
                            placeholder={t('searchPlaceholder')}
                            value={studentSearchInput}
                            onChange={(e) => setStudentSearchInput(e.target.value)}
                            className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div className="flex items-center gap-1">
                        {(['ALL', 'CONCESSION', 'PENALTY'] as AdjustmentTypeFilter[]).map((typeOption) => (
                            <button
                                key={typeOption}
                                type="button"
                                onClick={() => setAdjustmentTypeFilter(typeOption)}
                                className={cn(
                                    'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                                    adjustmentTypeFilter === typeOption
                                        ? typeOption === 'CONCESSION'
                                            ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                            : typeOption === 'PENALTY'
                                              ? 'bg-red-100 text-red-700 border-red-300'
                                              : 'bg-blue-100 text-blue-700 border-blue-300'
                                        : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                )}
                            >
                                {typeOption === 'ALL'
                                    ? t('filters.allTypes')
                                    : typeOption === 'CONCESSION'
                                      ? t('adjustmentType.concession')
                                      : t('adjustmentType.penalty')}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-gray-500">{t('filters.from')}</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <label className="text-xs font-medium text-gray-500">{t('filters.to')}</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>

                    {hasActiveFilters && (
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-600 transition-colors"
                        >
                            <X size={14} />
                            {t('clear')}
                        </button>
                    )}
                </div>
            </div>

            {/* List */}
            {isLoading && !data && (
                <div className="flex h-48 items-center justify-center">
                    <DashboardLoader />
                </div>
            )}

            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
                    <p className="font-semibold text-red-800">{t('errors.unableToLoad')}</p>
                    <p className="mt-2 text-sm text-red-600">
                        {error instanceof Error ? error.message : t('errors.tryAgain')}
                    </p>
                </div>
            )}

            {data && data.content.length === 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
                    <p className="text-lg font-semibold text-gray-600">{t('empty.noActivity')}</p>
                    <p className="mt-2 text-sm text-gray-400">
                        {hasActiveFilters
                            ? t('empty.tryClearingFilters')
                            : t('empty.noActivityYet')}
                    </p>
                </div>
            )}

            {data && data.content.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="overflow-auto">
                        <table className="w-full text-left border-collapse min-w-[900px]">
                            <thead>
                                <tr className="border-b-2 border-gray-200 bg-gray-50/95">
                                    <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                        {t('table.date')}
                                    </th>
                                    <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                        {t('table.student')}
                                    </th>
                                    <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                        {t('table.feeType')}
                                    </th>
                                    <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                        {t('table.type')}
                                    </th>
                                    <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                        {t('table.amount')}
                                    </th>
                                    <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                        {t('table.event')}
                                    </th>
                                    <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                        {t('table.by')}
                                    </th>
                                    <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                        {t('table.reason')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 text-sm">
                                {data.content.map((evt: EnrichedAdjustmentHistoryDTO) => {
                                    const isPenalty = evt.adjustment_type === 'PENALTY';
                                    const eventStyle =
                                        EVENT_STYLES[evt.event_type] ?? EVENT_STYLES.SUBMITTED!;
                                    return (
                                        <tr
                                            key={evt.id}
                                            className="hover:bg-gray-50/40 transition-colors"
                                        >
                                            <td className="py-3 px-4 text-gray-700 whitespace-nowrap">
                                                {dayjs(evt.created_at).format('D MMM YYYY, HH:mm')}
                                            </td>
                                            <td className="py-3 px-4 text-gray-800 font-semibold">
                                                <div>{evt.student_name || evt.student_user_id || '\u2014'}</div>
                                                {evt.student_phone && (
                                                    <div className="text-[11px] text-gray-400 font-normal">
                                                        {evt.student_phone}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-3 px-4 text-gray-600">
                                                {evt.fee_type_name || '\u2014'}
                                                {evt.cpo_name && (
                                                    <div className="text-[11px] text-gray-400">
                                                        {evt.cpo_name}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-3 px-4">
                                                <span
                                                    className={cn(
                                                        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                                                        isPenalty
                                                            ? 'bg-red-100 text-red-700'
                                                            : 'bg-emerald-100 text-emerald-700'
                                                    )}
                                                >
                                                    {isPenalty ? t('adjustmentType.penalty') : t('adjustmentType.concession')}
                                                </span>
                                            </td>
                                            <td
                                                className={cn(
                                                    'py-3 px-4 font-semibold',
                                                    isPenalty ? 'text-red-700' : 'text-emerald-700'
                                                )}
                                            >
                                                {isPenalty ? '+' : '-'}
                                                {formatCurrency(evt.amount)}
                                            </td>
                                            <td className="py-3 px-4">
                                                <span
                                                    className={cn(
                                                        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                                                        eventStyle.bg,
                                                        eventStyle.text
                                                    )}
                                                >
                                                    {evt.event_type}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-gray-700">
                                                {evt.actor_name || evt.actor_user_id}
                                            </td>
                                            <td
                                                className="py-3 px-4 text-gray-500 max-w-[260px] truncate"
                                                title={evt.reason ?? ''}
                                            >
                                                {evt.reason || '\u2014'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
                            <div className="text-xs text-gray-500">
                                {t('pagination.pageOf', { page: page + 1, totalPages })}
                                {' \u00b7 '}
                                <span className="font-semibold text-gray-700">
                                    {totalElements}
                                </span>{' '}
                                {t('pagination.total')}
                                {isFetching && data ? ` \u00b7 ${t('pagination.updating')}` : ''}
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                    className="rounded border border-gray-200 p-1.5 disabled:opacity-40 hover:bg-gray-50"
                                >
                                    <CaretLeft size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPage((p) => p + 1)}
                                    disabled={!!data?.last}
                                    className="rounded border border-gray-200 p-1.5 disabled:opacity-40 hover:bg-gray-50"
                                >
                                    <CaretRight size={14} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
