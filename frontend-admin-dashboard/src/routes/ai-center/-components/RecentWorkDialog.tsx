import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import {
    ArrowRight,
    CaretLeft,
    CaretRight,
    FileAudio,
    FileImage,
    FilePdf,
    FileText,
    MagnifyingGlass,
    Sparkle,
    X,
} from '@phosphor-icons/react';
import {
    FileFamily,
    buildSourceLabel,
    classifyFile,
    isQuestionTask,
    relativeTime,
    routeForTask,
    statusLabel,
    statusStyles,
    taskDisplayName,
} from '../-utils/format';

const FamilyIcon = ({ family }: { family: FileFamily }) => {
    const cls = 'text-primary-500';
    if (family === 'pdf') return <FilePdf size={20} weight="fill" className={cls} />;
    if (family === 'audio') return <FileAudio size={20} weight="fill" className={cls} />;
    if (family === 'image') return <FileImage size={20} weight="fill" className={cls} />;
    return <FileText size={20} weight="fill" className={cls} />;
};

type SourceFilter = 'all' | FileFamily;

// value is the internal filter identifier used for logic/equality; label is the
// only user-facing part, so it's built from `t` rather than hardcoded.
const buildSourceFilters = (t: TFunction): Array<{ value: SourceFilter; label: string }> => [
    { value: 'all', label: t('sourceFilters.all') },
    { value: 'pdf', label: t('sourceFilters.pdf') },
    { value: 'audio', label: t('sourceFilters.audio') },
    { value: 'image', label: t('sourceFilters.image') },
    { value: 'doc', label: t('sourceFilters.doc') },
    { value: 'none', label: t('sourceFilters.none') },
];

// These identifiers double as record keys (see bucketForDate/grouped below), so
// they stay as fixed English strings for logic; DATE_BUCKET_LABEL_KEYS maps each
// one to the translation key used only when rendering the bucket heading.
const DATE_BUCKETS = ['Today', 'Yesterday', 'Earlier this week', 'Older'] as const;
type DateBucket = (typeof DATE_BUCKETS)[number];

const DATE_BUCKET_LABEL_KEYS: Record<DateBucket, string> = {
    Today: 'dateBuckets.today',
    Yesterday: 'dateBuckets.yesterday',
    'Earlier this week': 'dateBuckets.earlierThisWeek',
    Older: 'dateBuckets.older',
};

const bucketForDate = (iso: string): DateBucket => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) return 'Today';
    if (d.getTime() === yesterday.getTime()) return 'Yesterday';
    if (d >= weekAgo) return 'Earlier this week';
    return 'Older';
};

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tasks: AITaskIndividualListInterface[];
    /**
     * Called when a question-type task is clicked. If provided, the dialog
     * delegates the open instead of navigating away — letting the caller
     * render an inline preview dialog.
     */
    onPreviewTask?: (task: AITaskIndividualListInterface) => void;
};

