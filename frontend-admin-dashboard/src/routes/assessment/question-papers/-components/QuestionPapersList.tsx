import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, DotsThree, Eye, Shuffle, Star } from '@phosphor-icons/react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MyPagination } from '@/components/design-system/pagination';
import ViewQuestionPaper from './ViewQuestionPaper';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getQuestionPaperById, markQuestionPaperStatus } from '../-utils/question-paper-services';
import {
    PaginatedResponse,
    QuestionPaperInterface,
} from '@/types/assessments/question-paper-template';
import {
    getLevelNameById,
    getSubjectNameById,
    transformResponseDataToMyQuestionsSchema,
} from '../-utils/helper';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import useDialogStore from '../-global-states/question-paper-dialogue-close';
import { MyQuestion } from '@/types/assessments/question-paper-form';
import { z } from 'zod';
import sectionDetailsSchema from '../../create-assessment/$assessmentId/$examtype/-utils/section-details-schema';
import { UseFormReturn } from 'react-hook-form';
import { Dispatch, Fragment, SetStateAction, useEffect, useMemo, useState } from 'react';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import ExportQuestionPaper from './export-question-paper/ExportQuestionPaper';
import { AssignmentFormType } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-form-schemas/assignmentFormSchema';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { describeMerge, mergeSectionQuestions } from '../-utils/merge-section-questions';
import { calculateTotalMarks } from '../../create-assessment/$assessmentId/$examtype/-utils/helper';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { QuestionPaperCard } from './QuestionPaperCard';
import { dateGroupKey, PaperSort } from '../-utils/question-paper-list';
import { useRefetchStore } from '../-global-states/refetch-store';
export type SectionFormType = z.infer<typeof sectionDetailsSchema>;

// Picks N random questions per tag (as configured in `tagCounts`) and merges
// them, de-duplicating any question that matches more than one selected tag.
const selectQuestionsByTags = (
    questions: MyQuestion[],
    tagCounts: Record<string, string>
): MyQuestion[] => {
    const picked = new Map<string, MyQuestion>();
    Object.entries(tagCounts).forEach(([tag, raw]) => {
        const n = parseInt(raw || '0');
        if (!n || n <= 0) return;
        const pool = questions.filter((q) => (q.tags ?? []).includes(tag));
        [...pool]
            .sort(() => Math.random() - 0.5)
            .slice(0, n)
            .forEach((q) => {
                const key = q.questionId ?? q.id;
                if (key) picked.set(key, q);
            });
    });
    return Array.from(picked.values());
};

