import { useEffect, useId, useMemo, useState } from 'react';
import {
    Controller,
    get,
    useFormState,
    useWatch,
    type Control,
    type UseFormSetValue,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { CaretDown, Clock, Info, Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
    MAX_CATCH_UP_DAYS,
    MAX_RELATIVE_DAY,
    MISS_POLICIES,
    relativeDate,
    relativeDayOf,
    type ComposerForm,
    type SlotForm,
} from '../forms/composer-schema';
import {
    EVERY_DAY_MASK,
    addDays,
    formatDay,
    formatTime,
    formatTimeRange,
    instituteTimeZone,
    isEveryDay,
    slotLastDate,
    slotRunDates,
    weekdayLabels,
} from '../../-utils/format';
import { dayHeading, dayRanks } from './DayRail';

/**
 * The selected day's schedule: when it runs, its window, when answers are revealed,
 * the reminder, and the plan's late policy. Collapses to a one-line summary so the
 * tasks stay close to the top.
 *
 * Warnings (never blocking): the day is already over, it shares its window with
 * another day on the same dates, or learners would get more tasks on a date than the
 * institute's daily cap shows them.
 */

export interface DayScheduleEditorProps {
    control: Control<ComposerForm>;
    setValue: UseFormSetValue<ComposerForm>;
    dayIndex: number;
    /** The institute's daily task cap (Settings); null while unknown. */
    dailyItemCap?: number | null;
    /** The plan's timezone (edit) — else the institute's. */
    timezone?: string | null;
    /** The institute's today (yyyy-MM-dd). */
    today: string;
}

/** How many run dates the warnings look at; a runaway range can't stall typing. */
const WARNING_HORIZON = 120;

function parseCount(raw: string): number | null {
    if (raw.trim() === '') return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
}

/** The first i18n error message in a field's error, translated. */
function useErrorText() {
    const { t } = useTranslation('engagement');
    return (message: string | undefined) => (message ? t(message) : undefined);
}

export function DayScheduleEditor({
    control,
    setValue,
    dayIndex,
    dailyItemCap,
    timezone,
    today,
}: DayScheduleEditorProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const errorText = useErrorText();
    const uid = useId();
    const base = `slots.${dayIndex}` as const;

    const slot = useWatch({ control, name: base }) as SlotForm | undefined;
    // A saved day opens on its tasks with the schedule as a one-line summary; a new day
    // opens on its schedule, which is what the teacher sets first.
    const [open, setOpen] = useState(() => !slot?.id);
    const slots = useWatch({ control, name: 'slots' }) as SlotForm[] | undefined;
    const policy = useWatch({ control, name: 'defaultMissPolicy' });
    const catchUpDays = useWatch({ control, name: 'defaultCatchUpDays' });
    const catchUpPercent = useWatch({ control, name: 'defaultCatchUpPercent' });
    // A join-based plan: dates are "Day N" placeholders (see relativeDayOf).
    const relative = useWatch({ control, name: 'scheduleMode' }) === 'RELATIVE';

    // A problem in a collapsed schedule must be visible (and focusable): open it.
    const { errors } = useFormState({ control });
    const slotErrors = get(errors, base) as Record<string, unknown> | undefined;
    const hasScheduleError =
        Object.keys(slotErrors ?? {}).some((key) => key !== 'items') ||
        Boolean(errors.defaultCatchUpDays || errors.defaultCatchUpPercent);
    useEffect(() => {
        if (hasScheduleError) setOpen(true);
    }, [hasScheduleError]);

    // A day whose last date equals its first is a one-day slot (older saves send both).
    const spansDays = Boolean(slot?.endDate && slot.endDate > slot.startDate);
    const [repeatOn, setRepeatOn] = useState(spansDays);
    const repeats = repeatOn || spansDays;
    const hasQuestion = (slot?.items ?? []).some(
        (item) => item.itemType === 'QUESTION_OF_DAY' || item.itemType === 'POLL'
    );
    const zone = timezone || instituteTimeZone();

    const runDates = useMemo(
        () => (slot?.startDate ? slotRunDates(slot, 400) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [slot?.startDate, slot?.endDate, slot?.dowMask]
    );

    const warnings = useMemo(() => {
        const out: { key: string; text: string }[] = [];
        if (!slot?.startDate) return out;
        if (!relative && slotLastDate(slot) < today && runDates.length > 0) {
            out.push({ key: 'past', text: t('composer.schedule.pastDay') });
        }
        const horizon = runDates.slice(0, WARNING_HORIZON);
        const others = (slots ?? [])
            .map((other, index) => ({ other, index }))
            .filter(({ index }) => index !== dayIndex);
        // Other days running on the same date at an overlapping time.
        const clash = others.filter(({ other }) => {
            if (!other?.startDate) return false;
            const overlapsTime = other.startTime < slot.endTime && slot.startTime < other.endTime;
            if (!overlapsTime) return false;
            const theirs = new Set(slotRunDates(other, 400));
            return horizon.some((date) => theirs.has(date));
        });
        if (clash.length > 0) {
            // "Day 2" is the day's place in date order, as the rail numbers it.
            const ranks = dayRanks(slots);
            out.push({
                key: 'overlap',
                text: t('composer.schedule.overlap', {
                    days: clash
                        .map(({ index }) =>
                            t('composer.rail.dayN', { n: ranks.get(index) ?? index + 1 })
                        )
                        .join(', '),
                }),
            });
        }
        if (dailyItemCap && dailyItemCap > 0) {
            let worst: { date: string; count: number } | null = null;
            const runSets = others.map(({ other }) => ({
                dates: new Set(other?.startDate ? slotRunDates(other, 400) : []),
                count: other?.items?.length ?? 0,
            }));
            for (const date of horizon) {
                const count =
                    (slot.items?.length ?? 0) +
                    runSets.reduce((sum, run) => (run.dates.has(date) ? sum + run.count : sum), 0);
                if (count > dailyItemCap && (!worst || count > worst.count)) {
                    worst = { date, count };
                }
            }
            if (worst) {
                out.push({
                    key: 'cap',
                    text: t('composer.schedule.overCap', {
                        date: relative
                            ? t('composer.relative.day', { n: relativeDayOf(worst.date) ?? 1 })
                            : formatDay(worst.date, lang),
                        count: worst.count,
                        cap: dailyItemCap,
                    }),
                });
            }
        }
        return out;
    }, [slot, slots, runDates, today, dayIndex, dailyItemCap, lang, t, relative]);

    if (!slot) return null;

    const heading = dayHeading(slot, lang, relative ? t : null);
    const summaryParts = [
        heading.label,
        formatTimeRange(slot.startTime, slot.endTime, lang),
        hasQuestion && slot.revealTime
            ? t('composer.schedule.summaryAnswers', { time: formatTime(slot.revealTime, lang) })
            : '',
        slot.notifyTime
            ? t('composer.schedule.summaryRemind', { time: formatTime(slot.notifyTime, lang) })
            : t('composer.schedule.summaryNoRemind'),
    ].filter(Boolean);

    const labels = weekdayLabels(lang, 'short');
    const mask = isEveryDay(slot.dowMask) ? EVERY_DAY_MASK : slot.dowMask;

    function toggleWeekday(bit: number) {
        let next = mask ^ bit;
        if (next === 0) return; // at least one weekday stays on
        if (next === EVERY_DAY_MASK) next = 0; // "every day" is stored as 0
        setValue(`${base}.dowMask`, next, { shouldDirty: true, shouldValidate: true });
    }

    function setRepeats(on: boolean) {
        if (!slot) return;
        setRepeatOn(on);
        if (on) {
            if (spansDays) return;
            if (relative) {
                // "Days N to N+2"; join-based days have no weekday filter.
                setValue(`${base}.endDate`, addDays(slot.startDate, 2), { shouldDirty: true });
                setValue(`${base}.dowMask`, 0, { shouldDirty: true, shouldValidate: true });
                return;
            }
            setValue(`${base}.endDate`, addDays(slot.startDate, 6), { shouldDirty: true });
            // Weekdays only, the common school pattern; the teacher can add the weekend.
            setValue(`${base}.dowMask`, 31, { shouldDirty: true, shouldValidate: true });
        } else {
            setValue(`${base}.endDate`, '', { shouldDirty: true });
            setValue(`${base}.dowMask`, 0, { shouldDirty: true, shouldValidate: true });
        }
    }

    const revealVisible =
        hasQuestion || Boolean(slot.revealTime && slot.revealTime < slot.startTime);

    return (
        <section
            aria-labelledby={`${uid}-heading`}
            data-composer-path={base}
            className="rounded-lg border border-neutral-200 bg-white"
        >
            <Collapsible open={open} onOpenChange={setOpen}>
                <CollapsibleTrigger asChild>
                    <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                    >
                        <Clock size={18} className="shrink-0 text-neutral-500" aria-hidden />
                        <span className="min-w-0 flex-1">
                            <span
                                id={`${uid}-heading`}
                                className="block text-subtitle font-semibold text-neutral-900"
                            >
                                {t('composer.schedule.title')}
                            </span>
                            {!open && (
                                <span className="block truncate text-caption text-neutral-500">
                                    {summaryParts.join(' · ')}
                                </span>
                            )}
                        </span>
                        {!open && warnings.length > 0 && (
                            <Warning size={16} className="shrink-0 text-warning-600" aria-hidden />
                        )}
                        <CaretDown
                            size={16}
                            aria-hidden
                            className={cn(
                                'shrink-0 text-neutral-500 transition-transform',
                                open && 'rotate-180'
                            )}
                        />
                    </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="space-y-5 border-t border-neutral-100 p-4">
                        <Controller
                            control={control}
                            name={`${base}.title`}
                            render={({ field, fieldState }) => (
                                <div className="space-y-1">
                                    <MyInput
                                        label={t('composer.schedule.theme')}
                                        aria-label={t('composer.schedule.theme')}
                                        input={field.value ?? ''}
                                        onChangeFunction={(e) => field.onChange(e.target.value)}
                                        onBlur={field.onBlur}
                                        ref={field.ref}
                                        inputPlaceholder={t('composer.schedule.themePlaceholder')}
                                        error={errorText(fieldState.error?.message)}
                                        className="sm:w-full"
                                    />
                                    <p className="text-caption text-neutral-500">
                                        {t('composer.schedule.themeHint')}
                                    </p>
                                </div>
                            )}
                        />

                        {/* When it runs */}
                        <fieldset className="space-y-3">
                            <legend className="text-subtitle font-semibold text-neutral-900">
                                {t('composer.schedule.runs')}
                            </legend>
                            {relative ? (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Controller
                                        control={control}
                                        name={`${base}.startDate`}
                                        render={({ field, fieldState }) => (
                                            <RelativeDayInput
                                                label={
                                                    repeats
                                                        ? t('composer.relative.fromDay')
                                                        : t('composer.relative.dayLabel')
                                                }
                                                value={field.value}
                                                onChange={(next) => {
                                                    // Keep the length of a range when its first day moves.
                                                    const span =
                                                        slot.endDate && slot.endDate > field.value
                                                            ? (relativeDayOf(slot.endDate) ?? 0) -
                                                              (relativeDayOf(field.value) ?? 0)
                                                            : 0;
                                                    field.onChange(next);
                                                    if (span > 0) {
                                                        setValue(
                                                            `${base}.endDate`,
                                                            addDays(next, span),
                                                            {
                                                                shouldDirty: true,
                                                                shouldValidate: true,
                                                            }
                                                        );
                                                    }
                                                }}
                                                onBlur={field.onBlur}
                                                error={errorText(fieldState.error?.message)}
                                            />
                                        )}
                                    />
                                    {repeats && (
                                        <Controller
                                            control={control}
                                            name={`${base}.endDate`}
                                            render={({ field, fieldState }) => (
                                                <RelativeDayInput
                                                    label={t('composer.relative.toDay')}
                                                    value={field.value || slot.startDate}
                                                    min={relativeDayOf(slot.startDate) ?? 1}
                                                    onChange={field.onChange}
                                                    onBlur={field.onBlur}
                                                    error={errorText(fieldState.error?.message)}
                                                />
                                            )}
                                        />
                                    )}
                                </div>
                            ) : (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Controller
                                        control={control}
                                        name={`${base}.startDate`}
                                        render={({ field, fieldState }) => (
                                            <MyInput
                                                inputType="date"
                                                label={
                                                    repeats
                                                        ? t('composer.schedule.from')
                                                        : t('composer.schedule.date')
                                                }
                                                aria-label={
                                                    repeats
                                                        ? t('composer.schedule.from')
                                                        : t('composer.schedule.date')
                                                }
                                                input={field.value}
                                                onChangeFunction={(e) =>
                                                    field.onChange(e.target.value)
                                                }
                                                onBlur={field.onBlur}
                                                ref={field.ref}
                                                error={errorText(fieldState.error?.message)}
                                                className="sm:w-full"
                                            />
                                        )}
                                    />
                                    {repeats && (
                                        <Controller
                                            control={control}
                                            name={`${base}.endDate`}
                                            render={({ field, fieldState }) => (
                                                <MyInput
                                                    inputType="date"
                                                    label={t('composer.schedule.until')}
                                                    aria-label={t('composer.schedule.until')}
                                                    input={field.value}
                                                    min={slot.startDate}
                                                    onChangeFunction={(e) =>
                                                        field.onChange(e.target.value)
                                                    }
                                                    onBlur={field.onBlur}
                                                    ref={field.ref}
                                                    error={errorText(fieldState.error?.message)}
                                                    className="sm:w-full"
                                                />
                                            )}
                                        />
                                    )}
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <Switch
                                    id={`${uid}-repeat`}
                                    checked={repeats}
                                    onCheckedChange={setRepeats}
                                />
                                <Label htmlFor={`${uid}-repeat`} className="text-body">
                                    {relative
                                        ? t('composer.relative.repeat')
                                        : t('composer.schedule.repeat')}
                                </Label>
                            </div>
                            {repeats && !relative && (
                                <div className="space-y-2">
                                    <p
                                        id={`${uid}-weekdays`}
                                        className="text-caption font-semibold text-neutral-700"
                                    >
                                        {t('composer.schedule.weekdays')}
                                    </p>
                                    <div
                                        role="group"
                                        aria-labelledby={`${uid}-weekdays`}
                                        className="flex flex-wrap gap-1.5"
                                        data-composer-path={`${base}.dowMask`}
                                    >
                                        {labels.map(({ bit, label }) => {
                                            const on = (mask & bit) !== 0;
                                            return (
                                                <MyButton
                                                    key={bit}
                                                    type="button"
                                                    scale="small"
                                                    buttonType={on ? 'primary' : 'secondary'}
                                                    aria-pressed={on}
                                                    className="h-8 min-w-12 sm:min-w-12"
                                                    onClick={() => toggleWeekday(bit)}
                                                >
                                                    {label}
                                                </MyButton>
                                            );
                                        })}
                                    </div>
                                    <Controller
                                        control={control}
                                        name={`${base}.dowMask`}
                                        render={({ fieldState }) =>
                                            fieldState.error?.message ? (
                                                <p className="text-caption text-danger-600">
                                                    {t(fieldState.error.message)}
                                                </p>
                                            ) : (
                                                <></>
                                            )
                                        }
                                    />
                                </div>
                            )}
                            <p className="flex items-start gap-1.5 text-caption text-neutral-600">
                                <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
                                <span>
                                    {relative
                                        ? t('composer.relative.summary', {
                                              days: heading.label,
                                          })
                                        : repeats
                                          ? t('composer.schedule.repeatSummary', {
                                                count: runDates.length,
                                                range: heading.label,
                                            })
                                          : t('composer.schedule.oneDaySummary', {
                                                date: heading.label,
                                            })}
                                </span>
                            </p>
                        </fieldset>

                        {/* Window */}
                        <fieldset className="space-y-3">
                            <legend className="text-subtitle font-semibold text-neutral-900">
                                {t('composer.schedule.window')}
                            </legend>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Controller
                                    control={control}
                                    name={`${base}.startTime`}
                                    render={({ field, fieldState }) => (
                                        <MyInput
                                            inputType="time"
                                            label={t('composer.opensAt')}
                                            aria-label={t('composer.opensAt')}
                                            input={field.value}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            onBlur={field.onBlur}
                                            ref={field.ref}
                                            error={errorText(fieldState.error?.message)}
                                            className="sm:w-full"
                                        />
                                    )}
                                />
                                <Controller
                                    control={control}
                                    name={`${base}.endTime`}
                                    render={({ field, fieldState }) => (
                                        <MyInput
                                            inputType="time"
                                            label={t('composer.closesAt')}
                                            aria-label={t('composer.closesAt')}
                                            input={field.value}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            onBlur={field.onBlur}
                                            ref={field.ref}
                                            error={errorText(fieldState.error?.message)}
                                            className="sm:w-full"
                                        />
                                    )}
                                />
                                {revealVisible && (
                                    <Controller
                                        control={control}
                                        name={`${base}.revealTime`}
                                        render={({ field, fieldState }) => (
                                            <div className="space-y-1">
                                                <MyInput
                                                    inputType="time"
                                                    label={t('composer.schedule.answersAt')}
                                                    aria-label={t('composer.schedule.answersAt')}
                                                    input={field.value}
                                                    onChangeFunction={(e) =>
                                                        field.onChange(e.target.value)
                                                    }
                                                    onBlur={field.onBlur}
                                                    ref={field.ref}
                                                    error={errorText(fieldState.error?.message)}
                                                    className="sm:w-full"
                                                />
                                                <p className="text-caption text-neutral-500">
                                                    {t('composer.schedule.answersHint')}
                                                </p>
                                            </div>
                                        )}
                                    />
                                )}
                                <Controller
                                    control={control}
                                    name={`${base}.notifyTime`}
                                    render={({ field, fieldState }) => (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <Switch
                                                    id={`${uid}-remind`}
                                                    checked={Boolean(field.value)}
                                                    onCheckedChange={(on) =>
                                                        field.onChange(on ? slot.startTime : '')
                                                    }
                                                />
                                                <Label
                                                    htmlFor={`${uid}-remind`}
                                                    className="text-body"
                                                >
                                                    {t('composer.schedule.remind')}
                                                </Label>
                                            </div>
                                            {field.value ? (
                                                <MyInput
                                                    inputType="time"
                                                    aria-label={t('composer.schedule.remindAt')}
                                                    input={field.value}
                                                    onChangeFunction={(e) =>
                                                        field.onChange(e.target.value)
                                                    }
                                                    onBlur={field.onBlur}
                                                    ref={field.ref}
                                                    error={errorText(fieldState.error?.message)}
                                                    className="sm:w-full"
                                                />
                                            ) : (
                                                <p className="text-caption text-neutral-500">
                                                    {t('composer.schedule.remindOff')}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                />
                            </div>
                            <p className="text-caption text-neutral-500">
                                {t('composer.schedule.timezone', { zone })}
                            </p>
                        </fieldset>

                        {/* Late policy (plan-wide) */}
                        <fieldset className="space-y-3" data-composer-path="defaultMissPolicy">
                            <legend className="text-subtitle font-semibold text-neutral-900">
                                {t('composer.ifMissed')}
                            </legend>
                            <p className="text-caption text-neutral-500">
                                {t('composer.schedule.policyScope')}
                            </p>
                            <Controller
                                control={control}
                                name="defaultMissPolicy"
                                render={({ field }) => (
                                    <RadioGroup
                                        value={field.value}
                                        onValueChange={(value) => {
                                            field.onChange(value);
                                            // Start a catch-up policy from the usual terms
                                            // rather than blank fields.
                                            if (value !== 'EXPIRES' && catchUpDays == null) {
                                                setValue('defaultCatchUpDays', 2, {
                                                    shouldDirty: true,
                                                });
                                            }
                                            if (
                                                value === 'CATCH_UP_REDUCED' &&
                                                catchUpPercent == null
                                            ) {
                                                setValue('defaultCatchUpPercent', 50, {
                                                    shouldDirty: true,
                                                });
                                            }
                                        }}
                                        aria-label={t('composer.ifMissed')}
                                        className="grid gap-2 sm:grid-cols-3"
                                    >
                                        {MISS_POLICIES.map((option) => {
                                            const id = `${uid}-miss-${option}`;
                                            const checked = field.value === option;
                                            return (
                                                <label
                                                    key={option}
                                                    htmlFor={id}
                                                    className={cn(
                                                        'flex cursor-pointer items-start gap-2 rounded-lg border p-3',
                                                        checked
                                                            ? 'border-primary-300 bg-primary-50'
                                                            : 'border-neutral-200 hover:border-neutral-300'
                                                    )}
                                                >
                                                    <RadioGroupItem
                                                        id={id}
                                                        value={option}
                                                        className="mt-0.5"
                                                    />
                                                    <span className="min-w-0">
                                                        <span className="block text-body font-semibold text-neutral-900">
                                                            {t(`composer.miss.${option}`)}
                                                        </span>
                                                        <span className="block text-caption text-neutral-500">
                                                            {t(`composer.miss.${option}_hint`)}
                                                        </span>
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </RadioGroup>
                                )}
                            />
                            {policy && policy !== 'EXPIRES' && (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Controller
                                        control={control}
                                        name="defaultCatchUpDays"
                                        render={({ field, fieldState }) => (
                                            <MyInput
                                                inputType="number"
                                                min={1}
                                                max={MAX_CATCH_UP_DAYS}
                                                label={t('composer.schedule.catchUpDays')}
                                                aria-label={t('composer.schedule.catchUpDays')}
                                                inputPlaceholder="2"
                                                input={
                                                    field.value == null ? '' : String(field.value)
                                                }
                                                onChangeFunction={(e) =>
                                                    field.onChange(parseCount(e.target.value))
                                                }
                                                onBlur={field.onBlur}
                                                ref={field.ref}
                                                error={errorText(fieldState.error?.message)}
                                                className="sm:w-full"
                                            />
                                        )}
                                    />
                                    {policy === 'CATCH_UP_REDUCED' && (
                                        <Controller
                                            control={control}
                                            name="defaultCatchUpPercent"
                                            render={({ field, fieldState }) => (
                                                <MyInput
                                                    inputType="number"
                                                    min={1}
                                                    max={100}
                                                    label={t('composer.schedule.catchUpPercent')}
                                                    aria-label={t(
                                                        'composer.schedule.catchUpPercent'
                                                    )}
                                                    inputPlaceholder="50"
                                                    input={
                                                        field.value == null
                                                            ? ''
                                                            : String(field.value)
                                                    }
                                                    onChangeFunction={(e) =>
                                                        field.onChange(parseCount(e.target.value))
                                                    }
                                                    onBlur={field.onBlur}
                                                    ref={field.ref}
                                                    error={errorText(fieldState.error?.message)}
                                                    className="sm:w-full"
                                                />
                                            )}
                                        />
                                    )}
                                </div>
                            )}
                        </fieldset>
                    </div>
                </CollapsibleContent>
            </Collapsible>

            {warnings.length > 0 && (
                <ul className="space-y-2 border-t border-neutral-100 p-4" aria-live="polite">
                    {warnings.map((warning) => (
                        <li
                            key={warning.key}
                            className="flex items-start gap-2 rounded-md bg-warning-50 px-3 py-2 text-caption text-warning-700"
                        >
                            <Warning size={16} className="mt-0.5 shrink-0" aria-hidden />
                            <span className="min-w-0 flex-1">
                                {warning.text}
                                {warning.key === 'cap' && (
                                    <>
                                        {' '}
                                        <a
                                            href="/settings?selectedTab=engagement"
                                            target="_blank"
                                            rel="noreferrer"
                                            className="font-semibold underline underline-offset-2"
                                        >
                                            {t('composer.schedule.openSettings')}
                                        </a>
                                    </>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * A "Day N" number field over a placeholder date: shows N, writes the date for Day N.
 * A blank or out-of-range entry is kept as typed until blur, so the teacher can clear
 * the field and type a new number.
 */
function RelativeDayInput({
    label,
    value,
    min = 1,
    onChange,
    onBlur,
    error,
}: {
    label: string;
    value: string;
    min?: number;
    onChange: (iso: string) => void;
    onBlur: () => void;
    error?: string;
}) {
    const day = relativeDayOf(value);
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <MyInput
            inputType="number"
            label={label}
            aria-label={label}
            input={draft ?? (day != null ? String(day) : '')}
            min={min}
            max={MAX_RELATIVE_DAY}
            step={1}
            inputMode="numeric"
            onChangeFunction={(e) => {
                const raw = e.target.value;
                const n = parseCount(raw);
                if (n != null && n >= min && n <= MAX_RELATIVE_DAY) {
                    setDraft(null);
                    onChange(relativeDate(n));
                } else {
                    setDraft(raw);
                }
            }}
            onBlur={() => {
                setDraft(null);
                onBlur();
            }}
            error={error}
            className="sm:w-full"
        />
    );
}
