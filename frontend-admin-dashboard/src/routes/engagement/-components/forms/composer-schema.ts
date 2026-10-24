import { z } from 'zod';
import type {
    EngagementItemDTO,
    EngagementItemRequest,
    EngagementItemType,
    EngagementPlanDTO,
    EngagementPlanRequest,
    EngagementSlotDTO,
    EngagementSlotRequest,
    MissPolicy,
    PlanStatus,
    QuestionFormat,
    ScheduleMode,
} from '../../-types/types';
import {
    flashcardsDeckSchema,
    parseFlashcardsPayload,
    serializeFlashcardsPayload,
    type FlashcardsDeck,
} from '../flashcards/flashcards-schema';
import {
    addDays,
    daysBetween,
    instituteToday,
    isEveryDay,
    parseIsoDate,
    slotRunDates,
} from '../../-utils/format';

/**
 * The composer's form model, its zod schema, and the mappers between it and the API.
 *
 * - `composerSchema` validates a whole plan: every day (slot) and every task, all at
 *   once, so the form can mark each problem inline instead of reporting the first one.
 *   Messages are i18n keys in the `engagement` namespace (`t(error.message)`).
 * - `dtoToForm` / `formToRequest` round-trip a saved plan without losing anything the
 *   form doesn't show. The server overwrites every slot and item field it is sent, so
 *   a field left out of a save is a field erased: dowMask, sortOrder, the per-task miss
 *   policy, questionId, assessmentId and slot titles all ride along untouched.
 * - A task whose payload the teacher didn't touch is sent back byte-for-byte as it was
 *   loaded, so the server's no-op check sees no change and the task keeps its version.
 */

// ── Error keys ───────────────────────────────────────────────────────────────

export const COMPOSER_ERRORS = {
    title: 'composer.errors.title',
    titleTooLong: 'composer.errors.titleTooLong',
    batch: 'composer.errors.batch',
    days: 'composer.errors.days',
    date: 'composer.errors.date',
    dateOrder: 'composer.errors.dateOrder',
    timeFormat: 'composer.errors.timeFormat',
    time: 'composer.errors.time',
    revealBeforeOpen: 'composer.errors.revealBeforeOpen',
    weekdays: 'composer.errors.weekdays',
    tasks: 'composer.errors.tasks',
    taskTitle: 'composer.errors.taskTitle',
    points: 'composer.errors.points',
    maxScore: 'composer.errors.maxScore',
    content: 'composer.errors.content',
    contentRequired: 'composer.errors.contentRequired',
    options: 'composer.errors.options',
    pollOptions: 'composer.errors.pollOptions',
    optionIds: 'composer.errors.optionIds',
    correct: 'composer.errors.correct',
    catchUpDays: 'composer.errors.catchUpDays',
    catchUpPercent: 'composer.errors.catchUpPercent',
    dayNumber: 'composer.errors.dayNumber',
    dayOrder: 'composer.errors.dayOrder',
} as const;

const K = COMPOSER_ERRORS;

export const MAX_POINTS = 1000;
export const MAX_CATCH_UP_DAYS = 30;
export const TITLE_MAX = 200;
/** The last "Day N" a join-based plan can reach (the server's MAX_RELATIVE_DAY). */
export const MAX_RELATIVE_DAY = 366;
export const MISS_POLICIES: MissPolicy[] = ['EXPIRES', 'CATCH_UP_FULL', 'CATCH_UP_REDUCED'];
export const QUESTION_FORMATS: QuestionFormat[] = ['MCQ', 'TEXT', 'UPLOAD'];
const PLAN_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED', 'DELETED'] as const;

// ── Field schemas ────────────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const wallTime = z.string().regex(HHMM, K.timeFormat);
const optionalWallTime = z.union([z.literal(''), wallTime]);
const isoDate = z.string().refine((value) => parseIsoDate(value) !== null, K.date);
const optionalIsoDate = z.union([z.literal(''), isoDate]);
const missPolicy = z.enum(['EXPIRES', 'CATCH_UP_FULL', 'CATCH_UP_REDUCED']);

const points = z
    .number({ required_error: K.points, invalid_type_error: K.points })
    .int(K.points)
    .min(0, K.points)
    .max(MAX_POINTS, K.points);

const optionalInt = z.number().int().nullable().optional();
const optionalText = z.string().nullable().optional();

/**
 * What a task looked like when it was loaded: its payload string verbatim and a
 * signature of the form fields that produce the payload. Hidden; never edited.
 */
const originSchema = z.object({
    itemType: z.string(),
    payloadJson: z.string().nullable(),
    signature: z.string(),
    /**
     * The title exactly as stored. The server compares titles byte for byte, so a
     * stored title with stray spaces is sent back as-is while the teacher leaves it
     * alone, instead of trimmed (which would bump the task's version on a no-op save).
     */
    title: z.string().optional(),
});

export type ItemOrigin = z.infer<typeof originSchema>;

const optionSchema = z.object({ id: z.string(), text: z.string() });

export type QuestionOption = z.infer<typeof optionSchema>;

