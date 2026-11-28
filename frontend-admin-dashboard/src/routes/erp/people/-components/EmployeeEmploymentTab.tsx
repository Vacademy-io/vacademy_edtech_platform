import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/formatters';
import type { EmployeeProfileDTO } from '@/routes/erp/-shared/hr-types';
import { DetailField, EmploymentStatusChip, humanizeToken, isExitStatus } from './EmployeeFields';
import { EmploymentStatusDialog } from './EmploymentStatusDialog';

/**
 * The employment lifecycle of one employee: the dates that mark it, and the one
 * control that moves it forward.
 */
export function EmployeeEmploymentTab({
    employee,
    canEdit,
}: {
    employee: EmployeeProfileDTO;
    canEdit: boolean;
}) {
    const { t } = useTranslation('erpEmployeeEmploymentTab');
    const [statusOpen, setStatusOpen] = useState(false);
    const exited = isExitStatus(employee.employment_status);

    const milestones: Array<{ label: string; value?: string }> = [
        { label: t('milestones.joined'), value: employee.join_date },
        { label: t('milestones.probationEnds'), value: employee.probation_end_date },
        { label: t('milestones.confirmed'), value: employee.confirmation_date },
        { label: t('milestones.resigned'), value: employee.resignation_date },
        { label: t('milestones.lastWorkingDay'), value: employee.last_working_date },
    ];

    return (
        <div className="flex flex-col gap-6">
            <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
                    <CardTitle className="text-title">{t('title')}</CardTitle>
                    {canEdit && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setStatusOpen(true)}
                        >
                            <ArrowsClockwise size={16} /> {t('changeStatus')}
                        </MyButton>
                    )}
                </CardHeader>
                <CardContent className="flex flex-col gap-6">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <DetailField
                            label={t('fields.currentStatus')}
                            value={<EmploymentStatusChip status={employee.employment_status} />}
                        />
                        <DetailField
                            label={t('fields.employmentType')}
                            value={humanizeToken(employee.employment_type)}
                        />
                        <DetailField
                            label={t('fields.noticePeriod')}
                            value={
                                employee.notice_period_days === undefined ||
                                employee.notice_period_days === null
                                    ? ''
                                    : t('noticePeriodDays', { count: employee.notice_period_days })
                            }
                        />
                    </div>

                    <ol className="flex flex-col gap-3 border-l border-border ps-4">
                        {milestones.map((milestone) => (
                            <li key={milestone.label} className="relative flex flex-col gap-0.5">
                                <span className="text-caption text-muted-foreground">
                                    {milestone.label}
                                </span>
                                <span className="text-body text-foreground">
                                    {milestone.value ? formatDate(milestone.value) : t('notRecorded')}
                                </span>
                            </li>
                        ))}
                    </ol>

                    {exited && (
                        <div className="flex flex-col gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4">
                            <span className="text-caption text-danger-700">
                                {t('employmentEnded', {
                                    status: humanizeToken(employee.employment_status),
                                })}
                            </span>
                            <span className="text-body text-danger-600">
                                {employee.exit_reason || t('noExitReason')}
                            </span>
                            <span className="text-caption text-danger-700">
                                {t('settlementHint')}
                            </span>
                        </div>
                    )}
                </CardContent>
            </Card>

            {statusOpen && (
                <EmploymentStatusDialog
                    open={statusOpen}
                    onOpenChange={setStatusOpen}
                    employee={employee}
                />
            )}
        </div>
    );
}
