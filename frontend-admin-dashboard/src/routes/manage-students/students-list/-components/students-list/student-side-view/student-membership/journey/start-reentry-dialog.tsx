import { useEffect, useMemo, useState } from 'react';
import { useForm, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { Checkbox } from '@/components/ui/checkbox';
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
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    JOURNEY_STATUS_QUERY_KEY,
    findJourneyStatus,
    startReentry,
    type JourneyEnrolment,
    type JourneyStatusSettings,
} from '@/services/journey-status';
import { EXTRA_CLASSES_QUERY_KEY, useExtraClassBatches } from '@/services/extra-classes';
import { ENROLMENT_BREAKS_QUERY_KEY } from '@/services/enrolment-breaks';
import { addDaysTo, formatDay, lengthInDays, localToday } from '../breaks/break-utils';
import { EXTRA_CLASS_MAX_DAYS } from '../breaks/add-extra-class-dialog';

type LinkKey = 'extra' | 'bridge';

const buildSchema = (t: TFunction, today: string) =>
    z
        .object({
            batch: z.string(),
            reason: z.string().max(500),
            extraOn: z.boolean(),
            extraBatch: z.string(),
            extraFrom: z.string(),
            extraTo: z.string(),
            bridgeOn: z.boolean(),
            bridgeBatch: z.string(),
            bridgeFrom: z.string(),
            bridgeTo: z.string(),
            returnOn: z.string(),
            resumePause: z.boolean(),
        })
        .superRefine((v, ctx) => {
            if (!v.batch) {
                ctx.addIssue({ code: 'custom', path: ['batch'], message: t('reentry.errors.batch') });
            }
            if (!v.reason.trim()) {
                ctx.addIssue({ code: 'custom', path: ['reason'], message: t('reentry.errors.reason') });
            }
            (['extra', 'bridge'] as LinkKey[]).forEach((k) => {
                if (!v[`${k}On` as const]) return;
                const ps = v[`${k}Batch` as const];
                const from = v[`${k}From` as const];
                const to = v[`${k}To` as const];
                if (!ps) {
                    ctx.addIssue({
                        code: 'custom',
                        path: [`${k}Batch` as const],
                        message: t('reentry.errors.linkBatch'),
                    });
                } else if (ps === v.batch) {
                    ctx.addIssue({
                        code: 'custom',
                        path: [`${k}Batch` as const],
                        message: t('reentry.errors.sameBatch'),
                    });
                }
                if (!from || !to) {
                    ctx.addIssue({
                        code: 'custom',
                        path: [`${k}To` as const],
                        message: t('reentry.errors.dates'),
                    });
                } else if (to < from) {
                    ctx.addIssue({
                        code: 'custom',
                        path: [`${k}To` as const],
                        message: t('reentry.errors.endBeforeStart'),
                    });
                } else if (to < today) {
                    ctx.addIssue({
                        code: 'custom',
                        path: [`${k}To` as const],
                        message: t('reentry.errors.endInPast'),
                    });
                } else if ((lengthInDays(from, to) ?? 0) > EXTRA_CLASS_MAX_DAYS) {
                    ctx.addIssue({
                        code: 'custom',
                        path: [`${k}To` as const],
                        message: t('reentry.errors.tooLong', { count: EXTRA_CLASS_MAX_DAYS }),
                    });
                }
            });
            if (v.returnOn && v.returnOn < today) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['returnOn'],
                    message: t('reentry.errors.returnInPast'),
                });
            }
        });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface StartReentryDialogProps {
    onClose: () => void;
    userId: string;
    instituteId: string;
    settings: JourneyStatusSettings;
    /** The learner's current batches (extra-class links are left out here). */
    enrolments: JourneyEnrolment[];
    initialBatch?: string | null;
    learnerName?: string;
}

/**
 * Re-entry in one step: the batch the learner returns to moves to the Re-entry status, with an
 * optional extra class (sit in another batch to catch up) and bridge course (a short catch-up
 * batch), and a date to go back to the default status. No fee, no message.
 */