/** A question of the day's or a poll's authored fields (serialised into payloadJson). */
const questionSchema = z.object({
    format: z.enum(['MCQ', 'TEXT', 'UPLOAD']),
    prompt: z.string(),
    options: z.array(optionSchema),
    correctOptionId: z.string(),
    explanation: z.string(),
});

export type QuestionForm = z.infer<typeof questionSchema>;

/** Fields every task has, whatever its type. */
const itemBase = {
    /** Local row key; the saved id when there is one. */
    key: z.string(),
    id: z.string().optional(),
    title: z.string().trim().min(1, K.taskTitle).max(TITLE_MAX, K.titleTooLong),
    sortOrder: z.number().int().nullable().optional(),
    isRequired: z.boolean(),
    completionPoints: points,
    correctPoints: points,
    maxScore: z.number().int().min(0).nullable().optional(),
    hideResultUntilReveal: z.boolean(),
    /** Per-task override of the plan's miss policy; null = the plan default. */
    missPolicy: missPolicy.nullable().optional(),
    catchUpDays: optionalInt,
    catchUpPercent: optionalInt,
    questionId: optionalText,
    assessmentId: optionalText,
    /** Kept on every type so a round trip never drops it; cleared by changeItemType. */
    contentHtml: z.string().optional(),
    slideId: optionalText,
    /** Read-only, from the server. */
    version: z.number().nullable().optional(),
    completedCount: z.number().nullable().optional(),
    origin: originSchema.nullable().optional(),
};

const readingItem = z.object({
    ...itemBase,
    itemType: z.enum(['READING_HTML', 'VISUAL_NOTE']),
    contentHtml: z.string(),
});

const gameItem = z.object({
    ...itemBase,
    itemType: z.literal('GAME'),
    contentHtml: z.string(),
    /** Required for a game; null until the teacher fills it in (checked below). */
    maxScore: z
        .number({ invalid_type_error: K.maxScore })
        .int(K.maxScore)
        .min(1, K.maxScore)
        .max(MAX_POINTS, K.maxScore)
        .nullable(),
});

const questionItem = z.object({
    ...itemBase,
    itemType: z.literal('QUESTION_OF_DAY'),
    question: questionSchema,
});

const pollItem = z.object({
    ...itemBase,
    itemType: z.literal('POLL'),
    question: questionSchema,
});

const courseSlideItem = z.object({
    ...itemBase,
    itemType: z.literal('COURSE_SLIDE'),
    /** The picked slide's path, stored whole as payloadJson so the learner can deep-link. */
    slide: z.record(z.unknown()).nullable().optional(),
});

const flashcardsItem = z.object({
    ...itemBase,
    itemType: z.literal('FLASHCARDS'),
    flashcards: flashcardsDeckSchema,
});

/** QUIZ is not authored here; its payload passes through untouched. */
const quizItem = z.object({
    ...itemBase,
    itemType: z.literal('QUIZ'),
    payloadJson: z.string().nullable().optional(),
});

/** True when rich text renders as nothing ("<p></p>", "<p><br></p>", whitespace). */
export function isBlankRichText(html: string | null | undefined): boolean {
    if (!html) return true;
    if (/<(img|iframe|video|audio|hr|svg|canvas)\b/i.test(html)) return false;
    return (
        html
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .trim() === ''
    );
}

function filledOptions(question: QuestionForm): QuestionOption[] {
    return question.options.filter((option) => option.text.trim().length > 0);
}

export const itemSchema = z
    .discriminatedUnion('itemType', [
        readingItem,
        gameItem,
        questionItem,
        pollItem,
        courseSlideItem,
        flashcardsItem,
        quizItem,
    ])
    .superRefine((item, ctx) => {
        const issue = (path: (string | number)[], message: string) =>
            ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

        switch (item.itemType) {
            case 'READING_HTML':
            case 'VISUAL_NOTE':
                if (isBlankRichText(item.contentHtml)) issue(['contentHtml'], K.contentRequired);
                break;
            case 'GAME':
                if (!item.contentHtml.trim()) issue(['contentHtml'], K.contentRequired);
                if (item.maxScore == null) issue(['maxScore'], K.maxScore);
                break;
            case 'COURSE_SLIDE':
                if (!item.slideId) issue(['slideId'], K.content);
                break;
            case 'QUESTION_OF_DAY':
            case 'POLL': {
                const isPoll = item.itemType === 'POLL';
                if (!isPoll && item.question.format !== 'MCQ') break;
                const filled = filledOptions(item.question);
                if (filled.length < 2) {
                    issue(['question', 'options'], isPoll ? K.pollOptions : K.options);
                }
                const ids = filled.map((option) => option.id);
                if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
                    issue(['question', 'options'], K.optionIds);
                }
                if (!isPoll && filled.length >= 2 && !ids.includes(item.question.correctOptionId)) {
                    issue(['question', 'correctOptionId'], K.correct);
                }
                break;
            }
            default:
                break;
        }
        refineCatchUp(item, ctx, ['catchUpDays'], ['catchUpPercent'], item.missPolicy);
    });

