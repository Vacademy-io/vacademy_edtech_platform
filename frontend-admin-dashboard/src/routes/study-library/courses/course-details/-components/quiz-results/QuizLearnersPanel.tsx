import { useMemo, useState } from 'react';
import { DownloadSimple, MagnifyingGlass } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { MyTable, type TableData } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyDropdown } from '@/components/design-system/dropdown';
import { cn } from '@/lib/utils';
import type { QuizLearnerRow, QuizLearnerStatus, QuizMeta } from '../../-types/quiz-results-types';
import {
    LearnerStatusChip,
    QuizResultsMessage,
    ScoreMeter,
    formatDuration,
    formatPercent,
    formatRelative,
    initialsOf,
    scoreToneOf,
} from './quiz-results-shared';

type LearnerFilter = 'ALL' | 'ATTEMPTED' | 'NOT_ATTEMPTED' | 'PASSED' | 'FAILED';

const buildFilters = (t: TFunction): { value: LearnerFilter; label: string }[] => [
    { value: 'ALL', label: t('filters.everyone') },
    { value: 'ATTEMPTED', label: t('filters.attempted') },
    { value: 'NOT_ATTEMPTED', label: t('filters.notAttempted') },
    { value: 'PASSED', label: t('filters.passed') },
    { value: 'FAILED', label: t('filters.failed') },
];

type LearnerSort = 'HIGHEST_SCORE' | 'LOWEST_SCORE' | 'NAME_AZ' | 'MOST_RECENT_ATTEMPT' | 'MOST_ATTEMPTS';

const buildSorts = (t: TFunction): { value: LearnerSort; label: string }[] => [
    { value: 'HIGHEST_SCORE', label: t('sorts.highestScore') },
    { value: 'LOWEST_SCORE', label: t('sorts.lowestScore') },
    { value: 'NAME_AZ', label: t('sorts.nameAz') },
    { value: 'MOST_RECENT_ATTEMPT', label: t('sorts.mostRecentAttempt') },
    { value: 'MOST_ATTEMPTS', label: t('sorts.mostAttempts') },
];

const matchesFilter = (learner: QuizLearnerRow, filter: LearnerFilter): boolean => {
    switch (filter) {
        case 'ATTEMPTED':
            return learner.status !== 'NOT_ATTEMPTED';
        case 'NOT_ATTEMPTED':
            return learner.status === 'NOT_ATTEMPTED';
        case 'PASSED':
            return learner.status === 'PASSED';
        case 'FAILED':
            return learner.status === 'FAILED';
        default:
            return true;
    }
};

const buildCsvHeaders = (t: TFunction) => [
    t('csv.name'),
    t('csv.email'),
    t('csv.mobile'),
    t('csv.status'),
    t('csv.attempts'),
    t('csv.marksObtained'),
    t('csv.totalMarks'),
    t('csv.scorePercent'),
    t('csv.correct'),
    t('csv.wrong'),
    t('csv.skipped'),
    t('csv.unanswered'),
    t('csv.timeSpentSeconds'),
    t('csv.lastAttempt'),
];

/** Escapes a CSV cell — a learner name with a comma must not split the row. */
const csvCell = (value: string | number | null | undefined): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The per-quiz learner roster.
 *
 * Search, filter, sort and paging all run on the client: the server hands back the whole
 * batch in one response (a class is tens to hundreds of rows, not an unbounded table), so
 * re-sorting by score is instant and the CSV can cover everyone rather than one page.
 */
