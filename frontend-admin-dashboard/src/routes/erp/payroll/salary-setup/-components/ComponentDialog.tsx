import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Info } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
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
import { reportApiError } from '@/lib/report-api-error';
import { hrKeys, saveSalaryComponent } from '@/routes/erp/-shared/hr-service';
import type { ComponentType, SalaryComponentDTO } from '@/routes/erp/-shared/hr-types';
import { COMPONENT_CATEGORY_OPTIONS, COMPONENT_TYPE_OPTIONS } from './salary-meta';

const buildSchema = (t: TFunction) =>
    z.object({
        name: z.string().trim().min(1, t('validation.nameRequired')),
        code: z
            .string()
            .trim()
            .min(2, t('validation.codeMin'))
            .regex(/^[A-Z0-9_]+$/, t('validation.codePattern')),
        type: z.enum(['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION']),
        category: z.enum(['FIXED', 'VARIABLE', 'STATUTORY']),
        is_taxable: z.boolean(),
        is_statutory: z.boolean(),
        display_order: z.string().regex(/^\d*$/, t('validation.wholeNumbers')),
        gl_account_code: z.string().trim().max(64, t('validation.glAccountMax')),
        description: z.string().trim().max(500, t('validation.descriptionMax')),
    });

type ComponentFormValues = z.infer<ReturnType<typeof buildSchema>>;

const emptyValues: ComponentFormValues = {
    name: '',
    code: '',
    type: 'EARNING',
    category: 'FIXED',
    is_taxable: true,
    is_statutory: false,
    display_order: '',
    gl_account_code: '',
    description: '',
};

interface ComponentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** `null` to create; a component to edit. */
    component: SalaryComponentDTO | null;
    /** Uppercase codes already in use, so a duplicate is caught before the round trip. */
    existingCodes: string[];
}

/**
 * Add or edit one salary component.
 *
 * The code field is the load-bearing one: the payroll engine resolves template
 * rows and formula variables by code, so it is normalised to uppercase as the
 * user types and validated against the codes already in use — a duplicate or a
 * code with a space produces components the engine silently never matches.
 */
