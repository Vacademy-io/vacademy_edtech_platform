/**
 * Reports Center — Admissions tab.
 *
 * Students enrolled in the range and the fee they booked (GET /v1/reports/admissions): KPI strip,
 * a month table, and breakdowns by source, course group (course tag), course, counsellor and the
 * custom field picked in Settings → Reports (e.g. Branch). Source / counsellor / field tables also
 * split admissions by course group, the way a front-office admission register is read.
 */
import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    BookOpen,
    CalendarBlank,
    CurrencyCircleDollar,
    GraduationCap,
    MapPin,
    Megaphone,
    Percent,
    Receipt,
    Tag,
    Users,
    Wallet,
} from '@phosphor-icons/react';
import {
    admissionsQueryKey,
    fetchAdmissions,
    type AdmissionRow,
} from '../-services/get-admission-reports';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    KpiCard,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    fmtCurrency,
    fmtNumber,
    fmtPct,
    type ReportTabProps,
} from './report-shared';

/** Source of a student with no enquiry (see the backend's ReportSourceSql). */
const UNKNOWN_SOURCE = 'UNKNOWN';

export function AdmissionsTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
}: ReportTabProps) {
    const { t, i18n } = useTranslation('audienceManagerAdmissionsTab');
    const params = { instituteId, fromDate, toDate, teamId, counsellorUserId };
    const query = useQuery({
        queryKey: admissionsQueryKey(params),
        queryFn: () => fetchAdmissions(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    const monthLabel = useMemo(() => {
        const fmt = new Intl.DateTimeFormat(i18n.language, { month: 'short', year: 'numeric' });
        return (key: string) => {
            const d = new Date(`${key}-01T00:00:00`);
            return Number.isNaN(d.getTime()) ? key : fmt.format(d);
        };
    }, [i18n.language]);

    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError)
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;

    const data = query.data;
    const currency = data?.currency ?? 'INR';
    const totals = data?.totals ?? null;
    const tags = data?.course_tags ?? [];
    const totalAdmissions = totals?.admissions ?? 0;
    const tagLabel = (tag: string) => (tag ? tag : t('labels.noTag'));
    const collected =
        totals && totals.fees > 0 ? Math.round((totals.paid / totals.fees) * 1000) / 10 : null;

    if (!totals || totalAdmissions === 0) {
        return (
            <ReportSection title={t('title')} icon={<GraduationCap size={18} />}>
                <EmptyHint message={t('empty')} />
            </ReportSection>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard
                    label={t('column.admissions')}
                    value={fmtNumber(totals.admissions)}
                    icon={<GraduationCap size={18} />}
                    tone="primary"
                    sub={
                        data && data.multi_course_admissions > 0
                            ? t('kpi.multiCourse', { count: data.multi_course_admissions })
                            : undefined
                    }
                />
                <KpiCard
                    label={t('column.fees')}
                    value={fmtCurrency(totals.fees, currency)}
                    icon={<Wallet size={18} />}
                    tone="info"
                    sub={t('kpi.feesSub')}
                />
                <KpiCard
                    label={t('column.paid')}
                    value={fmtCurrency(totals.paid, currency)}
                    icon={<CurrencyCircleDollar size={18} />}
                    tone="success"
                />
                <KpiCard
                    label={t('column.due')}
                    value={fmtCurrency(totals.due, currency)}
                    icon={<Receipt size={18} />}
                    tone={totals.due > 0 ? 'warning' : 'default'}
                />
                <KpiCard
                    label={t('kpi.collected')}
                    value={fmtPct(collected)}
                    icon={<Percent size={18} />}
                    tone={collected == null ? 'default' : collected >= 80 ? 'success' : 'warning'}
                    sub={t('kpi.collectedSub')}
                />
                <KpiCard
                    label={t('kpi.avgFee')}
                    value={fmtCurrency(totals.fees / totals.admissions, currency)}
                    icon={<Tag size={18} />}
                />
            </div>

            {(data?.by_month.length ?? 0) > 1 && (
                <BreakdownTable
                    title={t('sections.byMonth')}
                    icon={<CalendarBlank size={18} />}
                    rows={data?.by_month ?? []}
                    nameHeader={t('column.month')}
                    nameOf={(r) => monthLabel(r.key)}
                    tags={tags}
                    tagLabel={tagLabel}
                    showTags
                    total={totalAdmissions}
                    currency={currency}
                    csvName={`admissions-by-month_${fromDate}_${toDate}.csv`}
                />
            )}

            <BreakdownTable
                title={t('sections.bySource')}
                icon={<Megaphone size={18} />}
                rows={data?.by_source ?? []}
                nameHeader={t('column.source')}
                nameOf={(r) => (r.key === UNKNOWN_SOURCE ? t('labels.noEnquiry') : r.key)}
                tags={tags}
                tagLabel={tagLabel}
                showTags
                total={totalAdmissions}
                currency={currency}
                csvName={`admissions-by-source_${fromDate}_${toDate}.csv`}
            />

            <BreakdownTable
                title={t('sections.byCourseTag')}
                icon={<Tag size={18} />}
                rows={data?.by_course_tag ?? []}
                nameHeader={t('column.courseTag')}
                nameOf={(r) => tagLabel(r.key)}
                tags={tags}
                tagLabel={tagLabel}
                total={totalAdmissions}
                currency={currency}
                csvName={`admissions-by-course-group_${fromDate}_${toDate}.csv`}
                footnote={t('footnotes.mainCourse')}
            />

            <BreakdownTable
                title={t('sections.byCourse')}
                icon={<BookOpen size={18} />}
                rows={data?.by_course ?? []}
                nameHeader={t('column.course')}
                nameOf={(r) => r.label ?? r.key}
                extraColumn={{
                    header: t('column.courseTag'),
                    value: (r) => tagLabel(r.course_tag ?? ''),
                }}
                tags={tags}
                tagLabel={tagLabel}
                total={totalAdmissions}
                currency={currency}
                csvName={`admissions-by-course_${fromDate}_${toDate}.csv`}
            />

            <BreakdownTable
                title={t('sections.byCounsellor')}
                icon={<Users size={18} />}
                rows={data?.by_counsellor ?? []}
                nameHeader={t('column.counsellor')}
                nameOf={(r) => (r.key ? r.label ?? r.key : t('labels.unassigned'))}
                tags={tags}
                tagLabel={tagLabel}
                showTags
                total={totalAdmissions}
                currency={currency}
                csvName={`admissions-by-counsellor_${fromDate}_${toDate}.csv`}
            />

            {data?.field_name ? (
                <BreakdownTable
                    title={t('sections.byField', { field: data.field_name })}
                    icon={<MapPin size={18} />}
                    rows={data.by_field}
                    nameHeader={data.field_name}
                    nameOf={(r) => (r.key ? r.key : t('labels.notSet'))}
                    tags={tags}
                    tagLabel={tagLabel}
                    showTags
                    total={totalAdmissions}
                    currency={currency}
                    csvName={`admissions-by-field_${fromDate}_${toDate}.csv`}
                />
            ) : (
                <ReportSection title={t('sections.byFieldUnset')} icon={<MapPin size={18} />}>
                    <EmptyHint message={t('footnotes.fieldHint')} />
                </ReportSection>
            )}

            <p className="text-xs text-neutral-400">{t('footnotes.definitions')}</p>
        </div>
    );
}

interface BreakdownTableProps {
    title: string;
    icon: ReactNode;
    rows: AdmissionRow[];
    nameHeader: string;
    nameOf: (row: AdmissionRow) => string;
    /** One more text column after the name (e.g. the course's group). */
    extraColumn?: { header: string; value: (row: AdmissionRow) => string };
    tags: string[];
    tagLabel: (tag: string) => string;
    /** Split admissions by course group. */
    showTags?: boolean;
    total: number;
    currency: string;
    csvName: string;
    footnote?: string;
}

/** Name · [course groups] · admissions · share · fees · paid · due, with a total row. */
function BreakdownTable({
    title,
    icon,
    rows,
    nameHeader,
    nameOf,
    extraColumn,
    tags,
    tagLabel,
    showTags,
    total,
    currency,
    csvName,
    footnote,
}: BreakdownTableProps) {
    const { t } = useTranslation('audienceManagerAdmissionsTab');
    const share = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : null);
    const sum = (pick: (r: AdmissionRow) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
    const tagCols = showTags ? tags : [];

    return (
        <ReportSection
            title={title}
            icon={icon}
            actions={
                <ExportWithColumnPickerButton
                    filename={csvName}
                    disabled={rows.length === 0}
                    getHeadersAndRows={() => ({
                        headers: [
                            nameHeader,
                            ...(extraColumn ? [extraColumn.header] : []),
                            ...tagCols.map(tagLabel),
                            t('column.admissions'),
                            t('column.share'),
                            t('column.fees'),
                            t('column.paid'),
                            t('column.due'),
                        ],
                        rows: rows.map((r) => [
                            nameOf(r),
                            ...(extraColumn ? [extraColumn.value(r)] : []),
                            ...tagCols.map((tag) => r.tag_counts[tag] ?? 0),
                            r.admissions,
                            share(r.admissions),
                            r.fees,
                            r.paid,
                            r.due,
                        ]),
                    })}
                />
            }
        >
            {rows.length === 0 ? (
                <EmptyHint />
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                <th className="py-2 pr-3">{nameHeader}</th>
                                {extraColumn && <th className="py-2 pr-3">{extraColumn.header}</th>}
                                {tagCols.map((tag) => (
                                    <th key={tag} className="py-2 pr-3 text-right">
                                        {tagLabel(tag)}
                                    </th>
                                ))}
                                <th className="py-2 pr-3 text-right">{t('column.admissions')}</th>
                                <th className="py-2 pr-3 text-right">{t('column.share')}</th>
                                <th className="py-2 pr-3 text-right">{t('column.fees')}</th>
                                <th className="py-2 pr-3 text-right">{t('column.paid')}</th>
                                <th className="py-2 pr-3 text-right">{t('column.due')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr
                                    key={r.key}
                                    className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                >
                                    <td className="py-2.5 pr-3 font-medium text-neutral-900">
                                        {nameOf(r)}
                                    </td>
                                    {extraColumn && (
                                        <td className="py-2.5 pr-3 text-neutral-600">
                                            {extraColumn.value(r)}
                                        </td>
                                    )}
                                    {tagCols.map((tag) => (
                                        <td
                                            key={tag}
                                            className="py-2.5 pr-3 text-right text-neutral-700"
                                        >
                                            {fmtNumber(r.tag_counts[tag] ?? 0)}
                                        </td>
                                    ))}
                                    <td className="py-2.5 pr-3 text-right font-semibold text-neutral-900">
                                        {fmtNumber(r.admissions)}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right text-neutral-600">
                                        {fmtPct(share(r.admissions))}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right text-neutral-800">
                                        {fmtCurrency(r.fees, currency)}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right text-green-700">
                                        {fmtCurrency(r.paid, currency)}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right text-warning-700">
                                        {fmtCurrency(r.due, currency)}
                                    </td>
                                </tr>
                            ))}
                            <tr className="border-t border-neutral-200 font-semibold text-neutral-900">
                                <td className="py-2.5 pr-3">{t('column.total')}</td>
                                {extraColumn && <td className="py-2.5 pr-3" />}
                                {tagCols.map((tag) => (
                                    <td key={tag} className="py-2.5 pr-3 text-right">
                                        {fmtNumber(sum((r) => r.tag_counts[tag] ?? 0))}
                                    </td>
                                ))}
                                <td className="py-2.5 pr-3 text-right">
                                    {fmtNumber(sum((r) => r.admissions))}
                                </td>
                                <td className="py-2.5 pr-3 text-right">
                                    {fmtPct(share(sum((r) => r.admissions)))}
                                </td>
                                <td className="py-2.5 pr-3 text-right">
                                    {fmtCurrency(
                                        sum((r) => r.fees),
                                        currency
                                    )}
                                </td>
                                <td className="py-2.5 pr-3 text-right">
                                    {fmtCurrency(
                                        sum((r) => r.paid),
                                        currency
                                    )}
                                </td>
                                <td className="py-2.5 pr-3 text-right">
                                    {fmtCurrency(
                                        sum((r) => r.due),
                                        currency
                                    )}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}
            {footnote && <p className="text-xs text-neutral-400">{footnote}</p>}
        </ReportSection>
    );
}
