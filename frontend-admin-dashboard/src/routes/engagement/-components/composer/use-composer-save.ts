import { useCallback, useState } from 'react';
import type { TFunction } from 'i18next';
import {
    createEngagementPlan,
    deleteEngagementSlot,
    updateEngagementPlan,
    upsertEngagementSlot,
} from '../../-services/engagement-service';
import type {
    EngagementPlanDTO,
    EngagementPlanRequest,
    EngagementSlotDTO,
    EngagementSlotRequest,
} from '../../-types/types';
import {
    formToRequest,
    isBlankRichText,
    isGradingRelevantChange,
    newKey,
    slotFormToRequest,
    type ComposerForm,
    type ItemForm,
    type SlotForm,
} from '../forms/composer-schema';

/**
 * How the composer saves.
 *
 * - A new plan is one `POST /plan` with every day and task (one plan per batch).
 * - A saved plan is saved piece by piece, and only the pieces that changed:
 *   1. every day the teacher removed is deleted (`DELETE /slot/{id}`);
 *   2. every new or changed day is upserted (`POST /plan/{id}/slot`), each carrying ALL
 *      of its tasks, because the server retires any task a slot save leaves out;
 *   3. the plan's own fields (title, description, status, late policy) are updated
 *      with no `slots`, which the server reads as "leave the days alone".
 *   An untouched day is never sent, so its tasks keep their ids, versions and
 *   completions (the P0-1 probe: edit day 2, day 1 is byte-for-byte unchanged).
 *
 * Status goes last, so a Publish never shows learners a half-saved plan.
 */

// ── Snapshots (what counts as "changed") ─────────────────────────────────────

/**
 * Canonical form of a request for comparison: keys sorted, empty values dropped, and
 * rich text that renders as nothing treated as empty. The rich-text editor rewrites an
 * empty body as "<p></p>" after it mounts; without this, merely opening a task would
 * make its day look edited.
 */
function canonical(value: unknown, key?: string): unknown {
    if (typeof value === 'string') {
        if (key === 'payloadJson') {
            try {
                return canonical(JSON.parse(value));
            } catch {
                return value;
            }
        }
        return value.includes('<') && isBlankRichText(value) ? '' : value;
    }
    if (Array.isArray(value)) return value.map((entry) => canonical(entry));
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            const v = canonical((value as Record<string, unknown>)[k], k);
            if (v === undefined || v === null || v === '') continue;
            out[k] = v;
        }
        return out;
    }
    return value;
}

/** A shallow copy without some keys. */
function without<T extends object, K extends keyof T>(value: T, keys: K[]): Omit<T, K> {
    const copy = { ...value };
    for (const key of keys) delete copy[key];
    return copy;
}

/** The plan request minus its days (and the create-only batch list). */
function planFields(form: ComposerForm): Partial<EngagementPlanRequest> {
    return without(formToRequest(form), ['slots', 'packageSessionIds']);
}

function stable(value: unknown): string {
    return JSON.stringify(canonical(value));
}

/** One day as it would be saved, in comparable form. */
export function slotSnapshot(
    slot: SlotForm,
    sortOrder: number,
    scheduleMode: ComposerForm['scheduleMode'] = 'CALENDAR'
): string {
    return stable(slotFormToRequest(slot, sortOrder, scheduleMode));
}

/** The plan's own fields (everything but the days), in comparable form. */
export function planFieldsSnapshot(form: ComposerForm): string {
    return stable(planFields(form));
}

/** The whole form as it would be saved; drives the "discard changes?" guard. */
export function formSnapshot(form: ComposerForm): string {
    return stable(formToRequest(form));
}

/**
 * The sortOrder each day saves with: its own stored value, untouched, and for a new day
 * the next number after every stored one. The server lists days by date, then start
 * time, then sortOrder, so a day's place is its date; re-numbering days the teacher
 * didn't edit would only re-send them.
 */
export function slotSaveOrders(slots: SlotForm[]): number[] {
    let next = slots.reduce((max, slot) => Math.max(max, slot.sortOrder ?? -1), -1) + 1;
    return slots.map((slot) => (slot.sortOrder != null ? slot.sortOrder : next++));
}

