import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowClockwise, Info, UsersThree, WarningCircle, X } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Form, FormField } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { createEngagementPlan, getEngagementPlan } from '../-services/engagement-service';
import type {
    EngagementItemDTO,
    EngagementItemRequest,
    EngagementPlanDTO,
    EngagementPlanRequest,
    EngagementSlotDTO,
    EngagementSlotRequest,
} from '../-types/types';
import {
    addDays,
    daysBetween,
    formatDayRange,
    instituteTimeZone,
    isEveryDay,
    parseIsoDate,
    slotLastDate,
    todayInZone,
} from '../-utils/format';
import { BatchPickerDialog, type BatchOption } from './BatchPickerDialog';
import { useBatchInfo } from './list/PlanListToolbar';
import { serverMessageOf } from './composer/use-composer-save';

const TITLE_MAX = 200;

// ── Pure helpers (tested) ────────────────────────────────────────────────────

/** The earliest slot start: the day every other day is shifted relative to. */
export function planStartDate(plan: Pick<EngagementPlanDTO, 'slots' | 'firstDate'>): string | null {
    const starts = (plan.slots ?? []).map((slot) => slot.startDate).filter(Boolean);
    if (starts.length === 0) return plan.firstDate ?? null;
    return starts.reduce((min, day) => (day < min ? day : min));
}

/** The last day any slot runs. */
export function planEndDate(plan: Pick<EngagementPlanDTO, 'slots' | 'lastDate'>): string | null {
    const ends = (plan.slots ?? []).map((slot) => slotLastDate(slot));
    if (ends.length === 0) return plan.lastDate ?? null;
    return ends.reduce((max, day) => (day > max ? day : max));
}

/**
 * The default "Start on" for a copy: the same weekday a week later, or today when that
 * is already past, so a copy never starts in the past.
 */
export function defaultCopyStart(
    plan: Pick<EngagementPlanDTO, 'slots' | 'firstDate'>,
    today: string
): string {
    const start = planStartDate(plan);
    if (!start) return today;
    const nextWeek = addDays(start, 7);
    return nextWeek < today ? today : nextWeek;
}

function itemToRequest(item: EngagementItemDTO): EngagementItemRequest {
    return {
        itemType: item.itemType,
        title: item.title,
        sortOrder: item.sortOrder,
        isRequired: item.isRequired,
        contentHtml: item.contentHtml ?? undefined,
        slideId: item.slideId ?? undefined,
        questionId: item.questionId ?? undefined,
        assessmentId: item.assessmentId ?? undefined,
        payloadJson: item.payloadJson ?? undefined,
        completionPoints: item.completionPoints,
        correctPoints: item.correctPoints,
        maxScore: item.maxScore ?? undefined,
        hideResultUntilReveal: item.hideResultUntilReveal ?? undefined,
        missPolicy: item.missPolicy ?? undefined,
        catchUpDays: item.catchUpDays ?? undefined,
        catchUpPercent: item.catchUpPercent ?? undefined,
    };
}

function slotToRequest(
    slot: EngagementSlotDTO,
    shift: number,
    relative = false
): EngagementSlotRequest {
    // A one-day slot runs on its date whatever the mask says, and a mask carried onto a
    // shifted date could exclude it; only a repeating day keeps its weekdays.
    const repeats = slotLastDate(slot) !== slot.startDate;
    return {
        title: slot.title?.trim() || undefined,
        startDate: addDays(slot.startDate, shift),
        endDate: slot.endDate ? addDays(slot.endDate, shift) : undefined,
        startTime: slot.startTime,
        endTime: slot.endTime,
        dowMask: repeats && !relative ? slot.dowMask ?? undefined : undefined,
        // A join-based day keeps its "Day N" (the server sends it with the slot).
        ...(relative && slot.startDay != null
            ? { startDay: slot.startDay, endDay: slot.endDay ?? slot.startDay }
            : {}),
        revealTime: slot.revealTime ?? undefined,
        notifyTime: slot.notifyTime ?? undefined,
        sortOrder: slot.sortOrder,
        items: [...slot.items]
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map(itemToRequest),
    };
}

/**
 * A create request that copies `source` into new draft plans, one per target batch.
 * Ids are dropped (the server mints new ones) and every day moves by the same number
 * of days, so the plan's shape is kept. Answer keys, decks and points are copied as is.
 */
