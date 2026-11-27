import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
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
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    JOURNEY_STATUS_QUERY_KEY,
    findJourneyStatus,
    findReentryStatus,
    startReentry,
    type JourneyEnrolment,
    type JourneyStatusSettings,
} from '@/services/journey-status';
import { EXTRA_CLASSES_QUERY_KEY } from '@/services/extra-classes';
import { ENROLMENT_BREAKS_QUERY_KEY } from '@/services/enrolment-breaks';
import { formatDay, lengthInDays, localToday } from '../breaks/break-utils';
import { EXTRA_CLASS_MAX_DAYS } from '../breaks/add-extra-class-dialog';
import {
    AssessmentSection,
    EXTRA_PAYMENT_READY,
    ExtraClassesSection,
    FeesSection,
    OneOnOneSection,
    ReentrySummary,
    nowHm,
    useStaffOptions,
} from './reentry-sections';

export const MAX_EXTRA_CLASSES = 5;
export const MAX_ONE_ON_ONE_SESSIONS = 10;
export const DEFAULT_ASSESSMENT_MINUTES = 10;

const slotSchema = z.object({ date: z.string(), start: z.string(), duration: z.string() });

const buildSchema = (t: TFunction, today: string) =>
    z
        .object({
            batch: z.string(),
            reason: z.string().max(500),
            restartFees: z.boolean(),
            extras: z.array(z.object({ batch: z.string(), from: z.string(), to: z.string() })),
            oneOnOneOn: z.boolean(),
            teacher: z.string(),
            title: z.string().max(120),
            sessions: z.array(slotSchema),
            amount: z.string(),
            dueDate: z.string(),
            assessmentMode: z.enum(['skip', 'schedule']),
            assessmentTeacher: z.string(),
            assessment: slotSchema,
            returnOn: z.string(),
        })
        .superRefine((v, ctx) => {
            const issue = (path: (string | number)[], message: string) =>
                ctx.addIssue({ code: 'custom', path, message });
            if (!v.batch) issue(['batch'], t('reentry.errors.batch'));
            if (!v.reason.trim()) issue(['reason'], t('reentry.errors.reason'));

            v.extras.forEach((x, i) => {
                if (!x.batch) issue(['extras', i, 'batch'], t('reentry.errors.linkBatch'));
                else if (x.batch === v.batch) issue(['extras', i, 'batch'], t('reentry.errors.sameBatch'));
                else if (
                    v.extras.some(
                        (y, j) => j < i && y.batch === x.batch && y.from <= x.to && x.from <= y.to
                    )
                ) {
                    issue(['extras', i, 'batch'], t('reentry.errors.duplicateBatch'));
                }
                if (!x.from || !x.to) issue(['extras', i, 'to'], t('reentry.errors.dates'));
                else if (x.to < x.from) issue(['extras', i, 'to'], t('reentry.errors.endBeforeStart'));
                else if (x.to < today) issue(['extras', i, 'to'], t('reentry.errors.endInPast'));
                else if ((lengthInDays(x.from, x.to) ?? 0) > EXTRA_CLASS_MAX_DAYS) {
                    issue(['extras', i, 'to'], t('reentry.errors.tooLong', { count: EXTRA_CLASS_MAX_DAYS }));
                }
            });

            const checkSlot = (path: (string | number)[], s: z.infer<typeof slotSchema>) => {
                if (!s.date) issue([...path, 'date'], t('reentry.errors.sessionDate'));
                else if (s.date < today || (s.date === today && s.start && s.start < nowHm())) {
                    issue([...path, 'date'], t('reentry.errors.sessionPast'));
                }
                if (!s.start) issue([...path, 'start'], t('reentry.errors.sessionTime'));
                const d = Number(s.duration);
                if (!Number.isInteger(d) || d < 5 || d > 240) {
                    issue([...path, 'duration'], t('reentry.errors.duration'));
                }
            };
            if (v.oneOnOneOn) {
                if (!v.teacher) issue(['teacher'], t('reentry.errors.teacher'));
                v.sessions.forEach((s, i) => checkSlot(['sessions', i], s));
                if (EXTRA_PAYMENT_READY && (v.amount || v.dueDate)) {
                    if (!(Number(v.amount) > 0)) issue(['amount'], t('reentry.errors.amount'));
                    if (!v.dueDate || v.dueDate < today) issue(['dueDate'], t('reentry.errors.dueDate'));
                }
            }
            if (v.assessmentMode === 'schedule') {
                if (!v.assessmentTeacher) issue(['assessmentTeacher'], t('reentry.errors.teacher'));
                checkSlot(['assessment'], v.assessment);
            }
            if (v.returnOn && v.returnOn < today) issue(['returnOn'], t('reentry.errors.returnInPast'));
        });

