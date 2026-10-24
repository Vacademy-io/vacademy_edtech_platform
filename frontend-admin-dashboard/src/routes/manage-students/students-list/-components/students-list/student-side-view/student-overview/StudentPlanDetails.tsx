import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCurrencySymbol } from '@/constants/currencies';
import { MyButton } from '@/components/design-system/button';
import { ProgressBar } from '@/components/design-system/progress-bar';
import {
    Clock,
    Eye,
    Warning,
    ArrowsClockwise,
    Calendar,
    CheckCircle,
    Prohibit,
    CaretDown,
    CaretUp,
    CurrencyDollar,
    Tag,
    TrendUp,
    ChatText,
    CalendarCheck,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { getUserPlans, UserPlan } from '@/services/user-plan';
import { getInstituteId } from '@/constants/helper';
import { ChangePlanDialog } from '../student-membership/change-plan-dialog';
import { ManualRenewalDialog } from '../student-membership/manual-renewal-dialog';
import { ChangeEndDateDialog } from '../student-membership/change-end-date-dialog';
import { PlanRemarksDialog } from '../student-membership/plan-remarks';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { toast } from 'sonner';
import { format, formatDate } from 'date-fns';
import { PolicyActionsTimeline } from '@/components/common/PolicyActionsTimeline';
import type { PolicyDetails } from '@/types/membership-expiry';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useGetUserBasicDetails } from '@/services/get_user_basic_details';

interface StudentPlanDetailsProps {
    userId: string;
    instituteId?: string;
}

const getFirstPolicy = (plan: UserPlan): PolicyDetails | null => {
    if (plan.policy_details && plan.policy_details.length > 0) {
        return plan.policy_details[0] || null;
    }
    return null;
};

const getPlanName = (plan: UserPlan, t: TFunction): string => {
    try {
        if (plan.payment_plan_dto?.name) return plan.payment_plan_dto.name;
        if (typeof plan.plan_json === 'string') {
            const parsed = JSON.parse(plan.plan_json);
            return parsed.name || t('fallback.planName');
        }
        return t('fallback.planName');
    } catch {
        return t('fallback.planName');
    }
};

const getOptionName = (plan: UserPlan, t: TFunction): string =>
    plan.payment_option?.name || t('fallback.paymentOption');

/**
 * CPO-backed memberships carry an installment schedule (student_fee_payment rows), so
 * switching them would leave already-allocated payments stranded against bills for a plan
 * the learner is no longer on. The backend refuses them too — this just hides the button.
 */
const isCpoPlan = (plan: UserPlan): boolean =>
    (plan.payment_option?.type || '').toUpperCase() === 'CPO';

/** Memberships that have lapsed but can be brought back with a manual renewal. */
const LAPSED_STATUSES = ['EXPIRED', 'CANCELED', 'PAYMENT_FAILED'];

const getPlanAmount = (plan: UserPlan): number => plan.payment_plan_dto?.actual_price || 0;

const getPlanCurrency = (plan: UserPlan): string => plan.payment_plan_dto?.currency || 'N/A';

const getCourseLabel = (plan: UserPlan, t: TFunction): string => {
    const policy = getFirstPolicy(plan);
    return (
        policy?.package_session_name?.trim() ||
        plan.enroll_invite?.name?.trim() ||
        getPlanName(plan, t)
    );
};

