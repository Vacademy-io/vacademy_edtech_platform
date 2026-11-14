import { CheckCircle, Minus, Prohibit, Question, XCircle, type Icon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { StatusChip } from '@/components/design-system/status-chips';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';
import type { QuizLearnerStatus, QuizQuestionDifficulty } from '../../-types/quiz-results-types';

const NAMESPACE = 'studyLibraryQuizResultsShared';

/**
 * `formatRelative` / `formatDateTime` / `questionTypeLabel` below are plain
 * exported functions (not components/hooks) consumed from several sibling
 * files outside a render tree in places, so they can't rely on
 * `useTranslation`. Fall back to the shared i18next singleton directly —
 * this namespace is also the one `useTranslation` loads for the components
 * in this file, so both stay in sync.
 */
const globalT: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

/* -------------------------------------------------------------------------- */
/* Formatters                                                                  */
/* -------------------------------------------------------------------------- */

/** Percentages render with at most one decimal; nothing measured renders as an em dash. */
export const formatPercent = (value: number | null | undefined): string =>
    value === null || value === undefined ? '—' : `${Math.round(value * 10) / 10}%`;

export const formatNumber = (value: number | null | undefined): string =>
    value === null || value === undefined ? '—' : value.toLocaleString(i18n.language);

/** "1h 4m" / "6m 05s" / "42s" — mirrors the Pulse tab so durations read the same everywhere. */
export const formatDuration = (totalSeconds: number | null | undefined): string => {
    if (totalSeconds === null || totalSeconds === undefined) return '—';
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${rest.toString().padStart(2, '0')}s`;
    return `${rest}s`;
};

/** Absolute date + time in the admin's own zone; the API sends epoch millis. */
export const formatDateTime = (epochMillis: number | null | undefined): string => {
    if (!epochMillis) return '—';
    return new Date(epochMillis).toLocaleString(i18n.language, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
};

/** "3 days ago" for the at-a-glance recency column; falls back to the absolute date. */
export const formatRelative = (epochMillis: number | null | undefined): string => {
    if (!epochMillis) return globalT('never');
    const days = Math.floor((Date.now() - epochMillis) / 86_400_000);
    if (days <= 0) return globalT('today');
    if (days === 1) return globalT('yesterday');
    if (days < 30) return globalT('daysAgo', { count: days });
    return formatDateTime(epochMillis).split(',')[0] ?? '—';
};

export const initialsOf = (name: string | null | undefined): string => {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')).toUpperCase();
};

/* -------------------------------------------------------------------------- */
/* Score tone                                                                  */
/* -------------------------------------------------------------------------- */

export type ScoreTone = 'strong' | 'fair' | 'weak' | 'neutral' | 'none';

/**
 * A score band, used for text and meter fills.
 *
 * Colour is never the only signal anywhere it is applied: every meter carries its own
 * numeric label. The design system's status ramp cannot separate three categories for
 * colour-blind readers (its danger and warning steps sit 5.5 ΔE apart under deuteranopia),
 * so nothing in this tab asks colour alone to carry meaning.
 */
export const scoreToneOf = (
    percent: number | null | undefined,
    passMark?: number | null
): ScoreTone => {
    if (percent === null || percent === undefined) return 'none';
    const strong = passMark ?? 75;
    const fair = passMark != null ? passMark * 0.6 : 45;
    if (percent >= strong) return 'strong';
    if (percent >= fair) return 'fair';
    return 'weak';
};

const TONE_TEXT: Record<ScoreTone, string> = {
    strong: 'text-success-700',
    fair: 'text-warning-700',
    weak: 'text-danger-600',
    // For measures that are not a score — participation, coverage — where a
    // green/amber/red reading would imply a judgement the number does not carry.
    neutral: 'text-neutral-700',
    none: 'text-neutral-400',
};

const TONE_FILL: Record<ScoreTone, string> = {
    strong: 'bg-success-600',
    fair: 'bg-warning-600',
    weak: 'bg-danger-600',
    neutral: 'bg-info-500',
    none: 'bg-neutral-300',
};

/** Maps a stored question type to something a teacher reads, not an enum name. */
const QUESTION_TYPE_KEY: Record<string, string> = {
    MCQS: 'questionType.singleChoice',
    MCQM: 'questionType.multipleChoice',
    TRUE_FALSE: 'questionType.trueFalse',
    NUMERIC: 'questionType.numeric',
    ONE_WORD: 'questionType.oneWord',
    LONG_ANSWER: 'questionType.longAnswer',
};

export const questionTypeLabel = (type: string | null | undefined): string => {
    if (!type) return '';
    const key = QUESTION_TYPE_KEY[type];
    return key ? globalT(key) : type.replace(/_/g, ' ').toLowerCase();
};

export const scoreTextClass = (tone: ScoreTone): string => TONE_TEXT[tone];

/* -------------------------------------------------------------------------- */
/* Building blocks                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A KPI tile: the headline number, what it counts, and the qualifier that stops it
 * being misread. Not a chart — a single value has no shape worth plotting.
 */
export function StatTile({
    label,
    value,
    hint,
    accent = 'bg-primary-500',
    icon: IconComponent,
}: {
    label: string;
    value: string;
    hint?: string;
    accent?: string;
    icon?: Icon;
}) {
    return (
        <div className="relative overflow-hidden rounded-md border border-neutral-200 bg-white p-3 shadow-sm">
            <span className={cn('absolute inset-y-0 left-0 w-1', accent)} aria-hidden="true" />
            <div className="flex items-start justify-between gap-2 pl-1">
                <div className="min-w-0">
                    <p className="truncate text-caption font-semibold uppercase tracking-wide text-neutral-500">
                        {label}
                    </p>
                    <p className="mt-1 text-h3-semibold tabular-nums text-neutral-700">{value}</p>
                </div>
                {IconComponent && (
                    <IconComponent
                        className="mt-0.5 size-5 shrink-0 text-neutral-300"
                        aria-hidden="true"
                    />
                )}
            </div>
            {hint && <p className="mt-1 truncate pl-1 text-caption text-neutral-400">{hint}</p>}
        </div>
    );
}

/**
 * A labelled horizontal meter. The number is always rendered beside the bar, so the
 * fill colour is reinforcement rather than the only way to read the value.
 */
export function ScoreMeter({
    percent,
    tone,
    label,
    subLabel,
    className,
}: {
    percent: number | null | undefined;
    tone?: ScoreTone;
    label?: string;
    subLabel?: string;
    className?: string;
}) {
    const resolvedTone = tone ?? scoreToneOf(percent);
    const width = Math.max(0, Math.min(100, percent ?? 0));
    return (
        <div className={cn('flex min-w-0 flex-col gap-1', className)}>
            <div className="flex items-baseline justify-between gap-2">
                <span
                    className={cn('text-body font-semibold tabular-nums', TONE_TEXT[resolvedTone])}
                >
                    {label ?? formatPercent(percent)}
                </span>
                {subLabel && (
                    <span className="shrink-0 text-caption text-neutral-400">{subLabel}</span>
                )}
            </div>
            <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100"
                role="img"
                aria-label={`${label ?? formatPercent(percent)}${subLabel ? ` (${subLabel})` : ''}`}
            >
                <div
                    className={cn(
                        'h-full rounded-full transition-all duration-200',
                        TONE_FILL[resolvedTone]
                    )}
                    /* The one dynamic value on the page: a data-driven bar length has no
                       Tailwind token, and an arbitrary class per percent is worse. */
                    style={{ width: `${width}%` }}
                />
            </div>
        </div>
    );
}

const LEARNER_STATUS_KEY: Record<QuizLearnerStatus, string> = {
    PASSED: 'learnerStatus.passed',
    FAILED: 'learnerStatus.failed',
    COMPLETED: 'learnerStatus.completed',
    PARTIAL: 'learnerStatus.partlyDone',
    NOT_ATTEMPTED: 'learnerStatus.notAttempted',
};

const LEARNER_STATUS_TONE: Record<QuizLearnerStatus, 'SUCCESS' | 'DANGER' | 'WARNING' | 'INFO'> = {
    PASSED: 'SUCCESS',
    FAILED: 'DANGER',
    COMPLETED: 'SUCCESS',
    PARTIAL: 'WARNING',
    NOT_ATTEMPTED: 'INFO',
};

export function LearnerStatusChip({ status }: { status: QuizLearnerStatus }) {
    const { t } = useTranslation('studyLibraryQuizResultsShared');
    // Unknown statuses would otherwise render an empty cell — label the raw value instead.
    const key = LEARNER_STATUS_KEY[status];
    const label = key ? t(key) : status;
    const tone = LEARNER_STATUS_TONE[status] ?? 'INFO';
    return <StatusChip text={label} textSize="text-caption" status={tone} showIcon={false} />;
}

const DIFFICULTY_KEY: Record<QuizQuestionDifficulty, string> = {
    EASY: 'difficulty.wellUnderstood',
    MODERATE: 'difficulty.mixed',
    HARD: 'difficulty.struggling',
    CRITICAL: 'difficulty.needsReteaching',
};

const DIFFICULTY_CLASS: Record<QuizQuestionDifficulty, string> = {
    EASY: 'border-success-400 bg-success-50 text-success-700',
    MODERATE: 'border-warning-400 bg-warning-50 text-warning-700',
    HARD: 'border-danger-400 bg-danger-50 text-danger-600',
    CRITICAL: 'border-danger-400 bg-danger-100 text-danger-700',
};

const DIFFICULTY_ICON: Record<QuizQuestionDifficulty, Icon> = {
    EASY: CheckCircle,
    MODERATE: Minus,
    HARD: XCircle,
    CRITICAL: Prohibit,
};

const DIFFICULTY_TONE: Record<QuizQuestionDifficulty, ScoreTone> = {
    EASY: 'strong',
    MODERATE: 'fair',
    HARD: 'weak',
    CRITICAL: 'weak',
};

/** Bar tone for a question's accuracy; the difficulty chip beside it carries the words. */
export const difficultyTone = (difficulty: QuizQuestionDifficulty | null): ScoreTone =>
    difficulty ? DIFFICULTY_TONE[difficulty] : 'none';

/** Difficulty always ships as icon + words, so it never depends on colour vision. */
export function DifficultyChip({ difficulty }: { difficulty: QuizQuestionDifficulty | null }) {
    const { t } = useTranslation('studyLibraryQuizResultsShared');
    if (!difficulty) {
        return (
            <span className="inline-flex w-fit items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-caption text-neutral-500">
                <Question className="size-3.5" aria-hidden="true" />
                {t('noResponses')}
            </span>
        );
    }
    const IconComponent = DIFFICULTY_ICON[difficulty];
    return (
        <span
            className={cn(
                'inline-flex w-fit items-center gap-1 rounded-md border px-2 py-0.5 text-caption font-medium',
                DIFFICULTY_CLASS[difficulty]
            )}
        >
            <IconComponent className="size-3.5" aria-hidden="true" />
            {t(DIFFICULTY_KEY[difficulty])}
        </span>
    );
}

/** Shared empty / error / no-batch block so every view of the tab reads the same. */
export function QuizResultsMessage({
    tone = 'neutral',
    title,
    subtitle,
    action,
}: {
    tone?: 'neutral' | 'danger';
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-neutral-200 bg-white px-4 py-12 text-center">
            <p
                className={cn(
                    'text-body font-medium',
                    tone === 'danger' ? 'text-danger-600' : 'text-neutral-600'
                )}
            >
                {title}
            </p>
            {subtitle && <p className="max-w-md text-caption text-neutral-400">{subtitle}</p>}
            {action}
        </div>
    );
}
