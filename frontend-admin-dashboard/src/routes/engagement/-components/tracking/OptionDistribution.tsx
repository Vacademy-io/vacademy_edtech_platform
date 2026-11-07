import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Funnel } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { OptionCount, QuestionFormat } from '../../-types/types';
import { formatNumber, formatPercent } from '../../-utils/format';

/**
 * How a class answered a multiple-choice question or a poll: one bar per option, in
 * authored order, with the count and share of answers.
 *
 * - A poll's bars are the main content of its tracking dialog ("who voted what").
 * - An MCQ marks the correct option with a Check on a success token, so a wrong
 *   majority is obvious at a glance.
 * - Every bar is a toggle button: pressing it filters the learner table to the
 *   learners who picked that option.
 */

export interface QuestionOption {
    id: string;
    text: string;
}

/** The parts of a QUESTION_OF_DAY or POLL payload the tracking screens show. */
export interface QuestionPayload {
    prompt: string;
    options: QuestionOption[];
    correctOptionId: string | null;
    explanation: string;
    /** Null for a poll or an unreadable payload. Blank on a question means MCQ. */
    format: QuestionFormat | null;
}

const EMPTY_PAYLOAD: QuestionPayload = {
    prompt: '',
    options: [],
    correctOptionId: null,
    explanation: '',
    format: null,
};

