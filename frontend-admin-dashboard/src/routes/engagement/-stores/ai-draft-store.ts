import { z } from 'zod';
import { create } from 'zustand';
import { toast } from 'sonner';
import i18next from 'i18next';
import { getInstituteId } from '@/constants/helper';
import type { EngagementPlanRequest, MissPolicy } from '../-types/types';
import type { BatchOption } from '../-components/BatchPickerDialog';
import {
    addDays,
    EVERY_DAY_MASK,
    instituteToday,
    isEveryDay,
    parseIsoDate,
    weekdayBit,
    WEEKDAY_BITS,
} from '../-utils/format';
import {
    ackAiPlanJob,
    aiErrorMessage,
    cancelAiPlanJob,
    DRAFT_CREDITS,
    draftAiPlan,
    draftCounts,
    getAiPlanJob,
    isAbortError,
    startAiPlanJob,
    type AiDraftCounts,
    type AiPlanBrief,
    type AiPlanDraft,
    type AiPlanJobStatus,
    type AiPlanKind,
} from '../-services/ai-plan-service';

/**
 * The AI planner's state, outside React so a draft outlives the dialog.
 *
 * - The brief model: `aiBriefSchema` (zod, messages are i18n keys) and the mappers from
 *   the brief to the AI request (`briefToRequest`, `briefRunDates`).
 * - The running JOB: started here and polled here, so closing the dialog (or leaving
 *   the page) keeps it going. When it lands while the wizard is hidden, a toast says the
 *   draft is ready and offers "Review" (which reopens a mounted wizard).
 * - The REVIEW: the draft the teacher is editing, mirrored to sessionStorage per
 *   institute so a reload or a closed dialog never loses paid work. The grounding is
 *   kept with it in its compact form (plain text, at most what the AI reads), so a
 *   retry or a "New version" after a reload is written from the same material.
 */

// ── Brief model ──────────────────────────────────────────────────────────────

/** The planner drafts at most this many days per plan (ai_service MAX_DAYS). */
export const MAX_AI_DAYS = 31;
export const MAX_AI_PER_DAY = 3;
/** Calendar span presets, in days. 1 = a single day. */
export const DURATION_PRESETS = [1, 7, 14, 30] as const;
/** The longest span the brief accepts, in calendar days (ai_service MAX_DAYS). */
export const MAX_SPAN_DAYS = MAX_AI_DAYS;

/** Task kinds the planner can draft, in the order the brief offers them. */
export const AI_KINDS: AiPlanKind[] = [
    'question_of_day',
    'text_question',
    'poll',
    'reading',
    'flashcards',
];

/**
 * Languages the brief offers. `value` is what the AI is told (English names); the label
 * comes from Intl.DisplayNames for `code`, or `wizard.languages.<value>` without one.
 */
