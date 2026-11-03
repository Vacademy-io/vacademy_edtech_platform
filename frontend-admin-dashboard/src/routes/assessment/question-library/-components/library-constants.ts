export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;

export const QUESTION_TYPES = [
    'MCQS',
    'MCQM',
    'TRUE_FALSE',
    'NUMERIC',
    'ONE_WORD',
    'LONG_ANSWER',
] as const;

export const PAGE_SIZE = 20;

/** Tree selections that are not topics. */
export const ALL_QUESTIONS = '__all__';
export const UNSORTED = '__unsorted__';

export const difficultyTone: Record<string, string> = {
    EASY: 'bg-success-50 text-success-600',
    MEDIUM: 'bg-warning-50 text-warning-600',
    HARD: 'bg-danger-50 text-danger-600',
};

/** Bar segment colours for the difficulty split. */
export const difficultyBar: Record<string, string> = {
    EASY: 'bg-success-400',
    MEDIUM: 'bg-warning-400',
    HARD: 'bg-danger-400',
};

/** Rich text arrives as HTML. Plain text for one-line summaries. */
export const plainText = (html: string | null | undefined): string =>
    (html ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
