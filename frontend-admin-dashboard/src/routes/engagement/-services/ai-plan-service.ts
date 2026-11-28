import { isAxiosError } from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import type { EngagementItemType, EngagementSlotRequest } from '../-types/types';

/**
 * AI planner: drafts a whole engagement plan for review.
 *
 * Nothing here publishes. The draft comes back in the composer's own slot shape and
 * is saved through the normal engagement API once the teacher has looked at it.
 *
 * Drafting runs as a background JOB when the AI service has the jobs endpoints
 * (start → poll → result, like the HTML-document generator): the teacher can close
 * the dialog and the draft keeps being written. Against an AI service without them,
 * `startAiPlanJob` resolves to null and the caller falls back to the synchronous
 * `POST /draft`.
 */

const ROOT = `${AI_SERVICE_BASE_URL}/engagement/plan`;

/** The react-query key of the institute's credit balance (header chip, cost lines). */
export const AI_CREDITS_QUERY_KEY = ['GET_AI_CREDITS'] as const;

export interface AiPlanMix {
    question_of_day: boolean;
    text_question: boolean;
    poll: boolean;
    reading: boolean;
    /**
     * Native FLASHCARDS decks (replaces `game`). Servers before the flashcards planner
     * ignore the field (pydantic drops unknown keys).
     */
    flashcards?: boolean;
    /**
     * @deprecated Legacy AI flashcard deck rendered as a GAME page. The wizard no
     * longer sends it; `flashcards` replaces it.
     */
    game?: boolean;
}

export type AiPlanKind = keyof Required<Omit<AiPlanMix, 'game'>>;

export interface AiPlanBrief {
    title?: string;
    topic?: string;
    audience?: string;
    language: string;
    difficulty: 'easy' | 'medium' | 'hard';
    start_date: string;
    /** Calendar days from `start_date` the plan spans (1–31); `weekdays` thins it. */
    days: number;
    per_day_items: number;
    start_time: string;
    end_time: string;
    reveal_time?: string;
    notify_time?: string;
    completion_points: number;
    correct_points: number;
    mix: AiPlanMix;
    grounding_texts: { title?: string; text: string }[];
    kb_id?: string;
    /**
     * Weekdays the plan runs on inside the span, ISO numbers (1 = Monday … 7 = Sunday).
     * Absent = every day.
     */
    weekdays?: number[];
    /**
     * The exact run dates (yyyy-MM-dd, institute-local) the wizard computed from its span
     * and weekday chips. A service that reads them drafts exactly these dates (they win
     * over days/weekdays); an older one ignores the field.
     */
    dates?: string[];
    /** Regenerate one task of this type instead of a plan. */
    single_item_type?: string;
    /** The rejected task's title, so the replacement covers a different angle. */
    avoid_title?: string;
}

export interface AiDraftCounts {
    days: number;
    items: number;
}

export interface AiPlanDraft {
    title: string;
    slots: EngagementSlotRequest[];
    model: string;
    days_planned: number;
    items_planned: number;
    grounded: boolean;
    /** What the brief asked for, when the server reports it. */
    requested?: AiDraftCounts | null;
    /** What came back after the server dropped unusable tasks. */
    delivered?: AiDraftCounts | null;
    /** Dates (yyyy-MM-dd) that came back with fewer tasks than asked for. */
    shortDates?: string[];
    /** Dates that came back with no tasks at all (the day is missing from `slots`). */
    missingDates?: string[];
    /** Tasks the server dropped as unusable. */
    droppedItems?: number;
}

/** The usual draft's price (a week at 2 a day); used when nothing better is known. */
export const DRAFT_CREDITS = 10;

/**
 * A draft's price when the rate card can't be read: base 3 + 0.5 per task requested,
 * mirroring tool_cost_estimator's engagement_plan default (unit "questions").
 */
export function estimateDraftCredits(tasks: number): number {
    return Math.ceil(3 + 0.5 * Math.max(0, tasks));
}
/** Per generated picture; mirrors html_document_image. */
export const IMAGE_CREDITS = 2;
/** Regenerating one task; mirrors engagement_item. */
export const ITEM_CREDITS = 2;

/**
 * Idempotency keys are minted ONCE per attempt by the caller and reused on retry.
 * A key generated inside this function would be fresh on every call, so a retry
 * after a timeout would be billed as a second draft.
 */