const computeDaysLeft = (endDate?: string | null): number | null => {
    if (!endDate) return null;
    const diffMs = new Date(endDate).getTime() - Date.now();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

/**
 * Reads the coupon snapshot for display. Prefers the structured
 * {@code applied_coupon} field that the BE now exposes (see
 * CouponSnapshotDTO); falls back to parsing the raw
 * {@code applied_coupon_discount_json} blob so we keep working against
 * older BE builds that haven't deployed the structured field yet.
 */
interface RawCouponSnapshot {
    discountType?: string;
    discount_type?: string;
    discountPoint?: number;
    discount_point?: number;
    maxDiscountPoint?: number | null;
    max_discount_point?: number | null;
    couponCode?: { code?: string } | null;
    coupon_code?: { code?: string } | null;
    name?: string;
}

/**
 * Mirrors the BE's CouponDiscountUtil.computeDiscount so we can render the
 * effective amount the learner actually paid (plan price minus this value)
 * on the membership card. Plays it safe — never returns a negative number,
 * never returns more than the cap when one is set.
 */
const computeCouponDiscount = (
    grossAmount: number,
    applied: { type: string | null; point: number | null; maxPoint: number | null } | null
): number => {
    if (!applied || applied.point == null) return 0;
    const point = applied.point;
    if ((applied.type || '').toUpperCase() === 'PERCENTAGE') {
        const raw = (grossAmount * point) / 100;
        const capped = applied.maxPoint != null ? Math.min(raw, applied.maxPoint) : raw;
        return Math.max(0, Math.min(grossAmount, capped));
    }
    return Math.max(0, Math.min(grossAmount, point));
};

const parseAppliedCoupon = (plan: UserPlan) => {
    if (plan.applied_coupon) {
        const a = plan.applied_coupon;
        if (!a.coupon_code && a.discount_point == null) return null;
        return {
            code: a.coupon_code ?? null,
            type: a.discount_type ?? null,
            point: a.discount_point ?? null,
            maxPoint: a.max_discount_point ?? null,
        };
    }
    if (!plan.applied_coupon_discount_id || !plan.applied_coupon_discount_json) return null;
    try {
        const raw = JSON.parse(plan.applied_coupon_discount_json) as RawCouponSnapshot;
        const code = raw.couponCode?.code || raw.coupon_code?.code || raw.name || null;
        const type = raw.discountType ?? raw.discount_type ?? null;
        const point = raw.discountPoint ?? raw.discount_point ?? null;
        const maxPoint = raw.maxDiscountPoint ?? raw.max_discount_point ?? null;
        if (!code && point == null) return null;
        return { code, type, point, maxPoint };
    } catch {
        return null;
    }
};

const getExpiryLabel = (plan: UserPlan): string | null => {
    if (plan.end_date) return formatDate(new Date(plan.end_date), 'dd MMM yyyy');
    const validityDays = plan.payment_plan_dto?.validity_in_days;
    if (validityDays && plan.start_date) {
        const startDate = new Date(plan.start_date);
        startDate.setDate(startDate.getDate() + validityDays);
        return formatDate(startDate, 'dd MMM yyyy');
    }
    return null;
};

/**
 * Display labels for plan status codes. The Record keys are the raw backend
 * enum values used for style lookup and MUST NOT be translated — only the
 * rendered `label` text below changes per-locale.
 */
const buildPlanStatusMap = (t: TFunction): Record<string, { label: string; classes: string }> => ({
    ACTIVE: {
        label: t('planStatus.active'),
        classes: 'bg-success-50 text-success-700 ring-success-200',
    },
    EXPIRED: {
        label: t('planStatus.expired'),
        classes: 'bg-danger-50 text-danger-700 ring-danger-200',
    },
    CANCELED: {
        label: t('planStatus.canceled'),
        classes: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
    },
    PAYMENT_FAILED: {
        label: t('planStatus.paymentFailed'),
        classes: 'bg-danger-50 text-danger-700 ring-danger-200',
    },
});

const PlanStatusBadge = ({ status }: { status?: string }) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    const normalized = (status || '').toUpperCase();
    const map = buildPlanStatusMap(t);
    const entry = map[normalized] || {
        label: normalized || t('planStatus.unknown'),
        classes: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
    };
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1',
                entry.classes
            )}
        >
            {entry.label}
        </span>
    );
};

const EnrollmentStatusBadge = ({
    enrollmentStatus,
}: {
    enrollmentStatus: 'ACTIVE' | 'INACTIVE' | 'TERMINATED' | null;
}) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    if (!enrollmentStatus) return null;
    if (enrollmentStatus === 'ACTIVE') {
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-xs font-semibold text-success-700 ring-1 ring-success-200">
                <CheckCircle className="size-3" />
                {t('enrollmentStatus.active')}
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2 py-0.5 text-xs font-semibold text-danger-700 ring-1 ring-danger-200">
            <Prohibit className="size-3" />
            {t('enrollmentStatus.inactive')}
        </span>
    );
};