export function buildDuplicateRequest(
    source: EngagementPlanDTO,
    options: { title: string; packageSessionIds: string[]; startDate: string }
): EngagementPlanRequest {
    // A join-based plan is copied day for day; it has no calendar start to move.
    const relative = source.scheduleMode === 'RELATIVE';
    const from = planStartDate(source);
    const shift = from && !relative ? daysBetween(from, options.startDate) : 0;
    const safeShift = Number.isFinite(shift) ? shift : 0;
    return {
        title: options.title.trim(),
        description: source.description?.trim() || undefined,
        packageSessionIds: options.packageSessionIds,
        subjectId: source.subjectId ?? undefined,
        status: 'DRAFT',
        ...(relative ? { scheduleMode: 'RELATIVE' as const } : {}),
        defaultMissPolicy: source.defaultMissPolicy,
        defaultCatchUpDays: source.defaultCatchUpDays ?? undefined,
        defaultCatchUpPercent: source.defaultCatchUpPercent ?? undefined,
        slots: [...(source.slots ?? [])]
            .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.sortOrder - b.sortOrder)
            .map((slot) => slotToRequest(slot, safeShift, relative)),
    };
}

// ── Form ─────────────────────────────────────────────────────────────────────

function duplicateSchema(today: string) {
    return z.object({
        title: z
            .string()
            .trim()
            .min(1, 'duplicate.errors.title')
            .max(TITLE_MAX, 'composer.errors.titleTooLong'),
        batches: z
            .array(
                z.object({
                    id: z.string(),
                    label: z.string(),
                    courseId: z.string().optional(),
                    courseName: z.string().optional(),
                })
            )
            .min(1, 'duplicate.errors.batches'),
        startDate: z
            .string()
            .refine((value) => parseIsoDate(value) !== null, 'composer.errors.date')
            .refine((value) => value >= today, 'duplicate.errors.past'),
    });
}

type DuplicateForm = z.infer<ReturnType<typeof duplicateSchema>>;

/**
 * "Duplicate…" on a plan card: copy every day and task into new draft plans for one or
 * more batches, starting on a chosen day. Uses the ordinary create API, so the copies
 * are independent plans a teacher reviews and publishes like any other.
 */
