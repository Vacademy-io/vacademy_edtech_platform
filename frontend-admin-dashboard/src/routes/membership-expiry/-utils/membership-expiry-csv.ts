import { format } from 'date-fns';
import type { MembershipDetail, PolicyDetails } from '@/types/membership-expiry';

/**
 * CSV export for the Membership Expiry page. Rows are whatever the current
 * filters (date range + course/session) return; the filename carries the range.
 */

type CsvCell = string | number | null | undefined;

const sanitizeCell = (value: CsvCell): string => {
    let s = value == null ? '' : String(value);
    // Neutralize formula injection (=, +, @, leading tab/CR) in spreadsheet apps.
    if (/^[=+@\t\r]/.test(s)) s = `'${s}`;
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
};

const buildCsv = (headers: string[], rows: CsvCell[][]): string =>
    [headers, ...rows].map((row) => row.map(sanitizeCell).join(',')).join('\r\n');

const downloadCsv = (filename: string, content: string): void => {
    // UTF-8 BOM so Excel renders unicode names correctly.
    const bom = String.fromCharCode(0xfeff);
    const blob = new Blob([bom, content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

const fmtDate = (value: string | null | undefined): string =>
    value ? format(new Date(value), 'yyyy-MM-dd') : '';

const getFirstPolicy = (detail: MembershipDetail): PolicyDetails | null =>
    detail.policy_details?.[0] ?? detail.user_plan?.policy_details?.[0] ?? null;

const courseNames = (detail: MembershipDetail): string => {
    const names = (detail.package_sessions ?? []).map((ps) =>
        ps.name
            ? `${ps.package_name} ${ps.name}`
            : `${ps.package_name} - ${ps.session_name} (${ps.level_name})`
    );
    if (names.length === 0) {
        const policyName = getFirstPolicy(detail)?.package_session_name;
        if (policyName) names.push(policyName);
    }
    return names.join('; ');
};

const HEADERS = [
    'Name',
    'Email',
    'Mobile',
    'Plan',
    'Course / Session',
    'Status',
    'Auto-Renewal',
    'Plan Start Date',
    'Plan End Date',
    'Calculated End Date',
    'Final Expiry Date',
    'Grace Period (days)',
    'Re-enrollment Allowed',
    'Next Eligible Enrollment',
];

const toRow = (detail: MembershipDetail): CsvCell[] => {
    const policy = getFirstPolicy(detail);
    const onExpiry = policy?.on_expiry_policy;
    const reenroll = policy?.reenrollment_policy;
    return [
        detail.user_details?.full_name,
        detail.user_details?.email,
        detail.user_details?.mobile_number,
        detail.user_plan?.payment_plan_dto?.name,
        courseNames(detail),
        detail.membership_status,
        onExpiry ? (onExpiry.enable_auto_renewal ? 'Yes' : 'No') : '',
        fmtDate(detail.user_plan?.start_date),
        fmtDate(detail.user_plan?.end_date),
        fmtDate(detail.calculated_end_date),
        fmtDate(onExpiry?.final_expiry_date),
        onExpiry?.waiting_period_in_days,
        reenroll ? (reenroll.allow_reenrollment_after_expiry ? 'Yes' : 'No') : '',
        fmtDate(reenroll?.next_eligible_enrollment_date),
    ];
};

export const exportMembershipExpiryCsv = (
    rows: MembershipDetail[],
    range: { startDate?: string; endDate?: string }
): void => {
    const start = range.startDate ? fmtDate(range.startDate) : 'start';
    const end = range.endDate ? fmtDate(range.endDate) : 'now';
    const suffix = range.startDate || range.endDate ? `${start}_to_${end}` : 'all-time';
    downloadCsv(`membership-expiry_${suffix}.csv`, buildCsv(HEADERS, rows.map(toRow)));
};
