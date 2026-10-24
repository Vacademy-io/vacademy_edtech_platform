import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Info } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { Card } from '@/components/ui/card';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatDate } from '@/lib/formatters';
import { reportApiError } from '@/lib/report-api-error';
import type { LeaveApplicationDTO } from '@/routes/erp/-shared/hr-types';
import {
    formatDays,
    humanizeToken,
    recentLeaveYears,
} from '@/routes/erp/leave/-components/leave-meta';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
} from '@/routes/erp/people/-components/HrStates';
import {
    useCancelMyLeave,
    useMyCompOffs,
    useMyHrIdentity,
    useMyLeaveApplications,
    useMyLeaveBalances,
} from '@/routes/erp/my-hr/-hooks/use-my-hr';
import { ApplyLeaveDialog } from './ApplyLeaveDialog';
import { MyHrLoadingCards, MyHrNoProfileState, MyHrStatusChip } from './my-hr-shared';

/** The statuses an employee may still withdraw — anything else is already settled. */
const CANCELLABLE = new Set(['PENDING', 'APPROVED']);

/**
 * The employee's own leave: what is left, what they have asked for, what they
 * have earned back as comp-off.
 *
 * Balance first and applications second, because the question that brings anyone
 * here is "can I take Friday off" — the list of past applications is the
 * follow-up, not the headline.
 */
