/**
 * Reports Center — Counsellors tab.
 *
 * The counsellor performance table, moved out of the old Overview into its
 * own full-width tab. Same data source (GET /v1/reports/counselor-performance),
 * same sortable columns and colour-coded rate cells. Clicking a counsellor row opens
 * that counsellor's converted leads right below the table and scrolls to them.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CaretDown, ListBullets, Trophy, Users, WarningCircle, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import { ReportLeadName } from './report-lead-name';
import {
    fetchCounselorPerformance,
    type CounselorPerformance,
    type CounselorRow,
} from '../-services/get-lead-reports';
import {
    conversionsQueryKey,
    fetchConversions,
    type ConversionLeadRow,
} from '../-services/get-conversion-reports';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    SortableHeader,
    avatarPalette,
    convRateClass,
    fmtDay,
    fmtMinutes,
    fmtPct,
    tatMetClass,
    type ReportTabProps,
} from './report-shared';
import {
    EMPTY_FEE,
    FeeCell,
    InstallmentsCell,
    NextInstallmentCell,
    PaidCell,
    addFee,
    feeCsvHeaders,
    feeCsvValues,
    type FeeSummary,
} from './conversion-fee-cells';

interface SelectedCounsellor {
    id: string;
    name: string;
}

export function CounsellorsTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
    audienceId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerCounsellorsTab');
    const [selected, setSelected] = useState<SelectedCounsellor | null>(null);
    const leadsRef = useRef<HTMLDivElement>(null);

    const selectCounsellor = (id: string, name: string) => {
        const selecting = selected?.id !== id;
        setSelected(selecting ? { id, name } : null);
        // The converted leads open below the table — take the admin straight to them.
        if (selecting)
            requestAnimationFrame(() =>
                leadsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            );
    };

    const counsellorQuery = useQuery({
        queryKey: [
            'counselor-performance',
            instituteId,
            fromDate,
            toDate,
            teamId,
            counsellorUserId,
            audienceId,
        ],
        queryFn: () =>
            fetchCounselorPerformance(
                instituteId,
                fromDate,
                toDate,
                teamId,
                counsellorUserId,
                audienceId
            ),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    if (counsellorQuery.isLoading) return <ReportTabSkeleton />;
    if (counsellorQuery.isError) {
        return (
            <ReportErrorState
                error={counsellorQuery.error}
                onRetry={() => counsellorQuery.refetch()}
            />
        );
    }

    const performance = counsellorQuery.data;

    return (
        <div className="flex flex-col gap-6">
            <ReportSection
                title={t('title')}
                icon={<Users size={18} />}
                actions={
                    <div className="flex flex-wrap items-center gap-3">
                        {performance && (
                            <span className="text-xs text-neutral-500">
                                {t('summary.counsellorCount', {
                                    count: performance.summary.total_counselors,
                                })}
                                {performance.summary.avg_response_minutes != null && (
                                    <>
                                        {' '}
                                        · {t('summary.avgResponse')}{' '}
                                        <strong className="text-neutral-700">
                                            {fmtMinutes(performance.summary.avg_response_minutes)}
                                        </strong>
                                    </>
                                )}
                                {performance.summary.avg_conversion_rate != null && (
                                    <>
                                        {' '}
                                        · {t('summary.avgConversion')}{' '}
                                        <strong className="text-neutral-700">
                                            {fmtPct(performance.summary.avg_conversion_rate)}
                                        </strong>
                                    </>
                                )}
                            </span>
                        )}
                        <ExportWithColumnPickerButton
                            filename={`counsellor-performance_${fromDate}_${toDate}.csv`}
                            disabled={!performance || performance.rows.length === 0}
                            getHeadersAndRows={() => ({
                                headers: [
                                    t('csv.headers.counsellor'),
                                    t('csv.headers.assigned'),
                                    t('csv.headers.responded'),
                                    t('csv.headers.conversions'),
                                    t('csv.headers.convRate'),
                                    t('csv.headers.avgResponse'),
                                    t('csv.headers.tatMet'),
                                    t('csv.headers.open'),
                                    t('csv.headers.overdue'),
                                ],
                                rows: (performance?.rows ?? []).map((r) => [
                                    r.counselor_name,
                                    r.leads_assigned,
                                    r.leads_responded,
                                    r.conversions,
                                    r.conversion_rate,
                                    r.avg_response_minutes,
                                    r.tat_met_rate,
                                    r.open_leads,
                                    r.overdue_leads,
                                ]),
                            })}
                        />
                    </div>
                }
            >
                <CounsellorTable
                    performance={performance}
                    loading={false}
                    selectedId={selected?.id ?? null}
                    onRowClick={selectCounsellor}
                />
            </ReportSection>

            <div ref={leadsRef} className="scroll-mt-4">
                {selected && (
                    <ConvertedLeads
                        params={{ instituteId, fromDate, toDate, teamId, counsellorUserId }}
                        counsellor={selected}
                        onClose={() => setSelected(null)}
                    />
                )}
            </div>
        </div>
    );
}

// ── Converted leads of the clicked counsellor ──────────────────────────

interface ConvertedLeadsProps {
    params: {
        instituteId: string;
        fromDate?: string;
        toDate?: string;
        teamId?: string;
        counsellorUserId?: string;
    };
    counsellor: SelectedCounsellor;
    onClose: () => void;
}

/** One row per student: a student enrolled in 2 courses is one converted lead. */
interface StudentRow {
    user_id: string;
    lead_name: string;
    contact: string | null;
    phone: string | null;
    email: string | null;
    courses: string[];
    enrolled_at: string | null;
    campaign: string | null;
    source: string | null;
    /** The student's enrolments' fee plans added up. */
    fee: FeeSummary;
}

