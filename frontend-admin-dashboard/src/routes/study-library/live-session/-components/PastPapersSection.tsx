import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { format, isSameDay, isYesterday } from 'date-fns';
import {
    ArrowClockwise as RefreshIcon,
    BookOpenText,
    CaretDown,
    CaretRight,
    ClipboardText,
    ClockCounterClockwise,
    CircleNotch,
    Warning,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import {
    listAssessmentsForRecording,
    type AssessmentArtifact,
    type AssessmentArtifactStatus,
} from '../-services/utils';

interface PastPapersSectionProps {
    scheduleId: string;
    recordingId: string;
    onOpenArtifact: (artifact: AssessmentArtifact) => void;
    /**
     * Most recent cached study-notes markdown for this recording. Notes are
     * stored as a single latest version (not a multi-row history), so at
     * most one notes row appears in the unified list.
     */
    savedNotesMarkdown?: string;
    savedNotesGeneratedAt?: string;
    /**
     * Optional click handler for the Notes row — the parent wires this to
     * re-open / focus the cached notes view. When omitted the Notes row
     * still renders but is non-interactive.
     */
    onOpenNotes?: () => void;
}

// --- Item kind (Assessment vs Notes) -----------------------------------

type ItemKind = 'assessment' | 'notes';

const buildKind = (
    t: TFunction
): Record<
    ItemKind,
    {
        Icon: typeof ClipboardText;
        chipBg: string;
        chipFg: string;
        label: string;
    }
> => ({
    assessment: {
        Icon: ClipboardText,
        // primary tone mirrors the green Create Assessment card below
        chipBg: 'bg-primary-100',
        chipFg: 'text-primary-700',
        label: t('kind.assessment'),
    },
    notes: {
        Icon: BookOpenText,
        // violet tone mirrors the purple Generate Notes card below
        chipBg: 'bg-violet-100',
        chipFg: 'text-violet-700',
        label: t('kind.notes'),
    },
});

// --- Status ------------------------------------------------------------

const buildStatus = (
    t: TFunction
): Record<AssessmentArtifactStatus, { label: string; text: string; pulse: boolean }> => ({
    IN_PROGRESS: {
        label: t('status.generating'),
        text: 'text-warning-700',
        pulse: true,
    },
    COMPLETED: {
        label: t('status.ready'),
        text: 'text-neutral-500',
        pulse: false,
    },
    PUBLISHED: {
        label: t('status.published'),
        text: 'text-success-700',
        pulse: false,
    },
    FAILED: {
        label: t('status.failed'),
        text: 'text-danger-700',
        pulse: false,
    },
});

const formatModelLabel = (slug: string): string => {
    const tail = slug.includes('/') ? (slug.split('/').pop() ?? slug) : slug;
    return tail
        .split('-')
        .filter(Boolean)
        .map((p) =>
            /^[a-z]/.test(p) ? p[0]!.toUpperCase() + p.slice(1) : p
        )
        .join(' ');
};

// --- Unified history item ----------------------------------------------

type HistoryItem =
    | {
          kind: 'assessment';
          id: string;
          createdAt: string | null | undefined;
          artifact: AssessmentArtifact;
      }
    | {
          kind: 'notes';
          id: string;
          createdAt: string;
          markdown: string;
      };

// --- Time buckets ------------------------------------------------------

type Bucket = 'today' | 'yesterday' | 'thisWeek' | 'older';

const buildBucketLabel = (t: TFunction): Record<Bucket, string> => ({
    today: t('bucket.today'),
    yesterday: t('bucket.yesterday'),
    thisWeek: t('bucket.thisWeek'),
    older: t('bucket.older'),
});

const bucketOf = (iso: string | null | undefined, now: Date): Bucket => {
    if (!iso) return 'older';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'older';
    if (isSameDay(date, now)) return 'today';
    if (isYesterday(date)) return 'yesterday';
    const ageDays = (now.getTime() - date.getTime()) / 86_400_000;
    return ageDays < 7 ? 'thisWeek' : 'older';
};

const formatRowTime = (iso: string | null | undefined, now: Date, t: TFunction): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    if (isSameDay(d, now)) return t('rowTime.today', { time: format(d, 'h:mm a') });
    if (isYesterday(d)) return t('rowTime.yesterday', { time: format(d, 'h:mm a') });
    const ageDays = (now.getTime() - d.getTime()) / 86_400_000;
    if (ageDays < 7) return format(d, 'EEE, h:mm a');
    return format(d, 'd MMM, h:mm a');
};

