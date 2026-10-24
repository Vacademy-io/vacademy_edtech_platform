import { useMemo } from 'react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    ArrowsClockwise,
    X,
    FunnelSimple,
    DownloadSimple,
    Stack,
    Lightning,
    UserCircle,
} from '@phosphor-icons/react';
import {
    MultiSelectFilter,
    type MultiSelectOption,
} from '@/components/shared/leads/multi-select-filter';
import { ChipsWrapper } from '@/components/design-system/chips';
import {
    exportActivityLogsCsv,
    type AdminActivityLogFilters,
} from '@/services/admin-activity-logs/getActivityLogs';
import { useActivityLogActors } from '@/services/admin-activity-logs/getActivityLogActors';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
    value: AdminActivityLogFilters;
    onChange: (next: Partial<AdminActivityLogFilters>) => void;
    /** Reset every filter. Owned by the page so the empty state can call it too. */
    onClear: () => void;
    onRefresh: () => void;
    isFetching: boolean;
}

// Dropdown choices. Each `value` is an entity_type the backend emits from an
// @Auditable annotation; `label` is what an institute owner reads. The list has
// to stay complete: a resource missing here is a resource nobody can filter by,
// and it was for a long time — AuditableAnnotationContractTest (admin_core_service)
// now fails the build when a new entityType or action lands without an entry.
const RESOURCE_GROUPS: { group: string; options: MultiSelectOption[] }[] = [
    {
        group: 'CRM',
        options: [
            { value: 'AUDIENCE', label: 'Audience list' },
            { value: 'LEAD', label: 'Lead' },
            { value: 'LEAD_STATUS', label: 'Lead status' },
            { value: 'LEAD_TIER', label: 'Lead tier' },
            { value: 'LEAD_FOLLOWUP', label: 'Follow-up' },
            { value: 'LEAD_SLA_CONFIG', label: 'Lead SLA settings' },
            { value: 'LEAD_TAT_DEADLINE', label: 'Lead TAT deadline' },
            { value: 'LEAD_LOOKUP', label: 'Lead lookup' },
            { value: 'LEAD_CONNECTOR', label: 'Lead connector' },
            { value: 'ENQUIRY', label: 'Enquiry' },
            { value: 'COUNSELLOR', label: 'Counsellor' },
            { value: 'COUNSELLOR_POOL', label: 'Counsellor pool' },
            { value: 'COUNSELLOR_TARGET', label: 'Counsellor target' },
            { value: 'COUNSELLOR_WORKBENCH_CONFIG', label: 'Workbench settings' },
            { value: 'TAG', label: 'Tag' },
            { value: 'TELEPHONY_CONFIG', label: 'Calling settings' },
            { value: 'TELEPHONY_NUMBER', label: 'Calling number' },
            { value: 'ENGAGEMENT_ENGINE', label: 'Engagement engine' },
            { value: 'AUTOMATION', label: 'Automation' },
            // A message already sent to one person, sent again from their
            // communication timeline. The send runs in notification-service;
            // admin-core owns the action so the log has a named actor.
            { value: 'COMMUNICATION', label: 'Message' },
        ],
    },
    {
        group: 'Learning',
        options: [
            { value: 'COURSE', label: 'Course' },
            { value: 'LIVE_SESSION', label: 'Live session' },
            { value: 'LIVE_SESSION_MATERIAL', label: 'Class material' },
            { value: 'ENROLL_INVITE', label: 'Invite link' },
            { value: 'LEARNER', label: 'Learner' },
            { value: 'GUARDIAN_LINK', label: 'Guardian link' },
            { value: 'INSTITUTE_SETTING', label: 'Settings' },
            { value: 'LEARNER_BADGE', label: 'Learner badge' },
            { value: 'STUDENT_REPORT', label: 'Progress report' },
            // Reported by assessment_service through the internal audit endpoint,
            // not by an @Auditable annotation, so the contract test does not see it.
            { value: 'ASSESSMENT', label: 'Assessment' },
            { value: 'AI_QUESTION_EXTRACTION', label: 'Question paper upload (AI)' },
        ],
    },
    {
        group: 'Mentorship & meetings',
        options: [
            { value: 'MENTOR', label: 'Mentor' },
            { value: 'MENTOR_ASSIGNMENT', label: 'Mentor assignment' },
            { value: 'MENTOR_REQUEST', label: 'Mentor request' },
            { value: 'MENTOR_SESSION', label: 'Mentor session' },
            { value: 'BOOKING_PAGE', label: 'Booking page' },
            { value: 'BOOKING_INSTANCE', label: 'Booking' },
        ],
    },
    {
        group: 'People & payroll',
        options: [
            { value: 'HR_EMPLOYEE', label: 'Employee' },
            { value: 'HR_EMPLOYEE_BANK', label: 'Employee bank details' },
            { value: 'HR_EMPLOYEE_DOCUMENT', label: 'Employee document' },
            { value: 'HR_DEPARTMENT', label: 'Department' },
            { value: 'HR_DESIGNATION', label: 'Designation' },
            { value: 'HR_TEACHING', label: 'Teaching activity' },
            { value: 'HR_ATTENDANCE', label: 'Attendance' },
            { value: 'HR_ATTENDANCE_CONFIG', label: 'Attendance settings' },
            { value: 'HR_ATTENDANCE_REGULARIZATION', label: 'Attendance regularization' },
            { value: 'HR_SHIFT', label: 'Shift' },
            { value: 'HR_HOLIDAY', label: 'Holiday' },
            { value: 'HR_LEAVE', label: 'Leave' },
            { value: 'HR_LEAVE_BALANCE', label: 'Leave balance' },
            { value: 'HR_PAYROLL_RUN', label: 'Payroll run' },
            { value: 'HR_PAYROLL_ENTRY', label: 'Payroll entry' },
            { value: 'HR_PAYROLL_ADJUSTMENT', label: 'Payroll adjustment' },
            { value: 'HR_PAYROLL_FNF', label: 'Full and final settlement' },
            { value: 'HR_PAYSLIP', label: 'Payslip' },
            { value: 'HR_SALARY_COMPONENT', label: 'Salary component' },
            { value: 'HR_SALARY_STRUCTURE', label: 'Salary structure' },
            { value: 'HR_SALARY_TEMPLATE', label: 'Salary template' },
            { value: 'HR_LOAN', label: 'Loan' },
            { value: 'HR_REIMBURSEMENT', label: 'Reimbursement' },
            { value: 'HR_INCENTIVE', label: 'Incentive' },
            { value: 'HR_BONUS', label: 'Bonus' },
            { value: 'HR_BANK_EXPORT', label: 'Bank export' },
            { value: 'HR_TAX_CONFIG', label: 'Tax settings' },
            { value: 'HR_TAX_DECLARATION', label: 'Tax declaration' },
            { value: 'HR_TDS_CHALLAN', label: 'TDS challan' },
            { value: 'HR_FORM16', label: 'Form 16' },
            { value: 'HR_FORM24Q', label: 'Form 24Q' },
            { value: 'HR_PF_ECR', label: 'PF ECR' },
            { value: 'HR_ESI_RETURN', label: 'ESI return' },
            { value: 'HR_PT_RETURN', label: 'PT return' },
            { value: 'HR_WPS', label: 'WPS file' },
            { value: 'HR_EOSB_PROVISION', label: 'End-of-service provision' },
        ],
    },
    {
        group: 'Finance',
        options: [
            { value: 'PAYMENT_PLAN', label: 'Payment plan' },
            { value: 'FEE_PLAN', label: 'Fee plan (CPO)' },
            { value: 'PAYMENT', label: 'Payment' },
            { value: 'INVOICE', label: 'Invoice' },
            { value: 'ERP_JOURNAL', label: 'Journal entry' },
            { value: 'ERP_FINANCE_PNL', label: 'Profit and loss' },
        ],
    },
];

