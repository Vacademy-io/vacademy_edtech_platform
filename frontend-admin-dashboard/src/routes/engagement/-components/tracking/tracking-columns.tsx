import type { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { Check, Paperclip, X } from '@phosphor-icons/react';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import type {
    EngagementItemDTO,
    EngagementTrackingDTO,
    EngagementTrackingRow,
    FlashcardCardStat,
    FlashcardCardStatsDTO,
} from '../../-types/types';
import { formatDateTime, formatNumber, formatPercent } from '../../-utils/format';
import { optionLetter, parseQuestionPayload, type QuestionOption } from './OptionDistribution';

/**
 * Columns, row types and small pure helpers for the task tracking table.
 *
 * The 2F types predate the server's insight contract (WP-2C), so the fields the
 * server added since are declared here as local extensions. Every one is optional:
 * an older server leaves them out and the table falls back.
 */

// ── Local type extensions (WP-2C fields missing from -types/types.ts) ────────

export interface TrackingRow extends EngagementTrackingRow {
    /** completedAt − startedAt measured on the server: time since FIRST opened. */
    serverTimeMs?: number | null;
    /** FLASHCARDS: cards rated "Got it" on the first pass. */
    flashcardsKnown?: number | null;
    /** FLASHCARDS: cards in the deck the attempt was made against. */
    flashcardsTotal?: number | null;
    /** FLASHCARDS: card ids rated "Still learning". */
    learningCardIds?: string[] | null;
}

export interface TrackingData extends Omit<EngagementTrackingDTO, 'rows'> {
    rows: TrackingRow[];
    /** Enrolled learners who have neither opened nor finished the task. */
    notDoneCount?: number | null;
    /** Completions under catch-up. */
    lateCount?: number | null;
    /** The item's score ceiling (games: declared max; flashcards: card count). */
    maxScore?: number | null;
}

export interface CardStatsData extends FlashcardCardStatsDTO {
    itemId?: string | null;
    version?: number | null;
    completedCount?: number | null;
}

/** The table filter. ALL = every enrolled learner plus anyone else with an attempt. */
export type TrackingFilter = 'ALL' | 'DONE' | 'STARTED' | 'NOT_DONE' | 'LATE';

/** How a task is tracked: decides the top section and which columns show. */
export type TrackingKind = 'mcq' | 'poll' | 'text' | 'upload' | 'game' | 'flashcards' | 'content';

/** A resolved uploaded file (media-service get-details). */
export interface FileDetail {
    id: string;
    url: string;
    fileName: string;
    fileType: string;
}

export function trackingKind(
    item: Pick<EngagementItemDTO, 'itemType' | 'payloadJson'> | null
): TrackingKind {
    switch (item?.itemType) {
        case 'POLL':
            return 'poll';
        case 'QUESTION_OF_DAY': {
            const format = parseQuestionPayload(item.payloadJson, item.itemType).format;
            return format === 'TEXT' ? 'text' : format === 'UPLOAD' ? 'upload' : 'mcq';
        }
        case 'GAME':
            return 'game';
        case 'FLASHCARDS':
            return 'flashcards';
        default:
            return 'content';
    }
}

// ── Row helpers ──────────────────────────────────────────────────────────────

export function learnerName(row: Pick<TrackingRow, 'fullName' | 'userId'>): string {
    return row.fullName?.trim() || `${row.userId.slice(0, 8)}…`;
}

/** A row the review panel can show: a written answer or at least one file. */
export function isReviewable(row: TrackingRow): boolean {
    return Boolean(row.textAnswer?.trim()) || (row.fileIds?.length ?? 0) > 0;
}

/** Server time since first opened, else the client's advisory timer. */
export function rowElapsedMs(row: TrackingRow): number | null {
    const ms = row.serverTimeMs ?? row.timeSpentMs;
    return ms != null && Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** "45s" in the admin's locale (narrow unit). */
function seconds(value: number, lang: string): string {
    try {
        return new Intl.NumberFormat(lang || 'en', {
            style: 'unit',
            unit: 'second',
            unitDisplay: 'narrow',
        }).format(value);
    } catch {
        return `${value}s`;
    }
}

/** A clock part in the admin's digits: "5", or "05" with `pad`. */
function clockPart(value: number, lang: string, pad: boolean): string {
    try {
        return new Intl.NumberFormat(lang || 'en', {
            minimumIntegerDigits: pad ? 2 : 1,
            useGrouping: false,
        }).format(value);
    } catch {
        return pad ? String(value).padStart(2, '0') : String(value);
    }
}

/** "<1s", "45s", "2:05", "1:02:05": compact, and never "0s" for a sub-second answer. */
export function formatElapsed(ms: number | null | undefined, lang: string): string {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `<${seconds(1, lang)}`;
    const total = Math.round(ms / 1000);
    if (total < 60) return seconds(total, lang);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const mm = clockPart(minutes, lang, hours > 0);
    const ss = clockPart(secs, lang, true);
    return hours > 0 ? `${clockPart(hours, lang, false)}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface StatusChipSpec {
    text: string;
    status: StatusType;
    showIcon: boolean;
}

/** Done (success), done late (warning), opened (neutral), not started / skipped (neutral). */
export function statusChipFor(row: TrackingRow, t: TFunction): StatusChipSpec {
    switch (row.status) {
        case 'COMPLETED':
            return row.isLate
                ? { text: t('tracking.statusChip.late'), status: 'WARNING', showIcon: true }
                : { text: t('tracking.statusChip.done'), status: 'SUCCESS', showIcon: true };
        case 'STARTED':
            return { text: t('tracking.statusChip.opened'), status: 'INFO', showIcon: false };
        case 'SKIPPED':
            return { text: t('tracking.statusChip.skipped'), status: 'INFO', showIcon: false };
        case 'NOT_STARTED':
            return { text: t('tracking.statusChip.notStarted'), status: 'INFO', showIcon: false };
        default:
            return { text: t('tracking.statusChip.other'), status: 'INFO', showIcon: false };
    }
}

/** Known / deck size for a flashcards attempt, from the new fields or score/maxScore. */
export function flashcardsKnown(row: TrackingRow): { known: number; total: number } | null {
    const known = row.flashcardsKnown ?? row.score;
    const total = row.flashcardsTotal ?? row.maxScore;
    if (known == null || total == null || !Number.isFinite(known) || !(total > 0)) return null;
    return { known: Math.round(known), total: Math.round(total) };
}

/** A game's score (and its ceiling, if known). */
export function gameScore(
    row: TrackingRow,
    itemMax: number | null | undefined
): { score: number; max: number | null } | null {
    if (row.score == null || !Number.isFinite(row.score)) return null;
    const max = row.maxScore ?? itemMax ?? null;
    return { score: row.score, max: max != null && max > 0 ? max : null };
}

function formatScore(value: number, lang: string): string {
    return Number.isInteger(value)
        ? formatNumber(value, lang)
        : new Intl.NumberFormat(lang || 'en', { maximumFractionDigits: 1 }).format(value);
}

export interface ScoreSummary {
    /** Completed attempts with a score. */
    count: number;
    /** Average and median of the score (games) or the known share 0–1 (flashcards). */
    average: number | null;
    median: number | null;
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Average and median over completed rows: game scores, or flashcards known share (0–1). */
export function scoreSummary(rows: TrackingRow[], kind: TrackingKind): ScoreSummary {
    const values: number[] = [];
    for (const row of rows) {
        if (row.status !== 'COMPLETED') continue;
        if (kind === 'flashcards') {
            const k = flashcardsKnown(row);
            if (k) values.push(k.known / k.total);
        } else if (row.score != null && Number.isFinite(row.score)) {
            values.push(row.score);
        }
    }
    if (values.length === 0) return { count: 0, average: null, median: null };
    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    return { count: values.length, average, median: median(values) };
}

/** The card most often rated "Still learning" (ties: the most studied); null before any result. */
export function hardestCard(
    cards: FlashcardCardStat[] | null | undefined
): FlashcardCardStat | null {
    let best: FlashcardCardStat | null = null;
    for (const card of cards ?? []) {
        if (!(card.studied > 0) || !(card.stillLearning > 0)) continue;
        if (
            !best ||
            card.stillLearningRate > best.stillLearningRate ||
            (card.stillLearningRate === best.stillLearningRate && card.studied > best.studied)
        ) {
            best = card;
        }
    }
    return best;
}

// ── Columns ──────────────────────────────────────────────────────────────────

export interface TrackingColumnsOptions {
    kind: TrackingKind;
    t: TFunction;
    lang: string;
    /** The plan's timezone, for Completed. */
    timeZone?: string;
    /** Authored options, for the MCQ/poll Answer cell. */
    options: QuestionOption[];
    /** Whether the MCQ has a key: marks each answer right or wrong. */
    gradable: boolean;
    /** Item-level score ceiling (games). */
    maxScore?: number | null;
    /** Flashcards: card id → front, for "Still learning". */
    cardFronts: Map<string, string>;
    /** Resolved uploads by file id. */
    files: Record<string, FileDetail>;
    /** Opens the review panel on a row (written and uploaded answers). */
    onReview: (row: TrackingRow) => void;
    /**
     * Width the table should fill (px). MyTable sizes the table to the sum of its
     * columns, so spare width goes to Learner (and Answer) instead of a blank gap.
     */
    targetWidth?: number;
}

const DASH = '—';

/**
 * Keeps "7 / 10" in reading order inside right-to-left text. The spaces around the
 * slash split it into separate number runs, which an RTL paragraph would reorder into
 * "10 / 7"; an LTR isolate (U+2066 … U+2069) holds it together.
 */
export function ltrIsolate(text: string): string {
    return `\u2066${text}\u2069`;
}

/** "3 / 24" in locale digits, safe inside RTL text. */
export function fraction(part: number, whole: number, lang: string): string {
    return ltrIsolate(`${formatNumber(part, lang)} / ${formatNumber(whole, lang)}`);
}

function Muted({ children }: { children?: string }) {
    return <span className="text-neutral-400">{children ?? DASH}</span>;
}

/** Numbers line up under their (start-aligned) MyTable headers. */
function NumberCell({ value }: { value: string }) {
    return <span className="block whitespace-nowrap tabular-nums">{value}</span>;
}

/** "file.pdf" from the resolved name, else a short id. */
export function fileLabel(id: string, files: Record<string, FileDetail>): string {
    const name = files[id]?.fileName?.trim();
    return name || `${id.slice(0, 8)}…`;
}

/**
 * The columns for one task type. Learner, Status, Points, Time and Completed always;
 * Answer for questions and polls (option text, or a 3-line clamp for written answers,
 * or the uploaded file names); Score for games and flashcards; Still learning for
 * flashcards.
 */
export function buildTrackingColumns(opts: TrackingColumnsOptions): ColumnDef<TrackingRow>[] {
    const { kind, t, lang, timeZone, options, gradable, maxScore, cardFronts, files, onReview } =
        opts;
    const optionIndex = new Map(options.map((o, i) => [o.id, i] as const));

    const columns: ColumnDef<TrackingRow>[] = [
        {
            id: 'learner',
            header: t('tracking.learner'),
            size: 170,
            cell: ({ row }) => {
                const r = row.original;
                const sub = r.email || r.username;
                return (
                    <div className="min-w-0">
                        <span className="block truncate font-medium text-neutral-900">
                            {learnerName(r)}
                        </span>
                        {sub && (
                            <span className="block truncate text-caption text-neutral-500">
                                {sub}
                            </span>
                        )}
                    </div>
                );
            },
        },
        {
            id: 'status',
            header: t('tracking.status'),
            size: 170,
            cell: ({ row }) => {
                const chip = statusChipFor(row.original, t);
                // StatusChip takes no className; the wrapper keeps its label on one line.
                return (
                    <span className="inline-block whitespace-nowrap">
                        <StatusChip
                            text={chip.text}
                            status={chip.status}
                            showIcon={chip.showIcon}
                            textSize="text-caption"
                        />
                    </span>
                );
            },
        },
    ];

    if (kind === 'mcq' || kind === 'poll') {
        columns.push({
            id: 'answer',
            header: t('tracking.answer'),
            size: 220,
            cell: ({ row }) => {
                const r = row.original;
                const id = r.selectedOptionId;
                if (!id) return <Muted />;
                const index = optionIndex.get(id);
                const text =
                    index == null
                        ? t('tracking.distribution.removedOption')
                        : options[index]!.text || t('tracking.distribution.untitledOption');
                const letter = index == null ? '' : optionLetter(index);
                const verdict = gradable && kind === 'mcq' ? r.isCorrect : null;
                return (
                    <span className="flex min-w-0 items-start gap-1.5">
                        {verdict === true && (
                            <Check
                                size={14}
                                weight="bold"
                                className="mt-0.5 shrink-0 text-success-600"
                                aria-label={t('tracking.correct')}
                            />
                        )}
                        {verdict === false && (
                            <X
                                size={14}
                                weight="bold"
                                className="mt-0.5 shrink-0 text-danger-600"
                                aria-label={t('tracking.wrong')}
                            />
                        )}
                        <span className="line-clamp-2 min-w-0 break-words text-neutral-800">
                            {letter ? `${letter} · ${text}` : text}
                        </span>
                    </span>
                );
            },
        });
    }

    if (kind === 'text' || kind === 'upload') {
        columns.push({
            id: 'answer',
            header: t('tracking.answer'),
            size: 232,
            cell: ({ row }) => {
                const r = row.original;
                const fileIds = r.fileIds ?? [];
                const text = r.textAnswer?.trim();
                if (!text && fileIds.length === 0) return <Muted />;
                const learner = learnerName(r);
                return (
                    <div className="min-w-0 space-y-1">
                        {text && (
                            <p className="line-clamp-3 whitespace-pre-wrap break-words text-neutral-800">
                                {text}
                            </p>
                        )}
                        {fileIds.length > 0 && (
                            <ul className="space-y-0.5">
                                {fileIds.slice(0, 2).map((fileId) => (
                                    <li key={fileId} className="flex min-w-0 items-center gap-1">
                                        <Paperclip
                                            size={14}
                                            className="shrink-0 text-neutral-500"
                                            aria-hidden="true"
                                        />
                                        <span className="truncate text-caption text-neutral-700">
                                            {fileLabel(fileId, files)}
                                        </span>
                                    </li>
                                ))}
                                {fileIds.length > 2 && (
                                    <li className="text-caption text-neutral-500">
                                        {t('tracking.moreFiles', {
                                            count: fileIds.length - 2,
                                            n: formatNumber(fileIds.length - 2, lang),
                                        })}
                                    </li>
                                )}
                            </ul>
                        )}
                        <button
                            type="button"
                            className="rounded-sm text-caption font-medium text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                            aria-label={t('tracking.review.openFor', { name: learner })}
                            onClick={(event) => {
                                event.stopPropagation();
                                onReview(r);
                            }}
                        >
                            {t('tracking.review.open')}
                        </button>
                    </div>
                );
            },
        });
    }

    if (kind === 'game' || kind === 'flashcards') {
        columns.push({
            id: 'score',
            header: kind === 'flashcards' ? t('tracking.known') : t('tracking.score'),
            size: 90,
            cell: ({ row }) => {
                const r = row.original;
                if (r.status !== 'COMPLETED') return <NumberCell value={DASH} />;
                if (kind === 'flashcards') {
                    const k = flashcardsKnown(r);
                    return (
                        <NumberCell
                            value={
                                k
                                    ? t('tracking.knewOf', {
                                          value: fraction(k.known, k.total, lang),
                                      })
                                    : DASH
                            }
                        />
                    );
                }
                const s = gameScore(r, maxScore);
                if (!s) return <NumberCell value={DASH} />;
                return (
                    <NumberCell
                        value={
                            s.max != null
                                ? ltrIsolate(
                                      `${formatScore(s.score, lang)} / ${formatScore(s.max, lang)}`
                                  )
                                : formatScore(s.score, lang)
                        }
                    />
                );
            },
        });
    }

    if (kind === 'flashcards') {
        columns.push({
            id: 'learning',
            header: t('tracking.stillLearning'),
            size: 140,
            cell: ({ row }) => {
                const r = row.original;
                if (r.status !== 'COMPLETED') return <Muted />;
                const ids = r.learningCardIds ?? [];
                if (ids.length === 0) {
                    return r.learningCardIds ? (
                        <span className="text-caption text-success-700">
                            {t('tracking.knewAll')}
                        </span>
                    ) : (
                        <Muted />
                    );
                }
                const fronts = ids.map((id) => cardFronts.get(id) || t('tracking.removedCard'));
                return (
                    <span
                        className="line-clamp-2 break-words text-neutral-800"
                        title={fronts.join(' | ')}
                    >
                        {fronts.join(', ')}
                    </span>
                );
            },
        });
    }

    columns.push(
        {
            id: 'points',
            header: t('tracking.points'),
            size: 64,
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <NumberCell
                        value={
                            r.status === 'NOT_STARTED' || r.pointsAwarded == null
                                ? DASH
                                : formatNumber(r.pointsAwarded, lang)
                        }
                    />
                );
            },
        },
        {
            id: 'time',
            // Measured on the server from the first open, not time on task (A16).
            header: () => <span title={t('tracking.timeHint')}>{t('tracking.time')}</span>,
            size: 64,
            cell: ({ row }) => {
                const r = row.original;
                const ms = r.status === 'COMPLETED' ? rowElapsedMs(r) : null;
                return <NumberCell value={ms == null ? DASH : formatElapsed(ms, lang)} />;
            },
        },
        {
            id: 'completedAt',
            header: t('tracking.completedAt'),
            size: 140,
            cell: ({ row }) => {
                const at = row.original.completedAt;
                return at ? (
                    <span className="whitespace-nowrap text-neutral-600">
                        {formatDateTime(at, lang, timeZone)}
                    </span>
                ) : (
                    <Muted />
                );
            },
        }
    );

    const target = opts.targetWidth ?? 840;
    const total = columns.reduce((sum, c) => sum + (c.size ?? 0), 0);
    const spare = target - total;
    if (spare > 0) {
        const growable = columns.filter((c) => c.id === 'learner' || c.id === 'answer');
        const share = Math.floor(spare / growable.length);
        for (const c of growable) c.size = (c.size ?? 0) + share;
    }
    return columns;
}

/** "72%" for a 0–1 share; the flashcards Average/Median tiles. */
export function formatShare(value: number | null, lang: string): string {
    return value == null ? DASH : formatPercent(value, lang);
}

/** A game's average or median, with the ceiling when known: "7.5 / 10". */
export function formatGameValue(
    value: number | null,
    max: number | null | undefined,
    lang: string
): string {
    if (value == null) return DASH;
    return max != null && max > 0
        ? ltrIsolate(`${formatScore(value, lang)} / ${formatScore(max, lang)}`)
        : formatScore(value, lang);
}
