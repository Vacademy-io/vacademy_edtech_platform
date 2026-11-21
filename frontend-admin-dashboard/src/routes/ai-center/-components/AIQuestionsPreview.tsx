import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import {
    AIAssessmentResponseInterface,
    AITaskIndividualListInterface,
} from '@/types/ai/generate-assessment/generate-complete-assessment';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { handleGetQuestionsInvidualTask, handleRetryAITask } from '../-services/ai-center-service';
import { Dispatch, SetStateAction, useState, useRef, useEffect } from 'react';
import { FormProvider, useFieldArray, useForm, UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { generateCompleteAssessmentFormSchema } from '../-utils/generate-complete-assessment-schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { transformQuestionsToGenerateAssessmentAI } from '../-utils/helper';
import useInstituteLogoStore from '@/components/common/layout-container/sidebar/institutelogo-global-zustand';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import {
    getPPTViewTitle,
    transformResponseDataToMyQuestionsSchema,
} from '@/routes/assessment/question-papers/-utils/helper';
import {
    describeMerge,
    mergeSectionQuestions,
} from '@/routes/assessment/question-papers/-utils/merge-section-questions';
import { calculateTotalMarks } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/helper';
import {
    DEFAULT_MARK,
    durationFields,
    isBlankDuration,
    isEmptySection,
    pairWithPreview,
    sectionRowFor,
    sectionsFromExtractedPaper,
    wantsSections,
} from '../-utils/extracted-paper-sections';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { QuestionType } from '@/constants/dummy-data';
import { DotsSixVertical } from '@phosphor-icons/react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DotsThreeVertical, Copy, Trash, Eye } from '@phosphor-icons/react';
import { PPTComponentFactory } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/PPTComponentFactory';

import { MainViewComponentFactory } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/MainViewComponentFactory';
import ExportQuestionPaperAI from './export-ai-question-paper/ExportQuestionPaperAI';
import { toast } from 'sonner';
import type { QuestionsFromTextData } from '../ai-tools/vsmart-prompt/-components/GenerateQuestionsFromText';
import { Badge } from '@/components/ui/badge';
import { AxiosError } from 'axios';
import { MyQuestion, MyQuestionPaperFormInterface } from '@/types/assessments/question-paper-form';
import { SectionFormType } from '@/types/assessments/assessment-steps';
import { addQuestionPaper } from '@/routes/assessment/question-papers/-utils/question-paper-services';
import { getQuestionPaperById } from '@/routes/community/question-paper/-service/utils';
import { useAIQuestionDialogStore } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/zustand-global-states/ai-add-questions-dialog-zustand';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from 'react-i18next';

interface AIQuestionsPreviewProps {
    task: AITaskIndividualListInterface;
    pollGenerateAssessment?: (prompt?: string, taskId?: string) => void;
    handleGenerateQuestionsForAssessment?: (pdfId?: string, prompt?: string) => void;
    pollGenerateQuestionsFromText?: (data: QuestionsFromTextData) => void;
    pollGenerateQuestionsFromAudio?: (data: QuestionsFromTextData, taskId: string) => void;
    heading?: string;
    openQuestionsPreview: boolean;
    setOpenQuestionsPreview: Dispatch<SetStateAction<boolean>>;
    sectionsForm?: UseFormReturn<SectionFormType>;
    currentSectionIndex?: number;
    /**
     * The target form can hold several sections (the assessment / homework
     * wizards): a digitised paper with sections may then become one section
     * each. Off for a single-section target such as a quiz, which only reads
     * `section.0` and would lose the rest.
     */
    allowSectionSplit?: boolean;
    /** Hide the internal "View questions" trigger button (when the dialog is opened externally). */
    hideTrigger?: boolean;
}

const AIQuestionsPreview = ({
    task,
    openQuestionsPreview,
    setOpenQuestionsPreview,
    sectionsForm,
    currentSectionIndex,
    allowSectionSplit = false,
    hideTrigger = false,
}: AIQuestionsPreviewProps) => {
    const { t } = useTranslation('aiCenterAIQuestionsPreview');
    const { t: tHelper } = useTranslation('aiCenterHelper');
    const {
        setIsAIQuestionDialog1,
        setIsAIQuestionDialog2,
        setIsAIQuestionDialog3,
        setIsAIQuestionDialog4,
        setIsAIQuestionDialog5,
        setIsAIQuestionDialog6,
        setIsAIQuestionDialog7,
        setIsAIQuestionDialog8,
        setIsAIQuestionDialog9,
    } = useAIQuestionDialogStore();
    const queryClient = useQueryClient();
    const { instituteLogo } = useInstituteLogoStore();
    const [assessmentData, setAssessmentData] = useState<AIAssessmentResponseInterface>({
        title: '',
        tags: [],
        difficulty: '',
        description: '',
        subjects: [],
        classes: [],
        questions: [],
    });
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    // How a digitised paper with sections goes into Step 2 — one section per
    // paper section or all in the current one. Starts as what the teacher
    // answered at upload; they can change it here before saving.
    const [sectionChoice, setSectionChoice] = useState<'split' | 'single' | null>(null);
    const form = useForm<z.infer<typeof generateCompleteAssessmentFormSchema>>({
        resolver: zodResolver(generateCompleteAssessmentFormSchema),
        mode: 'onChange',
        defaultValues: {
            questionPaperId: '1',
            isFavourite: false,
            title: '',
            createdOn: new Date(),
            yearClass: '',
            subject: '',
            questionsType: '',
            optionsType: '',
            answersType: '',
            explanationsType: '',
            fileUpload: undefined,
            classess: [],
            subjects: [],
            tags: [],
            questions: [],
        },
    });

    const { getValues } = form;

    // UseFieldArray to manage questions array
    const { fields, move, insert, remove } = useFieldArray({
        control: form.control,
        name: 'questions', // Name of the field array
    });

    const questions = form.getValues('questions');

    const contentRef = useRef<HTMLDivElement>(null);
    const [containerHeight, setContainerHeight] = useState<string | number>('auto');

    useEffect(() => {
        const updateHeight = () => {
            if (contentRef.current) {
                // Calculate scaled height: content scrollHeight * scale factor (0.28)
                // Add a small buffer to prevent cut-off
                const scaled = contentRef.current.scrollHeight * 0.28 + 10;
                setContainerHeight(scaled);
            }
        };

        // Initial calculation with delay to allow DOM to render
        const timeoutId = setTimeout(updateHeight, 100);

        // Use ResizeObserver to track content size changes
        const resizeObserver = new ResizeObserver(() => {
            updateHeight();
        });

        if (contentRef.current) {
            resizeObserver.observe(contentRef.current);
        }

        return () => {
            clearTimeout(timeoutId);
            resizeObserver.disconnect();
        };
    }, [fields]);

    const [noResponse, setNoResponse] = useState(false);
    const getQuestionsListMutation = useMutation({
        mutationFn: async ({ taskId }: { taskId: string }) => {
            return handleGetQuestionsInvidualTask(taskId);
        },
        onSuccess: (response) => {
            if (!response.questions || response.questions.length === 0) {
                setTimeout(() => {
                    setNoResponse(false);
                }, 10000);
                setNoResponse(true);
                return;
            }
            setNoResponse(false);
            setAssessmentData(response);
            setSectionChoice(response?.extraction?.section_mode ?? null);
            setSavedPaperId(null);
            const transformQuestionsData = transformQuestionsToGenerateAssessmentAI(
                response.questions,
                tHelper
            );
            form.reset({
                ...form.getValues(),
                title: response?.title,
                classess: response?.classes,
                subjects: response?.subjects,
                tags: response?.tags,
                questions: transformQuestionsData,
            });
            form.trigger();
        },
        onError: (error: unknown) => {
            console.log(error);
        },
    });

    const handlViewQuestionsList = (taskId: string) => {
        getQuestionsListMutation.mutate({
            taskId,
        });
    };

    // Auto-fetch when dialog is opened externally (e.g. from a recent-work card click)
    // and no data has been loaded yet. Without this, the dialog opens empty.
    useEffect(() => {
        if (
            openQuestionsPreview &&
            assessmentData.questions.length === 0 &&
            getQuestionsListMutation.status === 'idle'
        ) {
            handlViewQuestionsList(task.id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openQuestionsPreview, task.id]);

    const getRetryMutation = useMutation({
        mutationFn: async ({ taskId }: { taskId: string }) => {
            return handleRetryAITask(taskId);
        },
        onSuccess: (response) => {
            setNoResponse(false);
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['GET_INDIVIDUAL_AI_LIST_DATA'] });
            }, 100);
            if (!response.questions || response.questions.length === 0) {
                toast.success(t('toast.noDataExists'));
                return;
            }
            setAssessmentData(response);
            setSectionChoice(response?.extraction?.section_mode ?? null);
            setSavedPaperId(null);
            const transformQuestionsData = transformQuestionsToGenerateAssessmentAI(
                response.questions,
                tHelper
            );
            form.reset({
                ...form.getValues(),
                title: response?.title,
                classess: response?.classes,
                subjects: response?.subjects,
                tags: response?.tags,
                questions: transformQuestionsData,
            });
        },
        onError: (error: unknown) => {
            setNoResponse(false);
            if (error instanceof AxiosError) {
                toast.error(error.response?.data.ex, {
                    className: 'error-toast',
                    duration: 2000,
                });
            } else {
                // Handle non-Axios errors if necessary
                console.error('Unexpected error:', error);
            }
        },
    });

    const handleRetryTask = (taskId: string) => {
        getRetryMutation.mutate({
            taskId,
        });
    };

    const closeAllAIQuestionDialogs = () => {
        setIsAIQuestionDialog1(false);
        setIsAIQuestionDialog2(false);
        setIsAIQuestionDialog3(false);
        setIsAIQuestionDialog4(false);
        setIsAIQuestionDialog5(false);
        setIsAIQuestionDialog6(false);
        setIsAIQuestionDialog7(false);
        setIsAIQuestionDialog8(false);
        setIsAIQuestionDialog9(false);
    };

    const handleSubmitFormData = useMutation({
        mutationFn: ({ data }: { data: MyQuestionPaperFormInterface }) =>
            addQuestionPaper(data, true),
        onSuccess: async (data) => {
            const getQuestionPaper = await getQuestionPaperById(data.saved_question_paper_id);
            const transformQuestionsData: MyQuestion[] = transformResponseDataToMyQuestionsSchema(
                getQuestionPaper.question_dtolist
            );
            if (currentSectionIndex !== undefined) {
                // Check if index is defined

                // The preview's own rows carry what a digitised paper printed —
                // the section each question sits under and its marks — which the
                // question bank does not keep; paired with the stored copy by
                // position (they come back in the order they were sent).
                const previewQuestions = (form.getValues('questions') ?? []) as MyQuestion[];
                const paired = pairWithPreview(transformQuestionsData, previewQuestions);
                const summary = assessmentData.extraction ?? null;

                // The time the paper allows becomes the test's duration when
                // the teacher has not set one — the paper is usable as it lands.
                const applyPaperDuration = () => {
                    const minutes = summary?.duration_minutes;
                    if (!sectionsForm || !minutes) return;
                    const current = sectionsForm.getValues(
                        'testDuration.entireTestDuration.testDuration'
                    );
                    if (!isBlankDuration(current)) return;
                    const { hrs, min } = durationFields(minutes);
                    sectionsForm.setValue('testDuration.entireTestDuration.testDuration.hrs', hrs);
                    sectionsForm.setValue('testDuration.entireTestDuration.testDuration.min', min);
                };

                if (
                    allowSectionSplit &&
                    sectionsForm &&
                    summary &&
                    wantsSections(summary, sectionChoice)
                ) {
                    // One Step 2 section per paper section, marks as printed.
                    // The empty section the wizard opens with is replaced; a
                    // section the teacher already filled keeps its place and the
                    // paper's sections follow it.
                    const current = sectionsForm.getValues('section') ?? [];
                    const target = current[currentSectionIndex];
                    const replace = target ? isEmptySection(target) : false;
                    const newSections = sectionsFromExtractedPaper(
                        summary,
                        previewQuestions,
                        transformQuestionsData,
                        current.length - (replace ? 1 : 0)
                    );
                    if (replace && target?.section_description && newSections[0]) {
                        newSections[0].section_description ||= target.section_description;
                    }
                    if (newSections.length >= 2) {
                        const next = [...current];
                        next.splice(
                            replace ? currentSectionIndex : currentSectionIndex + 1,
                            replace ? 1 : 0,
                            ...newSections
                        );
                        sectionsForm.setValue('section', next);
                        sectionsForm.trigger('section');
                        applyPaperDuration();
                        toast.success(
                            t('toast.sectionsAdded', {
                                sections: newSections.length,
                                questions: transformQuestionsData.length,
                            })
                        );
                        closeAllAIQuestionDialogs();
                        setOpenQuestionsPreview(false);
                        queryClient.invalidateQueries({
                            queryKey: ['GET_QUESTION_PAPER_FILTERED_DATA'],
                        });
                        return;
                    }
                }

                const incoming = transformQuestionsData.map((question, i) =>
                    // Spread full question data (options, validAnswers, etc.) so that
                    // quiz context can read them via getValues. The Zod schema strips
                    // unknown fields on validation, so the assessment flow is unaffected.
                    // A digitised paper's questions are worth a mark each when the
                    // paper prints none; generated questions keep the section default.
                    sectionRowFor(question, paired[i], summary ? DEFAULT_MARK : '')
                );

                // Append rather than replace: running an AI tool on a section that
                // already had questions used to wipe them without warning.
                const mergeResult = mergeSectionQuestions(
                    sectionsForm?.getValues(
                        `section.${currentSectionIndex}.adaptive_marking_for_each_question`
                    ) as typeof incoming | undefined,
                    incoming
                );

                sectionsForm?.setValue(
                    `section.${currentSectionIndex}.adaptive_marking_for_each_question`,
                    mergeResult.merged
                );
                // Section total is derived from its questions; nothing else recomputes it
                // when questions arrive.
                sectionsForm?.setValue(
                    `section.${currentSectionIndex}.total_marks`,
                    String(calculateTotalMarks(mergeResult.merged))
                );
                sectionsForm?.trigger(
                    `section.${currentSectionIndex}.adaptive_marking_for_each_question`
                );
                applyPaperDuration();
                toast.success(describeMerge(mergeResult));
                closeAllAIQuestionDialogs();
                setOpenQuestionsPreview(false);
            }
            queryClient.invalidateQueries({ queryKey: ['GET_QUESTION_PAPER_FILTERED_DATA'] });
        },
        onError: (error: unknown) => {
            // A string, never the Error itself: the Toaster sits outside the
            // router's error boundary, so an object here crashed the whole app
            // to a blank page.
            toast.error(error instanceof Error ? error.message : String(error));
        },
    });

    const handleSaveQuestionsInSection = () => {
        if (Object.values(form.formState.errors).length > 0) {
            toast.error(t('toast.incompleteQuestions'), {
                className: 'error-toast',
                duration: 3000,
            });
            return;
        }
        handleSubmitFormData.mutate({
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            data: form.getValues(),
        });
    };

    // "Add to question bank": the paper as shown, saved to the bank in one
    // click and nothing else — no section, no navigation. Done once per
    // preview; the button then says so instead of saving a second copy.
    const [savedPaperId, setSavedPaperId] = useState<string | null>(null);
    const saveToQuestionBank = useMutation({
        mutationFn: ({ data }: { data: MyQuestionPaperFormInterface }) =>
            addQuestionPaper(data, true),
        onSuccess: (data) => {
            setSavedPaperId(data?.saved_question_paper_id ?? '');
            queryClient.invalidateQueries({ queryKey: ['GET_QUESTION_PAPER_FILTERED_DATA'] });
            toast.success(t('toast.savedToQuestionBank'));
        },
        onError: (error: unknown) => {
            toast.error(error instanceof Error ? error.message : String(error));
        },
    });
    const handleAddToQuestionBank = () => {
        if (Object.values(form.formState.errors).length > 0) {
            toast.error(t('toast.incompleteQuestions'), {
                className: 'error-toast',
                duration: 3000,
            });
            return;
        }
        saveToQuestionBank.mutate({
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            data: form.getValues(),
        });
    };

    return (
        <>
            <Dialog open={noResponse} onOpenChange={setNoResponse}>
                <DialogContent className="overflow-hidden rounded-lg p-0">
                    <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 p-4 text-destructive">
                        <span className="font-semibold">{t('noResponseDialog.title')}</span>
                    </div>
                    <div className="flex flex-col gap-4 p-6">
                        <p className="text-sm text-muted-foreground">
                            {t('noResponseDialog.message')}
                        </p>
                        <MyButton
                            type="button"
                            scale="small"
                            buttonType="secondary"
                            className="!text-primary w-fit text-sm font-semibold hover:underline"
                            onClick={() => handleRetryTask(task.id)}
                        >
                            {t('noResponseDialog.retryNow')}
                        </MyButton>
                    </div>
                </DialogContent>
            </Dialog>
            <Dialog open={openQuestionsPreview} onOpenChange={setOpenQuestionsPreview}>
                {!hideTrigger && (
                <DialogTrigger asChild>
                    {task.status === 'FAILED' ? (
                        <MyButton
                            type="button"
                            scale="small"
                            buttonType="secondary"
                            className="border-none text-sm !text-destructive shadow-none hover:bg-destructive/10"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleRetryTask(task.id);
                            }}
                        >
                            {getRetryMutation.status === 'pending' ? (
                                <>
                                    <div className="mr-2 size-3 animate-spin rounded-full border-2 border-destructive border-t-transparent"></div>
                                    <span>{t('trigger.retrying')}</span>
                                </>
                            ) : (
                                t('trigger.retry')
                            )}
                        </MyButton>
                    ) : (
                        <MyButton
                            type="button"
                            scale="small"
                            buttonType="primary"
                            className="inline-flex items-center gap-1.5 rounded-lg !bg-primary-500 px-3 py-1.5 text-xs font-medium !text-white shadow-sm hover:!bg-primary-600"
                            onClick={() => handlViewQuestionsList(task.id)}
                        >
                            {getQuestionsListMutation.status === 'pending' ? (
                                <>
                                    <div className="mr-1 size-3 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                                    <span>{t('trigger.loading')}</span>
                                </>
                            ) : (
                                <>
                                    <Eye size={14} weight="bold" />
                                    {t('trigger.viewQuestions')}
                                </>
                            )}
                        </MyButton>
                    )}
                </DialogTrigger>
                )}
                {form.getValues('questions') && form.getValues('questions').length > 0 && (
                    <DialogContent className="no-scrollbar !m-0 flex h-[92vh] !w-[92vw] !max-w-none flex-col !gap-0 overflow-hidden !rounded-2xl bg-background !p-0 text-foreground [&>button]:hidden">{/* design-lint-ignore: near-fullscreen editor dialog, no token exists for viewport-relative sizing */}
                        <FormProvider {...form}>
                            <form className="flex h-full flex-col">
                                {/* Header */}
                                <div className="z-10 flex h-16 w-full shrink-0 items-center justify-between border-b bg-background px-6 shadow-sm">
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-3">
                                            <img
                                                src={instituteLogo}
                                                alt={t('instituteLogoAlt')}
                                                className="size-9 rounded-full border bg-muted object-contain"
                                            />
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold leading-tight text-foreground/90">
                                                    {form.getValues('title')}
                                                </span>
                                                {/* A digitised paper says what it found, so the
                                                    teacher knows whether the key needs a look. */}
                                                {assessmentData.extraction && (
                                                    <span className="text-caption text-muted-foreground">
                                                        {t('header.extractionSummary', {
                                                            questions:
                                                                assessmentData.extraction.questions,
                                                            keyed: assessmentData.extraction.keyed,
                                                            explained:
                                                                assessmentData.extraction.explained,
                                                        })}
                                                        {assessmentData.extraction.unkeyed > 0 &&
                                                            ' · ' +
                                                                t('header.extractionUnkeyed', {
                                                                    count: assessmentData.extraction
                                                                        .unkeyed,
                                                                })}
                                                        {(assessmentData.extraction.check?.length ??
                                                            0) > 0 &&
                                                            ' · ' +
                                                                t('header.extractionCheck', {
                                                                    numbers:
                                                                        assessmentData.extraction.check!.join(
                                                                            ', '
                                                                        ),
                                                                })}
                                                        {(assessmentData.extraction.sections
                                                            ?.length ?? 0) >= 2 &&
                                                            ' · ' +
                                                                t(
                                                                    !allowSectionSplit ||
                                                                        (sectionChoice ??
                                                                            assessmentData
                                                                                .extraction
                                                                                .section_mode) ===
                                                                            'single'
                                                                        ? 'header.extractionSectionsSingle'
                                                                        : 'header.extractionSectionsSplit',
                                                                    {
                                                                        count: assessmentData
                                                                            .extraction.sections!
                                                                            .length,
                                                                        names: assessmentData.extraction
                                                                            .sections!.map(
                                                                                (s) => s.name
                                                                            )
                                                                            .join(', '),
                                                                    }
                                                                )}
                                                        {assessmentData.extraction.marking?.marks !=
                                                            null &&
                                                            ' · ' +
                                                                t('header.extractionMarking', {
                                                                    marks: assessmentData.extraction
                                                                        .marking.marks,
                                                                    negative:
                                                                        assessmentData.extraction
                                                                            .marking
                                                                            .negative_marks ?? 0,
                                                                })}
                                                        {(assessmentData.extraction
                                                            .duration_minutes ?? 0) > 0 &&
                                                            ' · ' +
                                                                t('header.extractionDuration', {
                                                                    hrs: Math.floor(
                                                                        assessmentData.extraction
                                                                            .duration_minutes! / 60
                                                                    ),
                                                                    min:
                                                                        assessmentData.extraction
                                                                            .duration_minutes! % 60,
                                                                })}
                                                        {assessmentData.extraction.credits !=
                                                            null &&
                                                            ' · ' +
                                                                t('header.extractionCredits', {
                                                                    count: assessmentData.extraction
                                                                        .credits,
                                                                })}
                                                    </span>
                                                )}
                                                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                                    {form
                                                        .getValues('tags')
                                                        ?.slice(0, 3)
                                                        .map((tag, idx) => (
                                                            <Badge
                                                                variant="secondary"
                                                                key={idx}
                                                                className="border-transparent bg-muted/50 px-1.5 py-0 text-caption font-medium text-muted-foreground"
                                                            >
                                                                {tag}
                                                            </Badge>
                                                        ))}
                                                    {form.getValues('tags') &&
                                                        form.getValues('tags')!.length > 3 && (
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Badge
                                                                            variant="secondary"
                                                                            className="cursor-help border-transparent bg-muted/50 px-1.5 py-0 text-caption font-medium text-muted-foreground"
                                                                        >
                                                                            {t('header.moreTagsBadge', {
                                                                                count: form.getValues(
                                                                                    'tags'
                                                                                )!.length - 3,
                                                                            })}
                                                                        </Badge>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>
                                                                        <div className="flex flex-col gap-1">
                                                                            {form
                                                                                .getValues('tags')
                                                                                ?.slice(3)
                                                                                .map((tag, idx) => (
                                                                                    <span
                                                                                        key={idx}
                                                                                        className="text-xs"
                                                                                    >
                                                                                        {tag}
                                                                                    </span>
                                                                                ))}
                                                                        </div>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {currentSectionIndex !== undefined &&
                                            allowSectionSplit &&
                                            (assessmentData.extraction?.sections?.length ?? 0) >=
                                                2 && (
                                                <Select
                                                    value={sectionChoice ?? 'split'}
                                                    onValueChange={(value) =>
                                                        setSectionChoice(
                                                            value as 'split' | 'single'
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger
                                                        className="h-8 w-auto gap-2 text-xs"
                                                        aria-label={t('header.sectionChoiceLabel')}
                                                    >
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="split">
                                                            {t('header.sectionChoiceSplit', {
                                                                count: assessmentData.extraction!
                                                                    .sections!.length,
                                                            })}
                                                        </SelectItem>
                                                        <SelectItem value="single">
                                                            {t('header.sectionChoiceSingle')}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        {currentSectionIndex !== undefined &&
                                            (handleSubmitFormData.status === 'pending' ? (
                                                <MyButton type="button" disable scale="small">
                                                    <div className="mr-2 size-3 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                                                    <span>{t('header.saving')}</span>
                                                </MyButton>
                                            ) : (
                                                <MyButton
                                                    onClick={handleSaveQuestionsInSection}
                                                    type="button"
                                                    scale="small"
                                                >
                                                    {t('header.saveChanges')}
                                                </MyButton>
                                            ))}
                                        {(assessmentData.questions?.length ?? 0) > 0 && (
                                            <MyButton
                                                type="button"
                                                scale="small"
                                                buttonType="secondary"
                                                disable={
                                                    saveToQuestionBank.status === 'pending' ||
                                                    savedPaperId !== null
                                                }
                                                onClick={handleAddToQuestionBank}
                                            >
                                                {saveToQuestionBank.status === 'pending' ? (
                                                    <>
                                                        <div className="mr-2 size-3 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
                                                        <span>
                                                            {t('header.addingToQuestionBank')}
                                                        </span>
                                                    </>
                                                ) : savedPaperId !== null ? (
                                                    t('header.addedToQuestionBank')
                                                ) : (
                                                    t('header.addToQuestionBank')
                                                )}
                                            </MyButton>
                                        )}
                                        <ExportQuestionPaperAI
                                            responseQuestionsData={assessmentData?.questions}
                                        />
                                        <div className="mx-1 h-5 w-px bg-border" />
                                        <MyButton
                                            type="button"
                                            scale="small"
                                            buttonType="secondary"
                                            className="text-muted-foreground hover:text-foreground md:min-w-20"
                                            onClick={() => {
                                                setOpenQuestionsPreview(false);
                                            }}
                                        >
                                            {t('header.close')}
                                        </MyButton>
                                    </div>
                                </div>

                                {/* Content Body */}
                                <div className="flex flex-1 overflow-hidden">
                                    {/* Sidebar / Slides Strip */}
                                    <div className="flex w-56 flex-col border-r bg-muted/5">
                                        <div className="scrollbar-thin scrollbar-thumb-muted-foreground/20 flex-1 overflow-y-auto overflow-x-hidden p-4">
                                            <Sortable
                                                value={fields}
                                                onMove={({ activeIndex, overIndex }) =>
                                                    move(activeIndex, overIndex)
                                                }
                                            >
                                                <div
                                                    style={{
                                                        height: containerHeight,
                                                        overflow: 'hidden',
                                                    }}
                                                >
                                                    <div
                                                        ref={contentRef}
                                                        className="flex w-[350%] origin-top-left scale-[0.28] flex-col gap-6 pb-20" // design-lint-ignore: inverse of the scale-[0.28] transform (100/0.28≈357%, rounded), a computed compensation value with no matching width token
                                                    >
                                                        {fields.map((field, index) => {
                                                            const hasError =
                                                                form.formState.errors?.questions?.[
                                                                    index
                                                                ];
                                                            const isSelected =
                                                                currentQuestionIndex === index;

                                                            return (
                                                                <SortableItem
                                                                    key={field.id}
                                                                    value={field.id}
                                                                    asChild
                                                                >
                                                                    <div
                                                                        key={index}
                                                                        onClick={() =>
                                                                            setCurrentQuestionIndex(
                                                                                index
                                                                            )
                                                                        }
                                                                        className={`group relative rounded-3xl border-4 p-6 transition-all duration-200
                                                                            ${
                                                                                isSelected
                                                                                    ? 'border-blue-600 bg-white ring-8 ring-blue-50'
                                                                                    : 'border-transparent bg-white shadow-sm hover:shadow-md'
                                                                            }`}
                                                                    >
                                                                        <div className="flex flex-col gap-4">
                                                                            <div className="flex items-center justify-between gap-4">
                                                                                <div className="flex items-center gap-4">
                                                                                    <span
                                                                                        className={`text-5xl font-bold ${isSelected ? 'text-blue-600' : 'text-gray-400'}`}
                                                                                    >
                                                                                        {index + 1}
                                                                                    </span>
                                                                                    <span className="max-w-sm truncate text-3xl font-medium text-gray-500">
                                                                                        {getPPTViewTitle(
                                                                                            getValues(
                                                                                                `questions.${index}.questionType`
                                                                                            ) as QuestionType
                                                                                        )}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="flex items-center gap-2">
                                                                                    <DropdownMenu>
                                                                                        <DropdownMenuTrigger
                                                                                            asChild
                                                                                        >
                                                                                            <MyButton
                                                                                                type="button"
                                                                                                scale="large"
                                                                                                buttonType="secondary"
                                                                                                className="size-16 p-0 text-muted-foreground hover:text-foreground"
                                                                                                onClick={(
                                                                                                    e
                                                                                                ) =>
                                                                                                    e.stopPropagation()
                                                                                                }
                                                                                            >
                                                                                                <DotsThreeVertical className="!size-10" />
                                                                                            </MyButton>
                                                                                        </DropdownMenuTrigger>
                                                                                        <DropdownMenuContent
                                                                                            align="end"
                                                                                            className="w-56"
                                                                                        >
                                                                                            <DropdownMenuItem
                                                                                                className="py-3 text-lg"
                                                                                                onClick={(
                                                                                                    e
                                                                                                ) => {
                                                                                                    e.stopPropagation();
                                                                                                    insert(
                                                                                                        index +
                                                                                                            1,
                                                                                                        getValues(
                                                                                                            `questions.${index}`
                                                                                                        )
                                                                                                    );
                                                                                                }}
                                                                                            >
                                                                                                <Copy className="mr-3 size-5" />
                                                                                                {t('questionCard.duplicate')}
                                                                                            </DropdownMenuItem>
                                                                                            <DropdownMenuItem
                                                                                                className="py-3 text-lg text-destructive focus:text-destructive"
                                                                                                onClick={(
                                                                                                    e
                                                                                                ) => {
                                                                                                    e.stopPropagation();
                                                                                                    remove(
                                                                                                        index
                                                                                                    );
                                                                                                    if (
                                                                                                        currentQuestionIndex >=
                                                                                                            index &&
                                                                                                        currentQuestionIndex >
                                                                                                            0
                                                                                                    ) {
                                                                                                        setCurrentQuestionIndex(
                                                                                                            currentQuestionIndex -
                                                                                                                1
                                                                                                        );
                                                                                                    }
                                                                                                }}
                                                                                            >
                                                                                                <Trash className="mr-3 size-5" />
                                                                                                {t('questionCard.delete')}
                                                                                            </DropdownMenuItem>
                                                                                        </DropdownMenuContent>
                                                                                    </DropdownMenu>
                                                                                    <SortableDragHandle
                                                                                        variant="ghost"
                                                                                        size="icon"
                                                                                        className="size-16 cursor-grab opacity-50 hover:opacity-100 active:cursor-grabbing"
                                                                                    >
                                                                                        <DotsSixVertical className="!size-12" />
                                                                                    </SortableDragHandle>
                                                                                </div>
                                                                            </div>

                                                                            <div className="pointer-events-none opacity-90">
                                                                                <PPTComponentFactory
                                                                                    key={index}
                                                                                    type={
                                                                                        getValues(
                                                                                            `questions.${index}.questionType`
                                                                                        ) as QuestionType
                                                                                    }
                                                                                    props={{
                                                                                        form: form as any,
                                                                                        currentQuestionIndex:
                                                                                            index,
                                                                                        setCurrentQuestionIndex:
                                                                                            setCurrentQuestionIndex,
                                                                                        className:
                                                                                            'relative mt-4 rounded-xl border-2 border-gray-100 bg-white p-0 overflow-hidden',
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        </div>

                                                                        {hasError && (
                                                                            <div className="absolute right-4 top-4 size-8 rounded-full bg-red-500 ring-4 ring-white" />
                                                                        )}
                                                                    </div>
                                                                </SortableItem>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </Sortable>
                                        </div>
                                    </div>

                                    <div className="relative size-full flex-1 overflow-hidden bg-muted/10">
                                        {questions && questions.length === 0 ? (
                                            <div className="flex size-full items-center justify-center">
                                                <h1 className="font-medium text-muted-foreground">
                                                    {t('content.noQuestionsExist')}
                                                </h1>
                                            </div>
                                        ) : (
                                            <div className="size-full overflow-y-auto p-8">
                                                <div className="mx-auto min-h-[600px] w-full max-w-5xl rounded-xl border bg-background p-10 shadow-sm"> {/* design-lint-ignore: 600px canvas min-height has no matching standard scale step (min-h-96=384px too small), pixel-exact value needed for the question preview surface */}
                                                    <MainViewComponentFactory
                                                        key={currentQuestionIndex}
                                                        type={
                                                            getValues(
                                                                `questions.${currentQuestionIndex}.questionType`
                                                            ) as QuestionType
                                                        }
                                                        props={{
                                                            form: form as any,
                                                            currentQuestionIndex:
                                                                currentQuestionIndex,
                                                            setCurrentQuestionIndex:
                                                                setCurrentQuestionIndex,
                                                            className: 'flex w-full flex-col gap-6',
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </form>
                        </FormProvider>
                    </DialogContent>
                )}
            </Dialog>
        </>
    );
};

export default AIQuestionsPreview;
