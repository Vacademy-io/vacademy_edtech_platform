import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    Controller,
    useFieldArray,
    useForm,
    useWatch,
    type Control,
    type FieldErrors,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowClockwise,
    CalendarPlus,
    CopySimple,
    NotePencil,
    Trash,
    UsersThree,
    Warning,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Form } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getEngagementSettings } from '@/routes/settings/-services/engagement-settings';
import { getEngagementPlan } from '../-services/engagement-service';
import type { EngagementPlanRequest, PlanStatus, ScheduleMode } from '../-types/types';
import { addDays, daysBetween, instituteToday, slotLastDate } from '../-utils/format';
import {
    composerSchema,
    dtoToForm,
    flattenFormErrors,
    newComposerForm,
    newItemForm,
    RELATIVE_DAY_ONE,
    rebaseSlots,
    requestToForm,
    slotToForm,
    type ComposerForm,
    type ItemForm,
    type SlotForm,
} from './forms/composer-schema';
import { BatchPickerDialog, type BatchOption } from './BatchPickerDialog';
import type { PickedSlide } from './CourseSlidePicker';
import { PlanPreview } from './PlanPreview';
import { DayRail, dayHeading, dayRanks, orderDays } from './composer/DayRail';
import { DayScheduleEditor } from './composer/DayScheduleEditor';
import { TaskList, type DayOption } from './composer/TaskList';
import { ComposerFooterActions, ComposerFooterLeft } from './composer/ComposerFooter';
import {
    PublishSummaryDialog,
    buildPublishSummary,
    type PublishSummary,
} from './composer/PublishSummaryDialog';
import {
    ComposerSaveError,
    detachItem,
    planSaveSteps,
    detachSlot,
    isComposerDirty,
    lockedChanges,
    saveErrorText,
    slotSaveOrders,
    slotSnapshot,
    takeBaseline,
    useComposerSave,
    type ComposerBaseline,
    type LockedChange,
} from './composer/use-composer-save';

/**
 * Compose or edit one engagement plan: its details, every day (slot) it runs, and the
 * tasks of each day.
 *
 * A thin shell over the composer parts: it owns the react-hook-form instance (zod
 * `composerSchema`, every day and task at once), loads a saved plan, and runs the
 * save. Days are listed in `DayRail`; the selected day is edited by
 * `DayScheduleEditor` + `TaskList`; the right column is "What learners see".
 *
 * Times are institute-local wall clock; the plan snapshots its timezone at creation.
 */

export interface PlanComposerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => void;
    defaultPackageSessionId?: string;
    /** Present = edit an existing plan instead of creating one. */
    planId?: string | null;
    /**
     * Open with one course-content task already filled in — used by "Assign as task"
     * on a slide, so the teacher only has to choose batches and a window.
     */
    presetSlide?: PickedSlide | null;
    /**
     * An unsaved plan to open (the AI planner's "Edit in full editor"). Create mode
     * only; every day and task of the draft is loaded.
     */
    draft?: EngagementPlanRequest | null;
}

const STATUS_CHIP: Record<PlanStatus, StatusType> = {
    DRAFT: 'INFO',
    PUBLISHED: 'SUCCESS',
    ARCHIVED: 'WARNING',
    DELETED: 'DANGER',
};

/** "Course · Session · Level" (or the batch's own name) from the institute store. */
function storeBatchLabel(packageSessionId: string): string | null {
    const batch = useInstituteDetailsStore
        .getState()
        .getDetailsFromPackageSessionId({ packageSessionId });
    if (!batch) return null;
    if (batch.name) return batch.name;
    const parts = [
        batch.package_dto?.package_name,
        batch.session?.session_name,
        batch.level?.level_name,
    ].filter((part): part is string => Boolean(part) && part?.toUpperCase() !== 'DEFAULT');
    return parts.join(' · ') || null;
}

function storeCourseId(packageSessionId: string | undefined): string | undefined {
    if (!packageSessionId) return undefined;
    return (
        useInstituteDetailsStore.getState().getDetailsFromPackageSessionId({ packageSessionId })
            ?.package_dto?.id ?? undefined
    );
}

function presetTask(slide: PickedSlide): ItemForm {
    const base = newItemForm('COURSE_SLIDE', { title: slide.slideTitle, isRequired: true });
    return {
        ...base,
        itemType: 'COURSE_SLIDE',
        slideId: slide.slideId,
        slide: { ...slide } as Record<string, unknown>,
    } as ItemForm;
}

const PLAN_FIELD_ORDER = ['title', 'packageSessionIds', 'description'];

/**
 * Errors in the order the teacher sees them, so "Go to first" lands on the topmost one:
 * the plan's own fields, then each day in date order (its schedule, then its tasks),
 * then the plan-wide late policy.
 */
function sortErrorsByScreenOrder<T extends { path: string }>(errors: T[], slots: SlotForm[]): T[] {
    const ranks = dayRanks(slots);
    const rank = (path: string): number[] => {
        const field = PLAN_FIELD_ORDER.indexOf(path.split('.')[0] ?? '');
        if (field >= 0) return [0, field, 0, 0];
        const match = /^slots\.(\d+)(?:\.items\.(\d+))?/.exec(path);
        if (match) {
            const day = ranks.get(Number(match[1])) ?? Number(match[1]) + 1;
            return [1, day, match[2] == null ? 0 : 1, match[2] == null ? 0 : Number(match[2])];
        }
        return [2, 0, 0, 0];
    };
    return errors
        .map((error, index) => ({ error, index, key: rank(error.path) }))
        .sort((a, b) => {
            for (let i = 0; i < a.key.length; i++) {
                const diff = a.key[i]! - b.key[i]!;
                if (diff !== 0) return diff;
            }
            return a.index - b.index;
        })
        .map(({ error }) => error);
}