function refineCatchUp(
    value: { catchUpDays?: number | null; catchUpPercent?: number | null },
    ctx: z.RefinementCtx,
    daysPath: (string | number)[],
    percentPath: (string | number)[],
    policy: MissPolicy | null | undefined
) {
    if (!policy || policy === 'EXPIRES') return;
    const days = value.catchUpDays;
    if (days != null && (days < 1 || days > MAX_CATCH_UP_DAYS)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: daysPath, message: K.catchUpDays });
    }
    const percent = value.catchUpPercent;
    if (policy === 'CATCH_UP_REDUCED' && percent != null && (percent < 1 || percent > 100)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: percentPath, message: K.catchUpPercent });
    }
}

export const slotSchema = z
    .object({
        key: z.string(),
        id: z.string().optional(),
        /** The day's theme. Blank is allowed. */
        title: z.string().max(TITLE_MAX, K.titleTooLong),
        startDate: isoDate,
        /** '' = a one-day slot. */
        endDate: optionalIsoDate,
        startTime: wallTime,
        endTime: wallTime,
        /** Mon=1 … Sun=64; 0 = every day. */
        dowMask: z.number().int().min(0).max(127),
        revealTime: optionalWallTime,
        notifyTime: optionalWallTime,
        sortOrder: z.number().int().nullable().optional(),
        /** Read-only, from the server. */
        status: z.string().nullable().optional(),
        items: z.array(itemSchema).min(1, K.tasks),
    })
    .superRefine((slot, ctx) => {
        const issue = (path: string, message: string) =>
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
        if (
            HHMM.test(slot.startTime) &&
            HHMM.test(slot.endTime) &&
            slot.endTime <= slot.startTime
        ) {
            issue('endTime', K.time);
        }
        if (slot.revealTime && HHMM.test(slot.startTime) && slot.revealTime < slot.startTime) {
            issue('revealTime', K.revealBeforeOpen);
        }
        const datesValid =
            parseIsoDate(slot.startDate) !== null &&
            (!slot.endDate || parseIsoDate(slot.endDate) !== null);
        if (!datesValid) return;
        if (slot.endDate && slot.endDate < slot.startDate) {
            issue('endDate', K.dateOrder);
            return;
        }
        if (!isEveryDay(slot.dowMask) && slotRunDates(slot, 8).length === 0) {
            issue('dowMask', K.weekdays);
        }
    });

export const composerSchema = z
    .object({
        /** Present when editing a saved plan. */
        id: z.string().optional(),
        title: z.string().trim().min(1, K.title).max(TITLE_MAX, K.titleTooLong),
        description: z.string(),
        status: z.enum(PLAN_STATUSES),
        subjectId: optionalText,
        /** The saved plan's batch (edit). */
        packageSessionId: z.string().optional(),
        /** Batches to create the plan for (create). */
        packageSessionIds: z.array(z.string()),
        /** Read-only: the zone the plan's windows resolve in. */
        timezone: optionalText,
        /** Chosen when the plan is created; fixed afterwards. */
        scheduleMode: z.enum(['CALENDAR', 'RELATIVE']),
        defaultMissPolicy: missPolicy,
        defaultCatchUpDays: optionalInt,
        defaultCatchUpPercent: optionalInt,
        slots: z.array(slotSchema).min(1, K.days),
    })
    .superRefine((plan, ctx) => {
        if (!plan.id && plan.packageSessionIds.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['packageSessionIds'],
                message: K.batch,
            });
        }
        if (plan.scheduleMode === 'RELATIVE') {
            // Day N is stored as a date counted from RELATIVE_DAY_ONE (see relativeDayOf).
            plan.slots.forEach((slot, index) => {
                const first = relativeDayOf(slot.startDate);
                const last = slot.endDate ? relativeDayOf(slot.endDate) : first;
                if (first == null || first < 1 || first > MAX_RELATIVE_DAY) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['slots', index, 'startDate'],
                        message: K.dayNumber,
                    });
                } else if (last == null || last < first || last > MAX_RELATIVE_DAY) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['slots', index, 'endDate'],
                        message: K.dayOrder,
                    });
                }
            });
        }
        refineCatchUp(
            { catchUpDays: plan.defaultCatchUpDays, catchUpPercent: plan.defaultCatchUpPercent },
            ctx,
            ['defaultCatchUpDays'],
            ['defaultCatchUpPercent'],
            plan.defaultMissPolicy
        );
    });

export type ComposerForm = z.infer<typeof composerSchema>;
export type SlotForm = z.infer<typeof slotSchema>;
export type ItemForm = z.infer<typeof itemSchema>;
export type ItemFormOf<T extends EngagementItemType> = Extract<ItemForm, { itemType: T }>;

// ── Join-based days ──────────────────────────────────────────────────────────

/**
 * A join-based plan keeps each day in the form as a placeholder date: Day N is
 * RELATIVE_DAY_ONE + (N − 1), the same dates the server stores and returns. Sorting,
 * "add next day" and duplication then work unchanged; only labels and inputs show
 * "Day N", and the request carries startDay/endDay.
 */