export type ReentryFormValues = z.infer<ReturnType<typeof buildSchema>>;

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
 * Re-entry in one step: the batch the learner returns to moves to the Re-entry status, fees and
 * access restart (when a pause is running), plus optional extra classes in other ongoing batches,
 * a one-on-one bridge class with a teacher and a short assessment session, and a date to go back
 * to the default status. Sends no message: sessions created here have no reminders.
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
    const reentryLabel = findReentryStatus(settings)?.label ?? t('reentry.statusFallback');
    const own = useMemo(() => enrolments.filter((e) => !e.extra_class), [enrolments]);
    const [returnTouched, setReturnTouched] = useState(false);
    const staff = useStaffOptions(instituteId);

    const form = useForm<ReentryFormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            batch:
                (initialBatch && own.some((e) => e.package_session_id === initialBatch)
                    ? initialBatch
                    : own.length === 1
                      ? own[0]!.package_session_id
                      : '') ?? '',
            reason: '',
            restartFees: false,
            extras: [],
            oneOnOneOn: false,
            teacher: '',
            title: t('reentry.oneOnOne.defaultTitle'),
            sessions: [{ date: '', start: '', duration: '60' }],
            amount: '',
            dueDate: '',
            assessmentMode: 'skip',
            assessmentTeacher: '',
            assessment: { date: '', start: '', duration: String(DEFAULT_ASSESSMENT_MINUTES) },
            returnOn: '',
        },
    });
    const extras = useFieldArray({ control: form.control, name: 'extras' });
    const sessions = useFieldArray({ control: form.control, name: 'sessions' });
    const v = form.watch();
    const selected = own.find((e) => e.package_session_id === v.batch);
    const onPause = Boolean(selected?.on_pause);

    // The return date follows the latest extra-class last day and one-on-one date until staff set it.
    const suggestedReturn = [
        ...v.extras.map((x) => x.to),
        ...(v.oneOnOneOn ? v.sessions.map((s) => s.date) : []),
    ]
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
        mutationFn: (f: ReentryFormValues) =>
            startReentry(instituteId, {
                user_id: userId,
                package_session_id: f.batch,
                reason: f.reason.trim(),
                extra_classes: f.extras.map((x) => ({
                    package_session_id: x.batch,
                    from: x.from,
                    to: x.to,
                })),
                one_on_one: f.oneOnOneOn
                    ? {
                          teacher_user_id: f.teacher,
                          title: f.title.trim() || null,
                          sessions: f.sessions.map((s) => ({
                              date: s.date,
                              start_time: s.start,
                              duration_minutes: Number(s.duration),
                          })),
                          payment:
                              EXTRA_PAYMENT_READY && f.amount
                                  ? { amount: Number(f.amount), due_date: f.dueDate }
                                  : null,
                      }
                    : null,
                assessment:
                    f.assessmentMode === 'schedule'
                        ? {
                              teacher_user_id: f.assessmentTeacher,
                              date: f.assessment.date,
                              start_time: f.assessment.start,
                              duration_minutes: Number(f.assessment.duration),
                          }
                        : null,
                return_on: f.returnOn || null,
                resume_pause: onPause && f.restartFees,
            }),
        onSuccess: (res) => {
            toast.success(
                res.sessions.length > 0
                    ? t('reentry.savedWithSessions', { count: res.sessions.length })
                    : t('reentry.saved')
            );
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
            dialogWidth="max-w-2xl"
            footer={
                <>
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={mutation.isPending || (onPause && !v.restartFees)}
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

                    <FeesSection
                        control={form.control}
                        userId={userId}
                        instituteId={instituteId}
                        batch={v.batch}
                        onPause={onPause}
                        restart={v.restartFees}
                    />
                    <ExtraClassesSection
                        control={form.control}
                        fields={extras.fields}
                        values={v.extras}
                        onAdd={() => extras.append({ batch: '', from: today, to: '' })}
                        onRemove={extras.remove}
                        max={MAX_EXTRA_CLASSES}
                        instituteId={instituteId}
                        batchTerm={batchTerm}
                        today={today}
                    />
                    <OneOnOneSection
                        control={form.control}
                        on={v.oneOnOneOn}
                        fields={sessions.fields}
                        onAdd={() => {
                            const last = v.sessions[v.sessions.length - 1];
                            sessions.append({
                                date: '',
                                start: last?.start ?? '',
                                duration: last?.duration ?? '60',
                            });
                        }}
                        onRemove={sessions.remove}
                        max={MAX_ONE_ON_ONE_SESSIONS}
                        staff={staff}
                        today={today}
                    />
                    <AssessmentSection
                        control={form.control}
                        mode={v.assessmentMode}
                        staff={staff}
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

                    <ReentrySummary
                        values={v}
                        instituteId={instituteId}
                        statusLabel={reentryLabel}
                        backTo={backTo}
                        onPause={onPause}
                        staff={staff}
                        batchLabel={(id) => selectedLabel(own, id)}
                    />
                </form>
            </Form>
        </MyDialog>
    );
};

const selectedLabel = (own: JourneyEnrolment[], id: string) =>
    own.find((e) => e.package_session_id === id)?.course_label || id;
