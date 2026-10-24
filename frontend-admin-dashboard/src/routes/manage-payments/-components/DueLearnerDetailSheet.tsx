import { useState } from 'react';
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { MyInput } from '@/components/design-system/input';
import {
    CalendarBlank,
    CaretRight,
    PencilSimple,
    UserCircle,
    WarningCircle,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { formatMoney, resolveEntryCurrency } from '@/utils/payment-currency';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import {
    fetchUserPlanInstallments,
    useModifyInstallment,
} from '@/routes/manage-students/students-list/-services/cpoSideViewService';
import type {
    CpoInstallmentRow,
    CpoSideViewInstallmentsResponse,
} from '@/routes/manage-students/students-list/-types/cpo-side-view-types';
import type { StudentTable } from '@/types/student-table-types';
import type { PaymentLogEntry } from '@/types/payment-logs';
import {
    fetchLearnerPlanBreakdown,
    fetchPaymentLogs,
    serverErrorMessage,
    type BillingSummaryRequest,
    type LearnerPlanBreakdown,
    type OutstandingLearner,
} from '@/services/payment-logs';
import { entryPaymentStatus, paymentStatusMeta } from '../-utils/paymentStatus';
import { GatewayBadge } from './GatewayBadge';
import { paymentReceivedAt } from '../-utils/paymentReceivedAt';

interface DueLearnerDetailSheetProps {
    learner: OutstandingLearner | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The window and course scope the Due row was computed under. */
    filters?: BillingSummaryRequest;
    /** Opens one payment from the learner's history in the payment detail sheet. */
    onViewPayment?: (entry: PaymentLogEntry) => void;
}

/** The server's label for a CPO plan — the only kind with an instalment schedule to fetch. */
const INSTALMENT_PLAN_TYPE = 'Custom Installment';

/** How many of the learner's payments the sheet lists, newest first. */
const PAYMENTS_SHOWN = 20;

const money = (amount: number, currency?: string | null): string =>
    formatMoney(amount, currency || '', { maximumFractionDigits: 0 });

const initialsOf = (name?: string | null): string => {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')).toUpperCase();
};

/**
 * A server date as YYYY-MM-DD. Instalment dates arrive as a UTC-midnight instant, so they are read
 * in UTC — the same rule the instalment editor on the learner profile uses.
 */
const dayKey = (raw?: string | null): string => {
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/** Today as YYYY-MM-DD in the admin's own zone. */
const todayKey = (): string => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const dateOf = (key: string): Date | null => {
    const [y, m, d] = key.split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d) : null;
};

/** Always with the year: "6 Sept" alone reads as a date already gone when it is next year's. */
const formatDay = (key: string): string =>
    dateOf(key)?.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    }) ?? '—';

/** When a payment landed. `date` is a DATE column (UTC midnight), so it is shown without a time. */
const formatPaidAt = (entry: PaymentLogEntry): string => {
    const { value, hasTime } = paymentReceivedAt(entry.payment_log);
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        ...(hasTime ? { hour: 'numeric', minute: '2-digit' } : { timeZone: 'UTC' }),
    });
};

/**
 * How a plan status reads on screen. Anything not listed falls through to the raw status rather
 * than being hidden, so an institute with a status we have not seen still gets a legible row.
 */
const STATUS_META: Record<string, { label: string; chip: StatusType }> = {
    ACTIVE: { label: 'Active', chip: 'SUCCESS' },
    PENDING_FOR_PAYMENT: { label: 'Awaiting payment', chip: 'WARNING' },
    PENDING: { label: 'Pending', chip: 'INFO' },
    CANCELED: { label: 'Cancelled', chip: 'DANGER' },
    CANCELLED: { label: 'Cancelled', chip: 'DANGER' },
    TERMINATED: { label: 'Terminated', chip: 'DANGER' },
    EXPIRED: { label: 'Expired', chip: 'DANGER' },
    DELETED: { label: 'Deleted', chip: 'DANGER' },
    INACTIVE: { label: 'Inactive', chip: 'INFO' },
    PAYMENT_FAILED: { label: 'Payment failed', chip: 'DANGER' },
    INVITED: { label: 'Invited', chip: 'INFO' },
};

