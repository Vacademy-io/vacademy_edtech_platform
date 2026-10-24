import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowRight,
    ChartLineUp,
    CheckCircle,
    DownloadSimple,
    Lightning,
    Receipt,
    TrendUp,
    UserPlus,
    Users,
    Wallet,
    Warning,
    WarningCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { cn } from '@/lib/utils';
import { getBrowserTimezoneOrUndefined } from '@/utils/timezone';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { fetchPaymentDashboard, type PaymentDashboard } from '@/services/payment-dashboard';
import { DateRangeDropdown } from '@/routes/manage-payments/-components/DateRangeDropdown';
import {
    rangeToLocalIsoWindow,
    resolvePreset,
    type DateRangeValue,
} from '@/routes/manage-payments/-utils/dateRange';
import {
    exportEntriesToCsv,
    fetchAllPaymentLogs,
} from '@/routes/manage-payments/-utils/exportPaymentLogsCsv';
import {
    AGEING_LABELS,
    AGEING_ORDER,
    DASHBOARD_PERIODS,
    SOURCE_LABELS,
    batchParts,
    buildHighlights,
    collectionRate,
    formatCompact,
    formatFull,
    monthLabel,
    percentChange,
    resolveDashboardPeriod,
    toApiDateTime,
    toMethodSlices,
    type CourseRow,
    type DashboardPeriodKey,
    type Highlight,
} from '../-utils/dashboardMath';
import { BarList, DeltaPill, InfoTip, MiniStat, SectionCard, SegmentBar } from './DashboardParts';
import {
    CollectedTrend,
    CollectionCalendar,
    ForecastChart,
    RevenueByMonth,
    YearChart,
} from './DashboardCharts';
import { BatchesTable, CourseLeaderboard } from './DashboardTables';

const ALL = '__all__';
/** Matches no batch — see packageSessionIds. */
const NO_BATCH = '__none__';

/** "1 Apr – 28 Sep 2026" from the API's UTC date-times, shown in the admin's own zone. */
const formatWindow = (start: string | null, end: string | null): string => {
    if (!end) return '';
    const fmt = (s: string, withYear: boolean) =>
        new Date(`${s}Z`).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            ...(withYear ? { year: 'numeric' } : {}),
        });
    if (!start) return `All time to ${fmt(end, true)}`;
    const sameYear = start.slice(0, 4) === end.slice(0, 4);
    return `${fmt(start, !sameYear)} – ${fmt(end, true)}`;
};

const PERIOD_TABS: { key: DashboardPeriodKey; label: string }[] = [
    ...DASHBOARD_PERIODS,
    { key: 'custom', label: 'Custom' },
];

const HIGHLIGHT_STYLES: Record<Highlight['tone'], { icon: typeof TrendUp; className: string }> = {
    brand: { icon: TrendUp, className: 'bg-primary-50 text-primary-500' },
    info: { icon: Lightning, className: 'bg-info-50 text-info-600' },
    danger: { icon: Warning, className: 'bg-danger-50 text-danger-600' },
    success: { icon: CheckCircle, className: 'bg-success-50 text-success-600' },
};

