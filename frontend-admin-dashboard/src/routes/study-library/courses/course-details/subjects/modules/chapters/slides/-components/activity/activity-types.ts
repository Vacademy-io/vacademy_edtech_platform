import {
    newFlashcardsDeck,
    parseFlashcardsPayload,
    serializeFlashcardsPayload,
    type FlashcardsDeck,
} from '@/routes/engagement/-components/flashcards/flashcards-schema';

/**
 * Flashcards, Poll and Game slides: DOCUMENT slides whose `document_slide.data` (draft)
 * and `published_data` (live) hold JSON, like Discussion and Spreadsheet. Drafts,
 * publish, copy, move and drip need nothing new.
 *
 * - FLASHCARDS: the same `flashcards/v1` payload a daily-engagement Flashcards task uses,
 *   so a deck moves between a course and a daily task unchanged.
 * - POLL: `{question, options: [{id, text}], settings: {results, allowChange}}`. The
 *   server (SlideActivityService) records votes and enforces the settings.
 * - GAME: `{html, maxScore, instructions}`. The page reports
 *   `vacademy:complete {score, maxScore}`; the server clamps to maxScore and keeps the best.
 */
export const FLASHCARDS_DOC_TYPE = 'FLASHCARDS';
export const POLL_DOC_TYPE = 'POLL';
export const GAME_DOC_TYPE = 'GAME';

export const ACTIVITY_DOC_TYPES: ReadonlySet<string> = new Set([
    FLASHCARDS_DOC_TYPE,
    POLL_DOC_TYPE,
    GAME_DOC_TYPE,
]);

export function isActivityDocType(type: string | null | undefined): boolean {
    return !!type && ACTIVITY_DOC_TYPES.has(type);
}

/** English fallback name, for the save toasts that name the slide type. */
export function activityTypeName(type: string): string {
    return type === FLASHCARDS_DOC_TYPE ? 'Flashcards' : type === POLL_DOC_TYPE ? 'Poll' : 'Game';
}

// ── flashcards ───────────────────────────────────────────────────────────────

export function parseFlashcardsSlideData(json: string | null | undefined): FlashcardsDeck {
    return parseFlashcardsPayload(json) ?? newFlashcardsDeck();
}

export function serializeFlashcardsSlideData(deck: FlashcardsDeck): string {
    return serializeFlashcardsPayload(deck);
}

export function createDefaultFlashcardsDataJson(): string {
    return serializeFlashcardsSlideData(newFlashcardsDeck());
}

// ── poll ─────────────────────────────────────────────────────────────────────

export type PollResultsVisibility = 'AFTER_VOTE' | 'ALWAYS' | 'TEACHER_ONLY';

export interface PollOption {
    id: string;
    text: string;
}

export interface PollSlideData {
    question: string;
    options: PollOption[];
    settings: { results: PollResultsVisibility; allowChange: boolean };
}

export const POLL_LIMITS = {
    minOptions: 2,
    maxOptions: 8,
    questionMax: 500,
    optionMax: 200,
} as const;

const RESULTS: PollResultsVisibility[] = ['AFTER_VOTE', 'ALWAYS', 'TEACHER_ONLY'];

export function newPollOptionId(taken: Iterable<string>): string {
    const used = new Set(taken);
    for (let i = 0; i < 26; i++) {
        const id = String.fromCharCode(97 + i);
        if (!used.has(id)) return id;
    }
    let n = 1;
    while (used.has(`o${n}`)) n++;
    return `o${n}`;
}

export function createDefaultPollData(): PollSlideData {
    return {
        question: '',
        options: [
            { id: 'a', text: '' },
            { id: 'b', text: '' },
        ],
        settings: { results: 'AFTER_VOTE', allowChange: false },
    };
}

export function parsePollData(json: string | null | undefined): PollSlideData {
    const d = createDefaultPollData();
    if (!json) return d;
    try {
        const raw = JSON.parse(json) as Partial<PollSlideData> | null;
        if (!raw || typeof raw !== 'object') return d;
        const options: PollOption[] = [];
        const seen = new Set<string>();
        for (const o of Array.isArray(raw.options) ? raw.options : []) {
            if (!o || typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue;
            seen.add(o.id);
            options.push({ id: o.id, text: typeof o.text === 'string' ? o.text : '' });
        }
        const results = RESULTS.includes(raw.settings?.results as PollResultsVisibility)
            ? (raw.settings!.results as PollResultsVisibility)
            : d.settings.results;
        return {
            question: typeof raw.question === 'string' ? raw.question : '',
            options: options.length > 0 ? options : d.options,
            settings: { results, allowChange: raw.settings?.allowChange === true },
        };
    } catch {
        return d;
    }
}

export function serializePollData(data: PollSlideData): string {
    return JSON.stringify({
        question: data.question.trim().slice(0, POLL_LIMITS.questionMax),
        options: data.options.map((o) => ({
            id: o.id,
            text: o.text.slice(0, POLL_LIMITS.optionMax),
        })),
        settings: data.settings,
    });
}

/** What is wrong with the poll, as i18n keys (slideActivity ns); empty = ready to publish. */
export function pollProblems(data: PollSlideData): string[] {
    const out: string[] = [];
    if (!data.question.trim()) out.push('poll.errors.question');
    const filled = data.options.filter((o) => o.text.trim());
    if (filled.length < POLL_LIMITS.minOptions) out.push('poll.errors.options');
    const texts = filled.map((o) => o.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) out.push('poll.errors.duplicate');
    return out;
}

// ── game ─────────────────────────────────────────────────────────────────────

export interface GameSlideData {
    html: string;
    /** The top score the page can report; the server caps scores at it. Null = none named. */
    maxScore: number | null;
    instructions: string;
}

export const GAME_LIMITS = {
    maxBytes: 2 * 1024 * 1024,
    maxScore: 1000,
    instructionsMax: 500,
} as const;

export function createDefaultGameData(): GameSlideData {
    return { html: '', maxScore: null, instructions: '' };
}

export function parseGameData(json: string | null | undefined): GameSlideData {
    const d = createDefaultGameData();
    if (!json) return d;
    try {
        const raw = JSON.parse(json) as Partial<GameSlideData> | null;
        if (!raw || typeof raw !== 'object') return d;
        const max = Number(raw.maxScore);
        return {
            html: typeof raw.html === 'string' ? raw.html : '',
            maxScore:
                Number.isFinite(max) && max > 0
                    ? Math.min(GAME_LIMITS.maxScore, Math.round(max))
                    : null,
            instructions: typeof raw.instructions === 'string' ? raw.instructions : '',
        };
    } catch {
        return d;
    }
}

export function serializeGameData(data: GameSlideData): string {
    return JSON.stringify({
        html: data.html,
        maxScore: data.maxScore,
        instructions: data.instructions.trim().slice(0, GAME_LIMITS.instructionsMax),
    });
}

/** Whether the page reports a result (the platform can only score pages that do). */
export function gameReportsScore(html: string): boolean {
    return html.includes('vacademy:complete');
}
