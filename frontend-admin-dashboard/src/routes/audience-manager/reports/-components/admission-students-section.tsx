/**
 * Reports Center — Admissions tab, student list.
 *
 * The students behind the Admissions report (GET /v1/reports/admissions/students): one row per
 * admission — a student x the month they enrolled, a course package being one row with all its
 * courses — with fee, paid and due. Built from the same rows as the report, so it adds up to the
 * KPIs above. Loaded only when opened: it fetches every student's name and contact.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { IdentificationCard } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    admissionStudentsQueryKey,
    fetchAdmissionStudents,
    type AdmissionStudentRow,
} from '../-services/get-admission-reports';
import { ReportLeadName } from './report-lead-name';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    ReportErrorState,
    ReportSection,
    SortableHeader,
    fmtCurrency,
    fmtDay,
    fmtNumber,
} from './report-shared';

/** Source of a student with no enquiry (see the backend's ReportSourceSql). */
const UNKNOWN_SOURCE = 'UNKNOWN';
const PAGE_SIZE = 100;

type SortKey = 'name' | 'admission_date' | 'courses' | 'counsellor_name' | 'fees' | 'paid' | 'due';

interface AdmissionStudentsSectionProps {
    instituteId: string;
    fromDate?: string;
    toDate?: string;
    teamId?: string;
    counsellorUserId?: string;
}