export function PaymentDashboardView() {
    const navigate = useNavigate();
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    const [period, setPeriod] = useState<DashboardPeriodKey>('fy');
    const [customRange, setCustomRange] = useState<DateRangeValue>(() => resolvePreset('30d'));
    const [courseId, setCourseId] = useState<string>(ALL);
    const [batchId, setBatchId] = useState<string>(ALL);
    // A course picked from the Courses table can be one the institute list does not carry (an
    // inactive batch, a faculty-limited list). Its batches come from the dashboard data instead.
    const [pickedCourse, setPickedCourse] = useState<CourseRow | null>(null);
    const [exporting, setExporting] = useState(false);

    // The window is fixed when the period is picked, so the query key does not tick with the clock.
    const window = useMemo(() => {
        if (period === 'custom') return rangeToLocalIsoWindow(customRange);
        const r = resolveDashboardPeriod(period);
        return { start: r.start ? toApiDateTime(r.start) : undefined, end: toApiDateTime(r.end) };
    }, [period, customRange]);

    const batches = useMemo(() => instituteDetails?.batches_for_sessions ?? [], [instituteDetails]);
    const courseOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const b of batches) {
            if (b.package_dto?.id && !seen.has(b.package_dto.id)) {
                seen.set(b.package_dto.id, b.package_dto.package_name || 'Untitled');
            }
        }
        if (pickedCourse && !seen.has(pickedCourse.key))
            seen.set(pickedCourse.key, pickedCourse.name);
        return [
            { value: ALL, label: `All ${courseTerm.toLowerCase()}s` },
            ...[...seen.entries()]
                .map(([value, label]) => ({ value, label }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        ];
    }, [batches, courseTerm, pickedCourse]);
    const courseBatches = useMemo(() => {
        if (courseId === ALL) return [];
        const out = new Map<string, string>();
        for (const b of batches) {
            if (b.package_dto?.id !== courseId) continue;
            out.set(b.id, batchParts(b.level?.level_name, b.session?.session_name));
        }
        if (pickedCourse?.key === courseId) {
            for (const b of pickedCourse.batches) if (!out.has(b.id)) out.set(b.id, b.label);
        }
        return [...out.entries()].map(([value, label]) => ({
            value,
            label: label || courseOptions.find((c) => c.value === courseId)?.label || batchTerm,
        }));
    }, [batches, batchTerm, courseId, pickedCourse, courseOptions]);
    const batchOptions = useMemo(
        () => [
            { value: ALL, label: `All ${batchTerm.toLowerCase()}es` },
            ...(courseId === ALL
                ? batches.map((b) => ({
                      value: b.id,
                      label: [
                          b.package_dto?.package_name,
                          batchParts(b.level?.level_name, b.session?.session_name),
                      ]
                          .filter(Boolean)
                          .join(' · '),
                  }))
                : courseBatches
            ).sort((a, b) => a.label.localeCompare(b.label)),
        ],
        [batches, batchTerm, courseId, courseBatches]
    );
    const packageSessionIds = useMemo(() => {
        if (batchId !== ALL) return [batchId];
        if (courseId === ALL) return undefined;
        const ids = courseBatches.map((b) => b.value);
        // An empty list means "no filter" to the API; a chosen course with no batches must show
        // nothing rather than the whole institute.
        return ids.length > 0 ? ids : [NO_BATCH];
    }, [batchId, courseId, courseBatches]);

    const request = useMemo(
        () => ({
            start_date_in_utc: window.start,
            end_date_in_utc: window.end,
            package_session_ids: packageSessionIds,
            // Normalised: some browsers report Asia/Calcutta, which Postgres rejects.
            time_zone: getBrowserTimezoneOrUndefined(),
        }),
        [window, packageSessionIds]
    );

    const { data, isLoading, isError, isFetching, refetch } = useQuery<PaymentDashboard>({
        queryKey: ['payment-dashboard', request],
        queryFn: () => fetchPaymentDashboard(request),
        staleTime: 60_000,
        // Balances change on Manage Payments (a payment recorded, a due date moved), so coming back
        // here asks again rather than showing the copy cached before the change.
        refetchOnMount: 'always',
        placeholderData: keepPreviousData,
        retry: false,
    });

    const handleExport = async () => {
        setExporting(true);
        try {
            const { entries } = await fetchAllPaymentLogs({
                sort_columns: { createdAt: 'DESC' },
                ...(window.start ? { start_date_in_utc: window.start } : {}),
                ...(window.end ? { end_date_in_utc: window.end } : {}),
                ...(packageSessionIds ? { package_session_ids: packageSessionIds } : {}),
            });
            if (entries.length === 0) {
                toast.info('No payment records to export for this period.');
                return;
            }
            const count = exportEntriesToCsv(entries, instituteDetails?.institute_name);
            toast.success(`Exported ${count.toLocaleString()} payment records.`);
        } catch (error) {
            console.error('Failed to export payment logs:', error);
            toast.error('Failed to export payment records. Please try again.');
        } finally {
            setExporting(false);
        }
    };

    const selectCourse = (id: string) => {
        setCourseId(id);
        setBatchId(ALL);
    };
    const selectCourseRow = (course: CourseRow) => {
        setPickedCourse(course);
        selectCourse(course.key);
    };

    return (
        <div className="space-y-5">
            {/* Hero band: what the page covers, the period, and the filters that govern it */}
            <div className="rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50 via-white to-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-500 text-white shadow-sm">
                            <ChartLineUp size={22} weight="bold" />
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-h3 font-bold text-neutral-900">Payment overview</h2>
                            <p className="mt-0.5 text-body text-neutral-600">
                                {data ? (
                                    <>
                                        <span className="font-medium text-neutral-800">
                                            {formatWindow(data.period_start, data.period_end)}
                                        </span>
                                        {data.previous_start && data.previous_end && (
                                            <span className="text-neutral-500">
                                                {' '}
                                                · compared with{' '}
                                                {formatWindow(
                                                    data.previous_start,
                                                    data.previous_end
                                                )}
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    'Money collected, still owed and on its way'
                                )}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {isFetching && !isLoading && (
                            <span className="text-caption text-neutral-400">Updating…</span>
                        )}
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            className="gap-2 bg-white"
                            onClick={handleExport}
                            disable={exporting}
                        >
                            <DownloadSimple size={16} />
                            {exporting ? 'Exporting…' : 'Export'}
                        </MyButton>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <div
                        className="flex flex-wrap rounded-lg border border-neutral-200 bg-white p-0.5 shadow-sm"
                        role="tablist"
                    >
                        {PERIOD_TABS.map((p) => (
                            <button
                                key={p.key}
                                type="button"
                                role="tab"
                                aria-selected={period === p.key}
                                onClick={() => setPeriod(p.key)}
                                className={cn(
                                    'rounded-md px-3 py-1.5 text-caption font-medium transition-colors',
                                    period === p.key
                                        ? 'bg-primary-500 text-white shadow-sm'
                                        : 'text-neutral-600 hover:bg-neutral-100'
                                )}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    {/* Only a custom period has dates to pick; the presets are the tabs themselves. */}
                    {period === 'custom' && (
                        <DateRangeDropdown value={customRange} onChange={setCustomRange} />
                    )}
                    <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                        <SearchableSelect
                            options={courseOptions}
                            value={courseId}
                            onChange={(v) => selectCourse(v || ALL)}
                            placeholder={`All ${courseTerm.toLowerCase()}s`}
                            searchPlaceholder={`Search ${courseTerm.toLowerCase()}`}
                            className="w-full sm:w-48"
                        />
                        <SearchableSelect
                            options={batchOptions}
                            value={batchId}
                            onChange={(v) => setBatchId(v || ALL)}
                            placeholder={`All ${batchTerm.toLowerCase()}es`}
                            searchPlaceholder={`Search ${batchTerm.toLowerCase()}`}
                            className="w-full sm:w-48"
                        />
                        {(courseId !== ALL || batchId !== ALL) && (
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={() => selectCourse(ALL)}
                            >
                                Clear
                            </MyButton>
                        )}
                    </div>
                </div>
            </div>

            {isLoading ? (
                <DashboardSkeleton />
            ) : isError || !data ? (
                <Card className="flex flex-col items-center gap-3 rounded-xl border-neutral-200 p-10 text-center">
                    <WarningCircle size={32} className="text-danger-500" />
                    <div>
                        <p className="text-subtitle font-semibold text-neutral-800">
                            The dashboard could not be loaded
                        </p>
                        <p className="text-body text-neutral-500">
                            Check your connection and try again.
                        </p>
                    </div>
                    <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                        Try again
                    </MyButton>
                </Card>
            ) : data.kpis.collected_all_time <= 0 &&
              data.kpis.outstanding <= 0 &&
              data.kpis.still_to_come <= 0 ? (
                <Card className="flex flex-col items-center gap-2 rounded-xl border-neutral-200 p-10 text-center">
                    <TrendUp size={32} className="text-neutral-400" />
                    <p className="text-subtitle font-semibold text-neutral-800">No payments yet</p>
                    <p className="max-w-md text-body text-neutral-500">
                        {packageSessionIds
                            ? `No money has been collected or billed for this ${courseTerm.toLowerCase()} or ${batchTerm.toLowerCase()} yet.`
                            : 'Once learners start paying, their payments, dues and trends will appear here.'}
                    </p>
                </Card>
            ) : (
                <DashboardBody
                    data={data}
                    courseTerm={courseTerm}
                    batchTerm={batchTerm}
                    onSelectCourse={selectCourseRow}
                    onOpenManagePayments={() => navigate({ to: '/manage-payments' })}
                />
            )}
        </div>
    );
}

function DashboardBody({
    data,
    courseTerm,
    batchTerm,
    onSelectCourse,
    onOpenManagePayments,
}: {
    data: PaymentDashboard;
    courseTerm: string;
    batchTerm: string;
    onSelectCourse: (course: CourseRow) => void;
    onOpenManagePayments: () => void;
}) {
    const k = data.kpis;
    const cur = data.currency;
    const highlights = useMemo(() => buildHighlights(data), [data]);
    const methods = useMemo(() => toMethodSlices(data.methods), [data.methods]);
    const ageing = useMemo(
        () =>
            AGEING_ORDER.map((key) => data.ageing.find((a) => a.bucket === key))
                .filter((a): a is NonNullable<typeof a> => !!a && a.amount > 0)
                .map((a) => ({
                    key: a.bucket,
                    label: AGEING_LABELS[a.bucket] ?? a.bucket,
                    value: a.amount,
                    detail: `${a.learners} learner${a.learners === 1 ? '' : 's'}`,
                    barClassName: a.bucket === 'D0_30' ? 'bg-warning-400' : 'bg-danger-500',
                })),
        [data.ageing]
    );

    return (
        <div className="space-y-5">
            {/* Headline: what came in this period, and where the institute's fees stand today */}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                <CollectedHero data={data} className="xl:col-span-2" />
                <FeePosition data={data} onOpenManagePayments={onOpenManagePayments} />
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                <SectionCard
                    className="xl:col-span-2"
                    title="Revenue by month"
                    info="Money collected each month over the last 12 months, with the same month a year earlier as a line for comparison. Switch the tab to see paying learners or new paying learners instead."
                    subtitle="Last 12 months, with the same month a year earlier"
                >
                    <RevenueByMonth months={data.months} currency={cur} />
                </SectionCard>
                <SectionCard
                    title="Highlights"
                    info="Short takeaways worked out from the figures on this page."
                    subtitle="What stands out right now"
                >
                    {highlights.length === 0 ? (
                        <p className="py-6 text-center text-caption text-neutral-500">
                            Nothing stands out yet.
                        </p>
                    ) : (
                        <ul className="space-y-3">
                            {highlights.map((h) => {
                                const style = HIGHLIGHT_STYLES[h.tone];
                                const Icon = style.icon;
                                return (
                                    <li
                                        key={h.text}
                                        className="flex gap-3 rounded-xl border border-neutral-100 bg-neutral-50 p-3"
                                    >
                                        <span
                                            className={cn(
                                                'flex size-8 shrink-0 items-center justify-center rounded-lg',
                                                style.className
                                            )}
                                        >
                                            <Icon size={16} weight="bold" />
                                        </span>
                                        <p className="text-body text-neutral-700">{h.text}</p>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </SectionCard>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                <SectionCard
                    className="xl:col-span-2"
                    title={`${courseTerm}s`}
                    info={`Money collected in the selected period for each ${courseTerm.toLowerCase()}. The bar is its whole fee position on active enrolments: collected so far, overdue, and still to come. When one payment covers several ${batchTerm.toLowerCase()}es, it is split evenly between them.`}
                    subtitle={`Ranked by money collected in this period · click one to filter the page`}
                >
                    <CourseLeaderboard
                        batches={data.batches}
                        currency={cur}
                        courseTerm={courseTerm}
                        onSelectCourse={onSelectCourse}
                    />
                </SectionCard>
                <SectionCard
                    title="Cash-flow forecast"
                    info="Unpaid instalments, invoices and renewals on active enrolments, grouped by the month they fall due. Overdue amounts are not included here."
                    subtitle="Instalments and renewals falling due"
                    action={
                        <MyButton
                            buttonType="text"
                            scale="small"
                            className="gap-1"
                            onClick={onOpenManagePayments}
                        >
                            Learners <ArrowRight size={14} />
                        </MyButton>
                    }
                >
                    <ForecastChart months={data.forecast} currency={cur} />
                    <ForecastSummary months={data.forecast} currency={cur} />
                </SectionCard>
            </div>

            <SectionCard
                title={`${batchTerm}es`}
                info={`Every ${batchTerm.toLowerCase()} with a payment in the period or money still owed, sorted by the money still to collect.`}
                subtitle="Sorted by money still to collect"
            >
                <BatchesTable
                    batches={data.batches}
                    currency={cur}
                    courseTerm={courseTerm}
                    batchTerm={batchTerm}
                />
            </SectionCard>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <SectionCard
                    title="Revenue by source"
                    info="Where the money in the selected period came from: online checkout (payment links, catalogue and invite pages), live class registration, payments recorded manually by an admin, or a sub-organisation."
                    subtitle="How learners enrolled and paid"
                >
                    <BarList
                        rows={data.sources.map((s) => ({
                            key: s.key ?? 'OTHER',
                            label: SOURCE_LABELS[s.key ?? ''] ?? 'Other',
                            value: s.amount,
                            detail: `${s.payments.toLocaleString('en-IN')} payment${s.payments === 1 ? '' : 's'}`,
                        }))}
                        formatValue={(v) => formatCompact(v, cur)}
                        emptyText="No payments in this period."
                    />
                </SectionCard>
                <SectionCard
                    title="Payment methods"
                    info="How the money in the selected period was paid: the payment gateway, or offline when an admin recorded the payment."
                    subtitle="How the money was paid"
                >
                    <BarList
                        rows={methods.map((m) => ({
                            key: m.label,
                            label: m.label,
                            value: m.amount,
                            detail: `${m.payments.toLocaleString('en-IN')} payment${m.payments === 1 ? '' : 's'}`,
                        }))}
                        formatValue={(v) => formatCompact(v, cur)}
                        barClassName="bg-info-500"
                        emptyText="No payments in this period."
                    />
                </SectionCard>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <SectionCard
                    title="Overdue ageing"
                    info="Overdue money grouped by how long ago it fell due. The older the balance, the harder it usually is to collect."
                    subtitle={
                        k.overdue > 0
                            ? `${formatCompact(k.overdue, cur)} overdue from ${k.learners_overdue} learner${k.learners_overdue === 1 ? '' : 's'}`
                            : 'Nothing is overdue'
                    }
                    action={
                        k.overdue > 0 ? (
                            <MyButton
                                buttonType="text"
                                scale="small"
                                className="gap-1"
                                onClick={onOpenManagePayments}
                            >
                                Follow up <ArrowRight size={14} />
                            </MyButton>
                        ) : undefined
                    }
                >
                    {ageing.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-8 text-center">
                            <span className="flex size-10 items-center justify-center rounded-full bg-success-50 text-success-600">
                                <CheckCircle size={22} weight="fill" />
                            </span>
                            <p className="text-body font-medium text-neutral-700">
                                Nothing is overdue right now
                            </p>
                            <p className="text-caption text-neutral-500">
                                Every instalment and renewal due so far has been paid.
                            </p>
                        </div>
                    ) : (
                        <BarList
                            rows={ageing}
                            formatValue={(v) => formatCompact(v, cur)}
                            emptyText="Nothing is overdue right now."
                        />
                    )}
                </SectionCard>
                <SectionCard
                    title="Year over year"
                    info="Money collected in each financial year (April to March). Years before the first payment are left out."
                    subtitle="Collected per financial year"
                >
                    <YearChart years={data.years} currency={cur} />
                </SectionCard>
            </div>

            <SectionCard
                title="Collection calendar"
                info="Money received on each day over the last 26 weeks. Darker squares are days with more money in."
                subtitle="Money received per day, last 26 weeks"
            >
                <CollectionCalendar days={data.days} currency={cur} />
            </SectionCard>
        </div>
    );
}

/** Under the forecast chart: the total still expected and the next month money is due in. */
function ForecastSummary({
    months,
    currency,
}: {
    months: PaymentDashboard['forecast'];
    currency: string | null;
}) {
    const total = months.reduce((s, m) => s + m.amount, 0);
    const next = months.find((m) => m.month && m.amount > 0);
    if (total <= 0) return null;
    return (
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-4">
            <div className="rounded-lg bg-success-50 p-3">
                <dt className="text-caption text-success-700">Expected in all</dt>
                <dd className="text-subtitle font-bold tabular-nums text-neutral-900">
                    {formatCompact(total, currency)}
                </dd>
            </div>
            {next?.month && (
                <div className="rounded-lg bg-neutral-50 p-3">
                    <dt className="text-caption text-neutral-500">
                        Next · {monthLabel(next.month, true)}
                    </dt>
                    <dd className="text-subtitle font-bold tabular-nums text-neutral-900">
                        {formatCompact(next.amount, currency)}
                    </dd>
                    <dd className="text-caption text-neutral-500">
                        {next.learners} learner{next.learners === 1 ? '' : 's'}
                    </dd>
                </div>
            )}
        </dl>
    );
}

/**
 * The headline: money collected in the period, how it compares with a year earlier, the
 * payments and learners behind it, and the 12-month trend.
 */
function CollectedHero({ data, className }: { data: PaymentDashboard; className?: string }) {
    const k = data.kpis;
    const cur = data.currency;
    const compared = k.previous_collected !== null;
    const change = percentChange(k.collected, k.previous_collected);
    return (
        <Card className={cn('overflow-hidden rounded-xl border-neutral-200 shadow-sm', className)}>
            <div className="p-5">
                <div className="flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-neutral-500">
                    <Wallet size={14} weight="bold" className="text-primary-500" />
                    Collected
                    <InfoTip text="Money received in the selected period from successful payments. Failed or abandoned payment attempts are not counted." />
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-3">
                    <span className="text-h1 font-bold tabular-nums text-neutral-900">
                        {formatFull(k.collected, cur)}
                    </span>
                    <DeltaPill change={change} />
                </div>
                <p className="mt-1 text-caption text-neutral-500">
                    {!compared
                        ? 'All time'
                        : change === null
                          ? 'Nothing was collected in the same period a year earlier'
                          : `${formatCompact(k.previous_collected ?? 0, cur)} in the same period a year earlier`}
                </p>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <MiniStat
                        icon={<Receipt size={18} weight="bold" />}
                        label="Payments"
                        value={k.payments.toLocaleString('en-IN')}
                        delta={
                            <DeltaPill change={percentChange(k.payments, k.previous_payments)} />
                        }
                    />
                    <MiniStat
                        icon={<Users size={18} weight="bold" />}
                        label="Paying learners"
                        info="Distinct learners who made at least one successful payment in the selected period."
                        value={k.paying_learners.toLocaleString('en-IN')}
                        delta={
                            <DeltaPill
                                change={percentChange(
                                    k.paying_learners,
                                    k.previous_paying_learners
                                )}
                            />
                        }
                    />
                    <MiniStat
                        icon={<UserPlus size={18} weight="bold" />}
                        label="New payers"
                        info="Learners whose first ever payment to your institute was in the selected period."
                        value={k.new_paying_learners.toLocaleString('en-IN')}
                        delta={
                            <DeltaPill
                                change={percentChange(
                                    k.new_paying_learners,
                                    k.previous_new_paying_learners
                                )}
                            />
                        }
                    />
                </div>
            </div>
            <div className="border-t border-neutral-100 px-3 pb-2 pt-3">
                <div className="flex items-center justify-between px-2 text-caption text-neutral-500">
                    <span>Collected per month, last 12 months</span>
                    <span className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5">
                            <span className="h-0.5 w-3 rounded bg-primary-500" /> This year
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="h-0.5 w-3 rounded bg-neutral-400" /> A year earlier
                        </span>
                    </span>
                </div>
                <CollectedTrend months={data.months} currency={cur} />
            </div>
        </Card>
    );
}

/**
 * Where the institute's fees stand today, whatever period is picked: how much of the fee on its
 * enrolments is in, and what is overdue, due soon and still to come.
 */
function FeePosition({
    data,
    onOpenManagePayments,
}: {
    data: PaymentDashboard;
    onOpenManagePayments: () => void;
}) {
    const k = data.kpis;
    const cur = data.currency;
    const rate = collectionRate(k.collected_all_time, k.outstanding);
    const notYetDue = Math.max(0, k.outstanding - k.overdue);
    const learners = (n: number) => `${n.toLocaleString('en-IN')} learner${n === 1 ? '' : 's'}`;
    const rows = [
        {
            key: 'overdue',
            dot: 'bg-danger-500',
            label: 'Overdue',
            info: 'Instalments, renewals and invoices whose due date has passed and are still unpaid.',
            amount: k.overdue,
            detail: learners(k.learners_overdue),
            tone: k.overdue > 0 ? 'text-danger-600' : 'text-neutral-900',
        },
        {
            key: 'soon',
            dot: 'bg-warning-500',
            label: `Due in next ${k.upcoming_days} days`,
            info: `Unpaid instalments, renewals and invoices falling due within the next ${k.upcoming_days} days.`,
            amount: k.due_soon,
            detail: learners(k.learners_due_soon),
            tone: 'text-neutral-900',
        },
        {
            key: 'later',
            dot: 'bg-success-500',
            label: 'Still to come',
            info: 'Everything scheduled that has not fallen due yet: future instalments and invoices, and renewals within the next 30 days.',
            amount: k.still_to_come,
            detail: learners(k.learners_still_to_come),
            tone: 'text-neutral-900',
        },
    ];
    return (
        <Card className="flex flex-col rounded-xl border-neutral-200 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-neutral-500">
                    Fee position
                    <InfoTip text="Where the fees on your active enrolments stand today. This does not change with the period picked above." />
                </div>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption text-neutral-600">
                    As of today
                </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
                <span className="text-h1 font-bold tabular-nums text-neutral-900">
                    {rate === null ? '—' : `${rate.toFixed(1)}%`}
                </span>
                <span className="flex items-center gap-1 text-caption text-neutral-500">
                    collected
                    <InfoTip text="Everything collected so far, divided by that plus what is still owed (overdue amounts and unpaid instalments or invoices). Subscription renewals that have not fallen due yet are not counted." />
                </span>
            </div>
            <SegmentBar
                className="mt-3"
                segments={[
                    { key: 'in', value: k.collected_all_time, className: 'bg-primary-500' },
                    { key: 'overdue', value: k.overdue, className: 'bg-danger-500' },
                    { key: 'owed', value: notYetDue, className: 'bg-success-400' },
                ]}
            />
            <p className="mt-2 text-caption text-neutral-500">
                {formatCompact(k.collected_all_time, cur)} collected ·{' '}
                {formatCompact(k.outstanding, cur)} still owed
            </p>
            <ul className="mt-4 flex-1 divide-y divide-neutral-100">
                {rows.map((r) => (
                    <li key={r.key} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className={cn('size-2 shrink-0 rounded-full', r.dot)} />
                            <span className="truncate text-body text-neutral-700">{r.label}</span>
                            <InfoTip text={r.info} />
                        </div>
                        <div className="shrink-0 text-right">
                            <div className={cn('text-body font-semibold tabular-nums', r.tone)}>
                                {formatCompact(r.amount, cur)}
                            </div>
                            <div className="text-caption text-neutral-400">{r.detail}</div>
                        </div>
                    </li>
                ))}
            </ul>
            <MyButton
                buttonType="secondary"
                scale="small"
                className="mt-3 w-full gap-1"
                onClick={onOpenManagePayments}
            >
                Open Manage Payments <ArrowRight size={14} />
            </MyButton>
        </Card>
    );
}

function DashboardSkeleton() {
    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                <Skeleton className="h-80 rounded-xl xl:col-span-2" />
                <Skeleton className="h-80 rounded-xl" />
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                <Skeleton className="h-96 rounded-xl xl:col-span-2" />
                <Skeleton className="h-96 rounded-xl" />
            </div>
            <Skeleton className="h-72 rounded-xl" />
        </div>
    );
}