export const RELATIVE_DAY_ONE = '2000-01-01';

/** "Day N" for a placeholder date (1 = RELATIVE_DAY_ONE), or null when it isn't a date. */
export function relativeDayOf(iso: string | null | undefined): number | null {
    if (!iso || parseIsoDate(iso) === null) return null;
    return daysBetween(RELATIVE_DAY_ONE, iso) + 1;
}

/** The placeholder date for "Day N". */
export function relativeDate(day: number): string {
    return addDays(RELATIVE_DAY_ONE, Math.max(0, Math.trunc(day) - 1));
}

function relativeDays(slot: Pick<SlotForm, 'startDate' | 'endDate'>): {
    startDay?: number;
    endDay?: number;
} {
    const startDay = relativeDayOf(slot.startDate) ?? undefined;
    const endDay = (slot.endDate ? relativeDayOf(slot.endDate) : null) ?? startDay;
    return { startDay, endDay };
}

/**
 * Move a plan's days between calendar dates and "Day N" (the composer's mode switch on
 * a new plan), keeping their spacing: the earliest day moves to `from` (RELATIVE_DAY_ONE or a real date).
 */
export function rebaseSlots(slots: SlotForm[], from: string): SlotForm[] {
    const starts = slots.map((slot) => slot.startDate).filter((d) => parseIsoDate(d) !== null);
    if (starts.length === 0) return slots;
    const earliest = starts.reduce((a, b) => (b < a ? b : a));
    const shift = daysBetween(earliest, from);
    return slots.map((slot) => ({
        ...slot,
        dowMask: 0,
        startDate: parseIsoDate(slot.startDate) ? addDays(slot.startDate, shift) : slot.startDate,
        endDate:
            slot.endDate && parseIsoDate(slot.endDate)
                ? addDays(slot.endDate, shift)
                : slot.endDate,
    }));
}

// ── Defaults ─────────────────────────────────────────────────────────────────

let keySeq = 0;

/** A local row key, unique for the session. */
export function newKey(prefix = 'row'): string {
    keySeq += 1;
    return `${prefix}-${Date.now().toString(36)}-${keySeq}-${Math.random().toString(36).slice(2, 6)}`;
}

function blankQuestion(format: QuestionFormat = 'MCQ'): QuestionForm {
    return {
        format,
        prompt: '',
        options: [
            { id: 'a', text: '' },
            { id: 'b', text: '' },
        ],
        correctOptionId: 'a',
        explanation: '',
    };
}

/** Fields every task form has. */
export type ItemCommon = z.infer<z.ZodObject<typeof itemBase>>;

function commonDefaults(overrides: Partial<ItemCommon> = {}): ItemCommon {
    return {
        key: newKey('task'),
        title: '',
        isRequired: false,
        completionPoints: 10,
        correctPoints: 0,
        hideResultUntilReveal: false,
        ...overrides,
    };
}

/** A new task of a type, with that type's empty fields. */
export function newItemForm(
    type: EngagementItemType = 'READING_HTML',
    overrides: Partial<ItemCommon> = {}
): ItemForm {
    return withType(commonDefaults(overrides), type, null);
}

/**
 * Switch a task's type, keeping what the types share (title, points, required, ids)
 * and carrying the question across QOTD ↔ POLL and the content across reading ↔ note.
 * Content the new type can't use is cleared, so it isn't saved invisibly.
 */
export function changeItemType(item: ItemForm, type: EngagementItemType): ItemForm {
    if (item.itemType === type) return item;
    return withType(item, type, item);
}

/** The fields that belong to one type only; dropped when the type changes. */
const TYPE_ONLY_FIELDS = [
    'itemType',
    'question',
    'slide',
    'flashcards',
    'payloadJson',
    'contentHtml',
    'slideId',
] as const;

function withType(
    source: ItemCommon,
    type: EngagementItemType,
    previous: ItemForm | null
): ItemForm {
    const copy: Record<string, unknown> = { ...source };
    for (const field of TYPE_ONLY_FIELDS) delete copy[field];
    const base = copy as ItemCommon;
    const previousQuestion =
        previous && (previous.itemType === 'QUESTION_OF_DAY' || previous.itemType === 'POLL')
            ? previous.question
            : null;
    const previousProse =
        previous && (previous.itemType === 'READING_HTML' || previous.itemType === 'VISUAL_NOTE')
            ? previous.contentHtml
            : '';

    switch (type) {
        case 'READING_HTML':
        case 'VISUAL_NOTE':
            return { ...base, itemType: type, contentHtml: previousProse };
        case 'GAME':
            return {
                ...base,
                itemType: 'GAME',
                contentHtml: '',
                maxScore: source.maxScore && source.maxScore > 0 ? source.maxScore : 10,
            };
        case 'QUESTION_OF_DAY':
            return {
                ...base,
                itemType: 'QUESTION_OF_DAY',
                question: previousQuestion ? { ...previousQuestion } : blankQuestion(),
            };
        case 'POLL':
            return {
                ...base,
                itemType: 'POLL',
                correctPoints: 0,
                hideResultUntilReveal: false,
                question: previousQuestion
                    ? { ...previousQuestion, format: 'MCQ', correctOptionId: '', explanation: '' }
                    : { ...blankQuestion(), correctOptionId: '' },
            };
        case 'COURSE_SLIDE':
            return { ...base, itemType: 'COURSE_SLIDE', slideId: null, slide: null };
        case 'FLASHCARDS':
            return {
                ...base,
                itemType: 'FLASHCARDS',
                correctPoints: 0,
                hideResultUntilReveal: false,
                flashcards: { cards: [], shuffle: true },
            };
        case 'QUIZ':
        default:
            return { ...base, itemType: 'QUIZ', payloadJson: null };
    }
}

