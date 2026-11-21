import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { BellSlash, CaretDown, CaretRight, PauseCircle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
    ENROLMENT_BREAKS_QUERY_KEY,
    createBreak,
    previewBreak,
    type BreakCourse,
    type BreakKind,
    type BreakRequest,
} from '@/services/enrolment-breaks';
import { BreakEffectsPanel, useFirstBlocker } from './break-effects-panel';
import { BREAK_REASONS, QUICK_LENGTHS, addDaysTo, chipClasses, lengthInDays } from './break-utils';

const ALL_COURSES = 'ALL';

const buildSchema = (t: TFunction) =>
    z
        .object({
            kind: z.enum(['HOLD', 'PAUSE']),
            course: z.string(),
            startsOn: z.string().min(1, t('form.errors.startRequired')),
            openEnded: z.boolean(),
            endsOn: z.string(),
            stopClass: z.boolean(),
            stopFee: z.boolean(),
            removeAccess: z.boolean(),
            reason: z.string(),
            note: z.string().max(1000),
        })
        .superRefine((v, ctx) => {
            if (v.kind === 'PAUSE' && (!v.course || v.course === ALL_COURSES)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['course'],
                    message: t('form.errors.pauseNeedsCourse'),
                });
            }
            if (!v.openEnded && !v.endsOn) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['endsOn'],
                    message: t('form.errors.endRequired'),
                });
            }
            if (!v.openEnded && v.endsOn && v.endsOn < v.startsOn) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['endsOn'],
                    message: t('form.errors.endBeforeStart'),
                });
            }
            if (v.kind === 'HOLD' && !v.stopClass && !v.stopFee) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['stopFee'],
                    message: t('form.errors.nothingToStop'),
                });
            }
        });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface NewBreakDialogProps {
    onClose: () => void;
    userId: string;
    instituteId: string;
    learnerName?: string;
    today: string;
    /** Courses a new break can still go on (those without a live break). */
    courses: BreakCourse[];
    /** False when any course already has a live break: "All courses" is then not offered. */
    allowAllCourses: boolean;
}

/** Debounces a primitive so the preview is asked for once the admin stops changing things. */
const useDebounced = <T,>(value: T, ms: number): T => {
    const [v, setV] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setV(value), ms);
        return () => clearTimeout(id);
    }, [value, ms]);
    return v;
};

/**
 * Add a break: a reminder hold (only reminders stop) or a pause (billing and expiry stop,
 * access optionally off, dates move on return). Mounted only while open, so every open
 * starts fresh. The "What will happen" panel shows the server's own date maths first.
 */
