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
import { SearchableSelect } from '@/components/design-system/searchable-select';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
    EXTRA_CLASSES_QUERY_KEY,
    addExtraClass,
    useExtraClassBatches,
} from '@/services/extra-classes';
import { addDaysTo, formatDay, lengthInDays } from './break-utils';

/** Same limit as the server (ExtraClassService.MAX_DAYS). */
export const EXTRA_CLASS_MAX_DAYS = 90;

const buildSchema = (t: TFunction, today: string) =>
    z
        .object({
            packageSessionId: z.string(),
            from: z.string(),
            to: z.string(),
            note: z.string().max(1000),
        })
        .superRefine((v, ctx) => {
            if (!v.packageSessionId) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['packageSessionId'],
                    message: t('extra.errors.batchRequired'),
                });
            }
            if (!v.from) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['from'],
                    message: t('form.errors.startRequired'),
                });
            }
            if (!v.to) {
                ctx.addIssue({ code: 'custom', path: ['to'], message: t('extra.errors.endRequired') });
                return;
            }
            if (v.from && v.to < v.from) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['to'],
                    message: t('form.errors.endBeforeStart'),
                });
            } else if (v.to < today) {
                ctx.addIssue({ code: 'custom', path: ['to'], message: t('extra.errors.endInPast') });
            } else if ((lengthInDays(v.from, v.to) ?? 0) > EXTRA_CLASS_MAX_DAYS) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['to'],
                    message: t('extra.errors.tooLong', { count: EXTRA_CLASS_MAX_DAYS }),
                });
            }
        });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface AddExtraClassDialogProps {
    onClose: () => void;
    userId: string;
    instituteId: string;
    learnerName?: string;
    today: string;
    batchTerm: string;
}

/** Link the learner to another batch for a date range. Mounted only while open. */
export const AddExtraClassDialog = ({
    onClose,
    userId,
    instituteId,
    learnerName,
    today,
    batchTerm,
}: AddExtraClassDialogProps) => {
    const { t } = useTranslation('manageStudentsBreaks');
    const queryClient = useQueryClient();
    const schema = useMemo(() => buildSchema(t, today), [t, today]);
    const batches = useExtraClassBatches(instituteId);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: { packageSessionId: '', from: today, to: addDaysTo(today, 7), note: '' },
    });
    const values = form.watch();
    const length = values.from && values.to ? lengthInDays(values.from, values.to) : null;

    const options = useMemo(
        () =>
            (batches.data ?? []).map((b) => ({
                value: b.package_session_id,
                label: b.label,
                keywords: [b.course_name, b.level_name, b.batch_name].filter(
                    (k): k is string => Boolean(k)
                ),
            })),
        [batches.data]
    );

    const mutation = useMutation({
        mutationFn: () =>
            addExtraClass(instituteId, {
                user_id: userId,
                package_session_id: values.packageSessionId,
                from_date: values.from,
                to_date: values.to,
                note: values.note.trim() || null,
            }),
        onSuccess: () => {
            toast.success(t('extra.toast.added'));
            queryClient.invalidateQueries({ queryKey: [EXTRA_CLASSES_QUERY_KEY] });
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
            heading={
                learnerName ? t('extra.form.titleFor', { name: learnerName }) : t('extra.form.title')
            }
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
                        {t('extra.form.submit')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                    <p className="rounded-md bg-info-50 p-3 text-caption text-info-700 ring-1 ring-info-200">
                        {t('extra.noFeeNoMessage')}
                    </p>
                    <FormField
                        control={form.control}
                        name="packageSessionId"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{batchTerm}</FormLabel>
                                <FormControl>
                                    {batches.isLoading ? (
                                        <Skeleton className="h-9 w-full" />
                                    ) : batches.isError ? (
                                        <div className="flex items-center justify-between gap-2 rounded-md bg-danger-50 p-3 text-caption text-danger-700 ring-1 ring-danger-200">
                                            <span>{t('extra.batchesFailed')}</span>
                                            <MyButton
                                                type="button"
                                                buttonType="text"
                                                scale="small"
                                                onClick={() => batches.refetch()}
                                            >
                                                {t('card.retry')}
                                            </MyButton>
                                        </div>
                                    ) : (
                                        <SearchableSelect
                                            options={options}
                                            value={field.value}
                                            onChange={field.onChange}
                                            portal={false}
                                            placeholder={t('extra.form.batchPlaceholder', {
                                                batch: batchTerm,
                                            })}
                                            searchPlaceholder={t('extra.form.batchSearch')}
                                            emptyText={t('extra.form.batchEmpty')}
                                        />
                                    )}
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="from"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('extra.form.from')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="date"
                                            input={field.value}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            className="w-full sm:w-full"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="to"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('extra.form.to')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="date"
                                            input={field.value}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            min={values.from || today}
                                            className="w-full sm:w-full"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                    {length !== null && length > 0 && !form.formState.errors.to && (
                        <p className="text-caption text-neutral-500">
                            {t('extra.form.window', {
                                count: length,
                                from: formatDay(values.from),
                                to: formatDay(values.to),
                            })}
                        </p>
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
                                        placeholder={t('extra.form.notePlaceholder')}
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