export const StartReentryDialog = ({
    onClose,
    userId,
    instituteId,
    settings,
    enrolments,
    initialBatch,
    learnerName,
}: StartReentryDialogProps) => {
    const { t } = useTranslation('manageStudentsJourney');
    const queryClient = useQueryClient();
    const today = localToday();
    const schema = useMemo(() => buildSchema(t, today), [t, today]);
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const backTo = findJourneyStatus(settings, settings.default_status)?.label ?? settings.default_status;
    const own = useMemo(() => enrolments.filter((e) => !e.extra_class), [enrolments]);
    const [returnTouched, setReturnTouched] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            batch:
                (initialBatch && own.some((e) => e.package_session_id === initialBatch)
                    ? initialBatch
                    : own.length === 1
                      ? own[0]!.package_session_id
                      : '') ?? '',
            reason: '',
            extraOn: false,
            extraBatch: '',
            extraFrom: today,
            extraTo: addDaysTo(today, 13),
            bridgeOn: false,
            bridgeBatch: '',
            bridgeFrom: today,
            bridgeTo: addDaysTo(today, 29),
            returnOn: '',
            resumePause: false,
        },
    });
    const v = form.watch();
    const selected = own.find((e) => e.package_session_id === v.batch);

    // The return date follows the later last day of the links until staff set it themselves.
    const suggestedReturn = [v.extraOn ? v.extraTo : '', v.bridgeOn ? v.bridgeTo : '']
        .filter(Boolean)
        .sort()
        .pop();
    useEffect(() => {
        if (!returnTouched) form.setValue('returnOn', suggestedReturn ?? '');
    }, [suggestedReturn, returnTouched, form]);

    const batchOptions = useMemo(
        () =>
            own.map((e) => ({
                _id: e.package_session_id,
                value: e.package_session_id,
                label: e.course_label || e.package_session_id,
            })),
        [own]
    );

    const mutation = useMutation({
        mutationFn: (f: FormValues) => {
            const link = (k: LinkKey) =>
                f[`${k}On` as const]
                    ? { package_session_id: f[`${k}Batch` as const], from: f[`${k}From` as const], to: f[`${k}To` as const] }
                    : null;
            return startReentry(instituteId, {
                user_id: userId,
                package_session_id: f.batch,
                reason: f.reason.trim(),
                extra_class: link('extra'),
                bridge_course: link('bridge'),
                return_on: f.returnOn || null,
                resume_pause: Boolean(selected?.on_pause && f.resumePause),
            });
        },
        onSuccess: (res) => {
            toast.success(t('reentry.saved', { count: res.links.length }));
            queryClient.invalidateQueries({ queryKey: [JOURNEY_STATUS_QUERY_KEY] });
            queryClient.invalidateQueries({ queryKey: [EXTRA_CLASSES_QUERY_KEY] });
            if (res.resumed_pauses > 0) {
                queryClient.invalidateQueries({ queryKey: [ENROLMENT_BREAKS_QUERY_KEY] });
            }
            onClose();
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('reentry.failed'));
        },
    });

    return (
        <MyDialog
            open
            onOpenChange={(open) => !open && onClose()}
            heading={
                learnerName ? t('reentry.titleFor', { name: learnerName }) : t('reentry.title')
            }
            dialogWidth="max-w-lg"
            footer={
                <>
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={mutation.isPending || Boolean(selected?.on_pause && !v.resumePause)}
                        onAsyncClick={form.handleSubmit((f) => mutation.mutateAsync(f))}
                        loadingText={t('dialog.saving')}
                    >
                        {t('reentry.submit')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                    <p className="text-body text-neutral-600">{t('reentry.intro')}</p>
                    <SelectField
                        control={form.control}
                        name="batch"
                        label={t('reentry.batch', { batch: batchTerm })}
                        required
                        options={batchOptions}
                        className="w-full sm:w-full"
                        labelStyle="w-full"
                    />
                    {selected?.on_pause && (
                        <div className="space-y-2 rounded-md bg-warning-50 p-3 text-caption text-warning-700 ring-1 ring-warning-200">
                            <p>{t('reentry.onPause')}</p>
                            <FormField
                                control={form.control}
                                name="resumePause"
                                render={({ field }) => (
                                    <FormItem className="flex items-center gap-2 space-y-0">
                                        <FormControl>
                                            <Checkbox
                                                checked={field.value}
                                                onCheckedChange={(c) => field.onChange(c === true)}
                                            />
                                        </FormControl>
                                        <FormLabel className="cursor-pointer font-normal">
                                            {t('reentry.resumePause')}
                                        </FormLabel>
                                    </FormItem>
                                )}
                            />
                        </div>
                    )}
                    <FormField
                        control={form.control}
                        name="reason"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('dialog.reason')}</FormLabel>
                                <FormControl>
                                    <Textarea
                                        rows={2}
                                        placeholder={t('reentry.reasonPlaceholder')}
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <LinkFields
                        k="extra"
                        control={form.control}
                        on={v.extraOn}
                        from={v.extraFrom}
                        to={v.extraTo}
                        title={t('reentry.extra.title')}
                        hint={t('reentry.extra.hint', { batch: batchTerm.toLowerCase() })}
                        instituteId={instituteId}
                        batchTerm={batchTerm}
                        today={today}
                    />
                    <LinkFields
                        k="bridge"
                        control={form.control}
                        on={v.bridgeOn}
                        from={v.bridgeFrom}
                        to={v.bridgeTo}
                        title={t('reentry.bridge.title')}
                        hint={t('reentry.bridge.hint', { batch: batchTerm.toLowerCase() })}
                        instituteId={instituteId}
                        batchTerm={batchTerm}
                        today={today}
                    />

                    <FormField
                        control={form.control}
                        name="returnOn"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('reentry.returnOn', { status: backTo })}</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="date"
                                        input={field.value}
                                        onChangeFunction={(e) => {
                                            setReturnTouched(true);
                                            field.onChange(e.target.value);
                                        }}
                                        min={today}
                                        className="w-full sm:w-full"
                                    />
                                </FormControl>
                                <p className="text-caption text-neutral-500">
                                    {field.value
                                        ? settings.reentry_auto_return
                                            ? t('reentry.returnHint', {
                                                  status: backTo,
                                                  date: formatDay(field.value),
                                              })
                                            : t('reentry.returnHintManual')
                                        : t('reentry.returnNone')}
                                </p>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <p className="rounded-md bg-info-50 p-3 text-caption text-info-700 ring-1 ring-info-200">
                        {t('reentry.noFeeNoMessage')}
                    </p>
                </form>
            </Form>
        </MyDialog>
    );
};

