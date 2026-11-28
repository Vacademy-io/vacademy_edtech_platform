import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { ArrowClockwise, ListChecks, Microphone } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { ChipToggleGroup } from '@/components/design-system/chips';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable, type TableData } from '@/components/design-system/table';
import { cn } from '@/lib/utils';
import {
    courseKnowledgeErrorMessage,
    formatCredits,
    useRetryCourseLesson,
    type CourseCoverageLesson,
    type CourseLessonState,
} from '@/services/course-knowledge';
import { KeptTranscriptDialog } from './KeptTranscriptDialog';

const NAMESPACE = 'courseAiKnowledge';
const PAGE_SIZE = 10;

/** Display order of the state filter (course states, worst-actionable last). */
const STATE_ORDER: CourseLessonState[] = [
    'READY',
    'NEEDS_PROCESSING',
    'PROCESSING',
    'NOT_SCANNED',
    'FAILED',
    'CANT_READ',
    'EXCLUDED',
];

type StateFilter = 'ALL' | CourseLessonState;

/** Token tone per lesson state, shared by the summary chips and the table. */
const LESSON_STATE_TONE: Record<CourseLessonState, string> = {
    READY: 'border-success-200 bg-success-50 text-success-700',
    NEEDS_PROCESSING: 'border-warning-200 bg-warning-50 text-warning-700',
    PROCESSING: 'border-primary-200 bg-primary-50 text-primary-500',
    NOT_SCANNED: 'border-neutral-200 bg-neutral-100 text-neutral-600',
    CANT_READ: 'border-neutral-300 bg-neutral-50 text-neutral-500',
    FAILED: 'border-danger-200 bg-danger-50 text-danger-700',
    EXCLUDED: 'border-neutral-200 bg-neutral-50 text-neutral-400',
};

export const LessonStateChip = ({ state, label }: { state: CourseLessonState; label: string }) => (
    <span
        className={cn(
            'inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-caption font-medium',
            LESSON_STATE_TONE[state] ?? LESSON_STATE_TONE.NOT_SCANNED
        )}
    >
        {label}
    </span>
);

/** Lesson type label from the slide source type and, for documents, the file type. */
const typeLabel = (t: TFunction, lesson: CourseCoverageLesson): string => {
    const source = (lesson.source_type ?? '').toUpperCase();
    const doc = (lesson.doc_type ?? '').toUpperCase();
    switch (source) {
        case 'DOCUMENT':
            if (doc === 'PDF') return t('table.types.pdf');
            if (doc === 'DOC' || doc === 'DOCX') return t('table.types.word');
            if (doc === 'PPT' || doc === 'PPTX' || doc === 'PRESENTATION')
                return t('table.types.slides');
            if (doc === 'HTML') return t('table.types.text');
            if (doc === 'CODE' || doc === 'JUPYTER' || doc === 'SCRATCH')
                return t('table.types.code');
            return t('table.types.document');
        case 'VIDEO':
            return t('table.types.video');
        case 'AUDIO':
            return t('table.types.audio');
        case 'QUIZ':
            return t('table.types.quiz');
        case 'QUESTION':
            return t('table.types.question');
        case 'ASSIGNMENT':
            return t('table.types.assignment');
        case 'SCORM':
            return t('table.types.scorm');
        case 'HTML_VIDEO':
            return t('table.types.aiVideo');
        case 'ASSESSMENT':
            return t('table.types.assessment');
        default:
            return t('table.types.other');
    }
};

const stateLabel = (t: TFunction, state: CourseLessonState) =>
    state === 'EXCLUDED' ? t('table.types.assessment') : t(`states.${state}`);

interface CoverageLessonTableProps {
    packageId: string;
    lessons: CourseCoverageLesson[];
    /** Admin with paid processing available: may use a kept transcript. */
    canUsePaid?: boolean;
}

/**
 * Every lesson of the course with what the AI can read in it. Coverage
 * already carries the whole course, so filtering and paging are local.
 */
