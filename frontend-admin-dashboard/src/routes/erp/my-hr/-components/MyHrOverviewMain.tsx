import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import {
    ArrowRight,
    CalendarCheck,
    FileText,
    IdentificationCard,
    UserCircle,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { currentMonthValue, formatMonthValue } from '@/components/design-system/month-picker';
import { Card } from '@/components/ui/card';
import { formatDate } from '@/lib/formatters';
import {
    dateOnly,
    todayIso,
    toNumber as toCount,
} from '@/routes/erp/attendance/-components/attendance-meta';
import { formatDays } from '@/routes/erp/leave/-components/leave-meta';
import {
    HrErrorState,
    HrLoadingRows,
    HrEmptyState,
} from '@/routes/erp/people/-components/HrStates';
import {
    MyHrDetail,
    MyHrLoadingCards,
    MyHrNoProfileState,
    MyHrStat,
    monthKey,
} from './my-hr-shared';
import { CheckInOutCard } from './CheckInOutCard';
import {
    selfCheckInAvailable,
    useMyAttendanceConfig,
    useMyAttendanceMonth,
    useMyHrIdentity,
    useMyLeaveBalances,
    useMyPayslips,
} from '@/routes/erp/my-hr/-hooks/use-my-hr';

/**
 * The employee's own HR home.
 *
 * Ordered by how often it is needed rather than by how the data is stored:
 * checking in is a daily act, the month's attendance is a weekly glance, leave
 * balance a monthly one, and the payslip a monthly link out. Everything on this
 * page is read-only except the single check-in button — the employee's own
 * record is theirs to see, not to edit, and pretending otherwise would produce
 * fields that always fail to save.
 */
export const MyHrOverviewMain = () => {
    const { t } = useTranslation('erpMyHrOverviewMain');
    const { profile, employeeId, isProfileLoading, hasNoProfile } = useMyHrIdentity();
    const period = useMemo(() => currentMonthValue(), []);
    const year = period.year;

    const configQuery = useMyAttendanceConfig();
    const attendanceQuery = useMyAttendanceMonth(employeeId, period.month, period.year);
    const balancesQuery = useMyLeaveBalances(employeeId, year);
    const payslipsQuery = useMyPayslips(employeeId, year);

    const records = useMemo(() => attendanceQuery.data ?? [], [attendanceQuery.data]);

    const today = useMemo(() => {
        const iso = todayIso();
        return records.find((record) => dateOnly(record.attendance_date) === iso);
    }, [records]);

    /**
     * Counted from the month's own records, not from a summary endpoint: the
     * summary is HR-staff only, and an employee comparing "12 present" against
     * the days they can see listed has to get the same answer.
     */
    const monthCounts = useMemo(() => {
        const tally = { present: 0, absent: 0, leave: 0, halfDay: 0 };
        for (const record of records) {
            switch ((record.status ?? '').toUpperCase()) {
                case 'PRESENT':
                    tally.present += 1;
                    break;
                case 'ABSENT':
                    tally.absent += 1;
                    break;
                case 'ON_LEAVE':
                    tally.leave += 1;
                    break;
                case 'HALF_DAY':
                    tally.halfDay += 1;
                    break;
                default:
                    break;
            }
        }
        return tally;
    }, [records]);

    const balances = useMemo(
        () =>
            [...(balancesQuery.data ?? [])].sort((a, b) =>
                (a.leave_type_name ?? '').localeCompare(b.leave_type_name ?? '')
            ),
        [balancesQuery.data]
    );

    /** Newest first by year then month — payslips arrive in no guaranteed order. */
    const latestPayslip = useMemo(() => {
        const sorted = [...(payslipsQuery.data ?? [])].sort(
            (a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.month ?? 0) - (a.month ?? 0)
        );
        return sorted[0];
    }, [payslipsQuery.data]);

    if (isProfileLoading) return <HrLoadingRows rows={4} />;
    if (hasNoProfile) return <MyHrNoProfileState />;

    const checkInOffered = selfCheckInAvailable(configQuery.data?.mode);

    return (
        <div className="flex flex-col gap-6">
            <p className="max-w-3xl text-body text-muted-foreground">{t('pageIntro')}</p>

            <Card className="flex flex-col gap-4 p-4 sm:p-6">
                <div className="flex items-center gap-2">
                    <UserCircle size={18} className="text-primary-500" />
                    <h2 className="text-title text-foreground">
                        {profile?.full_name?.trim() || t('yourProfileFallback')}
                    </h2>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <MyHrDetail label={t('employeeCodeLabel')} value={profile?.employee_code} />
                    <MyHrDetail label={t('departmentLabel')} value={profile?.department_name} />
                    <MyHrDetail label={t('designationLabel')} value={profile?.designation_name} />
                    <MyHrDetail
                        label={t('joinedLabel')}
                        value={profile?.join_date ? formatDate(profile.join_date) : ''}
                    />
                    <MyHrDetail
                        label={t('reportingToLabel')}
                        value={profile?.reporting_manager_name}
                    />
                    <MyHrDetail label={t('workEmailLabel')} value={profile?.email} />
                </div>
                {(profile?.pan_number || profile?.uan_number) && (
                    <div className="flex flex-col gap-3 border-t border-border pt-4">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {profile?.pan_number && (
                                <MyHrDetail label={t('panLabel')} value={profile.pan_number} />
                            )}
                            {profile?.uan_number && (
                                <MyHrDetail label={t('uanLabel')} value={profile.uan_number} />
                            )}
                        </div>
                        <p className="flex items-start gap-2 text-caption text-muted-foreground">
                            <IdentificationCard size={14} className="mt-0.5 shrink-0" />
                            {t('idNumberNote')}
                        </p>
                    </div>
                )}
            </Card>

            {checkInOffered && (
                <CheckInOutCard
                    today={today}
                    employeeId={employeeId}
                    isLoading={attendanceQuery.isLoading}
                />
            )}

            <section className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <CalendarCheck size={18} className="text-primary-500" />
                    <h2 className="text-title text-foreground">
                        {t('monthSoFarHeading', { period: formatMonthValue(period) })}
                    </h2>
                </div>
                {attendanceQuery.isLoading ? (
                    <HrLoadingRows rows={1} />
                ) : attendanceQuery.isError ? (
                    <HrErrorState
                        message={t('attendanceLoadError')}
                        onRetry={() => void attendanceQuery.refetch()}
                    />
                ) : records.length === 0 ? (
                    <HrEmptyState
                        title={t('nothingRecordedTitle')}
                        description={t('nothingRecordedDescription', {
                            period: formatMonthValue(period),
                        })}
                    />
                ) : (
                    <div className="flex flex-wrap gap-3">
                        <MyHrStat
                            label={t('presentLabel')}
                            value={monthCounts.present}
                            tone="positive"
                        />
                        <MyHrStat label={t('onLeaveLabel')} value={monthCounts.leave} />
                        <MyHrStat
                            label={t('absentLabel')}
                            value={monthCounts.absent}
                            tone={monthCounts.absent > 0 ? 'negative' : 'default'}
                        />
                        {monthCounts.halfDay > 0 && (
                            <MyHrStat label={t('halfDaysLabel')} value={monthCounts.halfDay} />
                        )}
                        <MyHrStat
                            label={t('daysRecordedLabel')}
                            value={records.length}
                            hint={monthKey(period.year, period.month)}
                        />
                    </div>
                )}
            </section>

            <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-title text-foreground">
                        {t('leaveLeftHeading', { year })}
                    </h2>
                    <Link to="/erp/my-hr/leave">
                        <MyButton buttonType="text" scale="small" type="button">
                            {t('applyForLeaveButton')} <ArrowRight size={14} />
                        </MyButton>
                    </Link>
                </div>
                {balancesQuery.isLoading ? (
                    <MyHrLoadingCards />
                ) : balancesQuery.isError ? (
                    <HrErrorState
                        message={t('leaveBalanceLoadError')}
                        onRetry={() => void balancesQuery.refetch()}
                    />
                ) : balances.length === 0 ? (
                    <HrEmptyState
                        title={t('noLeaveBalanceTitle')}
                        description={t('noLeaveBalanceDescription')}
                    />
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {balances.map((balance) => (
                            <Card
                                key={balance.id ?? balance.leave_type_id}
                                className="flex flex-col gap-1 p-4"
                            >
                                <span className="text-caption text-muted-foreground">
                                    {balance.leave_type_name || t('leaveFallback')}
                                </span>
                                <span className="text-h3 font-semibold tabular-nums text-foreground">
                                    {formatDays(balance.closing_balance)}
                                </span>
                                <span className="text-caption text-muted-foreground">
                                    {t('daysLeftUsedOf', {
                                        used: formatDays(balance.used),
                                        total: formatDays(
                                            toCount(balance.opening_balance) +
                                                toCount(balance.accrued) +
                                                toCount(balance.carried_forward)
                                        ),
                                    })}
                                </span>
                            </Card>
                        ))}
                    </div>
                )}
            </section>

            <section className="flex flex-col gap-3">
                <h2 className="text-title text-foreground">{t('latestPayslipHeading')}</h2>
                {payslipsQuery.isLoading ? (
                    <HrLoadingRows rows={1} />
                ) : payslipsQuery.isError ? (
                    <HrErrorState
                        message={t('payslipsLoadError')}
                        onRetry={() => void payslipsQuery.refetch()}
                    />
                ) : !latestPayslip ? (
                    <HrEmptyState
                        icon={<FileText size={32} className="text-muted-foreground" />}
                        title={t('noPayslipTitle', { year })}
                        description={t('noPayslipDescription')}
                    >
                        <Link to="/erp/my-hr/payslips">
                            <MyButton buttonType="secondary" scale="small" type="button">
                                {t('checkAnotherYearButton')}
                            </MyButton>
                        </Link>
                    </HrEmptyState>
                ) : (
                    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                        <div className="flex flex-col gap-1">
                            <span className="text-subtitle font-medium text-foreground">
                                {formatMonthValue({
                                    month: latestPayslip.month ?? period.month,
                                    year: latestPayslip.year ?? year,
                                })}
                            </span>
                            <span className="text-caption text-muted-foreground">
                                {latestPayslip.generated_at
                                    ? t('issuedOn', { date: formatDate(latestPayslip.generated_at) })
                                    : t('readyToDownload')}
                            </span>
                        </div>
                        <Link to="/erp/my-hr/payslips">
                            <MyButton buttonType="secondary" scale="medium" type="button">
                                <FileText size={16} /> {t('goToPayslipsButton')}
                            </MyButton>
                        </Link>
                    </Card>
                )}
            </section>
        </div>
    );
};