const statusMeta = (status?: string | null) =>
    STATUS_META[(status || '').toUpperCase()] ?? {
        label: status || '—',
        chip: 'INFO' as StatusType,
    };

/** Statuses the server leaves out of every balance; the same list its Due query skips. */
const CLOSED_INSTALMENT_STATUSES: Record<string, string> = {
    DELETED: 'Deleted',
    CANCELLED: 'Cancelled',
    DROPPED: 'Dropped',
    WAIVED: 'Waived',
};

const isClosedInstalment = (row: CpoInstallmentRow): boolean =>
    (row.status || '').toUpperCase() in CLOSED_INSTALMENT_STATUSES;

/**
 * Where one instalment stands. Derived from the amounts and the due date rather than the stored
 * status, which nothing moves to OVERDUE when a due date passes.
 */
const instalmentState = (row: CpoInstallmentRow): { label: string; chip: StatusType } => {
    if (isClosedInstalment(row)) {
        return {
            label: CLOSED_INSTALMENT_STATUSES[(row.status || '').toUpperCase()]!,
            chip: 'INFO',
        };
    }
    // A row discounted or split down to nothing was never paid — there was nothing to pay.
    if (row.amount_expected <= 0) return { label: 'No charge', chip: 'INFO' };
    const left = Math.max(row.outstanding ?? row.amount_expected - row.amount_paid, 0);
    if (left <= 0) return { label: 'Paid', chip: 'SUCCESS' };
    const due = dayKey(row.due_date);
    if (due && due < todayKey()) return { label: 'Overdue', chip: 'DANGER' };
    if (row.amount_paid > 0) return { label: 'Part-paid', chip: 'WARNING' };
    return { label: 'Upcoming', chip: 'INFO' };
};

/**
 * An instalment that still has money to collect — the only kind whose due date matters. Same test
 * as the server's balance: amount_paid below amount_expected, on a row it has not closed.
 */
const isOpenInstalment = (row: CpoInstallmentRow): boolean =>
    row.outstanding > 0 && !isClosedInstalment(row);

/** What is still to collect on one plan, summed per instalment as the server's Outstanding is. */
const scheduleOutstanding = (schedule: CpoSideViewInstallmentsResponse): number =>
    schedule.installments.filter(isOpenInstalment).reduce((sum, row) => sum + row.outstanding, 0);

/**
 * The earliest unpaid instalment across the learner's schedules and everything that falls due on
 * that day — the same rule the server applies to the balance row. Read from the schedules rather
 * than the row, so moving a date in this sheet moves the callout with it.
 */
const nextDueFromSchedules = (
    schedules: CpoSideViewInstallmentsResponse[]
): { day: string; amount: number } | null => {
    const open = schedules
        .flatMap((schedule) => schedule.installments)
        .filter(isOpenInstalment)
        .map((row) => ({ day: dayKey(row.due_date), amount: row.outstanding }))
        .filter((row) => row.day);
    if (!open.length) return null;
    const day = open.reduce((min, row) => (row.day < min ? row.day : min), open[0]!.day);
    const amount = open.filter((row) => row.day === day).reduce((sum, row) => sum + row.amount, 0);
    return { day, amount };
};

const collectedPercent = (paid: number, billed: number): number =>
    billed > 0 ? Math.min(100, Math.round((paid / billed) * 100)) : 0;

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
    return (
        <div className="min-w-0">
            <div className="text-2xs uppercase tracking-wide text-neutral-500">{label}</div>
            <div className={cn('truncate text-body font-semibold tabular-nums', tone)}>{value}</div>
        </div>
    );
}

/**
 * One instalment, with its due date editable in place while money is still owed on it. Only the
 * date is sent, so the amount, discount and anything paid against the row are left as they are;
 * the server records the change in the plan history and the admin activity log.
 */
