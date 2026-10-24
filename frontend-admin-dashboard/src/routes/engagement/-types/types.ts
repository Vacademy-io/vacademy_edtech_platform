/**
 * Daily engagement authoring types.
 * Backend: admin_core_service /engagement/admin/v1/**
 * Design doc: docs/engagement/DAILY_ENGAGEMENT_PLATFORM.md
 */

export type EngagementItemType =
    | 'READING_HTML'
    | 'VISUAL_NOTE'
    | 'QUESTION_OF_DAY'
    | 'QUIZ'
    | 'GAME'
    | 'POLL'
    /** An existing slide from the course library. */
    | 'COURSE_SLIDE'
    /**
     * A deck of cards the learner flips and self-checks. Completion points only; the
     * server forces correctPoints 0, hideResultUntilReveal false and maxScore = cards.
     * payloadJson is {@link FlashcardsPayload}.
     */
    | 'FLASHCARDS';

/**
 * How a plan's days are dated. CALENDAR: fixed dates for everyone. RELATIVE: "Day N"
 * counted from each learner's batch enrolment (Day 1 = the join day; learners already
 * in the batch when the plan is published start on the publish day).
 */
export type ScheduleMode = 'CALENDAR' | 'RELATIVE';

export type PlanStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'DELETED';

/**
 * Where a plan stands today, derived by the server for the list (`todayState`).
 * Older servers don't send it; `planLifecycle()` in -utils/format.ts derives the same
 * value on the client from the status and dates.
 */
export type PlanLifecycle = 'DRAFT' | 'UPCOMING' | 'RUNNING' | 'ENDED' | 'ARCHIVED';

/** What happens to an item a learner never opened while it was live. */
export type MissPolicy = 'EXPIRES' | 'CATCH_UP_FULL' | 'CATCH_UP_REDUCED';

/** How a question of the day is answered. */
export type QuestionFormat = 'MCQ' | 'TEXT' | 'UPLOAD';

export interface EngagementItemRequest {
    id?: string;
    itemType: EngagementItemType;
    title: string;
    sortOrder?: number;
    isRequired?: boolean;
    contentHtml?: string;
    slideId?: string;
    questionId?: string;
    assessmentId?: string;
    /**
     * QUESTION_OF_DAY carries its options AND answer key here:
     * {"prompt":"…","options":[{"id":"a","text":"…"}],"correctOptionId":"a","explanation":"…"}
     * The key never reaches a learner — the server strips it until reveal time.
     */
    payloadJson?: string;
    completionPoints?: number;
    correctPoints?: number;
    maxScore?: number;
    /** Withhold correctness (and the bonus) until the slot's reveal time. */
    hideResultUntilReveal?: boolean;
    missPolicy?: MissPolicy;
    catchUpDays?: number;
    catchUpPercent?: number;
}

export interface EngagementSlotRequest {
    id?: string;
    title?: string;
    /** yyyy-MM-dd, institute-local. */
    startDate: string;
    endDate?: string;
    /** HH:mm, institute-local wall clock. */
    startTime: string;
    endTime: string;
    /** Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64. Null/0 = every day. */
    dowMask?: number;
    /** RELATIVE plans: 1-based first and last day after joining (endDay defaults to startDay). */
    startDay?: number;
    endDay?: number;
    revealTime?: string;
    notifyTime?: string;
    sortOrder?: number;
    items?: EngagementItemRequest[];
}

export interface EngagementPlanRequest {
    title: string;
    description?: string;
    packageSessionId?: string;
    /** Create the same plan for several batches; the server writes one plan per id. */
    packageSessionIds?: string[];
    subjectId?: string;
    status?: PlanStatus;
    /** Set on create only; the server refuses a change. Missing = CALENDAR. */
    scheduleMode?: ScheduleMode;
    defaultMissPolicy?: MissPolicy;
    defaultCatchUpDays?: number;
    defaultCatchUpPercent?: number;
    slots?: EngagementSlotRequest[];
}

export interface EngagementItemDTO {
    id: string;
    slotId: string;
    planId: string;
    packageSessionId: string;
    itemType: EngagementItemType;
    title: string;
    version: number;
    sortOrder: number;
    isRequired: boolean;
    contentHtml?: string | null;
    slideId?: string | null;
    questionId?: string | null;
    assessmentId?: string | null;
    payloadJson?: string | null;
    completionPoints: number;
    correctPoints: number;
    maxScore?: number | null;
    hideResultUntilReveal?: boolean | null;
    completedCount?: number | null;
    /**
     * Per-task miss policy overrides. The item request always carried these, but older
     * servers don't return them; when absent the plan defaults apply.
     */
    missPolicy?: MissPolicy | null;
    catchUpDays?: number | null;
    catchUpPercent?: number | null;
    /** Learners enrolled in the batch, so a row can read "1 / 2 learners". Newer servers only. */
    learnerCount?: number | null;
}

