/**
 * Reports Center — Conversions tab.
 *
 * Leads converted in the window (GET /v1/reports/conversions): a conversion is a lead's enrolment
 * into a course whose "count enrolment as conversion" setting is on, dated by the enrolment. KPI
 * strip, a per-counsellor summary, and the lead-level rows behind it. Clicking a counsellor narrows
 * the lead list to their leads; both tables export to CSV.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { GraduationCap, ListBullets, UserCheck, Users, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import {
    conversionsQueryKey,
    fetchConversions,
    type ConversionCounsellorRow,
    type ConversionLeadRow,
} from '../-services/get-conversion-reports';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    KpiCard,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    SortableHeader,
    fmtNumber,
    fmtPct,
    type ReportTabProps,
    fmtDateTime,
} from './report-shared';
import {
    FeeCell,
    InstallmentsCell,
    NextInstallmentCell,
    PaidCell,
    feeCsvHeaders,
    feeCsvValues,
} from './conversion-fee-cells';

type CounsellorSortKey = 'name' | 'converted_leads' | 'enrolments';
type LeadSortKey =
    | 'lead_name'
    | 'course_name'
    | 'enrolled_at'
    | 'counsellor_name'
    | 'campaign_name'
    | 'source_type'
    | 'fee'
    | 'paid'
    | 'next_due_date';

/** Local key for the "no counsellor" row — user_id is null there. */
const UNASSIGNED = '__unassigned__';
const PAGE_SIZE = 100;