function InstalmentRow({
    row,
    index,
    userPlanId,
    userId,
    currency,
}: {
    row: CpoInstallmentRow;
    index: number;
    userPlanId: string;
    userId: string;
    currency: string | null;
}) {
    const queryClient = useQueryClient();
    const { mutateAsync: modify, isPending } = useModifyInstallment(userPlanId, userId);
    const [editing, setEditing] = useState(false);
    const due = dayKey(row.due_date);
    const [draft, setDraft] = useState(due);
    const state = instalmentState(row);
    const left = Math.max(row.outstanding, 0);
    const canEdit = isOpenInstalment(row);

    // No rule against a date before the instalment's start date: nothing on the server or in the
    // learner app reads start_date, and the profile editor allows it too.
    const draftError = draft ? null : 'Pick a date.';

    const save = async () => {
        if (draftError) return;
        if (draft === due) {
            setEditing(false);
            return;
        }
        try {
            await modify({ sfpId: row.id, body: { due_date: draft } });
        } catch (err) {
            toast.error(serverErrorMessage(err) ?? 'Could not change the due date.');
            return;
        }
        // A new date can move money between Due and Upcoming, so everything counted from due
        // dates is recounted: this sheet's plans, the list behind it and the cards above that.
        queryClient.invalidateQueries({ queryKey: ['learner-plan-breakdown'] });
        queryClient.invalidateQueries({ queryKey: ['payment-outstanding-learners'] });
        queryClient.invalidateQueries({ queryKey: ['payment-billing-summary'] });
        queryClient.invalidateQueries({ queryKey: ['payment-instalment-forecast'] });
        queryClient.invalidateQueries({ queryKey: ['user-account-summary', userId] });
        toast.success(`Instalment ${index + 1} is now due on ${formatDay(draft)}.`);
        setEditing(false);
    };

    return (
        <li className="px-3 py-2">
            <div className="flex items-center gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xs font-semibold text-neutral-600">
                    {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="text-body font-medium text-neutral-700">
                        {due ? `Due ${formatDay(due)}` : 'No due date'}
                    </div>
                    {row.amount_paid > 0 && (
                        <div className="text-2xs tabular-nums text-neutral-500">
                            Paid {money(row.amount_paid, currency)}
                            {left > 0 && ` · ${money(left, currency)} left`}
                        </div>
                    )}
                    {canEdit && !editing && (
                        <MyButton
                            buttonType="text"
                            scale="small"
                            className="h-auto gap-1 px-0 sm:min-w-0"
                            aria-label={`Change due date of instalment ${index + 1}`}
                            onClick={() => {
                                setDraft(due);
                                setEditing(true);
                            }}
                        >
                            <PencilSimple size={12} />
                            Change date
                        </MyButton>
                    )}
                </div>
                <div className="text-right">
                    <div className="text-body font-semibold tabular-nums text-neutral-700">
                        {money(row.amount_expected, currency)}
                    </div>
                    {row.original_amount > row.amount_expected && (
                        <div className="text-2xs tabular-nums text-neutral-400 line-through">
                            {money(row.original_amount, currency)}
                        </div>
                    )}
                </div>
                <StatusChip
                    text={state.label}
                    textSize="text-caption"
                    status={state.chip}
                    showIcon={false}
                />
            </div>
            {editing && (
                <div className="mt-2 flex flex-wrap items-start gap-2 pl-9">
                    <MyInput
                        inputType="date"
                        input={draft}
                        onChangeFunction={(e) => setDraft(e.target.value)}
                        size="small"
                        className="w-full text-body text-neutral-800 sm:w-44"
                        error={draftError}
                        aria-label={`New due date for instalment ${index + 1}`}
                    />
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        className="h-9"
                        disable={draftError != null || isPending}
                        onClick={save}
                    >
                        {isPending ? 'Saving…' : 'Save'}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        className="h-9"
                        disable={isPending}
                        onClick={() => setEditing(false)}
                    >
                        Cancel
                    </MyButton>
                </div>
            )}
        </li>
    );
}

/** The instalments on one CPO plan, in due-date order. */
function InstalmentSchedule({
    plan,
    userId,
    schedule,
}: {
    plan: LearnerPlanBreakdown;
    userId: string;
    schedule?: UseQueryResult<CpoSideViewInstallmentsResponse>;
}) {
    const data = schedule?.data;

    if (!schedule || schedule.isPending) return <Skeleton className="mt-3 h-24 w-full" />;
    if (schedule.error != null || !data) {
        return (
            <p className="mt-3 text-caption text-danger-600">
                Could not load the instalment schedule.
            </p>
        );
    }
    if (!data.installments.length) {
        return <p className="mt-3 text-caption text-neutral-500">No instalments on this plan.</p>;
    }

    const discount = Math.max(data.gross_total - data.net_total, 0);

    return (
        <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-2 text-caption text-neutral-500">
                <span className="font-semibold text-neutral-600">
                    Instalment schedule ({data.installments.length})
                </span>
                {discount > 0 && (
                    <span className="tabular-nums">
                        Fee {money(data.gross_total, plan.currency)} −{' '}
                        <span className="text-success-600">
                            {money(discount, plan.currency)} discount
                        </span>
                    </span>
                )}
            </div>
            <ol className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
                {data.installments.map((row, index) => (
                    <InstalmentRow
                        key={row.id}
                        row={row}
                        index={index}
                        userPlanId={plan.user_plan_id}
                        userId={userId}
                        currency={plan.currency}
                    />
                ))}
            </ol>
        </div>
    );
}

function CountedPlanCard({
    plan,
    userId,
    schedule,
}: {
    plan: LearnerPlanBreakdown;
    userId: string;
    schedule?: UseQueryResult<CpoSideViewInstallmentsResponse>;
}) {
    const isInstalmentPlan = plan.payment_type === INSTALMENT_PLAN_TYPE;
    // Billed minus paid until the schedule arrives; an overpaid instalment makes that undercount.
    const outstanding = schedule?.data
        ? scheduleOutstanding(schedule.data)
        : Math.max(plan.billed - plan.paid, 0);
    return (
        <div className="rounded-lg border border-neutral-200 p-3">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate font-medium text-neutral-700">
                        {plan.course_name || '—'}
                    </div>
                    {plan.payment_type && (
                        <div className="text-2xs text-neutral-500">{plan.payment_type}</div>
                    )}
                </div>
                <StatusChip
                    text={statusMeta(plan.plan_status).label}
                    textSize="text-caption"
                    status={statusMeta(plan.plan_status).chip}
                    showIcon={false}
                />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                    label="Billed"
                    value={money(plan.billed, plan.currency)}
                    tone="text-neutral-700"
                />
                <Stat
                    label="Paid"
                    value={money(plan.paid, plan.currency)}
                    tone="text-success-600"
                />
                {isInstalmentPlan && (
                    <Stat
                        label="Outstanding"
                        value={money(outstanding, plan.currency)}
                        tone="text-neutral-700"
                    />
                )}
                <Stat
                    label="Due now"
                    value={money(plan.due, plan.currency)}
                    tone={plan.due > 0 ? 'text-danger-600' : 'text-warning-600'}
                />
                {!isInstalmentPlan && plan.upcoming > 0 && (
                    <Stat
                        label="Upcoming"
                        value={money(plan.upcoming, plan.currency)}
                        tone="text-neutral-600"
                    />
                )}
            </div>
            {plan.billed > 0 && (
                <Progress
                    value={collectedPercent(plan.paid, plan.billed)}
                    className="mt-3 h-1.5 !bg-neutral-100"
                />
            )}
            {isInstalmentPlan && (
                <InstalmentSchedule plan={plan} userId={userId} schedule={schedule} />
            )}
        </div>
    );
}

/** Every payment the learner made, newest first; a row opens the full payment detail. */
function PaymentHistory({
    entries,
    total,
    onViewPayment,
}: {
    entries: PaymentLogEntry[];
    total: number;
    onViewPayment?: (entry: PaymentLogEntry) => void;
}) {
    if (!entries.length) {
        return <p className="text-caption text-neutral-500">No payments recorded yet.</p>;
    }
    return (
        <>
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                {entries.map((entry) => {
                    const log = entry.payment_log;
                    const meta = paymentStatusMeta(entryPaymentStatus(entry));
                    const detail = [entry.user_plan?.enroll_invite?.name, log?.transaction_id]
                        .filter(Boolean)
                        .join(' · ');
                    const body = (
                        <>
                            <GatewayBadge vendor={log?.vendor} size="sm" />
                            <div className="min-w-0 flex-1">
                                <div className="text-body font-medium text-neutral-700">
                                    {formatPaidAt(entry)}
                                </div>
                                {detail && (
                                    <div className="truncate text-2xs text-neutral-500">
                                        {detail}
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span className="text-body font-semibold tabular-nums text-neutral-700">
                                    {money(log?.payment_amount || 0, resolveEntryCurrency(entry))}
                                </span>
                                <StatusChip
                                    text={meta.label}
                                    textSize="text-caption"
                                    status={meta.chip}
                                    showIcon={false}
                                />
                            </div>
                        </>
                    );
                    return (
                        <li key={log?.id ?? entry.invoice?.invoice_id}>
                            {onViewPayment ? (
                                <button
                                    type="button"
                                    onClick={() => onViewPayment(entry)}
                                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
                                >
                                    {body}
                                    <CaretRight size={14} className="shrink-0 text-neutral-400" />
                                </button>
                            ) : (
                                <div className="flex items-center gap-3 px-3 py-2.5">{body}</div>
                            )}
                        </li>
                    );
                })}
            </ul>
            {total > entries.length && (
                <p className="text-2xs text-neutral-500">
                    Showing the latest {entries.length} of {total} payments.
                </p>
            )}
        </>
    );
}

/**
 * Everything behind one learner's balance row: who they are, what they owe and when, every
 * enrolment that makes up the figure — with the instalment schedule of each instalment plan — and
 * the payments they have made.
 *
 * The balance list nets a learner down to a single figure, which left an admin who had just
 * cancelled somebody's plan with no way to check the cancellation was honoured. So the plans are
 * shown themselves: the ones that can owe (live instalment plans, subscriptions, invoices), and the
 * rest — one-time purchases and cancelled or expired plans — greyed out and explicitly worth ₹0.
 */
export function DueLearnerDetailSheet({
    learner,
    open,
    onOpenChange,
    filters,
    onViewPayment,
}: DueLearnerDetailSheetProps) {
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    // Opens the same full-screen student profile overlay the students list uses.
    const { openOverlay } = useStudentSidebar();

    const {
        data: plans,
        isLoading,
        error,
    } = useQuery({
        queryKey: ['learner-plan-breakdown', learner?.user_id, filters],
        queryFn: () => fetchLearnerPlanBreakdown(learner!.user_id, filters),
        // Only ask once the sheet is actually open — the Due list can be 40+ rows deep.
        enabled: open && Boolean(learner?.user_id),
        staleTime: 60_000,
        retry: false,
    });

    // All time, not the row's date window: that window selects enrolments by when they were
    // created, so an instalment paid last month on an older plan would otherwise be missing from
    // the history while its amount still counts in Paid. The course scope does carry over.
    const {
        data: payments,
        isLoading: isLoadingPayments,
        error: paymentsError,
    } = useQuery({
        queryKey: ['learner-payment-history', learner?.user_id, filters?.package_session_ids],
        queryFn: () =>
            fetchPaymentLogs(0, PAYMENTS_SHOWN, {
                user_id: learner!.user_id,
                package_session_ids: filters?.package_session_ids,
            }),
        enabled: open && Boolean(learner?.user_id),
        staleTime: 60_000,
        retry: false,
    });

    const counted = (plans ?? []).filter((plan) => plan.counts_towards_due);
    const excluded = (plans ?? []).filter((plan) => !plan.counts_towards_due);
    const currency = learner?.currency ?? plans?.[0]?.currency ?? '';

    // One schedule per live instalment plan, under the key the learner-profile editor uses, so an
    // edit made in either place refreshes both.
    const instalmentPlans = counted.filter((plan) => plan.payment_type === INSTALMENT_PLAN_TYPE);
    const scheduleQueries = useQueries({
        queries: instalmentPlans.map((plan) => ({
            queryKey: ['cpo-side-view', 'installments', plan.user_plan_id],
            queryFn: () => fetchUserPlanInstallments(plan.user_plan_id),
            enabled: open,
            staleTime: 15_000,
        })),
    });
    const scheduleByPlan = new Map(
        instalmentPlans.map((plan, i) => [plan.user_plan_id, scheduleQueries[i]])
    );
    const loadedSchedules = scheduleQueries.flatMap((query) => (query.data ? [query.data] : []));
    const schedulesReady =
        instalmentPlans.length > 0 && loadedSchedules.length === instalmentPlans.length;
    const scheduleNextDue = schedulesReady ? nextDueFromSchedules(loadedSchedules) : null;

    const openProfile = () => {
        if (!learner) return;
        // The overlay hydrates the rest of the profile from the user id; we only seed the header.
        const seed = {
            id: learner.user_id,
            user_id: learner.user_id,
            full_name: learner.full_name ?? '',
            email: learner.email ?? '',
            mobile_number: learner.mobile_number ?? '',
            status: 'INACTIVE',
        } as unknown as StudentTable;
        onOpenChange(false);
        openOverlay(seed);
    };

    // After a date is changed here the balance row is out of date until it is clicked again, so the
    // figures a date can move are read from what this sheet has just refetched.
    const nextDue = schedulesReady ? scheduleNextDue?.day ?? '' : dayKey(learner?.next_due_date);
    const nextDueAmount = schedulesReady
        ? scheduleNextDue?.amount ?? null
        : learner?.next_due_amount ?? null;
    const dueNow = plans ? counted.reduce((sum, plan) => sum + plan.due, 0) : learner?.due ?? 0;
    const nextDueDate = nextDue ? dateOf(nextDue) : null;
    const nextDueToday = Boolean(nextDue) && nextDue === todayKey();
    const nextDueOverdue = Boolean(nextDue) && nextDue < todayKey();

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
                <SheetHeader className="border-b border-neutral-200 p-5 text-left">
                    <SheetTitle className="text-title">Balance breakdown</SheetTitle>
                </SheetHeader>

                {learner && (
                    <div className="flex-1 space-y-5 p-5">
                        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-100 text-subtitle font-semibold text-primary-600">
                                {initialsOf(learner.full_name)}
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-body font-semibold text-neutral-700">
                                    {learner.full_name || '—'}
                                </div>
                                {learner.email && (
                                    <div className="truncate text-caption text-neutral-500">
                                        {learner.email}
                                    </div>
                                )}
                                {learner.mobile_number && (
                                    <div className="truncate text-caption text-neutral-500">
                                        {learner.mobile_number}
                                    </div>
                                )}
                            </div>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                className="shrink-0 gap-1.5"
                                onClick={openProfile}
                            >
                                <UserCircle size={16} weight="fill" />
                                View profile
                            </MyButton>
                        </div>

                        <div className="space-y-3 rounded-lg border border-neutral-200 p-4">
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <Stat
                                    label="Billed"
                                    value={money(learner.billed, currency)}
                                    tone="text-neutral-700"
                                />
                                <Stat
                                    label="Paid"
                                    value={money(learner.paid, currency)}
                                    tone="text-success-600"
                                />
                                {learner.outstanding != null && (
                                    <Stat
                                        label="Outstanding"
                                        value={money(learner.outstanding, currency)}
                                        tone="text-neutral-800"
                                    />
                                )}
                                <Stat
                                    label="Due"
                                    value={money(dueNow, currency)}
                                    tone={dueNow > 0 ? 'text-danger-600' : 'text-warning-600'}
                                />
                            </div>
                            {learner.billed > 0 && (
                                <div className="space-y-1">
                                    <Progress
                                        value={collectedPercent(learner.paid, learner.billed)}
                                        className="h-2 !bg-neutral-100"
                                    />
                                    <div className="text-2xs text-neutral-500">
                                        {collectedPercent(learner.paid, learner.billed)}% collected
                                    </div>
                                </div>
                            )}
                        </div>

                        {nextDue && nextDueDate && (
                            <div
                                className={cn(
                                    'flex items-center gap-3 rounded-lg border p-3',
                                    nextDueOverdue
                                        ? 'border-danger-200 bg-danger-50'
                                        : 'border-primary-100 bg-primary-50'
                                )}
                            >
                                <CalendarBlank
                                    size={22}
                                    weight="duotone"
                                    className={cn(
                                        'shrink-0',
                                        nextDueOverdue ? 'text-danger-600' : 'text-primary-500'
                                    )}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="text-caption text-neutral-500">
                                        {nextDueOverdue
                                            ? 'Oldest unpaid instalment was due'
                                            : 'Next instalment due'}
                                    </div>
                                    <div className="text-body font-semibold tabular-nums text-neutral-700">
                                        {nextDueAmount != null &&
                                            `${money(nextDueAmount, currency)} · `}
                                        {formatDay(nextDue)}
                                    </div>
                                </div>
                                <span
                                    className={cn(
                                        'shrink-0 text-caption',
                                        nextDueOverdue
                                            ? 'font-semibold text-danger-600'
                                            : 'text-neutral-500'
                                    )}
                                >
                                    {nextDueToday
                                        ? 'Today'
                                        : formatDistanceToNow(nextDueDate, { addSuffix: true })}
                                </span>
                            </div>
                        )}

                        {isLoading && (
                            <div className="space-y-2">
                                <Skeleton className="h-16 w-full" />
                                <Skeleton className="h-16 w-full" />
                            </div>
                        )}

                        {!isLoading && error != null && (
                            <p className="text-caption text-danger-600">
                                Could not load this learner&apos;s enrolments. The totals above are
                                still accurate.
                            </p>
                        )}

                        {!isLoading && error == null && (
                            <>
                                <section className="space-y-2">
                                    <h3 className="text-caption font-semibold text-neutral-600">
                                        Counted towards this balance ({counted.length})
                                    </h3>
                                    {counted.length === 0 ? (
                                        <p className="text-caption text-neutral-500">
                                            No live enrolments.
                                        </p>
                                    ) : (
                                        counted.map((plan) => (
                                            <CountedPlanCard
                                                key={plan.user_plan_id}
                                                plan={plan}
                                                userId={learner.user_id}
                                                schedule={scheduleByPlan.get(plan.user_plan_id)}
                                            />
                                        ))
                                    )}
                                </section>

                                {excluded.length > 0 && (
                                    <section className="space-y-2">
                                        <h3 className="flex items-center gap-1.5 text-caption font-semibold text-neutral-600">
                                            <WarningCircle size={14} weight="duotone" />
                                            Not counted ({excluded.length})
                                        </h3>
                                        <p className="text-2xs text-neutral-500">
                                            {`One-time purchases and cancelled, terminated or expired enrolments are shown for reference. They add nothing to the balance, whatever the ${courseTerm.toLowerCase()} originally cost — a one-time ${courseTerm.toLowerCase()} is either paid or not enrolled.`}
                                        </p>
                                        {excluded.map((plan) => (
                                            <div
                                                key={plan.user_plan_id}
                                                className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-3"
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <span className="min-w-0 text-neutral-500 line-through">
                                                        {plan.course_name || '—'}
                                                    </span>
                                                    <StatusChip
                                                        text={statusMeta(plan.plan_status).label}
                                                        textSize="text-caption"
                                                        status={statusMeta(plan.plan_status).chip}
                                                        showIcon={false}
                                                    />
                                                </div>
                                                <div className="mt-2 flex items-center gap-4 text-caption tabular-nums text-neutral-500">
                                                    <span className="line-through">
                                                        {money(plan.billed, plan.currency)}
                                                    </span>
                                                    <span className="font-semibold text-neutral-600">
                                                        Due {money(0, plan.currency)}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </section>
                                )}
                            </>
                        )}

                        <section className="space-y-2">
                            <h3 className="text-caption font-semibold text-neutral-600">
                                Payments
                                {payments ? ` (${payments.totalElements})` : ''}
                            </h3>
                            {isLoadingPayments ? (
                                <Skeleton className="h-16 w-full" />
                            ) : paymentsError != null ? (
                                <p className="text-caption text-danger-600">
                                    Could not load this learner&apos;s payments.
                                </p>
                            ) : (
                                <PaymentHistory
                                    entries={payments?.content ?? []}
                                    total={payments?.totalElements ?? 0}
                                    onViewPayment={onViewPayment}
                                />
                            )}
                        </section>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