export const ComponentDialog = ({
    open,
    onOpenChange,
    component,
    existingCodes,
}: ComponentDialogProps) => {
    const { t } = useTranslation('erpComponentDialog');
    const queryClient = useQueryClient();
    const isEdit = !!component?.id;
    const schema = useMemo(() => buildSchema(t), [t]);

    const form = useForm<ComponentFormValues>({
        resolver: zodResolver(schema),
        defaultValues: emptyValues,
        mode: 'onBlur',
    });

    useEffect(() => {
        if (!open) return;
        form.reset(
            component
                ? {
                      name: component.name ?? '',
                      code: (component.code ?? '').toUpperCase(),
                      type: (component.type ?? 'EARNING') as ComponentFormValues['type'],
                      category: (['FIXED', 'VARIABLE', 'STATUTORY'].includes(
                          (component.category ?? '').toUpperCase()
                      )
                          ? (component.category ?? '').toUpperCase()
                          : 'FIXED') as ComponentFormValues['category'],
                      is_taxable: component.is_taxable ?? true,
                      is_statutory: component.is_statutory ?? false,
                      display_order:
                          component.display_order === undefined || component.display_order === null
                              ? ''
                              : String(component.display_order),
                      gl_account_code: component.gl_account_code ?? '',
                      description: component.description ?? '',
                  }
                : emptyValues
        );
    }, [open, component, form]);

    const mutation = useMutation({
        mutationFn: (payload: SalaryComponentDTO) => saveSalaryComponent(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: hrKeys.salaryComponents() });
            queryClient.invalidateQueries({ queryKey: hrKeys.salaryTemplates() });
            toast.success(isEdit ? t('toast.updated') : t('toast.created'));
            onOpenChange(false);
        },
        onError: (error) => {
            reportApiError(error, {
                feature: 'erp-salary',
                tags: { action: isEdit ? 'update-component' : 'create-component' },
                fallbackMessage: t('toast.saveError'),
            });
        },
    });

    const onSubmit = async (values: ComponentFormValues) => {
        const code = values.code.toUpperCase();
        const clash = existingCodes.some(
            (existing) => existing === code && code !== (component?.code ?? '').toUpperCase()
        );
        if (clash) {
            form.setError('code', {
                message: t('validation.codeDuplicate'),
            });
            return;
        }

        await mutation.mutateAsync({
            ...(component?.id ? { id: component.id } : {}),
            name: values.name,
            code,
            type: values.type as ComponentType,
            category: values.category,
            is_taxable: values.is_taxable,
            is_statutory: values.is_statutory,
            display_order: values.display_order === '' ? 0 : Number(values.display_order),
            gl_account_code: values.gl_account_code || undefined,
            description: values.description || undefined,
            // Not editable here — preserved so a save never silently retires a component.
            is_active: component?.is_active ?? true,
        });
    };

    return (
        <MyDialog
            heading={isEdit ? t('dialog.headingEdit') : t('dialog.headingNew')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('dialog.saving')}
                    >
                        {isEdit ? t('dialog.saveChanges') : t('dialog.createComponent')}
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
                    <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                        <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                        <span>{t('info')}</span>
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
                            name="code"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('form.codeLabel')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t('form.codePlaceholder')}
                                            className="w-full font-mono sm:w-full"
                                            required
                                            input={field.value}
                                            name={field.name}
                                            onBlur={field.onBlur}
                                            onChangeFunction={(event) =>
                                                field.onChange(
                                                    event.target.value
                                                        .toUpperCase()
                                                        .replace(/\s+/g, '_')
                                                )
                                            }
                                        />
                                    </FormControl>
                                    <FormDescription className="text-caption text-neutral-500">
                                        {t('form.codeDescription')}
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <SelectField
                            control={form.control}
                            name="type"
                            label={t('form.typeLabel')}
                            required
                            options={COMPONENT_TYPE_OPTIONS}
                            className="w-full sm:w-full"
                        />

                        <SelectField
                            control={form.control}
                            name="category"
                            label={t('form.categoryLabel')}
                            required
                            options={COMPONENT_CATEGORY_OPTIONS}
                            className="w-full sm:w-full"
                        />

                        <FormField
                            control={form.control}
                            name="display_order"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('form.displayOrderLabel')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="number"
                                            inputPlaceholder={t('form.displayOrderPlaceholder')}
                                            className="w-full sm:w-full"
                                            input={field.value}
                                            name={field.name}
                                            onBlur={field.onBlur}
                                            onChangeFunction={(event) =>
                                                field.onChange(event.target.value)
                                            }
                                        />
                                    </FormControl>
                                    <FormDescription className="text-caption text-neutral-500">
                                        {t('form.displayOrderDescription')}
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="gl_account_code"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('form.glAccountLabel')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t('form.glAccountPlaceholder')}
                                            className="w-full font-mono sm:w-full"
                                            input={field.value}
                                            name={field.name}
                                            onBlur={field.onBlur}
                                            onChangeFunction={(event) =>
                                                field.onChange(event.target.value)
                                            }
                                        />
                                    </FormControl>
                                    <FormDescription className="text-caption text-neutral-500">
                                        {t('form.glAccountDescription')}
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
                        <FormField
                            control={form.control}
                            name="is_taxable"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center gap-2">
                                    <FormControl>
                                        <Checkbox
                                            checked={field.value}
                                            onCheckedChange={(checked) =>
                                                field.onChange(checked === true)
                                            }
                                        />
                                    </FormControl>
                                    <FormLabel className="!mt-0 text-body text-neutral-600">
                                        {t('form.taxableLabel')}
                                    </FormLabel>
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="is_statutory"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center gap-2">
                                    <FormControl>
                                        <Checkbox
                                            checked={field.value}
                                            onCheckedChange={(checked) =>
                                                field.onChange(checked === true)
                                            }
                                        />
                                    </FormControl>
                                    <FormLabel className="!mt-0 text-body text-neutral-600">
                                        {t('form.statutoryLabel')}
                                    </FormLabel>
                                </FormItem>
                            )}
                        />
                    </div>

                    <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('form.descriptionLabel')}</FormLabel>
                                <FormControl>
                                    <Textarea
                                        {...field}
                                        placeholder={t('form.descriptionPlaceholder')}
                                        className="text-body"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </form>
            </Form>
        </MyDialog>
    );
};