const RESOURCE_OPTIONS: MultiSelectOption[] = RESOURCE_GROUPS.flatMap((section) =>
    section.options.map((option) => ({ ...option, sublabel: section.group }))
);

const RESOURCE_LABELS: Record<string, string> = Object.fromEntries(
    RESOURCE_OPTIONS.map((option) => [option.value, option.label])
);

const ACTIVITY_OPTIONS: MultiSelectOption[] = [
    { value: 'CREATE', label: 'Created' },
    { value: 'UPDATE', label: 'Updated' },
    { value: 'DELETE', label: 'Deleted' },
    { value: 'PUBLISH', label: 'Published' },
    { value: 'EDIT_QUESTION', label: 'Question edited' },
    { value: 'RESTORE', label: 'Restored' },
    { value: 'BULK_CREATE', label: 'Bulk created' },
    { value: 'BULK_UPDATE', label: 'Bulk updated' },
    { value: 'IMPORT', label: 'Imported' },
    { value: 'MIGRATE', label: 'Migrated' },
    { value: 'EXPORT', label: 'Exported' },
    { value: 'SEARCH', label: 'Searched' },
    { value: 'DOWNLOAD', label: 'Downloaded' },
    { value: 'PURGE', label: 'Purged' },
    { value: 'ASSIGN', label: 'Assigned' },
    { value: 'UNASSIGN', label: 'Unassigned' },
    { value: 'REASSIGN', label: 'Reassigned' },
    { value: 'BULK_ROUND_ROBIN', label: 'Round-robin assigned' },
    { value: 'STATUS_CHANGE', label: 'Status changed' },
    { value: 'TIER_CHANGE', label: 'Tier changed' },
    { value: 'SCORE_CHANGE', label: 'Score changed' },
    { value: 'CONVERT', label: 'Marked converted' },
    { value: 'SEND_MESSAGE', label: 'Message sent' },
    { value: 'RESEND', label: 'Message resent' },
    { value: 'EMAIL', label: 'Emailed' },
    { value: 'CLOSE', label: 'Closed' },
    { value: 'RESCHEDULE', label: 'Rescheduled' },
    { value: 'ESCALATE', label: 'Escalated' },
    { value: 'TAG_USERS', label: 'Tagged contacts' },
    { value: 'UNTAG_USERS', label: 'Untagged contacts' },
    { value: 'TRIGGER', label: 'Triggered' },
    { value: 'ADD_MEMBER', label: 'Member added' },
    { value: 'REMOVE_MEMBER', label: 'Member removed' },
    { value: 'MEMBER_STATUS_CHANGE', label: 'Member status changed' },
    { value: 'AUTONOMY_CHANGE', label: 'Autonomy changed' },
    { value: 'RESUBSCRIBE', label: 'Re-subscribed' },
    { value: 'RECALCULATE_SCORES', label: 'Scores recalculated' },
    { value: 'ATTACH', label: 'Attached' },
    { value: 'ENROLL', label: 'Enrolled' },
    { value: 'CANCEL', label: 'Cancelled' },
    { value: 'TERMINATE', label: 'Terminated' },
    { value: 'MAKE_INACTIVE', label: 'Deactivated' },
    { value: 'MAKE_ACTIVE', label: 'Reactivated' },
    { value: 'UPDATE_BATCH', label: 'Moved to another batch' },
    { value: 'ADD_EXPIRY', label: 'Expiry changed' },
    { value: 'UPDATE_STATUS', label: 'Learner status changed' },
    { value: 'ACCESS_CHANGE', label: 'Access changed' },
    { value: 'SHARE_CREDENTIALS', label: 'Credentials shared' },
    { value: 'EXPORT_CREDENTIALS', label: 'Credentials exported' },
    { value: 'DEACTIVATE', label: 'Deactivated (record)' },
    { value: 'PROVISION_BOOKING_PAGE', label: 'Booking page provisioned' },
    { value: 'MAKE_DEFAULT', label: 'Made default' },
    { value: 'VOID', label: 'Voided' },
    { value: 'SPLIT', label: 'Installment split' },
    { value: 'DELETE_BLOCKED', label: 'Delete blocked' },
    { value: 'AWARD', label: 'Awarded' },
    { value: 'REVOKE', label: 'Revoked' },
    { value: 'APPROVE', label: 'Approved' },
    { value: 'REJECT', label: 'Rejected' },
    { value: 'DECLINE', label: 'Declined' },
    { value: 'VERIFY', label: 'Verified' },
    { value: 'HOLD', label: 'Put on hold' },
    { value: 'RELEASE', label: 'Released' },
    { value: 'PROCESS', label: 'Processed' },
    { value: 'PREPARE', label: 'Prepared' },
    { value: 'GENERATE', label: 'Generated' },
    { value: 'MATERIALIZE', label: 'Materialized' },
    { value: 'PAY_MATERIALIZE', label: 'Paid and materialized' },
    { value: 'MARK_PAID', label: 'Marked paid' },
    { value: 'ADJUST', label: 'Adjusted' },
    { value: 'ACCRUE', label: 'Accrued' },
    { value: 'BULK_MARK', label: 'Bulk marked' },
    { value: 'ATTENDANCE_SYNC', label: 'Attendance synced' },
    { value: 'CREATE_FROM_STAFF', label: 'Created from staff' },
    { value: 'YEAR_END', label: 'Year-end run' },
];