export interface EngagementSlotDTO {
    id: string;
    planId: string;
    title?: string | null;
    startDate: string;
    endDate?: string | null;
    startTime: string;
    endTime: string;
    dowMask?: number | null;
    /** RELATIVE plans only; startDate/endDate are then placeholder dates, never shown. */
    startDay?: number | null;
    endDay?: number | null;
    revealTime?: string | null;
    notifyTime?: string | null;
    sortOrder: number;
    status: string;
    items: EngagementItemDTO[];
    /** Learners enrolled in the plan's batch (the denominator for completedCount). Newer servers only. */
    learnerCount?: number | null;
}

export interface EngagementPlanDTO {
    id: string;
    instituteId: string;
    packageSessionId: string;
    title: string;
    description?: string | null;
    subjectId?: string | null;
    status: PlanStatus;
    /** Snapshot of the institute zone at creation — windows resolve against this. */
    timezone: string;
    /** Missing on older servers = CALENDAR. */
    scheduleMode?: ScheduleMode | null;
    /** When the plan was first published: Day 1 for learners already in the batch. */
    publishedAt?: string | null;
    defaultMissPolicy: MissPolicy;
    defaultCatchUpDays?: number | null;
    defaultCatchUpPercent?: number | null;
    createdByUserId: string;
    createdAt?: string | null;
    slots?: EngagementSlotDTO[];

    // Summary, filled by `/plan/list` and `GET /plan/{id}` on newer servers. Every field
    // is optional: older servers send none of them, and the list never carries slots, so
    // the card falls back to what it has (see planLifecycle / planDateRange).
    /** "Course · Session · Level" of the plan's batch. */
    packageSessionLabel?: string | null;
    /** The plan's local "today" (yyyy-MM-dd) that todayState and todayTaskCount use. */
    today?: string | null;
    /** First and last day any active slot runs (yyyy-MM-dd, weekday mask applied). */
    firstDate?: string | null;
    lastDate?: string | null;
    /** Distinct dates with at least one active slot. */
    dayCount?: number | null;
    /** RELATIVE plans: the last "Day N" any slot reaches (firstDate/lastDate are then null). */
    lastDay?: number | null;
    /** Active slots (days or recurring schedules). */
    slotCount?: number | null;
    /** Active tasks across every slot (a recurring slot's task counts once). */
    taskCount?: number | null;
    todayState?: PlanLifecycle | null;
    /** Tasks in the slots that run today. */
    todayTaskCount?: number | null;
    /** Active learners in the batch: the "of N" in "1 / 2 learners". */
    learnerCount?: number | null;
    /** Learners with any attempt on today's tasks. */
    todayStartedLearners?: number | null;
    /** Learners with a completion on today's tasks. */
    todayCompletedLearners?: number | null;
}

/** A stored status or a derived lifecycle, as `/plan/list?status=` accepts. */
export type PlanListStatus = PlanStatus | PlanLifecycle;

export type PlanListSort = 'CREATED' | 'START_DATE' | 'TITLE';

/** Query for `listPlans`. Every field is optional; with none the list behaves as it always did. */
export interface PlanListParams {
    packageSessionId?: string;
    /** One or several statuses/lifecycles (sent comma-separated), e.g. ['RUNNING', 'UPCOMING']. */
    status?: PlanListStatus | PlanListStatus[];
    /** Title or batch search. */
    q?: string;
    /** Server default CREATED (newest first). */
    sort?: PlanListSort;
    /** 0-based page. */
    page?: number;
    /** Default 20, server max 100. */
    size?: number;
}

export interface PlanListResult {
    plans: EngagementPlanDTO[];
    page: number;
    size: number;
    totalRows: number;
    totalPages: number;
    /**
     * False when the server ignored the query (an older build returning the plain list),
     * in which case the filter and paging were applied here on the client.
     */
    serverFiltered: boolean;
}

// ── Flashcards ────────────────────────────────────────────────────────────────

/** Schema tag of the only flashcards payload version. */
export const FLASHCARDS_SCHEMA = 'flashcards/v1';

export interface FlashcardCard {
    /** ^[a-z0-9_-]{1,24}$, unique within the deck, kept across edits. */
    id: string;
    /** Plain text, never HTML. 1–200 UTF-16 units. */
    front: string;
    /** Plain text. 1–500 UTF-16 units. */
    back: string;
    /** Optional, up to 150. */
    hint?: string;
}