export default function QuizLearnersPanel({
    quiz,
    learners,
    truncated,
}: {
    quiz: QuizMeta;
    learners: QuizLearnerRow[];
    truncated: boolean;
}) {
    const { t } = useTranslation('studyLibraryQuizLearnersPanel');
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<LearnerFilter>('ALL');
    const [sort, setSort] = useState<LearnerSort>('HIGHEST_SCORE');
    const [page, setPage] = useState(0);

    const hasPassMark = quiz.passPercentage != null;
    const allFilters = useMemo(() => buildFilters(t), [t]);
    const sorts = useMemo(() => buildSorts(t), [t]);
    const filters = useMemo(
        () =>
            allFilters.filter(
                (option) => hasPassMark || (option.value !== 'PASSED' && option.value !== 'FAILED')
            ),
        [allFilters, hasPassMark]
    );

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase();
        const filtered = learners.filter((learner) => {
            if (!matchesFilter(learner, filter)) return false;
            if (!term) return true;
            return [learner.fullName, learner.email, learner.mobileNumber]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(term);
        });

        const sorted = [...filtered];
        switch (sort) {
            case 'LOWEST_SCORE':
                sorted.sort((a, b) => (a.scorePercent ?? -1) - (b.scorePercent ?? -1));
                break;
            case 'NAME_AZ':
                sorted.sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''));
                break;
            case 'MOST_RECENT_ATTEMPT':
                sorted.sort(
                    (a, b) => (b.lastAttemptAtEpochMillis ?? 0) - (a.lastAttemptAtEpochMillis ?? 0)
                );
                break;
            case 'MOST_ATTEMPTS':
                sorted.sort((a, b) => b.attemptCount - a.attemptCount);
                break;
            default:
                // Highest score, with never-attempted learners last rather than as zeroes.
                sorted.sort((a, b) => (b.scorePercent ?? -1) - (a.scorePercent ?? -1));
                break;
        }
        return sorted;
    }, [learners, search, filter, sort]);

    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
    const safePage = Math.min(page, totalPages - 1);
    const tableData: TableData<QuizLearnerRow> = {
        content: visible.slice(safePage * pageSize, safePage * pageSize + pageSize),
        total_pages: totalPages,
        page_no: safePage,
        page_size: pageSize,
        total_elements: visible.length,
        last: safePage >= totalPages - 1,
    };

    const exportCsv = () => {
        if (visible.length === 0) {
            toast.error(t('toast.nothingToExport'));
            return;
        }
        const rows = visible.map((learner) =>
            [
                learner.fullName,
                learner.email,
                learner.mobileNumber,
                learner.status,
                learner.attemptCount,
                learner.marksObtained,
                learner.totalMarks,
                learner.scorePercent,
                learner.correctCount,
                learner.wrongCount,
                learner.skippedCount,
                learner.unansweredCount,
                learner.timeSpentSeconds,
                learner.lastAttemptAtEpochMillis
                    ? new Date(learner.lastAttemptAtEpochMillis).toISOString()
                    : '',
            ]
                .map(csvCell)
                .join(',')
        );
        const csv = [buildCsvHeaders(t).join(','), ...rows].join('\n');
        // BOM so Excel opens UTF-8 names correctly.
        const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(quiz.title || 'quiz').replace(/[^\w\s-]/g, '').trim() || 'quiz'}-results.csv`;
        link.click();
        URL.revokeObjectURL(url);
        toast.success(t('toast.exported', { count: visible.length }));
    };

    const columns = useMemo<ColumnDef<QuizLearnerRow>[]>(
        () => [
            {
                id: 'learner',
                header: t('table.learner'),
                size: 260,
                accessorFn: (row) => row.fullName ?? '',
                cell: ({ row }) => {
                    const learner = row.original;
                    return (
                        <div className="flex items-center gap-2.5">
                            <span
                                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-600"
                                aria-hidden="true"
                            >
                                {initialsOf(learner.fullName)}
                            </span>
                            <div className="min-w-0">
                                <div className="truncate font-medium text-neutral-700">
                                    {learner.fullName || '—'}
                                </div>
                                <div className="truncate text-caption text-neutral-400">
                                    {learner.email || learner.mobileNumber || ''}
                                </div>
                            </div>
                        </div>
                    );
                },
            },
            {
                id: 'status',
                header: t('table.status'),
                size: 130,
                accessorFn: (row) => row.status,
                cell: ({ row }) => (
                    <LearnerStatusChip status={row.original.status as QuizLearnerStatus} />
                ),
            },
            {
                id: 'score',
                header: t('table.score'),
                size: 170,
                accessorFn: (row) => row.scorePercent ?? -1,
                cell: ({ row }) => {
                    const learner = row.original;
                    if (learner.status === 'NOT_ATTEMPTED') {
                        return <span className="text-caption text-neutral-400">—</span>;
                    }
                    return (
                        <ScoreMeter
                            percent={learner.scorePercent}
                            tone={scoreToneOf(learner.scorePercent, quiz.passPercentage)}
                            subLabel={`${learner.marksObtained ?? 0}/${learner.totalMarks}`}
                        />
                    );
                },
            },
            {
                id: 'breakdown',
                header: t('table.responses'),
                size: 190,
                accessorFn: (row) => row.correctCount,
                cell: ({ row }) => {
                    const learner = row.original;
                    if (learner.status === 'NOT_ATTEMPTED') {
                        return <span className="text-caption text-neutral-400">—</span>;
                    }
                    // Words, not colour blocks: three status hues cannot be told apart
                    // by a colour-blind reader, and the counts are the point anyway.
                    return (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption tabular-nums">
                            <span className="text-success-700">
                                {t('breakdown.correct', { count: learner.correctCount })}
                            </span>
                            {/* "0 wrong" in red next to a perfect score reads as an
                                error; a clean sheet just says nothing. */}
                            {learner.wrongCount > 0 && (
                                <span className="text-danger-600">
                                    {t('breakdown.wrong', { count: learner.wrongCount })}
                                </span>
                            )}
                            {learner.skippedCount > 0 && (
                                <span className="text-neutral-500">
                                    {t('breakdown.skipped', { count: learner.skippedCount })}
                                </span>
                            )}
                            {learner.unansweredCount > 0 && (
                                <span className="text-neutral-400">
                                    {t('breakdown.unanswered', { count: learner.unansweredCount })}
                                </span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'attempts',
                header: t('table.attempts'),
                size: 90,
                accessorFn: (row) => row.attemptCount,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums text-neutral-700">
                        {row.original.attemptCount || '—'}
                    </div>
                ),
            },
            {
                id: 'time',
                header: t('table.timeSpent'),
                size: 110,
                accessorFn: (row) => row.timeSpentSeconds ?? -1,
                cell: ({ row }) => (
                    <span className="text-caption text-neutral-500">
                        {formatDuration(row.original.timeSpentSeconds)}
                    </span>
                ),
            },
            {
                id: 'last',
                header: t('table.lastAttempt'),
                size: 130,
                accessorFn: (row) => row.lastAttemptAtEpochMillis ?? 0,
                cell: ({ row }) => (
                    <span className="text-caption text-neutral-500">
                        {formatRelative(row.original.lastAttemptAtEpochMillis)}
                    </span>
                ),
            },
        ],
        [quiz.passPercentage, t]
    );

    return (
        <div className="flex flex-col gap-3">
            {truncated && (
                <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-caption text-warning-700">
                    {t('truncatedNotice')}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                    <MagnifyingGlass
                        className="pointer-events-none absolute start-3 top-1/2 z-10 size-4 -translate-y-1/2 text-neutral-400"
                        aria-hidden="true"
                    />
                    <MyInput
                        inputType="text"
                        input={search}
                        onChangeFunction={(event) => {
                            setSearch(event.target.value);
                            setPage(0);
                        }}
                        inputPlaceholder={t('searchPlaceholder')}
                        size="medium"
                        className="w-full ps-9 sm:w-64"
                    />
                </div>

                <div
                    className="flex flex-wrap items-center gap-1.5"
                    role="group"
                    aria-label={t('filterLearnersAriaLabel')}
                >
                    {filters.map((option) => {
                        const isActive = filter === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={isActive}
                                onClick={() => {
                                    setFilter(option.value);
                                    setPage(0);
                                }}
                                className={cn(
                                    'cursor-pointer rounded-lg border px-3 py-1.5 text-caption transition-colors duration-200',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                                    isActive
                                        ? 'border-primary-300 bg-primary-50 font-semibold text-primary-600'
                                        : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                                )}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>

                <div className="ms-auto flex items-center gap-2">
                    <MyDropdown
                        currentValue={sort}
                        dropdownList={sorts}
                        handleChange={(value) => setSort(value as LearnerSort)}
                    />
                    <MyButton buttonType="secondary" scale="medium" onClick={exportCsv}>
                        <DownloadSimple className="size-4" aria-hidden="true" />
                        {t('actions.exportCsv')}
                    </MyButton>
                </div>
            </div>

            {visible.length === 0 ? (
                <QuizResultsMessage
                    title={t('empty.noMatchTitle')}
                    subtitle={t('empty.noMatchSubtitle')}
                    action={
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => {
                                setSearch('');
                                setFilter('ALL');
                            }}
                        >
                            {t('actions.clearFilters')}
                        </MyButton>
                    }
                />
            ) : (
                <>
                    <MyTable<QuizLearnerRow>
                        data={tableData}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        currentPage={safePage}
                        scrollable
                        enableColumnPinning={false}
                    />
                    {totalPages > 1 && (
                        <MyPagination
                            currentPage={safePage}
                            totalPages={totalPages}
                            totalElements={visible.length}
                            pageSize={pageSize}
                            onPageChange={setPage}
                        />
                    )}
                    <p className="text-caption text-neutral-400">
                        {t('footer.summary', {
                            visible: visible.length,
                            total: learners.length,
                            percent: formatPercent(
                                quiz.enrolledLearners
                                    ? (quiz.attemptedLearners * 100) / quiz.enrolledLearners
                                    : null
                            ),
                        })}
                    </p>
                </>
            )}
        </div>
    );
}
