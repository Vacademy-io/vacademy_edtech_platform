import { useTranslation } from 'react-i18next';
import { PencilSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/formatters';
import type { EmployeeProfileDTO } from '@/routes/erp/-shared/hr-types';
import { DetailField, EmploymentStatusChip, humanizeToken } from './EmployeeFields';

/**
 * The read view of an employee profile.
 *
 * PAN/UAN are shown exactly as the API returned them — masked for most callers.
 * Nothing here un-masks them; editing is where a fresh value is supplied.
 */
export function EmployeeProfileTab({
    employee,
    canEdit,
    onEdit,
}: {
    employee: EmployeeProfileDTO;
    canEdit: boolean;
    onEdit: () => void;
}) {
    const { t } = useTranslation('erpEmployeeProfileTab');
    return (
        <div className="flex flex-col gap-6">
            <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
                    <CardTitle className="text-title">{t('sections.profile')}</CardTitle>
                    {canEdit && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={onEdit}
                        >
                            <PencilSimple size={16} /> {t('edit')}
                        </MyButton>
                    )}
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <DetailField label={t('fields.employeeCode')} value={employee.employee_code} />
                    <DetailField label={t('fields.name')} value={employee.full_name} />
                    <DetailField
                        label={t('fields.employmentStatus')}
                        value={<EmploymentStatusChip status={employee.employment_status} />}
                    />
                    <DetailField label={t('fields.email')} value={employee.email} />
                    <DetailField label={t('fields.mobile')} value={employee.mobile_number} />
                    <DetailField
                        label={t('fields.employmentType')}
                        value={humanizeToken(employee.employment_type)}
                    />
                    <DetailField label={t('fields.department')} value={employee.department_name} />
                    <DetailField label={t('fields.designation')} value={employee.designation_name} />
                    <DetailField
                        label={t('fields.reportingManager')}
                        value={employee.reporting_manager_name}
                    />
                    <DetailField
                        label={t('fields.joinDate')}
                        value={employee.join_date ? formatDate(employee.join_date) : ''}
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
                    <DetailField label={t('fields.nationality')} value={employee.nationality} />
                </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-title">{t('sections.emergencyContact')}</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-2">
                        <DetailField label={t('fields.name')} value={employee.emergency_contact_name} />
                        <DetailField label={t('fields.phone')} value={employee.emergency_contact_phone} />
                        <DetailField
                            label={t('fields.relation')}
                            value={employee.emergency_contact_relation}
                        />
                        <DetailField label={t('fields.bloodGroup')} value={employee.blood_group} />
                        <DetailField
                            label={t('fields.maritalStatus')}
                            value={humanizeToken(employee.marital_status)}
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-title">{t('sections.statutoryIdentifiers')}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <DetailField label={t('fields.pan')} value={employee.pan_number} />
                            <DetailField label={t('fields.uan')} value={employee.uan_number} />
                        </div>
                        <p className="text-caption text-muted-foreground">
                            {t('maskedNumbersHint')}
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