export interface NewSlotOptions {
    startDate?: string;
    startTime?: string;
    endTime?: string;
    revealTime?: string;
    notifyTime?: string;
    items?: ItemForm[];
}

export function newSlotForm(options: NewSlotOptions = {}): SlotForm {
    return {
        key: newKey('day'),
        title: '',
        startDate: options.startDate ?? instituteToday(),
        endDate: '',
        startTime: options.startTime ?? '06:00',
        endTime: options.endTime ?? '20:00',
        dowMask: 0,
        revealTime: options.revealTime ?? '20:00',
        notifyTime: options.notifyTime ?? '06:00',
        items: options.items ?? [newItemForm()],
    };
}

export interface NewComposerOptions {
    packageSessionIds?: string[];
    startDate?: string;
    /** New plans default to Draft; the teacher publishes deliberately. */
    status?: PlanStatus;
    scheduleMode?: ScheduleMode;
    items?: ItemForm[];
}

export function newComposerForm(options: NewComposerOptions = {}): ComposerForm {
    return {
        title: '',
        description: '',
        status: options.status ?? 'DRAFT',
        packageSessionIds: options.packageSessionIds ?? [],
        scheduleMode: options.scheduleMode ?? 'CALENDAR',
        defaultMissPolicy: 'EXPIRES',
        slots: [
            newSlotForm({
                startDate:
                    options.scheduleMode === 'RELATIVE' ? RELATIVE_DAY_ONE : options.startDate,
                items: options.items,
            }),
        ],
    };
}

// ── API → form ───────────────────────────────────────────────────────────────

/**
 * An item as either the saved DTO or a request (an AI draft) carries it: the request's
 * fields, each of which the DTO may also send as null.
 */
type Nullable<T> = { [K in keyof T]?: T[K] | null };

type ItemLike = Nullable<Omit<EngagementItemRequest, 'itemType'>> &
    Pick<Nullable<EngagementItemDTO>, 'version' | 'completedCount'> & {
        itemType: EngagementItemType;
    };

type SlotLike = Nullable<
    Omit<EngagementSlotRequest, 'items' | 'startDate' | 'startTime' | 'endTime'>
> &
    Pick<Nullable<EngagementSlotDTO>, 'status'> & {
        startDate: string;
        startTime: string;
        endTime: string;
        items?: ItemLike[] | null;
    };

