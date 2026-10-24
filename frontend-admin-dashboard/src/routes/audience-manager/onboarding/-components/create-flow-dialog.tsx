import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { toast } from 'sonner';
import { createOnboardingFlow, type OnboardingFlowDTO } from '../-services/onboarding-service';

const buildCreateFlowSchema = (t: TFunction) =>
    z.object({
        name: z
            .string()
            .min(1, t('validation.nameRequired'))
            .max(150, t('validation.nameMaxLength')),
        description: z.string().max(1000, t('validation.descriptionMaxLength')).optional(),
    });

type CreateFlowForm = z.infer<ReturnType<typeof buildCreateFlowSchema>>;

interface CreateFlowDialogProps {
    instituteId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (flow: OnboardingFlowDTO) => void;
}

export function CreateFlowDialog({ instituteId, open, onOpenChange, onCreated }: CreateFlowDialogProps) {
    const { t } = useTranslation('audienceManagerCreateFlowDialog');
    const form = useForm<CreateFlowForm>({
        resolver: zodResolver(buildCreateFlowSchema(t)),
        defaultValues: { name: '', description: '' },
    });

    useEffect(() => {
        if (open) form.reset({ name: '', description: '' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const { mutate: create, isPending } = useMutation({
        mutationFn: (values: CreateFlowForm) =>
            createOnboardingFlow(instituteId, {
                name: values.name,
                description: values.description || undefined,
                start_mode: 'MANUAL',
            }),
        onSuccess: (flow) => {
            toast.success(t('toasts.created'));
            onOpenChange(false);
            onCreated(flow);
        },
        onError: () => {
            toast.error(t('toasts.createError'));
        },
    });

    const onSubmit = (values: CreateFlowForm) => create(values);

    const footer = (
        <div className="flex w-full items-center justify-end gap-2">
            <MyButton buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)} disable={isPending}>
                {t('actions.cancel')}
            </MyButton>
            <MyButton
                buttonType="primary"
                scale="medium"
                onClick={form.handleSubmit(onSubmit)}
                disable={isPending}
            >
                {isPending ? t('actions.creating') : t('actions.createFlow')}
            </MyButton>
        </div>
    );

    return (
        <MyDialog open={open} onOpenChange={onOpenChange} heading={t('heading')} footer={footer} dialogWidth="max-w-md">
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 px-6 py-6">
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('fields.name.label')}</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="text"
                                        inputPlaceholder={t('fields.name.placeholder')}
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        required
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
                                <FormLabel>{t('fields.description.label')}</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="text"
                                        inputPlaceholder={t('fields.description.placeholder')}
                                        input={field.value ?? ''}
                                        onChangeFunction={field.onChange}
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
}
