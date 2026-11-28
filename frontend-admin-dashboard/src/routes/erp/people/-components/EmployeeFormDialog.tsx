import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import SelectField from '@/components/design-system/select-field';
import { Form } from '@/components/ui/form';
import i18n from '@/i18n';
import { reportApiError } from '@/lib/report-api-error';
import type {
    DepartmentDTO,
    DesignationDTO,
    EmployeeProfileDTO,
} from '@/routes/erp/-shared/hr-types';
import { useCreateEmployee, useEmployeeOptions, useUpdateEmployee } from '../-hooks/use-hr-people';
import {
    buildEmploymentTypeOptions,
    buildUnchangedPlaceholder,
    NONE_VALUE,
    isMaskedValue,
    toSelectOptions,
    type SelectOption,
} from './EmployeeFields';
import { HrTextField } from './HrFormFields';

/**
 * Create or edit an employee profile.
 *
 * Every field is a string in the form and normalized on submit: a select left at
 * "None" and a text box left blank are both omitted from the payload rather than
 * sent as empty values, so a partially filled form never clears data the backend
 * already holds.
 */

const NAMESPACE = 'erpEmployeeFormDialog';

/**
 * `employeeSchema` is a module-scope singleton whose shape drives `EmployeeFormValues`
 * via `z.infer`, so it cannot be rebuilt inside the component with a `t` from
 * `useTranslation()` without breaking that type. Validation copy uses the shared
 * i18next singleton directly instead (same pattern as studyLibraryScheduleSchema).
 */
const schemaT: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

const employeeSchema = z.object({
    user_id: z.string(),
    employee_code: z.string(),
    join_date: z.string().min(1, schemaT('validation.joinDateRequired')),
    department_id: z.string(),
    designation_id: z.string(),
    reporting_manager_id: z.string(),
    employment_type: z.string(),
    notice_period_days: z.string().regex(/^\d*$/, schemaT('validation.noticePeriodWholeNumber')),
    nationality: z.string(),
    emergency_contact_name: z.string(),
    emergency_contact_phone: z.string(),
    emergency_contact_relation: z.string(),
    pan_number: z.string(),
    uan_number: z.string(),
});

type EmployeeFormValues = z.infer<typeof employeeSchema>;

/** `user_id` links the profile to a platform user; it can only be set at creation. */
const buildSchema = (isEdit: boolean) =>
    employeeSchema.superRefine((values, ctx) => {
        if (!isEdit && !values.user_id.trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['user_id'],
                message: schemaT('validation.userIdRequired'),
            });
        }
    });

const EMPTY_VALUES: EmployeeFormValues = {
    user_id: '',
    employee_code: '',
    join_date: '',
    department_id: NONE_VALUE,
    designation_id: NONE_VALUE,
    reporting_manager_id: NONE_VALUE,
    employment_type: NONE_VALUE,
    notice_period_days: '',
    nationality: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    emergency_contact_relation: '',
    pan_number: '',
    uan_number: '',
};

/** A masked value must never be echoed back, so it starts blank with an "unchanged" placeholder. */
const initialMaskable = (value: string | undefined): string =>
    isMaskedValue(value) ? '' : value ?? '';

const toFormValues = (employee: EmployeeProfileDTO | null | undefined): EmployeeFormValues => {
    if (!employee) return EMPTY_VALUES;
    return {
        user_id: employee.user_id ?? '',
        employee_code: employee.employee_code ?? '',
        join_date: (employee.join_date ?? '').slice(0, 10),
        department_id: employee.department_id || NONE_VALUE,
        designation_id: employee.designation_id || NONE_VALUE,
        reporting_manager_id: employee.reporting_manager_id || NONE_VALUE,
        employment_type: employee.employment_type || NONE_VALUE,
        notice_period_days:
            employee.notice_period_days === undefined || employee.notice_period_days === null
                ? ''
                : String(employee.notice_period_days),
        nationality: employee.nationality ?? '',
        emergency_contact_name: employee.emergency_contact_name ?? '',
        emergency_contact_phone: employee.emergency_contact_phone ?? '',
        emergency_contact_relation: employee.emergency_contact_relation ?? '',
        pan_number: initialMaskable(employee.pan_number),
        uan_number: initialMaskable(employee.uan_number),
    };
};