function asText(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

/** Tags out, entities decoded, whitespace collapsed: prompts are plain text but old ones held HTML. */
export function plainText(value: string): string {
    if (!value) return '';
    if (!/[<&]/.test(value)) return value.trim();
    if (typeof DOMParser === 'undefined') return value.replace(/<[^>]*>/g, ' ').trim();
    const doc = new DOMParser().parseFromString(value, 'text/html');
    return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Reads a question or poll payload the way the server does: a blank format is MCQ,
 * case is ignored, and options without an id are dropped. Never throws.
 */
export function parseQuestionPayload(
    payloadJson: string | null | undefined,
    itemType?: string | null
): QuestionPayload {
    let raw: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(payloadJson || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_PAYLOAD;
        raw = parsed as Record<string, unknown>;
    } catch {
        return EMPTY_PAYLOAD;
    }
    const options: QuestionOption[] = [];
    const seen = new Set<string>();
    if (Array.isArray(raw.options)) {
        for (const entry of raw.options) {
            if (!entry || typeof entry !== 'object') continue;
            const option = entry as Record<string, unknown>;
            const id = asText(option.id).trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            options.push({ id, text: plainText(asText(option.text) || asText(option.label)) });
        }
    }
    const rawFormat = asText(raw.format).trim().toUpperCase();
    const format: QuestionFormat | null =
        itemType === 'POLL'
            ? null
            : rawFormat === 'TEXT' || rawFormat === 'UPLOAD'
              ? rawFormat
              : 'MCQ';
    return {
        prompt: plainText(asText(raw.prompt) || asText(raw.question)),
        options,
        correctOptionId: asText(raw.correctOptionId).trim() || null,
        explanation: plainText(asText(raw.explanation)),
        format,
    };
}

/** "A", "B", … "Z", then "27", "28": the letter learners saw next to each option. */
export function optionLetter(index: number): string {
    return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

export interface DistributionRow {
    id: string;
    /** "A", "B"… for authored options; empty for an option no longer in the question. */
    letter: string;
    /** Empty for a removed option (the caller shows a "Removed option" label). */
    text: string;
    count: number;
    /** count / all answers, 0–1; null when nobody has answered. */
    share: number | null;
    isCorrect: boolean;
    /** Picked by someone but no longer in the question (edited after answers came in). */
    removed: boolean;
}

/**
 * One row per authored option (0-count ones included), then any picked ids the
 * question no longer has. `counts` is the server's `optionCounts`; when absent, every
 * option reads 0.
 */
export function buildDistribution(
    options: QuestionOption[],
    counts: OptionCount[] | null | undefined,
    correctOptionId: string | null
): DistributionRow[] {
    const byId = new Map<string, number>();
    for (const entry of counts ?? []) {
        if (!entry?.optionId) continue;
        byId.set(entry.optionId, (byId.get(entry.optionId) ?? 0) + (Number(entry.count) || 0));
    }
    const total = Array.from(byId.values()).reduce((sum, n) => sum + n, 0);
    const share = (n: number) => (total > 0 ? n / total : null);
    const known = new Set(options.map((o) => o.id));
    const rows: DistributionRow[] = options.map((option, index) => {
        const count = byId.get(option.id) ?? 0;
        return {
            id: option.id,
            letter: optionLetter(index),
            text: option.text,
            count,
            share: share(count),
            isCorrect: option.id === correctOptionId,
            removed: false,
        };
    });
    for (const [id, count] of byId) {
        if (known.has(id) || count <= 0) continue;
        rows.push({
            id,
            letter: '',
            text: '',
            count,
            share: share(count),
            isCorrect: id === correctOptionId,
            removed: true,
        });
    }
    return rows;
}

export interface OptionDistributionProps {
    rows: DistributionRow[];
    /** 'poll' words the header as votes; 'mcq' as answers and marks the correct option. */
    kind: 'poll' | 'mcq';
    /** Learners who answered (completed attempts). */
    respondents: number;
    /** Learners in the batch; null on an older server (the header drops "of N"). */
    enrolled: number | null;
    /** The option the table is filtered to, if any. */
    selectedId?: string | null;
    /** Toggle the table filter; pressing the selected bar again clears it. */
    onSelect?: (optionId: string | null) => void;
    loading?: boolean;
    className?: string;
}

export function OptionDistribution({
    rows,
    kind,
    respondents,
    enrolled,
    selectedId = null,
    onSelect,
    loading = false,
    className,
}: OptionDistributionProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const headingId = useId();

    if (loading) {
        return (
            <div className={cn('space-y-3', className)} aria-busy="true">
                <Skeleton className="h-4 w-48" />
                {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-md" />
                ))}
            </div>
        );
    }

    const headerKey =
        kind === 'poll'
            ? enrolled != null
                ? 'tracking.distribution.votedOf'
                : 'tracking.distribution.voted'
            : enrolled != null
              ? 'tracking.distribution.answeredOf'
              : 'tracking.distribution.answered';
    const top = Math.max(0, ...rows.map((r) => r.count));

    return (
        <section className={cn('space-y-3', className)} aria-labelledby={headingId}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id={headingId} className="text-subtitle font-semibold text-neutral-900">
                    {kind === 'poll'
                        ? t('tracking.distribution.pollTitle')
                        : t('tracking.distribution.mcqTitle')}
                </h3>
                <p className="text-caption text-neutral-500">
                    {t(headerKey, {
                        count: respondents,
                        n: formatNumber(respondents, lang),
                        total: formatNumber(enrolled ?? 0, lang),
                    })}
                </p>
            </div>

            {rows.length === 0 ? (
                <p className="rounded-md border border-dashed border-neutral-300 p-4 text-center text-body text-neutral-500">
                    {t('tracking.distribution.noOptions')}
                </p>
            ) : (
                <ul className="space-y-2">
                    {rows.map((row) => {
                        const selected = selectedId === row.id;
                        const percent = row.share == null ? 0 : Math.round(row.share * 100);
                        const label = row.removed
                            ? t('tracking.distribution.removedOption')
                            : row.text || t('tracking.distribution.untitledOption');
                        const countText = t('tracking.distribution.count', {
                            count: row.count,
                            n: formatNumber(row.count, lang),
                        });
                        const shareText = row.share == null ? '' : formatPercent(row.share, lang);
                        const fill =
                            kind === 'mcq'
                                ? row.isCorrect
                                    ? 'bg-success-500'
                                    : 'bg-neutral-400'
                                : row.count > 0 && row.count === top
                                  ? 'bg-primary-500'
                                  : 'bg-primary-300';
                        const body = (
                            <>
                                <div className="flex items-start gap-3">
                                    <span
                                        className={cn(
                                            'flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
                                            kind === 'mcq' && row.isCorrect
                                                ? 'bg-success-100 text-success-700'
                                                : 'bg-neutral-100 text-neutral-600'
                                        )}
                                        aria-hidden="true"
                                    >
                                        {row.letter || '?'}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span
                                            className={cn(
                                                'line-clamp-2 break-words text-body',
                                                row.removed
                                                    ? 'italic text-neutral-500'
                                                    : 'text-neutral-900'
                                            )}
                                        >
                                            {label}
                                        </span>
                                        {kind === 'mcq' && row.isCorrect && (
                                            <span className="mt-0.5 flex items-center gap-1 text-caption font-medium text-success-700">
                                                <Check size={12} weight="bold" aria-hidden="true" />
                                                {t('tracking.distribution.correct')}
                                            </span>
                                        )}
                                    </span>
                                    {/* Flex, not inline text: two adjacent numbers would merge into
                                        one bidi run in RTL and the gap would land outside them. */}
                                    <span className="flex shrink-0 items-baseline gap-2 text-body tabular-nums text-neutral-700">
                                        <span className="font-semibold text-neutral-900">
                                            {countText}
                                        </span>
                                        {shareText && (
                                            <span className="text-neutral-500">{shareText}</span>
                                        )}
                                    </span>
                                </div>
                                <div
                                    className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100"
                                    aria-hidden="true"
                                >
                                    <div
                                        className={cn('h-full rounded-full transition-all', fill)}
                                        style={{ width: `${percent}%` }} // design-lint-ignore: data-driven bar width
                                    />
                                </div>
                            </>
                        );
                        const accessibleName = [
                            row.letter,
                            label,
                            kind === 'mcq' && row.isCorrect
                                ? t('tracking.distribution.correct')
                                : '',
                            countText,
                            shareText,
                        ]
                            .filter(Boolean)
                            .join(', ');
                        return (
                            <li key={row.id}>
                                {onSelect ? (
                                    <button
                                        type="button"
                                        aria-pressed={selected}
                                        aria-label={`${accessibleName}. ${t('tracking.distribution.filterHint')}`}
                                        disabled={row.count === 0 && !selected}
                                        onClick={() => onSelect(selected ? null : row.id)}
                                        className={cn(
                                            'group w-full rounded-md border px-3 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-default',
                                            selected
                                                ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                                                : 'border-neutral-200 bg-white enabled:hover:border-primary-300 enabled:hover:bg-neutral-50'
                                        )}
                                    >
                                        {body}
                                        {selected && (
                                            <span className="mt-1 flex items-center gap-1 text-caption text-neutral-600">
                                                <Funnel size={12} aria-hidden="true" />
                                                {t('tracking.distribution.filtered')}
                                            </span>
                                        )}
                                    </button>
                                ) : (
                                    <div
                                        className="rounded-md border border-neutral-200 bg-white px-3 py-2"
                                        aria-label={accessibleName}
                                    >
                                        {body}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {respondents === 0 && rows.length > 0 && (
                <p className="text-caption text-neutral-500">
                    {kind === 'poll'
                        ? t('tracking.distribution.noVotes')
                        : t('tracking.distribution.noAnswers')}
                </p>
            )}
        </section>
    );
}