export interface ComposerBaseline {
    /** The whole form. */
    full: string;
    /** The plan's own fields. */
    plan: string;
    /** Each saved day by id, at the sort order it was loaded with. */
    slots: Record<string, string>;
}

/** Take the baseline right after the form is filled (on open, or after a load). */
export function takeBaseline(form: ComposerForm): ComposerBaseline {
    const orders = slotSaveOrders(form.slots);
    const slots: Record<string, string> = {};
    form.slots.forEach((slot, index) => {
        if (slot.id) slots[slot.id] = slotSnapshot(slot, orders[index]!, form.scheduleMode);
    });
    return { full: formSnapshot(form), plan: planFieldsSnapshot(form), slots };
}

export function isComposerDirty(form: ComposerForm, baseline: ComposerBaseline | null): boolean {
    return baseline !== null && formSnapshot(form) !== baseline.full;
}

// ── Save plan ────────────────────────────────────────────────────────────────

export interface SlotUpsertStep {
    /** Index of the day in the form. */
    index: number;
    request: EngagementSlotRequest;
}

export interface SaveSteps {
    deleteSlotIds: string[];
    upsertSlots: SlotUpsertStep[];
    /** The plan's own fields, or null when they are unchanged. */
    planUpdate: Partial<EngagementPlanRequest> | null;
}

/** What an edit has to send: only the days and fields that changed. */
export function planSaveSteps(form: ComposerForm, baseline: ComposerBaseline): SaveSteps {
    const orders = slotSaveOrders(form.slots);
    const keptIds = new Set(form.slots.map((slot) => slot.id).filter(Boolean));
    const deleteSlotIds = Object.keys(baseline.slots).filter((id) => !keptIds.has(id));
    const upsertSlots: SlotUpsertStep[] = [];
    form.slots.forEach((slot, index) => {
        const order = orders[index]!;
        const changed =
            !slot.id || baseline.slots[slot.id] !== slotSnapshot(slot, order, form.scheduleMode);
        if (changed) {
            upsertSlots.push({
                index,
                request: slotFormToRequest(slot, order, form.scheduleMode),
            });
        }
    });
    let planUpdate: Partial<EngagementPlanRequest> | null = null;
    if (planFieldsSnapshot(form) !== baseline.plan) {
        planUpdate = planFields(form);
    }
    return { deleteSlotIds, upsertSlots, planUpdate };
}

// ── Detach (copy as a new task / day) ───────────────────────────────────────

/**
 * The same task as a NEW task: no id, a fresh row key, no version or counts. Used by
 * Duplicate, by Move to day (the server keeps an untouched task on its old day, so a
 * saved task moves as a copy), and by "Save as a new task" when an answered task's
 * answer key changes.
 */
export function detachItem(item: ItemForm): ItemForm {
    return {
        ...without(item, ['id']),
        key: newKey('task'),
        sortOrder: null,
        version: null,
        completedCount: null,
    } as ItemForm;
}

/** The same day as a new day with new tasks, optionally on other dates. */
export function detachSlot(
    slot: SlotForm,
    dates?: { startDate: string; endDate: string }
): SlotForm {
    return {
        ...without(slot, ['id']),
        key: newKey('day'),
        sortOrder: null,
        status: null,
        ...(dates ?? {}),
        items: slot.items.map(detachItem),
    };
}

// ── Answered tasks whose answer key changed ─────────────────────────────────

export interface LockedChange {
    dayIndex: number;
    itemIndex: number;
    key: string;
    title: string;
    answered: number;
}

/**
 * Saved tasks that learners have finished and whose type, format, correct option or
 * option set changed. The server rejects those edits (the grades would stop matching
 * the key), so the composer offers to save each as a new task instead.
 */
export function lockedChanges(form: ComposerForm): LockedChange[] {
    const out: LockedChange[] = [];
    form.slots.forEach((slot, dayIndex) => {
        slot.items.forEach((item, itemIndex) => {
            const answered = item.completedCount ?? 0;
            if (answered > 0 && isGradingRelevantChange(item)) {
                out.push({ dayIndex, itemIndex, key: item.key, title: item.title, answered });
            }
        });
    });
    return out;
}

// ── Server messages → i18n ──────────────────────────────────────────────────

