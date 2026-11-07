import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Info, Warning } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MoneyCell } from '@/components/design-system/money-cell';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import SelectField from '@/components/design-system/select-field';
import { StatusChip } from '@/components/design-system/status-chips';
import { MyTable, type TableData } from '@/components/design-system/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { getInstituteId } from '@/constants/helper';
import { reportApiError } from '@/lib/report-api-error';
import { EmployeePicker } from '@/routes/erp/-shared/EmployeePicker';
import {
    assignSalaryStructure,
    fetchSalaryStructures,
    fetchSalaryTemplates,
    hrKeys,
} from '@/routes/erp/-shared/hr-service';
import type { EmployeeSalaryStructureDTO } from '@/routes/erp/-shared/hr-types';
import { CURRENCY_OPTIONS } from './salary-meta';

const buildSchema = (t: TFunction) =>
    z.object({
        employee_id: z.string().min(1, t('employeeIdRequired')),
        template_id: z.string().min(1, t('templateIdRequired')),
        ctc_annual: z
            .string()
            .min(1, t('ctcRequired'))
            .refine(
                (value) => Number.isFinite(Number(value)) && Number(value) > 0,
                t('ctcAboveZero')
            ),
        effective_from: z.string().min(1, t('effectiveFromRequired')),
        currency: z.enum(['INR', 'AED', 'SAR']),
        revision_reason: z.string().trim().max(300, t('reasonMaxLength')),
    });

type AssignFormValues = z.infer<ReturnType<typeof buildSchema>>;

const defaultValues: AssignFormValues = {
    employee_id: '',
    template_id: '',
    ctc_annual: '',
    effective_from: '',
    currency: 'INR',
    revision_reason: '',
};

const formatRange = (t: TFunction, structure: EmployeeSalaryStructureDTO) =>
    `${structure.effective_from ?? '—'} → ${structure.effective_to ?? t('openStatus')}`;

/**
 * Put an employee on a salary structure at a CTC.
 *
 * Assigning is a supersede, not an edit: the backend closes the current ACTIVE
 * structure and opens a new one from `effective_from`, and it refuses a date at
 * or before the current structure's start. So the existing structures are shown
 * underneath the form — the user is about to replace one of them, and doing that
 * blind is how you discover a wrong CTC three payslips later.
 */
