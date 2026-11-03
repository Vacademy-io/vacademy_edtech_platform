/**
 * Reports Center — Revenue tab.
 *
 * Money received from CONVERTED leads in the range (GET /v1/reports/revenue): one revenue card, a
 * daily revenue trend, and revenue per source / per counsellor. Only cash in is shown here;
 * admissions and their fees live in the Admissions tab, so the two never mix on one screen.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    CurrencyCircleDollar,
    ListBullets,
    Megaphone,
    TrendUp,
    Users,
    X,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    fetchRevenue,
    fetchRevenuePayments,
    revenueQueryKey,
    revenuePaymentsQueryKey,
    type RevenueCounsellorRow,
    type RevenueSourceRow,
} from '../-services/get-revenue-reports';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    KpiCard,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    SortableHeader,
    fmtCurrency,
    fmtNumber,
    type ReportTabProps,
    fmtDay,
} from './report-shared';

type SourceSortKey = 'source_type' | 'revenue' | 'payments';
type CounsellorSortKey = 'name' | 'revenue' | 'payments';

export function RevenueTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerRevenueTab');
    const params = { instituteId, fromDate, toDate, teamId, counsellorUserId };
    const query = useQuery({
        queryKey: revenueQueryKey(params),
        queryFn: () => fetchRevenue(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    const [srcSort, setSrcSort] = useState<SourceSortKey>('revenue');
    const [srcDir, setSrcDir] = useState<'asc' | 'desc'>('desc');
    const [cslSort, setCslSort] = useState<CounsellorSortKey>('revenue');
    const [cslDir, setCslDir] = useState<'asc' | 'desc'>('desc');
    const [selected, setSelected] = useState<SelectedCounsellor | null>(null);
    const paymentsRef = useRef<HTMLDivElement>(null);

    const selectCounsellor = (id: string, name: string) => {
        const selecting = selected?.id !== id;
        setSelected(selecting ? { id, name } : null);
        // The payments open below the table — take the admin straight to them.
        if (selecting)
            requestAnimationFrame(() =>
                paymentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            );
    };

    const currency = query.data?.currency ?? 'INR';

    const sources = useMemo(
        () => sortRows(query.data?.by_source ?? [], srcSort, srcDir),
        [query.data, srcSort, srcDir]
    );
    const counsellors = useMemo(
        () => sortRows(query.data?.by_counsellor ?? [], cslSort, cslDir),
        [query.data, cslSort, cslDir]
    );

    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError)
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;

    const totals = query.data?.totals ?? null;
    const trend = query.data?.trend ?? [];
    const peakRevenue = Math.max(1, ...trend.map((d) => d.revenue));

    const toggleSrc = (k: SourceSortKey) => {
        if (srcSort === k) setSrcDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setSrcSort(k);
            setSrcDir(k === 'source_type' ? 'asc' : 'desc');
        }
    };
    const toggleCsl = (k: CounsellorSortKey) => {
        if (cslSort === k) setCslDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setCslSort(k);
            setCslDir(k === 'name' ? 'asc' : 'desc');
        }
    };


    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard
                    label={t('column.revenue')}
                    value={fmtCurrency(totals?.revenue ?? 0, currency)}
                    icon={<CurrencyCircleDollar size={18} />}
                    tone="success"
                    sub={t('kpi.revenueSub', {
                        payments: fmtNumber(totals?.payments ?? 0),
                        students: fmtNumber(totals?.paying_leads ?? 0),
                    })}
                />
            </div>

            <ReportSection title={t('dailyRevenue.title')} icon={<TrendUp size={18} />}>
                {trend.length === 0 || trend.every((d) => d.revenue === 0) ? (
                    <EmptyHint message={t('empty.noRevenue')} />
                ) : (
                    <div className="flex h-40 items-end gap-0.5 overflow-x-auto">
                        {trend.map((d) => (
                            <div
                                key={d.date}
                                className="group flex h-full flex-1 flex-col items-center gap-1"
                            >
                                <div className="relative flex w-full flex-1 items-end">
                                    <div
                                        className="w-full rounded-t bg-green-500/80 transition-colors group-hover:bg-green-600"
                                        style={{
                                            height: `${Math.max(2, (d.revenue / peakRevenue) * 100)}%`,
                                        }}
                                        title={t('dailyRevenue.barTooltip', {
                                            date: fmtDay(d.date),
                                            amount: fmtCurrency(d.revenue, currency),
                                            count: d.payments,
                                        })}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <p className="text-xs text-neutral-400">{t('dailyRevenue.footnote')}</p>
            </ReportSection>

            <ReportSection
                title={t('bySource.title')}
                icon={<Megaphone size={18} />}
                actions={
                    <ExportWithColumnPickerButton
                        filename={`revenue-by-source_${fromDate}_${toDate}.csv`}
                        disabled={sources.length === 0}
                        getHeadersAndRows={() => ({
                            headers: [
                                t('column.source'),
                                t('column.revenue'),
                                t('column.payments'),
                            ],
                            rows: sources.map((r) => [r.source_type, r.revenue, r.payments]),
                        })}
                    />
                }
            >
                {sources.length === 0 ? (
                    <EmptyHint message={t('empty.noRevenue')} />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-200 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600 whitespace-nowrap">
                                    <SortableHeader
                                        label={t('column.source')}
                                        sortKey="source_type"
                                        current={srcSort}
                                        dir={srcDir}
                                        onClick={toggleSrc}
                                        align="left"
                                    />
                                    <SortableHeader
                                        label={t('column.revenue')}
                                        sortKey="revenue"
                                        current={srcSort}
                                        dir={srcDir}
                                        onClick={toggleSrc}
                                    />
                                    <SortableHeader
                                        label={t('column.payments')}
                                        sortKey="payments"
                                        current={srcSort}
                                        dir={srcDir}
                                        onClick={toggleSrc}
                                    />
                                </tr>
                            </thead>
                            <tbody>
                                {sources.map((r) => (
                                    <tr
                                        key={r.source_type}
                                        className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                    >
                                        <td className="py-3 pr-3 font-medium text-neutral-900">
                                            {r.source_type}
                                        </td>
                                        <td className="py-3 pr-3 text-right font-semibold text-green-700">
                                            {fmtCurrency(r.revenue, currency)}
                                        </td>
                                        <td className="py-3 pr-3 text-right text-neutral-800">
                                            {fmtNumber(r.payments)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </ReportSection>

            <ReportSection
                title={t('byCounsellor.title')}
                icon={<Users size={18} />}
                actions={
                    <ExportWithColumnPickerButton
                        filename={`revenue-by-counsellor_${fromDate}_${toDate}.csv`}
                        disabled={counsellors.length === 0}
                        getHeadersAndRows={() => ({
                            headers: [
                                t('column.counsellor'),
                                t('column.revenue'),
                                t('column.payments'),
                            ],
                            rows: counsellors.map((r) => [
                                r.name ?? r.user_id,
                                r.revenue,
                                r.payments,
                            ]),
                        })}
                    />
                }
            >
                {counsellors.length === 0 ? (
                    <EmptyHint message={t('empty.noCounsellorRevenue')} />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-200 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600 whitespace-nowrap">
                                    <SortableHeader
                                        label={t('column.counsellor')}
                                        sortKey="name"
                                        current={cslSort}
                                        dir={cslDir}
                                        onClick={toggleCsl}
                                        align="left"
                                    />
                                    <SortableHeader
                                        label={t('column.revenue')}
                                        sortKey="revenue"
                                        current={cslSort}
                                        dir={cslDir}
                                        onClick={toggleCsl}
                                    />
                                    <SortableHeader
                                        label={t('column.payments')}
                                        sortKey="payments"
                                        current={cslSort}
                                        dir={cslDir}
                                        onClick={toggleCsl}
                                    />
                                </tr>
                            </thead>
                            <tbody>
                                {counsellors.map((r) => (
                                    <tr
                                        key={r.user_id}
                                        onClick={() =>
                                            selectCounsellor(r.user_id, r.name ?? r.user_id)
                                        }
                                        aria-selected={selected?.id === r.user_id}
                                        title={t('payments.rowHint')}
                                        className={cn(
                                            'cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50',
                                            selected?.id === r.user_id &&
                                                'bg-primary-50 hover:bg-primary-50'
                                        )}
                                    >
                                        <td className="py-3 pr-3 font-medium text-neutral-900">
                                            {r.name ?? r.user_id}
                                        </td>
                                        <td className="py-3 pr-3 text-right font-semibold text-green-700">
                                            {fmtCurrency(r.revenue, currency)}
                                        </td>
                                        <td className="py-3 pr-3 text-right text-neutral-800">
                                            {fmtNumber(r.payments)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="text-xs text-neutral-400">
                    {t('byCounsellor.footnote')} {t('payments.rowHint')}
                </p>
            </ReportSection>

            <div ref={paymentsRef} className="scroll-mt-4">
                {selected && (
                    <CounsellorPayments
                        params={{ instituteId, fromDate, toDate, teamId }}
                        counsellor={selected}
                        onClose={() => setSelected(null)}
                    />
                )}
            </div>
        </div>
    );
}

// ── Payments behind the clicked counsellor's Collected ─────────────────

interface SelectedCounsellor {
    id: string;
    name: string;
}

interface CounsellorPaymentsProps {
    params: { instituteId: string; fromDate?: string; toDate?: string; teamId?: string };
    counsellor: SelectedCounsellor;
    onClose: () => void;
}

/** ONLINE_PAYMENT → Online Payment. */
function humanize(v: string | null | undefined): string {
    if (!v) return '';
    return v
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function CounsellorPayments({ params, counsellor, onClose }: CounsellorPaymentsProps) {
    const { t } = useTranslation('audienceManagerRevenueTab');
    // Scoping to the clicked counsellor returns exactly the payments summed in that row.
    const p = { ...params, counsellorUserId: counsellor.id };
    const query = useQuery({
        queryKey: revenuePaymentsQueryKey(p),
        queryFn: () => fetchRevenuePayments(p),
        enabled: !!params.instituteId,
        staleTime: 60_000,
        retry: false,
    });
    const data = query.data;
    const rows = data?.payments ?? [];
    const currency = data?.currency ?? 'INR';
    const mode = (r: (typeof rows)[number]) =>
        [humanize(r.payment_mode), humanize(r.payment_sub_mode)].filter(Boolean).join(' / ');

    return (
        <ReportSection
            title={t('payments.title', { name: counsellor.name })}
            icon={<ListBullets size={18} />}
            actions={
                <div className="flex items-center gap-3">
                    {data && (
                        <span className="text-xs text-neutral-500">
                            {t('payments.summary', {
                                count: data.count,
                                amount: fmtCurrency(data.total, currency),
                            })}
                        </span>
                    )}
                    <ExportWithColumnPickerButton
                        filename={`revenue-payments_${counsellor.name}_${params.fromDate}_${params.toDate}.csv`}
                        disabled={rows.length === 0}
                        getHeadersAndRows={() => ({
                            headers: [
                                t('payments.headers.date'),
                                t('payments.headers.student'),
                                t('payments.headers.phone'),
                                t('payments.headers.courses'),
                                t('payments.headers.amount'),
                                t('payments.headers.mode'),
                                t('payments.headers.reference'),
                                t('payments.headers.receipt'),
                                t('payments.headers.source'),
                                t('payments.headers.enteredOn'),
                            ],
                            rows: rows.map((r) => [
                                fmtDay(r.payment_date),
                                r.student_name,
                                r.phone,
                                r.courses,
                                r.amount,
                                mode(r),
                                r.payment_reference,
                                r.receipt_number,
                                r.source_type,
                                fmtDay(r.entered_on),
                            ]),
                        })}
                    />
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('payments.close')}
                        title={t('payments.close')}
                        className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                    >
                        <X size={16} />
                    </button>
                </div>
            }
        >
            {query.isLoading ? (
                <div className="py-8 text-center text-sm text-neutral-400">
                    {t('payments.loading')}
                </div>
            ) : query.isError ? (
                <ReportErrorState error={query.error} onRetry={() => query.refetch()} />
            ) : rows.length === 0 ? (
                <EmptyHint message={t('payments.empty', { name: counsellor.name })} />
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="whitespace-nowrap border-b border-neutral-200 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600">
                                <th className="py-3 pr-3">#</th>
                                <th className="py-3 pr-3">{t('payments.headers.date')}</th>
                                <th className="py-3 pr-3">{t('payments.headers.student')}</th>
                                <th className="py-3 pr-3">{t('payments.headers.courses')}</th>
                                <th className="py-3 pr-3 text-right">
                                    {t('payments.headers.amount')}
                                </th>
                                <th className="py-3 pr-3">{t('payments.headers.mode')}</th>
                                <th className="py-3 pr-3">{t('payments.headers.receipt')}</th>
                                <th className="py-3 pr-3">{t('payments.headers.source')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <tr
                                    key={r.payment_id}
                                    className="border-b border-neutral-100 last:border-0"
                                >
                                    <td className="py-3 pr-3 text-neutral-500">{i + 1}</td>
                                    <td className="whitespace-nowrap py-3 pr-3 text-neutral-800">
                                        {fmtDay(r.payment_date)}
                                        {r.entered_on && r.entered_on !== r.payment_date && (
                                            <div className="text-xs text-neutral-500">
                                                {t('payments.enteredOn', {
                                                    date: fmtDay(r.entered_on),
                                                })}
                                            </div>
                                        )}
                                    </td>
                                    <td className="min-w-48 py-3 pr-3">
                                        <div className="font-medium text-neutral-900">
                                            {r.student_name ?? r.user_id}
                                        </div>
                                        {r.phone && (
                                            <div className="text-xs text-neutral-500">
                                                {r.phone}
                                            </div>
                                        )}
                                    </td>
                                    <td className="min-w-56 py-3 pr-3 text-neutral-800">
                                        {r.courses ?? '—'}
                                    </td>
                                    <td className="whitespace-nowrap py-3 pr-3 text-right font-semibold text-green-700">
                                        {fmtCurrency(r.amount, currency)}
                                    </td>
                                    <td className="min-w-40 py-3 pr-3 text-neutral-800">
                                        {mode(r) || '—'}
                                        {r.payment_reference && (
                                            <div className="text-xs text-neutral-500">
                                                {r.payment_reference}
                                            </div>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap py-3 pr-3 text-neutral-800">
                                        {r.receipt_number ?? '—'}
                                    </td>
                                    <td className="py-3 pr-3 text-neutral-800">
                                        {r.source_type ?? '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t border-neutral-200 font-semibold text-neutral-900">
                                <td className="py-3 pr-3" colSpan={4}>
                                    {t('payments.total')}
                                </td>
                                <td className="whitespace-nowrap py-3 pr-3 text-right text-green-700">
                                    {fmtCurrency(data?.total ?? 0, currency)}
                                </td>
                                <td colSpan={3} />
                            </tr>
                        </tfoot>
                    </table>
                    {data?.truncated && (
                        <p className="pt-2 text-xs text-neutral-400">
                            {t('payments.truncated', { shown: rows.length, count: data.count })}
                        </p>
                    )}
                </div>
            )}
        </ReportSection>
    );
}

/** Generic null-aware sort shared by both tables. */
function sortRows<T extends RevenueSourceRow | RevenueCounsellorRow, K extends keyof T>(
    rows: T[],
    key: K,
    dir: 'asc' | 'desc'
): T[] {
    const list = [...rows];
    list.sort((a, b) => {
        const av = a[key] as unknown;
        const bv = b[key] as unknown;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number')
            return dir === 'asc' ? av - bv : bv - av;
        const s = String(av).localeCompare(String(bv));
        return dir === 'asc' ? s : -s;
    });
    return list;
}
