import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BellSlash, PauseCircle } from '@phosphor-icons/react';
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
import { BreakEffectsPanel } from './break-effects-panel';
import { BREAK_REASONS, QUICK_LENGTHS, addDaysTo, lengthInDays } from './break-utils';

const ALL_COURSES = 'ALL';

const schema = z
    .object({
        kind: z.enum(['HOLD', 'PAUSE']),
        course: z.string(),
        startsOn: z.string().min(1),
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
            ctx.addIssue({ code: 'custom', path: ['course'], message: 'pauseNeedsCourse' });
        }
        if (!v.openEnded && !v.endsOn) {
            ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'endRequired' });
        }
        if (!v.openEnded && v.endsOn && v.endsOn < v.startsOn) {
            ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'endBeforeStart' });
        }
        if (v.kind === 'HOLD' && !v.stopClass && !v.stopFee) {
            ctx.addIssue({ code: 'custom', path: ['stopFee'], message: 'nothingToStop' });
        }
    });

type FormValues = z.infer<typeof schema>;

interface NewBreakDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialKind: BreakKind;
    userId: string;
    instituteId: string;
    learnerName?: string;
    today: string;
    courses: BreakCourse[];
}

/** Debounces a value so the preview is asked for once the admin stops typing. */
const useDebounced = <T,>(value: T, ms: number): T => {
    const [v, setV] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setV(value), ms);
        return () => clearTimeout(id);
    }, [value, ms]);
    return v;
};

/**
 * Give a learner a break: a hold (reminders stop, nothing else changes) or a pause
 * (billing and expiry stop, access optionally off, dates move on return). The live
 * "What will happen" panel shows the server's own date maths before anything is saved.
 */
