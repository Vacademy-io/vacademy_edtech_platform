import {
    BookOpenText,
    Cards,
    ChartBar,
    GameController,
    GraduationCap,
    ImageSquare,
    ListChecks,
    Question,
    type Icon,
} from '@phosphor-icons/react';
import type { EngagementItemType } from '../-types/types';

/**
 * One place for how each task type looks: its label, hint, icon and accent.
 *
 * The labels are i18n keys in the `engagement` namespace (`t(meta.labelKey)`), never
 * English. Accents are literal design-token classes (no template literals, so Tailwind
 * sees every class), and every type has one, so no screen has to fall back to a raw
 * enum or a grey dot.
 */

export interface EngagementTypeAccent {
    /** A small solid marker: a dot or a bar. */
    dot: string;
    /** A tinted chip or icon well: background plus readable text. */
    soft: string;
    /** A border that matches the tint. */
    border: string;
}

export interface EngagementTypeMeta {
    type: EngagementItemType;
    /** `composer.types.<TYPE>` */
    labelKey: string;
    /** `composer.types.<TYPE>_hint` */
    hintKey: string;
    icon: Icon;
    accent: EngagementTypeAccent;
    /** True when the server can grade a learner's answer (an MCQ question of the day). */
    gradable: boolean;
    /** True when the composer offers this type. QUIZ exists server-side but is not authored. */
    authorable: boolean;
}

export const ENGAGEMENT_TYPE_META: Record<EngagementItemType, EngagementTypeMeta> = {
    READING_HTML: {
        type: 'READING_HTML',
        labelKey: 'composer.types.READING_HTML',
        hintKey: 'composer.types.READING_HTML_hint',
        icon: BookOpenText,
        accent: { dot: 'bg-info-500', soft: 'bg-info-50 text-info-600', border: 'border-info-200' },
        gradable: false,
        authorable: true,
    },
    VISUAL_NOTE: {
        type: 'VISUAL_NOTE',
        labelKey: 'composer.types.VISUAL_NOTE',
        hintKey: 'composer.types.VISUAL_NOTE_hint',
        icon: ImageSquare,
        accent: {
            dot: 'bg-primary-300',
            soft: 'bg-primary-50 text-primary-600',
            border: 'border-primary-200',
        },
        gradable: false,
        authorable: true,
    },
    QUESTION_OF_DAY: {
        type: 'QUESTION_OF_DAY',
        labelKey: 'composer.types.QUESTION_OF_DAY',
        hintKey: 'composer.types.QUESTION_OF_DAY_hint',
        icon: Question,
        accent: {
            dot: 'bg-warning-500',
            soft: 'bg-warning-50 text-warning-700',
            border: 'border-warning-200',
        },
        gradable: true,
        authorable: true,
    },
    FLASHCARDS: {
        type: 'FLASHCARDS',
        labelKey: 'composer.types.FLASHCARDS',
        hintKey: 'composer.types.FLASHCARDS_hint',
        icon: Cards,
        accent: {
            dot: 'bg-info-300',
            soft: 'bg-info-100 text-info-700',
            border: 'border-info-300',
        },
        gradable: false,
        authorable: true,
    },
    POLL: {
        type: 'POLL',
        labelKey: 'composer.types.POLL',
        hintKey: 'composer.types.POLL_hint',
        icon: ChartBar,
        accent: {
            dot: 'bg-primary-500',
            soft: 'bg-primary-100 text-primary-600',
            border: 'border-primary-300',
        },
        gradable: false,
        authorable: true,
    },
    GAME: {
        type: 'GAME',
        labelKey: 'composer.types.GAME',
        hintKey: 'composer.types.GAME_hint',
        icon: GameController,
        accent: {
            dot: 'bg-danger-400',
            soft: 'bg-danger-50 text-danger-600',
            border: 'border-danger-200',
        },
        gradable: false,
        authorable: true,
    },
    COURSE_SLIDE: {
        type: 'COURSE_SLIDE',
        labelKey: 'composer.types.COURSE_SLIDE',
        hintKey: 'composer.types.COURSE_SLIDE_hint',
        icon: GraduationCap,
        accent: {
            dot: 'bg-success-300',
            soft: 'bg-success-50 text-success-700',
            border: 'border-success-200',
        },
        gradable: false,
        authorable: true,
    },
    QUIZ: {
        type: 'QUIZ',
        labelKey: 'composer.types.QUIZ',
        hintKey: 'composer.types.QUIZ_hint',
        icon: ListChecks,
        accent: {
            dot: 'bg-success-500',
            soft: 'bg-success-100 text-success-700',
            border: 'border-success-300',
        },
        gradable: true,
        authorable: false,
    },
};

/** Types in the order the composer offers them (FLASHCARDS right after the question). */
export const AUTHORING_TYPE_ORDER: EngagementItemType[] = [
    'READING_HTML',
    'VISUAL_NOTE',
    'QUESTION_OF_DAY',
    'FLASHCARDS',
    'GAME',
    'POLL',
    'COURSE_SLIDE',
];

/** Neutral stand-in for a type this build doesn't know (a newer server). */
const UNKNOWN_META: Omit<EngagementTypeMeta, 'type'> = {
    labelKey: 'composer.types.UNKNOWN',
    hintKey: 'composer.types.UNKNOWN_hint',
    icon: ListChecks,
    accent: {
        dot: 'bg-neutral-400',
        soft: 'bg-neutral-100 text-neutral-600',
        border: 'border-neutral-200',
    },
    gradable: false,
    authorable: false,
};

export function isEngagementItemType(value: unknown): value is EngagementItemType {
    return (
        typeof value === 'string' &&
        Object.prototype.hasOwnProperty.call(ENGAGEMENT_TYPE_META, value)
    );
}

/** Meta for any type string, with a neutral fallback, so a raw enum never reaches the screen. */
export function typeMeta(type: string | null | undefined): EngagementTypeMeta {
    if (isEngagementItemType(type)) return ENGAGEMENT_TYPE_META[type];
    return { ...UNKNOWN_META, type: (type ?? 'QUIZ') as EngagementItemType };
}

/**
 * Whether the composer shows the Flashcards type. On by default; a build with
 * `VITE_ENGAGEMENT_FLASHCARDS=false` hides it. Existing FLASHCARDS tasks always render.
 */
export function isFlashcardsAuthoringEnabled(): boolean {
    const flag = (import.meta.env as Record<string, string | boolean | undefined>)
        .VITE_ENGAGEMENT_FLASHCARDS;
    return !(flag === false || flag === 'false' || flag === '0');
}

/** The types a new task can be, in order, honouring the flashcards flag. */
export function authorableTypes(): EngagementItemType[] {
    return isFlashcardsAuthoringEnabled()
        ? AUTHORING_TYPE_ORDER
        : AUTHORING_TYPE_ORDER.filter((type) => type !== 'FLASHCARDS');
}

/** A question of the day graded by the server: MCQ with a key. TEXT and UPLOAD are read by the teacher. */
export function isGradedQuestion(
    type: string | null | undefined,
    format: string | null | undefined,
    correctOptionId: string | null | undefined
): boolean {
    return (
        type === 'QUESTION_OF_DAY' &&
        (format ?? 'MCQ').toUpperCase() === 'MCQ' &&
        Boolean(correctOptionId)
    );
}