export interface MappedMessage {
    key: string;
    values?: Record<string, string | number>;
}

const CARD_SIDES = new Set(['front', 'back', 'hint']);

/**
 * The server's teacher-facing messages as i18n keys (engagement namespace), so an
 * Arabic admin doesn't get English. Unknown messages return null and are shown as sent.
 */
export function mapServerMessage(raw: string): MappedMessage | null {
    const text = raw.trim();
    let m: RegExpExecArray | null;
    if (/^Add at least 1 card/i.test(text)) return { key: 'composer.errors.cardsMin' };
    if (/^Flashcards can have at most \d+ cards/i.test(text)) {
        return { key: 'composer.errors.cardsMax' };
    }
    if ((m = /^Card (\d+): (front|back|hint) is required/i.exec(text))) {
        return {
            key: `composer.serverErrors.card_${m[2]!.toLowerCase()}Required`,
            values: { n: m[1]! },
        };
    }
    if ((m = /^Card (\d+): (front|back|hint) is longer than (\d+)/i.exec(text))) {
        const side = m[2]!.toLowerCase();
        if (CARD_SIDES.has(side)) {
            return {
                key: `composer.serverErrors.card_${side}TooLong`,
                values: { n: m[1]!, max: Number(m[3]) },
            };
        }
    }
    if ((m = /^Card (\d+): (front|back|hint) has more than (\d+) lines/i.exec(text))) {
        return {
            key: 'composer.serverErrors.cardTooManyLines',
            values: { n: m[1]!, max: Number(m[3]) },
        };
    }
    if ((m = /^Card (\d+): duplicate id/i.exec(text))) {
        return { key: 'composer.serverErrors.cardDuplicateId', values: { n: m[1]! } };
    }
    if ((m = /^Card (\d+): (invalid id|.+ must be text)/i.exec(text))) {
        return { key: 'composer.serverErrors.cardInvalid', values: { n: m[1]! } };
    }
    if (/^Unsupported flashcards format/i.test(text)) {
        return { key: 'composer.serverErrors.flashcardsFormat' };
    }
    if (/^The flashcards could not be read/i.test(text)) {
        return { key: 'composer.serverErrors.flashcardsUnreadable' };
    }
    if (/^A task title can be at most/i.test(text)) return { key: 'composer.errors.titleTooLong' };
    if (/so its type can't change/i.test(text)) return { key: 'composer.serverErrors.typeLocked' };
    if (/so its answer key can't change/i.test(text)) {
        return { key: 'composer.serverErrors.answerKeyLocked' };
    }
    if ((m = /^"(.*)" has no content yet/i.exec(text))) {
        return { key: 'composer.serverErrors.noContent', values: { title: m[1]! } };
    }
    if ((m = /^Pick the lesson for "(.*)"/i.exec(text))) {
        return { key: 'composer.serverErrors.noLesson', values: { title: m[1]! } };
    }
    if ((m = /^The poll "(.*)" needs at least two options/i.exec(text))) {
        return { key: 'composer.serverErrors.pollOptions', values: { title: m[1]! } };
    }
    if ((m = /^The question "(.*)" needs at least two options/i.exec(text))) {
        return { key: 'composer.serverErrors.questionOptions', values: { title: m[1]! } };
    }
    if ((m = /^Mark the correct option for "(.*)"/i.exec(text))) {
        return { key: 'composer.serverErrors.correctOption', values: { title: m[1]! } };
    }
    if (/^endTime must be after startTime/i.test(text)) return { key: 'composer.errors.time' };
    if (/^endDate cannot be before startDate/i.test(text)) {
        return { key: 'composer.errors.dateOrder' };
    }
    if (/^revealTime cannot be before startTime/i.test(text)) {
        return { key: 'composer.errors.revealBeforeOpen' };
    }
    if (
        /^At least one batch is required/i.test(text) ||
        /^packageSessionId is required/i.test(text)
    ) {
        return { key: 'composer.errors.batch' };
    }
    if (/^title is required/i.test(text)) return { key: 'composer.errors.title' };
    if (/^Slot not found/i.test(text)) return { key: 'composer.serverErrors.dayGone' };
    if (/^Item not found/i.test(text)) return { key: 'composer.serverErrors.taskGone' };
    if (/^Plan not found/i.test(text)) return { key: 'composer.serverErrors.planGone' };
    return null;
}

interface AxiosLike {
    response?: { data?: { message?: unknown; ex?: unknown } | string };
    request?: unknown;
    message?: string;
}

/** The server's message from a failed request, if it sent one. */
export function serverMessageOf(error: unknown): string | null {
    const data = (error as AxiosLike | null)?.response?.data;
    if (typeof data === 'string' && data.trim()) return data.trim();
    if (data && typeof data === 'object') {
        for (const value of [data.message, data.ex]) {
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
    }
    return null;
}

/** A failed save as one teacher-facing sentence in the admin's language. */
export function saveErrorText(failure: unknown, t: TFunction): string {
    const error = failure instanceof ComposerSaveError ? failure.original : failure;
    const raw = serverMessageOf(error);
    if (raw) {
        const mapped = mapServerMessage(raw);
        return mapped ? t(mapped.key, mapped.values) : raw;
    }
    const e = error as AxiosLike | null;
    if (e && e.request && !e.response) return t('composer.serverErrors.offline');
    return t('composer.errors.save');
}

// ── The hook ─────────────────────────────────────────────────────────────────

export type SaveResult =
    | { kind: 'created'; plans: EngagementPlanDTO[] }
    | { kind: 'updated'; changed: boolean };

/** What a save got through before it failed, so a retry never repeats it. */
export interface SaveProgress {
    deletedSlotIds: string[];
    savedSlots: { index: number; dto: EngagementSlotDTO }[];
}

export class ComposerSaveError extends Error {
    constructor(
        readonly original: unknown,
        readonly progress: SaveProgress,
        /** The day that failed to save, when a day did. */
        readonly failedDayIndex: number | null
    ) {
        super('Composer save failed');
        this.name = 'ComposerSaveError';
    }
}

export interface SaveArgs {
    planId?: string | null;
    form: ComposerForm;
    baseline: ComposerBaseline | null;
}

/**
 * Save the composer's form. Create → one request. Edit → only the changed pieces, in
 * a safe order. A failure part-way throws ComposerSaveError carrying what did save,
 * so the caller can fold the saved days back into the form before a retry.
 */
export async function saveComposer({ planId, form, baseline }: SaveArgs): Promise<SaveResult> {
    if (!planId) {
        const plans = await createEngagementPlan(formToRequest(form));
        return { kind: 'created', plans };
    }
    const steps = baseline
        ? planSaveSteps(form, baseline)
        : {
              deleteSlotIds: [],
              upsertSlots: form.slots.map((slot, index) => ({
                  index,
                  request: slotFormToRequest(
                      slot,
                      slotSaveOrders(form.slots)[index],
                      form.scheduleMode
                  ),
              })),
              planUpdate: planFields(form),
          };
    const progress: SaveProgress = { deletedSlotIds: [], savedSlots: [] };
    for (const slotId of steps.deleteSlotIds) {
        try {
            await deleteEngagementSlot(slotId);
            progress.deletedSlotIds.push(slotId);
        } catch (error) {
            throw new ComposerSaveError(error, progress, null);
        }
    }
    for (const step of steps.upsertSlots) {
        try {
            const dto = await upsertEngagementSlot(planId, step.request);
            progress.savedSlots.push({ index: step.index, dto });
        } catch (error) {
            throw new ComposerSaveError(error, progress, step.index);
        }
    }
    if (steps.planUpdate) {
        try {
            await updateEngagementPlan(planId, steps.planUpdate);
        } catch (error) {
            throw new ComposerSaveError(error, progress, null);
        }
    }
    const changed =
        steps.deleteSlotIds.length > 0 || steps.upsertSlots.length > 0 || steps.planUpdate !== null;
    return { kind: 'updated', changed };
}

/** `saveComposer` with a `saving` flag for the footer. */
export function useComposerSave() {
    const [saving, setSaving] = useState(false);
    const save = useCallback(async (args: SaveArgs): Promise<SaveResult> => {
        setSaving(true);
        try {
            return await saveComposer(args);
        } finally {
            setSaving(false);
        }
    }, []);
    return { saving, save };
}
