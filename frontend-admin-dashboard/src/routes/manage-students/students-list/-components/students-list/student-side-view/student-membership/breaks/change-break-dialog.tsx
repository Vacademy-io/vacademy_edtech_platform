import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
    ENROLMENT_BREAKS_QUERY_KEY,
    updateBreak,
    type EnrolmentBreak,
} from '@/services/enrolment-breaks';
import { formatDay, lengthInDays } from './break-utils';

const buildSchema = (t: TFunction, minDay: string) =>
    z
        .object({
            openEnded: z.boolean(),
            endsOn: z.string(),
            note: z.string().max(1000),
        })
        .superRefine((v, ctx) => {
            if (v.openEnded) return;
            if (!v.endsOn) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['endsOn'],
                    message: t('form.errors.endRequired'),
                });
            } else if (v.endsOn < minDay) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['endsOn'],
                    message: t('form.errors.endBeforeMin', { date: formatDay(minDay) }),
                });
            }
        });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface ChangeBreakDialogProps {
    onClose: () => void;
    brk: EnrolmentBreak;
    instituteId: string;
    today: string;
}

/** Move a break's last day (the learner is back earlier or later) or edit its note. Mounted only while open. */
export const ChangeBreakDialog = ({ onClose, brk, instituteId, today }: ChangeBreakDialogProps) => {
    const { t } = useTranslation('manageStudentsBreaks');
    const queryClient = useQueryClient();
    const minDay = brk.starts_on > today ? brk.starts_on : today;
    const schema = useMemo(() => buildSchema(t, minDay), [t, minDay]);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: { openEnded: !brk.ends_on, endsOn: brk.ends_on ?? '', note: brk.note ?? '' },
    });

    const values = form.watch();
    const length = !values.openEnded ? lengthInDays(brk.starts_on, values.endsOn) : null;

    const mutation = useMutation({
        mutationFn: () =>
            updateBreak(instituteId, brk.id, {
                ends_on: values.openEnded ? null : values.endsOn,
                open_ended: values.openEnded,
                note: values.note.trim(),
            }),
        onSuccess: () => {
            toast.success(t('toast.changed'));
            queryClient.invalidateQueries({ queryKey: [ENROLMENT_BREAKS_QUERY_KEY] });
            onClose();
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('toast.failed'));
        },
    });

    return (
        <MyDialog
            open
            onOpenChange={(open) => !open && onClose()}
            heading={t('change.title')}
            dialogWidth="max-w-md"
            footer={
                <>
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('form.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={mutation.isPending}
                        onAsyncClick={form.handleSubmit(() => mutation.mutateAsync())}
                        loadingText={t('form.saving')}
                    >
                        {t('change.submit')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                    <p className="text-body text-neutral-600">
                        {t('change.started', { date: formatDay(brk.starts_on) })}
                    </p>
                    <FormField
                        control={form.control}
                        name="openEnded"
                        render={({ field }) => (
                            <FormItem className="flex items-center justify-between gap-3 space-y-0 rounded-md border border-neutral-200 p-3">
                                <FormLabel className="font-normal">{t('form.noEndDate')}</FormLabel>
                                <FormControl>
                                    <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    {!values.openEnded && (
                        <FormField
                            control={form.control}
                            name="endsOn"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('form.lastDay')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="date"
                                            input={field.value}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            min={minDay}
                                            className="w-full sm:w-full"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                    {length !== null &&
                                        length > 0 &&
                                        !form.formState.errors.endsOn && (
                                            <p className="text-caption text-neutral-500">
                                                {t('form.lengthDays', { count: length })}
                                            </p>
                                        )}
                                </FormItem>
                            )}
                        />
                    )}
                    <FormField
                        control={form.control}
                        name="note"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('form.note')}</FormLabel>
                                <FormControl>
                                    <Textarea
                                        rows={2}
                                        placeholder={t('form.notePlaceholder')}
                                        {...field}
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
