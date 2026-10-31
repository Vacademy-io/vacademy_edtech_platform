import { useEffect, useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Info, Plus, Trash, Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import SelectField from '@/components/design-system/select-field';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { getInstituteId } from '@/constants/helper';
import { reportApiError } from '@/lib/report-api-error';
import {
    fetchSalaryComponents,
    fetchSalaryTemplate,
    hrKeys,
    saveSalaryTemplate,
} from '@/routes/erp/-shared/hr-service';
import type {
    CalculationType,
    SalaryTemplateComponentDTO,
    SalaryTemplateDTO,
} from '@/routes/erp/-shared/hr-types';
import { CALCULATION_TYPE_OPTIONS, ComponentTypeChip, valueFieldFor } from './salary-meta';

const CALCULATION_TYPES = [
    'FIXED_AMOUNT',
    'PERCENTAGE_OF_BASIC',
    'PERCENTAGE_OF_CTC',
    'PERCENTAGE_OF_GROSS',
    'FORMULA',
] as const;

const numericString = (message: string) =>
    z.string().refine((value) => value === '' || Number.isFinite(Number(value)), message);

const buildRowSchema = (t: TFunction) =>
    z
        .object({
            row_id: z.string(),
            component_id: z.string().min(1, t('validation.componentRequired')),
            calculation_type: z.enum(CALCULATION_TYPES),
            fixed_value: numericString(t('validation.amountNumber')),
            percentage_value: numericString(t('validation.percentageNumber')),
            formula: z.string(),
            min_value: numericString(t('validation.minNumber')),
            max_value: numericString(t('validation.maxNumber')),
            display_order: z.string().regex(/^\d*$/, t('validation.wholeNumbers')),
        })
        .superRefine((row, ctx) => {
            const field = valueFieldFor(row.calculation_type);
            if (field === 'fixed_value' && row.fixed_value === '') {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['fixed_value'],
                    message: t('validation.enterAmount'),
                });
            }
            if (field === 'percentage_value') {
                if (row.percentage_value === '') {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['percentage_value'],
                        message: t('validation.enterPercentage'),
                    });
                } else {
                    const numeric = Number(row.percentage_value);
                    if (numeric <= 0 || numeric > 100) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: ['percentage_value'],
                            message: t('validation.percentageRange'),
                        });
                    }
                }
            }
            if (field === 'formula' && row.formula.trim() === '') {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['formula'],
                    message: t('validation.enterFormula'),
                });
            }
            if (
                row.min_value !== '' &&
                row.max_value !== '' &&
                Number(row.min_value) > Number(row.max_value)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['max_value'],
                    message: t('validation.maxAtLeastMin'),
                });
            }
        });

const buildSchema = (t: TFunction) =>
    z.object({
        name: z.string().trim().min(1, t('validation.nameRequired')),
        description: z.string().trim().max(500, t('validation.descriptionMax')),
        is_default: z.boolean(),
        components: z.array(buildRowSchema(t)).min(1, t('validation.componentsMin')),
    });

type TemplateFormValues = z.infer<ReturnType<typeof buildSchema>>;
type TemplateRowValues = TemplateFormValues['components'][number];

const emptyRow = (order: number): TemplateRowValues => ({
    row_id: `new-${order}-${Math.random().toString(36).slice(2, 8)}`,
    component_id: '',
    calculation_type: 'FIXED_AMOUNT',
    fixed_value: '',
    percentage_value: '',
    formula: '',
    min_value: '',
    max_value: '',
    display_order: String(order),
});

const toNumber = (value: string): number | undefined =>
    value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value);

const moneyToString = (value: SalaryTemplateComponentDTO['fixed_value']): string =>
    value === undefined || value === null ? '' : String(value);

interface TemplateEditorDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** `null` to create a new template. */
    templateId: string | null;
    isHrAdmin: boolean;
}

/**
 * The full template editor.
 *
 * Deliberately one row per component with labelled fields rather than a dense
 * grid: which value field is even meaningful changes with the calculation type
 * (a FIXED_AMOUNT row has no percentage, a FORMULA row has neither), and a
 * spreadsheet-style grid would either show three dead inputs per row or silently
 * carry values the engine ignores.
 */