/** The last day any slot runs on. */
function planLastDate(slots: SlotForm[]): string | null {
    let last: string | null = null;
    for (const slot of slots) {
        if (!slot.startDate) continue;
        const end = slotLastDate(slot);
        if (!last || end > last) last = end;
    }
    return last;
}

export function PlanComposerDialog({
    open,
    onOpenChange,
    onCreated,
    defaultPackageSessionId,
    planId,
    presetSlide,
    draft,
}: PlanComposerDialogProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const navigate = useNavigate();
    const isEdit = Boolean(planId);

    const form = useForm<ComposerForm>({
        resolver: zodResolver(composerSchema, undefined, { raw: true }),
        defaultValues: newComposerForm(),
        mode: 'onSubmit',
        reValidateMode: 'onChange',
        shouldFocusError: false,
    });
    const { control, getValues, setValue, setFocus, handleSubmit, reset } = form;
    const slotsArray = useFieldArray({ control, name: 'slots', keyName: 'rhfKey' });
    const status = useWatch({ control, name: 'status' });
    const batchIds = useWatch({ control, name: 'packageSessionIds' });
    const relative = useWatch({ control, name: 'scheduleMode' }) === 'RELATIVE';

    // ── Open / reset sequencing ────────────────────────────────────────────
    // Every open starts clean: a new plan gets defaults, an edit loads the plan fresh.
    const [openSeq, setOpenSeq] = useState(0);
    const [wasOpen, setWasOpen] = useState(false);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setOpenSeq((n) => n + 1);
    }
    const [readySeq, setReadySeq] = useState(0);
    const ready = open && openSeq > 0 && readySeq === openSeq;
    const baselineRef = useRef<ComposerBaseline | null>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    /** Whether the last submit was a Publish (whole plan must be valid). */
    const publishIntent = useRef(false);

    const [selectedDay, setSelectedDay] = useState(0);
    const [openKey, setOpenKey] = useState<string | null>(null);
    const [activeCardId, setActiveCardId] = useState<string | null>(null);
    const [batchLabels, setBatchLabels] = useState<Record<string, string>>({});
    const [batchPickerOpen, setBatchPickerOpen] = useState(false);
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const [deleteDayIndex, setDeleteDayIndex] = useState<number | null>(null);
    const [publishSummary, setPublishSummary] = useState<PublishSummary | null>(null);
    const [lockedPrompt, setLockedPrompt] = useState<{
        changes: LockedChange[];
        publish: boolean;
    } | null>(null);
    const [serverError, setServerError] = useState<string | null>(null);
    const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
    /** Bumped when whole days are replaced in place, so their editors remount. */
    const [formEpoch, setFormEpoch] = useState(0);
    const { saving, save } = useComposerSave();
    const today = useMemo(() => instituteToday(), [openSeq]); // eslint-disable-line react-hooks/exhaustive-deps

    const editQuery = useQuery({
        queryKey: ['engagement-plan-edit', planId, openSeq],
        queryFn: () => getEngagementPlan(planId!),
        enabled: open && Boolean(planId),
        gcTime: 0,
        staleTime: Infinity,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
    const settingsQuery = useQuery({
        queryKey: ['engagement-settings'],
        queryFn: getEngagementSettings,
        enabled: open,
        staleTime: 5 * 60_000,
        retry: 1,
    });
    const dailyItemCap = settingsQuery.data?.settings.dailyItemCap ?? null;
    const plan = editQuery.data;

    function fill(values: ComposerForm, labels: Record<string, string>) {
        reset(values);
        baselineRef.current = takeBaseline(values);
        setBatchLabels(labels);
        setSelectedDay(0);
        setOpenKey(values.slots[0]?.items[0]?.key ?? null);
        setActiveCardId(null);
        setServerError(null);
        setMobileTab('edit');
        setPublishSummary(null);
        setLockedPrompt(null);
        setDeleteDayIndex(null);
        setConfirmDiscard(false);
        setReadySeq(openSeq);
    }

    function labelsFor(ids: string[]): Record<string, string> {
        const out: Record<string, string> = {};
        for (const id of ids) {
            const label =
                id === defaultPackageSessionId
                    ? storeBatchLabel(id) ?? t('composer.thisBatch')
                    : storeBatchLabel(id);
            if (label) out[id] = label;
        }
        return out;
    }

    /** The batch a new plan starts on: the caller's, else the preset slide's. */
    function seedBatchId(): string | null {
        if (defaultPackageSessionId) return defaultPackageSessionId;
        if (!presetSlide?.courseId || !presetSlide.sessionId || !presetSlide.levelId) return null;
        return useInstituteDetailsStore.getState().getPackageSessionId({
            courseId: presetSlide.courseId,
            sessionId: presetSlide.sessionId,
            levelId: presetSlide.levelId,
        });
    }

    // Create: defaults (or the AI draft) on every open.
    useEffect(() => {
        if (!open || isEdit || openSeq === 0 || readySeq === openSeq) return;
        let values: ComposerForm;
        if (draft) {
            values = requestToForm(draft);
            values.status = 'DRAFT';
            if (values.slots.length === 0) values.slots = newComposerForm().slots;
        } else {
            const seeded = seedBatchId();
            values = newComposerForm({
                packageSessionIds: seeded ? [seeded] : [],
                startDate: instituteToday(),
                items: presetSlide ? [presetTask(presetSlide)] : undefined,
            });
            if (presetSlide) values.title = presetSlide.slideTitle;
        }
        fill(values, labelsFor(values.packageSessionIds));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, isEdit, openSeq, readySeq]);

    // Edit: fill once the plan has loaded for this open.
    useEffect(() => {
        if (!open || !isEdit || !plan || readySeq === openSeq) return;
        const values = dtoToForm(plan);
        const label =
            plan.packageSessionLabel ||
            storeBatchLabel(plan.packageSessionId) ||
            t('composer.thisBatch');
        fill(values, { [plan.packageSessionId]: label });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, isEdit, plan, openSeq, readySeq]);

    // Keep the selected day in range after deletes.
    const dayCount = slotsArray.fields.length;
    const dayIndex = Math.min(selectedDay, Math.max(0, dayCount - 1));
    const selectedField = slotsArray.fields[dayIndex];

    // ── Close guard ────────────────────────────────────────────────────────
    function requestClose() {
        if (saving) return;
        if (ready && isComposerDirty(getValues(), baselineRef.current)) {
            setConfirmDiscard(true);
            return;
        }
        onOpenChange(false);
    }

    // ── Errors ─────────────────────────────────────────────────────────────
    /** The dialog's scrolling body (the nearest ancestor that scrolls vertically). */
    function bodyScroller(): HTMLElement | null {
        for (let el = bodyRef.current?.parentElement; el; el = el.parentElement) {
            const { overflowY } = window.getComputedStyle(el);
            if (overflowY === 'auto' || overflowY === 'scroll') return el;
        }
        return null;
    }

    /**
     * Focusing a field scrolls every ancestor that can scroll, including the dialog box
     * itself (overflow hidden, but still programmatically scrollable). Put the box back so
     * the header, X and footer never slide away.
     */
    function pinDialogFrame(scroller: HTMLElement | null) {
        for (let el = scroller?.parentElement; el; el = el.parentElement) {
            if (el.scrollTop) el.scrollTop = 0;
            if (el.scrollLeft) el.scrollLeft = 0;
            if (el.getAttribute('role') === 'dialog') break;
        }
    }

    function scrollToPath(path: string) {
        const root = bodyRef.current;
        if (!root) return;
        const scroller = bodyScroller();
        pinDialogFrame(scroller);
        const segments = path.split('.');
        for (let n = segments.length; n > 0; n--) {
            const candidate = segments.slice(0, n).join('.');
            const node = root.querySelector(`[data-composer-path="${CSS.escape(candidate)}"]`);
            if (!node) continue;
            // A field with no registered ref (the batch picker, a weekday group) still
            // gets keyboard focus: its first control.
            if (!node.contains(document.activeElement)) {
                node
                    .querySelector<HTMLElement>(
                        'input, textarea, button, [contenteditable="true"], [tabindex="0"]'
                    )
                    ?.focus({ preventScroll: true });
            }
            if (!scroller) {
                node.scrollIntoView({ block: 'center', behavior: 'smooth' });
                return;
            }
            // Centre the field in the body's own scroll area only.
            const box = node.getBoundingClientRect();
            const view = scroller.getBoundingClientRect();
            const offset = box.top - view.top - Math.max(0, (view.height - box.height) / 2);
            scroller.scrollBy({ top: offset, behavior: 'smooth' });
            return;
        }
    }

    function goToFirstError(path?: string) {
        const first = path
            ? { path }
            : blockingErrors(form.formState.errors, publishIntent.current)[0];
        if (!first) return;
        const match = /^slots\.(\d+)(?:\.items\.(\d+))?/.exec(first.path);
        if (match) {
            const day = Number(match[1]);
            setSelectedDay(day);
            if (match[2] != null) {
                const key = getValues(`slots.${day}.items.${Number(match[2])}.key`);
                if (key) setOpenKey(key);
            }
        }
        setMobileTab('edit');
        // Two frames: one to render the day and open the task, one to lay it out.
        window.requestAnimationFrame(() =>
            window.requestAnimationFrame(() => {
                try {
                    setFocus(first.path as Parameters<typeof setFocus>[0]);
                } catch {
                    // Not every error sits on a focusable field (a day with no tasks).
                }
                scrollToPath(first.path);
            })
        );
    }

    // ── Save ───────────────────────────────────────────────────────────────
    async function runSave(publish: boolean) {
        setServerError(null);
        const values = getValues();
        const toSave: ComposerForm = publish ? { ...values, status: 'PUBLISHED' } : values;
        try {
            const result = await save({ planId, form: toSave, baseline: baselineRef.current });
            if (result.kind === 'created') {
                const firstBatch = toSave.packageSessionIds[0];
                toast.success(
                    publish
                        ? t('composer.toast.published')
                        : t('composer.created', { count: result.plans.length }),
                    presetSlide && firstBatch
                        ? {
                              action: {
                                  label: t('composer.viewPlan'),
                                  onClick: () =>
                                      void navigate({
                                          to: '/engagement',
                                          search: { packageSessionId: firstBatch },
                                      }),
                              },
                          }
                        : undefined
                );
            } else {
                toast.success(
                    publish
                        ? t('composer.toast.published')
                        : result.changed
                          ? t('composer.saved')
                          : t('composer.toast.noChanges')
                );
            }
            setPublishSummary(null);
            onCreated();
            onOpenChange(false);
        } catch (error) {
            if (error instanceof ComposerSaveError) {
                // Fold what did save back in, so a retry never repeats it.
                const baseline = baselineRef.current;
                for (const id of error.progress.deletedSlotIds) {
                    if (baseline) delete baseline.slots[id];
                }
                for (const saved of error.progress.savedSlots) {
                    const fresh = slotToForm(saved.dto);
                    setValue(`slots.${saved.index}`, fresh, { shouldDirty: true });
                    if (baseline) {
                        const order = slotSaveOrders(getValues('slots'))[saved.index] ?? 0;
                        baseline.slots[saved.dto.id] = slotSnapshot(
                            fresh,
                            order,
                            getValues('scheduleMode')
                        );
                    }
                }
                if (error.failedDayIndex != null) setSelectedDay(error.failedDayIndex);
                if (error.progress.savedSlots.length > 0) setFormEpoch((n) => n + 1);
            }
            const message = saveErrorText(error, t);
            setServerError(message);
            setPublishSummary(null);
            toast.error(message);
        }
    }

    function proceed(publish: boolean) {
        if (!publish) {
            void runSave(false);
            return;
        }
        const values = getValues();
        const labels = (isEdit ? [values.packageSessionId ?? ''] : values.packageSessionIds)
            .filter(Boolean)
            .map((id) => batchLabels[id] ?? storeBatchLabel(id) ?? t('composer.thisBatch'));
        setPublishSummary(
            buildPublishSummary(values, {
                batchLabels: labels,
                learnerCount: plan?.learnerCount ?? null,
                today,
                dailyItemCap,
            })
        );
    }

    function afterValid(publish: boolean) {
        const locked = lockedChanges(getValues());
        if (locked.length > 0) {
            setLockedPrompt({ changes: locked, publish });
            return;
        }
        proceed(publish);
    }

    /**
     * Errors that stop this save. Saving an edit sends only the days that changed, so a
     * problem in a day it doesn't send (say, an old AI game with no top score on day 3)
     * doesn't block renaming day 2; it stays flagged on its day. Publishing, and every
     * new plan, needs the whole plan valid.
     */
    function blockingErrors(errors: FieldErrors<ComposerForm>, publish: boolean) {
        const all = sortErrorsByScreenOrder(flattenFormErrors(errors), getValues('slots'));
        if (publish || !isEdit || !baselineRef.current) return all;
        const sent = new Set(
            planSaveSteps(getValues(), baselineRef.current).upsertSlots.map((step) => step.index)
        );
        return all.filter((error) => {
            const match = /^slots\.(\d+)\./.exec(error.path);
            return !match || sent.has(Number(match[1]));
        });
    }

    function submit(publish: boolean) {
        publishIntent.current = publish;
        setServerError(null);
        void handleSubmit(
            () => afterValid(publish),
            (errors) => {
                const blocking = blockingErrors(errors, publish);
                if (blocking.length === 0) {
                    afterValid(publish);
                    return;
                }
                goToFirstError(blocking[0]!.path);
            }
        )();
    }

    function saveLockedAsNew() {
        if (!lockedPrompt) return;
        for (const change of lockedPrompt.changes) {
            const path = `slots.${change.dayIndex}.items.${change.itemIndex}` as const;
            const copy = detachItem(getValues(path));
            setValue(path, copy, { shouldDirty: true });
            if (openKey === change.key) setOpenKey(copy.key);
        }
        const publish = lockedPrompt.publish;
        setLockedPrompt(null);
        setFormEpoch((n) => n + 1);
        proceed(publish);
    }

    // ── Days ───────────────────────────────────────────────────────────────
    /**
     * Switch a new plan between calendar dates and "days after joining". The days keep
     * their spacing: the first becomes Day 1, or today when going back to dates.
     */
    function changeScheduleMode(mode: ScheduleMode) {
        if (isEdit || getValues('scheduleMode') === mode) return;
        const rebased = rebaseSlots(
            getValues('slots'),
            mode === 'RELATIVE' ? RELATIVE_DAY_ONE : instituteToday()
        );
        const options = { shouldDirty: true, shouldValidate: form.formState.isSubmitted };
        rebased.forEach((slot, index) => {
            setValue(`slots.${index}.startDate`, slot.startDate, options);
            setValue(`slots.${index}.endDate`, slot.endDate, options);
            setValue(`slots.${index}.dowMask`, slot.dowMask, options);
        });
        setValue('scheduleMode', mode, options);
    }

    function addDay() {
        const slots = getValues('slots');
        const source = slots[dayIndex];
        const last = planLastDate(slots);
        const startDate = last
            ? addDays(last, 1)
            : getValues('scheduleMode') === 'RELATIVE'
              ? RELATIVE_DAY_ONE
              : instituteToday();
        const fresh: SlotForm = {
            ...newComposerForm().slots[0]!,
            startDate,
            startTime: source?.startTime ?? '06:00',
            endTime: source?.endTime ?? '20:00',
            revealTime: source?.revealTime ?? '',
            notifyTime: source?.notifyTime ?? '',
            items: [],
        };
        slotsArray.append(fresh);
        setSelectedDay(slots.length);
        setOpenKey(null);
    }

    function duplicateDay(index: number) {
        const slots = getValues('slots');
        const source = slots[index];
        if (!source) return;
        const last = planLastDate(slots);
        const startDate = last ? addDays(last, 1) : source.startDate;
        const span = source.endDate
            ? Math.max(0, daysBetween(source.startDate, source.endDate))
            : 0;
        const copy = detachSlot(source, {
            startDate,
            endDate: source.endDate ? addDays(startDate, span) : '',
        });
        slotsArray.append(copy);
        setSelectedDay(slots.length);
        setOpenKey(copy.items[0]?.key ?? null);
        toast.success(t('composer.toast.dayDuplicated'));
    }

    function confirmDeleteDay() {
        const index = deleteDayIndex;
        setDeleteDayIndex(null);
        if (index == null || dayCount <= 1) return;
        slotsArray.remove(index);
        setOpenKey(null);
        setSelectedDay((current) =>
            current > index ? current - 1 : Math.min(current, dayCount - 2)
        );
    }

    /**
     * Move a day from one place in the date order to another. A day's place IS its
     * date (the server lists days by date), so the days keep their places' schedules
     * (dates and weekdays) and the content moves: the moved day takes the dates of the
     * place it lands on, and the days in between shift along by one place.
     */
    function moveDay(fromPosition: number, toPosition: number) {
        const slots = getValues('slots');
        if (toPosition < 0 || toPosition >= slots.length || fromPosition === toPosition) return;
        const order = orderDays(slots);
        const schedules = order.map((index) => ({
            startDate: slots[index]!.startDate,
            endDate: slots[index]!.endDate,
            dowMask: slots[index]!.dowMask,
        }));
        const next = [...order];
        const [moved] = next.splice(fromPosition, 1);
        next.splice(toPosition, 0, moved!);
        next.forEach((formIndex, position) => {
            const target = schedules[position]!;
            const current = slots[formIndex]!;
            const options = { shouldDirty: true, shouldValidate: form.formState.isSubmitted };
            if (current.startDate !== target.startDate) {
                setValue(`slots.${formIndex}.startDate`, target.startDate, options);
            }
            if (current.endDate !== target.endDate) {
                setValue(`slots.${formIndex}.endDate`, target.endDate, options);
            }
            if (current.dowMask !== target.dowMask) {
                setValue(`slots.${formIndex}.dowMask`, target.dowMask, options);
            }
        });
    }

    function moveTaskToDay(item: ItemForm, target: number) {
        const items = getValues(`slots.${target}.items`) ?? [];
        setValue(`slots.${target}.items`, [...items, item], { shouldDirty: true });
    }

    // Only the days' dates and start times are watched here (for "Day 2 · Thu, 25 Sep"
    // labels and the date order), so typing in a task never re-renders the shell.
    const scheduleNames = slotsArray.fields.flatMap(
        (_, index) => [`slots.${index}.startDate`, `slots.${index}.startTime`] as const
    );
    const scheduleValues = useWatch({ control, name: scheduleNames }) as (string | undefined)[];
    const scheduleSlots = slotsArray.fields.map((_, index) => ({
        startDate: scheduleValues[index * 2] ?? '',
        startTime: scheduleValues[index * 2 + 1] ?? '',
    }));
    const ranks = dayRanks(scheduleSlots);
    function dayLabel(index: number): string {
        const slot = getValues(`slots.${index}`);
        const when = slot ? dayHeading(slot, lang, relative ? t : null).label : '';
        // A join-based day's heading is already "Day N"; don't prefix a second number.
        if (relative && when) return when;
        const label = t('composer.rail.dayN', { n: ranks.get(index) ?? index + 1 });
        return when ? `${label} · ${when}` : label;
    }
    const dayOptions: DayOption[] = ready
        ? orderDays(scheduleSlots).map((index) => ({ index, label: dayLabel(index) }))
        : [];
    const deleteTarget = deleteDayIndex != null ? getValues(`slots.${deleteDayIndex}`) : undefined;
    const deleteAnswered = (deleteTarget?.items ?? []).reduce(
        (sum, item) => sum + (item.id ? item.completedCount ?? 0 : 0),
        0
    );

    const courseFilter = presetSlide?.courseId ?? storeCourseId(defaultPackageSessionId);
    const selectedBatches: BatchOption[] = (batchIds ?? []).map((id) => ({
        id,
        label: batchLabels[id] ?? storeBatchLabel(id) ?? id,
    }));

    const heading = isEdit ? t('composer.titleEdit') : t('composer.titleNew');
    const footerHint =
        status === 'DRAFT' ? t('composer.footer.hintDraft') : t('composer.footer.hintLive');

    return (
        <>
            <MyDialog
                heading={heading}
                open={open}
                onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}
                dialogWidth="max-w-7xl"
                className="h-dialog-tall"
                headerActions={
                    ready && status ? (
                        <StatusChip
                            text={t(`composer.statusChip.${status}`)}
                            textSize="text-caption"
                            status={STATUS_CHIP[status]}
                            showIcon={false}
                        />
                    ) : undefined
                }
                footerLeft={
                    <ComposerFooterLeft
                        control={control}
                        serverError={serverError}
                        onGoToFirstError={() => goToFirstError()}
                        hint={ready ? footerHint : null}
                    />
                }
                footer={
                    <ComposerFooterActions
                        status={status ?? 'DRAFT'}
                        ready={ready}
                        saving={saving}
                        isEdit={isEdit}
                        onCancel={requestClose}
                        onSave={() => submit(false)}
                        onPublish={() => submit(true)}
                    />
                }
            >
                {/* `relative` keeps absolutely positioned descendants (sr-only labels, dnd-kit
                    live regions) inside the scroll area. Without it they are placed against
                    the fixed dialog box, give it scrollable overflow, and scrolling a field
                    into view slides the whole dialog — header, X and footer — out of place. */}
                <div ref={bodyRef} className="relative">
                    {isEdit && editQuery.isError && (
                        <Alert className="border-danger-200 bg-danger-50 text-danger-700">
                            <div className="flex flex-wrap items-center gap-3">
                                <WarningCircle size={18} className="shrink-0" aria-hidden />
                                <AlertDescription className="min-w-0 flex-1">
                                    {t('composer.loadError')}
                                </AlertDescription>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => void editQuery.refetch()}
                                >
                                    <ArrowClockwise size={14} aria-hidden /> {t('common.retry')}
                                </MyButton>
                            </div>
                        </Alert>
                    )}

                    {!ready && !(isEdit && editQuery.isError) && <ComposerSkeleton />}

                    {ready && !selectedField && (
                        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center">
                            <p className="text-subtitle font-semibold text-neutral-900">
                                {t('composer.noDays.title')}
                            </p>
                            <p className="mt-1 text-body text-neutral-500">
                                {t('composer.noDays.hint')}
                            </p>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                className="mt-4"
                                onClick={addDay}
                            >
                                <CalendarPlus size={16} aria-hidden /> {t('composer.rail.add')}
                            </MyButton>
                        </div>
                    )}

                    {ready && selectedField && (
                        <Form {...form}>
                            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                                <aside className="lg:sticky lg:top-0 lg:w-60 lg:shrink-0">
                                    <DayRail
                                        control={control}
                                        days={slotsArray.fields}
                                        selectedIndex={dayIndex}
                                        onSelect={(index) => {
                                            setSelectedDay(index);
                                            setOpenKey(null);
                                            setActiveCardId(null);
                                        }}
                                        onAdd={addDay}
                                        onDuplicate={duplicateDay}
                                        onDelete={(index) => setDeleteDayIndex(index)}
                                        onMove={moveDay}
                                    />
                                </aside>

                                <div className="min-w-0 flex-1 space-y-5">
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
                                        <PlanDetails
                                            control={control}
                                            isEdit={isEdit}
                                            batches={selectedBatches}
                                            onPickBatches={() => setBatchPickerOpen(true)}
                                            courseFilter={courseFilter}
                                            onScheduleModeChange={changeScheduleMode}
                                        />

                                        <DayHeader
                                            control={control}
                                            index={dayIndex}
                                            rank={ranks.get(dayIndex) ?? dayIndex + 1}
                                            count={dayCount}
                                            onDuplicate={() => duplicateDay(dayIndex)}
                                            onDelete={() => setDeleteDayIndex(dayIndex)}
                                        />

                                        <DayScheduleEditor
                                            key={`schedule-${selectedField.rhfKey}-${formEpoch}`}
                                            control={control}
                                            setValue={setValue}
                                            dayIndex={dayIndex}
                                            dailyItemCap={dailyItemCap}
                                            timezone={plan?.timezone}
                                            today={today}
                                        />

                                        <TaskList
                                            key={`tasks-${selectedField.rhfKey}-${formEpoch}`}
                                            control={control}
                                            getValues={getValues}
                                            setFocus={setFocus}
                                            dayIndex={dayIndex}
                                            days={dayOptions}
                                            openKey={openKey}
                                            onOpenKeyChange={(key) => {
                                                setOpenKey(key);
                                                setActiveCardId(null);
                                            }}
                                            activeCardId={activeCardId}
                                            onActiveCardChange={setActiveCardId}
                                            onMoveToDay={moveTaskToDay}
                                            packageSessionId={
                                                isEdit ? plan?.packageSessionId : batchIds?.[0]
                                            }
                                        />
                                    </div>

                                    <div
                                        className={cn(
                                            mobileTab === 'edit' && 'hidden',
                                            'xl:hidden'
                                        )}
                                    >
                                        <PreviewPane
                                            control={control}
                                            dayIndex={dayIndex}
                                            activeKey={openKey}
                                            onSelect={(key) => {
                                                setOpenKey(key);
                                                setMobileTab('edit');
                                            }}
                                            activeCardId={activeCardId}
                                        />
                                    </div>
                                </div>

                                <aside className="hidden xl:sticky xl:top-0 xl:block xl:w-80 xl:shrink-0">
                                    <PreviewPane
                                        control={control}
                                        dayIndex={dayIndex}
                                        activeKey={openKey}
                                        onSelect={(key) => setOpenKey(key)}
                                        activeCardId={activeCardId}
                                    />
                                </aside>
                            </div>
                        </Form>
                    )}
                </div>
            </MyDialog>

            {!isEdit && (
                <BatchPickerDialog
                    open={batchPickerOpen}
                    onOpenChange={setBatchPickerOpen}
                    selected={selectedBatches}
                    courseId={courseFilter}
                    onConfirm={(next) => {
                        setBatchLabels((current) => ({
                            ...current,
                            ...Object.fromEntries(next.map((batch) => [batch.id, batch.label])),
                        }));
                        setValue(
                            'packageSessionIds',
                            next.map((batch) => batch.id),
                            { shouldDirty: true, shouldValidate: form.formState.isSubmitted }
                        );
                    }}
                />
            )}

            <PublishSummaryDialog
                open={publishSummary !== null}
                onOpenChange={(next) => {
                    if (!next && !saving) setPublishSummary(null);
                }}
                summary={publishSummary}
                onConfirm={() => runSave(true)}
            />

            <AlertDialog
                open={lockedPrompt !== null}
                onOpenChange={(next) => {
                    if (!next) setLockedPrompt(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-start">
                            {t('composer.locked.title', {
                                count: lockedPrompt?.changes.length ?? 0,
                            })}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-start">
                            {t('composer.locked.description')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <ul className="space-y-1 text-body text-neutral-700">
                        {lockedPrompt?.changes.map((change) => (
                            <li key={change.key} className="flex items-center gap-2">
                                <NotePencil size={14} className="shrink-0 text-neutral-500" />
                                <span className="min-w-0 truncate">
                                    {change.title || t('preview.untitled')}
                                </span>
                                <span className="shrink-0 text-caption text-neutral-500">
                                    {t('composer.taskList.answered', { count: change.answered })}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('composer.discard.keep')}</AlertDialogCancel>
                        <AlertDialogAction onClick={saveLockedAsNew}>
                            {t('composer.locked.confirm', {
                                count: lockedPrompt?.changes.length ?? 0,
                            })}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={deleteDayIndex !== null}
                onOpenChange={(next) => {
                    if (!next) setDeleteDayIndex(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-start">
                            {t('composer.deleteDay.title', {
                                day: deleteDayIndex != null ? dayLabel(deleteDayIndex) : '',
                            })}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-start">
                            {t('composer.deleteDay.description', {
                                count: deleteTarget?.items?.length ?? 0,
                            })}
                            {deleteAnswered > 0 &&
                                ` ${t('composer.deleteDay.answered', { count: deleteAnswered })}`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('composer.discard.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 hover:bg-danger-500"
                            onClick={confirmDeleteDay}
                        >
                            {t('composer.deleteDay.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-start">
                            {t('composer.discard.title')}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-start">
                            {t('composer.discard.description')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('composer.discard.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 hover:bg-danger-500"
                            onClick={() => {
                                setConfirmDiscard(false);
                                onOpenChange(false);
                            }}
                        >
                            {t('composer.discard.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

// ── Parts ────────────────────────────────────────────────────────────────────

function ComposerSkeleton() {
    return (
        <div className="flex flex-col gap-6 lg:flex-row" aria-busy="true">
            <div className="space-y-2 lg:w-60">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
            </div>
            <div className="flex-1 space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
            </div>
            <div className="hidden space-y-3 xl:block xl:w-80">
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-24 w-full" />
            </div>
        </div>
    );
}

/** Title, batch and description: the plan's own fields. */
function PlanDetails({
    control,
    isEdit,
    batches,
    onPickBatches,
    courseFilter,
    onScheduleModeChange,
}: {
    control: Control<ComposerForm>;
    isEdit: boolean;
    batches: BatchOption[];
    onPickBatches: () => void;
    courseFilter?: string;
    onScheduleModeChange: (mode: ScheduleMode) => void;
}) {
    const { t } = useTranslation('engagement');
    const [showDescription, setShowDescription] = useState(false);
    const description = useWatch({ control, name: 'description' });
    const slots = useWatch({ control, name: 'slots' });
    const descriptionOpen = showDescription || Boolean(description?.trim());

    // Course-content tasks only open for learners of that course.
    const slideCourses = new Set(
        (slots ?? []).flatMap((slot) =>
            (slot?.items ?? []).flatMap((item) => {
                if (item.itemType !== 'COURSE_SLIDE') return [];
                const courseId = (item.slide as { courseId?: unknown } | null | undefined)
                    ?.courseId;
                return typeof courseId === 'string' && courseId ? [courseId] : [];
            })
        )
    );
    if (slideCourses.size === 0 && courseFilter && hasCourseSlide(slots)) {
        slideCourses.add(courseFilter);
    }
    const foreignBatches =
        slideCourses.size === 0
            ? 0
            : batches.filter((batch) => {
                  const courseId = storeCourseId(batch.id);
                  return Boolean(courseId) && !slideCourses.has(courseId!);
              }).length;

    const batchText =
        batches.length === 0
            ? t('composer.selectBatches')
            : batches.length === 1
              ? batches[0]!.label
              : t('composer.batchesSelected', { count: batches.length });

    return (
        <section className="min-w-0 space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Controller
                    control={control}
                    name="title"
                    render={({ field, fieldState }) => (
                        <div className="min-w-0" data-composer-path="title">
                            <MyInput
                                label={t('composer.title')}
                                aria-label={t('composer.title')}
                                required
                                input={field.value}
                                onChangeFunction={(e) => field.onChange(e.target.value)}
                                onBlur={field.onBlur}
                                ref={field.ref}
                                inputPlaceholder={t('composer.titlePlaceholder')}
                                error={
                                    fieldState.error?.message
                                        ? t(fieldState.error.message)
                                        : undefined
                                }
                                className="sm:w-full"
                            />
                        </div>
                    )}
                />
                <Controller
                    control={control}
                    name="packageSessionIds"
                    render={({ fieldState }) => (
                        <div className="min-w-0 space-y-1" data-composer-path="packageSessionIds">
                            <p className="text-subtitle font-regular text-neutral-900">
                                {isEdit ? t('composer.details.batch') : t('composer.batches')}
                            </p>
                            {isEdit ? (
                                <p className="flex h-9 items-center gap-2 truncate rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-body text-neutral-700">
                                    <UsersThree size={16} className="shrink-0" aria-hidden />
                                    <span className="truncate">{batchText}</span>
                                </p>
                            ) : (
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    className={cn(
                                        'w-full justify-start font-regular',
                                        fieldState.error && 'border-danger-600'
                                    )}
                                    onClick={onPickBatches}
                                >
                                    <UsersThree size={16} aria-hidden />
                                    <span className="truncate">{batchText}</span>
                                </MyButton>
                            )}
                            {fieldState.error?.message ? (
                                <p className="text-caption text-danger-600">
                                    {t(fieldState.error.message)}
                                </p>
                            ) : (
                                <p className="text-caption text-neutral-500">
                                    {isEdit
                                        ? t('composer.editOneBatch')
                                        : batches.length > 1
                                          ? t('composer.onePerBatch')
                                          : ''}
                                </p>
                            )}
                        </div>
                    )}
                />
            </div>

            <ScheduleModeField control={control} isEdit={isEdit} onChange={onScheduleModeChange} />

            {foreignBatches > 0 && (
                <p className="flex items-start gap-2 rounded-md bg-warning-50 px-3 py-2 text-caption text-warning-700">
                    <Warning size={16} className="mt-0.5 shrink-0" aria-hidden />
                    {t('composer.details.otherCourse', { count: foreignBatches })}
                </p>
            )}

            {descriptionOpen ? (
                <Controller
                    control={control}
                    name="description"
                    render={({ field }) => (
                        <div className="space-y-1.5">
                            <Label htmlFor="plan-description">{t('composer.description')}</Label>
                            <Textarea
                                id="plan-description"
                                value={field.value}
                                onChange={(e) => field.onChange(e.target.value)}
                                onBlur={field.onBlur}
                                placeholder={t('composer.descriptionPlaceholder')}
                                rows={2}
                            />
                        </div>
                    )}
                />
            ) : (
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    className="px-0"
                    onClick={() => setShowDescription(true)}
                >
                    {t('composer.details.addDescription')}
                </MyButton>
            )}
        </section>
    );
}

const SCHEDULE_MODES: ScheduleMode[] = ['CALENDAR', 'RELATIVE'];

/**
 * Calendar dates or days after joining. Picked when the plan is created; a saved plan
 * shows its mode read-only (the server refuses a change).
 */
function ScheduleModeField({
    control,
    isEdit,
    onChange,
}: {
    control: Control<ComposerForm>;
    isEdit: boolean;
    onChange: (mode: ScheduleMode) => void;
}) {
    const { t } = useTranslation('engagement');
    const mode = useWatch({ control, name: 'scheduleMode' }) ?? 'CALENDAR';
    if (isEdit) {
        return (
            <p className="flex items-start gap-2 text-caption text-neutral-600">
                <CalendarPlus size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                    <span className="font-semibold text-neutral-800">
                        {t(`composer.relative.mode.${mode}`)}
                    </span>
                    {' · '}
                    {t('composer.relative.modeLocked')}
                </span>
            </p>
        );
    }
    return (
        <div className="space-y-1.5" data-composer-path="scheduleMode">
            <p id="plan-schedule-mode" className="text-subtitle font-regular text-neutral-900">
                {t('composer.relative.modeLabel')}
            </p>
            <RadioGroup
                value={mode}
                onValueChange={(value) => onChange(value as ScheduleMode)}
                aria-labelledby="plan-schedule-mode"
                className="grid gap-2 sm:grid-cols-2"
            >
                {SCHEDULE_MODES.map((option) => {
                    const id = `plan-schedule-mode-${option}`;
                    const checked = mode === option;
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
                            <RadioGroupItem id={id} value={option} className="mt-0.5" />
                            <span className="min-w-0">
                                <span className="block text-body font-semibold text-neutral-900">
                                    {t(`composer.relative.mode.${option}`)}
                                </span>
                                <span className="block text-caption text-neutral-500">
                                    {t(`composer.relative.mode.${option}_hint`)}
                                </span>
                            </span>
                        </label>
                    );
                })}
            </RadioGroup>
        </div>
    );
}

function hasCourseSlide(slots: SlotForm[] | undefined): boolean {
    return (slots ?? []).some((slot) =>
        (slot?.items ?? []).some((item) => item.itemType === 'COURSE_SLIDE')
    );
}

/** "Day 2 of 3 · Thu, 25 Sep" with the day's own actions (reachable on every width). */
function DayHeader({
    control,
    index,
    rank,
    count,
    onDuplicate,
    onDelete,
}: {
    control: Control<ComposerForm>;
    index: number;
    /** 1-based place in date order. */
    rank: number;
    count: number;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const { t, i18n } = useTranslation('engagement');
    const slot = useWatch({ control, name: `slots.${index}` }) as SlotForm | undefined;
    const relative = useWatch({ control, name: 'scheduleMode' }) === 'RELATIVE';
    const theme = slot?.title?.trim();
    const when = slot ? dayHeading(slot, i18n.language, relative ? t : null).label : '';
    const label = [when, theme].filter(Boolean).join(' · ');
    return (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
                <p className="text-caption font-semibold text-primary-500">
                    {t('composer.dayOf', { n: rank, count })}
                </p>
                <h3 className="truncate text-h3-semibold text-neutral-900">{label}</h3>
            </div>
            <div className="flex items-center gap-1">
                <MyButton type="button" buttonType="secondary" scale="small" onClick={onDuplicate}>
                    <CopySimple size={14} aria-hidden /> {t('composer.rail.duplicate')}
                </MyButton>
                {count > 1 && (
                    <MyButton type="button" buttonType="text" scale="small" onClick={onDelete}>
                        <Trash size={14} className="text-danger-600" aria-hidden />{' '}
                        {t('composer.rail.delete')}
                    </MyButton>
                )}
            </div>
        </div>
    );
}

/** "What learners see" for the selected day, following the open task. */
function PreviewPane({
    control,
    dayIndex,
    activeKey,
    onSelect,
    activeCardId,
}: {
    control: Control<ComposerForm>;
    dayIndex: number;
    activeKey: string | null;
    onSelect: (key: string) => void;
    activeCardId: string | null;
}) {
    const slot = useWatch({ control, name: `slots.${dayIndex}` }) as SlotForm | undefined;
    const defaultMissPolicy = useWatch({ control, name: 'defaultMissPolicy' });
    const defaultCatchUpDays = useWatch({ control, name: 'defaultCatchUpDays' });
    const defaultCatchUpPercent = useWatch({ control, name: 'defaultCatchUpPercent' });
    if (!slot) return null;
    return (
        <PlanPreview
            slot={slot}
            defaultMissPolicy={defaultMissPolicy}
            defaultCatchUpDays={defaultCatchUpDays}
            defaultCatchUpPercent={defaultCatchUpPercent}
            activeKey={activeKey}
            onSelect={onSelect}
            activeCardId={activeCardId}
        />
    );
}
