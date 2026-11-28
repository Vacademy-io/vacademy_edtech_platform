import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    get,
    useController,
    useFieldArray,
    useFormState,
    useWatch,
    type Control,
    type UseFormReturn,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowCounterClockwise,
    ArrowsClockwise,
    CaretDown,
    CheckCircle,
    Image as ImageIcon,
    Info,
    Plus,
    Trash,
    Warning,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyDropdown } from '@/components/design-system/dropdown';
import type { DropdownItem } from '@/components/design-system/utils/types/dropdown-types';
import SelectField from '@/components/design-system/select-field';
import { Form } from '@/components/ui/form';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { EngagementItemType } from '../../-types/types';
import { authorableTypes, typeMeta } from '../../-utils/type-meta';
import { formatDay, formatNumber, formatTime } from '../../-utils/format';
import {
    MAX_POINTS,
    countFormErrors,
    itemToForm,
    newItemForm,
    type ComposerForm,
    type ItemForm,
    type SlotForm,
} from '../forms/composer-schema';
import { ItemEditor } from '../items/ItemEditor';
import { FieldBlock, errorText, numberInputValue, parseNumberInput } from '../items/item-fields';
import { PlanPreview } from '../PlanPreview';
import {
    aiErrorMessage,
    countImagePlaceholders,
    draftAiPlan,
    illustrateReading,
    IMAGE_CREDITS,
    ITEM_CREDITS,
    mixForSingle,
    newIdempotencyKey,
    singleItemTypeFor,
    type AiDraftCounts,
} from '../../-services/ai-plan-service';
import type { AiBriefValues, GroundingText } from '../../-stores/ai-draft-store';

/**
 * Step 3 of "Plan with AI": review and edit the draft before anything is saved.
 *
 * Edits the draft as the composer's own react-hook-form (`ComposerForm`), so every task
 * uses the shared `ItemEditor`: the MCQ answer key is visible and changeable, a deck
 * opens in the flashcards editor, points and "Required" are per task.
 *
 * Left: the days ("Thu, 25 Sep · theme · 2 tasks", a dot on a day that came back
 * short). Centre: the selected day's theme and its tasks, click to expand; each task
 * has "New version" (same type, a small paid call), "Add pictures" for a reading with
 * picture slots, and Delete with Undo. Right: "What learners see", following the
 * selected task. Above: the editable plan title, a requested ≠ delivered banner, and the
 * Rules row (late policy, reveal time, points for every task).
 */

export interface ReviewMeta {
    brief: AiBriefValues;
    requested: AiDraftCounts;
    delivered: AiDraftCounts;
    grounded: boolean;
    creditsSpent: number;
    /** Dates the server says came back short / empty. */
    shortDates?: string[];
    missingDates?: string[];
}

export interface ReviewStepProps {
    form: UseFormReturn<ComposerForm>;
    meta: ReviewMeta;
    /** The draft's grounding, so a new version is written from the same material. */
    grounding: GroundingText[];
    /** Form index of the selected day. */
    selectedDay: number;
    onSelectDay: (index: number) => void;
    /** Key of the expanded (and previewed) task. */
    openKey: string | null;
    onOpenKeyChange: (key: string | null) => void;
    /** A paid call succeeded (credits to add to the draft's running total). */
    onCreditsSpent: (credits: number) => void;
    /** A save error from the shell (already translated). */
    error?: string | null;
}

const UNDO_MS = 10_000;

function points(item: ItemForm): number {
    const bonus =
        item.itemType === 'QUESTION_OF_DAY' && item.question.format === 'MCQ'
            ? item.correctPoints ?? 0
            : 0;
    return (item.completionPoints ?? 0) + bonus;
}

function optionLetter(index: number): string {
    return String.fromCharCode(65 + index);
}