export const TemplateEditorDialog = ({
    open,
    onOpenChange,
    templateId,
    isHrAdmin,
}: TemplateEditorDialogProps) => {
    const { t } = useTranslation('erpTemplateEditorDialog');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const isEdit = !!templateId;
    const schema = useMemo(() => buildSchema(t), [t]);

    const templateQuery = useQuery({
        queryKey: hrKeys.salaryTemplate(templateId ?? 'new'),
        queryFn: () => fetchSalaryTemplate(templateId as string),
        enabled: open && !!templateId && !!instituteId,
    });

    const componentsQuery = useQuery({
        queryKey: hrKeys.salaryComponents(),
        queryFn: fetchSalaryComponents,
        enabled: open && !!instituteId,
    });

    const componentOptions = useMemo(
        () =>
            (componentsQuery.data ?? [])
                .filter((component) => !!component.id && component.is_active !== false)
                .map((component) => ({
                    label: `${component.code ?? '—'} · ${component.name ?? ''}`,
                    value: component.id as string,
                })),
        [componentsQuery.data]
    );

    const componentById = useMemo(() => {
        const map = new Map<string, { code?: string; type?: string }>();
        for (const component of componentsQuery.data ?? []) {
            if (component.id) map.set(component.id, { code: component.code, type: component.type });
        }
        return map;
    }, [componentsQuery.data]);

    const form = useForm<TemplateFormValues>({
        resolver: zodResolver(schema),
        defaultValues: { name: '', description: '', is_default: false, components: [emptyRow(1)] },
        mode: 'onBlur',
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: 'components',
        keyName: 'row_key',
    });

    const loadedTemplate = templateQuery.data;

    useEffect(() => {
        if (!open) return;
        if (isEdit && !loadedTemplate) return;

        form.reset(
            loadedTemplate
                ? {
                      name: loadedTemplate.name ?? '',
                      description: loadedTemplate.description ?? '',
                      is_default: loadedTemplate.is_default ?? false,
                      components: (loadedTemplate.components ?? []).map((component, index) => ({
                          row_id: component.id ?? `existing-${index}`,
                          component_id: component.component_id ?? '',
                          calculation_type: (CALCULATION_TYPES.includes(
                              (component.calculation_type ?? '') as CalculationType
                          )
                              ? component.calculation_type
                              : 'FIXED_AMOUNT') as TemplateRowValues['calculation_type'],
                          fixed_value: moneyToString(component.fixed_value),
                          percentage_value: moneyToString(component.percentage_value),
                          formula: component.formula ?? '',
                          min_value: moneyToString(component.min_value),
                          max_value: moneyToString(component.max_value),
                          display_order: String(component.display_order ?? index + 1),
                      })),
                  }
                : { name: '', description: '', is_default: false, components: [emptyRow(1)] }
        );
    }, [open, isEdit, loadedTemplate, form]);

    const mutation = useMutation({
        mutationFn: (payload: SalaryTemplateDTO) => saveSalaryTemplate(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: hrKeys.salaryTemplates() });
            if (templateId) {
                queryClient.invalidateQueries({ queryKey: hrKeys.salaryTemplate(templateId) });
            }
            toast.success(isEdit ? t('toast.updated') : t('toast.created'));
            onOpenChange(false);
        },
        onError: (error) => {
            reportApiError(error, {
                feature: 'erp-salary',
                tags: { action: isEdit ? 'update-template' : 'create-template' },
                fallbackMessage: t('toast.saveError'),
            });
        },
    });

    const onSubmit = async (values: TemplateFormValues) => {
        await mutation.mutateAsync({
            ...(templateId ? { id: templateId } : {}),
            name: values.name,
            description: values.description || undefined,
            is_default: values.is_default,
            status: loadedTemplate?.status ?? 'ACTIVE',
            components: values.components.map((row, index) => {
                const field = valueFieldFor(row.calculation_type);
                return {
                    ...(row.row_id.startsWith('new-') || row.row_id.startsWith('existing-')
                        ? {}
                        : { id: row.row_id }),
                    component_id: row.component_id,
                    calculation_type: row.calculation_type as CalculationType,
                    fixed_value: field === 'fixed_value' ? toNumber(row.fixed_value) : undefined,
                    percentage_value:
                        field === 'percentage_value' ? toNumber(row.percentage_value) : undefined,
                    formula: field === 'formula' ? row.formula.trim() : undefined,
                    min_value: toNumber(row.min_value),
                    max_value: toNumber(row.max_value),
                    display_order: row.display_order === '' ? index + 1 : Number(row.display_order),
                } satisfies SalaryTemplateComponentDTO;
            }),
        });
    };

    const isLoading = isEdit && templateQuery.isLoading;
    const readOnly = !isHrAdmin;

    return (
        <MyDialog
            heading={isEdit ? t('dialog.headingEdit') : t('dialog.headingNew')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-6xl"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onOpenChange(false)}
                    >
                        {readOnly ? t('dialog.close') : t('dialog.cancel')}
                    </MyButton>
                    {!readOnly && (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={form.handleSubmit(onSubmit)}
                            loadingText={t('dialog.saving')}
                        >
                            {isEdit ? t('dialog.saveTemplate') : t('dialog.createTemplate')}
                        </MyButton>
                    )}
                </>
            }
        >
            {isLoading ? (
                <DashboardLoader />
            ) : isEdit && templateQuery.isError ? (
                <div className="flex flex-col items-start gap-3">
                    <div className="flex items-center gap-2 text-body text-danger-600">
                        <Warning size={18} />
                        {t('dialog.loadError')}
                    </div>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onAsyncClick={async () => {
                            await templateQuery.refetch();
                        }}
                        loadingText={t('dialog.retrying')}
                    >
                        {t('dialog.retry')}
                    </MyButton>
                </div>
            ) : (
                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="flex flex-col gap-6"
                        noValidate
                    >
                        <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                            <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                            <span>
                                <Trans
                                    t={t}
                                    i18nKey="info"
                                    components={{
                                        bold1: <span className="font-semibold" />,
                                        bold2: <span className="font-semibold" />,
                                    }}
                                />
                            </span>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('form.nameLabel')}</FormLabel>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder={t('form.namePlaceholder')}
                                                className="w-full sm:w-full"
                                                required
                                                disabled={readOnly}
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

                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('form.descriptionLabel')}</FormLabel>
                                        <FormControl>
                                            <Textarea
                                                {...field}
                                                disabled={readOnly}
                                                placeholder={t('form.descriptionPlaceholder')}
                                                className="text-body"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="is_default"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center gap-2">
                                    <FormControl>
                                        <Checkbox
                                            checked={field.value}
                                            disabled={readOnly}
                                            onCheckedChange={(checked) =>
                                                field.onChange(checked === true)
                                            }
                                        />
                                    </FormControl>
                                    <FormLabel className="!mt-0 text-body text-neutral-600">
                                        {t('form.defaultLabel')}
                                    </FormLabel>
                                </FormItem>
                            )}
                        />

                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-subtitle text-neutral-700">
                                    {t('components.heading')}
                                </h3>
                                <span className="text-caption text-neutral-500">
                                    {t('components.rowCount', { count: fields.length })}
                                </span>
                            </div>

                            {form.formState.errors.components?.message && (
                                <p className="text-caption text-danger-600">
                                    {form.formState.errors.components.message}
                                </p>
                            )}

                            {fields.map((row, index) => (
                                <TemplateComponentRow
                                    key={row.row_key}
                                    index={index}
                                    form={form}
                                    t={t}
                                    componentOptions={componentOptions}
                                    componentsLoading={componentsQuery.isLoading}
                                    componentType={
                                        componentById.get(
                                            form.watch(`components.${index}.component_id`)
                                        )?.type
                                    }
                                    readOnly={readOnly}
                                    canRemove={fields.length > 1}
                                    onRemove={() => remove(index)}
                                />
                            ))}

                            {!readOnly && (
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    type="button"
                                    onClick={() => append(emptyRow(fields.length + 1))}
                                >
                                    <Plus size={16} />
                                    {t('components.addRow')}
                                </MyButton>
                            )}
                        </div>
                    </form>
                </Form>
            )}
        </MyDialog>
    );
};