/**
 * Renders the coupon used at enrollment (if any). Pulls the snapshot from
 * UserPlan.applied_coupon_discount_json so the row keeps showing the right
 * info even if the coupon definition changed after the redemption.
 */
const CouponAppliedRow = ({ plan, currency }: { plan: UserPlan; currency: string }) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    const applied = parseAppliedCoupon(plan);
    // Admin-granted discount: name the granting admin (best-effort lookup).
    const grantedById =
        plan.discount_granted_by_user_id || plan.applied_coupon?.granted_by_user_id || null;
    const { data: grantedByUsers } = useGetUserBasicDetails(grantedById ? [grantedById] : []);
    if (!applied) return null;
    const grantedByName = grantedById
        ? grantedByUsers?.find((u) => u.id === grantedById)?.name
        : undefined;
    const isAdminDiscount =
        !!grantedById || (plan.applied_coupon?.discount_source || '').toUpperCase() === 'ADMIN';
    const cycles = plan.applied_coupon?.apply_for_cycles;
    const cyclesLabel =
        isAdminDiscount && cycles != null
            ? `${plan.discount_cycles_applied ?? 0}/${cycles} payment${cycles === 1 ? '' : 's'} discounted`
            : null;
    const isPercentage = (applied.type || '').toUpperCase() === 'PERCENTAGE';
    const discountLabel = isPercentage
        ? applied.maxPoint
            ? t('coupon.percentageOffWithCap', {
                  point: applied.point,
                  amount: `${getCurrencySymbol(currency)}${applied.maxPoint}`,
              })
            : t('coupon.percentageOff', { point: applied.point })
        : t('coupon.amountOff', {
              amount: `${getCurrencySymbol(currency === 'N/A' ? 'INR' : currency)}${applied.point}`,
          });
    return (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-success-200 bg-success-50 px-2.5 py-1.5">
            <Tag className="size-3.5 shrink-0 text-success-600" weight="fill" />
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-xs font-semibold text-success-700">
                        {applied.code ||
                            (isAdminDiscount
                                ? t('coupon.adminDiscountLabel', { defaultValue: 'Discount' })
                                : t('coupon.defaultLabel'))}
                    </span>
                    {applied.point != null && (
                        <span className="text-xs text-success-600">{discountLabel}</span>
                    )}
                </div>
                {isAdminDiscount && (
                    <p
                        className="mt-0.5 text-2xs text-success-700"
                        title={plan.applied_coupon?.grant_reason || undefined}
                    >
                        {grantedByName ? `Discount by ${grantedByName}` : 'Admin discount'}
                        {plan.discount_granted_at &&
                            ` · ${formatDate(new Date(plan.discount_granted_at), 'dd MMM yyyy')}`}
                        {cyclesLabel && ` · ${cyclesLabel}`}
                    </p>
                )}
            </div>
        </div>
    );
};

const AutoRenewalBadge = ({ policy }: { policy: PolicyDetails | null }) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    if (!policy?.on_expiry_policy) return null;
    const isEnabled = policy.on_expiry_policy.enable_auto_renewal;
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1',
                            isEnabled
                                ? 'bg-success-50 text-success-700 ring-success-200'
                                : 'bg-neutral-100 text-neutral-600 ring-neutral-200'
                        )}
                    >
                        {isEnabled ? (
                            <ArrowsClockwise className="size-3" />
                        ) : (
                            <Prohibit className="size-3" />
                        )}
                        {isEnabled ? t('autoRenewal.enabled') : t('autoRenewal.disabled')}
                    </span>
                </TooltipTrigger>
                <TooltipContent>
                    {isEnabled
                        ? t('autoRenewal.paymentAttemptOn', {
                              date: policy.on_expiry_policy.next_payment_attempt_date
                                  ? format(
                                        new Date(policy.on_expiry_policy.next_payment_attempt_date),
                                        'MMM dd, yyyy'
                                    )
                                  : t('autoRenewal.scheduledDate'),
                          })
                        : t('autoRenewal.disabledTooltip')}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