function parseObject(json: string | null | undefined): Record<string, unknown> | null {
    if (!json) return null;
    try {
        const parsed: unknown = JSON.parse(json);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

function asText(value: unknown): string {
    return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function readQuestion(payload: Record<string, unknown> | null, isPoll: boolean): QuestionForm {
    const rawFormat = asText(payload?.format).trim().toUpperCase();
    const format: QuestionFormat =
        !isPoll && (rawFormat === 'TEXT' || rawFormat === 'UPLOAD') ? rawFormat : 'MCQ';
    const rawOptions = Array.isArray(payload?.options) ? (payload.options as unknown[]) : [];
    const options = rawOptions
        .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
        .map((o) => ({ id: asText(o.id), text: asText(o.text) }));
    return {
        format,
        prompt: asText(payload?.prompt),
        options: options.length > 0 ? options : blankQuestion().options,
        correctOptionId: asText(payload?.correctOptionId),
        explanation: asText(payload?.explanation),
    };
}

/** Wall clock "06:00:00" → "06:00"; '' for none. */
function toWallTime(value: string | null | undefined): string {
    return value ? value.slice(0, 5) : '';
}

/** One saved (or drafted) task as a form row. */
export function itemToForm(item: ItemLike): ItemForm {
    const common: ItemCommon = {
        key: item.id ?? newKey('task'),
        ...(item.id ? { id: item.id } : {}),
        title: item.title ?? '',
        sortOrder: item.sortOrder ?? null,
        isRequired: Boolean(item.isRequired),
        completionPoints: item.completionPoints ?? 0,
        correctPoints: item.correctPoints ?? 0,
        maxScore: item.maxScore ?? null,
        hideResultUntilReveal: Boolean(item.hideResultUntilReveal),
        missPolicy: item.missPolicy ?? null,
        catchUpDays: item.catchUpDays ?? null,
        catchUpPercent: item.catchUpPercent ?? null,
        questionId: item.questionId ?? null,
        assessmentId: item.assessmentId ?? null,
        contentHtml: item.contentHtml ?? '',
        slideId: item.slideId ?? null,
        version: item.version ?? null,
        completedCount: item.completedCount ?? null,
    };
    const payload = parseObject(item.payloadJson);
    let form: ItemForm;
    switch (item.itemType) {
        case 'READING_HTML':
        case 'VISUAL_NOTE':
            form = { ...common, itemType: item.itemType, contentHtml: common.contentHtml ?? '' };
            break;
        case 'GAME':
            form = {
                ...common,
                itemType: 'GAME',
                contentHtml: common.contentHtml ?? '',
                // A missing max score stays missing, so the editor asks for one.
                maxScore: item.maxScore ?? null,
            };
            break;
        case 'QUESTION_OF_DAY':
            form = {
                ...common,
                itemType: 'QUESTION_OF_DAY',
                question: readQuestion(payload, false),
            };
            break;
        case 'POLL':
            form = { ...common, itemType: 'POLL', question: readQuestion(payload, true) };
            break;
        case 'COURSE_SLIDE':
            form = { ...common, itemType: 'COURSE_SLIDE', slide: payload };
            break;
        case 'FLASHCARDS':
            form = {
                ...common,
                itemType: 'FLASHCARDS',
                flashcards: parseFlashcardsPayload(item.payloadJson) ?? {
                    cards: [],
                    shuffle: true,
                },
            };
            break;
        default:
            form = {
                ...common,
                itemType: item.itemType as 'QUIZ',
                payloadJson: item.payloadJson ?? null,
            };
            break;
    }
    // Remember the payload as loaded, so an untouched task saves it back verbatim and
    // an edited one keeps the keys this form doesn't know about.
    form.origin = {
        itemType: item.itemType,
        payloadJson: item.payloadJson ?? null,
        signature: payloadSignature(form),
        title: item.title ?? '',
    };
    return form;
}

function bySortOrder<T extends { sortOrder?: number | null }>(list: T[]): T[] {
    return list
        .map((entry, index) => ({ entry, index }))
        .sort(
            (a, b) =>
                (a.entry.sortOrder ?? a.index) - (b.entry.sortOrder ?? b.index) || a.index - b.index
        )
        .map(({ entry }) => entry);
}

/** One saved (or drafted) day as a form row. */
export function slotToForm(slot: SlotLike): SlotForm {
    return {
        key: slot.id ?? newKey('day'),
        ...(slot.id ? { id: slot.id } : {}),
        title: slot.title ?? '',
        startDate: slot.startDate,
        endDate: slot.endDate ?? '',
        startTime: toWallTime(slot.startTime),
        endTime: toWallTime(slot.endTime),
        dowMask: slot.dowMask ?? 0,
        revealTime: toWallTime(slot.revealTime),
        notifyTime: toWallTime(slot.notifyTime),
        sortOrder: slot.sortOrder ?? null,
        status: slot.status ?? null,
        items: bySortOrder(slot.items ?? []).map(itemToForm),
    };
}

/** A saved plan as the composer's form, every day and task included. */
export function dtoToForm(plan: EngagementPlanDTO): ComposerForm {
    return {
        id: plan.id,
        title: plan.title ?? '',
        description: plan.description ?? '',
        status: plan.status ?? 'DRAFT',
        subjectId: plan.subjectId ?? null,
        packageSessionId: plan.packageSessionId,
        packageSessionIds: plan.packageSessionId ? [plan.packageSessionId] : [],
        timezone: plan.timezone ?? null,
        scheduleMode: plan.scheduleMode === 'RELATIVE' ? 'RELATIVE' : 'CALENDAR',
        defaultMissPolicy: plan.defaultMissPolicy ?? 'EXPIRES',
        defaultCatchUpDays: plan.defaultCatchUpDays ?? null,
        defaultCatchUpPercent: plan.defaultCatchUpPercent ?? null,
        slots: bySortOrder(plan.slots ?? []).map(slotToForm),
    };
}

/**
 * An unsaved plan request (the AI wizard's draft) as the composer's form, so "Edit in
 * full editor" opens it with every day and task.
 */
export function requestToForm(request: EngagementPlanRequest): ComposerForm {
    return {
        title: request.title ?? '',
        description: request.description ?? '',
        status: request.status ?? 'DRAFT',
        subjectId: request.subjectId ?? null,
        packageSessionIds:
            request.packageSessionIds ??
            (request.packageSessionId ? [request.packageSessionId] : []),
        scheduleMode: request.scheduleMode === 'RELATIVE' ? 'RELATIVE' : 'CALENDAR',
        defaultMissPolicy: request.defaultMissPolicy ?? 'EXPIRES',
        defaultCatchUpDays: request.defaultCatchUpDays ?? null,
        defaultCatchUpPercent: request.defaultCatchUpPercent ?? null,
        slots: bySortOrder(request.slots ?? []).map((slot) => slotToForm(slot as SlotLike)),
    };
}

// ── Form → API ───────────────────────────────────────────────────────────────

/** The form fields a task's payload is built from, as a comparable string. */
export function payloadSignature(item: ItemForm): string {
    switch (item.itemType) {
        case 'QUESTION_OF_DAY': {
            const q = item.question;
            const isMcq = q.format === 'MCQ';
            return JSON.stringify([
                item.itemType,
                q.format,
                q.prompt,
                isMcq ? filledOptions(q).map((o) => [o.id, o.text]) : null,
                isMcq ? q.correctOptionId : null,
                q.explanation,
            ]);
        }
        case 'POLL':
            return JSON.stringify([
                item.itemType,
                item.question.prompt,
                filledOptions(item.question).map((o) => [o.id, o.text]),
            ]);
        case 'COURSE_SLIDE':
            return JSON.stringify([item.itemType, item.slide ?? null]);
        case 'FLASHCARDS':
            return JSON.stringify([item.itemType, serializeFlashcardsPayload(item.flashcards)]);
        case 'QUIZ':
            return JSON.stringify([item.itemType, item.payloadJson ?? null]);
        default:
            return JSON.stringify([item.itemType]);
    }
}

/**
 * The payloadJson a task saves with. Unchanged since load → the loaded string,
 * verbatim. Changed → rebuilt on top of the loaded payload, so keys this form doesn't
 * know about survive.
 */
export function buildItemPayload(item: ItemForm): string | undefined {
    const origin = item.origin;
    if (origin && payloadSignature(item) === origin.signature) {
        return origin.payloadJson ?? undefined;
    }
    const base =
        origin && origin.itemType === item.itemType ? parseObject(origin.payloadJson) ?? {} : {};

    switch (item.itemType) {
        case 'QUESTION_OF_DAY':
        case 'POLL': {
            const isPoll = item.itemType === 'POLL';
            const q = item.question;
            const format: QuestionFormat = isPoll ? 'MCQ' : q.format;
            const baseOptions = new Map(
                (Array.isArray(base.options) ? (base.options as Record<string, unknown>[]) : [])
                    .filter((o) => o && typeof o === 'object')
                    .map((o) => [asText(o.id), o] as const)
            );
            const out: Record<string, unknown> = { ...base, format, prompt: q.prompt };
            if (format === 'MCQ') {
                // Only a multiple-choice question has options to show.
                out.options = filledOptions(q).map((o) => ({
                    ...(baseOptions.get(o.id) ?? {}),
                    id: o.id,
                    text: o.text,
                }));
            } else {
                delete out.options;
            }
            if (isPoll) {
                // A poll has no right answer.
                delete out.correctOptionId;
                delete out.explanation;
            } else if (format === 'MCQ') {
                out.correctOptionId = q.correctOptionId;
                out.explanation = q.explanation;
            } else {
                delete out.correctOptionId;
                out.explanation = q.explanation;
            }
            return JSON.stringify(out);
        }
        case 'COURSE_SLIDE':
            // The learner app needs the whole path to deep-link into the slide.
            return item.slide ? JSON.stringify(item.slide) : undefined;
        case 'FLASHCARDS':
            return serializeFlashcardsPayload(item.flashcards);
        case 'QUIZ':
            return item.payloadJson ?? undefined;
        default:
            return origin?.itemType === item.itemType ? origin.payloadJson ?? undefined : undefined;
    }
}

/**
 * sortOrder values that keep the list's current order while changing as few saved
 * values as possible: an entry keeps its own when it still sorts after the previous
 * one, otherwise it takes the next number up.
 */
export function resolveSortOrders(list: { sortOrder?: number | null }[]): number[] {
    let previous = -1;
    return list.map((entry) => {
        const own = entry.sortOrder;
        const next = own != null && own > previous ? own : previous + 1;
        previous = next;
        return next;
    });
}

function optional<T>(value: T | null | undefined | ''): T | undefined {
    return value === null || value === '' ? undefined : (value as T | undefined);
}

/** One task as the request the server expects. */
export function itemFormToRequest(item: ItemForm, sortOrder: number): EngagementItemRequest {
    const isDeck = item.itemType === 'FLASHCARDS';
    const title = item.title.trim();
    const storedTitle = item.origin?.title;
    return {
        ...(item.id ? { id: item.id } : {}),
        itemType: item.itemType,
        // An untouched title goes back exactly as stored (see ItemOrigin.title).
        title: storedTitle != null && storedTitle.trim() === title ? storedTitle : title,
        sortOrder,
        isRequired: item.isRequired,
        contentHtml: optional(item.contentHtml),
        slideId: optional(item.slideId),
        questionId: optional(item.questionId),
        assessmentId: optional(item.assessmentId),
        payloadJson: buildItemPayload(item),
        completionPoints: item.completionPoints,
        // The server forces these for a deck; sending the forced values keeps its
        // no-op check quiet.
        correctPoints: isDeck ? 0 : item.correctPoints,
        maxScore: isDeck ? item.flashcards.cards.length : optional(item.maxScore),
        hideResultUntilReveal: isDeck ? false : item.hideResultUntilReveal,
        missPolicy: optional(item.missPolicy),
        catchUpDays: optional(item.catchUpDays),
        catchUpPercent: optional(item.catchUpPercent),
    };
}

/** One day, with ALL of its tasks (the server retires any task a slot save leaves out). */
export function slotFormToRequest(
    slot: SlotForm,
    sortOrder?: number,
    scheduleMode: ScheduleMode = 'CALENDAR'
): EngagementSlotRequest {
    const itemOrders = resolveSortOrders(slot.items);
    return {
        ...(slot.id ? { id: slot.id } : {}),
        title: optional(slot.title.trim()),
        startDate: slot.startDate,
        endDate: optional(slot.endDate),
        startTime: slot.startTime,
        endTime: slot.endTime,
        dowMask: slot.dowMask > 0 ? slot.dowMask : undefined,
        ...(scheduleMode === 'RELATIVE' ? relativeDays(slot) : {}),
        revealTime: optional(slot.revealTime),
        notifyTime: optional(slot.notifyTime),
        sortOrder: sortOrder ?? optional(slot.sortOrder),
        items: slot.items.map((item, index) => itemFormToRequest(item, itemOrders[index]!)),
    };
}

/** The whole plan as a create or update request. */
export function formToRequest(form: ComposerForm): EngagementPlanRequest {
    const slotOrders = resolveSortOrders(form.slots);
    const description = form.description.trim();
    const request: EngagementPlanRequest = {
        title: form.title.trim(),
        // On an update the server skips a missing description, so a cleared one is sent
        // as '' (or the old text would stay). A new plan simply leaves it out.
        description: form.id ? description : optional(description),
        subjectId: optional(form.subjectId),
        status: form.status,
        // Only a new plan picks its mode; the server refuses a change on update.
        ...(form.id ? {} : { scheduleMode: form.scheduleMode }),
        defaultMissPolicy: form.defaultMissPolicy,
        defaultCatchUpDays: optional(form.defaultCatchUpDays),
        defaultCatchUpPercent: optional(form.defaultCatchUpPercent),
        slots: form.slots.map((slot, index) =>
            slotFormToRequest(slot, slotOrders[index], form.scheduleMode)
        ),
    };
    if (form.id) {
        if (form.packageSessionId) request.packageSessionId = form.packageSessionId;
    } else {
        request.packageSessionIds = form.packageSessionIds;
    }
    return request;
}

// ── Guards and error helpers ─────────────────────────────────────────────────

/**
 * True when saving this task would change what learners were graded against: its type,
 * question format, correct option or set of option ids. The server rejects such a save
 * once anyone has answered, so the composer confirms first (or blocks) when
 * `completedCount > 0`.
 */
export function isGradingRelevantChange(item: ItemForm): boolean {
    const origin = item.origin;
    if (!origin || !item.id) return false;
    if (origin.itemType !== item.itemType) return true;
    if (item.itemType !== 'QUESTION_OF_DAY' && item.itemType !== 'POLL') return false;
    const before = parseObject(origin.payloadJson);
    const after = parseObject(buildItemPayload(item));
    const format = (p: Record<string, unknown> | null) =>
        asText(p?.format).trim().toUpperCase() || 'MCQ';
    const key = (p: Record<string, unknown> | null) => asText(p?.correctOptionId) || null;
    const ids = (p: Record<string, unknown> | null) =>
        (Array.isArray(p?.options) ? (p.options as Record<string, unknown>[]) : [])
            .map((o) => asText(o?.id))
            .filter(Boolean)
            .sort()
            .join('|');
    return (
        format(before) !== format(after) || key(before) !== key(after) || ids(before) !== ids(after)
    );
}

export interface FlatFormError {
    /** Dotted RHF path, e.g. "slots.1.items.3.question.options". */
    path: string;
    /** An i18n key (engagement namespace) or a server-mapped message. */
    message: string;
}

/**
 * Every error in a react-hook-form `errors` tree, in form order, for the footer's error
 * summary and "go to first error". Works on any nested object/array error tree.
 */
export function flattenFormErrors(errors: unknown, prefix = ''): FlatFormError[] {
    const out: FlatFormError[] = [];
    if (!errors || typeof errors !== 'object') return out;
    const node = errors as Record<string, unknown>;
    if (typeof node.message === 'string' && node.message && typeof node.type === 'string') {
        out.push({ path: prefix, message: node.message });
    }
    // Object.keys lists an array's indexes in order, then any `root` error on it.
    const skip = new Set(['ref', 'message', 'type', 'types']);
    const keys = Object.keys(node).filter((key) => !skip.has(key));
    for (const key of keys) {
        const child = node[key];
        if (child && typeof child === 'object') {
            out.push(...flattenFormErrors(child, prefix ? `${prefix}.${key}` : key));
        }
    }
    return out;
}

/** How many errors sit under a subtree (a day's or a task's badge). */
export function countFormErrors(errors: unknown): number {
    return flattenFormErrors(errors).length;
}

/** Validate a deck on its own (the flashcards editor's imperative validate()). */
export function validateDeck(deck: FlashcardsDeck) {
    return flashcardsDeckSchema.safeParse(deck);
}