interface TemplateComponentRowProps {
    index: number;
    // The parent's form instance — typed loosely on purpose: threading the exact
    // UseFormReturn generic through a row component buys nothing here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form: any;
    t: TFunction;
    componentOptions: { label: string; value: string }[];
    componentsLoading: boolean;
    componentType?: string;
    readOnly: boolean;
    canRemove: boolean;
    onRemove: () => void;
}

const TemplateComponentRow = ({
    index,
    form,
    t,
    componentOptions,
    componentsLoading,
    componentType,
    readOnly,
    canRemove,
    onRemove,
}: TemplateComponentRowProps) => {
    const calculationType = form.watch(
        `components.${index}.calculation_type`
    ) as TemplateRowValues['calculation_type'];
    const valueField = valueFieldFor(calculationType);

    return (
        <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                    <span className="text-caption text-neutral-500">
                        {t('components.row', { number: index + 1 })}
                    </span>
                    {componentType && <ComponentTypeChip type={componentType} />}
                </div>
                {!readOnly && canRemove && (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        type="button"
                        aria-label={t('components.removeRow', { number: index + 1 })}
                        onClick={onRemove}
                    >
                        <Trash size={16} className="text-danger-600" />
                    </MyButton>
                )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <FormField
                    control={form.control}
                    name={`components.${index}.component_id`}
                    render={({
                        field,
                    }: {
                        field: { value: string; onChange: (v: string) => void };
                    }) => (
                        <FormItem>
                            <FormLabel>{t('components.componentLabel')}</FormLabel>
                            <FormControl>
                                <SearchableSelect
                                    options={componentOptions}
                                    value={field.value}
                                    onChange={field.onChange}
                                    disabled={readOnly || componentsLoading}
                                    placeholder={
                                        componentsLoading
                                            ? t('components.componentLoading')
                                            : t('components.componentSelect')
                                    }
                                    searchPlaceholder={t('components.componentSearchPlaceholder')}
                                    emptyText={t('components.componentEmpty')}
                                    portal={false}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <SelectField
                    control={form.control}
                    name={`components.${index}.calculation_type`}
                    label={t('components.calculationLabel')}
                    required
                    disabled={readOnly}
                    options={CALCULATION_TYPE_OPTIONS}
                    className="w-full sm:w-full"
                />

                {valueField === 'fixed_value' && (
                    <FormField
                        control={form.control}
                        name={`components.${index}.fixed_value`}
                        render={({
                            field,
                        }: {
                            field: {
                                value: string;
                                name: string;
                                onBlur: () => void;
                                onChange: (v: string) => void;
                            };
                        }) => (
                            <FormItem>
                                <FormLabel>{t('components.monthlyAmountLabel')}</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="number"
                                        inputPlaceholder={t('components.monthlyAmountPlaceholder')}
                                        className="w-full sm:w-full"
                                        disabled={readOnly}
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
                )}

                {valueField === 'percentage_value' && (
                    <FormField
                        control={form.control}
                        name={`components.${index}.percentage_value`}
                        render={({
                            field,
                        }: {
                            field: {
                                value: string;
                                name: string;
                                onBlur: () => void;
                                onChange: (v: string) => void;
                            };
                        }) => (
                            <FormItem>
                                <FormLabel>{t('components.percentageLabel')}</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="number"
                                        inputPlaceholder={t('components.percentagePlaceholder')}
                                        className="w-full sm:w-full"
                                        disabled={readOnly}
                                        input={field.value}
                                        name={field.name}
                                        onBlur={field.onBlur}
                                        onChangeFunction={(event) =>
                                            field.onChange(event.target.value)
                                        }
                                    />
                                </FormControl>
                                <FormDescription className="text-caption text-neutral-500">
                                    {t('components.percentageDescription')}
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}

                {valueField === 'formula' && (
                    <FormField
                        control={form.control}
                        name={`components.${index}.formula`}
                        render={({
                            field,
                        }: {
                            field: {
                                value: string;
                                name: string;
                                onBlur: () => void;
                                onChange: (v: string) => void;
                            };
                        }) => (
                            <FormItem className="sm:col-span-2 lg:col-span-1">
                                <FormLabel>{t('components.formulaLabel')}</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="text"
                                        inputPlaceholder={t('components.formulaPlaceholder')}
                                        className="w-full font-mono sm:w-full"
                                        disabled={readOnly}
                                        input={field.value}
                                        name={field.name}
                                        onBlur={field.onBlur}
                                        onChangeFunction={(event) =>
                                            field.onChange(event.target.value)
                                        }
                                    />
                                </FormControl>
                                <FormDescription className="text-caption text-neutral-500">
                                    {t('components.formulaHelp')}
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}

                <FormField
                    control={form.control}
                    name={`components.${index}.min_value`}
                    render={({
                        field,
                    }: {
                        field: {
                            value: string;
                            name: string;
                            onBlur: () => void;
                            onChange: (v: string) => void;
                        };
                    }) => (
                        <FormItem>
                            <FormLabel>{t('components.minLabel')}</FormLabel>
                            <FormControl>
                                <MyInput
                                    inputType="number"
                                    inputPlaceholder={t('components.minPlaceholder')}
                                    className="w-full sm:w-full"
                                    disabled={readOnly}
                                    input={field.value}
                                    name={field.name}
                                    onBlur={field.onBlur}
                                    onChangeFunction={(event) => field.onChange(event.target.value)}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name={`components.${index}.max_value`}
                    render={({
                        field,
                    }: {
                        field: {
                            value: string;
                            name: string;
                            onBlur: () => void;
                            onChange: (v: string) => void;
                        };
                    }) => (
                        <FormItem>
                            <FormLabel>{t('components.maxLabel')}</FormLabel>
                            <FormControl>
                                <MyInput
                                    inputType="number"
                                    inputPlaceholder={t('components.maxPlaceholder')}
                                    className="w-full sm:w-full"
                                    disabled={readOnly}
                                    input={field.value}
                                    name={field.name}
                                    onBlur={field.onBlur}
                                    onChangeFunction={(event) => field.onChange(event.target.value)}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name={`components.${index}.display_order`}
                    render={({
                        field,
                    }: {
                        field: {
                            value: string;
                            name: string;
                            onBlur: () => void;
                            onChange: (v: string) => void;
                        };
                    }) => (
                        <FormItem>
                            <FormLabel>{t('components.displayOrderLabel')}</FormLabel>
                            <FormControl>
                                <MyInput
                                    inputType="number"
                                    inputPlaceholder={String(index + 1)}
                                    className="w-full sm:w-full"
                                    disabled={readOnly}
                                    input={field.value}
                                    name={field.name}
                                    onBlur={field.onBlur}
                                    onChangeFunction={(event) => field.onChange(event.target.value)}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};