const PolicyDetailsSection = ({
    policy,
    compact = false,
}: {
    policy: PolicyDetails | null;
    compact?: boolean;
}) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    const [isExpanded, setIsExpanded] = useState(false);
    if (!policy) return null;
    const hasExpiryPolicy = policy.on_expiry_policy !== null;
    const hasReenrollmentPolicy = policy.reenrollment_policy !== null;
    const hasPolicyActions = policy.policy_actions && policy.policy_actions.length > 0;
    if (!hasExpiryPolicy && !hasReenrollmentPolicy && !hasPolicyActions) return null;

    return (
        <div className="mt-2 space-y-2">
            {hasExpiryPolicy && (
                <div className="space-y-1.5 rounded-md bg-neutral-50 p-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                            {t('policy.expiryPolicy')}
                        </span>
                        <AutoRenewalBadge policy={policy} />
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                        {policy.on_expiry_policy?.final_expiry_date && (
                            <div className="flex items-center gap-1">
                                <Calendar className="size-3 text-danger-500" />
                                <span className="text-neutral-600">
                                    {t('policy.finalDate', {
                                        date: format(
                                            new Date(policy.on_expiry_policy.final_expiry_date),
                                            'MMM dd, yyyy'
                                        ),
                                    })}
                                </span>
                            </div>
                        )}
                        {policy.on_expiry_policy?.waiting_period_in_days !== undefined &&
                            policy.on_expiry_policy.waiting_period_in_days > 0 && (
                                <div className="flex items-center gap-1">
                                    <Clock className="size-3 text-warning-500" />
                                    <span className="text-neutral-600">
                                        {t('policy.gracePeriod', {
                                            count: policy.on_expiry_policy.waiting_period_in_days,
                                        })}
                                    </span>
                                </div>
                            )}
                    </div>
                </div>
            )}

            {hasReenrollmentPolicy && (
                <div className="rounded-md bg-neutral-50 p-2">
                    <div className="flex items-center gap-2 text-xs">
                        {policy.reenrollment_policy?.allow_reenrollment_after_expiry ? (
                            <>
                                <CheckCircle className="size-3 text-success-500" />
                                <span className="text-neutral-600">
                                    {policy.reenrollment_policy.next_eligible_enrollment_date
                                        ? t('policy.reenrollmentFrom', {
                                              date: format(
                                                  new Date(
                                                      policy.reenrollment_policy.next_eligible_enrollment_date
                                                  ),
                                                  'MMM dd, yyyy'
                                              ),
                                          })
                                        : t('policy.reenrollmentAvailable')}
                                    {policy.reenrollment_policy.reenrollment_gap_in_days > 0 && (
                                        <span className="ml-1 text-neutral-400">
                                            {t('policy.gapDays', {
                                                count: policy.reenrollment_policy
                                                    .reenrollment_gap_in_days,
                                            })}
                                        </span>
                                    )}
                                </span>
                            </>
                        ) : (
                            <>
                                <Prohibit className="size-3 text-danger-500" />
                                <span className="text-neutral-500">
                                    {t('policy.reenrollmentNotAllowed')}
                                </span>
                            </>
                        )}
                    </div>
                </div>
            )}

            {hasPolicyActions && !compact && (
                <div className="overflow-hidden rounded-md bg-neutral-50">
                    <button
                        type="button"
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex w-full items-center justify-between p-2 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100"
                    >
                        <span className="uppercase tracking-wide">
                            {t('policy.actionsCount', { count: policy.policy_actions.length })}
                        </span>
                        {isExpanded ? (
                            <CaretUp className="size-3" />
                        ) : (
                            <CaretDown className="size-3" />
                        )}
                    </button>
                    {isExpanded && (
                        <div className="px-2 pb-2">
                            <PolicyActionsTimeline actions={policy.policy_actions} compact />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// Pick the days-left tone for headline + progress + status label.
const getDaysLeftTone = (
    t: TFunction,
    daysLeft: number | null
): { color: string; status: string } => {
    if (daysLeft === null) {
        return { color: 'text-neutral-500', status: t('daysLeft.noExpiry') };
    }
    if (daysLeft >= 180) {
        return { color: 'text-success-600', status: t('daysLeft.activeSession') };
    }
    if (daysLeft >= 30) {
        return { color: 'text-warning-600', status: t('daysLeft.renewalDueSoon') };
    }
    return { color: 'text-danger-600', status: t('daysLeft.urgentRenewal') };
};

const PlanCard = ({
    plan,
    enrollmentStatus,
    onChangePlan,
    onRenew,
    onRemarks,
    onChangeEndDate,
}: {
    plan: UserPlan;
    enrollmentStatus: 'ACTIVE' | 'INACTIVE' | 'TERMINATED' | null;
    /** Absent in the history dialog — past plans are not switchable. */
    onChangePlan?: (plan: UserPlan) => void;
    /** Record an offline renewal payment and extend access. */
    onRenew?: (plan: UserPlan) => void;
    /** Admin remarks on this membership. */
    onRemarks?: (plan: UserPlan) => void;
    /** Correct when an active membership ends, without a payment. */
    onChangeEndDate?: (plan: UserPlan) => void;
}) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    const policy = getFirstPolicy(plan);
    const courseLabel = getCourseLabel(plan, t);
    // CPO-backed memberships are excluded from both: their price comes from an installment
    // schedule that a plan swap or a manual renewal would leave unreconciled.
    const canChangePlan = Boolean(onChangePlan) && plan.status === 'ACTIVE' && !isCpoPlan(plan);
    const canRenew =
        Boolean(onRenew) &&
        (plan.status === 'ACTIVE' || LAPSED_STATUSES.includes(plan.status)) &&
        !isCpoPlan(plan);
    // Lapsed memberships come back through Renew manually, which records what was paid.
    const canChangeEndDate = Boolean(onChangeEndDate) && plan.status === 'ACTIVE';
    const planName = getPlanName(plan, t);
    const daysLeft = computeDaysLeft(plan.end_date);
    const tone = getDaysLeftTone(t, daysLeft);
    const expiryLabel = getExpiryLabel(plan);
    const amount = getPlanAmount(plan);
    const currency = getPlanCurrency(plan);
    const appliedCoupon = parseAppliedCoupon(plan);
    const couponDiscount = computeCouponDiscount(amount, appliedCoupon);
    const finalAmount = Math.max(0, amount - couponDiscount);
    const hasCouponDiscount = couponDiscount > 0 && finalAmount < amount;

    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-3 transition-all duration-200 hover:border-primary-200 hover:shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2.5">
                    <div className="rounded-md bg-primary-50 p-1.5">
                        <Clock className="size-4 text-primary-600" />
                    </div>
                    {/* The payment PLAN leads, not the payment option — the plan is what
                        the learner is billed on and what a plan change moves them between.
                        The course and the option follow as context. */}
                    <div className="min-w-0 flex-1">
                        <h4
                            className="truncate text-xs font-semibold text-neutral-900"
                            title={planName}
                        >
                            {planName}
                        </h4>
                        <p className="mt-0.5 truncate text-xs text-neutral-500" title={courseLabel}>
                            {courseLabel}
                        </p>
                        <span className="mt-1 inline-flex max-w-full items-center truncate rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                            {getOptionName(plan, t)}
                        </span>
                    </div>
                </div>
                <TrendUp className={cn('size-3.5 shrink-0', tone.color)} />
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <PlanStatusBadge status={plan.payment_plan_dto?.status || plan.status} />
                <EnrollmentStatusBadge enrollmentStatus={enrollmentStatus} />
            </div>

            {daysLeft !== null && (
                <div className="mb-3">
                    <div className="mb-1 flex items-baseline gap-1.5">
                        <span className={cn('text-base font-bold', tone.color)}>{daysLeft}</span>
                        <span className="text-xs text-neutral-500">{t('daysLeft.label')}</span>
                    </div>
                    <ProgressBar progress={daysLeft} />
                    <p className="mt-1 text-center text-xs text-neutral-500">{tone.status}</p>
                </div>
            )}

            <div className="grid grid-cols-1 gap-1.5 text-xs text-neutral-600 sm:grid-cols-2">
                {plan.start_date && (
                    <div className="flex items-center gap-1">
                        <Calendar className="size-3 text-neutral-400" />
                        <span>
                            {t('dates.started', {
                                date: formatDate(new Date(plan.start_date), 'dd MMM yyyy'),
                            })}
                        </span>
                    </div>
                )}
                {expiryLabel && (
                    <div className="flex items-center gap-1">
                        <Calendar className="size-3 text-neutral-400" />
                        <span>{t('dates.ends', { date: expiryLabel })}</span>
                    </div>
                )}
                {currency !== 'N/A' && amount > 0 && (
                    <div className="flex items-center gap-1">
                        <CurrencyDollar className="size-3 text-neutral-400" />
                        {hasCouponDiscount ? (
                            <span className="flex items-baseline gap-1">
                                <span className="text-neutral-400 line-through">
                                    {getCurrencySymbol(currency)}
                                    {amount}
                                </span>
                                <span className="font-semibold text-success-700">
                                    {getCurrencySymbol(currency)}
                                    {finalAmount}
                                </span>
                            </span>
                        ) : (
                            <span>
                                {getCurrencySymbol(currency)}
                                {amount}
                            </span>
                        )}
                    </div>
                )}
            </div>

            <CouponAppliedRow plan={plan} currency={currency} />

            <PolicyDetailsSection policy={policy} compact />

            {/* CPO-backed memberships are excluded: their price comes from an installment
                schedule that a plan swap would leave unreconciled. */}
            {(canChangePlan || canRenew || canChangeEndDate || onRemarks) && (
                <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-2">
                    {onRemarks && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => onRemarks(plan)}
                        >
                            <ChatText className="mr-1 size-3" />
                            {t('remarks.button')}
                        </MyButton>
                    )}
                    {canRenew && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => onRenew?.(plan)}
                        >
                            <CurrencyDollar className="mr-1 size-3" />
                            {t('manualRenewal.button')}
                        </MyButton>
                    )}
                    {canChangeEndDate && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => onChangeEndDate?.(plan)}
                        >
                            <CalendarCheck className="mr-1 size-3" />
                            {t('endDate.button')}
                        </MyButton>
                    )}
                    {canChangePlan && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => onChangePlan?.(plan)}
                        >
                            <ArrowsClockwise className="mr-1 size-3" />
                            {t('changePlan.button')}
                        </MyButton>
                    )}
                </div>
            )}
        </div>
    );
};