export const QuestionPapersList = ({
    questionPaperList,
    pageNo,
    handlePageChange,
    refetchData,
    isAssessment,
    index,
    sectionsForm,
    studyLibraryAssignmentForm,
    isStudyLibraryAssignment,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    examType,
    onManualSelectionReady,
    sortOrder = 'NEWEST',
}: {
    questionPaperList: PaginatedResponse;
    pageNo: number;
    handlePageChange: (newPage: number) => void;
    refetchData: () => void;
    isAssessment: boolean;
    index?: number;
    sectionsForm?: UseFormReturn<SectionFormType>;
    studyLibraryAssignmentForm?: UseFormReturn<AssignmentFormType>;
    isStudyLibraryAssignment?: boolean;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
    examType?: string;
    onManualSelectionReady?: (questions: MyQuestion[]) => void;
    // Question Papers page only: date headers are shown for the date sorts.
    sortOrder?: PaperSort;
}) => {
    const { t, i18n } = useTranslation('assessmentQuestionPapersList');
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];

    const { setIsSavedQuestionPaperDialogOpen } = useDialogStore();
    const { instituteDetails } = useInstituteDetailsStore();

    // Selection config state — shown after user clicks a paper in assessment mode
    const [pendingPaper, setPendingPaper] = useState<QuestionPaperInterface | null>(null);
    const [selectionMode, setSelectionMode] = useState<'all' | 'random' | 'manual' | 'tags'>('all');
    const [questionCount, setQuestionCount] = useState('');
    // Per-tag desired counts for the "Random by Tag" mode, keyed by tag name.
    const [tagCounts, setTagCounts] = useState<Record<string, string>>({});

    const resetSelectionConfig = () => {
        setPendingPaper(null);
        setSelectionMode('all');
        setQuestionCount('');
        setTagCounts({});
    };

    // Eagerly load the picked paper's questions so we can show the available
    // tags (and per-tag counts) before the user confirms their selection.
    const paperQuery = useQuery({
        queryKey: ['GET_QUESTION_PAPER_BY_ID', pendingPaper?.id],
        queryFn: () => getQuestionPaperById(pendingPaper?.id),
        enabled: !!pendingPaper,
        staleTime: 60 * 60 * 1000,
    });

    const paperQuestions = useMemo<MyQuestion[]>(
        () =>
            paperQuery.data
                ? transformResponseDataToMyQuestionsSchema(paperQuery.data.question_dtolist)
                : [],
        [paperQuery.data]
    );

    // Distinct tags present on this paper's questions, with how many questions
    // carry each tag. Drives whether the "Random by Tag" option is shown at all.
    const availableTags = useMemo(() => {
        const counts = new Map<string, number>();
        paperQuestions.forEach((q) =>
            (q.tags ?? []).forEach((tg) => counts.set(tg, (counts.get(tg) ?? 0) + 1))
        );
        return Array.from(counts.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => a.tag.localeCompare(b.tag));
    }, [paperQuestions]);

    const setTagCount = (tag: string, value: string, max: number) => {
        if (value === '') {
            setTagCounts((prev) => ({ ...prev, [tag]: '' }));
            return;
        }
        const n = Math.max(0, Math.min(parseInt(value) || 0, max));
        setTagCounts((prev) => ({ ...prev, [tag]: String(n) }));
    };

    const handleMarkQuestionPaperStatus = useMutation({
        mutationFn: ({
            status,
            questionPaperId,
            instituteId,
        }: {
            status: string;
            questionPaperId: string;
            instituteId: string | undefined;
        }) => markQuestionPaperStatus(status, questionPaperId, instituteId),
        onSuccess: () => {
            refetchData();
        },
        onError: (error: unknown) => {
            // Was console.error only, so a failed favourite/delete looked like it worked.
            console.error(error);
            toast.error('Could not update this question paper. Please try again.');
        },
    });

    const handleMarkFavourite = (questionPaperId: string, status: string) => {
        handleMarkQuestionPaperStatus.mutate({
            status: status === 'FAVOURITE' ? 'ACTIVE' : 'FAVOURITE',
            questionPaperId,
            instituteId: INSTITUTE_ID,
        });
    };

    const handleDeleteQuestionPaper = (questionPaperId: string) => {
        handleMarkQuestionPaperStatus.mutate({
            status: 'DELETE',
            questionPaperId,
            instituteId: INSTITUTE_ID,
        });
    };

    // ---- Question Papers page (isAssessment false) ----
    const { t: tPage } = useTranslation('assessmentQuestionPapersPage');
    const [pendingDelete, setPendingDelete] = useState<QuestionPaperInterface | null>(null);
    const justAddedId = useRefetchStore((s) => s.justAddedId);
    const setJustAddedId = useRefetchStore((s) => s.setJustAddedId);

    // The "Just added" highlight fades after a while.
    useEffect(() => {
        if (!justAddedId) return;
        const timer = setTimeout(() => setJustAddedId(null), 10000);
        return () => clearTimeout(timer);
    }, [justAddedId, setJustAddedId]);

    const toggleFavouriteOnPage = (paper: QuestionPaperInterface) => {
        handleMarkQuestionPaperStatus.mutate(
            {
                status: paper.status === 'FAVOURITE' ? 'ACTIVE' : 'FAVOURITE',
                questionPaperId: paper.id,
                instituteId: INSTITUTE_ID,
            },
            {
                onSuccess: () =>
                    toast.success(
                        paper.status === 'FAVOURITE'
                            ? tPage('list.removedFromFavourites')
                            : tPage('list.addedToFavourites')
                    ),
            }
        );
    };

    // Delete now asks first, and the toast offers Undo (the same status call, back to
    // what the paper was before).
    const confirmDelete = () => {
        const paper = pendingDelete;
        setPendingDelete(null);
        if (!paper) return;
        const previousStatus = paper.status === 'FAVOURITE' ? 'FAVOURITE' : 'ACTIVE';
        handleMarkQuestionPaperStatus.mutate(
            { status: 'DELETE', questionPaperId: paper.id, instituteId: INSTITUTE_ID },
            {
                onSuccess: () =>
                    toast.success(tPage('list.deleted', { title: paper.title }), {
                        action: {
                            label: tPage('list.undo'),
                            onClick: () =>
                                handleMarkQuestionPaperStatus.mutate(
                                    {
                                        status: previousStatus,
                                        questionPaperId: paper.id,
                                        instituteId: INSTITUTE_ID,
                                    },
                                    { onSuccess: () => toast.success(tPage('list.restored')) }
                                ),
                        },
                    }),
            }
        );
    };

    const handleGetQuestionPaperData = useMutation({
        mutationFn: ({ id }: { id: string }) => getQuestionPaperById(id),
        onSuccess: async (data, { id }) => {
            const transformQuestionsData: MyQuestion[] = transformResponseDataToMyQuestionsSchema(
                data.question_dtolist
            );

            // Manual mode: close outer dialog, then hand questions to parent for standalone selector
            if (selectionMode === 'manual' && sectionsForm && index !== undefined) {
                setIsSavedQuestionPaperDialogOpen(false);
                resetSelectionConfig();
                onManualSelectionReady?.(transformQuestionsData);
                return;
            }

            setIsSavedQuestionPaperDialogOpen(false);
            resetSelectionConfig();
            if (isStudyLibraryAssignment) {
                studyLibraryAssignmentForm?.setValue('uploaded_question_paper', id);
                studyLibraryAssignmentForm?.setValue(
                    `adaptive_marking_for_each_question`,
                    transformQuestionsData.map((question) => {
                        let rawOptions: { id?: string; name?: string }[] = [];
                        if (question.questionType === 'MCQS' || question.questionType === 'CMCQS') {
                            rawOptions = question.singleChoiceOptions || question.csingleChoiceOptions || [];
                        } else if (question.questionType === 'MCQM' || question.questionType === 'CMCQM') {
                            rawOptions = question.multipleChoiceOptions || question.cmultipleChoiceOptions || [];
                        } else if (question.questionType === 'TRUE_FALSE') {
                            rawOptions = question.trueFalseOptions || [];
                        }
                        return {
                            questionId: question.questionId,
                            questionName: question.questionName,
                            questionType: question.questionType,
                            newQuestion: true,
                            options: rawOptions
                                .filter((opt) => opt.id || opt.name)
                                .map((opt) => ({
                                    id: opt.id || '',
                                    text: { content: opt.name || '' },
                                })),
                        };
                    })
                );
            }
            if (sectionsForm && index !== undefined) {
                let questionsToUse = transformQuestionsData;
                if (selectionMode === 'random') {
                    const count = parseInt(questionCount || '0');
                    if (count > 0 && count < questionsToUse.length) {
                        questionsToUse = [...questionsToUse]
                            .sort(() => Math.random() - 0.5)
                            .slice(0, count);
                    }
                }
                sectionsForm.setValue(
                    `section.${index}.adaptive_marking_for_each_question`,
                    questionsToUse.map((question) => ({
                        questionId: question.questionId,
                        questionName: question.questionName,
                        questionType: question.questionType,
                        questionMark: question.questionMark,
                        questionPenalty: question.questionPenalty,
                        ...(question.questionType === 'MCQM' && {
                            correctOptionIdsCnt: question?.multipleChoiceOptions?.filter(
                                (item) => item.isSelected
                            ).length,
                        }),
                        questionDuration: {
                            hrs: question.questionDuration.hrs,
                            min: question.questionDuration.min,
                        },
                    }))
                );
                sectionsForm.trigger(`section.${index}.adaptive_marking_for_each_question`);
            }
        },
        onError: (error: unknown) => {
            console.error(error);
        },
    });

    const handleConfirmSelection = () => {
        if (!pendingPaper || !sectionsForm || index === undefined) return;
        const id = pendingPaper.id;
        const questions = paperQuestions;

        const currentSection = sectionsForm.getValues(`section.${index}`);
        const subjectName = getSubjectNameById(
            instituteDetails?.subjects || [],
            pendingPaper.subject_id
        );
        const newSectionName =
            currentSection.sectionName &&
            currentSection.sectionName !== 'N/A' &&
            currentSection.sectionName !== '' &&
            !currentSection.sectionName.startsWith('Section ')
                ? currentSection.sectionName
                : (subjectName && subjectName !== 'N/A'
                      ? subjectName
                      : currentSection.sectionName) || `Section ${index + 1}`;
        sectionsForm.setValue(`section.${index}`, {
            ...currentSection,
            questionPaperTitle: pendingPaper.title,
            subject: subjectName,
            yearClass: getLevelNameById(instituteDetails?.levels || [], pendingPaper.level_id),
            sectionName: newSectionName,
            uploaded_question_paper: id,
        });

        // Manual mode: hand the questions to the standalone selector.
        if (selectionMode === 'manual') {
            setIsSavedQuestionPaperDialogOpen(false);
            resetSelectionConfig();
            onManualSelectionReady?.(questions);
            return;
        }

        let questionsToUse = questions;
        if (selectionMode === 'random') {
            const count = parseInt(questionCount || '0');
            if (count > 0 && count < questionsToUse.length) {
                questionsToUse = [...questionsToUse]
                    .sort(() => Math.random() - 0.5)
                    .slice(0, count);
            }
        } else if (selectionMode === 'tags') {
            questionsToUse = selectQuestionsByTags(questions, tagCounts);
        }

        const incoming = questionsToUse.map((question) => ({
            questionId: question.questionId,
            questionName: question.questionName,
            questionType: question.questionType,
            questionMark: question.questionMark,
            questionPenalty: question.questionPenalty,
            ...(question.questionType === 'MCQM' && {
                correctOptionIdsCnt: question?.multipleChoiceOptions?.filter(
                    (item) => item.isSelected
                ).length,
            }),
            questionDuration: {
                hrs: question.questionDuration.hrs,
                min: question.questionDuration.min,
            },
        }));

        // Append: picking a second saved paper for the same section used to discard
        // everything the first one put there.
        const mergeResult = mergeSectionQuestions(
            sectionsForm.getValues(`section.${index}.adaptive_marking_for_each_question`) as
                | typeof incoming
                | undefined,
            incoming
        );

        sectionsForm.setValue(
            `section.${index}.adaptive_marking_for_each_question`,
            mergeResult.merged
        );
        // The section total is derived from its questions, and the effect that keeps it
        // in sync only watches marks_per_question — so adding questions has to update it
        // here, exactly as the knowledge-base dialog does.
        sectionsForm.setValue(
            `section.${index}.total_marks`,
            String(calculateTotalMarks(mergeResult.merged))
        );
        sectionsForm.trigger(`section.${index}.adaptive_marking_for_each_question`);
        toast.success(describeMerge(mergeResult));
        setIsSavedQuestionPaperDialogOpen(false);
        resetSelectionConfig();
    };

    const handleGetQuestionPaperDataById = (questionsData: QuestionPaperInterface) => {
        // In assessment mode, show selection config before loading
        if (isAssessment && index !== undefined) {
            setPendingPaper(questionsData);
            return;
        }

        const id = questionsData.id;

        if (sectionsForm && index !== undefined) {
            const currentSection = sectionsForm.getValues(`section.${index}`);
            const subjectName = getSubjectNameById(
                instituteDetails?.subjects || [],
                questionsData.subject_id
            );

            const newSectionName = currentSection.sectionName &&
                           currentSection.sectionName !== 'N/A' &&
                           currentSection.sectionName !== '' &&
                           !currentSection.sectionName.startsWith('Section ')
                    ? currentSection.sectionName
                    : ((subjectName && subjectName !== 'N/A') ? subjectName : currentSection.sectionName) || `Section ${index + 1}`;

            sectionsForm.setValue(`section.${index}`, {
                ...currentSection,
                questionPaperTitle: questionsData.title,
                subject: subjectName,
                yearClass: getLevelNameById(instituteDetails?.levels || [], questionsData.level_id),
                sectionName: newSectionName,
                uploaded_question_paper: id,
            });
        }

        handleGetQuestionPaperData.mutate({ id });
    };

    if (
        (index !== undefined || isStudyLibraryAssignment) &&
        handleGetQuestionPaperData.status === 'pending'
    )
        return <DashboardLoader />;

    // Selection config step — shown after user picks a paper in assessment mode
    if (pendingPaper) {
        const count = parseInt(questionCount || '0');
        const tagsTotal = Object.values(tagCounts).reduce(
            (sum, v) => sum + (parseInt(v || '0') || 0),
            0
        );
        const isLoadingPaper = paperQuery.isLoading || !paperQuery.data;
        const isCountValid =
            selectionMode === 'all' || selectionMode === 'manual'
                ? true
                : selectionMode === 'random'
                  ? count > 0
                  : tagsTotal > 0;
        return (
            <div className="mt-4 w-full overflow-x-hidden flex flex-col gap-6 px-1">
                <button
                    type="button"
                    className="flex items-center gap-1 self-start text-sm text-neutral-500 hover:text-neutral-700"
                    onClick={resetSelectionConfig}
                >
                    <ArrowLeft size={14} />
                    {t('config.backToList')}
                </button>

                <div className="w-full rounded-lg border border-neutral-200 bg-primary-50 p-4">
                    <p className="truncate text-sm font-medium text-neutral-800">{pendingPaper.title}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                        {t('config.createdOn', {
                            date: new Date(pendingPaper.created_on).toLocaleDateString(
                                i18n.language
                            ),
                        })}
                    </p>
                </div>

                <div className="flex w-full flex-col gap-3">
                    <p className="text-sm font-medium text-neutral-700">
                        {t('config.selectQuestionCount')}
                    </p>
                    {isLoadingPaper ? (
                        <DashboardLoader />
                    ) : (
                        <RadioGroup
                            value={selectionMode}
                            onValueChange={(v) => {
                                setSelectionMode(v as 'all' | 'random' | 'manual' | 'tags');
                                setQuestionCount('');
                                setTagCounts({});
                            }}
                            className="flex flex-col gap-3"
                        >
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="all" id="config-all" />
                                <label
                                    htmlFor="config-all"
                                    className="cursor-pointer text-sm text-neutral-700"
                                >
                                    {t('config.modeAll')}
                                </label>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <RadioGroupItem value="random" id="config-random" />
                                <label
                                    htmlFor="config-random"
                                    className="cursor-pointer text-sm text-neutral-700"
                                >
                                    {t('config.modeRandom')}
                                </label>
                                {selectionMode === 'random' && (
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="number"
                                            placeholder={t('config.randomPlaceholder')}
                                            min={1}
                                            className="h-8 w-24"
                                            value={questionCount}
                                            onChange={(e) => setQuestionCount(e.target.value)}
                                        />
                                        <span className="text-xs text-neutral-400">
                                            {t('config.questionsLabel')}
                                        </span>
                                    </div>
                                )}
                            </div>
                            {availableTags.length > 0 && (
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center gap-2">
                                        <RadioGroupItem value="tags" id="config-tags" />
                                        <label
                                            htmlFor="config-tags"
                                            className="cursor-pointer text-sm text-neutral-700"
                                        >
                                            {t('config.modeTags')}
                                        </label>
                                    </div>
                                    {selectionMode === 'tags' && (
                                        <div className="ml-6 flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                                            {availableTags.map(({ tag, count: available }) => (
                                                <div
                                                    key={tag}
                                                    className="flex items-center justify-between gap-3"
                                                >
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <span className="truncate text-sm text-neutral-700">
                                                            {tag}
                                                        </span>
                                                        <span className="shrink-0 text-xs text-neutral-400">
                                                            (
                                                            {t('config.tagAvailable', {
                                                                count: available,
                                                            })}
                                                            )
                                                        </span>
                                                    </div>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        max={available}
                                                        placeholder="0"
                                                        className="h-8 w-20"
                                                        value={tagCounts[tag] ?? ''}
                                                        onChange={(e) =>
                                                            setTagCount(
                                                                tag,
                                                                e.target.value,
                                                                available
                                                            )
                                                        }
                                                    />
                                                </div>
                                            ))}
                                            <div className="mt-1 flex items-center justify-between border-t border-neutral-200 pt-2">
                                                <span className="text-sm font-medium text-neutral-700">
                                                    {t('config.total')}
                                                </span>
                                                <span className="text-sm font-medium text-primary-600">
                                                    {t('config.totalQuestions', { count: tagsTotal })}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="manual" id="config-manual" />
                                <label
                                    htmlFor="config-manual"
                                    className="cursor-pointer text-sm text-neutral-700"
                                >
                                    {t('config.modeManual')}
                                </label>
                                {selectionMode === 'manual' && (
                                    <span className="text-xs text-neutral-400">
                                        {t('config.modeManualHint')}
                                    </span>
                                )}
                            </div>
                        </RadioGroup>
                    )}
                </div>

                <div className="flex w-full items-center justify-end gap-3">
                    <MyButton buttonType="secondary" scale="medium" onClick={resetSelectionConfig}>
                        {t('config.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={handleConfirmSelection}
                        disable={!isCountValid || isLoadingPaper}
                    >
                        {selectionMode === 'manual' ? (
                            <>
                                {t('config.chooseQuestions')}
                                <ArrowRight size={14} className="ml-1.5" />
                            </>
                        ) : selectionMode === 'tags' ? (
                            <>
                                <Shuffle size={14} className="mr-1.5" />
                                {t('config.addRandomCount', { count: tagsTotal })}
                            </>
                        ) : selectionMode === 'random' && count > 0 ? (
                            <>
                                <Shuffle size={14} className="mr-1.5" />
                                {t('config.addRandomCount', { count })}
                            </>
                        ) : (
                            <>
                                <Shuffle size={14} className="mr-1.5" />
                                {t('config.addAllQuestions')}
                            </>
                        )}
                    </MyButton>
                </div>
            </div>
        );
    }

    if (!isAssessment) {
        const papers = questionPaperList?.content ?? [];
        const byDate = sortOrder !== 'NAME';
        const now = new Date();
        const groupLabel = (key: string) => {
            if (key === 'today') return tPage('list.groups.today');
            if (key === 'yesterday') return tPage('list.groups.yesterday');
            if (key === 'thisWeek') return tPage('list.groups.thisWeek');
            const [year, month] = key.split('-').map(Number);
            return new Date(year ?? 0, (month ?? 1) - 1, 1).toLocaleDateString(i18n.language, {
                month: 'long',
                year: 'numeric',
            });
        };
        const nameOrNull = (name: string) => (name && name !== 'N/A' ? name : null);
        const pageSize = questionPaperList?.page_size || 10;
        const from = papers.length ? pageNo * pageSize + 1 : 0;
        const to = papers.length ? from + papers.length - 1 : 0;
        let lastGroup = '';

        return (
            <div className="mt-4 flex flex-col gap-3">
                {papers.map((paper) => {
                    const group = byDate ? dateGroupKey(paper.created_on, now) : '';
                    const showHeader = byDate && group !== lastGroup;
                    lastGroup = group;
                    return (
                        <Fragment key={paper.id}>
                            {showHeader && (
                                <div className="mt-2 flex items-center gap-3 text-caption font-semibold uppercase tracking-wide text-neutral-500 first:mt-0">
                                    {groupLabel(group)}
                                    <span className="h-px flex-1 bg-neutral-200" />
                                </div>
                            )}
                            <QuestionPaperCard
                                paper={paper}
                                levelName={
                                    instituteDetails
                                        ? nameOrNull(
                                              getLevelNameById(
                                                  instituteDetails.levels,
                                                  paper.level_id
                                              )
                                          )
                                        : null
                                }
                                subjectName={
                                    instituteDetails?.subjects
                                        ? nameOrNull(
                                              getSubjectNameById(
                                                  instituteDetails.subjects,
                                                  paper.subject_id
                                              )
                                          )
                                        : null
                                }
                                isJustAdded={paper.id === justAddedId}
                                onToggleFavourite={() => toggleFavouriteOnPage(paper)}
                                onDelete={() => setPendingDelete(paper)}
                                viewButton={
                                    <ViewQuestionPaper
                                        questionPaperId={paper.id}
                                        title={paper.title}
                                        subject={paper.subject_id}
                                        level={paper.level_id}
                                        refetchData={refetchData}
                                        currentQuestionIndex={currentQuestionIndex}
                                        setCurrentQuestionIndex={setCurrentQuestionIndex}
                                        examType={examType}
                                        buttonText={
                                            <span className="flex items-center gap-1.5">
                                                <Eye size={16} />
                                                {t('list.viewButton')}
                                            </span>
                                        }
                                        triggerVariant="secondary"
                                    />
                                }
                                exportButton={
                                    <ExportQuestionPaper
                                        questionPaperId={paper.id}
                                        title={paper.title}
                                        triggerVariant="button"
                                    />
                                }
                            />
                        </Fragment>
                    );
                })}
                <div className="mt-2 flex flex-col items-center justify-between gap-3 sm:flex-row">
                    <span className="whitespace-nowrap text-caption text-neutral-500">
                        {tPage('list.showing', {
                            from,
                            to,
                            total: questionPaperList?.total_elements ?? 0,
                        })}
                    </span>
                    <MyPagination
                        currentPage={pageNo}
                        totalPages={questionPaperList.total_pages}
                        onPageChange={handlePageChange}
                    />
                </div>
                <AlertDialog
                    open={!!pendingDelete}
                    onOpenChange={(open) => {
                        if (!open) setPendingDelete(null);
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {tPage('list.deleteTitle', { title: pendingDelete?.title ?? '' })}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {tPage('list.deleteBody')}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>{tPage('list.keepIt')}</AlertDialogCancel>
                            <AlertDialogAction
                                className="bg-danger-600 text-white hover:bg-danger-700"
                                onClick={confirmDelete}
                            >
                                {tPage('list.deletePaper')}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        );
    }

    return (
        <div className="mt-5 flex flex-col gap-5">
            {questionPaperList?.content?.map((questionsData, idx) => (
                <div
                    key={idx}
                    className={`flex flex-col gap-2 rounded-xl border-2 bg-neutral-50 p-4 ${
                        index !== undefined || isStudyLibraryAssignment ? 'cursor-pointer' : ''
                    }`}
                    onClick={
                        index !== undefined || isStudyLibraryAssignment
                            ? () => handleGetQuestionPaperDataById(questionsData)
                            : undefined
                    }
                >
                    <div className="flex items-center justify-between">
                        <h1 className="font-medium">{questionsData.title}</h1>
                        {!isAssessment && (
                            <div className="flex items-center gap-3">
                                <Star
                                    size={20}
                                    weight={questionsData.status === 'FAVOURITE' ? 'fill' : 'light'}
                                    onClick={() =>
                                        handleMarkFavourite(questionsData.id, questionsData.status)
                                    }
                                    className={`cursor-pointer ${
                                        questionsData.status === 'FAVOURITE'
                                            ? 'text-yellow-500'
                                            : 'text-gray-300'
                                    }`}
                                />
                                <ViewQuestionPaper
                                    questionPaperId={questionsData.id}
                                    title={questionsData.title}
                                    subject={questionsData.subject_id}
                                    level={questionsData.level_id}
                                    refetchData={refetchData}
                                    currentQuestionIndex={currentQuestionIndex}
                                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                                    examType={examType}
                                    buttonText={
                                        <span className="flex items-center gap-1.5">
                                            <Eye size={16} />
                                            {t('list.viewButton')}
                                        </span>
                                    }
                                    triggerVariant="secondary"
                                />
                                <ExportQuestionPaper
                                    questionPaperId={questionsData.id}
                                    title={questionsData.title}
                                    triggerVariant="button"
                                />
                                <DropdownMenu>
                                    <DropdownMenuTrigger>
                                        <Button
                                            variant="outline"
                                            className="h-6 bg-transparent p-1 shadow-none"
                                        >
                                            <DotsThree size={20} />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuItem
                                            onClick={() =>
                                                handleDeleteQuestionPaper(questionsData.id)
                                            }
                                            className="cursor-pointer"
                                        >
                                            {t('list.deleteQuestionPaper')}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        )}
                    </div>
                    <div className="flex w-full items-center justify-start gap-8 text-xs">
                        <p>
                            {t('list.createdOnLabel')}{' '}
                            {new Date(questionsData.created_on).toLocaleDateString(
                                i18n.language
                            ) ||
                                t('list.notAvailable')}
                        </p>
                        <p>
                            {t('list.yearClassLabel')}{' '}
                            {instituteDetails &&
                                getLevelNameById(instituteDetails.levels, questionsData.level_id)}
                        </p>
                        <p>
                            {t('list.subjectLabel')}{' '}
                            {instituteDetails && instituteDetails.subjects &&
                                getSubjectNameById(
                                    instituteDetails.subjects,
                                    questionsData.subject_id
                                )}
                        </p>
                    </div>
                </div>
            ))}
            <MyPagination
                currentPage={pageNo}
                totalPages={questionPaperList.total_pages}
                onPageChange={handlePageChange}
            />
        </div>
    );
};