/** `payloadJson` of a FLASHCARDS item. */
export interface FlashcardsPayload {
    schema: typeof FLASHCARDS_SCHEMA;
    cards: FlashcardCard[];
    settings: { shuffle: boolean };
}

export interface EngagementTrackingRow {
    userId: string;
    /** Hydrated from auth_service; null if that lookup failed. */
    fullName?: string | null;
    username?: string | null;
    email?: string | null;
    status: string;
    isCorrect?: boolean | null;
    score?: number | null;
    pointsAwarded: number;
    isLate: boolean;
    timeSpentMs?: number | null;
    completedAt?: string | null;
    textAnswer?: string | null;
    fileIds?: string[] | null;
    selectedOptionId?: string | null;
    /** The task's max score (games: the declared max; flashcards: the card count). Newer servers only. */
    maxScore?: number | null;
    /** First time the learner opened the task (the STARTED row). Newer servers only. */
    startedAt?: string | null;
}

/** Filter for the item tracking table. NOT_DONE rows are synthesized from the enrolment list. */
export type TrackingStatusFilter = 'ALL' | 'DONE' | 'NOT_DONE' | 'STARTED' | 'LATE';

export interface TrackingOptions {
    status?: TrackingStatusFilter;
}

export interface OptionCount {
    optionId: string;
    count: number;
}

/** How a learner is keeping up across a whole plan. */
export type LearnerClass = 'NOT_STARTED' | 'BEHIND' | 'ON_TRACK';

export interface LearnerProgress {
    userId: string;
    fullName?: string | null;
    username?: string | null;
    completed: number;
    correct: number;
    pointsEarned: number;
    missed: number;
    lastCompletedAt?: string | null;
    // Newer servers (one aggregate query) add these. When absent, the dialog falls back to
    // completed / missed.
    /** Tasks that have opened so far for this learner. */
    available?: number | null;
    /** Completed tasks (same as completed on newer servers). */
    done?: number | null;
    /** Past their window, not done, still catchable. */
    overdue?: number | null;
    class?: LearnerClass | null;
}

/** Completion for one scheduled day, for the completion-by-day chart. */
export interface PlanOverviewDay {
    /** yyyy-MM-dd, institute-local. */
    date: string;
    /** Tasks that ran that day. */
    tasks?: number | null;
    /** Learner-task completions that day. */
    completed?: number | null;
    /** Learner-task pairs that were available that day. */
    available?: number | null;
    /** completed / available, 0–1. */
    rate?: number | null;
}

export interface PlanOverview {
    planId: string;
    title: string;
    tasksClosed: number;
    tasksTotal: number;
    learners: number;
    learnersActive: number;
    learnersSlipping: number;
    rows: LearnerProgress[];
    // Newer servers only.
    notStarted?: number | null;
    behind?: number | null;
    onTrack?: number | null;
    days?: PlanOverviewDay[] | null;
    /** Server paging over rows; absent = every row was returned. */
    page?: number | null;
    pageSize?: number | null;
    totalRows?: number | null;
    totalPages?: number | null;
}

export interface PlanOverviewParams {
    page?: number;
    size?: number;
    /** Learner name search. */
    q?: string;
    /** Only NOT_STARTED and BEHIND learners. */
    needsAttention?: boolean;
}

export interface EngagementTrackingDTO {
    itemId: string;
    title: string;
    itemType: EngagementItemType;
    completedCount: number;
    correctCount: number;
    rows: EngagementTrackingRow[];
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
    // Newer servers only; the dialog falls back to completedCount when absent.
    /** Learners enrolled in the batch: the "of N" in "1 of 2". */
    enrolledCount?: number | null;
    /** MCQ and poll picks for the whole item (not just this page). */
    optionCounts?: OptionCount[] | null;
    /** Completed attempts the server could grade (MCQ with a key). */
    gradedCount?: number | null;
    /** Learners who opened the task but haven't finished it. */
    startedCount?: number | null;
    /** The status filter the rows were built with. */
    status?: TrackingStatusFilter | null;
}

/** One card's outcomes across every completed attempt (GET item/{id}/tracking/cards). */
export interface FlashcardCardStat {
    cardId: string;
    front: string;
    back: string;
    studied: number;
    gotIt: number;
    stillLearning: number;
    /** stillLearning / studied, 0–1. */
    stillLearningRate: number;
}

export interface FlashcardCardStatsDTO {
    cards: FlashcardCardStat[];
    /** Outcomes recorded against cards that are no longer in the deck. */
    removedOutcomes: number;
}
