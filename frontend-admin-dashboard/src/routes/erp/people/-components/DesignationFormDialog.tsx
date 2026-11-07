import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Form } from '@/components/ui/form';
import { reportApiError } from '@/lib/report-api-error';
import type { DesignationDTO } from '@/routes/erp/-shared/hr-types';
import { useSaveDesignation } from '../-hooks/use-hr-people';
import { HrTextField, HrTextareaField } from './HrFormFields';

const buildDesignationSchema = (t: TFunction) =>
    z.object({
        name: z.string().min(1, t('errors.nameRequired')),
        code: z.string(),
        level: z.string().regex(/^\d*$/, t('errors.levelWholeNumber')),
        grade: z.string(),
        description: z.string(),
    });

type DesignationFormValues = z.infer<ReturnType<typeof buildDesignationSchema>>;

interface DesignationFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Present for edit, absent for create. */
    designation?: DesignationDTO | null;
}

export function DesignationFormDialog({
    open,
    onOpenChange,
    designation,
}: DesignationFormDialogProps) {
    const { t } = useTranslation('erpDesignationFormDialog');
    const isEdit = !!designation?.id;
    const saveDesignation = useSaveDesignation();
    const designationSchema = buildDesignationSchema(t);

    const defaults = (): DesignationFormValues => ({
        name: designation?.name ?? '',
        code: designation?.code ?? '',
        level:
            designation?.level === undefined || designation?.level === null
                ? ''
                : String(designation.level),
        grade: designation?.grade ?? '',
        description: designation?.description ?? '',
    });

    const form = useForm<DesignationFormValues>({
        resolver: zodResolver(designationSchema),
        defaultValues: defaults(),
        mode: 'onBlur',
    });

    useEffect(() => {
        if (open) form.reset(defaults());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, designation]);

    const onSubmit = async (values: DesignationFormValues) => {
        const level = values.level.trim();
        try {
            await saveDesignation.mutateAsync({
                ...(isEdit ? { id: designation?.id } : {}),
                name: values.name.trim(),
                code: values.code.trim() || undefined,
                level: level ? Number(level) : undefined,
                grade: values.grade.trim() || undefined,
                description: values.description.trim() || undefined,
            });
            toast.success(isEdit ? t('toasts.updated') : t('toasts.added'));
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-people',
                tags: { 'erp.action': isEdit ? 'update-designation' : 'create-designation' },
                extra: { designationId: designation?.id },
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
                    <div className="grid gap-4 sm:grid-cols-3">
                        <HrTextField
                            control={form.control}
                            name="code"
                            label={t('fields.codeLabel')}
                            placeholder={t('fields.codePlaceholder')}
                        />
                        <HrTextField
                            control={form.control}
                            name="level"
                            label={t('fields.levelLabel')}
                            placeholder={t('fields.levelPlaceholder')}
                            description={t('fields.levelHelp')}
                        />
                        <HrTextField
                            control={form.control}
                            name="grade"
                            label={t('fields.gradeLabel')}
                            placeholder={t('fields.gradePlaceholder')}
                        />
                    </div>
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