export const AssignTab = ({ isHrAdmin }: { isHrAdmin: boolean }) => {
    const { t } = useTranslation('erpAssignTab');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();

    const schema = useMemo(() => buildSchema(t), [t]);

    const form = useForm<AssignFormValues>({
        resolver: zodResolver(schema),
        defaultValues,
        mode: 'onBlur',
    });

    const employeeId = form.watch('employee_id');
    const templateId = form.watch('template_id');

    const templatesQuery = useQuery({
        queryKey: hrKeys.salaryTemplates(),
        queryFn: fetchSalaryTemplates,
        enabled: !!instituteId,
    });

    const structuresQuery = useQuery({
        queryKey: hrKeys.salaryStructures(employeeId),
        queryFn: () => fetchSalaryStructures(employeeId),
        enabled: !!instituteId && !!employeeId,
    });

    const templateOptions = useMemo(
        () =>
            (templatesQuery.data ?? [])
                .filter((template) => !!template.id)
                .map((template) => ({
                    label: template.is_default
                        ? `${template.name ?? 'Untitled'} (default)`
                        : template.name ?? 'Untitled',
                    value: template.id as string,
                })),
        [templatesQuery.data]
    );

    // Preselect the institute's default template — the right answer most of the time.
    useEffect(() => {
        if (templateId) return;
        const fallback = (templatesQuery.data ?? []).find((template) => template.is_default);
        if (fallback?.id) form.setValue('template_id', fallback.id);
    }, [templatesQuery.data, templateId, form]);

    const structures = useMemo(
        () =>
            [...(structuresQuery.data ?? [])].sort((a, b) =>
                (b.effective_from ?? '').localeCompare(a.effective_from ?? '')
            ),
        [structuresQuery.data]
    );

    const activeStructure = useMemo(
        () => structures.find((structure) => (structure.status ?? '').toUpperCase() === 'ACTIVE'),
        [structures]
    );

    const mutation = useMutation({
        mutationFn: assignSalaryStructure,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: hrKeys.salaryStructures(employeeId) });
            queryClient.invalidateQueries({ queryKey: hrKeys.employee(employeeId) });
            toast.success(t('assignSuccess'));
            form.reset({
                ...defaultValues,
                // Keep the employee selected so the refreshed history is right there.
                employee_id: employeeId,
                template_id: templateId,
                currency: form.getValues('currency'),
            });
        },
        onError: (error) => {
            reportApiError(error, {
                feature: 'erp-salary',
                tags: { action: 'assign-structure' },
                fallbackMessage: 'Could not assign the salary structure.',
            });
        },
    });

    const onSubmit = async (values: AssignFormValues) => {
        // Mirror the backend rule rather than let it 400: a new structure must start
        // strictly after the one it supersedes.
        if (
            activeStructure?.effective_from &&
            values.effective_from <= activeStructure.effective_from
        ) {
            form.setError('effective_from', {
                message: t('mustBeAfter', { date: activeStructure.effective_from }),
            });
            return;
        }

        await mutation.mutateAsync({
            employee_id: values.employee_id,
            template_id: values.template_id,
            ctc_annual: Number(values.ctc_annual),
            effective_from: values.effective_from,
            currency: values.currency,
            revision_reason: values.revision_reason || undefined,
        });
    };

    const columns = useMemo<ColumnDef<EmployeeSalaryStructureDTO>[]>(
        () => [
            {
                id: 'template_name',
                header: t('columnTemplate'),
                cell: ({ row }) => (
                    <span className="text-body text-neutral-700">
                        {row.original.template_name ?? '—'}
                    </span>
                ),
            },
            {
                id: 'effective',
                header: t('columnEffective'),
                cell: ({ row }) => (
                    <span className="text-body text-neutral-600">
                        {formatRange(t, row.original)}
                    </span>
                ),
            },
            {
                id: 'ctc_annual',
                header: t('columnCtc'),
                cell: ({ row }) => (
                    <MoneyCell
                        value={row.original.ctc_annual}
                        currency={row.original.currency}
                        showCurrency
                    />
                ),
            },
            {
                id: 'gross_monthly',
                header: t('columnGrossMonthly'),
                cell: ({ row }) => (
                    <MoneyCell
                        value={row.original.gross_monthly}
                        currency={row.original.currency}
                        dashOnZero
                    />
                ),
            },
            {
                id: 'status',
                header: t('columnStatus'),
                cell: ({ row }) => {
                    const status = (row.original.status ?? '').toUpperCase();
                    return (
                        <StatusChip
                            text={status === 'ACTIVE' ? t('statusCurrent') : t('statusSuperseded')}
                            textSize="text-caption"
                            status={status === 'ACTIVE' ? 'SUCCESS' : 'INFO'}
                            showIcon={false}
                        />
                    );
                },
            },
            {
                id: 'revision_reason',
                header: t('columnReason'),
                cell: ({ row }) => (
                    <span className="text-caption text-neutral-500">
                        {row.original.revision_reason ?? '—'}
                    </span>
                ),
            },
        ],
        [t]
    );

    const structureTableData: TableData<EmployeeSalaryStructureDTO> = {
        content: structures,
        total_pages: 1,
        page_no: 0,
        page_size: structures.length,
        total_elements: structures.length,
        last: true,
    };

    return (
        <div className="flex flex-col gap-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-title">{t('cardTitle')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form
                            onSubmit={form.handleSubmit(onSubmit)}
                            className="flex flex-col gap-4"
                            noValidate
                        >
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <FormField
                                    control={form.control}
                                    name="employee_id"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('employeeLabel')}</FormLabel>
                                            <FormControl>
                                                <EmployeePicker
                                                    value={field.value}
                                                    onChange={field.onChange}
                                                    disabled={!isHrAdmin}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="template_id"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('templateLabel')}</FormLabel>
                                            <FormControl>
                                                <SearchableSelect
                                                    options={templateOptions}
                                                    value={field.value}
                                                    onChange={field.onChange}
                                                    disabled={
                                                        !isHrAdmin || templatesQuery.isLoading
                                                    }
                                                    placeholder={
                                                        templatesQuery.isLoading
                                                            ? t('loadingTemplates')
                                                            : t('selectTemplate')
                                                    }
                                                    searchPlaceholder={t('searchTemplates')}
                                                    emptyText={t('noTemplatesYet')}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="ctc_annual"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('ctcLabel')}</FormLabel>
                                            <FormControl>
                                                <MyInput
                                                    inputType="number"
                                                    inputPlaceholder="600000"
                                                    className="w-full sm:w-full"
                                                    required
                                                    disabled={!isHrAdmin}
                                                    input={field.value}
                                                    name={field.name}
                                                    onBlur={field.onBlur}
                                                    onChangeFunction={(event) =>
                                                        field.onChange(event.target.value)
                                                    }
                                                />
                                            </FormControl>
                                            <FormDescription className="text-caption text-neutral-500">
                                                {t('ctcDescription')}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="effective_from"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('effectiveFromLabel')}</FormLabel>
                                            <FormControl>
                                                <MyInput
                                                    inputType="date"
                                                    inputPlaceholder="YYYY-MM-DD"
                                                    className="w-full sm:w-full"
                                                    required
                                                    disabled={!isHrAdmin}
                                                    input={field.value}
                                                    name={field.name}
                                                    onBlur={field.onBlur}
                                                    onChangeFunction={(event) =>
                                                        field.onChange(event.target.value)
                                                    }
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <SelectField
                                    control={form.control}
                                    name="currency"
                                    label={t('currencyLabel')}
                                    required
                                    disabled={!isHrAdmin}
                                    options={CURRENCY_OPTIONS}
                                    className="w-full sm:w-full"
                                />

                                {activeStructure && (
                                    <FormField
                                        control={form.control}
                                        name="revision_reason"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t('revisionReasonLabel')}</FormLabel>
                                                <FormControl>
                                                    <MyInput
                                                        inputType="text"
                                                        inputPlaceholder={t(
                                                            'revisionReasonPlaceholder'
                                                        )}
                                                        className="w-full sm:w-full"
                                                        disabled={!isHrAdmin}
                                                        input={field.value}
                                                        name={field.name}
                                                        onBlur={field.onBlur}
                                                        onChangeFunction={(event) =>
                                                            field.onChange(event.target.value)
                                                        }
                                                    />
                                                </FormControl>
                                                <FormDescription className="text-caption text-neutral-500">
                                                    {t('revisionReasonDescription')}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </div>

                            {activeStructure && (
                                <div className="flex items-start gap-2 rounded-md bg-warning-50 p-3 text-caption text-neutral-600">
                                    <Warning
                                        size={16}
                                        className="mt-0.5 shrink-0 text-warning-600"
                                    />
                                    <span>
                                        {t('supersedeWarning')}{' '}
                                        <span className="font-semibold">
                                            {activeStructure.effective_from ?? '—'}
                                        </span>
                                        {t('supersedeWarningSuffix')}
                                    </span>
                                </div>
                            )}

                            {!isHrAdmin && (
                                <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                                    <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                                    <span>{t('noAdminInfo')}</span>
                                </div>
                            )}

                            {isHrAdmin && (
                                <div className="flex justify-end">
                                    <MyButton
                                        buttonType="primary"
                                        scale="medium"
                                        onAsyncClick={form.handleSubmit(onSubmit)}
                                        loadingText={t('assigningLoading')}
                                    >
                                        {t('assignButton')}
                                    </MyButton>
                                </div>
                            )}
                        </form>
                    </Form>
                </CardContent>
            </Card>

            {!!employeeId && (
                <div className="flex flex-col gap-3">
                    <h3 className="text-subtitle text-neutral-700">
                        {t('existingStructuresHeading')}
                    </h3>

                    {structuresQuery.isError ? (
                        <Card>
                            <CardContent className="flex flex-col items-start gap-3 p-6">
                                <div className="flex items-center gap-2 text-body text-danger-600">
                                    <Warning size={18} />
                                    {t('loadStructuresError')}
                                </div>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onAsyncClick={async () => {
                                        await structuresQuery.refetch();
                                    }}
                                    loadingText={t('retrying')}
                                >
                                    {t('retry')}
                                </MyButton>
                            </CardContent>
                        </Card>
                    ) : !structuresQuery.isLoading && structures.length === 0 ? (
                        <Card>
                            <CardContent className="p-6 text-body text-neutral-600">
                                {t('noStructuresYet')}
                            </CardContent>
                        </Card>
                    ) : (
                        <MyTable<EmployeeSalaryStructureDTO>
                            data={structureTableData}
                            columns={columns}
                            isLoading={structuresQuery.isLoading}
                            error={null}
                            currentPage={0}
                            scrollable
                        />
                    )}
                </div>
            )}
        </div>
    );
};