function groupByStudent(rows: ConversionLeadRow[]): StudentRow[] {
    const byUser = new Map<string, StudentRow>();
    for (const r of rows) {
        const cur = byUser.get(r.user_id);
        if (!cur) {
            byUser.set(r.user_id, {
                user_id: r.user_id,
                lead_name: r.lead_name ?? r.user_id,
                contact: r.phone ?? r.email,
                phone: r.phone,
                email: r.email,
                courses: r.course_name ? [r.course_name] : [],
                enrolled_at: r.enrolled_at,
                campaign: r.campaign_name,
                source: r.source_type,
                fee: addFee(EMPTY_FEE, r),
            });
            continue;
        }
        cur.fee = addFee(cur.fee, r);
        if (r.course_name && !cur.courses.includes(r.course_name)) cur.courses.push(r.course_name);
        // Keep the first enrolment date of the student.
        if (r.enrolled_at && (!cur.enrolled_at || r.enrolled_at < cur.enrolled_at))
            cur.enrolled_at = r.enrolled_at;
    }
    return [...byUser.values()].sort((a, b) =>
        (b.enrolled_at ?? '').localeCompare(a.enrolled_at ?? '')
    );
}

function ConvertedLeads({ params, counsellor, onClose }: ConvertedLeadsProps) {
    const { t } = useTranslation('audienceManagerCounsellorsTab');
    const { t: tc } = useTranslation('audienceManagerConversionsTab');
    // What the institute calls the campaign type (I2CAN: "Source") — set in Lead Settings.
    const { campaignType: sourceLabel } = useLeadTerminology();
    const query = useQuery({
        queryKey: conversionsQueryKey(params),
        queryFn: () => fetchConversions(params),
        enabled: !!params.instituteId,
        staleTime: 60_000,
        retry: false,
    });

    const students = useMemo(
        () =>
            groupByStudent(
                (query.data?.leads ?? []).filter((r) => r.counsellor_id === counsellor.id)
            ),
        [query.data, counsellor.id]
    );
    const currency = query.data?.currency ?? 'INR';

    return (
        <ReportSection
            title={t('leads.title', { name: counsellor.name })}
            icon={<ListBullets size={18} />}
            actions={
                <div className="flex items-center gap-3">
                    {query.isSuccess && (
                        <span className="text-xs text-neutral-500">
                            {t('leads.count', { count: students.length })}
                        </span>
                    )}
                    <ExportWithColumnPickerButton
                        filename={`converted-leads_${counsellor.name}_${params.fromDate}_${params.toDate}.csv`}
                        disabled={students.length === 0}
                        getHeadersAndRows={() => ({
                            headers: [
                                t('leads.headers.lead'),
                                t('leads.headers.contact'),
                                t('leads.headers.courses'),
                                t('leads.headers.enrolledOn'),
                                t('leads.headers.campaign'),
                                sourceLabel,
                                ...feeCsvHeaders(tc),
                            ],
                            rows: students.map((s) => [
                                s.lead_name,
                                s.contact,
                                s.courses.join(', '),
                                fmtDay(s.enrolled_at),
                                s.campaign,
                                s.source,
                                ...feeCsvValues(s.fee),
                            ]),
                        })}
                    />
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('leads.close')}
                        title={t('leads.close')}
                        className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                    >
                        <X size={16} />
                    </button>
                </div>
            }
        >
            {query.isLoading ? (
                <div className="py-8 text-center text-sm text-neutral-400">
                    {t('leads.loading')}
                </div>
            ) : query.isError ? (
                <ReportErrorState error={query.error} onRetry={() => query.refetch()} />
            ) : students.length === 0 ? (
                <EmptyHint message={t('leads.empty', { name: counsellor.name })} />
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="whitespace-nowrap border-b border-neutral-200 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600">
                                <th className="py-3 pr-3">#</th>
                                <th className="py-3 pr-3">{t('leads.headers.lead')}</th>
                                <th className="py-3 pr-3">{t('leads.headers.courses')}</th>
                                <th className="py-3 pr-3">{t('leads.headers.enrolledOn')}</th>
                                <th className="py-3 pr-3">{t('leads.headers.campaign')}</th>
                                <th className="py-3 pr-3">{sourceLabel}</th>
                                <th className="py-3 pr-3 text-right">{tc('column.fee')}</th>
                                <th className="py-3 pr-3 text-right">{tc('column.paid')}</th>
                                <th className="py-3 pr-3 text-right">
                                    {tc('column.installments')}
                                </th>
                                <th className="py-3 pr-3 text-right">
                                    {tc('column.nextInstallment')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {students.map((s, i) => (
                                <tr
                                    key={s.user_id}
                                    className="border-b border-neutral-100 last:border-0"
                                >
                                    <td className="py-3 pr-3 text-neutral-500">{i + 1}</td>
                                    <td className="min-w-48 py-3 pr-3">
                                        <ReportLeadName
                                            lead={{
                                                userId: s.user_id,
                                                name: s.lead_name,
                                                phone: s.phone,
                                                email: s.email,
                                            }}
                                            contact={s.contact}
                                        />
                                    </td>
                                    <td className="min-w-56 py-3 pr-3 text-neutral-800">
                                        {s.courses.length ? s.courses.join(', ') : '—'}
                                    </td>
                                    <td className="whitespace-nowrap py-3 pr-3 text-neutral-800">
                                        {fmtDay(s.enrolled_at)}
                                    </td>
                                    <td className="py-3 pr-3 text-neutral-800">
                                        {s.campaign ?? '—'}
                                    </td>
                                    <td className="py-3 pr-3 text-neutral-800">
                                        {s.source ?? '—'}
                                    </td>
                                    <td className="whitespace-nowrap py-3 pr-3 text-right">
                                        <FeeCell fee={s.fee} currency={currency} />
                                    </td>
                                    <td className="whitespace-nowrap py-3 pr-3 text-right">
                                        <PaidCell fee={s.fee} currency={currency} />
                                    </td>
                                    <td className="py-3 pr-3 text-right">
                                        <InstallmentsCell fee={s.fee} />
                                    </td>
                                    <td className="py-3 pr-3 text-right">
                                        <NextInstallmentCell fee={s.fee} currency={currency} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </ReportSection>
    );
}

// ── Sortable counsellor performance table ──────────────────────────────

type SortKey =
    | 'counselor_name'
    | 'leads_assigned'
    | 'leads_responded'
    | 'conversions'
    | 'conversion_rate'
    | 'avg_response_minutes'
    | 'tat_met_rate'
    | 'open_leads'
    | 'overdue_leads';

interface CounsellorTableProps {
    performance: CounselorPerformance | undefined;
    loading: boolean;
    /** The counsellor whose converted leads are open below the table. */
    selectedId?: string | null;
    /** Row click opens that counsellor's converted leads below the table. */
    onRowClick?: (counselorId: string, name: string) => void;
}
function CounsellorTable({ performance, loading, selectedId, onRowClick }: CounsellorTableProps) {
    const { t } = useTranslation('audienceManagerCounsellorsTab');
    const [sortKey, setSortKey] = useState<SortKey>('leads_assigned');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const sortedRows: CounselorRow[] = useMemo(() => {
        if (!performance) return [];
        const rows = [...performance.rows];
        rows.sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            // Nulls sink to the bottom regardless of direction.
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === 'number' && typeof bv === 'number') {
                return sortDir === 'asc' ? av - bv : bv - av;
            }
            const s = String(av).localeCompare(String(bv));
            return sortDir === 'asc' ? s : -s;
        });
        return rows;
    }, [performance, sortKey, sortDir]);

    // Top performer = highest conversions (then highest conv. rate); only highlighted when ≥ 2 rows.
    const topRow = useMemo(() => {
        if (!performance || performance.rows.length < 2) return null;
        return [...performance.rows].sort((a, b) => {
            if (b.conversions !== a.conversions) return b.conversions - a.conversions;
            return (b.conversion_rate ?? 0) - (a.conversion_rate ?? 0);
        })[0];
    }, [performance]);

    if (loading) {
        return (
            <div className="py-8 text-center text-sm text-neutral-400">{t('table.loading')}</div>
        );
    }
    if (!performance || performance.rows.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-neutral-400">
                <Users size={28} />
                {t('table.empty')}
            </div>
        );
    }

    const toggleSort = (k: SortKey) => {
        if (sortKey === k) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(k);
            setSortDir(k === 'counselor_name' ? 'asc' : 'desc');
        }
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="whitespace-nowrap border-b border-neutral-200 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600">
                        <SortableHeader
                            label={t('table.headers.counsellor')}
                            sortKey="counselor_name"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                            align="left"
                        />
                        <SortableHeader
                            label={t('table.headers.assigned')}
                            sortKey="leads_assigned"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.responded')}
                            sortKey="leads_responded"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.conversions')}
                            sortKey="conversions"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.convRate')}
                            sortKey="conversion_rate"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.avgResponse')}
                            sortKey="avg_response_minutes"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.tatMet')}
                            sortKey="tat_met_rate"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.open')}
                            sortKey="open_leads"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.overdue')}
                            sortKey="overdue_leads"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                    </tr>
                </thead>
                <tbody>
                    {sortedRows.map((r) => {
                        const isSelected = selectedId === r.counselor_id;
                        const isTop =
                            topRow != null &&
                            r.counselor_id === topRow.counselor_id &&
                            r.conversions > 0;
                        return (
                            <tr
                                key={r.counselor_id}
                                className={cn(
                                    'group border-b border-neutral-100 last:border-0 hover:bg-neutral-50',
                                    isTop && 'bg-amber-50/40',
                                    isSelected && 'bg-primary-50 hover:bg-primary-50',
                                    onRowClick && 'cursor-pointer'
                                )}
                                title={onRowClick ? t('table.rowHint') : undefined}
                                onClick={
                                    onRowClick
                                        ? () => onRowClick(r.counselor_id, r.counselor_name)
                                        : undefined
                                }
                            >
                                <td className="py-3 pr-3">
                                    <div className="flex items-center gap-2">
                                        <div
                                            className={cn(
                                                'flex size-8 items-center justify-center rounded-full text-xs font-semibold',
                                                avatarPalette(r.counselor_name)
                                            )}
                                        >
                                            {(r.counselor_name || '?').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="flex items-center gap-1 font-medium text-neutral-900">
                                                {r.counselor_name}
                                                {onRowClick && (
                                                    <CaretDown
                                                        size={12}
                                                        className={cn(
                                                            'text-neutral-300 transition-transform group-hover:text-neutral-500',
                                                            isSelected &&
                                                                'rotate-180 text-primary-500'
                                                        )}
                                                    />
                                                )}
                                            </span>
                                            {isTop && (
                                                <span className="flex items-center gap-1 text-xs text-amber-700">
                                                    <Trophy size={11} weight="fill" />
                                                    {t('table.topPerformer')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </td>
                                <td className="py-3 pr-3 text-right text-neutral-800">
                                    {r.leads_assigned}
                                </td>
                                <td className="py-3 pr-3 text-right text-neutral-800">
                                    {r.leads_responded}
                                </td>
                                <td className="py-3 pr-3 text-right text-neutral-800">
                                    {r.conversions}
                                </td>
                                <td
                                    className={cn(
                                        'py-3 pr-3 text-right',
                                        convRateClass(r.conversion_rate)
                                    )}
                                >
                                    {fmtPct(r.conversion_rate)}
                                </td>
                                <td className="py-3 pr-3 text-right text-neutral-800">
                                    {fmtMinutes(r.avg_response_minutes)}
                                </td>
                                <td
                                    className={cn(
                                        'py-3 pr-3 text-right',
                                        tatMetClass(r.tat_met_rate)
                                    )}
                                >
                                    {fmtPct(r.tat_met_rate)}
                                </td>
                                <td className="py-3 pr-3 text-right text-neutral-800">
                                    {r.open_leads}
                                </td>
                                <td className="py-3 pr-3 text-right">
                                    {r.overdue_leads > 0 ? (
                                        <span className="inline-flex items-center gap-1 font-medium text-red-600">
                                            <WarningCircle size={12} weight="fill" />
                                            {r.overdue_leads}
                                        </span>
                                    ) : (
                                        <span className="text-neutral-400">0</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
