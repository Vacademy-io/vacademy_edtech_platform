import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { TFunction } from 'i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Info } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency } from '@/lib/formatters';
import { PLAN_REMARKS_QUERY_KEY, changeMemberPrice, type MemberPriceResult } from '@/services/user-plan';

const buildSchema = (t: TFunction) =>
    z
        .object({
            useListPrice: z.boolean(),
            price: z.string(),
            remarks: z.string().trim().min(1, t('memberPrice.errors.remarks')),
        })
        .superRefine((v, ctx) => {
            if (v.useListPrice) return;
            const n = Number(v.price);
            if (v.price.trim() === '' || Number.isNaN(n) || n < 0) {
                ctx.addIssue({ code: 'custom', path: ['price'], message: t('memberPrice.errors.price') });
            }
        });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface ChangePriceDialogProps {
    onClose: () => void;
    userPlanId: string;
    instituteId: string;
    planLabel?: string;
    /** The plan's list price per period and its currency. */
    listPrice: number;
    currency: string;
    /** The member's own price when set, else null. */
    memberPrice: number | null;
    autopayOn: boolean;
    onChanged: (result: MemberPriceResult) => void;
}

/**
 * Set the price this member pays each period (a legacy or negotiated rate) instead of the
 * plan's list price. Applies from the next charge or renewal; nothing already paid changes.
 * Mounted only while open.
 */
export const ChangePriceDialog = ({
    onClose,
    userPlanId,
    instituteId,
    planLabel,
    listPrice,
    currency,
    memberPrice,
    autopayOn,
    onChanged,
}: ChangePriceDialogProps) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    const queryClient = useQueryClient();
    const schema = useMemo(() => buildSchema(t), [t]);
    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            useListPrice: false,
            price: memberPrice !== null ? String(memberPrice) : String(listPrice),
            remarks: '',
        },
    });
    const values = form.watch();
    const money = (n: number) => (currency && currency !== 'N/A' ? formatCurrency(n, currency) : String(n));

    const mutation = useMutation({
        mutationFn: () =>
            changeMemberPrice(userPlanId, instituteId, {
                price: values.useListPrice ? null : Number(values.price),
                remarks: values.remarks.trim(),
            }),
        onSuccess: (result) => {
            toast.success(
                result.uses_list_price
                    ? t('memberPrice.successList')
                    : t('memberPrice.success', { price: money(Number(result.new_price ?? 0)) })
            );
            queryClient.invalidateQueries({ queryKey: [PLAN_REMARKS_QUERY_KEY, userPlanId] });
            onChanged(result);
            onClose();
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('memberPrice.failed'));
        },
    });

    return (
        <MyDialog
            open
            onOpenChange={(open) => !open && onClose()}
            heading={t('memberPrice.title')}
            dialogWidth="max-w-md"
            footer={
                <>
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('memberPrice.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={mutation.isPending}
                        onAsyncClick={form.handleSubmit(() => mutation.mutateAsync())}
                        loadingText={t('memberPrice.saving')}
                    >
                        {t('memberPrice.submit')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                    {planLabel && <p className="text-body text-neutral-600">{planLabel}</p>}
                    <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-info-700 ring-1 ring-info-200">
                        <Info className="mt-0.5 size-4 shrink-0" />
                        <span>
                            {t('memberPrice.explainer', {
                                list: money(listPrice),
                                current: money(memberPrice ?? listPrice),
                            })}
                            {autopayOn ? ` ${t('memberPrice.autopayNote')}` : ''}
                        </span>
                    </div>
                    <FormField
                        control={form.control}
                        name="useListPrice"
                        render={({ field }) => (
                            <FormItem className="flex items-center justify-between gap-3 space-y-0 rounded-md border border-neutral-200 p-3">
                                <FormLabel className="font-normal">
                                    {t('memberPrice.useListPrice', { list: money(listPrice) })}
                                </FormLabel>
                                <FormControl>
                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    {!values.useListPrice && (
                        <FormField
                            control={form.control}
                            name="price"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('memberPrice.newPrice', { currency })}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="number"
                                            input={field.value}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            min={0}
                                            className="w-full sm:w-full"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}
                    <FormField
                        control={form.control}
                        name="remarks"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('memberPrice.remarks')}</FormLabel>
                                <FormControl>
                                    <Textarea rows={3} placeholder={t('memberPrice.remarksPlaceholder')} {...field} />
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
