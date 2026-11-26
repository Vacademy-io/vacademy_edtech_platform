import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowClockwise,
    ArrowLeft,
    ArrowSquareOut,
    BookOpenText,
    ChatCenteredText,
    UserCircleMinus,
    WarningCircle,
} from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import {
    markSyllabusProgress,
    syllabusErrorMessage,
    syllabusProgressKeys,
    isSyllabusForbidden,
    useSyllabusLearner,
    type SyllabusLearnerBlock,
    type SyllabusLearnerCourse,
    type SyllabusProgressEntry,
} from '@/services/syllabus-progress';
import { STATUS_META, blockLongLabel, formatDate } from './status-meta';
import { CellDialog, type MarkPayload } from './CellDialog';
import { EmptyState } from './EmptyState';

/** The learner's block as a grid entry, for CellDialog; undefined when never marked. */
const toEntry = (userId: string, block: SyllabusLearnerBlock): SyllabusProgressEntry | undefined =>
    block.updated_at
        ? {
              user_id: userId,
              block_id: block.id,
              status: block.status,
              started_on: block.started_on,
              completed_on: block.completed_on,
              points_done: block.points_done,
              teacher_note: block.teacher_note,
              marked_by_name: block.marked_by_name,
              updated_at: block.updated_at,
          }
        : undefined;

/** One learner (picked from the name search) across each of their batches with a syllabus. */
export function LearnerProgress({
    instituteId,
    userId,
    onBack,
    onOpenBatch,
}: {
    instituteId: string;
    userId: string;
    onBack: () => void;
    onOpenBatch: (packageSessionId: string) => void;
}) {
    const { t } = useTranslation('syllabusProgress');
    const queryClient = useQueryClient();
    const { data, isLoading, isError, error, refetch, isFetching } = useSyllabusLearner(
        instituteId,
        userId
    );
    const [cell, setCell] = useState<{ psId: string; blockId: string } | null>(null);

    const { mutateAsync: mark } = useMutation({
        mutationFn: ({ psId, payload }: { psId: string; payload: MarkPayload }) =>
            markSyllabusProgress(instituteId, { package_session_id: psId, ...payload }),
        onSuccess: (res, { psId }) => {
            toast.success(t('toast.saved', { count: res?.updated ?? 0 }));
            void queryClient.invalidateQueries({
                queryKey: syllabusProgressKeys.learner(instituteId, userId),
            });
            void queryClient.invalidateQueries({
                queryKey: syllabusProgressKeys.batch(instituteId, psId),
            });
        },
        onError: (err) => toast.error(syllabusErrorMessage(err, t('toast.saveFailed'))),
    });

    const backButton = (
        <MyButton type="button" buttonType="secondary" scale="medium" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden /> {t('learner.back')}
        </MyButton>
    );

    if (isLoading) {
        return (
            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                <Skeleton className="h-7 w-48" />
                {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                ))}
            </div>
        );
    }

    if (isError && isSyllabusForbidden(error)) {
        return (
            <div className="space-y-4">
                {backButton}
                <EmptyState
                    icon={<UserCircleMinus className="size-8" aria-hidden />}
                    title={t('learner.notYoursTitle')}
                    body={t('learner.notYoursBody')}
                />
            </div>
        );
    }

    if (isError || !data) {
        return (
            <div className="space-y-4">
                {backButton}
                <Alert variant="destructive">
                    <WarningCircle className="size-4" />
                    <AlertTitle>{t('learner.loadFailed')}</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center gap-3">
                        {syllabusErrorMessage(error, t('learner.loadFailedHint'))}
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => void refetch()}
                        >
                            <ArrowClockwise className="size-4" aria-hidden /> {t('retry')}
                        </MyButton>
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    const learner = {
        user_id: data.user_id,
        full_name: data.full_name,
        enrollment_number: data.enrollment_number,
    };
    const cellCourse = cell
        ? data.courses.find((c) => c.package_session_id === cell.psId)
        : undefined;
    const cellBlock = cell ? cellCourse?.blocks.find((b) => b.id === cell.blockId) : undefined;

    return (
        <div className={cn('space-y-4 transition-opacity', isFetching && 'opacity-70')}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <h2 className="text-h3-semibold text-neutral-900">{data.full_name}</h2>
                    {data.enrollment_number && (
                        <p className="text-caption text-neutral-500">
                            {t('grid.enrollment', { number: data.enrollment_number })}
                        </p>
                    )}
                </div>
                {backButton}
            </div>

            {data.courses.length === 0 ? (
                <EmptyState
                    icon={<BookOpenText className="size-8" aria-hidden />}
                    title={t('learner.noCoursesTitle')}
                    body={t('learner.noCoursesBody')}
                />
            ) : (
                data.courses.map((course) => (
                    <CourseCard
                        key={course.package_session_id}
                        course={course}
                        onOpenBatch={onOpenBatch}
                        onOpenBlock={(blockId) =>
                            setCell({ psId: course.package_session_id, blockId })
                        }
                    />
                ))
            )}

            {cell && cellBlock && (
                <CellDialog
                    key={`${cell.psId}:${cell.blockId}`}
                    open
                    onOpenChange={(open) => !open && setCell(null)}
                    learner={learner}
                    block={cellBlock}
                    entry={toEntry(data.user_id, cellBlock)}
                    onSave={async (payload) => {
                        await mark({ psId: cell.psId, payload });
                        setCell(null);
                    }}
                />
            )}
        </div>
    );
}

