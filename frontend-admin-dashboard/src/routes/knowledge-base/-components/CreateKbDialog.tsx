import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { buildLanguageOptions, buildPurposeOptions } from '../-constants';
import { useCreateKnowledgeBase } from '../-hooks';
import type { KbPurpose } from '../-types';

const buildSchema = (t: TFunction) =>
    z.object({
        name: z.string().trim().min(1, t('validation.nameRequired')).max(200),
        purpose: z.enum(['teaching', 'question_bank', 'general']),
        language_hint: z.string().min(1),
        description: z.string().max(1000).optional(),
    });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface CreateKbDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (kbId: string) => void;
}

export const CreateKbDialog = ({ open, onOpenChange, onCreated }: CreateKbDialogProps) => {
    const { t: tConstants } = useTranslation('knowledgeBaseConstants');
    const { t } = useTranslation('knowledgeBaseCreateKbDialog');
    const purposeOptions = useMemo(() => buildPurposeOptions(tConstants), [tConstants]);
    const languageOptions = useMemo(() => buildLanguageOptions(tConstants), [tConstants]);
    const schema = useMemo(() => buildSchema(t), [t]);
    const create = useCreateKnowledgeBase();
    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: { name: '', purpose: 'teaching', language_hint: 'en', description: '' },
    });

    const purpose = form.watch('purpose');
    const activePurpose = purposeOptions.find((p) => p.value === purpose);

    const close = (next: boolean) => {
        if (!next) form.reset();
        onOpenChange(next);
    };

    const onSubmit = async (values: FormValues) => {
        try {
            const kb = await create.mutateAsync({
                name: values.name.trim(),
                description: values.description?.trim() || undefined,
                purpose: values.purpose as KbPurpose,
                language_hint: values.language_hint,
            });
            toast.success(t('toast.created', { name: kb.name }));
            form.reset();
            onOpenChange(false);
            onCreated(kb.id);
        } catch (error) {
            const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data
                ?.detail;
            toast.error(typeof detail === 'string' ? detail : t('toast.createFailed'));
        }
    };

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={close}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => close(false)}
                        disable={create.isPending}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={form.handleSubmit(onSubmit)}
                        disable={create.isPending}
                    >
                        {create.isPending ? t('actions.creating') : t('actions.create')}
                    </MyButton>
                </div>
            }
        >
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5 p-6">
                    <p className="text-body text-neutral-500">{t('intro')}</p>

                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field, fieldState }) => (
                            <FormItem className="w-full">
                                <FormControl>
                                    <MyInput
                                        label={t('fields.name.label')}
                                        required
                                        inputType="text"
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        error={fieldState.error?.message}
                                        inputPlaceholder={t('fields.name.placeholder')}
                                        className="w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <div className="flex flex-col gap-2">
                        <SelectField
                            label={t('fields.purpose.label')}
                            name="purpose"
                            control={form.control}
                            labelStyle="w-full"
                            className="w-full"
                            options={purposeOptions.map((opt, index) => ({
                                value: opt.value,
                                label: opt.label,
                                _id: index,
                            }))}
                        />
                        {activePurpose && (
                            <p className="text-caption text-neutral-500">{activePurpose.hint}</p>
                        )}
                    </div>

                    <div className="flex flex-col gap-2">
                        <SelectField
                            label={t('fields.language.label')}
                            name="language_hint"
                            control={form.control}
                            labelStyle="w-full"
                            className="w-full"
                            options={languageOptions.map((opt, index) => ({
                                value: opt.value,
                                label: opt.label,
                                _id: index,
                            }))}
                        />
                        <p className="text-caption text-neutral-500">
                            {t('fields.language.hint')}
                        </p>
                    </div>

                    <FormField
                        control={form.control}
                        name="description"
                        render={({ field, fieldState }) => (
                            <FormItem className="w-full">
                                <FormControl>
                                    <MyInput
                                        label={t('fields.description.label')}
                                        inputType="text"
                                        input={field.value ?? ''}
                                        onChangeFunction={field.onChange}
                                        error={fieldState.error?.message}
                                        inputPlaceholder={t('fields.description.placeholder')}
                                        className="w-full"
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