export const MyLeaveMain = () => {
    const { t } = useTranslation('erpMyLeaveMain');
    const { employeeId, isProfileLoading, hasNoProfile } = useMyHrIdentity();
    const [year, setYear] = useState<number>(() => new Date().getFullYear());
    const [applyOpen, setApplyOpen] = useState(false);
    const [pendingCancel, setPendingCancel] = useState<LeaveApplicationDTO | null>(null);

    const balancesQuery = useMyLeaveBalances(employeeId, year);
    const applicationsQuery = useMyLeaveApplications(employeeId);
    const compOffsQuery = useMyCompOffs(employeeId);
    const cancelMutation = useCancelMyLeave();

    const balances = useMemo(
        () =>
            [...(balancesQuery.data ?? [])].sort((a, b) =>
                (a.leave_type_name ?? '').localeCompare(b.leave_type_name ?? '')
            ),
        [balancesQuery.data]
    );

    const applications = useMemo(
        () =>
            [...(applicationsQuery.data ?? [])].sort((a, b) =>
                (b.from_date ?? '').localeCompare(a.from_date ?? '')
            ),
        [applicationsQuery.data]
    );

    const compOffs = useMemo(
        () =>
            [...(compOffsQuery.data ?? [])].sort((a, b) =>
                (b.worked_on_date ?? '').localeCompare(a.worked_on_date ?? '')
            ),
        [compOffsQuery.data]
    );

    const confirmCancel = async () => {
        if (!pendingCancel?.id) return;
        try {
            await cancelMutation.mutateAsync(pendingCancel.id);
            toast.success(t('toast.withdrawn'));
            setPendingCancel(null);
        } catch (error) {
            // A cancellation the backend refuses (payroll has locked the month)
            // needs its own sentence, and the dialog is already closing — a toast
            // is the right place for this one.
            reportApiError(error, {
                feature: 'erp-my-hr',
                tags: { action: 'cancel-my-leave' },
                fallbackMessage: t('errors.withdraw'),
                toastDuration: 8000,
            });
            setPendingCancel(null);
        }
    };

    if (isProfileLoading) return <HrLoadingRows rows={4} />;
    if (hasNoProfile) return <MyHrNoProfileState />;

    return (
        <div className="flex flex-col gap-6">
            <p className="max-w-3xl text-body text-muted-foreground">{t('intro')}</p>

            <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <h2 className="text-title text-foreground">{t('balance.heading')}</h2>
                        <MyDropdown
                            currentValue={String(year)}
                            dropdownList={recentLeaveYears().map(String)}
                            handleChange={(value) => setYear(Number(value))}
                        />
                    </div>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        onClick={() => setApplyOpen(true)}
                    >
                        <CalendarPlus size={16} /> {t('applyForLeave')}
                    </MyButton>
                </div>

                {balancesQuery.isLoading ? (
                    <MyHrLoadingCards />
                ) : balancesQuery.isError ? (
                    <HrErrorState
                        message={t('errors.loadBalance')}
                        onRetry={() => void balancesQuery.refetch()}
                    />
                ) : balances.length === 0 ? (
                    <HrEmptyState
                        title={t('balance.emptyTitle', { year })}
                        description={t('balance.emptyDescription')}
                    />
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {balances.map((balance) => (
                            <Card
                                key={balance.id ?? balance.leave_type_id}
                                className="flex flex-col gap-1 p-4"
                            >
                                <span className="text-caption text-muted-foreground">
                                    {balance.leave_type_name || t('leave')}
                                </span>
                                <span className="text-h3 font-semibold tabular-nums text-foreground">
                                    {formatDays(balance.closing_balance)}
                                </span>
                                <span className="text-caption text-muted-foreground">
                                    {t('balance.daysLeftUsed', {
                                        used: formatDays(balance.used),
                                    })}
                                </span>
                            </Card>
                        ))}
                    </div>
                )}
            </section>

            <section className="flex flex-col gap-3">
                <h2 className="text-title text-foreground">{t('applications.heading')}</h2>
                {applicationsQuery.isLoading ? (
                    <HrLoadingRows rows={3} />
                ) : applicationsQuery.isError ? (
                    <HrErrorState
                        message={t('errors.loadApplications')}
                        onRetry={() => void applicationsQuery.refetch()}
                    />
                ) : applications.length === 0 ? (
                    <HrEmptyState
                        title={t('applications.emptyTitle')}
                        description={t('applications.emptyDescription')}
                    >
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            type="button"
                            onClick={() => setApplyOpen(true)}
                        >
                            {t('applyForLeave')}
                        </MyButton>
                    </HrEmptyState>
                ) : (
                    <div className="flex flex-col gap-2">
                        {applications.map((application) => {
                            const status = (application.status ?? '').toUpperCase();
                            const totalDaysCount = Number(application.total_days ?? 0);
                            return (
                                <Card
                                    key={application.id}
                                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="flex flex-col gap-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-subtitle font-medium text-foreground">
                                                {application.leave_type_name || t('leave')}
                                            </span>
                                            <MyHrStatusChip status={application.status} />
                                        </div>
                                        <span className="text-body text-muted-foreground">
                                            {application.from_date
                                                ? t('applications.dateRange', {
                                                      from: formatDate(application.from_date),
                                                      to: formatDate(
                                                          application.to_date ||
                                                              application.from_date
                                                      ),
                                                  })
                                                : '—'}
                                            {' · '}
                                            {t('applications.daysCount', {
                                                count: totalDaysCount,
                                                formatted: formatDays(application.total_days),
                                            })}
                                            {application.is_half_day
                                                ? application.half_day_type
                                                    ? t('applications.halfDayWithType', {
                                                          type: humanizeToken(
                                                              application.half_day_type
                                                          ),
                                                      })
                                                    : t('applications.halfDay')
                                                : ''}
                                        </span>
                                        {application.reason && (
                                            <span className="text-caption text-muted-foreground">
                                                {t('applications.youWrote', {
                                                    reason: application.reason,
                                                })}
                                            </span>
                                        )}
                                        {application.rejection_reason && (
                                            <span className="text-caption text-danger-600">
                                                {t('applications.turnedDown', {
                                                    reason: application.rejection_reason,
                                                })}
                                            </span>
                                        )}
                                    </div>
                                    {CANCELLABLE.has(status) && (
                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            type="button"
                                            className="w-full sm:w-auto"
                                            onClick={() => setPendingCancel(application)}
                                        >
                                            {t('withdraw')}
                                        </MyButton>
                                    )}
                                </Card>
                            );
                        })}
                    </div>
                )}
            </section>

            <section className="flex flex-col gap-3">
                <h2 className="text-title text-foreground">{t('compOff.heading')}</h2>
                <p className="max-w-3xl text-body text-muted-foreground">
                    {t('compOff.intro')}
                </p>
                {compOffsQuery.isLoading ? (
                    <HrLoadingRows rows={2} />
                ) : compOffsQuery.isError ? (
                    <HrErrorState
                        message={t('errors.loadCompOff')}
                        onRetry={() => void compOffsQuery.refetch()}
                    />
                ) : compOffs.length === 0 ? (
                    <HrEmptyState
                        title={t('compOff.emptyTitle')}
                        description={t('compOff.emptyDescription')}
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        {compOffs.map((compOff) => (
                            <Card
                                key={compOff.id}
                                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <div className="flex flex-col gap-1">
                                    <span className="text-body text-foreground">
                                        {t('compOff.worked', {
                                            date: compOff.worked_on_date
                                                ? formatDate(compOff.worked_on_date)
                                                : '—',
                                        })}
                                        {' · '}
                                        {t('compOff.daysEarned', {
                                            count: Number(compOff.earned_days ?? 0),
                                            formatted: formatDays(compOff.earned_days),
                                        })}
                                    </span>
                                    <span className="text-caption text-muted-foreground">
                                        {compOff.expiry_date
                                            ? t('compOff.expires', {
                                                  date: formatDate(compOff.expiry_date),
                                              })
                                            : t('compOff.noExpiry')}
                                        {compOff.used ? t('compOff.alreadyUsed') : ''}
                                    </span>
                                </div>
                                <MyHrStatusChip status={compOff.status} />
                            </Card>
                        ))}
                    </div>
                )}
            </section>

            <p className="flex items-start gap-2 text-caption text-muted-foreground">
                <Info size={14} className="mt-0.5 shrink-0" />
                {t('footerNote')}
            </p>

            {employeeId && (
                <ApplyLeaveDialog
                    open={applyOpen}
                    onOpenChange={setApplyOpen}
                    employeeId={employeeId}
                    balances={balances}
                />
            )}

            <AlertDialog
                open={!!pendingCancel}
                onOpenChange={(open) => !open && setPendingCancel(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('cancelDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {pendingCancel
                                ? t('cancelDialog.description', {
                                      leaveType: pendingCancel.leave_type_name || t('leave'),
                                      date: pendingCancel.from_date
                                          ? formatDate(pendingCancel.from_date)
                                          : t('cancelDialog.thatDate'),
                                  })
                                : ''}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('keepIt')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void confirmCancel()}>
                            {t('withdraw')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
