import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
    ENROLMENT_BREAKS_QUERY_KEY,
    endBreak,
    previewEndBreak,
    type EndBreakRequest,
    type EnrolmentBreak,
    type ResumeMode,
} from '@/services/enrolment-breaks';
import { BreakEffectsPanel } from './break-effects-panel';
import { addDaysTo } from './break-utils';

const schema = z
    .object({
        mode: z.enum(['SHIFT_BY_PAUSED_DAYS', 'KEEP_DATES', 'NEW_DATE']),
        newEndDate: z.string(),
        moveInstalments: z.boolean(),
        note: z.string().max(1000),
    })
    .superRefine((v, ctx) => {
        if (v.mode === 'NEW_DATE' && !v.newEndDate) {
            ctx.addIssue({ code: 'custom', path: ['newEndDate'], message: 'newDateRequired' });
        }
    });

type FormValues = z.infer<typeof schema>;

interface ResumeBreakDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    brk: EnrolmentBreak | null;
    instituteId: string;
    today: string;
}

const MODES: ResumeMode[] = ['SHIFT_BY_PAUSED_DAYS', 'KEEP_DATES', 'NEW_DATE'];

/**
 * Ends a running break today. A hold just restarts reminders. A pause turns access back
 * on and, by default, moves the membership dates forward by the days paused; the admin can
 * keep the dates or set a new end date instead, and sees the result before confirming.
 */
export const ResumeBreakDialog = ({
    open,
    onOpenChange,
    brk,
    instituteId,
    today,
}: ResumeBreakDialogProps) => {
    const { t } = useTranslation('manageStudentsBreaks');
    const queryClient = useQueryClient();
    const isPause = brk?.kind === 'PAUSE';
    const [instalmentCount, setInstalmentCount] = useState(0);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            mode: 'SHIFT_BY_PAUSED_DAYS',
            newEndDate: '',
            moveInstalments: true,
            note: '',
        },
    });

    useEffect(() => {
        if (open) {
            form.reset({
                mode: 'SHIFT_BY_PAUSED_DAYS',
                newEndDate: '',
                moveInstalments: true,
                note: '',
            });
            setInstalmentCount(0);
        }
    }, [open, brk?.id, form]);

    const values = form.watch();
    const request: EndBreakRequest = {
        resume_mode: isPause ? values.mode : 'KEEP_DATES',
        new_end_date: values.mode === 'NEW_DATE' ? values.newEndDate || null : null,
        move_unpaid_instalments: values.moveInstalments,
        note: values.note.trim() || null,
    };
    const requestKey = JSON.stringify(request);

    const previewQuery = useQuery({
        queryKey: [ENROLMENT_BREAKS_QUERY_KEY, 'end-preview', instituteId, brk?.id, requestKey],
        queryFn: () => previewEndBreak(instituteId, brk!.id, JSON.parse(requestKey)),
        enabled: open && Boolean(brk?.id),
        staleTime: 10_000,
    });

    // Remember how many unpaid instalments exist, so the checkbox stays visible when cleared.
    useEffect(() => {
        const n = previewQuery.data?.unpaid_instalments_moved ?? 0;
        if (n > instalmentCount) setInstalmentCount(n);
    }, [previewQuery.data, instalmentCount]);

    const mutation = useMutation({
        mutationFn: () => endBreak(instituteId, brk!.id, request),
        onSuccess: () => {
            toast.success(t(isPause ? 'toast.resumed' : 'toast.holdEnded'));
            queryClient.invalidateQueries({ queryKey: [ENROLMENT_BREAKS_QUERY_KEY] });
            ['user-plans', 'students', 'GET_LEARNER_PACKAGES', 'cpo-side-view'].forEach((key) =>
                queryClient.invalidateQueries({ queryKey: [key] })
            );
            onOpenChange(false);
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('toast.failed'));
        },
    });

    const blocked = (previewQuery.data?.blockers.length ?? 0) > 0;

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={t(isPause ? 'resume.titlePause' : 'resume.titleHold')}
            dialogWidth="max-w-lg"
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('form.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={!brk || blocked || previewQuery.isFetching}
                        onAsyncClick={form.handleSubmit(() => mutation.mutateAsync())}
                        loadingText={t('form.saving')}
                    >
                        {t(isPause ? 'resume.submitPause' : 'resume.submitHold')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
                    {isPause && (
                        <FormField
                            control={form.control}
                            name="mode"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('resume.datesLabel')}</FormLabel>
                                    <FormControl>
                                        <RadioGroup
                                            value={field.value}
                                            onValueChange={field.onChange}
                                            className="space-y-2"
                                        >
                                            {MODES.map((mode) => (
                                                <label
                                                    key={mode}
                                                    htmlFor={`resume-${mode}`}
                                                    className={cn(
                                                        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                                                        field.value === mode
                                                            ? 'border-primary-400 bg-primary-50'
                                                            : 'border-neutral-200 hover:border-primary-200'
                                                    )}
                                                >
                                                    <RadioGroupItem
                                                        id={`resume-${mode}`}
                                                        value={mode}
                                                        className="mt-1"
                                                    />
                                                    <span className="space-y-0.5">
                                                        <span className="block text-body font-medium text-neutral-800">
                                                            {t(`resume.modes.${mode}.title`, {
                                                                count:
                                                                    previewQuery.data
                                                                        ?.paused_days ??
                                                                    brk?.days_so_far ??
                                                                    0,
                                                            })}
                                                        </span>
                                                        <span className="block text-caption text-neutral-500">
                                                            {t(`resume.modes.${mode}.hint`)}
                                                        </span>
                                                    </span>
                                                </label>
                                            ))}
                                        </RadioGroup>
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    )}

                    {isPause && values.mode === 'NEW_DATE' && (
                        <FormField
                            control={form.control}
                            name="newEndDate"
                            render={({ field, fieldState }) => (
                                <FormItem>
                                    <FormLabel>{t('resume.newEndDate')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="date"
                                            input={field.value}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            min={addDaysTo(today, 1)}
                                            className="w-full sm:w-full"
                                        />
                                    </FormControl>
                                    {fieldState.error && (
                                        <p className="text-caption text-danger-600">
                                            {t(`form.errors.${fieldState.error.message}`)}
                                        </p>
                                    )}
                                </FormItem>
                            )}
                        />
                    )}

                    {isPause && values.mode !== 'KEEP_DATES' && instalmentCount > 0 && (
                        <div className="flex items-start gap-3">
                            <Checkbox
                                id="resume-move-instalments"
                                checked={values.moveInstalments}
                                onCheckedChange={(v) =>
                                    form.setValue('moveInstalments', v === true)
                                }
                            />
                            <Label htmlFor="resume-move-instalments" className="font-normal">
                                {t('resume.moveInstalments', { count: instalmentCount })}
                            </Label>
                        </div>
                    )}

                    <FormField
                        control={form.control}
                        name="note"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('resume.note')}</FormLabel>
                                <FormControl>
                                    <Textarea
                                        rows={2}
                                        placeholder={t('resume.notePlaceholder')}
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <BreakEffectsPanel
                        preview={previewQuery.data}
                        isLoading={previewQuery.isLoading}
                        mode="resume"
                    />
                </form>
            </Form>
        </MyDialog>
    );
};
