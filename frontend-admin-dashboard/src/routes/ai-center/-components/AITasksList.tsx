import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { handleGetListIndividualTopics } from '../-services/ai-center-service';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import AIQuestionsPreview from './AIQuestionsPreview';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import { getTaskTypeFromFeature } from '../-helpers/GetImagesForAITools';
import AIChatWithPDFPreview from './AIChatWithPDFPreview';
import AIPlanLecturePreview from './AIPlanLecturePreview';
import AIEvaluatePreview from './AIEvaluatePreview';
import {
    ArrowCounterClockwise,
    CaretLeft,
    CaretRight,
    DownloadSimple,
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
    friendlyHeading,
    relativeTime,
    statusLabel,
    statusStyles,
    taskDisplayName,
} from '../-utils/format';
import type { QuestionsFromTextData } from '../ai-tools/vsmart-prompt/-components/GenerateQuestionsFromText';
import { UseFormReturn } from 'react-hook-form';
import { SectionFormType } from '@/types/assessments/assessment-steps';
import { useAIQuestionDialogStore } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/zustand-global-states/ai-add-questions-dialog-zustand';

const FamilyIcon = ({ family }: { family: FileFamily }) => {
    const cls = 'text-primary-500';
    if (family === 'pdf') return <FilePdf size={20} weight="fill" className={cls} />;
    if (family === 'audio') return <FileAudio size={20} weight="fill" className={cls} />;
    if (family === 'image') return <FileImage size={20} weight="fill" className={cls} />;
    return <FileText size={20} weight="fill" className={cls} />;
};

type StatusFilter = 'all' | 'COMPLETED' | 'PROGRESS' | 'FAILED';

// value is the internal filter identifier used for logic/equality; label is the
// only user-facing part, so it's built from `t` rather than hardcoded.
const buildStatusFilters = (t: TFunction): Array<{ value: StatusFilter; label: string }> => [
    { value: 'all', label: t('statusFilters.all') },
    { value: 'COMPLETED', label: t('statusFilters.ready') },
    { value: 'PROGRESS', label: t('statusFilters.inProgress') },
    { value: 'FAILED', label: t('statusFilters.failed') },
];

// These identifiers double as record keys (see bucketForDate/groupedTasks below),
// so they stay as fixed English strings for logic; DATE_BUCKET_LABEL_KEYS maps
// each one to the translation key used only when rendering the bucket heading.
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

async function handleDownload(url: string, file_name: string) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = file_name;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
    } catch (error) {
        console.error('Download failed:', error);
    }
}

type TaskCardProps = {
    task: AITaskIndividualListInterface;
    heading: string;
    openedTaskId: string | null;
    setOpenedTaskId: Dispatch<SetStateAction<string | null>>;
    pollGenerateAssessment?: (prompt?: string, taskId?: string) => void;
    handleGenerateQuestionsForAssessment?: (
        pdfId?: string,
        prompt?: string,
        taskId?: string
    ) => void;
    pollGenerateQuestionsFromText?: (data: QuestionsFromTextData) => void;
    pollGenerateQuestionsFromAudio?: (data: QuestionsFromTextData, taskId: string) => void;
    sectionsForm?: UseFormReturn<SectionFormType>;
    currentSectionIndex?: number;
    allowSectionSplit?: boolean;
};

