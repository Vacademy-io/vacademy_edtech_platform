import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyTable } from '@/components/design-system/table';
import { Badge } from '@/components/ui/badge';
import type {
    MembershipDetail,
    MembershipStatus,
    MembershipDetailsResponse,
    PolicyDetails,
} from '@/types/membership-expiry';
import { format } from 'date-fns';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { MyPagination } from '@/components/design-system/pagination';
import { ArrowClockwise, Calendar, Clock, Prohibit, CheckCircle } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
    data: MembershipDetailsResponse | undefined;
    isLoading: boolean;
    error: Error | null;
    currentPage: number;
    onPageChange: (page: number) => void;
}

const columnHelper = createColumnHelper<MembershipDetail>();

// Helper to get the first policy or null
const getFirstPolicy = (detail: MembershipDetail): PolicyDetails | null => {
    // Check top-level policy_details first
    if (detail.policy_details && detail.policy_details.length > 0) {
        return detail.policy_details[0] || null;
    }
    // Fallback to user_plan's policy_details
    if (detail.user_plan?.policy_details && detail.user_plan.policy_details.length > 0) {
        return detail.user_plan.policy_details[0] || null;
    }
    return null;
};

// Auto-Renewal Badge Component
const AutoRenewalBadge = ({ policy, t }: { policy: PolicyDetails | null; t: TFunction }) => {
    if (!policy?.on_expiry_policy) return null;

    const isEnabled = policy.on_expiry_policy.enable_auto_renewal;

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                        {isEnabled ? (
                            <Badge
                                variant="outline"
                                className="flex items-center gap-1 border-green-200 bg-green-50 text-green-700"
                            >
                                <ArrowClockwise className="size-3" />
                                {t('autoRenewal')}
                            </Badge>
                        ) : (
                            <Badge
                                variant="outline"
                                className="flex items-center gap-1 border-gray-200 bg-gray-50 text-gray-500"
                            >
                                <Prohibit className="size-3" />
                                {t('noAutoRenewal')}
                            </Badge>
                        )}
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    {isEnabled
                        ? t('paymentAttemptOn', {
                              date: policy.on_expiry_policy.next_payment_attempt_date
                                  ? format(new Date(policy.on_expiry_policy.next_payment_attempt_date), 'MMM dd, yyyy')
                                  : t('scheduledDate'),
                          })
                        : t('autoRenewalDisabled')}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

// Expiry Details Component
const ExpiryDetails = ({ policy, t }: { policy: PolicyDetails | null; t: TFunction }) => {
    if (!policy?.on_expiry_policy) return <span className="text-gray-400">—</span>;

    const { waiting_period_in_days, final_expiry_date } = policy.on_expiry_policy;

    return (
        <div className="space-y-1">
            {final_expiry_date && (
                <div className="flex items-center gap-1.5 text-sm">
                    <Calendar className="size-3 text-red-500" />
                    <span className="font-medium text-gray-700">
                        {format(new Date(final_expiry_date), 'MMM dd, yyyy')}
                    </span>
                </div>
            )}
            {waiting_period_in_days > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Clock className="size-3" />
                    <span>{t('gracePeriod', { count: waiting_period_in_days })}</span>
                </div>
            )}
        </div>
    );
};