interface LinkFieldsProps {
    k: LinkKey;
    control: Control<FormValues>;
    on: boolean;
    from: string;
    to: string;
    title: string;
    hint: string;
    instituteId: string;
    batchTerm: string;
    today: string;
}

/** "Add extra class" / "Add bridge course": a tick, then the batch picker and the dates. */
const LinkFields = ({
    k,
    control,
    on,
    from,
    to,
    title,
    hint,
    instituteId,
    batchTerm,
    today,
}: LinkFieldsProps) => {
    const { t } = useTranslation('manageStudentsJourney');
    const length = on && from && to ? lengthInDays(from, to) : null;
    return (
        <div className="space-y-3 rounded-md border border-neutral-200 p-3">
            <FormField
                control={control}
                name={`${k}On` as const}
                render={({ field }) => (
                    <FormItem className="flex items-start gap-2 space-y-0">
                        <FormControl>
                            <Checkbox
                                className="mt-0.5"
                                checked={field.value}
                                onCheckedChange={(c) => field.onChange(c === true)}
                            />
                        </FormControl>
                        <div className="space-y-0.5">
                            <FormLabel className="cursor-pointer">{title}</FormLabel>
                            <p className="text-caption text-neutral-500">{hint}</p>
                        </div>
                    </FormItem>
                )}
            />
            {on && (
                <>
                    <FormField
                        control={control}
                        name={`${k}Batch` as const}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{batchTerm}</FormLabel>
                                <FormControl>
                                    <LinkBatchPicker
                                        instituteId={instituteId}
                                        value={field.value}
                                        onChange={field.onChange}
                                        batchTerm={batchTerm}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FormField
                            control={control}
                            name={`${k}From` as const}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('reentry.from')}</FormLabel>
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
                            control={control}
                            name={`${k}To` as const}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('reentry.to')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="date"
                                            input={field.value}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            min={from || today}
                                            className="w-full sm:w-full"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                    {length !== null && length > 0 && (
                        <p className="text-caption text-neutral-500">
                            {t('reentry.window', {
                                count: length,
                                from: formatDay(from),
                                to: formatDay(to),
                            })}
                        </p>
                    )}
                </>
            )}
        </div>
    );
};

/** The institute's active batches, the same list and picker the Extra classes card uses. */
const LinkBatchPicker = ({
    instituteId,
    value,
    onChange,
    batchTerm,
}: {
    instituteId: string;
    value: string;
    onChange: (v: string) => void;
    batchTerm: string;
}) => {
    const { t } = useTranslation('manageStudentsJourney');
    const batches = useExtraClassBatches(instituteId);
    const options = useMemo(
        () =>
            (batches.data ?? []).map((b) => ({
                value: b.package_session_id,
                label: b.label,
                keywords: [b.course_name, b.level_name, b.batch_name].filter(
                    (x): x is string => Boolean(x)
                ),
            })),
        [batches.data]
    );
    if (batches.isLoading) return <Skeleton className="h-9 w-full" />;
    if (batches.isError) {
        return (
            <div className="flex items-center justify-between gap-2 rounded-md bg-danger-50 p-3 text-caption text-danger-700 ring-1 ring-danger-200">
                <span>{t('reentry.batchesFailed')}</span>
                <MyButton type="button" buttonType="text" scale="small" onClick={() => batches.refetch()}>
                    {t('card.retry')}
                </MyButton>
            </div>
        );
    }
    return (
        <SearchableSelect
            options={options}
            value={value}
            onChange={onChange}
            portal={false}
            placeholder={t('reentry.batchPlaceholder', { batch: batchTerm })}
            searchPlaceholder={t('reentry.batchSearch')}
            emptyText={t('reentry.batchEmpty')}
        />
    );
};