const textOrOmit = (value: string): string | undefined => {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};

const selectOrOmit = (value: string): string | undefined =>
    value && value !== NONE_VALUE ? value : undefined;

/**
 * A field whose stored value is masked on read. Blank means "leave it alone" — the
 * key is omitted entirely, because sending `****1234` back would persist the mask.
 */
const maskableOrOmit = (value: string): string | undefined => {
    const trimmed = value.trim();
    if (!trimmed || isMaskedValue(trimmed)) return undefined;
    return trimmed.toUpperCase();
};

interface EmployeeFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Present for edit, absent for create. */
    employee?: EmployeeProfileDTO | null;
    departments: DepartmentDTO[];
    designations: DesignationDTO[];
    onSaved?: () => void;
}

export function EmployeeFormDialog({
    open,
    onOpenChange,
    employee,
    departments,
    designations,
    onSaved,
}: EmployeeFormDialogProps) {
    const { t } = useTranslation(['erpEmployeeFormDialog', 'erpEmployeeFields']);
    const isEdit = !!employee?.id;
    const createEmployee = useCreateEmployee();
    const updateEmployee = useUpdateEmployee();

    // The manager list is only needed while the dialog is open.
    const managerQuery = useEmployeeOptions(open);

    const form = useForm<EmployeeFormValues>({
        resolver: zodResolver(buildSchema(isEdit)),
        defaultValues: toFormValues(employee),
        mode: 'onBlur',
    });

    useEffect(() => {
        if (open) form.reset(toFormValues(employee));
        // `form` is stable across renders; resetting on open keeps a reopened dialog honest.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, employee]);

    const departmentOptions = useMemo(
        () => toSelectOptions(departments, t('noDepartment')),
        [departments, t]
    );
    const designationOptions = useMemo(
        () => toSelectOptions(designations, t('noDesignation')),
        [designations, t]
    );
    const managerOptions = useMemo<SelectOption[]>(() => {
        const rows = (managerQuery.data?.content ?? []).filter(
            (row) => !!row.id && row.id !== employee?.id
        );
        return [
            { _id: NONE_VALUE, value: NONE_VALUE, label: t('noReportingManager') },
            ...rows.map((row) => ({
                _id: row.id as string,
                value: row.id as string,
                label: row.full_name || row.employee_code || (row.id as string),
            })),
        ];
    }, [managerQuery.data, employee?.id, t]);

    const employmentTypeOptions = useMemo<SelectOption[]>(
        () => [
            { _id: NONE_VALUE, value: NONE_VALUE, label: t('notSet') },
            ...buildEmploymentTypeOptions(t),
        ],
        [t]
    );

    const unchangedPlaceholder = useMemo(() => buildUnchangedPlaceholder(t), [t]);

    const panMasked = isEdit && isMaskedValue(employee?.pan_number);
    const uanMasked = isEdit && isMaskedValue(employee?.uan_number);

    const buildPayload = (values: EmployeeFormValues): EmployeeProfileDTO => {
        const noticeDays = values.notice_period_days.trim();
        return {
            ...(isEdit ? { id: employee?.id, user_id: employee?.user_id } : {}),
            ...(isEdit ? {} : { user_id: values.user_id.trim() }),
            employee_code: textOrOmit(values.employee_code),
            join_date: values.join_date,
            department_id: selectOrOmit(values.department_id),
            designation_id: selectOrOmit(values.designation_id),
            reporting_manager_id: selectOrOmit(values.reporting_manager_id),
            employment_type: selectOrOmit(values.employment_type),
            notice_period_days: noticeDays ? Number(noticeDays) : undefined,
            nationality: textOrOmit(values.nationality),
            emergency_contact_name: textOrOmit(values.emergency_contact_name),
            emergency_contact_phone: textOrOmit(values.emergency_contact_phone),
            emergency_contact_relation: textOrOmit(values.emergency_contact_relation),
            pan_number: maskableOrOmit(values.pan_number),
            uan_number: maskableOrOmit(values.uan_number),
        };
    };

    const onSubmit = async (values: EmployeeFormValues) => {
        const payload = buildPayload(values);
        try {
            if (isEdit && employee?.id) {
                await updateEmployee.mutateAsync({ id: employee.id, payload });
                toast.success(t('toast.updated'));
            } else {
                await createEmployee.mutateAsync(payload);
                toast.success(t('toast.added'));
            }
            onSaved?.();
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-people',
                tags: { 'erp.action': isEdit ? 'update-employee' : 'create-employee' },
                extra: { employeeId: employee?.id },
                fallbackMessage: isEdit
                    ? t('errors.updateFailed')
                    : t('errors.createFailed'),
            });
        }
    };

    return (
        <MyDialog
            heading={isEdit ? t('editEmployee') : t('addEmployee')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-3xl"
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
                        loadingText={isEdit ? t('saving') : t('adding')}
                    >
                        {isEdit ? t('saveChanges') : t('addEmployee')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-6"
                    noValidate
                >
                    <section className="flex flex-col gap-4">
                        <h3 className="text-subtitle text-foreground">
                            {t('sections.whoThisIsFor')}
                        </h3>
                        {!isEdit && (
                            <HrTextField
                                control={form.control}
                                name="user_id"
                                label={t('fields.userId.label')}
                                placeholder={t('fields.userId.placeholder')}
                                required
                                description={t('fields.userId.description')}
                            />
                        )}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <HrTextField
                                control={form.control}
                                name="employee_code"
                                label={t('fields.employeeCode.label')}
                                placeholder={t('fields.employeeCode.placeholder')}
                            />
                            <HrTextField
                                control={form.control}
                                name="join_date"
                                label={t('fields.joinDate.label')}
                                inputType="date"
                                required
                            />
                        </div>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h3 className="text-subtitle text-foreground">
                            {t('sections.roleInOrganisation')}
                        </h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <SelectField
                                control={form.control}
                                name="department_id"
                                label={t('fields.department')}
                                options={departmentOptions}
                                className="w-full sm:w-full"
                            />
                            <SelectField
                                control={form.control}
                                name="designation_id"
                                label={t('fields.designation')}
                                options={designationOptions}
                                className="w-full sm:w-full"
                            />
                            <SelectField
                                control={form.control}
                                name="reporting_manager_id"
                                label={t('fields.reportingManager')}
                                options={managerOptions}
                                className="w-full sm:w-full"
                            />
                            <SelectField
                                control={form.control}
                                name="employment_type"
                                label={t('fields.employmentType')}
                                options={employmentTypeOptions}
                                className="w-full sm:w-full"
                            />
                            <HrTextField
                                control={form.control}
                                name="notice_period_days"
                                label={t('fields.noticePeriod.label')}
                                placeholder={t('fields.noticePeriod.placeholder')}
                            />
                            <HrTextField
                                control={form.control}
                                name="nationality"
                                label={t('fields.nationality.label')}
                                placeholder={t('fields.nationality.placeholder')}
                            />
                        </div>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h3 className="text-subtitle text-foreground">
                            {t('sections.emergencyContact')}
                        </h3>
                        <div className="grid gap-4 sm:grid-cols-3">
                            <HrTextField
                                control={form.control}
                                name="emergency_contact_name"
                                label={t('fields.contactName.label')}
                                placeholder={t('fields.contactName.placeholder')}
                            />
                            <HrTextField
                                control={form.control}
                                name="emergency_contact_phone"
                                label={t('fields.contactPhone.label')}
                                inputType="tel"
                                placeholder={t('fields.contactPhone.placeholder')}
                            />
                            <HrTextField
                                control={form.control}
                                name="emergency_contact_relation"
                                label={t('fields.contactRelation.label')}
                                placeholder={t('fields.contactRelation.placeholder')}
                            />
                        </div>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h3 className="text-subtitle text-foreground">
                            {t('sections.statutoryIdentifiers')}
                        </h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <HrTextField
                                control={form.control}
                                name="pan_number"
                                label={t('fields.pan.label')}
                                placeholder={
                                    panMasked ? unchangedPlaceholder : t('fields.pan.placeholder')
                                }
                                description={panMasked ? t('maskedHint') : undefined}
                            />
                            <HrTextField
                                control={form.control}
                                name="uan_number"
                                label={t('fields.uan.label')}
                                placeholder={
                                    uanMasked ? unchangedPlaceholder : t('fields.uan.placeholder')
                                }
                                description={uanMasked ? t('maskedHint') : undefined}
                            />
                        </div>
                    </section>
                </form>
            </Form>
        </MyDialog>
    );
}