export const NewBreakDialog = ({
    open,
    onOpenChange,
    initialKind,
    userId,
    instituteId,
    learnerName,
    today,
    courses,
}: NewBreakDialogProps) => {
    const { t } = useTranslation('manageStudentsBreaks');
    const queryClient = useQueryClient();

    const defaults = useMemo<FormValues>(
        () => ({
            kind: initialKind,
            course:
                initialKind === 'PAUSE' || courses.length === 1
                    ? courses[0]?.package_session_id ?? ''
                    : ALL_COURSES,
            startsOn: today,
            openEnded: false,
            endsOn: addDaysTo(today, 13),
            stopClass: true,
            stopFee: true,
            removeAccess: true,
            reason: '',
            note: '',
        }),
        [initialKind, courses, today]
    );

    const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });

    // Fresh form for every open, so nothing carries over to another learner.
    useEffect(() => {
        if (open) form.reset(defaults);
    }, [open, defaults, form]);

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
    // Debounce a string, not the object: a fresh object every render would never settle.
    const debouncedKey = useDebounced(JSON.stringify(request), 300);

    const previewQuery = useQuery({
        queryKey: [ENROLMENT_BREAKS_QUERY_KEY, 'preview', instituteId, debouncedKey],
        queryFn: () => previewBreak(instituteId, JSON.parse(debouncedKey) as BreakRequest),
        enabled: open && Boolean(request.starts_on),
        staleTime: 10_000,
    });

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
            onOpenChange(false);
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('toast.failed'));
        },
    });

    const courseOptions = [
        ...(isPause ? [] : [{ _id: ALL_COURSES, value: ALL_COURSES, label: t('form.allCourses') }]),
        ...courses.map((c) => ({
            _id: c.package_session_id,
            value: c.package_session_id,
            label: c.course_label,
        })),
    ];

    const blocked = (previewQuery.data?.blockers.length ?? 0) > 0;
    const length = values.openEnded ? null : lengthInDays(values.startsOn, values.endsOn);

    const setKind = (kind: BreakKind) => {
        form.setValue('kind', kind);
        if (kind === 'PAUSE' && values.course === ALL_COURSES) {
            form.setValue('course', courses[0]?.package_session_id ?? '');
        }
    };

    const fieldError = (key?: string) => (key ? t(`form.errors.${key}`) : undefined);

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={learnerName ? t('form.titleFor', { name: learnerName }) : t('form.title')}
            dialogWidth="max-w-xl"
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
                        disable={blocked || previewQuery.isFetching || mutation.isPending}
                        onAsyncClick={form.handleSubmit(() => mutation.mutateAsync())}
                        loadingText={t('form.saving')}
                    >
                        {previewQuery.data && !previewQuery.data.starts_today
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

                    {/* 2. Which course */}
                    <SelectField
                        control={form.control}
                        name="course"
                        label={t('form.course')}
                        required={isPause}
                        options={courseOptions}
                        className="w-full sm:w-full"
                        labelStyle="w-full"
                    />
                    {form.formState.errors.course && (
                        <p className="-mt-3 text-caption text-danger-600">
                            {fieldError(form.formState.errors.course.message)}
                        </p>
                    )}

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
                                                    field.onChange(e.target.value)
                                                }
                                                min={today}
                                                className="w-full sm:w-full"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="endsOn"
                                render={({ field, fieldState }) => (
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
                                        {fieldState.error && (
                                            <p className="text-caption text-danger-600">
                                                {fieldError(fieldState.error.message)}
                                            </p>
                                        )}
                                    </FormItem>
                                )}
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {QUICK_LENGTHS.map((days) => {
                                const target = addDaysTo(values.startsOn, days - 1);
                                const active = !values.openEnded && values.endsOn === target;
                                return (
                                    <button
                                        key={days}
                                        type="button"
                                        onClick={() => {
                                            form.setValue('openEnded', false);
                                            form.setValue('endsOn', target, {
                                                shouldValidate: true,
                                            });
                                        }}
                                        className={cn(
                                            'rounded-full px-3 py-1 text-caption ring-1 transition-colors',
                                            active
                                                ? 'bg-primary-50 text-primary-700 ring-primary-300'
                                                : 'text-neutral-600 ring-neutral-200 hover:bg-neutral-50'
                                        )}
                                    >
                                        {t('form.quickDays', { count: days })}
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                onClick={() => form.setValue('openEnded', !values.openEnded)}
                                className={cn(
                                    'rounded-full px-3 py-1 text-caption ring-1 transition-colors',
                                    values.openEnded
                                        ? 'bg-primary-50 text-primary-700 ring-primary-300'
                                        : 'text-neutral-600 ring-neutral-200 hover:bg-neutral-50'
                                )}
                            >
                                {t('form.untilResumed')}
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
                        <legend className="mb-2 text-body font-medium text-neutral-800">
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
                            render={({ field, fieldState }) => (
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
                                        {fieldState.error && (
                                            <p className="text-caption text-danger-600">
                                                {fieldError(fieldState.error.message)}
                                            </p>
                                        )}
                                    </div>
                                </FormItem>
                            )}
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
                    </fieldset>

                    {/* 5. Why */}
                    <div className="space-y-2">
                        <span className="text-body font-medium text-neutral-800">
                            {t('form.reason')}
                        </span>
                        <div
                            className="flex flex-wrap gap-2"
                            role="radiogroup"
                            aria-label={t('form.reason')}
                        >
                            {BREAK_REASONS.map((code) => {
                                const active = values.reason === code;
                                return (
                                    <button
                                        key={code}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        onClick={() => form.setValue('reason', active ? '' : code)}
                                        className={cn(
                                            'rounded-full px-3 py-1 text-caption ring-1 transition-colors',
                                            active
                                                ? 'bg-primary-50 text-primary-700 ring-primary-300'
                                                : 'text-neutral-600 ring-neutral-200 hover:bg-neutral-50'
                                        )}
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
                                    <FormLabel className="sr-only">{t('form.note')}</FormLabel>
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

                    {/* 6. What will happen */}
                    <BreakEffectsPanel
                        preview={previewQuery.data}
                        isLoading={previewQuery.isLoading}
                        mode="create"
                    />
                </form>
            </Form>
        </MyDialog>
    );
};