const ACTIVITY_LABELS: Record<string, string> = Object.fromEntries(
    ACTIVITY_OPTIONS.map((option) => [option.value, option.label])
);

/**
 * Local, not UTC. The table prints timestamps in the reader's own timezone, so
 * a range picked here has to mean the same days they can see — and the "To"
 * day is inclusive, which is what "logs up to today" plainly means. Sending
 * midnight would silently drop everything that happened on the last day.
 */
const startOfDay = (value: string): number | undefined => {
    if (!value) return undefined;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime();
};

const endOfDay = (value: string): number | undefined => {
    if (!value) return undefined;
    const parsed = new Date(`${value}T23:59:59.999`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime();
};

const toDateInput = (epochMs: number | undefined): string => {
    if (!epochMs) return '';
    const date = new Date(epochMs);
    if (Number.isNaN(date.getTime())) return '';
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
};

const daysAgoRange = (days: number): { startDate: number; endDate: number } => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);
    return { startDate: start.getTime(), endDate: end.getTime() };
};

const DATE_PRESETS: { label: string; range: () => { startDate: number; endDate: number } }[] = [
    { label: 'Today', range: () => daysAgoRange(1) },
    { label: 'Last 7 days', range: () => daysAgoRange(7) },
    { label: 'Last 30 days', range: () => daysAgoRange(30) },
];