const counsellorKey = (userId: string | null) => userId ?? UNASSIGNED;
export function ConversionsTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerConversionsTab');
    // What the institute calls the campaign type (I2CAN: "Source") — set in Lead Settings.
    const { campaignType: sourceLabel } = useLeadTerminology();
    const params = { instituteId, fromDate, toDate, teamId, counsellorUserId };
    const query = useQuery({
        queryKey: conversionsQueryKey(params),
        queryFn: () => fetchConversions(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    const [cslSort, setCslSort] = useState<CounsellorSortKey>('converted_leads');
    const [cslDir, setCslDir] = useState<'asc' | 'desc'>('desc');
    const [leadSort, setLeadSort] = useState<LeadSortKey>('enrolled_at');
    const [leadDir, setLeadDir] = useState<'asc' | 'desc'>('desc');
    const [selected, setSelected] = useState<string | null>(null);
    const [visible, setVisible] = useState(PAGE_SIZE);
    const leadsRef = useRef<HTMLDivElement>(null);

    const unassignedLabel = t('unassigned');

    const counsellors = useMemo(
        () =>
            sortRows(
                (query.data?.by_counsellor ?? []).map(
                    (r): ConversionCounsellorRow & { name: string } => ({
                        ...r,
                        name: r.user_id == null ? unassignedLabel : r.name ?? r.user_id,
                    })
                ),
                cslSort,
                cslDir
            ),
        [query.data, cslSort, cslDir, unassignedLabel]
    );
    const leads = useMemo(() => {
        const all = query.data?.leads ?? [];
        const filtered =
            selected == null ? all : all.filter((r) => counsellorKey(r.counsellor_id) === selected);
        return sortRows(filtered, leadSort, leadDir);
    }, [query.data, selected, leadSort, leadDir]);

    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError)
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;

    const totals = query.data?.totals ?? { converted_leads: 0, enrolments: 0 };
    const truncated = query.data?.leads_truncated ?? false;
    const currency = query.data?.currency ?? 'INR';
    const credited = counsellors.filter((r) => r.user_id != null).length;
    const selectedRow = counsellors.find((r) => counsellorKey(r.user_id) === selected);

    const toggleCsl = (k: CounsellorSortKey) => {
        if (cslSort === k) setCslDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setCslSort(k);
            setCslDir(k === 'name' ? 'asc' : 'desc');
        }
    };
    const toggleLead = (k: LeadSortKey) => {
        if (leadSort === k) setLeadDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setLeadSort(k);
            setLeadDir(k === 'enrolled_at' || k === 'fee' || k === 'paid' ? 'desc' : 'asc');
        }
    };
    const selectCounsellor = (key: string) => {
        const selecting = selected !== key;
        setSelected(selecting ? key : null);
        setVisible(PAGE_SIZE);
        // Picking a counsellor filters the lead list below — take the admin straight to it.
        if (selecting)
            requestAnimationFrame(() =>
                leadsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            );
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <KpiCard
                    label={t('column.convertedLeads')}
                    value={fmtNumber(totals.converted_leads)}
                    icon={<UserCheck size={18} />}
                    tone="success"
                    sub={t('kpi.convertedSub')}
                />
                <KpiCard
                    label={t('column.enrolments')}
                    value={fmtNumber(totals.enrolments)}
                    icon={<GraduationCap size={18} />}
                    tone="primary"
                    sub={t('kpi.enrolmentsSub')}
                />
                <KpiCard
                    label={t('kpi.counsellors')}
                    value={fmtNumber(credited)}
                    icon={<Users size={18} />}
                    tone="info"
                />
            </div>

            <ReportSection
                title={t('byCounsellor.title')}
                icon={<Users size={18} />}
                actions={
                    <ExportWithColumnPickerButton
                        filename={`conversions-by-counsellor_${fromDate}_${toDate}.csv`}
                        disabled={counsellors.length === 0}
                        getHeadersAndRows={() => ({
                            headers: [
                                t('column.counsellor'),
                                t('column.convertedLeads'),
                                t('column.enrolments'),
                                t('column.share'),
                            ],
                            rows: counsellors.map((r) => [
                                r.name,
                                r.converted_leads,
                                r.enrolments,
                                share(r.converted_leads, totals.converted_leads),
                            ]),
                        })}
                    />
                }
            >
                {counsellors.length === 0 ? (
                    <EmptyHint message={t('empty.noConversions')} />
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
                                        label={t('column.convertedLeads')}
                                        sortKey="converted_leads"
                                        current={cslSort}
                                        dir={cslDir}
                                        onClick={toggleCsl}
                                    />
                                    <SortableHeader
                                        label={t('column.enrolments')}
                                        sortKey="enrolments"
                                        current={cslSort}
                                        dir={cslDir}
                                        onClick={toggleCsl}
                                    />
                                    <th className="py-2 pr-3 text-right">{t('column.share')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {counsellors.map((r) => {
                                    const key = counsellorKey(r.user_id);
                                    return (
                                        <tr
                                            key={key}
                                            onClick={() => selectCounsellor(key)}
                                            title={t('byCounsellor.rowHint')}
                                            className={cn(
                                                'cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50',
                                                selected === key && 'bg-primary-50 hover:bg-primary-50'
                                            )}
                                        >
                                            <td
                                                className={cn(
                                                    'py-3 pr-3 font-medium',
                                                    r.user_id == null
                                                        ? 'italic text-neutral-500'
                                                        : 'text-neutral-900'
                                                )}
                                            >
                                                {r.name}
                                            </td>
                                            <td className="py-3 pr-3 text-right font-semibold text-green-700">
                                                {fmtNumber(r.converted_leads)}
                                            </td>
                                            <td className="py-3 pr-3 text-right text-neutral-800">
                                                {fmtNumber(r.enrolments)}
                                            </td>
                                            <td className="py-3 pr-3 text-right text-neutral-800">
                                                {fmtPct(share(r.converted_leads, totals.converted_leads))}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </ReportSection>

            <div ref={leadsRef} className="scroll-mt-4">
                <ReportSection
                    title={t('leads.title')}
                    icon={<ListBullets size={18} />}
                    actions={
                        <ExportWithColumnPickerButton
                            filename={`converted-leads_${fromDate}_${toDate}.csv`}
                            disabled={leads.length === 0}
                            getHeadersAndRows={() => ({
                                headers: [
                                    t('column.lead'),
                                    t('column.phone'),
                                    t('column.email'),
                                    t('column.course'),
                                    t('column.enrolledAt'),
                                    t('column.enrolmentStatus'),
                                    t('column.counsellor'),
                                    t('column.campaign'),
                                    sourceLabel,
                                    ...feeCsvHeaders(t),
                                ],
                                rows: leads.map((r) => [
                                    r.lead_name ?? r.user_id,
                                    r.phone,
                                    r.email,
                                    r.course_name,
                                    fmtDateTime(r.enrolled_at),
                                    r.enrolment_status,
                                    r.counsellor_id == null ? unassignedLabel : r.counsellor_name,
                                    r.campaign_name,
                                    r.source_type,
                                    ...feeCsvValues(r),
                                ]),
                            })}
                        />
                    }
                >
                    {selectedRow && (
                        <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                                {t('leads.filteredBy', { name: selectedRow.name })}
                                <button
                                    type="button"
                                    onClick={() => setSelected(null)}
                                    aria-label={t('leads.clearFilter')}
                                    className="rounded-full hover:bg-primary-100"
                                >
                                    <X size={11} weight="bold" />
                                </button>
                            </span>
                        </div>
                    )}
                    {truncated && (
                        <p className="text-xs text-amber-700">{t('leads.truncated', { count: 5000 })}</p>
                    )}
                    {leads.length === 0 ? (
                        <EmptyHint message={t('empty.noConversions')} />
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-200 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600 whitespace-nowrap">
                                            <SortableHeader
                                                label={t('column.lead')}
                                                sortKey="lead_name"
                                                current={leadSort}
                                                dir={leadDir}
                                                onClick={toggleLead}
                                                align="left"
                                            />
                                            <SortableHeader
                                                label={t('column.course')}
                                                sortKey="course_name"
                                                current={leadSort}
                                                dir={leadDir}
                                                onClick={toggleLead}
                                                align="left"
                                            />
                                            <SortableHeader
                                                label={t('column.enrolledAt')}
                                                sortKey="enrolled_at"
                                                current={leadSort}
                                                dir={leadDir}
                                                onClick={toggleLead}
                                                align="left"
                                            />
                                            <SortableHeader
                                                label={t('column.counsellor')}
                                                sortKey="counsellor_name"
                                                current={leadSort}
                                                dir={leadDir}
                                                onClick={toggleLead}
                                                align="left"
                                            />
                                            <SortableHeader
                                                label={t('column.campaign')}
                                                sortKey="campaign_name"
                                                current={leadSort}
                                                dir={leadDir}
                                                onClick={toggleLead}
                                                align="left"
                                            />
                                            <SortableHeader
                                                label={sourceLabel}
                                                sortKey="source_type"
                                                current={leadSort}
                                                dir={leadDir}
                                                onClick={toggleLead}
                                                align="left"
                                            />
                                            <SortableHeader
                                                label={t('column.fee')}
                                                sortKey="fee"
                                                current={leadSort}
                                                dir={leadDir}
                                                onClick={toggleLead}
                                            />
                                            <SortableHeader
                                                label={t('column.paid')}
                                                sortKey="paid"
                                                current={leadSort}
                                                dir={leadDir}
                                                onClick={toggleLead}
                                            />
                                            <th className="py-2 pr-3 text-right">
                                                {t('column.installments')}
                                            </th>
                                            <SortableHeader
                                                label={t('column.nextInstallment')}
                                                sortKey="next_due_date"
                                                current={leadSort}
                                                dir={leadDir}
                                                onClick={toggleLead}
                                            />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {leads.slice(0, visible).map((r: ConversionLeadRow) => (
                                            <tr
                                                key={r.enrolment_id}
                                                className="border-b border-neutral-100 align-top last:border-0 hover:bg-neutral-50"
                                            >
                                                <td className="min-w-48 py-3 pr-3">
                                                    <div className="font-medium text-neutral-900">
                                                        {r.lead_name ?? r.user_id}
                                                    </div>
                                                    {(r.phone || r.email) && (
                                                        <div className="text-xs text-neutral-500">
                                                            {r.phone ?? r.email}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="min-w-56 py-3 pr-3 text-neutral-800">
                                                    {r.course_name ?? '—'}
                                                </td>
                                                <td className="whitespace-nowrap py-3 pr-3 text-neutral-800">
                                                    {fmtDateTime(r.enrolled_at)}
                                                </td>
                                                <td
                                                    className={cn(
                                                        'whitespace-nowrap py-3 pr-3',
                                                        r.counsellor_id == null
                                                            ? 'italic text-neutral-500'
                                                            : 'text-neutral-800'
                                                    )}
                                                >
                                                    {r.counsellor_id == null
                                                        ? unassignedLabel
                                                        : r.counsellor_name ?? r.counsellor_id}
                                                </td>
                                                <td className="py-3 pr-3 text-neutral-800">
                                                    {r.campaign_name ?? '—'}
                                                </td>
                                                <td className="py-3 pr-3 text-neutral-800">
                                                    {r.source_type ?? '—'}
                                                </td>
                                                <td className="whitespace-nowrap py-3 pr-3 text-right">
                                                    <FeeCell fee={r} currency={currency} />
                                                </td>
                                                <td className="whitespace-nowrap py-3 pr-3 text-right">
                                                    <PaidCell fee={r} currency={currency} />
                                                </td>
                                                <td className="py-3 pr-3 text-right">
                                                    <InstallmentsCell fee={r} />
                                                </td>
                                                <td className="py-3 pr-3 text-right">
                                                    <NextInstallmentCell fee={r} currency={currency} />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {leads.length > visible && (
                                <button
                                    type="button"
                                    onClick={() => setVisible((v) => v + PAGE_SIZE)}
                                    className="self-center rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                                >
                                    {t('leads.showMore', { shown: visible, total: leads.length })}
                                </button>
                            )}
                        </>
                    )}
                    <p className="text-xs text-neutral-400">{t('leads.footnote')}</p>
                </ReportSection>
            </div>
        </div>
    );
}

function share(part: number, total: number): number | null {
    return total > 0 ? Math.round((part * 1000) / total) / 10 : null;
}

/** Generic null-aware sort shared by both tables. */
function sortRows<T, K extends keyof T>(rows: T[], key: K, dir: 'asc' | 'desc'): T[] {
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