function CourseCard({
    course,
    onOpenBatch,
    onOpenBlock,
}: {
    course: SyllabusLearnerCourse;
    onOpenBatch: (packageSessionId: string) => void;
    onOpenBlock: (blockId: string) => void;
}) {
    const { t, i18n } = useTranslation('syllabusProgress');
    return (
        <section className="rounded-lg border border-border bg-card">
            <header className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <h3 className="text-subtitle font-semibold text-neutral-800">
                        {t('search.batchName', {
                            course: course.course_name,
                            stage: course.level_name,
                            batch: course.batch_name,
                        })}
                    </h3>
                    <p className="text-caption text-neutral-500">
                        {t('learner.summary', {
                            done: course.completed_blocks,
                            total: course.total_blocks,
                        })}
                    </p>
                </div>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    className="shrink-0"
                    onClick={() => onOpenBatch(course.package_session_id)}
                >
                    <ArrowSquareOut className="size-4" aria-hidden /> {t('learner.openBatch')}
                </MyButton>
            </header>
            <p className="px-4 pt-3 text-caption text-neutral-500">{t('learner.markHint')}</p>
            <ul className="divide-y divide-border p-2">
                {course.blocks.map((block) => {
                    const meta = STATUS_META[block.status] ?? STATUS_META.NOT_STARTED;
                    const Icon = meta.icon;
                    const updated = formatDate(block.updated_at, i18n.language);
                    const isCurrent = course.current_block_id === block.id;
                    return (
                        <li key={block.id}>
                            <button
                                type="button"
                                onClick={() => onOpenBlock(block.id)}
                                className="flex w-full flex-col gap-1 rounded-md px-2 py-3 text-start hover:bg-primary-50 focus-visible:bg-primary-50 focus-visible:outline-none sm:flex-row sm:items-start sm:gap-4"
                            >
                                <span className="flex min-w-0 flex-1 flex-col gap-1">
                                    <span className="flex flex-wrap items-center gap-2">
                                        <span className="text-body font-semibold text-neutral-800">
                                            {blockLongLabel(block, t)}
                                        </span>
                                        {isCurrent && (
                                            <span className="rounded-sm bg-primary-50 px-2 text-caption text-primary-500">
                                                {t('learner.current')}
                                            </span>
                                        )}
                                    </span>
                                    {block.points.length > 0 && (
                                        <span className="text-caption text-neutral-600">
                                            {t('grid.pointsOf', {
                                                done: block.points_done?.length ?? 0,
                                                total: block.points.length,
                                            })}
                                        </span>
                                    )}
                                    {block.teacher_note && (
                                        <span className="flex items-start gap-1 text-caption text-neutral-700">
                                            <ChatCenteredText
                                                className="mt-0.5 size-4 shrink-0 text-primary-500"
                                                weight="fill"
                                                aria-label={t('legend.note')}
                                            />
                                            <span className="break-words">
                                                {block.teacher_note}
                                            </span>
                                        </span>
                                    )}
                                    {updated && (
                                        <span className="text-caption text-neutral-500">
                                            {block.marked_by_name
                                                ? t('dialog.lastMarkedBy', {
                                                      name: block.marked_by_name,
                                                      date: updated,
                                                  })
                                                : t('dialog.lastMarked', { date: updated })}
                                        </span>
                                    )}
                                </span>
                                <span
                                    className={cn(
                                        'flex shrink-0 items-center gap-1 text-body',
                                        meta.text
                                    )}
                                >
                                    <Icon className="size-4" weight="fill" aria-hidden />
                                    {t(meta.labelKey)}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