export const AI_LANGUAGES: { value: string; code: string | null }[] = [
    { value: 'English', code: 'en' },
    { value: 'Hindi', code: 'hi' },
    { value: 'Hinglish', code: null },
    { value: 'Marathi', code: 'mr' },
    { value: 'Bengali', code: 'bn' },
    { value: 'Gujarati', code: 'gu' },
    { value: 'Punjabi', code: 'pa' },
    { value: 'Tamil', code: 'ta' },
    { value: 'Telugu', code: 'te' },
    { value: 'Kannada', code: 'kn' },
    { value: 'Malayalam', code: 'ml' },
    { value: 'Odia', code: 'or' },
    { value: 'Urdu', code: 'ur' },
    { value: 'Arabic', code: 'ar' },
    { value: 'French', code: 'fr' },
    { value: 'Spanish', code: 'es' },
    { value: 'German', code: 'de' },
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const kindsSchema = z.object({
    question_of_day: z.boolean(),
    text_question: z.boolean(),
    poll: z.boolean(),
    reading: z.boolean(),
    flashcards: z.boolean(),
});

const batchSchema = z.object({
    id: z.string(),
    label: z.string(),
    courseId: z.string().optional(),
    courseName: z.string().optional(),
});

export const aiBriefSchema = z
    .object({
        batches: z.array(batchSchema).min(1, 'wizard.errors.batch'),
        title: z.string().max(200, 'composer.errors.titleTooLong'),
        topic: z.string().max(4000, 'wizard.errors.topicTooLong'),
        /** The batch whose course the grounding chapters are read from. */
        groundingBatchId: z.string(),
        subjectId: z.string(),
        chapterIds: z.array(z.string()),
        startDate: z.string().refine((v) => parseIsoDate(v) !== null, 'composer.errors.date'),
        /** Calendar days the plan spans from the start date. */
        spanDays: z
            .number({ invalid_type_error: 'wizard.errors.span' })
            .int('wizard.errors.span')
            .min(1, 'wizard.errors.span')
            .max(MAX_SPAN_DAYS, 'wizard.errors.span'),
        customSpan: z.boolean(),
        /** Mon=1 … Sun=64; 0 or 127 = every day (the composer's dowMask). */
        dowMask: z.number().int().min(0).max(EVERY_DAY_MASK),
        perDay: z.number().int().min(1).max(MAX_AI_PER_DAY),
        kinds: kindsSchema,
        difficulty: z.enum(['easy', 'medium', 'hard']),
        language: z.string().min(1),
        startTime: z.string().regex(HHMM, 'composer.errors.timeFormat'),
        endTime: z.string().regex(HHMM, 'composer.errors.timeFormat'),
        revealTime: z.union([z.literal(''), z.string().regex(HHMM, 'composer.errors.timeFormat')]),
    })
    .superRefine((brief, ctx) => {
        const issue = (path: string, message: string) =>
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
        if (!brief.topic.trim() && brief.chapterIds.length === 0)
            issue('topic', 'wizard.errors.topic');
        if (!Object.values(brief.kinds).some(Boolean)) issue('kinds', 'wizard.errors.kinds');
        if (parseIsoDate(brief.startDate) && brief.startDate < instituteToday()) {
            issue('startDate', 'wizard.errors.pastStart');
        }
        if (
            HHMM.test(brief.startTime) &&
            HHMM.test(brief.endTime) &&
            brief.endTime <= brief.startTime
        ) {
            issue('endTime', 'composer.errors.time');
        }
        if (brief.revealTime && HHMM.test(brief.startTime) && brief.revealTime < brief.startTime) {
            issue('revealTime', 'composer.errors.revealBeforeOpen');
        }
        if (parseIsoDate(brief.startDate) && Number.isInteger(brief.spanDays)) {
            if (briefRunDates(brief).length === 0) issue('dowMask', 'wizard.errors.noDays');
        }
    });

export type AiBriefValues = z.infer<typeof aiBriefSchema>;
export type AiBriefKinds = z.infer<typeof kindsSchema>;

export function defaultAiBrief(options: { batches?: BatchOption[] } = {}): AiBriefValues {
    const batches = options.batches ?? [];
    return {
        batches,
        title: '',
        topic: '',
        groundingBatchId: batches[0]?.id ?? '',
        subjectId: '',
        chapterIds: [],
        startDate: instituteToday(),
        spanDays: 7,
        customSpan: false,
        dowMask: 0,
        perDay: 2,
        kinds: {
            question_of_day: true,
            text_question: false,
            poll: false,
            reading: true,
            flashcards: false,
        },
        difficulty: 'medium',
        language: 'English',
        startTime: '06:00',
        endTime: '20:00',
        revealTime: '20:00',
    };
}

/** The dates the plan runs on (institute-local): the span, thinned by the weekdays. */
export function briefRunDates(
    brief: Pick<AiBriefValues, 'startDate' | 'spanDays' | 'dowMask'>
): string[] {
    if (!parseIsoDate(brief.startDate)) return [];
    const span = Math.max(1, Math.min(MAX_SPAN_DAYS, Math.round(brief.spanDays) || 1));
    // A single day ignores the weekday filter: the teacher picked that date.
    if (span === 1) return [brief.startDate];
    const out: string[] = [];
    for (let i = 0; i < span; i++) {
        const iso = addDays(brief.startDate, i);
        if (isEveryDay(brief.dowMask) || (brief.dowMask & weekdayBit(iso)) !== 0) out.push(iso);
    }
    return out;
}

/** ISO weekday numbers (Mon = 1 … Sun = 7) of a dowMask; [] = every day. */
export function maskToIsoWeekdays(mask: number): number[] {
    if (isEveryDay(mask)) return [];
    return WEEKDAY_BITS.map((bit, index) => ((mask & bit) !== 0 ? index + 1 : 0)).filter(Boolean);
}

export interface GroundingText {
    title?: string;
    text: string;
}

/** The AI reads at most this much grounding text (ai_service MAX_GROUNDING_CHARS). */
export const MAX_GROUNDING_CHARS = 24_000;

function decodeEntities(text: string): string {
    if (!text.includes('&')) return text;
    if (typeof DOMParser !== 'undefined') {
        try {
            return (
                new DOMParser().parseFromString(text, 'text/html').documentElement.textContent ??
                text
            );
        } catch {
            // Fall through to the common entities.
        }
    }
    return text
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

/**
 * The grounding exactly as far as the AI reads it: tags stripped, whitespace collapsed
 * and cut at MAX_GROUNDING_CHARS in order, mirroring ai_service `assemble_grounding`.
 * What is sent is then small (never megabytes of slide HTML), and small enough to keep
 * with the draft, so a retry or a "New version" after a reload is still grounded.
 */
export function compactGrounding(texts: GroundingText[]): GroundingText[] {
    const out: GroundingText[] = [];
    let used = 0;
    for (const entry of texts) {
        const title = (entry.title ?? '').trim();
        const body = decodeEntities((entry.text ?? '').replace(/<[^>]+>/g, ' '))
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!body) continue;
        // The service reads each lesson as "## title\n" + text.
        const header = title ? title.length + 4 : 0;
        const chunk = header + body.length;
        if (used + chunk > MAX_GROUNDING_CHARS) {
            const remaining = MAX_GROUNDING_CHARS - used;
            if (remaining > 400) {
                out.push({ ...(title ? { title } : {}), text: body.slice(0, remaining - header) });
            }
            break;
        }
        out.push({ ...(title ? { title } : {}), text: body });
        used += chunk + 2;
    }
    return out;
}

/**
 * The brief as the AI service's request: `days` is the calendar span and `weekdays`
 * (ISO numbers) thins it, exactly as the service's plan_dates reads them. `dates` carries
 * the same run dates spelled out (institute-local), so the service drafts exactly the
 * dates the brief's "Runs on" line promised.
 */
export function briefToRequest(brief: AiBriefValues, grounding: GroundingText[]): AiPlanBrief {
    const span = Math.max(1, Math.min(MAX_SPAN_DAYS, Math.round(brief.spanDays) || 1));
    // A single day ignores the weekday filter: the teacher picked that date.
    const weekdays = span > 1 ? maskToIsoWeekdays(brief.dowMask) : [];
    return {
        title: brief.title.trim() || undefined,
        topic: brief.topic.trim() || undefined,
        language: brief.language,
        difficulty: brief.difficulty,
        start_date: brief.startDate,
        days: span,
        per_day_items: brief.perDay,
        start_time: brief.startTime,
        end_time: brief.endTime,
        reveal_time: brief.revealTime || undefined,
        notify_time: brief.startTime,
        completion_points: 10,
        correct_points: 20,
        mix: { ...brief.kinds, game: false },
        grounding_texts: grounding,
        ...(weekdays.length > 0 ? { weekdays } : {}),
        dates: briefRunDates(brief),
    };
}

/** What a brief asks for: its run dates × tasks per day. */
export function briefRequestedCounts(brief: AiBriefValues): AiDraftCounts {
    const days = briefRunDates(brief).length;
    return { days, items: days * brief.perDay };
}

// ── Plan rules (review "Rules" row defaults) ─────────────────────────────────

export const AI_PLAN_DEFAULT_RULES: {
    defaultMissPolicy: MissPolicy;
    defaultCatchUpDays: number;
    defaultCatchUpPercent: number;
} = { defaultMissPolicy: 'CATCH_UP_REDUCED', defaultCatchUpDays: 2, defaultCatchUpPercent: 50 };

/** A draft as the plan request the review edits (and the composer can open). */
export function draftToPlan(draft: AiPlanDraft, brief: AiBriefValues): EngagementPlanRequest {
    return {
        title: brief.title.trim() || draft.title || '',
        description: brief.topic.trim() || undefined,
        status: 'DRAFT',
        packageSessionIds: brief.batches.map((b) => b.id),
        ...AI_PLAN_DEFAULT_RULES,
        slots: draft.slots.map((slot, index) => ({ ...slot, sortOrder: slot.sortOrder ?? index })),
    };
}

// ── Store ────────────────────────────────────────────────────────────────────

export interface AiDraftJob {
    /** `job` = server background job (polled); `sync` = one long POST /draft. */
    mode: 'job' | 'sync';
    taskId: string | null;
    status: AiPlanJobStatus;
    startedAt: number;
    daysDone: number | null;
    daysTotal: number;
    /** The server's own sentence, when it sent one. */
    error: string | null;
    /** An engagement i18n key, when there is no server sentence. */
    errorKey: string | null;
    brief: AiBriefValues;
    idempotencyKey: string;
    /** Estimated credits for this draft (shown on cancel/discard). */
    credits: number;
}

export interface AiDraftReview {
    savedAt: number;
    /** The draft as it stands, edits included. */
    plan: EngagementPlanRequest;
    brief: AiBriefValues;
    creditsSpent: number;
    requested: AiDraftCounts;
    delivered: AiDraftCounts;
    grounded: boolean;
    /** Dates that came back with fewer tasks than asked (the rail marks them). */
    shortDates?: string[];
    /** Dates that came back with no tasks at all. */
    missingDates?: string[];
}

export interface AiDraftOpenRequest {
    seq: number;
    step: 'review' | 'generating';
}

interface AiDraftState {
    hydratedFor: string | null;
    job: AiDraftJob | null;
    review: AiDraftReview | null;
    /** The last draft's grounding, for single-task regenerates. Memory only. */
    grounding: GroundingText[];
    /** Bumped when something asks a mounted wizard to open ("Review" on the toast). */
    openRequest: AiDraftOpenRequest | null;
    /** A wizard is open and showing the job, so no toast is needed when it lands. */
    visible: boolean;
    /** Wizards currently mounted (the toast only offers "Review" when one can open). */
    mounted: number;
    /** Bumped after every paid call, so mounted UIs refresh the credit balance. */
    creditsSeq: number;

    hydrate: () => void;
    startDraft: (args: {
        brief: AiBriefValues;
        grounding: GroundingText[];
        idempotencyKey: string;
        credits: number;
    }) => Promise<void>;
    cancelJob: () => Promise<void>;
    /** Forget a finished/failed/cancelled job (back to the brief). */
    dismissJob: () => void;
    setReviewPlan: (plan: EngagementPlanRequest) => void;
    addCredits: (credits: number) => void;
    discardReview: () => void;
    requestOpen: (step: AiDraftOpenRequest['step']) => void;
    setVisible: (visible: boolean) => void;
    mount: () => () => void;
}

// Survives only this tab; per institute.
const STORAGE_V2 = 'engagement.aiDraft.v2.';
/** Wave 1's key: a reviewed draft only. Migrated once on hydrate, then removed. */
const STORAGE_V1 = 'engagement.aiDraft.';
const POLL_MS = 2500;
/** Consecutive failed polls before the job is reported as interrupted. */
const MAX_POLL_FAILURES = 6;

function instituteKey(): string {
    return getInstituteId() ?? 'unknown';
}

interface Persisted {
    v: 2;
    job: AiDraftJob | null;
    review: AiDraftReview | null;
    /** The compacted grounding (≤ MAX_GROUNDING_CHARS), for retries and new versions. */
    grounding?: GroundingText[];
}

function readJson<T>(key: string): T | null {
    try {
        const raw = sessionStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

function persist(state: Pick<AiDraftState, 'job' | 'review' | 'grounding'>) {
    const key = STORAGE_V2 + instituteKey();
    try {
        if (!state.job && !state.review) sessionStorage.removeItem(key);
        else {
            const value: Persisted = {
                v: 2,
                job: state.job,
                review: state.review,
                grounding: state.grounding,
            };
            sessionStorage.setItem(key, JSON.stringify(value));
        }
    } catch {
        // Storage full or blocked: the draft still lives in memory until the tab closes.
    }
}

interface StoredV1 {
    v: 1;
    savedAt: number;
    draft: AiPlanDraft;
    creditsSpent: number;
    batches: BatchOption[];
    topic: string;
    startTime: string;
    endTime: string;
    revealTime: string;
    language: string;
    difficulty: AiBriefValues['difficulty'];
    mix: { question_of_day?: boolean; text_question?: boolean; poll?: boolean; reading?: boolean };
}

/** A wave-1 stored draft as a v2 review, so nobody loses a paid draft over the upgrade. */
function migrateV1(): AiDraftReview | null {
    const key = STORAGE_V1 + instituteKey();
    const old = readJson<StoredV1>(key);
    try {
        sessionStorage.removeItem(key);
    } catch {
        // Nothing to remove.
    }
    if (!old || old.v !== 1 || !Array.isArray(old.draft?.slots)) return null;
    const base = defaultAiBrief({ batches: old.batches ?? [] });
    const brief: AiBriefValues = {
        ...base,
        topic: old.topic ?? '',
        startTime: old.startTime || base.startTime,
        endTime: old.endTime || base.endTime,
        revealTime: old.revealTime ?? base.revealTime,
        language: old.language || base.language,
        difficulty: old.difficulty ?? base.difficulty,
        kinds: {
            question_of_day: Boolean(old.mix?.question_of_day),
            text_question: Boolean(old.mix?.text_question),
            poll: Boolean(old.mix?.poll),
            reading: Boolean(old.mix?.reading),
            flashcards: false,
        },
    };
    const counts = draftCounts(old.draft);
    return {
        savedAt: old.savedAt || Date.now(),
        plan: draftToPlan(old.draft, brief),
        brief,
        creditsSpent: old.creditsSpent ?? DRAFT_CREDITS,
        requested: counts,
        delivered: counts,
        grounded: Boolean(old.draft.grounded),
    };
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollFailures = 0;
let syncAbort: AbortController | null = null;

function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    pollFailures = 0;
}

function tr(key: string, options?: Record<string, unknown>): string {
    return i18next.t(key, { ns: 'engagement', ...options }) as string;
}

export const useAiDraftStore = create<AiDraftState>((set, get) => {
    /** Commit a state change and mirror job + review to sessionStorage. */
    function commit(patch: Partial<AiDraftState>) {
        set(patch);
        const { job, review, grounding } = get();
        persist({ job, review, grounding });
    }

    function patchJob(patch: Partial<AiDraftJob>) {
        const job = get().job;
        if (!job) return;
        commit({ job: { ...job, ...patch } });
    }

    /** A draft landed: it becomes the review; the job is done. */
    /**
     * `credits` = what the server says it charged; `charged === false` means it billed
     * nothing (a billing hiccup never takes the draft away); otherwise the estimate.
     */
    function land(
        draft: AiPlanDraft,
        job: AiDraftJob,
        credits: number | null,
        charged: boolean | null = null
    ) {
        const requested = draft.requested ?? briefRequestedCounts(job.brief);
        const review: AiDraftReview = {
            savedAt: Date.now(),
            plan: draftToPlan(draft, job.brief),
            brief: job.brief,
            creditsSpent: charged === false ? 0 : credits ?? job.credits,
            requested,
            delivered: draft.delivered ?? draftCounts(draft),
            grounded: Boolean(draft.grounded),
            shortDates: draft.shortDates ?? [],
            missingDates: draft.missingDates ?? [],
        };
        const { visible, mounted, creditsSeq } = get();
        commit({ job: null, review, creditsSeq: creditsSeq + 1 });
        if (job.taskId) void ackAiPlanJob(job.taskId);
        if (!visible) {
            const canOpen = mounted > 0;
            toast.success(tr('wizard.toast.ready'), {
                description: canOpen
                    ? tr('wizard.toast.readyBody', { title: review.plan.title })
                    : tr('wizard.toast.readyElsewhere'),
                action: canOpen
                    ? {
                          label: tr('wizard.toast.review'),
                          onClick: () => get().requestOpen('review'),
                      }
                    : undefined,
                duration: 15_000,
            });
        }
    }

    function fail(error: unknown, fallbackKey: string) {
        const { message, key } = aiErrorMessage(error, fallbackKey);
        patchJob({ status: 'FAILED', error: message, errorKey: message ? null : key });
        if (!get().visible) {
            toast.error(tr('wizard.toast.failed'), {
                description: message ?? (key ? tr(key) : undefined),
            });
        }
    }

    async function pollOnce() {
        pollTimer = null;
        const job = get().job;
        if (!job || job.mode !== 'job' || !job.taskId || job.status !== 'RUNNING') return;
        try {
            const view = await getAiPlanJob(job.taskId);
            pollFailures = 0;
            const current = get().job;
            // Cancelled or replaced while the request was in flight.
            if (!current || current.taskId !== view.taskId || current.status !== 'RUNNING') return;
            if (view.status === 'READY') {
                if (view.draft && view.draft.slots.length > 0) {
                    land(view.draft, current, view.creditsCharged, view.charged);
                } else {
                    patchJob({ status: 'FAILED', error: null, errorKey: 'wizard.errors.empty' });
                }
                return;
            }
            if (view.status === 'RUNNING') {
                patchJob({
                    daysDone: view.daysDone ?? current.daysDone,
                    daysTotal: view.daysTotal ?? current.daysTotal,
                });
                pollTimer = setTimeout(() => void pollOnce(), POLL_MS);
                return;
            }
            patchJob({
                status: view.status,
                error: view.error,
                errorKey: view.error
                    ? null
                    : view.status === 'INTERRUPTED'
                      ? 'wizard.errors.interrupted'
                      : 'wizard.errors.draft',
            });
            if (view.status === 'FAILED' && !get().visible) {
                toast.error(tr('wizard.toast.failed'), { description: view.error ?? undefined });
            }
        } catch (error) {
            const status = aiErrorMessage(error, 'wizard.errors.draft').status;
            if (status === 404) {
                patchJob({ status: 'FAILED', error: null, errorKey: 'wizard.errors.jobLost' });
                return;
            }
            pollFailures += 1;
            if (pollFailures >= MAX_POLL_FAILURES) {
                patchJob({ status: 'INTERRUPTED', error: null, errorKey: 'wizard.errors.polling' });
                return;
            }
            pollTimer = setTimeout(() => void pollOnce(), POLL_MS * Math.min(4, pollFailures + 1));
        }
    }

    function ensurePolling() {
        const job = get().job;
        if (pollTimer || !job || job.mode !== 'job' || job.status !== 'RUNNING') return;
        pollTimer = setTimeout(() => void pollOnce(), 0);
    }

    return {
        hydratedFor: null,
        job: null,
        review: null,
        grounding: [],
        openRequest: null,
        visible: false,
        mounted: 0,
        creditsSeq: 0,

        hydrate() {
            const inst = instituteKey();
            if (get().hydratedFor === inst) {
                ensurePolling();
                return;
            }
            stopPolling();
            const stored = readJson<Persisted>(STORAGE_V2 + inst);
            let job = stored?.v === 2 ? stored.job : null;
            let review = stored?.v === 2 ? stored.review : null;
            const grounding =
                stored?.v === 2 && Array.isArray(stored.grounding) ? stored.grounding : [];
            if (!review) review = migrateV1();
            // A synchronous draft can't survive a reload: its request died with the page.
            // Nor can a job whose start request never answered (no id to poll).
            if (job && job.status === 'RUNNING' && (job.mode === 'sync' || !job.taskId)) {
                job = {
                    ...job,
                    status: 'INTERRUPTED',
                    error: null,
                    errorKey: 'wizard.errors.reloaded',
                };
            }
            set({ hydratedFor: inst, job, review, grounding });
            persist({ job, review, grounding });
            ensurePolling();
        },

        async startDraft({ brief, grounding: rawGrounding, idempotencyKey, credits }) {
            stopPolling();
            syncAbort?.abort();
            syncAbort = null;
            const grounding = compactGrounding(rawGrounding);
            const request = briefToRequest(brief, grounding);
            const runDays = Math.max(1, briefRequestedCounts(brief).days);
            const job: AiDraftJob = {
                mode: 'job',
                taskId: null,
                status: 'RUNNING',
                startedAt: Date.now(),
                daysDone: 0,
                daysTotal: runDays,
                error: null,
                errorKey: null,
                brief,
                idempotencyKey,
                credits,
            };
            commit({ job, grounding });
            try {
                const view = await startAiPlanJob(request, idempotencyKey);
                const now = get().job;
                // Replaced, or cancelled while the start request was in flight: never go on
                // to draft, and stop a job the server did start (it would be billed).
                if (!now || now.idempotencyKey !== idempotencyKey || now.status !== 'RUNNING') {
                    if (view && view.status === 'RUNNING') {
                        void cancelAiPlanJob(view.taskId).catch(() => undefined);
                    }
                    return;
                }
                if (view) {
                    patchJob({
                        taskId: view.taskId,
                        daysTotal: view.daysTotal || runDays,
                        daysDone: view.daysDone ?? 0,
                    });
                    if (view.status === 'READY' && view.draft) {
                        const current = get().job;
                        if (current) land(view.draft, current, view.creditsCharged, view.charged);
                        return;
                    }
                    ensurePolling();
                    return;
                }
                // No jobs endpoint on this AI service: one long synchronous call.
                patchJob({ mode: 'sync', daysDone: null });
                const abort = new AbortController();
                syncAbort = abort;
                const draft = await draftAiPlan(request, idempotencyKey, { signal: abort.signal });
                if (syncAbort === abort) syncAbort = null;
                const current = get().job;
                if (!current || current.idempotencyKey !== idempotencyKey) return;
                if (current.status !== 'RUNNING') return;
                land(draft, current, null);
            } catch (error) {
                if (isAbortError(error)) return;
                const current = get().job;
                if (!current || current.idempotencyKey !== idempotencyKey) return;
                if (current.status !== 'RUNNING') return;
                fail(error, 'wizard.errors.draft');
            }
        },

        async cancelJob() {
            const job = get().job;
            if (!job) return;
            stopPolling();
            if (job.mode === 'sync') {
                syncAbort?.abort();
                syncAbort = null;
                commit({
                    job: { ...job, status: 'CANCELLED', errorKey: 'wizard.job.cancelledSync' },
                });
                return;
            }
            const cancelled: AiDraftJob = {
                ...job,
                status: 'CANCELLED',
                errorKey: 'wizard.job.cancelledJob',
            };
            commit({ job: cancelled });
            if (!job.taskId) return;
            try {
                const view = await cancelAiPlanJob(job.taskId);
                // The draft finished before the cancel arrived: it was charged, so it is
                // kept and opened for review rather than thrown away.
                const current = get().job;
                if (
                    view?.status === 'READY' &&
                    view.draft &&
                    view.draft.slots.length > 0 &&
                    current?.idempotencyKey === job.idempotencyKey &&
                    current.status === 'CANCELLED'
                ) {
                    land(view.draft, current, view.creditsCharged, view.charged);
                }
            } catch {
                // The row may already be gone; the job simply stays cancelled here.
            }
        },

        dismissJob() {
            stopPolling();
            const job = get().job;
            if (job?.taskId && job.status !== 'RUNNING') void ackAiPlanJob(job.taskId);
            commit({ job: null });
        },

        setReviewPlan(plan) {
            const review = get().review;
            if (!review) return;
            commit({ review: { ...review, plan, savedAt: Date.now() } });
        },

        addCredits(credits) {
            const review = get().review;
            set({ creditsSeq: get().creditsSeq + 1 });
            if (!review || credits <= 0) return;
            commit({ review: { ...review, creditsSpent: review.creditsSpent + credits } });
        },

        discardReview() {
            const { job } = get();
            commit({ review: null, ...(job ? {} : { grounding: [] }) });
        },

        requestOpen(step) {
            set({ openRequest: { seq: (get().openRequest?.seq ?? 0) + 1, step } });
        },

        setVisible(visible) {
            if (get().visible !== visible) set({ visible });
        },

        mount() {
            set({ mounted: get().mounted + 1 });
            return () => set({ mounted: Math.max(0, get().mounted - 1) });
        },
    };
});

/** Test seam: stop any poller and forget everything (not persisted). */
export function resetAiDraftStoreForTests() {
    stopPolling();
    syncAbort = null;
    useAiDraftStore.setState({
        hydratedFor: null,
        job: null,
        review: null,
        grounding: [],
        openRequest: null,
        visible: false,
        mounted: 0,
        creditsSeq: 0,
    });
}
