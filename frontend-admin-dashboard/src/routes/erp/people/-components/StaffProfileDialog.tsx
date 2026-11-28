import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import SelectField from '@/components/design-system/select-field';
import { Form } from '@/components/ui/form';
import { reportApiError } from '@/lib/report-api-error';
import type { DepartmentDTO, DesignationDTO, StaffBridgeRow } from '@/routes/erp/-shared/hr-types';
import { useCreateEmployeeFromStaff } from '../-hooks/use-hr-people';
import { NONE_VALUE, toSelectOptions } from './EmployeeFields';
import { HrTextField } from './HrFormFields';

/**
 * Turn someone already on the team into an HR employee.
 *
 * This is the short path: the user id, name and email come from the staff row, so
 * the dialog only asks for the few things HR adds on top. Join date defaults to
 * today because the common case is "we are onboarding HR now", not backfilling.
 */

const buildStaffProfileSchema = (t: TFunction) =>
    z.object({
        employee_code: z.string(),
        join_date: z.string().min(1, t('errors.joinDateRequired')),
        department_id: z.string(),
        designation_id: z.string(),
    });

type StaffProfileFormValues = z.infer<ReturnType<typeof buildStaffProfileSchema>>;

const today = (): string => new Date().toISOString().slice(0, 10);

interface StaffProfileDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    staff: StaffBridgeRow;
    departments: DepartmentDTO[];
    designations: DesignationDTO[];
}

export function StaffProfileDialog({
    open,
    onOpenChange,
    staff,
    departments,
    designations,
}: StaffProfileDialogProps) {
    const { t } = useTranslation('erpStaffProfileDialog');
    const createFromStaff = useCreateEmployeeFromStaff();
    const staffProfileSchema = buildStaffProfileSchema(t);

    const form = useForm<StaffProfileFormValues>({
        resolver: zodResolver(staffProfileSchema),
        defaultValues: {
            employee_code: '',
            join_date: today(),
            department_id: NONE_VALUE,
            designation_id: NONE_VALUE,
        },
        mode: 'onBlur',
    });

    useEffect(() => {
        if (open) {
            form.reset({
                employee_code: '',
                join_date: today(),
                department_id: NONE_VALUE,
                designation_id: NONE_VALUE,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, staff.user_id]);

    const departmentOptions = useMemo(
        () => toSelectOptions(departments, t('noDepartment')),
        [departments, t]
    );
    const designationOptions = useMemo(
        () => toSelectOptions(designations, t('noDesignation')),
        [designations, t]
    );

    const personLabel = staff.full_name || staff.email || t('thisPerson');

    const onSubmit = async (values: StaffProfileFormValues) => {
        if (!staff.user_id) return;
        try {
            await createFromStaff.mutateAsync({
                user_id: staff.user_id,
                employee_code: values.employee_code.trim() || undefined,
                join_date: values.join_date,
                department_id:
                    values.department_id === NONE_VALUE ? undefined : values.department_id,
                designation_id:
                    values.designation_id === NONE_VALUE ? undefined : values.designation_id,
            });
            toast.success(t('toasts.created', { name: personLabel }));
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-people',
                tags: { 'erp.action': 'create-employee-from-staff' },
                extra: { userId: staff.user_id },
                fallbackMessage: t('errors.createFailed', { name: personLabel }),
            });
        }
    };

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('creating')}
                    >
                        {t('createProfile')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-4"
                    noValidate
                >
                    <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted p-3">
                        <span className="text-body text-foreground">{personLabel}</span>
                        {staff.email && (
                            <span className="text-caption text-muted-foreground">
                                {staff.email}
                            </span>
                        )}
                    </div>

                    <HrTextField
                        control={form.control}
                        name="employee_code"
                        label={t('fields.employeeCodeLabel')}
                        placeholder={t('fields.employeeCodePlaceholder')}
                    />
                    <HrTextField
                        control={form.control}
                        name="join_date"
                        label={t('fields.joinDateLabel')}
                        inputType="date"
                        required
                    />
                    <SelectField
                        control={form.control}
                        name="department_id"
                        label={t('fields.departmentLabel')}
                        options={departmentOptions}
                        className="w-full sm:w-full"
                    />
                    <SelectField
                        control={form.control}
                        name="designation_id"
                        label={t('fields.designationLabel')}
                        options={designationOptions}
                        className="w-full sm:w-full"
                    />
                </form>
            </Form>
        </MyDialog>
    );
}