export function DuplicatePlanDialog({
    plan,
    open,
    onOpenChange,
    onDuplicated,
    onOpenPlan,
}: {
    /** The plan as listed; its days and tasks are loaded when the dialog opens. */
    plan: EngagementPlanDTO;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called with the created plans (one per batch). */
    onDuplicated?: (plans: EngagementPlanDTO[]) => void;
    /** Offered as "Edit copy" in the success toast when exactly one copy was made. */
    onOpenPlan?: (planId: string) => void;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const timeZone = plan.timezone || instituteTimeZone();
    const today = useMemo(() => todayInZone(timeZone), [timeZone, open]); // eslint-disable-line react-hooks/exhaustive-deps
    const schema = useMemo(() => duplicateSchema(today), [today]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const sourceBatch = useBatchInfo(open ? plan.packageSessionId : null);

    const {
        data: source,
        isLoading,
        isError,
        refetch,
    } = useQuery({
        queryKey: ['engagement-plan', plan.id],
        queryFn: () => getEngagementPlan(plan.id),
        enabled: open,
    });

    const form = useForm<DuplicateForm>({
        resolver: zodResolver(schema),
        defaultValues: { title: plan.title, batches: [], startDate: today },
        mode: 'onSubmit',
        reValidateMode: 'onChange',
    });
    const { control, handleSubmit, reset, setValue, formState } = form;
    const batches = useWatch({ control, name: 'batches' });
    const startDate = useWatch({ control, name: 'startDate' });

    // Seed once per open, when the plan's days are known: same title, same batch, a week later.
    const [seededFor, setSeededFor] = useState<string | null>(null);
    useEffect(() => {
        if (!open) {
            setSeededFor(null);
            setServerError(null);
            return;
        }
        if (!source || seededFor === source.id) return;
        reset({
            title: plan.title,
            batches: plan.packageSessionId
                ? [
                      {
                          id: plan.packageSessionId,
                          label: plan.packageSessionLabel || sourceBatch?.label || '',
                      },
                  ]
                : [],
            startDate: defaultCopyStart(source, today),
        });
        setSeededFor(source.id);
    }, [open, source, seededFor, reset, plan, sourceBatch?.label, today]);

    const courseOnly = useMemo(
        () =>
            (source?.slots ?? []).some((slot) =>
                slot.items.some((item) => item.itemType === 'COURSE_SLIDE')
            ),
        [source]
    );
    const hasWeekdays = useMemo(
        () =>
            (source?.slots ?? []).some(
                (slot) => !isEveryDay(slot.dowMask) && slotLastDate(slot) !== slot.startDate
            ),
        [source]
    );

    const from = source ? planStartDate(source) : null;
    const to = source ? planEndDate(source) : null;
    const shift = from && parseIsoDate(startDate) ? daysBetween(from, startDate) : 0;
    const newRange =
        from && to && Number.isFinite(shift)
            ? formatDayRange(addDays(from, shift), addDays(to, shift), lang)
            : null;
    const slotCount = source?.slots?.length ?? 0;

    async function submit(values: DuplicateForm) {
        if (!source) return;
        setSaving(true);
        setServerError(null);
        try {
            const request = buildDuplicateRequest(source, {
                title: values.title,
                packageSessionIds: values.batches.map((b) => b.id),
                startDate: values.startDate,
            });
            const created = await createEngagementPlan(request);
            const single = created.length === 1 ? created[0] : undefined;
            toast.success(
                t('duplicate.done', { count: created.length }),
                single && onOpenPlan
                    ? {
                          action: {
                              label: t('duplicate.openCopy'),
                              onClick: () => onOpenPlan(single.id),
                          },
                      }
                    : undefined
            );
            onDuplicated?.(created);
            onOpenChange(false);
        } catch (e: unknown) {
            // A VacademyException body carries its text in `ex`, not `message`.
            setServerError(serverMessageOf(e) || t('duplicate.error'));
        } finally {
            setSaving(false);
        }
    }

    const errorText = (key?: string) => (key ? t(key) : undefined);
    const canSubmit = Boolean(source) && slotCount > 0 && !saving;

    return (
        <>
            <MyDialog
                heading={t('duplicate.title')}
                open={open}
                onOpenChange={(next) => {
                    if (!saving) onOpenChange(next);
                }}
                dialogWidth="max-w-lg"
                footer={
                    <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            disable={saving}
                            onClick={() => onOpenChange(false)}
                        >
                            {t('card.cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            disable={!canSubmit}
                            onClick={() => void handleSubmit(submit)()}
                        >
                            {saving
                                ? t('duplicate.submitting')
                                : t('duplicate.submit', { count: Math.max(1, batches.length) })}
                        </MyButton>
                    </div>
                }
            >
                <div className="space-y-5 p-6">
                    <p className="text-body text-neutral-600">
                        {t('duplicate.intro', { title: plan.title?.trim() || t('card.untitled') })}
                    </p>

                    {isLoading && (
                        <div className="space-y-3" aria-busy>
                            <Skeleton className="h-9 w-full" />
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-9 w-40" />
                        </div>
                    )}

                    {isError && (
                        <Alert className="border-danger-200 bg-danger-50 text-danger-700">
                            <div className="flex flex-wrap items-center gap-3">
                                <WarningCircle size={18} className="shrink-0" aria-hidden />
                                <AlertDescription className="min-w-0 flex-1">
                                    {t('card.loadError')}
                                </AlertDescription>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => void refetch()}
                                >
                                    <ArrowClockwise size={14} aria-hidden /> {t('common.retry')}
                                </MyButton>
                            </div>
                        </Alert>
                    )}

                    {source && slotCount === 0 && (
                        <p className="rounded-md border border-dashed border-neutral-300 p-4 text-body text-neutral-600">
                            {t('duplicate.empty')}
                        </p>
                    )}

                    {source && slotCount > 0 && (
                        <Form {...form}>
                            <form
                                className="space-y-5"
                                noValidate
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    void handleSubmit(submit)();
                                }}
                            >
                                <FormField
                                    control={control}
                                    name="title"
                                    render={({ field, fieldState }) => (
                                        <MyInput
                                            label={t('duplicate.name')}
                                            required
                                            inputType="text"
                                            input={field.value}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            onBlur={field.onBlur}
                                            ref={field.ref}
                                            maxLength={TITLE_MAX}
                                            className="sm:w-full"
                                            error={errorText(fieldState.error?.message)}
                                        />
                                    )}
                                />

                                <div className="space-y-2">
                                    <p className="text-subtitle text-neutral-900">
                                        {t('duplicate.batches')}
                                        <span className="text-danger-600">*</span>
                                    </p>
                                    {batches.length > 0 ? (
                                        <ul className="flex flex-wrap gap-2">
                                            {batches.map((batch) => (
                                                <li
                                                    key={batch.id}
                                                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 pe-1 ps-2 text-body text-neutral-900"
                                                >
                                                    <UsersThree
                                                        size={14}
                                                        aria-hidden
                                                        className="shrink-0 text-neutral-600"
                                                    />
                                                    <span className="truncate">
                                                        {batch.label ||
                                                            (batch.id === plan.packageSessionId
                                                                ? sourceBatch?.label
                                                                : null) ||
                                                            t('list.unknownBatch')}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setValue(
                                                                'batches',
                                                                batches.filter(
                                                                    (b) => b.id !== batch.id
                                                                ),
                                                                {
                                                                    shouldValidate:
                                                                        formState.isSubmitted,
                                                                }
                                                            )
                                                        }
                                                        aria-label={t('batchPicker.removeNamed', {
                                                            label:
                                                                batch.label ||
                                                                t('list.unknownBatch'),
                                                        })}
                                                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                                    >
                                                        <X size={12} aria-hidden />
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => setPickerOpen(true)}
                                    >
                                        {batches.length > 0
                                            ? t('duplicate.changeBatches')
                                            : t('duplicate.pickBatches')}
                                    </MyButton>
                                    {formState.errors.batches?.message && (
                                        <p className="flex items-center gap-1 text-body text-danger-600">
                                            <WarningCircle size={14} aria-hidden />
                                            {t(formState.errors.batches.message)}
                                        </p>
                                    )}
                                    {courseOnly && (
                                        <p className="flex items-start gap-1.5 text-caption text-neutral-600">
                                            <Info
                                                size={14}
                                                aria-hidden
                                                className="mt-0.5 shrink-0"
                                            />
                                            {sourceBatch?.courseName
                                                ? t('duplicate.courseOnlyNamed', {
                                                      course: sourceBatch.courseName,
                                                  })
                                                : t('duplicate.courseOnly')}
                                        </p>
                                    )}
                                </div>

                                {source?.scheduleMode === 'RELATIVE' ? (
                                    <p className="text-caption text-neutral-600">
                                        {t('composer.relative.cardHint')}
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        <FormField
                                            control={control}
                                            name="startDate"
                                            render={({ field, fieldState }) => (
                                                <MyInput
                                                    label={t('duplicate.startOn')}
                                                    required
                                                    inputType="date"
                                                    input={field.value}
                                                    min={today}
                                                    onChangeFunction={(e) =>
                                                        field.onChange(e.target.value)
                                                    }
                                                    onBlur={field.onBlur}
                                                    ref={field.ref}
                                                    error={errorText(fieldState.error?.message)}
                                                />
                                            )}
                                        />
                                        {newRange && (
                                            <p className="text-caption text-neutral-600">
                                                {shift === 0
                                                    ? t('duplicate.sameDates', { range: newRange })
                                                    : t(
                                                          shift > 0
                                                              ? 'duplicate.shiftedLater'
                                                              : 'duplicate.shiftedEarlier',
                                                          {
                                                              count: Math.abs(shift),
                                                              range: newRange,
                                                          }
                                                      )}
                                            </p>
                                        )}
                                        {hasWeekdays && shift % 7 !== 0 && (
                                            <p className="text-caption text-neutral-600">
                                                {t('duplicate.weekdaysKept')}
                                            </p>
                                        )}
                                    </div>
                                )}

                                <p className="text-caption text-neutral-600">
                                    {t('duplicate.draftNote')}
                                </p>

                                {serverError && (
                                    <Alert className="border-danger-200 bg-danger-50 text-danger-700">
                                        <div className="flex items-start gap-2">
                                            <WarningCircle
                                                size={18}
                                                className="mt-0.5 shrink-0"
                                                aria-hidden
                                            />
                                            <AlertDescription>{serverError}</AlertDescription>
                                        </div>
                                    </Alert>
                                )}
                            </form>
                        </Form>
                    )}
                </div>
            </MyDialog>

            <BatchPickerDialog
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                selected={batches as BatchOption[]}
                courseId={courseOnly ? sourceBatch?.courseId : undefined}
                onConfirm={(next) =>
                    setValue(
                        'batches',
                        next.map((b) => ({
                            id: b.id,
                            label: b.label,
                            courseId: b.courseId,
                            courseName: b.courseName,
                        })),
                        { shouldValidate: formState.isSubmitted }
                    )
                }
            />
        </>
    );
}