export const RecentWorkDialog = ({ open, onOpenChange, tasks, onPreviewTask }: Props) => {
    const { t } = useTranslation('aiCenterRecentWorkDialog');
    const { t: tFormat } = useTranslation('aiCenterFormat');
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    const SOURCE_FILTERS = useMemo(() => buildSourceFilters(t), [t]);
    const sourceLabel = useMemo(() => buildSourceLabel(tFormat), [tFormat]);

    const sourceCounts = useMemo(() => {
        const counts: Record<SourceFilter, number> = {
            all: tasks.length,
            pdf: 0,
            audio: 0,
            image: 0,
            doc: 0,
            none: 0,
        };
        for (const task of tasks) {
            const family = classifyFile(task.file_detail?.file_type);
            counts[family]++;
        }
        return counts;
    }, [tasks]);

    const filtered = useMemo(() => {
        let result = tasks;
        if (sourceFilter !== 'all') {
            result = result.filter(
                (task) => classifyFile(task.file_detail?.file_type) === sourceFilter
            );
        }
        const q = search.trim().toLowerCase();
        if (q) {
            result = result.filter((task) => {
                const family = classifyFile(task.file_detail?.file_type);
                const fallback = sourceLabel[family];
                const display = taskDisplayName(task, tFormat, fallback).toLowerCase();
                const name = (task.task_name || '').toLowerCase();
                const file = (task.file_detail?.file_name || '').toLowerCase();
                return (
                    display.includes(q) || name.includes(q) || file.includes(q)
                );
            });
        }
        return result;
    }, [tasks, sourceFilter, search, sourceLabel, tFormat]);

    const sortedFiltered = useMemo(
        () => [...filtered].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
        [filtered]
    );

    const totalPages = Math.max(1, Math.ceil(sortedFiltered.length / ITEMS_PER_PAGE));
    const safePage = Math.min(page, totalPages);

    useEffect(() => {
        setPage(1);
    }, [search, sourceFilter]);

    const pagedTasks = useMemo(() => {
        const start = (safePage - 1) * ITEMS_PER_PAGE;
        return sortedFiltered.slice(start, start + ITEMS_PER_PAGE);
    }, [sortedFiltered, safePage]);

    const grouped = useMemo(() => {
        const groups: Record<DateBucket, AITaskIndividualListInterface[]> = {
            Today: [],
            Yesterday: [],
            'Earlier this week': [],
            Older: [],
        };
        for (const task of pagedTasks) {
            groups[bucketForDate(task.updated_at)].push(task);
        }
        return groups;
    }, [pagedTasks]);

    const rangeStart =
        sortedFiltered.length === 0 ? 0 : (safePage - 1) * ITEMS_PER_PAGE + 1;
    const rangeEnd = Math.min(safePage * ITEMS_PER_PAGE, sortedFiltered.length);

    const handleOpenTask = (task: AITaskIndividualListInterface) => {
        if (onPreviewTask && isQuestionTask(task) && task.status === 'COMPLETED') {
            onPreviewTask(task);
            return;
        }
        onOpenChange(false);
        navigate({ to: routeForTask(task) });
    };

    const hasAny = tasks.length > 0;
    const hasResults = filtered.length > 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                onClick={(e) => e.stopPropagation()}
                className="no-scrollbar !m-0 flex size-11/12 flex-col !gap-0 overflow-hidden !p-0"
            >
                <div className="sticky top-0 z-10 flex flex-col gap-4 border-b border-neutral-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex flex-col gap-0.5">
                            {/* Radix requires a Title (and warns without a
                                Description) on every DialogContent — these are
                                the same two lines, just as the primitives. */}
                            <DialogTitle className="text-lg font-semibold text-gray-900">
                                {t('dialog.title')}
                            </DialogTitle>
                            <DialogDescription className="text-xs text-neutral-500">
                                {tasks.length === 0
                                    ? t('emptyState.nothingHereYet')
                                    : t('dialog.itemCount', { count: tasks.length })}
                            </DialogDescription>
                        </div>
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="rounded-lg border border-neutral-200 p-2 text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
                            aria-label={t('dialog.close')}
                        >
                            <X size={16} />
                        </button>
                    </div>
                    {hasAny && (
                        <>
                            <div className="relative">
                                <MagnifyingGlass
                                    size={14}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                                />
                                <input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder={t('dialog.searchPlaceholder')}
                                    className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-9 text-sm placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
                                />
                                {search && (
                                    <button
                                        type="button"
                                        onClick={() => setSearch('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                                        aria-label={t('dialog.clearSearch')}
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {SOURCE_FILTERS.map((f) => {
                                    const active = sourceFilter === f.value;
                                    const count = sourceCounts[f.value];
                                    if (count === 0 && f.value !== 'all') return null;
                                    return (
                                        <button
                                            key={f.value}
                                            type="button"
                                            onClick={() => setSourceFilter(f.value)}
                                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                                                active
                                                    ? 'border-primary-300 bg-primary-50 text-primary-600'
                                                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-200'
                                            }`}
                                        >
                                            {f.label}
                                            <span
                                                className={`inline-flex min-w-5 items-center justify-center rounded px-1 text-2xs ${
                                                    active
                                                        ? 'bg-primary-100 text-primary-700'
                                                        : 'bg-neutral-100 text-neutral-500'
                                                }`}
                                            >
                                                {count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>

                {!hasAny ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                        <Sparkle size={28} weight="fill" className="text-primary-300" />
                        <p className="text-sm font-medium text-gray-900">
                            {t('emptyState.nothingHereYet')}
                        </p>
                        <p className="max-w-xs text-xs text-neutral-500">
                            {t('emptyState.nothingHereYetDescription')}
                        </p>
                    </div>
                ) : !hasResults ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                        <MagnifyingGlass size={24} className="text-neutral-300" />
                        <p className="text-sm font-medium text-gray-900">
                            {t('emptyState.noMatches')}
                        </p>
                        <p className="max-w-xs text-xs text-neutral-500">
                            {t('emptyState.noMatchesDescription')}
                        </p>
                        {(search || sourceFilter !== 'all') && (
                            <button
                                type="button"
                                onClick={() => {
                                    setSearch('');
                                    setSourceFilter('all');
                                }}
                                className="mt-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                            >
                                {t('emptyState.clearFilters')}
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-6 overflow-y-auto bg-neutral-50 p-5">
                        {DATE_BUCKETS.map((bucket) => {
                            const items = grouped[bucket];
                            if (items.length === 0) return null;
                            return (
                                <section key={bucket} className="flex flex-col gap-3">
                                    <div className="flex items-baseline gap-2">
                                        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                            {t(DATE_BUCKET_LABEL_KEYS[bucket])}
                                        </h3>
                                        <span className="text-2xs text-neutral-400">
                                            {items.length}
                                        </span>
                                    </div>
                                    <div className="flex flex-col gap-3">
                                        {items.map((task) => {
                                            const family = classifyFile(
                                                task.file_detail?.file_type
                                            );
                                            const display = taskDisplayName(
                                                task,
                                                tFormat,
                                                sourceLabel[family]
                                            );
                                            return (
                                                <button
                                                    key={task.id}
                                                    type="button"
                                                    onClick={() => handleOpenTask(task)}
                                                    className="group flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition-all hover:border-primary-200 hover:shadow-sm"
                                                >
                                                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                                                        <FamilyIcon family={family} />
                                                    </div>
                                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                        <span className="break-words text-sm font-medium text-gray-900">
                                                            {display}
                                                        </span>
                                                        <span className="text-xs text-neutral-500">
                                                            {sourceLabel[family]} ·{' '}
                                                            {relativeTime(task.updated_at, tFormat)}
                                                        </span>
                                                    </div>
                                                    <span
                                                        className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-2xs font-medium ring-1 ring-inset ${statusStyles(
                                                            task.status
                                                        )}`}
                                                    >
                                                        {statusLabel(task.status, tFormat)}
                                                    </span>
                                                    <ArrowRight
                                                        size={14}
                                                        weight="bold"
                                                        className="shrink-0 self-center text-neutral-300 transition-colors group-hover:text-primary-500"
                                                    />
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
                {hasResults && totalPages > 1 && (
                    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-neutral-200 bg-white px-5 py-3">
                        <span className="text-xs text-neutral-500">
                            {t('pagination.showingRange', {
                                start: rangeStart,
                                end: rangeEnd,
                                total: sortedFiltered.length,
                            })}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={safePage === 1}
                                className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <CaretLeft size={12} weight="bold" />
                                {t('pagination.prev')}
                            </button>
                            <span className="px-2 text-xs text-neutral-600">
                                {t('pagination.pageOf', { current: safePage, total: totalPages })}
                            </span>
                            <button
                                type="button"
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={safePage === totalPages}
                                className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t('pagination.next')}
                                <CaretRight size={12} weight="bold" />
                            </button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