// Re-enrollment Info Component
const ReenrollmentInfo = ({ policy, t }: { policy: PolicyDetails | null; t: TFunction }) => {
    if (!policy?.reenrollment_policy) return <span className="text-gray-400">—</span>;

    const {
        allow_reenrollment_after_expiry,
        next_eligible_enrollment_date,
        reenrollment_gap_in_days,
    } = policy.reenrollment_policy;

    if (!allow_reenrollment_after_expiry) {
        return (
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-600">
                {t('notAllowed')}
            </Badge>
        );
    }

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5">
                        <CheckCircle className="size-4 text-green-500" />
                        {next_eligible_enrollment_date ? (
                            <span className="text-sm text-gray-700">
                                {format(new Date(next_eligible_enrollment_date), 'MMM dd, yyyy')}
                            </span>
                        ) : (
                            <span className="text-sm text-green-600">{t('availableNow')}</span>
                        )}
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    {reenrollment_gap_in_days > 0
                        ? t('reenrollmentGap', { count: reenrollment_gap_in_days })
                        : t('reenrollImmediately')}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

export function MembershipExpiryTable({
    data,
    isLoading,
    error,
    currentPage,
    onPageChange,
}: Props) {
    const { t } = useTranslation('membershipExpiryMembershipExpiryTable');

    const statusLabels: Record<MembershipStatus, string> = {
        ENDED: t('status.ended'),
        ABOUT_TO_END: t('status.aboutToEnd'),
        LIFETIME: t('status.lifetime'),
        ACTIVE: t('status.active'),
    };

    const columns = useMemo<any>(
        () => [
            columnHelper.accessor((row) => row.user_details?.full_name, {
                id: 'full_name',
                header: t('columns.user'),
                cell: (info) => (
                    <div>
                        <div className="font-medium text-gray-900">
                            {info.getValue() ?? t('unknownUser')}
                        </div>
                        <div className="text-xs text-gray-500">
                            {info.row.original.user_details?.email}
                        </div>
                        <div className="text-xs text-gray-500">
                            {info.row.original.user_details?.mobile_number}
                        </div>
                    </div>
                ),
            }),
            columnHelper.accessor((row) => row.user_plan?.payment_plan_dto?.name, {
                id: 'plan_name',
                header: t('columns.plan'),
                cell: (info) => {
                    const policy = getFirstPolicy(info.row.original);
                    return (
                        <div>
                            <div className="font-medium">{info.getValue() ?? t('unknownPlan')}</div>
                            {policy?.package_session_name && (
                                <div className="text-xs text-gray-500">
                                    {policy.package_session_name}
                                </div>
                            )}
                            {info.row.original.package_sessions?.map((ps, idx) => {
                                const displayName = ps.name
                                    ? `${ps.package_name} ${ps.name}`
                                    : `${ps.package_name} - ${ps.session_name} (${ps.level_name})`;
                                return (
                                    <div key={idx} className="text-xs text-gray-500">
                                        {displayName}
                                    </div>
                                );
                            })}
                        </div>
                    );
                },
            }),
            columnHelper.accessor('membership_status', {
                header: t('columns.status'),
                cell: (info) => {
                    const status = info.getValue() as MembershipStatus;
                    let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
                    if (status === 'ENDED') variant = 'destructive';
                    if (status === 'ABOUT_TO_END') variant = 'secondary';
                    if (status === 'LIFETIME') variant = 'outline';
                    if (status === 'ACTIVE') variant = 'default';

                    return <Badge variant={variant}>{statusLabels[status]}</Badge>;
                },
            }),
            columnHelper.display({
                id: 'auto_renewal',
                header: t('columns.autoRenewal'),
                cell: (info) => {
                    const policy = getFirstPolicy(info.row.original);
                    return <AutoRenewalBadge policy={policy} t={t} />;
                },
            }),
            columnHelper.accessor((row) => row.user_plan?.end_date, {
                id: 'end_date',
                header: t('columns.planEndDate'),
                cell: (info) => {
                    const date = info.getValue();
                    return date ? format(new Date(date), 'MMM dd, yyyy') : t('notApplicable');
                },
            }),
            columnHelper.display({
                id: 'final_expiry',
                header: t('columns.finalExpiry'),
                cell: (info) => {
                    const policy = getFirstPolicy(info.row.original);
                    return <ExpiryDetails policy={policy} t={t} />;
                },
            }),
            columnHelper.display({
                id: 'reenrollment',
                header: t('columns.reenrollment'),
                cell: (info) => {
                    const policy = getFirstPolicy(info.row.original);
                    return <ReenrollmentInfo policy={policy} t={t} />;
                },
            }),
        ],
        [t]
    );

    const tableData = useMemo(() => {
        if (!data) return undefined;
        return {
            content: data.content,
            total_elements: data.totalElements,
            total_pages: data.totalPages,
            page_no: data.number,
            page_size: data.size,
            last: data.last,
        };
    }, [data]);

    if (error) {
        return <div className="p-4 text-center text-red-500">{t('errorLoadingData')}</div>;
    }

    return (
        <div className="space-y-4">
            <div className="rounded-md border">
                <MyTable
                    data={tableData}
                    columns={columns}
                    isLoading={isLoading}
                    error={error}
                    currentPage={currentPage}
                />
            </div>
            {data && (
                <MyPagination
                    currentPage={currentPage}
                    totalPages={data.totalPages}
                    onPageChange={onPageChange}
                />
            )}
        </div>
    );
}