const TaskCard = ({
    task,
    heading,
    openedTaskId,
    setOpenedTaskId,
    pollGenerateAssessment,
    handleGenerateQuestionsForAssessment,
    pollGenerateQuestionsFromText,
    pollGenerateQuestionsFromAudio,
    sectionsForm,
    currentSectionIndex,
    allowSectionSplit,
}: TaskCardProps) => {
    const { t } = useTranslation('aiCenterAITasksList');
    const { t: tFormat } = useTranslation('aiCenterFormat');
    const family = classifyFile(task.file_detail?.file_type);
    const sourceLabel = buildSourceLabel(tFormat);
    const display = taskDisplayName(task, tFormat);

    // Each card derives its own open state from the parent's openedTaskId so only
    // the clicked card's preview auto-fetches — without this, every visible card's
    // preview-effect fires when any one of them opens.
    const isOpen = openedTaskId === task.id;
    const setIsOpen: Dispatch<SetStateAction<boolean>> = (val) => {
        const next = typeof val === 'function' ? val(isOpen) : val;
        setOpenedTaskId(next ? task.id : null);
    };

    return (
        <div className="group flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition-all hover:border-primary-200 hover:shadow-sm">
            <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                    <FamilyIcon family={family} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="break-words text-sm font-medium text-gray-900">
                        {display}
                    </span>
                    <span className="text-xs text-neutral-500">
                        {sourceLabel[family]} · {relativeTime(task.updated_at, tFormat)}
                    </span>
                </div>
                <span
                    className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-caption font-medium ring-1 ring-inset ${statusStyles(
                        task.status
                    )}`}
                >
                    {statusLabel(task.status, tFormat)}
                </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 pl-13">
                {task.status !== 'PROGRESS' && heading === 'Vsmart Feedback' && (
                    <AIEvaluatePreview
                        task={task}
                        openEvaluatePreview={isOpen}
                        setOpenEvaluatePreview={setIsOpen}
                    />
                )}
                {task.status !== 'PROGRESS' && heading === 'Vsmart Lecturer' && (
                    <AIPlanLecturePreview
                        task={task}
                        openPlanLecturePreview={isOpen}
                        setOpenPlanLecturePreview={setIsOpen}
                    />
                )}
                {task.status !== 'PROGRESS' && heading === 'Vsmart Chat' && (
                    <AIChatWithPDFPreview
                        task={task}
                        openAIPreview={isOpen}
                        setOpenAIPreview={setIsOpen}
                    />
                )}
                {heading !== 'Vsmart Lecturer' &&
                    heading !== 'Vsmart Chat' &&
                    heading !== 'Vsmart Feedback' &&
                    (task.status === 'COMPLETED' || task.status === 'FAILED') && (
                        <AIQuestionsPreview
                            task={task}
                            pollGenerateAssessment={pollGenerateAssessment}
                            handleGenerateQuestionsForAssessment={
                                handleGenerateQuestionsForAssessment
                            }
                            pollGenerateQuestionsFromText={pollGenerateQuestionsFromText}
                            pollGenerateQuestionsFromAudio={pollGenerateQuestionsFromAudio}
                            heading={heading}
                            openQuestionsPreview={isOpen}
                            setOpenQuestionsPreview={setIsOpen}
                            sectionsForm={sectionsForm}
                            currentSectionIndex={currentSectionIndex}
                            allowSectionSplit={allowSectionSplit}
                        />
                    )}
                {task.file_detail && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (task.file_detail) {
                                handleDownload(
                                    task.file_detail.url,
                                    task.file_detail.file_name
                                );
                            }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100"
                    >
                        <DownloadSimple size={14} />
                        {t('taskCard.download')}
                    </button>
                )}
            </div>
        </div>
    );
};

const AITasksList = ({
    heading,
    enableDialog = false,
    setEnableDialog,
    pollGenerateAssessment,
    handleGenerateQuestionsForAssessment,
    pollGenerateQuestionsFromText,
    pollGenerateQuestionsFromAudio,
    sectionsForm,
    currentSectionIndex,
    allowSectionSplit,
}: {
    heading: string;
    enableDialog?: boolean;
    setEnableDialog?: React.Dispatch<React.SetStateAction<boolean>>;
    pollGenerateAssessment?: (prompt?: string, taskId?: string) => void;
    handleGenerateQuestionsForAssessment?: (
        pdfId?: string,
        prompt?: string,
        taskId?: string
    ) => void;
    pollGenerateQuestionsFromText?: (data: QuestionsFromTextData) => void;
    pollGenerateQuestionsFromAudio?: (data: QuestionsFromTextData, taskId: string) => void;
    sectionsForm?: UseFormReturn<SectionFormType>;
    currentSectionIndex?: number;
    allowSectionSplit?: boolean;
}) => {
    const { t } = useTranslation('aiCenterAITasksList');
    const { t: tFormat } = useTranslation('aiCenterFormat');
    const { isAIQuestionDialog9, setIsAIQuestionDialog9 } = useAIQuestionDialogStore();

    const STATUS_FILTERS = useMemo(() => buildStatusFilters(t), [t]);

    const [openedTaskId, setOpenedTaskId] = useState<string | null>(null);
    const [allTasks, setAllTasks] = useState<AITaskIndividualListInterface[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    const getAITasksIndividualListMutation = useMutation({
        mutationFn: async ({ taskType }: { taskType: string }) => {
            return handleGetListIndividualTopics(taskType);
        },
        onSuccess: (response) => {
            setAllTasks(response);
        },
        onError: (error: unknown) => {
            console.log(error);
        },
    });

    const handleRefreshList = (taskType: string) => {
        getAITasksIndividualListMutation.mutate({ taskType });
    };

    const { mutate } = getAITasksIndividualListMutation;

    useEffect(() => {
        if (isAIQuestionDialog9 && !openedTaskId) {
            let count = 0;
            const maxRuns = 5;
            const interval = setInterval(() => {
                if (count >= maxRuns) {
                    clearInterval(interval);
                    return;
                }
                mutate({ taskType: getTaskTypeFromFeature(heading) });
                count++;
            }, 20000);

            return () => clearInterval(interval);
        }
        return () => {};
    }, [mutate, heading, isAIQuestionDialog9, openedTaskId]);

    useEffect(() => {
        const fetchTasks = async () => {
            setIsLoading(true);
            try {
                const taskType = getTaskTypeFromFeature(heading);
                const data = await handleGetListIndividualTopics(taskType);
                setAllTasks(data);
            } catch (error) {
                console.error('Failed to fetch tasks:', error);
                setAllTasks([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchTasks();
    }, [heading]);

    useEffect(() => {
        setIsAIQuestionDialog9(enableDialog);
    }, [enableDialog]);

    const handleCloseListDialog = () => {
        setIsAIQuestionDialog9(!isAIQuestionDialog9);
        setEnableDialog?.(false);
    };

    const friendly = friendlyHeading(heading, tFormat);
    const isLoadingState =
        getAITasksIndividualListMutation.status === 'pending' || isLoading;

    const filteredTasks = useMemo(() => {
        let result = allTasks;
        if (statusFilter !== 'all') {
            result = result.filter((task) => task.status === statusFilter);
        }
        const q = searchQuery.trim().toLowerCase();
        if (q) {
            result = result.filter((task) => {
                const display = taskDisplayName(task, tFormat).toLowerCase();
                const name = (task.task_name || '').toLowerCase();
                const file = (task.file_detail?.file_name || '').toLowerCase();
                return display.includes(q) || name.includes(q) || file.includes(q);
            });
        }
        return result;
    }, [allTasks, statusFilter, searchQuery, tFormat]);

    const sortedFiltered = useMemo(
        () =>
            [...filteredTasks].sort((a, b) =>
                a.updated_at < b.updated_at ? 1 : -1
            ),
        [filteredTasks]
    );

    const totalPages = Math.max(1, Math.ceil(sortedFiltered.length / ITEMS_PER_PAGE));
    const safePage = Math.min(page, totalPages);

    useEffect(() => {
        setPage(1);
    }, [searchQuery, statusFilter]);

    const pagedTasks = useMemo(() => {
        const start = (safePage - 1) * ITEMS_PER_PAGE;
        return sortedFiltered.slice(start, start + ITEMS_PER_PAGE);
    }, [sortedFiltered, safePage]);

    const groupedTasks = useMemo(() => {
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

    const statusCounts = useMemo(() => {
        const counts: Record<StatusFilter, number> = {
            all: allTasks.length,
            COMPLETED: 0,
            PROGRESS: 0,
            FAILED: 0,
        };
        for (const task of allTasks) {
            if (task.status === 'COMPLETED') counts.COMPLETED++;
            else if (task.status === 'FAILED') counts.FAILED++;
            else counts.PROGRESS++;
        }
        return counts;
    }, [allTasks]);

    const hasAnyResult = filteredTasks.length > 0;
    const hasAnyTasks = allTasks.length > 0;

    return (
        <Dialog open={isAIQuestionDialog9} onOpenChange={handleCloseListDialog}>
            {!setEnableDialog && (
                <DialogTrigger
                    asChild
                    onClick={(e) => {
                        e.stopPropagation();
                    }}
                >
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="border-none font-normal !text-blue-600 shadow-none hover:bg-transparent focus:bg-transparent focus:outline-none focus:ring-0 active:bg-transparent"
                    >
                        {t('dialog.viewAll')}
                    </MyButton>
                </DialogTrigger>
            )}
            <DialogContent
                onClick={(e) => e.stopPropagation()}
                className={/* design-lint-ignore: viewport-sized dialog has no spacing token */ 'no-scrollbar !m-0 flex h-[90vh] w-[90vw] max-w-none flex-col !gap-0 overflow-hidden !p-0'}
            >
                <div className="sticky top-0 z-10 flex flex-col gap-4 border-b border-neutral-200 bg-white p-5">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex flex-col gap-0.5">
                            <h2 className="text-lg font-semibold text-gray-900">{friendly}</h2>
                            {!isLoadingState && (
                                <p className="text-xs text-neutral-500">
                                    {allTasks.length === 0
                                        ? t('emptyState.nothingHereYet')
                                        : t('dialog.itemCount', { count: allTasks.length })}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() =>
                                    handleRefreshList(getTaskTypeFromFeature(heading))
                                }
                                className="rounded-lg border border-neutral-200 p-2 text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
                                aria-label={t('dialog.refresh')}
                            >
                                <ArrowCounterClockwise size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={handleCloseListDialog}
                                className="rounded-lg border border-neutral-200 p-2 text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
                                aria-label={t('dialog.close')}
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {hasAnyTasks && (
                        <>
                            <div className="relative">
                                <MagnifyingGlass
                                    size={14}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                                />
                                <input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={t('dialog.searchPlaceholder')}
                                    className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-9 text-sm placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                                        aria-label={t('dialog.clearSearch')}
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {STATUS_FILTERS.map((f) => {
                                    const active = statusFilter === f.value;
                                    const count = statusCounts[f.value];
                                    return (
                                        <button
                                            key={f.value}
                                            type="button"
                                            onClick={() => setStatusFilter(f.value)}
                                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                                                active
                                                    ? 'border-primary-300 bg-primary-50 text-primary-600'
                                                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-200'
                                            }`}
                                        >
                                            {f.label}
                                            <span
                                                className={`inline-flex min-w-5 items-center justify-center rounded px-1 text-caption ${
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

                {isLoadingState ? (
                    <DashboardLoader />
                ) : !hasAnyTasks ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                        <Sparkle size={28} weight="fill" className="text-primary-300" />
                        <p className="text-sm font-medium text-gray-900">
                            {t('emptyState.nothingHereYet')}
                        </p>
                        <p className="max-w-xs text-xs text-neutral-500">
                            {t('emptyState.nothingHereYetDescription')}
                        </p>
                    </div>
                ) : !hasAnyResult ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                        <MagnifyingGlass size={24} className="text-neutral-300" />
                        <p className="text-sm font-medium text-gray-900">
                            {t('emptyState.noMatches')}
                        </p>
                        <p className="max-w-xs text-xs text-neutral-500">
                            {t('emptyState.noMatchesDescription')}
                        </p>
                        {(searchQuery || statusFilter !== 'all') && (
                            <button
                                type="button"
                                onClick={() => {
                                    setSearchQuery('');
                                    setStatusFilter('all');
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
                            const tasks = groupedTasks[bucket];
                            if (tasks.length === 0) return null;
                            return (
                                <section key={bucket} className="flex flex-col gap-3">
                                    <div className="flex items-baseline gap-2">
                                        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                            {t(DATE_BUCKET_LABEL_KEYS[bucket])}
                                        </h3>
                                        <span className="text-caption text-neutral-400">
                                            {tasks.length}
                                        </span>
                                    </div>
                                    <div className="flex flex-col gap-3">
                                        {tasks.map((task) => (
                                            <TaskCard
                                                key={task.id}
                                                task={task}
                                                heading={heading}
                                                openedTaskId={openedTaskId}
                                                setOpenedTaskId={setOpenedTaskId}
                                                pollGenerateAssessment={
                                                    pollGenerateAssessment
                                                }
                                                handleGenerateQuestionsForAssessment={
                                                    handleGenerateQuestionsForAssessment
                                                }
                                                pollGenerateQuestionsFromText={
                                                    pollGenerateQuestionsFromText
                                                }
                                                pollGenerateQuestionsFromAudio={
                                                    pollGenerateQuestionsFromAudio
                                                }
                                                sectionsForm={sectionsForm}
                                                currentSectionIndex={currentSectionIndex}
                                                allowSectionSplit={allowSectionSplit}
                                            />
                                        ))}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
                {hasAnyResult && totalPages > 1 && (
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

export default AITasksList;