export const CoverageLessonTable = ({
    packageId,
    lessons,
    canUsePaid = false,
}: CoverageLessonTableProps) => {
    const { t } = useTranslation(NAMESPACE);
    const [filter, setFilter] = useState<StateFilter>('ALL');
    const [keptLesson, setKeptLesson] = useState<CourseCoverageLesson | null>(null);
    const [page, setPage] = useState(0);
    const { mutateAsync: retryMutate } = useRetryCourseLesson(packageId);

    const counts = useMemo(() => {
        const out = new Map<CourseLessonState, number>();
        lessons.forEach((lesson) => out.set(lesson.state, (out.get(lesson.state) ?? 0) + 1));
        return out;
    }, [lessons]);

    // A filter whose last lesson moved on (e.g. every FAILED lesson retried) falls back to All.
    useEffect(() => {
        if (filter !== 'ALL' && !counts.get(filter)) setFilter('ALL');
    }, [counts, filter]);

    const filtered = useMemo(
        () => (filter === 'ALL' ? lessons : lessons.filter((lesson) => lesson.state === filter)),
        [lessons, filter]
    );
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages - 1);

    const options = useMemo(
        () => [
            { value: 'ALL' as StateFilter, label: t('table.all', { count: lessons.length }) },
            ...STATE_ORDER.filter((state) => (counts.get(state) ?? 0) > 0).map((state) => ({
                value: state as StateFilter,
                label: t('table.stateWithCount', {
                    label: stateLabel(t, state),
                    count: counts.get(state) ?? 0,
                }),
            })),
        ],
        [counts, lessons.length, t]
    );

    const retryLesson = useCallback(
        async (slideId: string) => {
            try {
                await retryMutate(slideId);
                toast.success(t('table.retryQueued'));
            } catch (error) {
                toast.error(courseKnowledgeErrorMessage(error) ?? t('table.retryFailed'));
            }
        },
        [retryMutate, t]
    );

    const columns = useMemo<ColumnDef<CourseCoverageLesson>[]>(
        () => [
            {
                id: 'lesson',
                header: t('table.columns.lesson'),
                cell: ({ row }) => (
                    <span className="line-clamp-2 text-body font-medium text-neutral-800">
                        {row.original.title || t('table.untitled')}
                    </span>
                ),
            },
            {
                id: 'chapter',
                header: t('table.columns.chapter'),
                cell: ({ row }) => (
                    <span className="line-clamp-2 text-body text-neutral-600">
                        {row.original.chapter_name || '—'}
                    </span>
                ),
            },
            {
                id: 'type',
                header: t('table.columns.type'),
                cell: ({ row }) => (
                    <span className="text-body text-neutral-600">{typeLabel(t, row.original)}</span>
                ),
            },
            {
                id: 'state',
                header: t('table.columns.state'),
                cell: ({ row }) => (
                    <LessonStateChip
                        state={row.original.state}
                        label={stateLabel(t, row.original.state)}
                    />
                ),
            },
            {
                id: 'reason',
                header: t('table.columns.reason'),
                cell: ({ row }) =>
                    row.original.reason ? (
                        <span
                            className="line-clamp-2 text-caption text-neutral-500"
                            title={row.original.reason}
                        >
                            {row.original.reason}
                        </span>
                    ) : (
                        <span className="text-caption text-neutral-400">—</span>
                    ),
            },
            {
                id: 'credits',
                header: t('table.columns.credits'),
                cell: ({ row }) => {
                    const { credits, credits_charged: charged } = row.original;
                    if (Number(charged) > 0) {
                        return (
                            <span className="block text-end text-body text-neutral-700">
                                {t('table.creditsUsed', { credits: formatCredits(charged) })}
                            </span>
                        );
                    }
                    if (Number(credits) > 0) {
                        return (
                            <span className="block text-end text-body text-neutral-700">
                                {t('table.creditsQuoted', { credits: formatCredits(credits) })}
                            </span>
                        );
                    }
                    return <span className="block text-end text-caption text-neutral-400">—</span>;
                },
            },
            {
                id: 'action',
                header: t('table.columns.action'),
                cell: ({ row }) => {
                    if (row.original.state === 'FAILED') {
                        return (
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onAsyncClick={() => retryLesson(row.original.slide_id)}
                                loadingText={t('table.retry')}
                            >
                                <ArrowClockwise className="size-3.5" />
                                {t('table.retry')}
                            </MyButton>
                        );
                    }
                    if (row.original.state === 'CANT_READ' && row.original.kept_transcript && canUsePaid) {
                        return (
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={() => setKeptLesson(row.original)}
                            >
                                <Microphone className="size-3.5" />
                                {t('kept.action')}
                            </MyButton>
                        );
                    }
                    return null;
                },
            },
        ],
        [t, retryLesson, canUsePaid]
    );

    const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
    const tableData: TableData<CourseCoverageLesson> = {
        content: pageRows,
        total_pages: totalPages,
        page_no: currentPage,
        page_size: PAGE_SIZE,
        total_elements: filtered.length,
        last: currentPage + 1 >= totalPages,
    };

    return (
        <Card>
            <CardHeader className="gap-3 pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                    <ListChecks className="size-5 text-primary-500" />
                    {t('table.title')}
                </CardTitle>
                <ChipToggleGroup<StateFilter>
                    value={filter}
                    onChange={(value) => {
                        setFilter(value);
                        setPage(0);
                    }}
                    options={options}
                    ariaLabel={t('table.filterAria')}
                    variant="outline"
                />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {filtered.length === 0 ? (
                    <p className="py-6 text-center text-body text-neutral-500">
                        {t('table.noneInState')}
                    </p>
                ) : (
                    <>
                        <MyTable<CourseCoverageLesson>
                            data={tableData}
                            columns={columns}
                            isLoading={false}
                            error={null}
                            currentPage={currentPage}
                            enableColumnResizing={false}
                            scrollable
                        />
                        {totalPages > 1 && (
                            <MyPagination
                                currentPage={currentPage}
                                totalPages={totalPages}
                                totalElements={filtered.length}
                                pageSize={PAGE_SIZE}
                                onPageChange={setPage}
                            />
                        )}
                    </>
                )}
            </CardContent>
            <KeptTranscriptDialog
                packageId={packageId}
                slideId={keptLesson?.slide_id ?? null}
                title={keptLesson?.title ?? null}
                onOpenChange={(open) => {
                    if (!open) setKeptLesson(null);
                }}
            />
        </Card>
    );
};