/**
 * Unified AI history for this recording: assessments (multi-row, from
 * ai_generated_artifact) plus the latest cached study-notes entry (single
 * row from AiContentExtraction.study_notes_markdown). Items are mixed by
 * timestamp and bucketed by time so the user sees one chronological feed.
 *
 * Layout choices:
 *  - Icon chip on the left tells you AT A GLANCE what kind of artifact it
 *    is — ClipboardText/primary for Assessment, BookOpenText/violet for
 *    Notes. Mirrors the tones of the Create Assessment / Generate Notes
 *    action cards below so the visual language is consistent.
 *  - Time leads (Today, 2:34 PM) because creation time is the primary
 *    discriminator when many items come from the same recording.
 *  - Whole row click target with caret-right disclosure.
 */
export function PastPapersSection({
    scheduleId,
    recordingId,
    onOpenArtifact,
    savedNotesMarkdown,
    savedNotesGeneratedAt,
    onOpenNotes,
}: PastPapersSectionProps) {
    const { t } = useTranslation('studyLibraryPastPapersSection');
    const [expanded, setExpanded] = useState(false);

    const { data, isLoading, isError, refetch, isRefetching } = useQuery({
        queryKey: ['recording-assessments', scheduleId, recordingId],
        queryFn: () => listAssessmentsForRecording(scheduleId, recordingId),
        staleTime: 30 * 1000,
    });

    const grouped = useMemo(() => {
        const now = new Date();
        const items: HistoryItem[] = [];

        for (const a of data ?? []) {
            items.push({
                kind: 'assessment',
                id: `a:${a.artifactId}`,
                createdAt: a.createdAt,
                artifact: a,
            });
        }
        if (savedNotesMarkdown && savedNotesGeneratedAt) {
            items.push({
                kind: 'notes',
                id: `n:${savedNotesGeneratedAt}`,
                createdAt: savedNotesGeneratedAt,
                markdown: savedNotesMarkdown,
            });
        }

        // Sort newest first
        items.sort((x, y) => {
            const xt = x.createdAt ? new Date(x.createdAt).getTime() : 0;
            const yt = y.createdAt ? new Date(y.createdAt).getTime() : 0;
            return yt - xt;
        });

        const buckets: Record<Bucket, HistoryItem[]> = {
            today: [],
            yesterday: [],
            thisWeek: [],
            older: [],
        };
        for (const it of items) {
            buckets[bucketOf(it.createdAt, now)].push(it);
        }

        return { now, buckets, total: items.length };
    }, [data, savedNotesMarkdown, savedNotesGeneratedAt]);

    if (isLoading) {
        return (
            <section className="overflow-hidden rounded-md border border-neutral-200 bg-white">
                <HeaderBar />
                <ul className="divide-y divide-neutral-100">
                    {[0, 1, 2].map((i) => (
                        <li
                            key={i}
                            className="flex items-center gap-3 px-4 py-3"
                        >
                            <span className="size-7 rounded-md bg-neutral-100" />
                            <div className="flex-1 space-y-1.5">
                                <div className="h-3 w-32 animate-pulse rounded bg-neutral-200" />
                                <div className="h-2.5 w-48 animate-pulse rounded bg-neutral-100" />
                            </div>
                            <CaretRight className="size-4 text-neutral-200" />
                        </li>
                    ))}
                </ul>
            </section>
        );
    }

    if (isError) {
        return (
            <section className="rounded-md border border-danger-200 bg-danger-50 p-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-danger-700">
                        <Warning className="size-4" weight="fill" />
                        {t('error.couldNotLoad')}
                    </div>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={() => void refetch()}
                    >
                        <RefreshIcon className="size-3.5" />
                        {t('error.retry')}
                    </MyButton>
                </div>
            </section>
        );
    }

    if (grouped.total === 0) {
        return (
            <section className="flex flex-col items-center gap-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center">
                <ClockCounterClockwise
                    className="size-7 text-neutral-300"
                    weight="duotone"
                />
                <p className="text-sm font-medium text-neutral-700">
                    {t('empty.heading')}
                </p>
                <p className="max-w-xs text-xs text-neutral-500">
                    {t('empty.description')}
                </p>
            </section>
        );
    }

    return (
        <section className="overflow-hidden rounded-md border border-neutral-200 bg-white">
            <HeaderBar
                count={grouped.total}
                onRefresh={() => void refetch()}
                refreshing={isRefetching}
                expanded={expanded}
                onToggle={() => setExpanded((prev) => !prev)}
            />
            {expanded && (
                <div className="max-h-96 overflow-y-auto">
                    {(
                        ['today', 'yesterday', 'thisWeek', 'older'] as const
                    ).map((bucket) => {
                        const rows = grouped.buckets[bucket];
                        if (rows.length === 0) return null;
                        return (
                            <div key={bucket}>
                                <BucketHeader
                                    label={buildBucketLabel(t)[bucket]}
                                    count={rows.length}
                                />
                                <ul className="divide-y divide-neutral-100">
                                    {rows.map((item) => (
                                        <Row
                                            key={item.id}
                                            item={item}
                                            now={grouped.now}
                                            onOpenArtifact={onOpenArtifact}
                                            onOpenNotes={onOpenNotes}
                                        />
                                    ))}
                                </ul>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

function HeaderBar({
    count,
    onRefresh,
    refreshing,
    expanded,
    onToggle,
}: {
    count?: number;
    onRefresh?: () => void;
    refreshing?: boolean;
    expanded?: boolean;
    onToggle?: () => void;
}) {
    const { t } = useTranslation('studyLibraryPastPapersSection');
    const isInteractive = !!onToggle;
    const showCount = typeof count === 'number' && count > 0;

    return (
        <div
            className={cn(
                'flex items-center gap-3 border-b border-neutral-200 bg-neutral-50/60 transition-colors',
                isInteractive && 'hover:bg-neutral-50'
            )}
        >
            <button
                type="button"
                onClick={onToggle}
                disabled={!isInteractive}
                aria-expanded={expanded}
                className="flex flex-1 items-center gap-2 px-4 py-2.5 text-left disabled:cursor-default"
            >
                {isInteractive && (
                    <CaretDown
                        aria-hidden
                        className={cn(
                            'size-3.5 shrink-0 text-neutral-500 transition-transform',
                            !expanded && '-rotate-90'
                        )}
                    />
                )}
                <h3 className="text-sm font-semibold text-neutral-800">
                    {t('header.title')}
                </h3>
                {showCount && (
                    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700">
                        {count}
                    </span>
                )}
                <span className="text-xs text-neutral-400">
                    {t('header.subtitle')}
                </span>
            </button>
            {onRefresh && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onRefresh();
                    }}
                    disabled={refreshing}
                    className="mr-3 inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-white hover:text-primary-700 disabled:opacity-60"
                >
                    {refreshing ? (
                        <CircleNotch className="size-3.5 animate-spin" />
                    ) : (
                        <RefreshIcon className="size-3.5" />
                    )}
                    {t('header.refresh')}
                </button>
            )}
        </div>
    );
}

function BucketHeader({ label, count }: { label: string; count: number }) {
    return (
        <div className="flex items-baseline gap-2 border-y border-neutral-100 bg-neutral-50/50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {label}
            <span className="font-normal text-neutral-400">{count}</span>
        </div>
    );
}

function KindChip({ kind, pulse }: { kind: ItemKind; pulse?: boolean }) {
    const { t } = useTranslation('studyLibraryPastPapersSection');
    const meta = buildKind(t)[kind];
    const Icon = meta.Icon;
    return (
        <span
            aria-hidden
            className={cn(
                'inline-flex size-7 shrink-0 items-center justify-center rounded-md',
                meta.chipBg,
                pulse && 'animate-pulse'
            )}
        >
            <Icon className={cn('size-4', meta.chipFg)} weight="bold" />
        </span>
    );
}

function Row({
    item,
    now,
    onOpenArtifact,
    onOpenNotes,
}: {
    item: HistoryItem;
    now: Date;
    onOpenArtifact: (artifact: AssessmentArtifact) => void;
    onOpenNotes?: () => void;
}) {
    const { t } = useTranslation('studyLibraryPastPapersSection');
    const time = formatRowTime(item.createdAt, now, t);

    if (item.kind === 'notes') {
        const isOpenable = !!onOpenNotes;
        return (
            <li>
                <button
                    type="button"
                    onClick={() => onOpenNotes?.()}
                    disabled={!isOpenable}
                    className={cn(
                        'group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        isOpenable
                            ? 'hover:bg-violet-50/40'
                            : 'cursor-default'
                    )}
                >
                    <KindChip kind="notes" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-neutral-900">
                                {time}
                            </span>
                            <span className="text-xs font-medium text-violet-700">
                                {buildKind(t).notes.label}
                            </span>
                        </div>
                        <div className="mt-0.5 text-xs text-neutral-500">
                            {t('row.lectureNotesChars', { count: item.markdown.length })}
                        </div>
                    </div>
                    {isOpenable && (
                        <CaretRight
                            aria-hidden
                            className="size-4 shrink-0 text-neutral-300 transition-all group-hover:translate-x-0.5 group-hover:text-violet-600"
                        />
                    )}
                </button>
            </li>
        );
    }

    // Assessment row
    const artifact = item.artifact;
    const status = buildStatus(t)[artifact.status];
    const isOpenable =
        artifact.status === 'COMPLETED' || artifact.status === 'PUBLISHED';
    // Sentinel string is emitted verbatim (in English) by the video-conferencing
    // provider, not app UI copy — comparing against it must not be localized.
    const showTitle =
        !!artifact.title?.trim() &&
        artifact.title.trim() !==
            'You are currently the only person in this conference';

    return (
        <li>
            <button
                type="button"
                onClick={() => onOpenArtifact(artifact)}
                disabled={!isOpenable}
                className={cn(
                    'group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    isOpenable
                        ? 'hover:bg-primary-50/40'
                        : 'cursor-not-allowed opacity-60'
                )}
            >
                <KindChip kind="assessment" pulse={status.pulse} />

                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-neutral-900">
                            {time}
                        </span>
                        <span
                            className={cn(
                                'text-xs font-medium',
                                status.text
                            )}
                        >
                            {buildKind(t).assessment.label} · {status.label}
                        </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-neutral-500">
                        {typeof artifact.numQuestions === 'number' && (
                            <span>{t('row.questionsCount', { count: artifact.numQuestions })}</span>
                        )}
                        {artifact.modelUsed && (
                            <>
                                <Dot />
                                <span title={artifact.modelUsed}>
                                    {formatModelLabel(artifact.modelUsed)}
                                </span>
                            </>
                        )}
                        {artifact.targetLanguage && (
                            <>
                                <Dot />
                                <span className="uppercase">
                                    {artifact.targetLanguage}
                                </span>
                            </>
                        )}
                    </div>
                    {showTitle && (
                        <div className="mt-0.5 truncate text-xs italic text-neutral-400">
                            {t('row.quotedTitle', { title: artifact.title })}
                        </div>
                    )}
                    {artifact.status === 'FAILED' &&
                        artifact.errorMessage && (
                            <p className="mt-0.5 truncate text-xs text-danger-600">
                                {artifact.errorMessage}
                            </p>
                        )}
                </div>

                {isOpenable && (
                    <CaretRight
                        aria-hidden
                        className="size-4 shrink-0 text-neutral-300 transition-all group-hover:translate-x-0.5 group-hover:text-primary-500"
                    />
                )}
            </button>
        </li>
    );
}

function Dot() {
    return (
        <span aria-hidden className="text-neutral-300">
            ·
        </span>
    );
}