const StudentPlanDetails = ({ userId, instituteId }: StudentPlanDetailsProps) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    const { selectedStudent } = useStudentSidebar();
    const [activePlans, setActivePlans] = useState<UserPlan[]>([]);
    const [isLoadingActive, setIsLoadingActive] = useState(false);
    const [showHistoryDialog, setShowHistoryDialog] = useState(false);
    const [allPlans, setAllPlans] = useState<UserPlan[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [planToChange, setPlanToChange] = useState<UserPlan | null>(null);
    const [lapsedPlans, setLapsedPlans] = useState<UserPlan[]>([]);
    const [planToRenew, setPlanToRenew] = useState<UserPlan | null>(null);
    const [planForRemarks, setPlanForRemarks] = useState<UserPlan | null>(null);
    const [planForEndDate, setPlanForEndDate] = useState<UserPlan | null>(null);
    const pageSize = 5;
    // The dialog needs an explicit institute id; the prop is optional here because most
    // callers let the service derive it from the token.
    const resolvedInstituteId = instituteId || getInstituteId() || '';

    // The selected learner row's package_session_id reflects the batch the admin
    // is viewing them under. If the admin marked them INACTIVE in this batch, we
    // tag the matching plan card with "Course Inactive" even though the plan is
    // still running — because the user asked for that signal here.
    const filteredPackageSessionId = selectedStudent?.package_session_id;
    const filteredEnrollmentStatus = selectedStudent?.status;

    const resolveEnrollmentStatus = useCallback(
        (plan: UserPlan): 'ACTIVE' | 'INACTIVE' | 'TERMINATED' | null => {
            if (!filteredPackageSessionId || !filteredEnrollmentStatus) return null;
            const planPsId = getFirstPolicy(plan)?.package_session_id;
            if (!planPsId || planPsId !== filteredPackageSessionId) return null;
            return filteredEnrollmentStatus;
        },
        [filteredPackageSessionId, filteredEnrollmentStatus]
    );

    const loadActivePlans = useCallback(async () => {
        if (!userId) return;
        try {
            setIsLoadingActive(true);
            const [response, lapsed] = await Promise.all([
                getUserPlans(1, 50, ['ACTIVE'], userId, instituteId),
                // Lapsed memberships stay visible so an admin can renew them by hand.
                getUserPlans(1, 20, LAPSED_STATUSES, userId, instituteId).catch(() => null),
            ]);
            setActivePlans(response.content || []);
            setLapsedPlans(lapsed?.content || []);
        } catch (error) {
            console.error('Error loading active plans:', error);
        } finally {
            setIsLoadingActive(false);
        }
    }, [userId, instituteId]);

    useEffect(() => {
        loadActivePlans();
    }, [loadActivePlans]);

    const handleViewHistory = async () => {
        if (!userId) return;
        try {
            setShowHistoryDialog(true);
            setCurrentPage(1);
            setIsLoadingHistory(true);
            const response = await getUserPlans(
                1,
                pageSize,
                ['ACTIVE', 'EXPIRED'],
                userId,
                instituteId
            );
            setAllPlans(response.content || []);
            setTotalPages(response.totalPages || 1);
        } catch (error) {
            console.error('Error loading plan history:', error);
            toast.error(t('toast.loadHistoryFailed'));
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const handlePageChange = async (pageNo: number) => {
        if (!userId) return;
        try {
            setIsLoadingHistory(true);
            const response = await getUserPlans(
                pageNo,
                pageSize,
                ['ACTIVE', 'EXPIRED'],
                userId,
                instituteId
            );
            setAllPlans(response.content || []);
            setCurrentPage(pageNo);
            setTotalPages(response.totalPages || 1);
        } catch (error) {
            console.error('Error loading page:', error);
            toast.error(t('toast.loadPageFailed'));
        } finally {
            setIsLoadingHistory(false);
        }
    };

    return (
        <>
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-neutral-800">
                        {t('heading.activeMemberships')}
                    </h3>
                    {activePlans.length > 0 && (
                        <MyButton onClick={handleViewHistory} buttonType="secondary" scale="small">
                            <Eye className="mr-1 size-3" />
                            {t('heading.viewHistory')}
                        </MyButton>
                    )}
                </div>

                {isLoadingActive ? (
                    <div className="flex items-center justify-center py-6">
                        <DashboardLoader />
                    </div>
                ) : activePlans.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-md bg-info-50 p-3 text-xs text-info-700 ring-1 ring-info-200">
                        <Warning className="size-4 shrink-0" />
                        <span>{t('emptyState.noActivePlans')}</span>
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {activePlans
                            .slice()
                            .sort((a, b) => {
                                const ad = a.end_date ? new Date(a.end_date).getTime() : Infinity;
                                const bd = b.end_date ? new Date(b.end_date).getTime() : Infinity;
                                return ad - bd;
                            })
                            .map((plan) => (
                                <PlanCard
                                    key={plan.id}
                                    plan={plan}
                                    enrollmentStatus={resolveEnrollmentStatus(plan)}
                                    onChangePlan={setPlanToChange}
                                    onRenew={setPlanToRenew}
                                    onRemarks={setPlanForRemarks}
                                    onChangeEndDate={setPlanForEndDate}
                                />
                            ))}
                    </div>
                )}

                {!isLoadingActive && lapsedPlans.length > 0 && (
                    <div className="space-y-2.5 pt-1">
                        <h3 className="text-sm font-semibold text-neutral-800">
                            {t('heading.lapsedMemberships')}
                        </h3>
                        {lapsedPlans.map((plan) => (
                            <PlanCard
                                key={plan.id}
                                plan={plan}
                                enrollmentStatus={resolveEnrollmentStatus(plan)}
                                onRenew={setPlanToRenew}
                                onRemarks={setPlanForRemarks}
                            />
                        ))}
                    </div>
                )}
            </div>

            <ManualRenewalDialog
                open={Boolean(planToRenew)}
                onOpenChange={(open) => {
                    if (!open) setPlanToRenew(null);
                }}
                userPlanId={planToRenew?.id ?? null}
                instituteId={resolvedInstituteId}
                planLabel={planToRenew ? getCourseLabel(planToRenew, t) : undefined}
                onRenewed={loadActivePlans}
            />

            <ChangeEndDateDialog
                open={Boolean(planForEndDate)}
                onOpenChange={(open) => {
                    if (!open) setPlanForEndDate(null);
                }}
                userPlanId={planForEndDate?.id ?? null}
                instituteId={resolvedInstituteId}
                currentEndDate={planForEndDate?.end_date ?? null}
                planLabel={planForEndDate ? getCourseLabel(planForEndDate, t) : undefined}
                onChanged={loadActivePlans}
            />

            <PlanRemarksDialog
                open={Boolean(planForRemarks)}
                onOpenChange={(open) => {
                    if (!open) setPlanForRemarks(null);
                }}
                userPlanId={planForRemarks?.id ?? null}
                instituteId={resolvedInstituteId}
                planLabel={planForRemarks ? getCourseLabel(planForRemarks, t) : undefined}
            />

            <ChangePlanDialog
                open={Boolean(planToChange)}
                onOpenChange={(open) => {
                    if (!open) setPlanToChange(null);
                }}
                userPlanId={planToChange?.id ?? null}
                instituteId={resolvedInstituteId}
                // Not react-query here — this component owns its plans in local state, so
                // just re-run the same loader rather than introducing a second cache.
                onChanged={loadActivePlans}
            />

            <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
                <DialogContent className="max-h-screen max-w-2xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{t('heading.membershipHistory')}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3 py-2">
                        {isLoadingHistory ? (
                            <div className="flex items-center justify-center py-6">
                                <DashboardLoader />
                            </div>
                        ) : allPlans.length === 0 ? (
                            <div className="flex items-center gap-2 rounded-md bg-info-50 p-3 text-sm text-info-700 ring-1 ring-info-200">
                                <Warning className="size-4 shrink-0" />
                                <span>{t('emptyState.noPlansFound')}</span>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-2.5">
                                    {allPlans.map((plan) => (
                                        <PlanCard
                                            key={plan.id}
                                            plan={plan}
                                            enrollmentStatus={resolveEnrollmentStatus(plan)}
                                        />
                                    ))}
                                </div>

                                {totalPages > 1 && (
                                    <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
                                        <span className="text-sm text-neutral-600">
                                            {t('pagination.pageOf', {
                                                current: currentPage,
                                                total: totalPages,
                                            })}
                                        </span>
                                        <div className="flex gap-2">
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                disable={currentPage === 1 || isLoadingHistory}
                                                onClick={() => handlePageChange(currentPage - 1)}
                                            >
                                                {t('pagination.previous')}
                                            </MyButton>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                disable={
                                                    currentPage === totalPages || isLoadingHistory
                                                }
                                                onClick={() => handlePageChange(currentPage + 1)}
                                            >
                                                {t('pagination.next')}
                                            </MyButton>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default StudentPlanDetails;