/** Drops one value from a multi-select, collapsing an emptied list to undefined
 *  so the query param disappears instead of being sent empty. */
const without = (values: string[] | undefined, value: string): string[] | undefined => {
    const next = (values ?? []).filter((candidate) => candidate !== value);
    return next.length > 0 ? next : undefined;
};

const countActiveFilters = (value: AdminActivityLogFilters): number =>
    (value.entityTypes?.length ?? 0) +
    (value.actions?.length ?? 0) +
    (value.actorIds?.length ?? 0) +
    (value.startDate ? 1 : 0) +
    (value.endDate ? 1 : 0);

export function ActivityLogFilters({ value, onChange, onClear, onRefresh, isFetching }: Props) {
    const activeCount = countActiveFilters(value);
    const actorsQuery = useActivityLogActors();

    const actorOptions: MultiSelectOption[] = useMemo(() => {
        const known = (actorsQuery.data ?? []).map((actor) => ({
            value: actor.id,
            label: actor.fullName,
            sublabel: actor.email ?? undefined,
        }));
        // An id that came in on the URL but is not on the current roster (a
        // teammate who has since left) still has to render as a removable chip,
        // otherwise the filter looks broken.
        const knownIds = new Set(known.map((option) => option.value));
        const orphans = (value.actorIds ?? [])
            .filter((id) => !knownIds.has(id))
            .map((id) => ({ value: id, label: id, sublabel: 'No longer on the team' }));
        return [...known, ...orphans];
    }, [actorsQuery.data, value.actorIds]);

    const actorLabels = useMemo(
        () => Object.fromEntries(actorOptions.map((option) => [option.value, option.label])),
        [actorOptions]
    );

    // Presets compare against the exact range they would produce, so the pill
    // lights up only while the filter still matches it.
    const activePreset = DATE_PRESETS.find((preset) => {
        if (!value.startDate || !value.endDate) return false;
        const range = preset.range();
        return range.startDate === value.startDate && range.endDate === value.endDate;
    });

    // MyButton's onAsyncClick owns the spinner and the double-submit guard, so
    // this only has to do the work and report the outcome.
    const handleExport = async () => {
        try {
            await exportActivityLogsCsv({
                entityTypes: value.entityTypes,
                actions: value.actions,
                actorIds: value.actorIds,
                entityId: value.entityId,
                startDate: value.startDate,
                endDate: value.endDate,
            });
            toast.success('Activity logs CSV downloaded');
        } catch (e) {
            toast.error('Failed to export activity logs');
            // eslint-disable-next-line no-console
            console.error('Activity logs CSV export failed', e);
        }
    };

    return (
        <Card className="border-gray-200 shadow-sm">
            <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <FunnelSimple className="size-4" />
                        Filters
                        {activeCount > 0 && (
                            <Badge variant="secondary" className="ml-1">
                                {activeCount} active
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {activeCount > 0 && (
                            <MyButton
                                buttonType="text"
                                scale="medium"
                                className="sm:!min-w-0"
                                onClick={onClear}
                            >
                                <X className="mr-1 size-4" /> Clear
                            </MyButton>
                        )}
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            className="sm:!min-w-0"
                            onClick={onRefresh}
                            disable={isFetching}
                        >
                            <ArrowsClockwise
                                className={cn('mr-1 size-4', isFetching && 'animate-spin')}
                            />
                            Refresh
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            className="sm:!min-w-0"
                            onAsyncClick={handleExport}
                            loadingText="Exporting…"
                            title="Download a CSV of all rows matching the current filters (max 50,000)"
                        >
                            <DownloadSimple className="mr-1 size-4" />
                            Export CSV
                        </MyButton>
                    </div>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                    <MultiSelectFilter
                        label="Any resource"
                        icon={<Stack className="size-4 text-neutral-500" />}
                        options={RESOURCE_OPTIONS}
                        selected={value.entityTypes ?? []}
                        onChange={(values) =>
                            onChange({ entityTypes: values.length ? values : undefined })
                        }
                        placeholder="Search resources…"
                        widthClass="w-48"
                        showSelectedLabel
                    />
                    <MultiSelectFilter
                        label="Any activity"
                        icon={<Lightning className="size-4 text-neutral-500" />}
                        options={ACTIVITY_OPTIONS}
                        selected={value.actions ?? []}
                        onChange={(values) =>
                            onChange({ actions: values.length ? values : undefined })
                        }
                        placeholder="Search activities…"
                        widthClass="w-48"
                        showSelectedLabel
                    />
                    <MultiSelectFilter
                        label={actorsQuery.isLoading ? 'Loading team…' : 'Anyone on the team'}
                        icon={<UserCircle className="size-4 text-neutral-500" />}
                        options={actorOptions}
                        selected={value.actorIds ?? []}
                        onChange={(values) =>
                            onChange({ actorIds: values.length ? values : undefined })
                        }
                        placeholder="Search by name or email…"
                        widthClass="w-56"
                        showSelectedLabel
                    />

                    <div className="flex items-center gap-1 rounded-md border border-gray-200 p-0.5">
                        {DATE_PRESETS.map((preset) => {
                            const isActive = activePreset?.label === preset.label;
                            return (
                                <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() =>
                                        isActive
                                            ? onChange({
                                                  startDate: undefined,
                                                  endDate: undefined,
                                              })
                                            : onChange(preset.range())
                                    }
                                    className={cn(
                                        'rounded px-2 py-1.5 text-xs font-medium transition-colors',
                                        isActive
                                            ? 'bg-primary-50 text-primary-500'
                                            : 'text-gray-600 hover:bg-gray-100'
                                    )}
                                >
                                    {preset.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-end gap-2">
                        <Field label="From">
                            <Input
                                type="date"
                                className="h-10 w-40"
                                value={toDateInput(value.startDate)}
                                onChange={(e) =>
                                    onChange({ startDate: startOfDay(e.target.value) })
                                }
                            />
                        </Field>
                        <Field label="To">
                            <Input
                                type="date"
                                className="h-10 w-40"
                                value={toDateInput(value.endDate)}
                                onChange={(e) => onChange({ endDate: endOfDay(e.target.value) })}
                            />
                        </Field>
                    </div>
                </div>

                {activeCount > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2.5">
                        {(value.actorIds ?? []).map((id) => (
                            <FilterChip
                                key={`actor-${id}`}
                                label={actorLabels[id] ?? id}
                                onRemove={() => onChange({ actorIds: without(value.actorIds, id) })}
                            />
                        ))}
                        {(value.entityTypes ?? []).map((type) => (
                            <FilterChip
                                key={`resource-${type}`}
                                label={RESOURCE_LABELS[type] ?? type}
                                onRemove={() =>
                                    onChange({ entityTypes: without(value.entityTypes, type) })
                                }
                            />
                        ))}
                        {(value.actions ?? []).map((action) => (
                            <FilterChip
                                key={`action-${action}`}
                                label={ACTIVITY_LABELS[action] ?? action}
                                onRemove={() =>
                                    onChange({ actions: without(value.actions, action) })
                                }
                            />
                        ))}
                        {(value.startDate || value.endDate) && (
                            <FilterChip
                                label={`${toDateInput(value.startDate) || 'Any'} → ${
                                    toDateInput(value.endDate) || 'Now'
                                }`}
                                onRemove={() =>
                                    onChange({ startDate: undefined, endDate: undefined })
                                }
                            />
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * One applied filter, removable. Built on ChipsWrapper rather than Chips
 * because the canonical Chips takes only a static trailing icon, and this chip
 * needs that icon to be the remove control.
 */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <ChipsWrapper className="max-w-xs rounded-full pr-1 text-caption">
            <span className="truncate">{label}</span>
            <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove filter ${label}`}
                className="rounded-full p-0.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
            >
                <X className="size-3" />
            </button>
        </ChipsWrapper>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            {label}
            {children}
        </label>
    );
}