export const NewBreakDialog = ({
    onClose,
    userId,
    instituteId,
    learnerName,
    today,
    courses,
    allowAllCourses,
}: NewBreakDialogProps) => {
    const { t } = useTranslation('manageStudentsBreaks');
    const queryClient = useQueryClient();
    const schema = useMemo(() => buildSchema(t), [t]);
    const [showReason, setShowReason] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            kind: 'HOLD',
            course:
                allowAllCourses && courses.length > 1
                    ? ALL_COURSES
                    : courses[0]?.package_session_id ?? '',
            startsOn: today,
            openEnded: false,
            endsOn: addDaysTo(today, 13),
            stopClass: true,
            stopFee: true,
            removeAccess: true,
            reason: '',
            note: '',
        },
    });

    const values = form.watch();
    const isPause = values.kind === 'PAUSE';

    const request: BreakRequest = {
        user_id: userId,
        kind: values.kind,
        package_session_id: values.course && values.course !== ALL_COURSES ? values.course : null,
        stop_class_reminders: values.stopClass,
        stop_fee_reminders: values.stopFee,
        remove_access: isPause && values.removeAccess,
        starts_on: values.startsOn,
        ends_on: values.openEnded ? null : values.endsOn || null,
        reason: values.reason || null,
        note: values.note.trim() || null,
    };

    // Only what changes the outcome drives the preview (not the reason or the note), as a
    // string so the debounce settles, and the last preview stays on screen while it refreshes.
    const effectKey = JSON.stringify({ ...request, reason: null, note: null });
    const debouncedKey = useDebounced(effectKey, 300);
    const previewQuery = useQuery({
        queryKey: [ENROLMENT_BREAKS_QUERY_KEY, 'preview', instituteId, debouncedKey],
        queryFn: () => previewBreak(instituteId, JSON.parse(debouncedKey) as BreakRequest),
        enabled: Boolean(values.startsOn),
        placeholderData: keepPreviousData,
        staleTime: 10_000,
    });
    const firstBlocker = useFirstBlocker(previewQuery.data);

    const mutation = useMutation({
        mutationFn: () => createBreak(instituteId, request),
        onSuccess: (created) => {
            toast.success(
                t(
                    created.status === 'ACTIVE'
                        ? created.kind === 'PAUSE'
                            ? 'toast.pauseStarted'
                            : 'toast.holdStarted'
                        : 'toast.scheduled'
                )
            );
            queryClient.invalidateQueries({ queryKey: [ENROLMENT_BREAKS_QUERY_KEY] });
            // Memberships and access change with a pause.
            ['user-plans', 'students', 'GET_LEARNER_PACKAGES', 'cpo-side-view'].forEach((key) =>
                queryClient.invalidateQueries({ queryKey: [key] })
            );
            onClose();
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('toast.failed'));
        },
    });

    const courseOptions = [
        ...(isPause || !allowAllCourses
            ? []
            : [{ _id: ALL_COURSES, value: ALL_COURSES, label: t('form.allCourses') }]),
        ...courses.map((c) => ({
            _id: c.package_session_id,
            value: c.package_session_id,
            label: c.course_label,
        })),
    ];

    const settled = debouncedKey === effectKey && !previewQuery.isFetching;
    const blocked = (previewQuery.data?.blockers.length ?? 0) > 0;
    const length = values.openEnded ? null : lengthInDays(values.startsOn, values.endsOn);
    const scheduled = values.startsOn > today;

    const setKind = (kind: BreakKind) => {
        form.setValue('kind', kind);
        if (kind === 'PAUSE' && values.course === ALL_COURSES) {
            form.setValue('course', courses[0]?.package_session_id ?? '');
        }
    };

    /** A new first day keeps the length the admin chose: the last day moves with it. */
    const changeStart = (next: string) => {
        const len = lengthInDays(values.startsOn, values.endsOn);
        form.setValue('startsOn', next, { shouldValidate: true });
        if (!values.openEnded && len && len > 0 && next) {
            form.setValue('endsOn', addDaysTo(next, len - 1), { shouldValidate: true });
        }
    };

    const footerNote = previewQuery.isError
        ? t('form.previewFailed')
        : settled && firstBlocker
          ? firstBlocker
          : null;

    return (
        <MyDialog
            open
            onOpenChange={(open) => !open && onClose()}
            heading={learnerName ? t('form.titleFor', { name: learnerName }) : t('form.title')}
            dialogWidth="max-w-xl"
            footerLeft={
                footerNote ? (
                    <p className="text-caption text-danger-600">{footerNote}</p>
                ) : undefined
            }
            footer={
                <>
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('form.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={blocked || previewQuery.isError || !settled || mutation.isPending}
                        onAsyncClick={form.handleSubmit(() => mutation.mutateAsync())}
                        loadingText={t('form.saving')}
                    >
                        {scheduled
                            ? t('form.submitSchedule')
                            : isPause
                              ? t('form.submitPause')
                              : t('form.submitHold')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
                    {/* 1. What kind of break */}
                    <RadioGroup
                        value={values.kind}
                        onValueChange={(v) => setKind(v as BreakKind)}
                        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                        aria-label={t('form.kindLabel')}
                    >
                        {(['HOLD', 'PAUSE'] as const).map((kind) => {
                            const selected = values.kind === kind;
                            const Icon = kind === 'HOLD' ? BellSlash : PauseCircle;
                            return (
                                <label
                                    key={kind}
                                    htmlFor={`break-kind-${kind}`}
                                    className={cn(
                                        'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
                                        selected
                                            ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-300'
                                            : 'border-neutral-200 hover:border-primary-200'
                                    )}
                                >
                                    <RadioGroupItem
                                        id={`break-kind-${kind}`}
                                        value={kind}
                                        className="mt-1"
                                    />
                                    <span className="space-y-1">
                                        <span className="flex items-center gap-1.5 text-subtitle font-semibold text-neutral-800">
                                            <Icon className="size-4 text-primary-500" />
                                            {t(
                                                kind === 'HOLD'
                                                    ? 'form.holdTitle'
                                                    : 'form.pauseTitle'
                                            )}
                                        </span>
                                        <span className="block text-caption text-neutral-500">
                                            {t(
                                                kind === 'HOLD' ? 'form.holdHint' : 'form.pauseHint'
                                            )}
                                        </span>
                                    </span>
                                </label>
                            );
                        })}
                    </RadioGroup>

                    {/* 2. Which course (and, for a pause, whether it is switched off) */}
                    <div className="space-y-3">
                        <SelectField
                            control={form.control}
                            name="course"
                            label={t('form.course')}
                            required={isPause}
                            options={courseOptions}
                            className="w-full sm:w-full"
                            labelStyle="w-full"
                        />
                        {isPause && (
                            <FormField
                                control={form.control}
                                name="removeAccess"
                                render={({ field }) => (
                                    <FormItem className="flex items-start justify-between gap-3 space-y-0 rounded-md border border-neutral-200 p-3">
                                        <div className="space-y-0.5">
                                            <FormLabel className="font-normal">
                                                {t('form.removeAccess')}
                                            </FormLabel>
                                            <FormDescription className="text-caption">
                                                {t('form.removeAccessHint')}
                                            </FormDescription>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        )}
                    </div>

                    {/* 3. When */}
                    <div className="space-y-2">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="startsOn"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('form.firstDay')}</FormLabel>
                                        <FormControl>
                                            <MyInput
                                                inputType="date"
                                                input={field.value}
                                                onChangeFunction={(e) =>
                                                    changeStart(e.target.value)
                                                }
                                                min={today}
                                                className="w-full sm:w-full"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="endsOn"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('form.lastDay')}</FormLabel>
                                        <FormControl>
                                            <MyInput
                                                inputType="date"
                                                input={values.openEnded ? '' : field.value}
                                                onChangeFunction={(e) => {
                                                    form.setValue('openEnded', false);
                                                    field.onChange(e.target.value);
                                                }}
                                                min={values.startsOn}
                                                disabled={values.openEnded}
                                                className="w-full sm:w-full"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                        <div
                            className="flex flex-wrap items-center gap-2"
                            aria-label={t('form.quickLabel')}
                        >
                            {QUICK_LENGTHS.map((days) => {
                                const target = addDaysTo(values.startsOn, days - 1);
                                const active = !values.openEnded && values.endsOn === target;
                                return (
                                    <button
                                        key={days}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => {
                                            form.setValue('openEnded', false);
                                            form.setValue('endsOn', target, {
                                                shouldValidate: true,
                                            });
                                        }}
                                        className={chipClasses(active)}
                                    >
                                        {t('form.quickDays', { count: days })}
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                aria-pressed={values.openEnded}
                                onClick={() =>
                                    form.setValue('openEnded', !values.openEnded, {
                                        shouldValidate: true,
                                    })
                                }
                                className={chipClasses(values.openEnded)}
                            >
                                {t('form.noEndDate')}
                            </button>
                            {length !== null && length > 0 && (
                                <span className="text-caption text-neutral-500">
                                    {t('form.lengthDays', { count: length })}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* 4. What stops */}
                    <fieldset className="space-y-3">
                        <legend className="mb-2 text-body font-semibold text-neutral-800">
                            {t('form.whatStops')}
                        </legend>
                        <FormField
                            control={form.control}
                            name="stopClass"
                            render={({ field }) => (
                                <FormItem className="flex items-start gap-3 space-y-0">
                                    <FormControl>
                                        <Checkbox
                                            checked={field.value}
                                            onCheckedChange={(v) => field.onChange(v === true)}
                                        />
                                    </FormControl>
                                    <div className="space-y-0.5">
                                        <FormLabel className="font-normal">
                                            {t('form.stopClass')}
                                        </FormLabel>
                                        <FormDescription className="text-caption">
                                            {t('form.stopClassHint')}
                                        </FormDescription>
                                    </div>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="stopFee"
                            render={({ field }) => (
                                <FormItem className="flex items-start gap-3 space-y-0">
                                    <FormControl>
                                        <Checkbox
                                            checked={field.value}
                                            onCheckedChange={(v) => field.onChange(v === true)}
                                        />
                                    </FormControl>
                                    <div className="space-y-0.5">
                                        <FormLabel className="font-normal">
                                            {t('form.stopFee')}
                                        </FormLabel>
                                        <FormDescription className="text-caption">
                                            {t('form.stopFeeHint')}
                                        </FormDescription>
                                        <FormMessage />
                                    </div>
                                </FormItem>
                            )}
                        />
                    </fieldset>

                    {/* 5. Why (optional) */}
                    <div className="space-y-2">
                        <button
                            type="button"
                            onClick={() => setShowReason((v) => !v)}
                            aria-expanded={showReason}
                            className="flex items-center gap-1 rounded-sm text-body font-semibold text-neutral-700 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                        >
                            {showReason ? (
                                <CaretDown className="size-3.5" />
                            ) : (
                                <CaretRight className="size-3.5 rtl:rotate-180" />
                            )}
                            {t('form.addReason')}
                        </button>
                        {showReason && (
                            <div className="space-y-3 ps-5">
                                <div className="flex flex-wrap gap-2" aria-label={t('form.reason')}>
                                    {BREAK_REASONS.map((code) => {
                                        const active = values.reason === code;
                                        return (
                                            <button
                                                key={code}
                                                type="button"
                                                aria-pressed={active}
                                                onClick={() =>
                                                    form.setValue('reason', active ? '' : code)
                                                }
                                                className={chipClasses(active)}
                                            >
                                                {t(`reasons.${code}`)}
                                            </button>
                                        );
                                    })}
                                </div>
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
                            </div>
                        )}
                    </div>

                    {/* 6. What will happen */}
                    <BreakEffectsPanel
                        preview={previewQuery.data}
                        isLoading={previewQuery.isLoading}
                        isError={previewQuery.isError}
                        onRetry={() => previewQuery.refetch()}
                        mode="create"
                    />
                </form>
            </Form>
        </MyDialog>
    );
};