export function ReviewStep({
    form,
    meta,
    grounding,
    selectedDay,
    onSelectDay,
    openKey,
    onOpenKeyChange,
    onCreditsSpent,
    error,
}: ReviewStepProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const { control } = form;
    const slots = useWatch({ control, name: 'slots' });
    // The preview's late-policy note follows the Rules row as it is edited.
    const [missPolicy, catchUpDays, catchUpPercent] = useWatch({
        control,
        name: ['defaultMissPolicy', 'defaultCatchUpDays', 'defaultCatchUpPercent'],
    });
    const days = useFieldArray({ control, name: 'slots', keyName: 'rhfKey' });
    const railRef = useRef<HTMLOListElement | null>(null);
    const dayTopRef = useRef<HTMLDivElement | null>(null);
    const shownDay = useRef<number | null>(null);
    const [activeCardId, setActiveCardId] = useState<string | null>(null);
    const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
    const [removedDay, setRemovedDay] = useState<{ slot: SlotForm; index: number } | null>(null);

    const dayCount = days.fields.length;
    const dayIndex = Math.min(selectedDay, Math.max(0, dayCount - 1));
    const taskTotal = (slots ?? []).reduce((n, s) => n + (s?.items?.length ?? 0), 0);
    const perDay = meta.brief.perDay;
    const short =
        meta.delivered.items < meta.requested.items || meta.delivered.days < meta.requested.days;

    useEffect(() => {
        if (selectedDay !== dayIndex) onSelectDay(dayIndex);
    }, [selectedDay, dayIndex, onSelectDay]);

    // Below lg the rail scrolls sideways: keep the selected day (e.g. one picked by
    // "Go to first problem") in view.
    useEffect(() => {
        const chip = railRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
        chip?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        // Another day was picked while scrolled down its tasks: show the new day from its
        // header, not from wherever the previous day's list had scrolled to.
        const first = shownDay.current === null;
        shownDay.current = dayIndex;
        const top = dayTopRef.current;
        if (first || !top) return;
        const scroller = top.closest('.overflow-y-auto');
        if (scroller && top.getBoundingClientRect().top < scroller.getBoundingClientRect().top) {
            top.scrollIntoView?.({ block: 'start' });
        }
    }, [dayIndex]);

    const titleCtl = useController({ control, name: 'title' });
    const { errors } = useFormState({ control, name: 'title' });
    const titleError = errorText(errors.title);

    useEffect(() => {
        if (!removedDay) return;
        const timer = window.setTimeout(() => setRemovedDay(null), UNDO_MS);
        return () => window.clearTimeout(timer);
    }, [removedDay]);

    function removeDay(index: number) {
        const snapshot = form.getValues(`slots.${index}`);
        days.remove(index);
        onSelectDay(Math.max(0, Math.min(index, dayCount - 2)));
        onOpenKeyChange(null);
        if (snapshot) setRemovedDay({ slot: snapshot, index });
    }

    function undoRemoveDay() {
        if (!removedDay) return;
        const at = Math.min(removedDay.index, days.fields.length);
        days.insert(at, removedDay.slot);
        onSelectDay(at);
        setRemovedDay(null);
    }

    const slot = slots?.[dayIndex];

    return (
        <Form {...form}>
            <div className="space-y-5">
                {/* Plan header */}
                <div className="space-y-3">
                    <FieldBlock
                        label={t('wizard.reviewStep.planTitle')}
                        required
                        error={titleError}
                    >
                        {(a11y) => (
                            <MyInput
                                {...a11y}
                                ref={titleCtl.field.ref}
                                inputType="text"
                                dir="auto"
                                size="large"
                                input={titleCtl.field.value}
                                onChangeFunction={(e) => titleCtl.field.onChange(e.target.value)}
                                onBlur={titleCtl.field.onBlur}
                                className={cn(
                                    'font-semibold sm:w-full',
                                    titleError && 'border-danger-600'
                                )}
                            />
                        )}
                    </FieldBlock>
                    <p className="text-caption text-neutral-600">
                        {[
                            t('wizard.days', { count: dayCount }),
                            t('wizard.tasks', { count: taskTotal }),
                            t('wizard.reviewStep.batches', { count: meta.brief.batches.length }),
                            t('wizard.reviewStep.charged', { count: meta.creditsSpent }),
                        ].join(' · ')}
                    </p>

                    {short && (
                        <p className="flex items-start gap-2 rounded-md bg-warning-50 px-3 py-2 text-body text-warning-700">
                            <Warning size={16} className="mt-0.5 shrink-0" aria-hidden />
                            <span>
                                {t('wizard.reviewStep.shortBanner', {
                                    requested: t('wizard.tasks', { count: meta.requested.items }),
                                    requestedDays: t('wizard.days', { count: meta.requested.days }),
                                    delivered: t('wizard.tasks', { count: meta.delivered.items }),
                                    deliveredDays: t('wizard.days', { count: meta.delivered.days }),
                                })}
                                {(meta.missingDates?.length ?? 0) > 0 &&
                                    ` ${t('wizard.reviewStep.missingDays', {
                                        count: meta.missingDates!.length,
                                        days: meta
                                            .missingDates!.map((d) =>
                                                formatDay(d, lang, { weekday: true })
                                            )
                                            .join(', '),
                                    })}`}
                            </span>
                        </p>
                    )}
                    {!meta.grounded && (
                        <p className="flex items-start gap-2 rounded-md bg-info-50 px-3 py-2 text-body text-info-700">
                            <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
                            <span>{t('wizard.ungrounded')}</span>
                        </p>
                    )}
                    {error && (
                        <p
                            role="alert"
                            className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2 text-body text-danger-700"
                        >
                            <WarningCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
                            <span>{error}</span>
                        </p>
                    )}
                </div>

                <RulesRow control={control} form={form} />

                {removedDay && (
                    <div
                        role="status"
                        className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
                    >
                        <Trash size={16} className="shrink-0 text-neutral-500" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-body text-neutral-700">
                            {t('composer.taskList.removed', {
                                title:
                                    removedDay.slot.title?.trim() ||
                                    (removedDay.slot.startDate
                                        ? formatDay(removedDay.slot.startDate, lang, {
                                              weekday: true,
                                          })
                                        : t('composer.rail.dayN', { n: removedDay.index + 1 })),
                            })}
                        </span>
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            onClick={undoRemoveDay}
                        >
                            <ArrowCounterClockwise size={14} aria-hidden />{' '}
                            {t('composer.taskList.undo')}
                        </MyButton>
                    </div>
                )}

                {dayCount === 0 ? (
                    <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center">
                        <p className="text-subtitle font-semibold text-neutral-900">
                            {t('wizard.reviewStep.noDays')}
                        </p>
                        <p className="mt-1 text-body text-neutral-500">
                            {t('wizard.reviewStep.noDaysHint')}
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                        {/* Day rail */}
                        <nav
                            aria-label={t('composer.rail.label')}
                            className="min-w-0 lg:sticky lg:top-0 lg:w-56 lg:shrink-0"
                        >
                            <p className="mb-2 hidden text-subtitle font-semibold text-neutral-900 lg:block">
                                {t('composer.rail.title')}
                            </p>
                            <ol
                                ref={railRef}
                                className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
                            >
                                {days.fields.map((field, index) => {
                                    const day = slots?.[index];
                                    const count = day?.items?.length ?? 0;
                                    const isShort =
                                        count < perDay ||
                                        Boolean(
                                            day?.startDate &&
                                                meta.shortDates?.includes(day.startDate)
                                        );
                                    const selected = index === dayIndex;
                                    return (
                                        <li key={field.rhfKey} className="shrink-0 lg:shrink">
                                            <button
                                                type="button"
                                                aria-current={selected ? 'true' : undefined}
                                                onClick={() => {
                                                    onSelectDay(index);
                                                    onOpenKeyChange(null);
                                                    setActiveCardId(null);
                                                }}
                                                className={cn(
                                                    'flex w-40 flex-col rounded-lg border px-3 py-2 text-start transition-colors lg:w-full',
                                                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                                                    selected
                                                        ? 'border-primary-300 bg-primary-50'
                                                        : 'border-neutral-200 bg-white hover:border-neutral-300'
                                                )}
                                            >
                                                <span className="flex items-center gap-1.5 text-caption text-neutral-500">
                                                    {day?.startDate
                                                        ? formatDay(day.startDate, lang, {
                                                              weekday: true,
                                                          })
                                                        : t('composer.rail.dayN', { n: index + 1 })}
                                                    {isShort && (
                                                        <span
                                                            className="size-1.5 rounded-full bg-warning-500"
                                                            aria-label={t(
                                                                'wizard.reviewStep.shortDay'
                                                            )}
                                                            role="img"
                                                        />
                                                    )}
                                                </span>
                                                <span className="truncate text-body font-semibold text-neutral-900">
                                                    {day?.title?.trim() ||
                                                        t('wizard.reviewStep.noTheme')}
                                                </span>
                                                <span className="text-caption text-neutral-500">
                                                    {t('wizard.tasks', { count })}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ol>
                        </nav>

                        <div ref={dayTopRef} className="min-w-0 flex-1 scroll-mt-4 space-y-5">
                            <Tabs
                                value={mobileTab}
                                onValueChange={(value) =>
                                    setMobileTab(value === 'preview' ? 'preview' : 'edit')
                                }
                                className="xl:hidden"
                            >
                                <TabsList className="w-full">
                                    <TabsTrigger value="edit" className="flex-1">
                                        {t('composer.tabs.edit')}
                                    </TabsTrigger>
                                    <TabsTrigger value="preview" className="flex-1">
                                        {t('composer.tabs.preview')}
                                    </TabsTrigger>
                                </TabsList>
                            </Tabs>

                            <div
                                className={cn(
                                    'space-y-5',
                                    mobileTab === 'preview' && 'hidden xl:block'
                                )}
                            >
                                <DayHeader
                                    key={`theme-${days.fields[dayIndex]?.rhfKey}`}
                                    control={control}
                                    dayIndex={dayIndex}
                                    dayNumber={dayIndex + 1}
                                    date={slot?.startDate ?? ''}
                                    canRemove={dayCount > 1}
                                    onRemove={() => removeDay(dayIndex)}
                                />
                                <DayTasks
                                    key={`tasks-${days.fields[dayIndex]?.rhfKey}`}
                                    form={form}
                                    dayIndex={dayIndex}
                                    brief={meta.brief}
                                    grounding={grounding}
                                    openKey={openKey}
                                    onOpenKeyChange={(key) => {
                                        onOpenKeyChange(key);
                                        setActiveCardId(null);
                                    }}
                                    activeCardId={activeCardId}
                                    onActiveCardChange={setActiveCardId}
                                    onCreditsSpent={onCreditsSpent}
                                    canRemoveDay={dayCount > 1}
                                    onRemoveDay={() => removeDay(dayIndex)}
                                />
                            </div>

                            <div className={cn(mobileTab === 'edit' && 'hidden', 'xl:hidden')}>
                                <PlanPreview
                                    slot={slot}
                                    activeKey={openKey}
                                    onSelect={(key) => {
                                        onOpenKeyChange(key);
                                        setMobileTab('edit');
                                    }}
                                    activeCardId={activeCardId}
                                    defaultMissPolicy={missPolicy}
                                    defaultCatchUpDays={catchUpDays}
                                    defaultCatchUpPercent={catchUpPercent}
                                />
                            </div>
                        </div>

                        <aside className="hidden xl:sticky xl:top-0 xl:block xl:w-80 xl:shrink-0">
                            <PlanPreview
                                slot={slot}
                                activeKey={openKey}
                                onSelect={(key) => onOpenKeyChange(key)}
                                activeCardId={activeCardId}
                                defaultMissPolicy={missPolicy}
                                defaultCatchUpDays={catchUpDays}
                                defaultCatchUpPercent={catchUpPercent}
                            />
                        </aside>
                    </div>
                )}
            </div>
        </Form>
    );
}

// ── Rules row ────────────────────────────────────────────────────────────────

/**
 * Plan-wide rules the AI can't choose for the teacher: what happens to a missed task,
 * when answers are revealed (every day), and points for every task at once.
 */
function RulesRow({
    control,
    form,
}: {
    control: Control<ComposerForm>;
    form: UseFormReturn<ComposerForm>;
}) {
    const { t, i18n } = useTranslation('engagement');
    const uid = useId();
    const policy = useWatch({ control, name: 'defaultMissPolicy' });
    const slots = useWatch({ control, name: 'slots' });
    const daysCtl = useController({ control, name: 'defaultCatchUpDays' });
    const percentCtl = useController({ control, name: 'defaultCatchUpPercent' });
    const { errors } = useFormState({ control });
    const [completion, setCompletion] = useState(10);
    const [bonus, setBonus] = useState(20);
    const [expanded, setExpanded] = useState(false);
    const catchUpDays = daysCtl.field.value;
    const catchUpPercent = percentCtl.field.value;
    const hasError = Boolean(
        get(errors, 'defaultCatchUpDays') || get(errors, 'defaultCatchUpPercent')
    );
    const open = expanded || hasError;

    const reveals = [...new Set((slots ?? []).map((s) => s?.revealTime ?? ''))];
    const revealValue = reveals.length === 1 ? reveals[0] ?? '' : '';

    const policyOptions = (['EXPIRES', 'CATCH_UP_FULL', 'CATCH_UP_REDUCED'] as const).map(
        (value) => ({
            _id: value,
            value,
            label: t(`composer.miss.${value}`),
        })
    );

    function setRevealEverywhere(value: string) {
        (form.getValues('slots') ?? []).forEach((_, index) =>
            form.setValue(`slots.${index}.revealTime`, value, { shouldDirty: true })
        );
    }

    function applyPoints() {
        const all = form.getValues('slots') ?? [];
        let changed = 0;
        all.forEach((day, d) =>
            (day.items ?? []).forEach((item, i) => {
                const path = `slots.${d}.items.${i}` as const;
                form.setValue(`${path}.completionPoints`, completion, { shouldDirty: true });
                if (item.itemType === 'QUESTION_OF_DAY' && item.question.format === 'MCQ') {
                    form.setValue(`${path}.correctPoints`, bonus, { shouldDirty: true });
                }
                changed += 1;
            })
        );
        toast.success(t('wizard.rules.applied', { count: changed }));
    }

    const summary = [
        t(`composer.miss.${policy}`),
        policy !== 'EXPIRES' && catchUpDays
            ? t('wizard.rules.summaryDays', { count: catchUpDays })
            : '',
        policy === 'CATCH_UP_REDUCED' && catchUpPercent
            ? t('wizard.rules.summaryPercent', { percent: catchUpPercent })
            : '',
        revealValue
            ? t('wizard.rules.summaryReveal', { time: formatTime(revealValue, i18n.language) })
            : '',
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <section aria-labelledby={`${uid}-rules`} className="rounded-lg border border-neutral-200">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={`${uid}-rules-body`}
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            >
                <span className="min-w-0 flex-1">
                    <span
                        id={`${uid}-rules`}
                        className="block text-subtitle font-semibold text-neutral-900"
                    >
                        {t('wizard.rules.title')}
                    </span>
                    <span className="block truncate text-caption text-neutral-500">
                        {open ? t('wizard.rules.hint') : summary}
                    </span>
                </span>
                <span className="shrink-0 text-caption font-semibold text-primary-500">
                    {open ? t('wizard.rules.hide') : t('wizard.rules.change')}
                </span>
                <CaretDown
                    size={16}
                    aria-hidden
                    className={cn(
                        'shrink-0 text-neutral-500 transition-transform',
                        open && 'rotate-180'
                    )}
                />
            </button>
            {open && (
                <div id={`${uid}-rules-body`} className="space-y-4 border-t border-neutral-100 p-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <SelectField
                            control={control}
                            name="defaultMissPolicy"
                            label={t('composer.ifMissed')}
                            options={policyOptions}
                            className="sm:w-full"
                            labelStyle="text-body font-medium text-neutral-700"
                        />
                        {policy !== 'EXPIRES' && (
                            <FieldBlock
                                label={t('wizard.rules.catchUpDays')}
                                error={errorText(get(errors, 'defaultCatchUpDays'))}
                            >
                                {(a11y) => (
                                    <MyInput
                                        {...a11y}
                                        inputType="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={30}
                                        input={String(numberInputValue(daysCtl.field.value))}
                                        onChangeFunction={(e) =>
                                            daysCtl.field.onChange(parseNumberInput(e.target.value))
                                        }
                                        className="sm:w-full"
                                    />
                                )}
                            </FieldBlock>
                        )}
                        {policy === 'CATCH_UP_REDUCED' && (
                            <FieldBlock
                                label={t('wizard.rules.catchUpPercent')}
                                error={errorText(get(errors, 'defaultCatchUpPercent'))}
                            >
                                {(a11y) => (
                                    <MyInput
                                        {...a11y}
                                        inputType="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={100}
                                        input={String(numberInputValue(percentCtl.field.value))}
                                        onChangeFunction={(e) =>
                                            percentCtl.field.onChange(
                                                parseNumberInput(e.target.value)
                                            )
                                        }
                                        className="sm:w-full"
                                    />
                                )}
                            </FieldBlock>
                        )}
                        <FieldBlock
                            label={t('wizard.revealAt')}
                            hint={
                                reveals.length > 1
                                    ? t('wizard.rules.revealVaries')
                                    : t('wizard.rules.revealHint')
                            }
                        >
                            {(a11y) => (
                                <MyInput
                                    {...a11y}
                                    inputType="time"
                                    input={revealValue}
                                    onChangeFunction={(e) => setRevealEverywhere(e.target.value)}
                                    className="sm:w-full"
                                />
                            )}
                        </FieldBlock>
                    </div>
                    <div className="flex flex-wrap items-end gap-3 border-t border-neutral-100 pt-4">
                        <FieldBlock label={t('composer.completionPoints')} className="w-32">
                            {(a11y) => (
                                <MyInput
                                    {...a11y}
                                    inputType="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={MAX_POINTS}
                                    input={String(completion)}
                                    onChangeFunction={(e) =>
                                        setCompletion(
                                            Math.max(
                                                0,
                                                Math.min(MAX_POINTS, Number(e.target.value) || 0)
                                            )
                                        )
                                    }
                                    className="sm:w-full"
                                />
                            )}
                        </FieldBlock>
                        <FieldBlock label={t('wizard.rules.bonus')} className="w-40">
                            {(a11y) => (
                                <MyInput
                                    {...a11y}
                                    inputType="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={MAX_POINTS}
                                    input={String(bonus)}
                                    onChangeFunction={(e) =>
                                        setBonus(
                                            Math.max(
                                                0,
                                                Math.min(MAX_POINTS, Number(e.target.value) || 0)
                                            )
                                        )
                                    }
                                    className="sm:w-full"
                                />
                            )}
                        </FieldBlock>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={applyPoints}
                        >
                            {t('wizard.rules.applyPoints')}
                        </MyButton>
                    </div>
                </div>
            )}
        </section>
    );
}

// ── Day header ───────────────────────────────────────────────────────────────

function DayHeader({
    control,
    dayIndex,
    dayNumber,
    date,
    canRemove,
    onRemove,
}: {
    control: Control<ComposerForm>;
    dayIndex: number;
    dayNumber: number;
    date: string;
    canRemove: boolean;
    onRemove: () => void;
}) {
    const { t, i18n } = useTranslation('engagement');
    const themeCtl = useController({ control, name: `slots.${dayIndex}.title` });
    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <FieldBlock
                className="min-w-0 flex-1"
                label={
                    <>
                        {t('composer.rail.dayN', { n: dayNumber })}
                        {date && (
                            <span className="ms-1 font-regular text-neutral-500">
                                {' · '}
                                {formatDay(date, i18n.language, { weekday: true })}
                            </span>
                        )}
                    </>
                }
                hint={t('composer.schedule.themeHint')}
            >
                {(a11y) => (
                    <MyInput
                        {...a11y}
                        ref={themeCtl.field.ref}
                        inputType="text"
                        dir="auto"
                        inputPlaceholder={t('composer.schedule.themePlaceholder')}
                        input={themeCtl.field.value ?? ''}
                        onChangeFunction={(e) => themeCtl.field.onChange(e.target.value)}
                        onBlur={themeCtl.field.onBlur}
                        className="sm:w-full"
                    />
                )}
            </FieldBlock>
            {canRemove && (
                <MyButton type="button" buttonType="secondary" scale="medium" onClick={onRemove}>
                    <Trash size={16} aria-hidden /> {t('composer.rail.delete')}
                </MyButton>
            )}
        </div>
    );
}

// ── Tasks of one day ─────────────────────────────────────────────────────────

function DayTasks({
    form,
    dayIndex,
    brief,
    grounding,
    openKey,
    onOpenKeyChange,
    activeCardId,
    onActiveCardChange,
    onCreditsSpent,
    canRemoveDay,
    onRemoveDay,
}: {
    form: UseFormReturn<ComposerForm>;
    dayIndex: number;
    brief: AiBriefValues;
    grounding: GroundingText[];
    openKey: string | null;
    onOpenKeyChange: (key: string | null) => void;
    activeCardId: string | null;
    onActiveCardChange: (id: string | null) => void;
    onCreditsSpent: (credits: number) => void;
    canRemoveDay: boolean;
    onRemoveDay: () => void;
}) {
    const { t } = useTranslation('engagement');
    const { control, getValues } = form;
    const arrayName = `slots.${dayIndex}.items` as const;
    const { fields, append, insert, remove, update } = useFieldArray({
        control,
        name: arrayName,
        keyName: 'rhfKey',
    });
    const [removed, setRemoved] = useState<{ item: ItemForm; index: number } | null>(null);
    const [busy, setBusy] = useState<{ key: string; kind: 'regen' | 'pictures' } | null>(null);
    const [taskError, setTaskError] = useState<{ key: string; message: string } | null>(null);
    const types = authorableTypes();

    useEffect(() => {
        if (!removed) return;
        const timer = window.setTimeout(() => setRemoved(null), UNDO_MS);
        return () => window.clearTimeout(timer);
    }, [removed]);

    const addMenu: DropdownItem[] = useMemo(
        () =>
            types.map((type) => {
                const meta = typeMeta(type);
                const Icon = meta.icon;
                return { label: t(meta.labelKey), value: type, icon: <Icon size={16} /> };
            }),
        [types, t]
    );

    function addTask(type: EngagementItemType) {
        const item = newItemForm(type, { isRequired: true });
        append(item);
        onOpenKeyChange(item.key);
    }

    function removeTask(index: number) {
        const snapshot = getValues(`${arrayName}.${index}`);
        remove(index);
        if (snapshot.key === openKey) onOpenKeyChange(null);
        setRemoved({ item: snapshot, index });
    }

    function undoRemove() {
        if (!removed) return;
        insert(Math.min(removed.index, fields.length), removed.item);
        onOpenKeyChange(removed.item.key);
        setRemoved(null);
    }

    async function newVersion(index: number) {
        const item = getValues(`${arrayName}.${index}`);
        const day = getValues(`slots.${dayIndex}`);
        const single = singleItemTypeFor(
            item.itemType,
            item.itemType === 'QUESTION_OF_DAY' ? item.question.format : null
        );
        if (!single || busy) return;
        setBusy({ key: item.key, kind: 'regen' });
        setTaskError(null);
        try {
            const res = await draftAiPlan(
                {
                    topic:
                        [brief.topic.trim(), day.title ? `Day theme: ${day.title}` : '']
                            .filter(Boolean)
                            .join('\n') || undefined,
                    language: brief.language,
                    difficulty: brief.difficulty,
                    start_date: day.startDate,
                    days: 1,
                    per_day_items: 1,
                    start_time: day.startTime,
                    end_time: day.endTime,
                    reveal_time: day.revealTime || undefined,
                    notify_time: day.notifyTime || undefined,
                    completion_points: item.completionPoints ?? 10,
                    correct_points: item.correctPoints ?? 20,
                    mix: mixForSingle(single),
                    grounding_texts: grounding,
                    single_item_type: single,
                    avoid_title: item.title,
                },
                newIdempotencyKey(`engagement-item-${dayIndex}-${index}`)
            );
            const fresh = res.slots[0]?.items?.[0];
            if (!fresh) throw new Error('empty');
            const next = itemToForm(fresh);
            // The teacher's own choices on this task survive a new version.
            next.isRequired = item.isRequired;
            next.completionPoints = item.completionPoints;
            if (next.itemType === item.itemType && next.itemType !== 'FLASHCARDS') {
                next.correctPoints = item.correctPoints;
            }
            // Re-read the index: the list may have changed while the call ran.
            const current = (getValues(arrayName) ?? []).findIndex((it) => it.key === item.key);
            if (current < 0) return;
            update(current, next);
            if (openKey === item.key) onOpenKeyChange(next.key);
            onCreditsSpent(ITEM_CREDITS);
            toast.success(t('wizard.reviewStep.newVersionDone'));
        } catch (e: unknown) {
            const { message, key } = aiErrorMessage(
                e,
                single === 'FLASHCARDS' ? 'wizard.deckDropped' : 'wizard.errors.regenerate'
            );
            setTaskError({
                key: item.key,
                message: message ?? t(key ?? 'wizard.errors.regenerate'),
            });
        } finally {
            setBusy(null);
        }
    }

    async function addPictures(index: number) {
        const item = getValues(`${arrayName}.${index}`);
        if (busy || (item.itemType !== 'READING_HTML' && item.itemType !== 'VISUAL_NOTE')) return;
        const html = item.contentHtml ?? '';
        const wanted = Math.min(countImagePlaceholders(html), 2);
        if (wanted === 0) return;
        setBusy({ key: item.key, kind: 'pictures' });
        setTaskError(null);
        try {
            const res = await illustrateReading(
                item.title,
                html,
                newIdempotencyKey(`engagement-illustrate-${dayIndex}-${index}`),
                wanted
            );
            const current = (getValues(arrayName) ?? []).findIndex((it) => it.key === item.key);
            if (current < 0) return;
            // Edits made to the task while the pictures were drawn are kept.
            const latest = getValues(`${arrayName}.${current}`);
            update(current, {
                ...latest,
                contentHtml: res.content_html,
                itemType: res.images_generated > 0 ? 'VISUAL_NOTE' : latest.itemType,
            } as ItemForm);
            if (res.images_generated > 0) onCreditsSpent(res.images_generated * IMAGE_CREDITS);
        } catch (e: unknown) {
            const { message, key } = aiErrorMessage(e, 'wizard.errors.pictures');
            setTaskError({ key: item.key, message: message ?? t(key ?? 'wizard.errors.pictures') });
        } finally {
            setBusy(null);
        }
    }

    return (
        <section aria-labelledby={`review-tasks-${dayIndex}`} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <h3
                    id={`review-tasks-${dayIndex}`}
                    className="text-subtitle font-semibold text-neutral-900"
                >
                    {t('composer.tasks')}
                    <span className="ms-2 text-body font-regular text-neutral-500">
                        {t('composer.rail.tasks', { count: fields.length })}
                    </span>
                </h3>
                {fields.length > 0 && (
                    <MyDropdown
                        dropdownList={addMenu}
                        onSelect={(value) => addTask(value as EngagementItemType)}
                    >
                        <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-300 px-3 text-body font-semibold text-primary-500 hover:bg-primary-50">
                            <Plus size={16} aria-hidden /> {t('composer.addTask')}
                        </span>
                    </MyDropdown>
                )}
            </div>

            {removed && (
                <div
                    role="status"
                    className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
                >
                    <Trash size={16} className="shrink-0 text-neutral-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-body text-neutral-700">
                        {t('composer.taskList.removed', {
                            title: removed.item.title.trim() || t('preview.untitled'),
                        })}
                    </span>
                    <MyButton type="button" buttonType="text" scale="small" onClick={undoRemove}>
                        <ArrowCounterClockwise size={14} aria-hidden />{' '}
                        {t('composer.taskList.undo')}
                    </MyButton>
                </div>
            )}

            {fields.length === 0 ? (
                <div className="rounded-lg border border-dashed border-neutral-300 p-5">
                    <p className="text-body font-semibold text-neutral-900">
                        {t('wizard.reviewStep.emptyDay')}
                    </p>
                    <p className="mt-0.5 text-caption text-neutral-500">
                        {t('wizard.reviewStep.emptyDayHint')}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <MyDropdown
                            dropdownList={addMenu}
                            onSelect={(value) => addTask(value as EngagementItemType)}
                        >
                            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-500 px-3 text-body font-semibold text-neutral-50 hover:bg-primary-400">
                                <Plus size={16} aria-hidden /> {t('composer.addTask')}
                            </span>
                        </MyDropdown>
                        {canRemoveDay && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                onClick={onRemoveDay}
                            >
                                <Trash size={16} aria-hidden /> {t('composer.rail.delete')}
                            </MyButton>
                        )}
                    </div>
                </div>
            ) : (
                <ol className="flex flex-col gap-2">
                    {fields.map((field, index) => (
                        <li key={field.rhfKey}>
                            <ReviewTaskCard
                                control={control}
                                path={`${arrayName}.${index}`}
                                itemKey={field.key}
                                openKey={openKey}
                                onToggle={(key) => onOpenKeyChange(openKey === key ? null : key)}
                                onActivate={(key) => {
                                    if (openKey !== key) onOpenKeyChange(key);
                                }}
                                activeCardId={activeCardId}
                                onActiveCardChange={onActiveCardChange}
                                onDelete={() => removeTask(index)}
                                onNewVersion={() => void newVersion(index)}
                                onAddPictures={() => void addPictures(index)}
                                onReplaceItem={(item) => update(index, item)}
                                onInsertItemAfter={(item) => {
                                    insert(index + 1, item);
                                    onOpenKeyChange(item.key);
                                }}
                                busy={busy && busy.key === field.key ? busy.kind : null}
                                anyBusy={busy !== null}
                                error={
                                    taskError && taskError.key === field.key
                                        ? taskError.message
                                        : null
                                }
                                packageSessionId={brief.batches[0]?.id ?? null}
                            />
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}

// ── One task ─────────────────────────────────────────────────────────────────

function ReviewTaskCard({
    control,
    path,
    itemKey,
    openKey,
    onToggle,
    onActivate,
    activeCardId,
    onActiveCardChange,
    onDelete,
    onNewVersion,
    onAddPictures,
    onReplaceItem,
    onInsertItemAfter,
    busy,
    anyBusy,
    error,
    packageSessionId,
}: {
    control: Control<ComposerForm>;
    path: `slots.${number}.items.${number}`;
    itemKey: string;
    openKey: string | null;
    onToggle: (key: string) => void;
    onActivate: (key: string) => void;
    activeCardId: string | null;
    onActiveCardChange: (id: string | null) => void;
    onDelete: () => void;
    onNewVersion: () => void;
    onAddPictures: () => void;
    onReplaceItem: (item: ItemForm) => void;
    onInsertItemAfter: (item: ItemForm) => void;
    busy: 'regen' | 'pictures' | null;
    anyBusy: boolean;
    error: string | null;
    packageSessionId: string | null;
}) {
    const { t, i18n } = useTranslation('engagement');
    const uid = useId();
    const item = useWatch({ control, name: path }) as ItemForm | undefined;
    const { errors } = useFormState({ control, name: path });
    const errorCount = countFormErrors(get(errors, path));

    if (!item) return null;
    const key = item.key || itemKey;
    const open = openKey !== null && openKey === key;
    const meta = typeMeta(item.itemType);
    const Icon = meta.icon;
    const canRegenerate =
        singleItemTypeFor(
            item.itemType,
            item.itemType === 'QUESTION_OF_DAY' ? item.question.format : null
        ) !== null;
    const pictureSlots =
        item.itemType === 'READING_HTML' || item.itemType === 'VISUAL_NOTE'
            ? Math.min(countImagePlaceholders(item.contentHtml), 2)
            : 0;

    const isMcq = item.itemType === 'QUESTION_OF_DAY' && item.question.format === 'MCQ';
    const filled = isMcq ? item.question.options.filter((o) => o.text.trim()) : [];
    const correctIndex = isMcq
        ? filled.findIndex((o) => o.id === item.question.correctOptionId)
        : -1;
    const cards = item.itemType === 'FLASHCARDS' ? item.flashcards.cards.length : null;

    const subline = [
        t(meta.labelKey),
        cards != null ? t('wizard.reviewStep.cards', { count: cards }) : '',
        t('composer.taskList.points', { count: points(item) }),
        item.isRequired ? t('composer.required') : '',
    ]
        .filter(Boolean)
        .join(' · ');
    const bodyId = `${uid}-body`;

    return (
        <div
            className={cn(
                'rounded-lg border bg-white transition-colors',
                open
                    ? 'border-primary-300 shadow-sm'
                    : errorCount > 0
                      ? 'border-danger-300'
                      : 'border-neutral-200 hover:border-neutral-300'
            )}
        >
            <div className="flex items-center gap-1 pe-1">
                <button
                    type="button"
                    onClick={() => onToggle(key)}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-s-lg p-2 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                    <span
                        className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-md',
                            meta.accent.soft
                        )}
                    >
                        <Icon size={16} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span
                            className={cn(
                                'block truncate text-body font-semibold',
                                item.title.trim() ? 'text-neutral-900' : 'text-neutral-400'
                            )}
                        >
                            {item.title.trim() || t('preview.untitled')}
                        </span>
                        <span className="block truncate text-caption text-neutral-500">
                            {subline}
                        </span>
                    </span>
                    {errorCount > 0 && (
                        <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-danger-50 px-2 py-0.5 text-caption font-semibold text-danger-600"
                            aria-label={t('composer.rail.problems', { count: errorCount })}
                        >
                            <WarningCircle size={12} aria-hidden />
                            {formatNumber(errorCount, i18n.language)}
                        </span>
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
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    layoutVariant="icon"
                    aria-label={t('wizard.removeTask')}
                    onClick={onDelete}
                    className="text-neutral-600 hover:text-danger-600"
                >
                    <Trash size={18} aria-hidden />
                </MyButton>
            </div>

            {/* The answer key, visible without opening the task. */}
            {isMcq && !open && (
                <div className="mx-3 mb-3 rounded-md border border-success-200 bg-success-50 px-3 py-2">
                    {correctIndex >= 0 ? (
                        <p className="flex items-start gap-1.5 text-caption text-success-700">
                            <CheckCircle
                                size={14}
                                weight="fill"
                                className="mt-0.5 shrink-0"
                                aria-hidden
                            />
                            <span className="min-w-0">
                                <span className="font-semibold">
                                    {t('wizard.reviewStep.answerKey')}
                                </span>{' '}
                                {`${optionLetter(correctIndex)}. ${filled[correctIndex]!.text}`}
                                {item.question.explanation.trim() && (
                                    <span className="mt-0.5 line-clamp-2 block text-neutral-600">
                                        {item.question.explanation}
                                    </span>
                                )}
                            </span>
                        </p>
                    ) : (
                        <p className="flex items-center gap-1.5 text-caption text-danger-600">
                            <WarningCircle size={14} className="shrink-0" aria-hidden />
                            {t('wizard.reviewStep.noAnswerKey')}
                        </p>
                    )}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
                {canRegenerate && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={anyBusy}
                        onClick={onNewVersion}
                    >
                        <ArrowsClockwise size={14} aria-hidden />
                        {busy === 'regen'
                            ? t('wizard.regenerating')
                            : t('wizard.reviewStep.newVersion', { credits: ITEM_CREDITS })}
                    </MyButton>
                )}
                {pictureSlots > 0 && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={anyBusy}
                        onClick={onAddPictures}
                    >
                        <ImageIcon size={14} aria-hidden />
                        {busy === 'pictures'
                            ? t('wizard.generatingPictures')
                            : t('wizard.addPictures', {
                                  count: pictureSlots,
                                  credits: pictureSlots * IMAGE_CREDITS,
                              })}
                    </MyButton>
                )}
                {error && (
                    <p
                        role="alert"
                        className="flex basis-full items-start gap-1.5 text-caption text-danger-600"
                    >
                        <WarningCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
                        {error}
                    </p>
                )}
            </div>

            {open && (
                <div
                    id={bodyId}
                    className="border-t border-neutral-100 p-4"
                    onFocusCapture={() => onActivate(key)}
                >
                    <ItemEditor
                        key={item.itemType}
                        control={control}
                        name={path}
                        onActivate={() => onActivate(key)}
                        activeCardId={activeCardId}
                        onActiveCardChange={onActiveCardChange}
                        onReplaceItem={onReplaceItem}
                        onInsertItemAfter={onInsertItemAfter}
                        packageSessionId={packageSessionId}
                    />
                </div>
            )}
        </div>
    );
}
