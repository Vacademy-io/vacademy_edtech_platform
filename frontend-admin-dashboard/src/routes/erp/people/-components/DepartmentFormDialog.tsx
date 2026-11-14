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
import type { DepartmentDTO } from '@/routes/erp/-shared/hr-types';
import { useSaveDepartment } from '../-hooks/use-hr-people';
import { NONE_VALUE, type SelectOption } from './EmployeeFields';
import { HrTextField, HrTextareaField } from './HrFormFields';

const buildDepartmentSchema = (t: TFunction) =>
    z.object({
        name: z.string().min(1, t('errors.nameRequired')),
        code: z.string(),
        parent_id: z.string(),
        description: z.string(),
    });

type DepartmentFormValues = z.infer<ReturnType<typeof buildDepartmentSchema>>;

interface DepartmentFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Present for edit, absent for create. */
    department?: DepartmentDTO | null;
    /** All departments — used to offer a parent, minus the one being edited. */
    departments: DepartmentDTO[];
}

export function DepartmentFormDialog({
    open,
    onOpenChange,
    department,
    departments,
}: DepartmentFormDialogProps) {
    const { t } = useTranslation('erpDepartmentFormDialog');
    const isEdit = !!department?.id;
    const saveDepartment = useSaveDepartment();
    const departmentSchema = buildDepartmentSchema(t);

    const form = useForm<DepartmentFormValues>({
        resolver: zodResolver(departmentSchema),
        defaultValues: {
            name: department?.name ?? '',
            code: department?.code ?? '',
            parent_id: department?.parent_id || NONE_VALUE,
            description: department?.description ?? '',
        },
        mode: 'onBlur',
    });

    useEffect(() => {
        if (open) {
            form.reset({
                name: department?.name ?? '',
                code: department?.code ?? '',
                parent_id: department?.parent_id || NONE_VALUE,
                description: department?.description ?? '',
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, department]);

    // A department cannot be its own parent, and offering it would create a cycle.
    const parentOptions = useMemo<SelectOption[]>(
        () => [
            { _id: NONE_VALUE, value: NONE_VALUE, label: t('noParent') },
            ...departments
                .filter((row) => !!row.id && row.id !== department?.id)
                .map((row) => ({
                    _id: row.id as string,
                    value: row.id as string,
                    label: row.name || (row.id as string),
                })),
        ],
        [departments, department?.id, t]
    );

    const onSubmit = async (values: DepartmentFormValues) => {
        try {
            await saveDepartment.mutateAsync({
                ...(isEdit ? { id: department?.id } : {}),
                name: values.name.trim(),
                code: values.code.trim() || undefined,
                parent_id: values.parent_id === NONE_VALUE ? undefined : values.parent_id,
                description: values.description.trim() || undefined,
            });
            toast.success(isEdit ? t('toasts.updated') : t('toasts.added'));
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-people',
                tags: { 'erp.action': isEdit ? 'update-department' : 'create-department' },
                extra: { departmentId: department?.id },
                fallbackMessage: t('errors.saveFailed'),
            });
        }
    };

    return (
        <MyDialog
            heading={isEdit ? t('editHeading') : t('addHeading')}
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
                        loadingText={t('saving')}
                    >
                        {isEdit ? t('saveChanges') : t('addHeading')}
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
                    <HrTextField
                        control={form.control}
                        name="name"
                        label={t('fields.nameLabel')}
                        placeholder={t('fields.namePlaceholder')}
                        required
                    />
                    <HrTextField
                        control={form.control}
                        name="code"
                        label={t('fields.codeLabel')}
                        placeholder={t('fields.codePlaceholder')}
                        description={t('fields.codeHelp')}
                    />
                    <SelectField
                        control={form.control}
                        name="parent_id"
                        label={t('fields.parentLabel')}
                        options={parentOptions}
                        className="w-full sm:w-full"
                    />
                    <HrTextareaField
                        control={form.control}
                        name="description"
                        label={t('fields.descriptionLabel')}
                        placeholder={t('fields.descriptionPlaceholder')}
                    />
                </form>
            </Form>
        </MyDialog>
    );
}