export function AdmissionStudentsSection({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
}: AdmissionStudentsSectionProps) {
    const { t } = useTranslation('audienceManagerAdmissionsTab');
    const params = { instituteId, fromDate, toDate, teamId, counsellorUserId };
    const [open, setOpen] = useState(false);
    const [visible, setVisible] = useState(PAGE_SIZE);
    const [sort, setSort] = useState<SortKey>('admission_date');
    const [dir, setDir] = useState<'asc' | 'desc'>('desc');

    const query = useQuery({
        queryKey: admissionStudentsQueryKey(params),
        queryFn: () => fetchAdmissionStudents(params),
        enabled: open && !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    const rows = useMemo(
        () => sortStudents(query.data?.rows ?? [], sort, dir),
        [query.data, sort, dir]
    );
    const currency = query.data?.currency ?? 'INR';
    const fieldName = query.data?.field_name ?? null;
    const sourceOf = (r: AdmissionStudentRow) =>
        r.source === UNKNOWN_SOURCE ? t('labels.noEnquiry') : r.source ?? '—';
    const counsellorOf = (r: AdmissionStudentRow) =>
        r.counsellor_id == null ? t('labels.unassigned') : r.counsellor_name ?? r.counsellor_id;

    const toggle = (k: SortKey) => {
        if (sort === k) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setSort(k);
            setDir(k === 'name' || k === 'courses' || k === 'counsellor_name' ? 'asc' : 'desc');
        }
    };

    return (
        <ReportSection
            title={t('students.title')}
            icon={<IdentificationCard size={18} />}
            actions={
                query.isSuccess ? (
                    <ExportWithColumnPickerButton
                        filename={`admissions-students_${fromDate}_${toDate}.csv`}
                        disabled={rows.length === 0}
                        getHeadersAndRows={() => ({
                            headers: [
                                t('students.column.student'),
                                t('students.column.phone'),
                                t('students.column.email'),
                                t('students.column.admissionDate'),
                                t('column.month'),
                                t('students.column.courses'),
                                t('students.column.courseCount'),
                                t('students.column.mainCourse'),
                                t('column.courseTag'),
                                t('column.counsellor'),
                                ...(fieldName ? [fieldName] : []),
                                t('column.source'),
                                t('column.fees'),
                                t('column.paid'),
                                t('column.due'),
                            ],
                            rows: rows.map((r) => [
                                r.name ?? r.user_id,
                                r.phone,
                                r.email,
                                fmtDay(r.admission_date),
                                r.month,
                                r.courses,
                                r.course_count,
                                r.main_course,
                                r.course_tag ? r.course_tag : t('labels.noTag'),
                                counsellorOf(r),
                                ...(fieldName ? [r.field_value] : []),
                                sourceOf(r),
                                r.fees,
                                r.paid,
                                r.due,
                            ]),
                        })}
                    />
                ) : undefined
            }
        >
            {!open ? (
                <div className="flex flex-col items-start gap-3">
                    <p className="text-sm text-neutral-600">{t('students.hint')}</p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => setOpen(true)}
                    >
                        {t('students.show')}
                    </MyButton>
                </div>
            ) : query.isLoading ? (
                <div className="flex flex-col gap-2" aria-busy="true">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="h-10 animate-pulse rounded-md bg-neutral-100" />
                    ))}
                </div>
            ) : query.isError ? (
                <ReportErrorState error={query.error} onRetry={() => query.refetch()} />
            ) : rows.length === 0 ? (
                <EmptyHint message={t('empty')} />
            ) : (
                <>
                    {query.data?.truncated && (
                        <p className="text-xs text-warning-700">
                            {t('students.truncated', { count: rows.length })}
                        </p>
                    )}
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="whitespace-nowrap border-b border-neutral-200 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600">
                                    <SortableHeader
                                        label={t('students.column.student')}
                                        sortKey="name"
                                        current={sort}
                                        dir={dir}
                                        onClick={toggle}
                                        align="left"
                                    />
                                    <SortableHeader
                                        label={t('students.column.admissionDate')}
                                        sortKey="admission_date"
                                        current={sort}
                                        dir={dir}
                                        onClick={toggle}
                                        align="left"
                                    />
                                    <SortableHeader
                                        label={t('students.column.courses')}
                                        sortKey="courses"
                                        current={sort}
                                        dir={dir}
                                        onClick={toggle}
                                        align="left"
                                    />
                                    <SortableHeader
                                        label={t('column.counsellor')}
                                        sortKey="counsellor_name"
                                        current={sort}
                                        dir={dir}
                                        onClick={toggle}
                                        align="left"
                                    />
                                    {fieldName && <th className="py-2 pr-3">{fieldName}</th>}
                                    <th className="py-2 pr-3">{t('column.source')}</th>
                                    <SortableHeader
                                        label={t('column.fees')}
                                        sortKey="fees"
                                        current={sort}
                                        dir={dir}
                                        onClick={toggle}
                                    />
                                    <SortableHeader
                                        label={t('column.paid')}
                                        sortKey="paid"
                                        current={sort}
                                        dir={dir}
                                        onClick={toggle}
                                    />
                                    <SortableHeader
                                        label={t('column.due')}
                                        sortKey="due"
                                        current={sort}
                                        dir={dir}
                                        onClick={toggle}
                                    />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.slice(0, visible).map((r) => (
                                    <tr
                                        key={`${r.user_id}|${r.month}`}
                                        className="border-b border-neutral-100 align-top last:border-0 hover:bg-neutral-50"
                                    >
                                        <td className="min-w-48 py-3 pr-3">
                                            <ReportLeadName
                                                lead={{
                                                    userId: r.user_id,
                                                    name: r.name,
                                                    phone: r.phone,
                                                    email: r.email,
                                                }}
                                                contact={r.phone ?? r.email}
                                            />
                                        </td>
                                        <td className="whitespace-nowrap py-3 pr-3 text-neutral-800">
                                            {fmtDay(r.admission_date)}
                                        </td>
                                        <td className="min-w-56 py-3 pr-3 text-neutral-800">
                                            {r.courses ?? '—'}
                                            {r.course_count > 1 && (
                                                <div className="text-xs text-neutral-500">
                                                    {t('students.courseCount', {
                                                        count: r.course_count,
                                                    })}
                                                </div>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap py-3 pr-3 text-neutral-800">
                                            {counsellorOf(r)}
                                        </td>
                                        {fieldName && (
                                            <td className="py-3 pr-3 text-neutral-800">
                                                {r.field_value ?? '—'}
                                            </td>
                                        )}
                                        <td className="py-3 pr-3 text-neutral-800">
                                            {sourceOf(r)}
                                        </td>
                                        <td className="whitespace-nowrap py-3 pr-3 text-right text-neutral-800">
                                            {fmtCurrency(r.fees, currency)}
                                        </td>
                                        <td className="whitespace-nowrap py-3 pr-3 text-right text-success-700">
                                            {fmtCurrency(r.paid, currency)}
                                        </td>
                                        <td className="whitespace-nowrap py-3 pr-3 text-right text-warning-700">
                                            {fmtCurrency(r.due, currency)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {rows.length > visible && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            className="self-center"
                            onClick={() => setVisible((v) => v + PAGE_SIZE)}
                        >
                            {t('students.showMore', {
                                shown: fmtNumber(visible),
                                total: fmtNumber(rows.length),
                            })}
                        </MyButton>
                    )}
                </>
            )}
        </ReportSection>
    );
}

/** Null-aware sort; the name falls back to the user id so nameless students still order. */
export function sortStudents(
    rows: AdmissionStudentRow[],
    key: SortKey,
    dir: 'asc' | 'desc'
): AdmissionStudentRow[] {
    const pick = (r: AdmissionStudentRow): string | number | null =>
        key === 'name' ? r.name ?? r.user_id : r[key];
    const list = [...rows];
    list.sort((a, b) => {
        const av = pick(a);
        const bv = pick(b);
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
