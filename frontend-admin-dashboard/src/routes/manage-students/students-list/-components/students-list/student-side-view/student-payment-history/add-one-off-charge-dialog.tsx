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
import { Textarea } from '@/components/ui/textarea';
import { getCurrencySymbol } from '@/constants/currencies';
import { ONE_OFF_DUES_QUERY_KEY, createOneOffDue } from '@/services/one-off-dues';

const NO_BATCH = '__none__';

const buildSchema = (t: TFunction) =>
    z
        .object({
            title: z.string(),
            amount: z.string(),
            dueDate: z.string(),
            packageSessionId: z.string(),
            note: z.string().max(2000, t('errors.noteTooLong')),
        })
        .superRefine((v, ctx) => {
            if (!v.title.trim()) {
                ctx.addIssue({ code: 'custom', path: ['title'], message: t('errors.titleRequired') });
            } else if (v.title.trim().length > 200) {
                ctx.addIssue({ code: 'custom', path: ['title'], message: t('errors.titleTooLong') });
            }
            const n = Number(v.amount);
            if (!v.amount.trim() || !Number.isFinite(n) || n <= 0) {
                ctx.addIssue({ code: 'custom', path: ['amount'], message: t('errors.amountPositive') });
            } else if (!/^\d+(\.\d{1,2})?$/.test(v.amount.trim())) {
                ctx.addIssue({ code: 'custom', path: ['amount'], message: t('errors.amountDecimals') });
            }
            if (!v.dueDate) {
                ctx.addIssue({ code: 'custom', path: ['dueDate'], message: t('errors.dueDateRequired') });
            }
        });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface AddOneOffChargeDialogProps {
    onClose: () => void;
    userId: string;
    instituteId: string;
    learnerName?: string;
    today: string;
    currency: string | null;
    courses: { package_session_id: string; course_label: string }[];
    onAdded?: () => void;
}

/** Add one extra charge for a learner. Mounted only while open. */
export const AddOneOffChargeDialog = ({
    onClose,
    userId,
    instituteId,
    learnerName,
    today,
    currency,
    courses,
    onAdded,
}: AddOneOffChargeDialogProps) => {
    const { t } = useTranslation('manageStudentsOneOffDues');
    const queryClient = useQueryClient();
    const schema = useMemo(() => buildSchema(t), [t]);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            title: '',
            amount: '',
            dueDate: today,
            packageSessionId: courses.length === 1 ? courses[0]!.package_session_id : NO_BATCH,
            note: '',
        },
    });

    const options = useMemo(
        () => [
            { value: NO_BATCH, label: t('form.noBatch') },
            ...courses.map((c) => ({ value: c.package_session_id, label: c.course_label })),
        ],
        [courses, t]
    );

    const mutation = useMutation({
        mutationFn: (v: FormValues) =>
            createOneOffDue(instituteId, {
                user_id: userId,
                package_session_id: v.packageSessionId === NO_BATCH ? null : v.packageSessionId,
                amount: Number(v.amount.trim()),
                due_date: v.dueDate,
                title: v.title.trim(),
                note: v.note.trim() || null,
            }),
        onSuccess: () => {
            toast.success(t('toast.added'));
            queryClient.invalidateQueries({ queryKey: [ONE_OFF_DUES_QUERY_KEY] });
            onAdded?.();
            onClose();
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('toast.failed'));
        },
    });

    const symbol = currency ? getCurrencySymbol(currency) : '';

    return (
        <MyDialog
            open
            onOpenChange={(open) => !open && onClose()}
            heading={learnerName ? t('form.titleFor', { name: learnerName }) : t('form.title')}
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
                        onAsyncClick={form.handleSubmit((v) => mutation.mutateAsync(v))}
                        loadingText={t('form.saving')}
                    >
                        {t('form.submit')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                    <p className="rounded-md bg-info-50 p-3 text-caption text-info-700 ring-1 ring-info-200">
                        {t('form.howItWorks')}
                    </p>
                    <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('form.chargeTitle')}</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="text"
                                        input={field.value}
                                        onChangeFunction={(e) => field.onChange(e.target.value)}
                                        inputPlaceholder={t('form.chargeTitlePlaceholder')}
                                        className="w-full sm:w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="amount"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>
                                        {symbol
                                            ? t('form.amountWithCurrency', { symbol })
                                            : t('form.amount')}
                                    </FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            input={field.value}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            inputPlaceholder="0.00"
                                            className="w-full sm:w-full"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="dueDate"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('form.dueDate')}</FormLabel>
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
                    </div>
                    {courses.length > 0 && (
                        <FormField
                            control={form.control}
                            name="packageSessionId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('form.batch')}</FormLabel>
                                    <FormControl>
                                        <SearchableSelect
                                            options={options}
                                            value={field.value}
                                            onChange={field.onChange}
                                            portal={false}
                                            placeholder={t('form.noBatch')}
                                            searchPlaceholder={t('form.batchSearch')}
                                            emptyText={t('form.batchEmpty')}
                                        />
                                    </FormControl>
                                    <FormMessage />
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