export function newIdempotencyKey(prefix: string): string {
    const rand = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now()}-${rand}`;
}

function withIdentity<T extends object>(body: T, idempotencyKey: string) {
    return { ...body, institute_id: getInstituteId(), idempotency_key: idempotencyKey };
}

// ── Reading the server's draft ───────────────────────────────────────────────

function asCount(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function readCounts(
    raw: Record<string, unknown>,
    nested: string,
    daysKey: string,
    itemsKey: string
): AiDraftCounts | null {
    const obj = raw[nested];
    if (obj && typeof obj === 'object') {
        const o = obj as Record<string, unknown>;
        const days = asCount(o.days);
        const items = asCount(o.items ?? o.tasks);
        if (days != null && items != null) return { days, items };
    }
    const days = asCount(raw[daysKey]);
    const items = asCount(raw[itemsKey]);
    return days != null && items != null ? { days, items } : null;
}

function readDates(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((d): d is string => typeof d === 'string') : [];
}

/** A draft as the server sent it, with the requested/delivered counts read. */
export function normaliseDraft(raw: unknown): AiPlanDraft | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (!Array.isArray(r.slots)) return null;
    const slots = r.slots as EngagementSlotRequest[];
    const items = slots.reduce((n, s) => n + (s.items?.length ?? 0), 0);
    return {
        title: typeof r.title === 'string' ? r.title : '',
        slots,
        model: typeof r.model === 'string' ? r.model : '',
        days_planned: asCount(r.days_planned) ?? slots.length,
        items_planned: asCount(r.items_planned) ?? items,
        grounded: Boolean(r.grounded),
        requested: readCounts(r, 'requested', 'days_requested', 'items_requested'),
        delivered:
            readCounts(r, 'delivered', 'days_delivered', 'items_delivered') ??
            readCounts(r, 'delivered', 'days_planned', 'items_planned'),
        shortDates: readDates(r.short_dates),
        missingDates: readDates(r.missing_dates),
        droppedItems: asCount(r.dropped_items) ?? 0,
    };
}

/** Days and tasks actually in a draft. */
export function draftCounts(draft: Pick<AiPlanDraft, 'slots'>): AiDraftCounts {
    return {
        days: draft.slots.length,
        items: draft.slots.reduce((n, s) => n + (s.items?.length ?? 0), 0),
    };
}

// ── Synchronous draft (and single-task regenerate) ───────────────────────────

export async function draftAiPlan(
    brief: AiPlanBrief,
    idempotencyKey: string,
    options: { signal?: AbortSignal } = {}
): Promise<AiPlanDraft> {
    const { data } = await authenticatedAxiosInstance.post<unknown>(
        `${ROOT}/draft`,
        withIdentity(brief, idempotencyKey),
        { signal: options.signal }
    );
    const draft = normaliseDraft(data);
    if (!draft) throw new Error('The AI service returned an unreadable draft.');
    return draft;
}

export async function illustrateReading(
    title: string,
    contentHtml: string,
    idempotencyKey: string,
    maxImages = 2
): Promise<{ content_html: string; images_generated: number }> {
    const { data } = await authenticatedAxiosInstance.post<{
        content_html: string;
        images_generated: number;
    }>(`${ROOT}/illustrate`, {
        institute_id: getInstituteId(),
        title,
        content_html: contentHtml,
        max_images: maxImages,
        idempotency_key: idempotencyKey,
    });
    return data;
}

/** How many image placeholders a drafted reading carries. */
export function countImagePlaceholders(html: string | undefined | null): number {
    if (!html) return 0;
    return (html.match(/data-img-prompt=/g) ?? []).length;
}

const PLACEHOLDER_IMG = /<img\b[^>]*\bdata-img-prompt\s*=[^>]*>/gi;

/**
 * A reading's picture slots that were never filled, removed. The AI marks where a
 * picture would help with `<img data-img-prompt>` (src "placeholder.png" or none); only
 * "Add pictures" turns them into real images, so any left at save time would reach
 * learners as a broken image. A slot the picture pass filled has a real src and stays.
 */
export function stripImagePlaceholders(html: string): string {
    if (!html || !html.includes('data-img-prompt')) return html;
    return html.replace(PLACEHOLDER_IMG, (tag) => {
        const src = /\ssrc\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2]?.trim() ?? '';
        return src && src !== 'placeholder.png' ? tag : '';
    });
}

/** A plan request with every unfilled picture slot removed (see stripImagePlaceholders). */
export function withoutImagePlaceholders<T extends { slots?: EngagementSlotRequest[] }>(
    plan: T
): T {
    return {
        ...plan,
        slots: plan.slots?.map((slot) => ({
            ...slot,
            items: slot.items?.map((item) =>
                typeof item.contentHtml === 'string' && item.contentHtml.includes('data-img-prompt')
                    ? { ...item, contentHtml: stripImagePlaceholders(item.contentHtml) }
                    : item
            ),
        })),
    };
}

/**
 * The `single_item_type` that regenerates a task of the same kind: a written question
 * stays written, a deck stays a deck. Null for a type the planner can't draft.
 */
export function singleItemTypeFor(
    itemType: EngagementItemType,
    questionFormat?: string | null
): string | null {
    switch (itemType) {
        case 'QUESTION_OF_DAY': {
            const format = (questionFormat ?? 'MCQ').toUpperCase();
            if (format === 'TEXT') return 'TEXT_QUESTION';
            // The planner never drafts upload questions; a written one is the closest.
            if (format === 'UPLOAD') return 'TEXT_QUESTION';
            return 'QUESTION_OF_DAY';
        }
        case 'POLL':
        case 'READING_HTML':
        case 'VISUAL_NOTE':
        case 'FLASHCARDS':
            return itemType;
        case 'GAME':
            // A legacy AI deck saved as a game comes back as a native deck.
            return 'FLASHCARDS';
        default:
            return null;
    }
}

/** The mix that asks for exactly one kind (a regenerate must not change the type). */
export function mixForSingle(single: string): AiPlanMix {
    return {
        question_of_day: single === 'QUESTION_OF_DAY',
        text_question: single === 'TEXT_QUESTION',
        poll: single === 'POLL',
        reading: single === 'READING_HTML' || single === 'VISUAL_NOTE',
        flashcards: single === 'FLASHCARDS',
        game: false,
    };
}

// ── Background jobs ──────────────────────────────────────────────────────────

export type AiPlanJobStatus = 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';

export interface AiPlanJobView {
    taskId: string;
    status: AiPlanJobStatus;
    /** Days drafted so far and the total, when the server reports per-day progress. */
    daysDone: number | null;
    daysTotal: number | null;
    /** A short server phase label (not shown raw; used only to tell phases apart). */
    phase: string | null;
    draft: AiPlanDraft | null;
    error: string | null;
    elapsedSeconds: number | null;
    /** Credits the server charged for this job, when it reports them. */
    creditsCharged: number | null;
    /** Whether the finished job was billed (false for failed/cancelled jobs); null = unknown. */
    charged: boolean | null;
}

function readStatus(raw: unknown): AiPlanJobStatus {
    const s = String(raw ?? '').toUpperCase();
    if (s === 'COMPLETED' || s === 'DONE' || s === 'READY' || s === 'SUCCESS') return 'READY';
    if (s === 'FAILED' || s === 'ERROR') return 'FAILED';
    if (s === 'CANCELLED' || s === 'CANCELED') return 'CANCELLED';
    if (s === 'INTERRUPTED' || s === 'STALE') return 'INTERRUPTED';
    return 'RUNNING';
}

/**
 * A job poll payload in the shape the wizard uses. Tolerant on purpose: the result can
 * arrive as `result`, `draft` or the top-level fields, and progress as
 * `progress.{days_done, days_total}` or flat `days_done` / `days_total`.
 */
export function normaliseJobView(raw: unknown): AiPlanJobView | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const taskId = String(r.task_id ?? r.taskId ?? r.id ?? '');
    if (!taskId) return null;
    const progress =
        r.progress && typeof r.progress === 'object' ? (r.progress as Record<string, unknown>) : {};
    const pick = (...keys: string[]) => {
        for (const key of keys) {
            const fromProgress = asCount(progress[key]);
            if (fromProgress != null) return fromProgress;
            const flat = asCount(r[key]);
            if (flat != null) return flat;
        }
        return null;
    };
    const status = readStatus(r.status);
    const draft =
        normaliseDraft(r.result) ??
        normaliseDraft(r.draft) ??
        (status === 'READY' ? normaliseDraft(r) : null);
    const phase = progress.phase ?? r.phase;
    const error = r.error ?? r.detail;
    return {
        taskId,
        status,
        daysDone: pick('days_done', 'daysDone', 'day'),
        daysTotal: pick('days_total', 'daysTotal', 'total_days'),
        phase: typeof phase === 'string' && phase ? phase : null,
        draft,
        error: typeof error === 'string' && error ? error : null,
        elapsedSeconds: asCount(r.elapsed_seconds),
        creditsCharged: asCount(r.credits_charged ?? r.credits),
        charged: typeof r.charged === 'boolean' ? r.charged : null,
    };
}

/** True when the AI service has no jobs endpoint (an older deploy): fall back to /draft. */
export function isMissingEndpoint(error: unknown): boolean {
    return (
        isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 405)
    );
}

/**
 * Start drafting in the background. Resolves to null when this AI service has no jobs
 * endpoint, so the caller drafts synchronously instead. Auth, validation and credit
 * errors (401/400/402/422) still throw here, before anything is charged.
 */
export async function startAiPlanJob(
    brief: AiPlanBrief,
    idempotencyKey: string
): Promise<AiPlanJobView | null> {
    try {
        const { data } = await authenticatedAxiosInstance.post<unknown>(
            `${ROOT}/draft/jobs`,
            withIdentity(brief, idempotencyKey)
        );
        const view = normaliseJobView(data);
        if (!view) throw new Error('The AI service did not return a job id.');
        return view;
    } catch (error) {
        if (isMissingEndpoint(error)) return null;
        throw error;
    }
}

export async function getAiPlanJob(taskId: string): Promise<AiPlanJobView> {
    const { data } = await authenticatedAxiosInstance.get<unknown>(
        `${ROOT}/draft/jobs/${encodeURIComponent(taskId)}`
    );
    const view = normaliseJobView(data);
    if (!view) throw new Error('Unreadable job status.');
    return view;
}

/** Stop a running job. The server stops before billing, so a cancelled draft is free. */
export async function cancelAiPlanJob(taskId: string): Promise<AiPlanJobView | null> {
    const { data } = await authenticatedAxiosInstance.post<unknown>(
        `${ROOT}/draft/jobs/${encodeURIComponent(taskId)}/cancel`
    );
    return normaliseJobView(data);
}

/** The wizard picked up (or dismissed) the result: stop offering it. Best effort. */
export async function ackAiPlanJob(taskId: string): Promise<void> {
    try {
        await authenticatedAxiosInstance.post(
            `${ROOT}/draft/jobs/${encodeURIComponent(taskId)}/ack`
        );
    } catch {
        // Only a courtesy for the server's re-attach list.
    }
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * What to show for a failed AI call: the server's own sentence when it sent one (they
 * are written for teachers: "Insufficient credits…", "you weren't charged"), else an
 * i18n key. Timeouts, gateway errors and dropped connections map to
 * `wizard.errors.timeout` ("The AI took too long — try fewer days"), not to the topic.
 */
export function aiErrorMessage(
    error: unknown,
    fallbackKey: string
): { message: string | null; key: string | null; status: number | null } {
    if (isAxiosError(error)) {
        const status = error.response?.status ?? null;
        const data = error.response?.data as { detail?: unknown; message?: unknown } | undefined;
        const detail =
            typeof data?.detail === 'string'
                ? data.detail
                : typeof data?.message === 'string'
                  ? data.message
                  : null;
        const timedOut =
            error.code === 'ECONNABORTED' ||
            error.code === 'ETIMEDOUT' ||
            status === 504 ||
            status === 408 ||
            (!error.response && error.code !== 'ERR_CANCELED');
        if (timedOut) return { message: null, key: 'wizard.errors.timeout', status };
        if (detail) return { message: detail, key: null, status };
        if (status != null && status >= 500) {
            return { message: null, key: 'wizard.errors.timeout', status };
        }
        return { message: null, key: fallbackKey, status };
    }
    return { message: null, key: fallbackKey, status: null };
}

/** True for an aborted request (the teacher pressed Cancel on a synchronous draft). */
export function isAbortError(error: unknown): boolean {
    return (
        (isAxiosError(error) && error.code === 'ERR_CANCELED') ||
        (error instanceof DOMException && error.name === 'AbortError')
    );
}
