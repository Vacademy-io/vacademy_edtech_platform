import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { resolveSubjectName } from '@/services/subject-names';
import React, { MutableRefObject, useEffect, useState, useRef } from 'react';
import { UseFormReturn } from 'react-hook-form';
import {
    PencilSimpleLine,
    TrashSimple,
    X,
    Check,
    PencilLine,
    FolderOpen,
    ListNumbers,
    Shuffle,
    Sparkle,
    Spinner,
} from '@phosphor-icons/react';
import { BorderBeam } from '@/components/magicui/border-beam';
import { NumberTicker } from '@/components/magicui/number-ticker';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import useDialogStore from '@/routes/assessment/question-papers/-global-states/question-paper-dialogue-close';
import { MyButton } from '@/components/design-system/button';
import { QuestionPaperUpload } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { QuestionPapersTabs } from '@/routes/assessment/question-papers/-components/QuestionPapersTabs';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { calculateTotalMarks, getQuestionTypeCounts, getStepKey } from '../../-utils/helper';
import { MyInput } from '@/components/design-system/input';
import { Switch } from '@/components/ui/switch';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { getAssessmentDetails } from '../../-services/assessment-services';
import { useSuspenseQuery } from '@tanstack/react-query';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { Input } from '@/components/ui/input';
import { z } from 'zod';
import sectionDetailsSchema from '../../-utils/section-details-schema';
import { useSavedAssessmentStore } from '../../-utils/global-states';
import { Route } from '../..';
import { useQuestionsForSection } from '../../-hooks/getQuestionsDataForSection';
import { useBasicInfoStore } from '../../-utils/zustand-global-states/step1-basic-info';
import { calculateAveragePenalty } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-utils/helper';
import Step2GenerateQuestionsFromAI from './-components/Step2GenerateQuestionsFromAI';
import Step2CreateFromKnowledgeBase from './-components/Step2CreateFromKnowledgeBase';
import Step2PickFromQuestionBank from './-components/Step2PickFromQuestionBank';
import { CriteriaStatusBadge } from './-components/CriteriaStatusBadge';
import { CriteriaPreviewDialog } from './-components/CriteriaPreviewDialog';
import { AddEditCriteriaDialog } from './-components/AddEditCriteriaDialog';
import {
    CriteriaJson,
    CriteriaSource,
    parseCriteria,
    generateAICriteria,
    stringifyCriteria,
} from '../../-services/criteria-services';
import { MainViewQuillEditor } from '@/components/quill/MainViewQuillEditor';
import TipTapEditor from '@/components/tiptap/TipTapEditor';
import { toast } from 'sonner';
import { MyQuestion } from '@/types/assessments/question-paper-form';
import QuestionSelectorDialog from '@/routes/assessment/question-papers/-components/QuestionSelectorDialog';
import { AssessmentQuestionEditDialog } from './-components/AssessmentQuestionEditDialog';
import { QuestionOptionsList } from '@/components/common/assessment/question-options-list';

// The row's option list after an edit, from the editor's own shape: each type
// keeps its choices in a differently named array, with the key as isSelected.
const optionsOfSavedQuestion = (saved: MyQuestion) => {
    const choices =
        saved.questionType === 'MCQM'
            ? saved.multipleChoiceOptions
            : saved.questionType === 'TRUE_FALSE'
              ? saved.trueFalseOptions
              : saved.questionType === 'CMCQS'
                ? saved.csingleChoiceOptions
                : saved.questionType === 'CMCQM'
                  ? saved.cmultipleChoiceOptions
                  : saved.singleChoiceOptions;
    return (choices ?? []).map((opt) => ({
        id: opt.id,
        name: opt.name ?? '',
        isCorrect: Boolean(opt.isSelected),
    }));
};
import { useTranslation } from 'react-i18next';

type SectionFormType = z.infer<typeof sectionDetailsSchema>;

export const Step2SectionInfo = ({
    form,
    index,
    currentStep,
    oldData,
    onDelete,
}: {
    form: UseFormReturn<SectionFormType>;
    index: number;
    currentStep: number;
    oldData: MutableRefObject<SectionFormType>;
    /** Removes this section — the parent's field array owns the list. */
    onDelete: (index: number) => void;
}) => {
    const { t } = useTranslation('assessmentStep2SectionInfo');
    const { assessmentId, examtype } = Route.useParams();
    const [enableSectionName, setEnableSectionName] = useState(false);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [originalSectionName, setOriginalSectionName] = useState<string>('');
    const sectionNameInputRef = React.useRef<HTMLInputElement>(null);

    // Criteria management state
    const [criteriaDialogOpen, setCriteriaDialogOpen] = useState(false);
    const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
    const [selectedQuestionIndex, setSelectedQuestionIndex] = useState<number | null>(null);
    const [criteriaPreview, setCriteriaPreview] = useState<CriteriaJson | null>(null);

    // Bulk AI generation state
    const [bulkGenerating, setBulkGenerating] = useState(false);
    const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

    // Auto-focus input when edit mode is enabled
    useEffect(() => {
        if (enableSectionName && sectionNameInputRef.current) {
            sectionNameInputRef.current.focus();
            sectionNameInputRef.current.select();
        }
    }, [enableSectionName, index]);

    // Ref to track if bulk generation should be cancelled
    const cancelBulkGeneration = useRef(false);

    // Bulk generate AI criteria for all questions
    const handleBulkGenerateCriteria = async () => {
        const questions = allSections[index]?.adaptive_marking_for_each_question || [];

        if (questions.length === 0) {
            toast.error(t('toasts.noQuestionsInSection'));
            return;
        }

        // Confirm with user
        const confirmed = window.confirm(
            t('dialogs.confirmBulkGenerate', { count: questions.length })
        );

        if (!confirmed) return;

        cancelBulkGeneration.current = false;
        setBulkGenerating(true);
        setBulkProgress({ current: 0, total: questions.length });

        const updatedSections = [...allSections];
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < questions.length; i++) {
            // Check if user cancelled
            if (cancelBulkGeneration.current) {
                toast.info(t('toasts.generationCancelled'));
                break;
            }

            const question = questions[i];

            try {
                setBulkProgress({ current: i + 1, total: questions.length });

                // Skip if criteria already exists
                if ((question as any).evaluation_criteria_json) {
                    toast.info(t('toasts.questionAlreadyHasCriteria', { number: i + 1 }));
                    continue;
                }

                if (question?.questionMark === '0') {
                    toast.info(t('toasts.questionZeroMarksSkip', { number: i + 1 }));
                    continue;
                }

                // Generate AI criteria
                const criteriaJson = await generateAICriteria({
                    question_text: question?.questionName || '',
                    question_type: question?.questionType || '',
                    subject: '', // Can be enhanced to get from parent form
                    max_marks: Number(question?.questionMark) || 0,
                });

                // Update the question with generated criteria
                (
                    updatedSections[index]!.adaptive_marking_for_each_question[i] as any
                ).evaluation_criteria_json = stringifyCriteria(criteriaJson);
                (
                    updatedSections[index]!.adaptive_marking_for_each_question[i] as any
                ).criteria_source = 'ai';

                successCount++;

                // Small delay to avoid overwhelming the API
                await new Promise((resolve) => setTimeout(resolve, 500));
            } catch (error) {
                toast.error(
                    t('toasts.failedGenerateCriteriaForQuestion', {
                        number: i + 1,
                        error: error instanceof Error ? error.message : String(error),
                    })
                );
                failCount++;
            }
        }

        // Update form with all changes
        setValue('section', updatedSections);

        setBulkGenerating(false);
        setBulkProgress({ current: 0, total: 0 });
        cancelBulkGeneration.current = false;

        // Show summary
        if (successCount > 0) {
            toast.success(t('toasts.generatedCriteriaSuccess', { count: successCount }));
        }
        if (failCount > 0) {
            toast.error(t('toasts.failedGenerateCriteriaCount', { count: failCount }));
        }
    };

    const handleCancelBulkGeneration = () => {
        cancelBulkGeneration.current = true;
    };

    // Store original section name when editing starts
    useEffect(() => {
        if (enableSectionName) {
            const currentValue = form.getValues(`section.${index}.sectionName`);
            setOriginalSectionName(currentValue || '');
        }
    }, [enableSectionName, form, index]);

    // Reset focus state when edit mode is disabled
    useEffect(() => {
        if (!enableSectionName) {
            setIsInputFocused(false);
        }
    }, [enableSectionName]);
    const { instituteDetails } = useInstituteDetailsStore();
    const { savedAssessmentId } = useSavedAssessmentStore();
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const [selectorQuestions, setSelectorQuestions] = useState<MyQuestion[]>([]);

    const handleManualSelectionReady = (questions: MyQuestion[]) => {
        setSelectorQuestions(questions);
        setSelectorOpen(true);
    };

    const handleSelectorConfirm = (selected: MyQuestion[]) => {
        form.setValue(
            `section.${index}.adaptive_marking_for_each_question`,
            selected.map((question) => ({
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
        form.trigger(`section.${index}.adaptive_marking_for_each_question`);
        setSelectorOpen(false);
        setSelectorQuestions([]);
    };
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId !== 'defaultId' ? assessmentId : savedAssessmentId,
            instituteId: instituteDetails?.id,
            type: examtype,
        })
    );

    // Get subject name from Step 1 context (Zustand store or saved assessment details)
    const basicInfoStore = useBasicInfoStore();
    // Step 1 stores the subject *id*; the question-paper form below is keyed by name, so
    // resolve it here. Unresolvable ids (a subject whose course was deleted, or the "N/A"
    // sentinel older saves wrote) yield '', which leaves the paper's own subject picker
    // visible instead of pinning it to a bogus value.
    const defaultSubject = resolveSubjectName(
        instituteDetails?.subjects,
        {},
        basicInfoStore.testCreation?.subject ||
            assessmentDetails?.[0]?.saved_data?.subject_selection ||
            ''
    );

    const adaptiveMarking = useQuestionsForSection(
        assessmentId,
        form.getValues(`section.${index}.sectionId`)
    );

    const {
        isManualQuestionPaperDialogOpen,
        isUploadFromDeviceDialogOpen,
        setIsManualQuestionPaperDialogOpen,
        setIsUploadFromDeviceDialogOpen,
        isSavedQuestionPaperDialogOpen,
        setIsSavedQuestionPaperDialogOpen,
    } = useDialogStore();

    const { setValue, getValues, control, watch } = form;
    const allSections = getValues('section');

    const handleDeleteSection = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        onDelete(index);
    };

    // Safety check to ensure section name is never empty or undefined
    useEffect(() => {
        const currentSectionName = getValues(`section.${index}.sectionName`);

        if (
            !currentSectionName ||
            currentSectionName === 'N/A' ||
            currentSectionName.trim() === ''
        ) {
            setValue(`section.${index}.sectionName`, `Section ${index + 1}`);
        }
    }, [getValues, setValue, index]);

    /*
     * The three effects below apply a section-level value (marks, penalty, per-question
     * duration) to every question in the section. That bulk-apply is deliberate and is
     * kept — but it must only happen when the ADMIN CHANGES the field.
     *
     * They also ran on mount, where they stamped the section defaults over per-question
     * values that had just been hydrated from the server or inserted by an AI / upload /
     * knowledge-base flow. Per-question marks were flattened to the section default, and
     * the mount run of the first effect recomputed total_marks from a section list that
     * was often still empty, zeroing a hydrated total.
     *
     * A ref per effect skips only that first run.
     */
    const marksApplyInitialised = useRef(false);
    const penaltyApplyInitialised = useRef(false);
    const durationApplyInitialised = useRef(false);

    useEffect(() => {
        if (!marksApplyInitialised.current) {
            marksApplyInitialised.current = true;
            return;
        }
        const marksPerQuestion = getValues(`section.${index}`).marks_per_question;

        // Loop through adaptive_marking_for_each_question and assign questionMark
        const updatedQuestions = getValues(
            `section.${index}`
        ).adaptive_marking_for_each_question.map((question) => ({
            ...question,
            questionMark: marksPerQuestion, // Assign marks_per_question to questionMark
        }));

        // Update the section's adaptive_marking_for_each_question
        setValue(`section.${index}.adaptive_marking_for_each_question`, updatedQuestions);
        setValue(
            `section.${index}.total_marks`,
            calculateTotalMarks(getValues(`section.${index}.adaptive_marking_for_each_question`))
        );
    }, [watch(`section.${index}.marks_per_question`)]);

    useEffect(() => {
        if (!penaltyApplyInitialised.current) {
            penaltyApplyInitialised.current = true;
            return;
        }
        // Negative marking that is switched OFF must not be written onto every question:
        // this effect fired regardless of `checked`, so clearing the toggle still left
        // the last penalty value stamped across the section.
        if (!getValues(`section.${index}`).negative_marking?.checked) return;

        const negative_marking = getValues(`section.${index}`).negative_marking.value;

        // Loop through adaptive_marking_for_each_question and assign questionMark
        const updatedQuestions = getValues(
            `section.${index}`
        ).adaptive_marking_for_each_question.map((question) => ({
            ...question,
            questionPenalty: negative_marking, // Assign marks_per_question to questionMark
        }));

        // Update the section's adaptive_marking_for_each_question
        setValue(`section.${index}.adaptive_marking_for_each_question`, updatedQuestions);
    }, [watch(`section.${index}.negative_marking.value`)]);

    useEffect(() => {
        if (!durationApplyInitialised.current) {
            durationApplyInitialised.current = true;
            return;
        }
        const questionDurationHrs = getValues(`section.${index}`).question_duration?.hrs;
        const questionDurationMin = getValues(`section.${index}`).question_duration?.min;

        // Loop through adaptive_marking_for_each_question and assign questionMark
        const updatedQuestions = getValues(
            `section.${index}`
        ).adaptive_marking_for_each_question.map((question) => ({
            ...question,
            questionDuration: {
                hrs: questionDurationHrs,
                min: questionDurationMin,
            },
        }));

        // Update the section's adaptive_marking_for_each_question
        setValue(`section.${index}.adaptive_marking_for_each_question`, updatedQuestions);
    }, [
        watch(`section.${index}.question_duration.hrs`),
        watch(`section.${index}.question_duration.min`),
    ]);

    useEffect(() => {
        if (assessmentId !== 'defaultId') {
            // Hydrate this section's questions from the server copy ONLY while the
            // form section is still empty. The effect's dependency is the whole
            // section, so it re-ran on every edit and overwrote questions the user
            // just added (e.g. from a saved paper) with the server copy — which is
            // empty for a freshly created assessment, so the additions vanished.
            const currentQuestions =
                getValues(`section.${index}.adaptive_marking_for_each_question`) || [];
            if (currentQuestions.length > 0 || !adaptiveMarking.adaptiveMarking?.length) {
                return;
            }
            setValue(
                `section.${index}.adaptive_marking_for_each_question`,
                adaptiveMarking.adaptiveMarking
            );
            // setValue(
            //     `section.${index}.marks_per_question`,
            //     String(calculateAverageMarks(adaptiveMarking.adaptiveMarking)),
            // );
            setValue(
                `section.${index}.negative_marking.checked`,
                calculateAveragePenalty(adaptiveMarking.adaptiveMarking) > 0 ? true : false
            );
            setValue(
                `section.${index}.negative_marking.value`,
                String(calculateAveragePenalty(adaptiveMarking.adaptiveMarking))
            );
            if (oldData.current?.section && oldData.current.section[index]) {
                oldData.current.section[index]!.adaptive_marking_for_each_question =
                    adaptiveMarking.adaptiveMarking;
            }
        }
    }, [watch(`section.${index}`)]);

    if (isLoading || adaptiveMarking.isLoading) return <DashboardLoader />;

    return (
        <AccordionItem
            value={`section-${index}`}
            key={index}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md data-[state=open]:shadow-md"
        >
            <AccordionTrigger
                className="flex items-center justify-between px-5 py-4 hover:no-underline [&[data-state=open]]:border-b [&[data-state=open]]:border-neutral-100"
                id="section-details"
                onKeyDown={(e) => {
                    // Prevent accordion toggle when section name editing is enabled or input is focused
                    if (enableSectionName || isInputFocused) {
                        e.preventDefault();
                        e.stopPropagation();
                        return false;
                    }
                    return true;
                }}
                onKeyUp={(e) => {
                    // Prevent accordion toggle when section name editing is enabled or input is focused
                    if (enableSectionName || isInputFocused) {
                        e.preventDefault();
                        e.stopPropagation();
                        return false;
                    }
                    return true;
                }}
                onClick={(e) => {
                    // Prevent accordion toggle when section name editing is enabled or input is focused
                    if (enableSectionName || isInputFocused) {
                        e.preventDefault();
                        e.stopPropagation();
                        return false;
                    }
                    return true;
                }}
            >
                <div className="flex w-full items-center justify-between">
                    {allSections?.[index] ? (
                        <div className="flex items-center justify-start gap-2 text-primary-500">
                            <FormField
                                control={control}
                                name={`section.${index}.sectionName`}
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onChangeFunction={field.onChange}
                                                size="large"
                                                {...field}
                                                ref={sectionNameInputRef}
                                                className="!ml-0 w-20 border-none !pl-0 text-primary-500"
                                                disabled={!enableSectionName}
                                                onClick={(e) => {
                                                    // Prevent accordion toggle when clicking on input
                                                    e.stopPropagation();
                                                }}
                                                onKeyDown={(e) => {
                                                    // Handle Enter key to save and exit edit mode
                                                    if (e.key === 'Enter' && enableSectionName) {
                                                        e.preventDefault();
                                                        e.stopPropagation();

                                                        // Save the changes and exit edit mode
                                                        setEnableSectionName(false);
                                                        form.trigger(
                                                            `section.${index}.sectionName`
                                                        );
                                                        return;
                                                    }

                                                    // Handle Escape key to cancel editing
                                                    if (e.key === 'Escape' && enableSectionName) {
                                                        e.preventDefault();
                                                        e.stopPropagation();

                                                        // Cancel editing and restore original value
                                                        setEnableSectionName(false);
                                                        form.setValue(
                                                            `section.${index}.sectionName`,
                                                            originalSectionName
                                                        );
                                                        return;
                                                    }

                                                    // Prevent accordion toggle when typing in the input field
                                                    if (enableSectionName) {
                                                        e.stopPropagation();
                                                    }
                                                }}
                                                onKeyUp={(e) => {
                                                    // Prevent accordion toggle when typing in the input field
                                                    if (enableSectionName) {
                                                        e.stopPropagation();
                                                    }
                                                }}
                                                onKeyPress={(e) => {
                                                    // Prevent accordion toggle when typing in the input field
                                                    if (enableSectionName) {
                                                        e.stopPropagation();
                                                    }
                                                }}
                                                onFocus={(e) => {
                                                    setIsInputFocused(true);
                                                }}
                                                onBlur={(e) => {
                                                    setIsInputFocused(false);
                                                }}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            {enableSectionName ? (
                                <Check
                                    size={16}
                                    className="cursor-pointer text-primary-600 transition-colors hover:text-primary-700"
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent accordion toggle
                                        setEnableSectionName(false);
                                        // Trigger form validation to save the changes
                                        form.trigger(`section.${index}.sectionName`);
                                    }}
                                />
                            ) : (
                                <PencilSimpleLine
                                    size={16}
                                    className="cursor-pointer text-neutral-600 transition-colors hover:text-primary-600"
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent accordion toggle
                                        setEnableSectionName(true);
                                    }}
                                />
                            )}
                            {allSections?.[index]!.adaptive_marking_for_each_question.length >
                                0 && (
                                <div className="ml-2 flex items-center gap-1.5">
                                    <span className="inline-flex items-center rounded-full bg-info-50 px-2.5 py-0.5 text-xs font-medium text-info-700">
                                        {t('header.mcqSingle')}:{' '}
                                        {getQuestionTypeCounts(
                                            allSections[index]!
                                                .adaptive_marking_for_each_question
                                        ).MCQS}
                                    </span>
                                    <span className="inline-flex items-center rounded-full bg-warning-50 px-2.5 py-0.5 text-xs font-medium text-warning-700">
                                        {t('header.mcqMulti')}:{' '}
                                        {getQuestionTypeCounts(
                                            allSections[index]!
                                                .adaptive_marking_for_each_question
                                        ).MCQM}
                                    </span>
                                    <span className="inline-flex items-center rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700">
                                        {t('header.total')}:{' '}
                                        {getQuestionTypeCounts(
                                            allSections[index]!
                                                .adaptive_marking_for_each_question
                                        ).totalQuestions}
                                    </span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-start gap-2 text-primary-500">
                            <FormField
                                control={control}
                                name={`section.${index}.sectionName`}
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onChangeFunction={field.onChange}
                                                size="large"
                                                {...field}
                                                className="!ml-0 w-20 border-none !pl-0 text-primary-500"
                                                disabled={!enableSectionName}
                                                onClick={(e) => {
                                                    // Prevent accordion toggle when clicking on input
                                                    e.stopPropagation();
                                                }}
                                                onKeyDown={(e) => {
                                                    // Prevent accordion toggle when typing in the input field
                                                    if (enableSectionName) {
                                                        e.stopPropagation();
                                                    }
                                                }}
                                                onKeyUp={(e) => {
                                                    // Prevent accordion toggle when typing in the input field
                                                    if (enableSectionName) {
                                                        e.stopPropagation();
                                                    }
                                                }}
                                                onKeyPress={(e) => {
                                                    // Prevent accordion toggle when typing in the input field
                                                    if (enableSectionName) {
                                                        e.stopPropagation();
                                                    }
                                                }}
                                                onFocus={(e) => {
                                                    setIsInputFocused(true);
                                                }}
                                                onBlur={(e) => {
                                                    setIsInputFocused(false);
                                                }}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            {enableSectionName ? (
                                <Check
                                    size={16}
                                    className="cursor-pointer text-primary-600 transition-colors hover:text-primary-700"
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent accordion toggle
                                        setEnableSectionName(false);
                                        // Trigger form validation to save the changes
                                        form.trigger(`section.${index}.sectionName`);
                                    }}
                                />
                            ) : (
                                <PencilSimpleLine
                                    size={16}
                                    className="cursor-pointer text-neutral-600 transition-colors hover:text-primary-600"
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent accordion toggle
                                        setEnableSectionName(true);
                                    }}
                                />
                            )}
                        </div>
                    )}
                    <div className="flex items-center gap-4">
                        <button
                            type="button"
                            onClick={(e) => handleDeleteSection(e, index)}
                            className="flex size-8 items-center justify-center rounded-lg text-danger-500 transition-colors hover:bg-danger-50"
                            aria-label={t('actions.deleteSection')}
                        >
                            <TrashSimple size={18} />
                        </button>
                    </div>
                </div>
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-6 px-5 pb-5 pt-5">
                <div className="flex flex-col gap-3" id="upload-question-paper">
                    <h3 className="text-sm font-semibold text-neutral-700">
                        {t('uploadSection.title')}
                    </h3>
                    <p className="-mt-2 text-xs text-neutral-500">
                        {t('uploadSection.subtitle')}
                    </p>
                    {/* <AlertDialog
                        open={isUploadFromDeviceDialogOpen}
                        onOpenChange={setIsUploadFromDeviceDialogOpen}
                    >
                        <AlertDialogTrigger>
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="secondary"
                                className="font-thin"
                            >
                                Upload from Device
                            </MyButton>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="p-0">
                            <div className="flex items-center justify-between rounded-md bg-primary-50">
                                <h1 className="rounded-sm p-4 font-bold text-primary-500">
                                    Upload Question Paper From Device
                                </h1>
                                <AlertDialogCancel
                                    className="border-none bg-primary-50 shadow-none hover:bg-primary-50"
                                    onClick={() => setIsUploadFromDeviceDialogOpen(false)}
                                >
                                    <X className="text-neutral-600" />
                                </AlertDialogCancel>
                            </div>
                            <QuestionPaperUpload
                                isManualCreated={false}
                                index={index}
                                sectionsForm={form}
                                currentQuestionIndex={currentQuestionIndex}
                                setCurrentQuestionIndex={setCurrentQuestionIndex}
                                examType={examtype}
                                defaultSubject={defaultSubject}
                            />
                        </AlertDialogContent>
                    </AlertDialog> */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <AlertDialog
                        open={isManualQuestionPaperDialogOpen}
                        onOpenChange={setIsManualQuestionPaperDialogOpen}
                    >
                        <AlertDialogTrigger asChild>
                            <button
                                type="button"
                                className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-400 hover:shadow-md"
                            >
                                <div className="flex size-10 items-center justify-center rounded-lg bg-primary-50 text-primary-500 transition-colors group-hover:bg-primary-500 group-hover:text-white">
                                    <PencilLine size={20} weight="bold" />
                                </div>
                                <div className="flex-1">
                                    <div className="text-sm font-semibold text-neutral-800">
                                        {t('uploadSection.manualCard.title')}
                                    </div>
                                    <div className="text-xs text-neutral-500">
                                        {t('uploadSection.manualCard.subtitle')}
                                    </div>
                                </div>
                            </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="p-0">
                            <div className="flex items-center justify-between rounded-md bg-primary-50">
                                <h1 className="rounded-sm p-4 font-bold text-primary-500">
                                    {t('uploadSection.manualDialog.title')}
                                </h1>
                                <AlertDialogCancel
                                    className="border-none bg-primary-50 shadow-none hover:bg-primary-50"
                                    onClick={() => setIsManualQuestionPaperDialogOpen(false)}
                                >
                                    <X className="text-neutral-600" />
                                </AlertDialogCancel>
                            </div>
                            <QuestionPaperUpload
                                isManualCreated={true}
                                index={index}
                                sectionsForm={form}
                                currentQuestionIndex={currentQuestionIndex}
                                setCurrentQuestionIndex={setCurrentQuestionIndex}
                                examType={examtype}
                                defaultSubject={defaultSubject}
                            />
                        </AlertDialogContent>
                    </AlertDialog>
                    <Dialog
                        open={isSavedQuestionPaperDialogOpen}
                        onOpenChange={setIsSavedQuestionPaperDialogOpen}
                    >
                        <DialogTrigger asChild>
                            <button
                                type="button"
                                className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-400 hover:shadow-md"
                            >
                                <div className="flex size-10 items-center justify-center rounded-lg bg-info-50 text-info-600 transition-colors group-hover:bg-info-500 group-hover:text-white">
                                    <FolderOpen size={20} weight="bold" />
                                </div>
                                <div className="flex-1">
                                    <div className="text-sm font-semibold text-neutral-800">
                                        {t('uploadSection.savedCard.title')}
                                    </div>
                                    <div className="text-xs text-neutral-500">
                                        {t('uploadSection.savedCard.subtitle')}
                                    </div>
                                </div>
                            </button>
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex max-h-dialog-tall w-dialog-xl flex-col items-start !gap-0 overflow-y-auto !p-0 [&>button]:hidden">
                            <DialogTitle className="sr-only">
                                {t('uploadSection.savedDialog.title')}
                            </DialogTitle>
                            <DialogDescription className="sr-only">
                                {t('uploadSection.savedDialog.description')}
                            </DialogDescription>
                            <div className="flex h-14 w-full items-center justify-between rounded-md bg-primary-50">
                                <h1 className="rounded-sm p-4 font-bold text-primary-500">
                                    {t('uploadSection.savedDialog.title')}
                                </h1>
                                <DialogClose
                                    className="mr-4 !border-none bg-primary-50 shadow-none hover:bg-primary-50"
                                    onClick={() => setIsSavedQuestionPaperDialogOpen(false)}
                                >
                                    <X className="text-neutral-600" />
                                </DialogClose>
                            </div>
                            <div className="h-full w-full overflow-y-auto p-8">
                                <QuestionPapersTabs
                                    isAssessment={true}
                                    index={index}
                                    sectionsForm={form}
                                    currentQuestionIndex={currentQuestionIndex}
                                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                                    examType={examtype}
                                    onManualSelectionReady={handleManualSelectionReady}
                                />
                            </div>
                        </DialogContent>
                    </Dialog>
                    {/* Standalone selector dialog — rendered outside the paper-list dialog so it stays mounted */}
                    <QuestionSelectorDialog
                        open={selectorOpen}
                        onOpenChange={(open) => {
                            if (!open) {
                                setSelectorOpen(false);
                                setSelectorQuestions([]);
                            }
                        }}
                        questions={selectorQuestions}
                        onConfirm={handleSelectorConfirm}
                    />
                    <Step2CreateFromKnowledgeBase form={form} index={index} />
                    <Step2PickFromQuestionBank form={form} index={index} />
                    <div className="relative overflow-hidden rounded-xl">
                        <Step2GenerateQuestionsFromAI form={form} index={index} />
                        <BorderBeam
                            size={120}
                            duration={10}
                            colorFrom="hsl(var(--primary-500))"
                        />
                    </div>
                    </div>
                </div>

                {/* Evaluation Criteria Section */}
                {examtype !== 'SURVEY' &&
                    (allSections[index]?.adaptive_marking_for_each_question?.length ?? 0) > 0 && (
                        <div className="relative flex items-center justify-between gap-4 overflow-hidden rounded-xl border border-primary-100 bg-gradient-to-r from-primary-50/40 via-white to-purple-50/30 p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex size-9 items-center justify-center rounded-lg bg-primary-500 text-white shadow-sm">
                                    <Sparkle size={18} weight="fill" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-neutral-800">
                                        {t('criteria.title')}
                                    </h3>
                                    <p className="text-xs text-neutral-500">
                                        {t('criteria.subtitle')}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (bulkGenerating) {
                                        handleCancelBulkGeneration();
                                    } else {
                                        handleBulkGenerateCriteria();
                                    }
                                }}
                                className="relative z-10 flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary-500 to-primary-400 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:translate-y-px"
                            >
                                {bulkGenerating ? (
                                    <>
                                        <Spinner className="animate-spin" />
                                        <span>
                                            {t('criteria.stopProgress', {
                                                current: bulkProgress.current,
                                                total: bulkProgress.total,
                                            })}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkle size={16} weight="fill" />
                                        {t('criteria.generateAll')}
                                    </>
                                )}
                            </button>
                            <BorderBeam
                                size={100}
                                duration={12}
                                colorFrom="hsl(var(--primary-400))"
                            />
                        </div>
                    )}

                <div className="flex flex-col gap-2" id="section-instructions">
                    <h3 className="text-sm font-semibold text-neutral-700">
                        {t('sectionDescription.title')}
                    </h3>
                    <FormField
                        control={control}
                        name={`section.${index}.section_description`}
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <RichTextEditor
                                        onChange={field.onChange}
                                        onBlur={field.onBlur}
                                        value={field.value}
                                        placeholder={t('sectionDescription.placeholder')}
                                        minHeight={120}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                </div>

                {watch(`testDuration.questionWiseDuration`) && examtype !== 'SURVEY' && (
                    <div className="flex w-96 items-center justify-between text-sm font-thin">
                        <h1 className="font-normal">
                            {t('duration.questionDuration')}{' '}
                            {getStepKey({
                                assessmentDetails,
                                currentStep,
                                key: 'section_duration',
                            }) === 'REQUIRED' && (
                                <span className="text-subtitle text-danger-600">*</span>
                            )}
                        </h1>
                        <div className="flex items-center gap-4">
                            <FormField
                                control={control}
                                name={`section.${index}.question_duration.hrs`}
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onKeyPress={(e) => {
                                                    const charCode = e.key;
                                                    if (!/[0-9]/.test(charCode)) {
                                                        e.preventDefault(); // Prevent non-numeric input
                                                    }
                                                }}
                                                onChangeFunction={(e) => {
                                                    const inputValue = e.target.value.replace(
                                                        /[^0-9]/g,
                                                        ''
                                                    ); // Remove non-numeric characters
                                                    field.onChange(inputValue); // Call onChange with the sanitized value
                                                }}
                                                size="large"
                                                {...field}
                                                className="w-11"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <span>{t('duration.hrs')}</span>
                            <span>:</span>
                            <FormField
                                control={control}
                                name={`section.${index}.question_duration.min`}
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onKeyPress={(e) => {
                                                    const charCode = e.key;
                                                    if (!/[0-9]/.test(charCode)) {
                                                        e.preventDefault(); // Prevent non-numeric input
                                                    }
                                                }}
                                                onChangeFunction={(e) => {
                                                    const inputValue = e.target.value.replace(
                                                        /[^0-9]/g,
                                                        ''
                                                    ); // Remove non-numeric characters
                                                    field.onChange(inputValue); // Call onChange with the sanitized value
                                                }}
                                                size="large"
                                                {...field}
                                                className="w-11"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <span>{t('duration.minutes')}</span>
                        </div>
                    </div>
                )}
                {watch(`testDuration.sectionWiseDuration`) && examtype !== 'SURVEY' && (
                    <div className="flex w-96 items-center justify-between text-sm font-thin">
                        <h1 className="font-normal">
                            {t('duration.sectionDuration')}{' '}
                            {getStepKey({
                                assessmentDetails,
                                currentStep,
                                key: 'section_duration',
                            }) === 'REQUIRED' && (
                                <span className="text-subtitle text-danger-600">*</span>
                            )}
                        </h1>
                        <div className="flex items-center gap-4">
                            <FormField
                                control={control}
                                name={`section.${index}.section_duration.hrs`}
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onKeyPress={(e) => {
                                                    const charCode = e.key;
                                                    if (!/[0-9]/.test(charCode)) {
                                                        e.preventDefault(); // Prevent non-numeric input
                                                    }
                                                }}
                                                onChangeFunction={(e) => {
                                                    const inputValue = e.target.value.replace(
                                                        /[^0-9]/g,
                                                        ''
                                                    ); // Remove non-numeric characters
                                                    field.onChange(inputValue); // Call onChange with the sanitized value
                                                }}
                                                size="large"
                                                {...field}
                                                className="w-11"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <span>{t('duration.hrs')}</span>
                            <span>:</span>
                            <FormField
                                control={control}
                                name={`section.${index}.section_duration.min`}
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onKeyPress={(e) => {
                                                    const charCode = e.key;
                                                    if (!/[0-9]/.test(charCode)) {
                                                        e.preventDefault(); // Prevent non-numeric input
                                                    }
                                                }}
                                                onChangeFunction={(e) => {
                                                    const inputValue = e.target.value.replace(
                                                        /[^0-9]/g,
                                                        ''
                                                    ); // Remove non-numeric characters
                                                    field.onChange(inputValue); // Call onChange with the sanitized value
                                                }}
                                                size="large"
                                                {...field}
                                                className="w-11"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <span>{t('duration.minutes')}</span>
                        </div>
                    </div>
                )}
                {examtype !== 'SURVEY' && (
                    <div
                        id="marking-scheme"
                        className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-neutral-50/40 p-5"
                    >
                        <div className="flex items-center justify-between gap-4 text-sm">
                            <div className="flex items-center gap-3">
                                <div className="flex size-9 items-center justify-center rounded-lg bg-primary-100 text-primary-600">
                                    <ListNumbers size={18} weight="bold" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-neutral-800">
                                        {t('markingScheme.marksPerQuestion.title')}
                                        {getStepKey({
                                            assessmentDetails,
                                            currentStep,
                                            key: 'marks_per_question',
                                        }) === 'REQUIRED' && (
                                            <span className="ml-0.5 text-danger-600">*</span>
                                        )}
                                    </h3>
                                    <p className="text-xs text-neutral-500">
                                        {t('markingScheme.marksPerQuestion.subtitle')}
                                    </p>
                                </div>
                            </div>
                            <FormField
                                control={control}
                                name={`section.${index}.marks_per_question`}
                                render={({ field: { ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder="00"
                                                input={field.value}
                                                onKeyPress={(e) => {
                                                    const charCode = e.key;
                                                    if (
                                                        !/[0-9.]/.test(charCode) ||
                                                        (charCode === '.' &&
                                                            field.value?.includes('.'))
                                                    ) {
                                                        e.preventDefault(); // Prevent non-numeric and multiple decimals
                                                    }
                                                }}
                                                onChangeFunction={(e) => {
                                                    const inputValue = e.target.value.replace(
                                                        /[^0-9.]/g,
                                                        ''
                                                    ); // Allow numbers and decimal
                                                    if (inputValue.split('.').length > 2) return; // Prevent multiple decimals
                                                    field.onChange(inputValue);
                                                }}
                                                size="large"
                                                {...field}
                                                className="w-14 text-center"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>
                        <div className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3">
                            <div className="flex flex-1 items-center gap-4">
                                <h3 className="text-sm font-medium text-neutral-700">
                                    {t('markingScheme.negativeMarking')}
                                    {getStepKey({
                                        assessmentDetails,
                                        currentStep,
                                        key: 'negative_marking',
                                    }) === 'REQUIRED' && (
                                        <span className="ml-0.5 text-danger-600">*</span>
                                    )}
                                </h3>
                                <FormField
                                    control={control}
                                    name={`section.${index}.negative_marking.value`}
                                    render={({ field: { ...field } }) => (
                                        <FormItem>
                                            <FormControl>
                                                <MyInput
                                                    disabled={
                                                        form.getValues(
                                                            `section.${index}.negative_marking.checked`
                                                        )
                                                            ? false
                                                            : true
                                                    }
                                                    inputType="text"
                                                    inputPlaceholder="00"
                                                    input={field.value}
                                                    onKeyPress={(e) => {
                                                        const charCode = e.key;
                                                        if (
                                                            !/[0-9.]/.test(charCode) ||
                                                            (charCode === '.' &&
                                                                field.value?.includes('.'))
                                                        ) {
                                                            e.preventDefault(); // Prevent non-numeric and multiple decimals
                                                        }
                                                    }}
                                                    onChangeFunction={(e) => {
                                                        const inputValue = e.target.value.replace(
                                                            /[^0-9.]/g,
                                                            ''
                                                        ); // Allow numbers and decimal
                                                        if (inputValue.split('.').length > 2)
                                                            return; // Prevent multiple decimals
                                                        field.onChange(inputValue);
                                                    }}
                                                    size="large"
                                                    {...field}
                                                    className="w-14 text-center"
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <FormField
                                control={control}
                                name={`section.${index}.negative_marking.checked`}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>
                        <FormField
                            control={form.control}
                            name={`section.${index}.partial_marking`}
                            render={({ field }) => (
                                <FormItem className="flex items-center justify-between gap-4 space-y-0 rounded-lg border border-neutral-200 bg-white px-4 py-3">
                                    <FormLabel className="flex-1 text-sm font-medium text-neutral-700">
                                        {t('markingScheme.partialMarking')}
                                        {getStepKey({
                                            assessmentDetails,
                                            currentStep,
                                            key: 'partial_marking',
                                        }) === 'REQUIRED' && (
                                            <span className="ml-0.5 text-danger-600">*</span>
                                        )}
                                    </FormLabel>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        {/* will be adding it later
                        <div className="flex w-1/2 items-center justify-between">
                            <div className="flex w-52 items-center justify-between gap-4">
                                <h1>Cut off Marks</h1>
                                <FormField
                                    control={control}
                                    name={`section.${index}.cutoff_marks.value`}
                                    render={({ field: { ...field } }) => (
                                        <FormItem>
                                            <FormControl>
                                                <MyInput
                                                    disabled={
                                                        form.getValues(
                                                            `section.${index}.cutoff_marks.checked`,
                                                        )
                                                            ? false
                                                            : true
                                                    }
                                                    onKeyPress={(e) => {
                                                        const charCode = e.key;
                                                        if (
                                                            !/[0-9.]/.test(charCode) ||
                                                            (charCode === "." &&
                                                                field.value.includes("."))
                                                        ) {
                                                            e.preventDefault(); // Prevent non-numeric and multiple decimals
                                                        }
                                                    }}
                                                    onChangeFunction={(e) => {
                                                        const inputValue = e.target.value.replace(
                                                            /[^0-9.]/g,
                                                            "",
                                                        ); // Allow numbers and decimal
                                                        if (inputValue.split(".").length > 2)
                                                            return; // Prevent multiple decimals
                                                        field.onChange(inputValue);
                                                    }}
                                                    inputType="text"
                                                    inputPlaceholder="00"
                                                    input={field.value}
                                                    size="large"
                                                    {...field}
                                                    className="mr-2 w-11"
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <FormField
                                control={control}
                                name={`section.${index}.cutoff_marks.checked`}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div> */}
                    </div>
                )}
                {examtype !== 'SURVEY' && (
                    <FormField
                        control={form.control}
                        name={`section.${index}.problem_randomization`}
                        render={({ field }) => (
                            <FormItem className="flex items-center justify-between gap-4 space-y-0 rounded-lg border border-neutral-200 bg-white px-4 py-3">
                                <div className="flex flex-1 items-center gap-3">
                                    <div className="flex size-8 items-center justify-center rounded-md bg-info-50 text-info-600">
                                        <Shuffle size={16} weight="bold" />
                                    </div>
                                    <FormLabel className="text-sm font-medium text-neutral-700">
                                        {t('randomization.problemRandomization')}
                                    </FormLabel>
                                </div>
                                <FormControl>
                                    <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                )}
                {Boolean(allSections?.[index]?.adaptive_marking_for_each_question?.length) && (
                    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50/60 px-4 py-3">
                            <h3 className="text-sm font-semibold text-neutral-800">
                                {examtype === 'SURVEY'
                                    ? t('table.surveyQuestionsTitle')
                                    : t('table.adaptiveMarkingRulesTitle')}
                            </h3>
                            <span className="rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-semibold text-primary-600">
                                {t('table.questionCount', {
                                    count:
                                        allSections[index]?.adaptive_marking_for_each_question
                                            ?.length ?? 0,
                                })}
                            </span>
                        </div>
                        <Table>
                            <TableHeader className="bg-neutral-50">
                                <TableRow className="border-neutral-100 hover:bg-neutral-50">
                                    <TableHead>{t('table.headers.qno')}</TableHead>
                                    <TableHead>
                                        {examtype === 'SURVEY'
                                            ? t('table.headers.surveyQuestion')
                                            : t('table.headers.question')}
                                    </TableHead>
                                    <TableHead>{t('table.headers.questionType')}</TableHead>
                                    {examtype !== 'SURVEY' && (
                                        <TableHead>{t('table.headers.marks')}</TableHead>
                                    )}
                                    {examtype !== 'SURVEY' && (
                                        <TableHead>{t('table.headers.penalty')}</TableHead>
                                    )}
                                    {watch(`testDuration.questionWiseDuration`) &&
                                        examtype !== 'SURVEY' && (
                                            <TableHead>{t('table.headers.time')}</TableHead>
                                        )}
                                    {examtype !== 'SURVEY' && (
                                        <TableHead>{t('table.headers.criteria')}</TableHead>
                                    )}
                                    {assessmentId !== 'defaultId' && (
                                        <TableHead>
                                            <span className="sr-only">
                                                {t('table.editQuestion')}
                                            </span>
                                        </TableHead>
                                    )}
                                </TableRow>
                            </TableHeader>
                            <TableBody className="bg-white">
                                {allSections[index] &&
                                    allSections[index]?.adaptive_marking_for_each_question?.map(
                                        (question, idx) => {
                                            return (
                                                <TableRow key={idx}>
                                                    <TableCell>{idx + 1}</TableCell>
                                                    <TableCell>
                                                        <div className="w-full max-w-md">
                                                            <TipTapEditor
                                                                value={question.questionName || ''}
                                                                editable={false}
                                                                onChange={() => {}}
                                                            />
                                                            {/* The choices, key marked - a stem alone
                                                                does not tell a teacher which option the
                                                                AI will grade against. */}
                                                            <QuestionOptionsList
                                                                options={question.options}
                                                            />
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>{question.questionType}</TableCell>
                                                    {examtype !== 'SURVEY' && (
                                                        <TableCell>
                                                            <FormField
                                                                control={control}
                                                                name={`section.${index}.adaptive_marking_for_each_question.${idx}.questionMark`}
                                                                render={({
                                                                    field: { ...field },
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormControl>
                                                                            <Input
                                                                                type="text"
                                                                                placeholder="00"
                                                                                className="w-11"
                                                                                value={field.value}
                                                                                onChange={
                                                                                    field.onChange
                                                                                }
                                                                            />
                                                                        </FormControl>
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        </TableCell>
                                                    )}
                                                    {examtype !== 'SURVEY' && (
                                                        <TableCell>
                                                            <FormField
                                                                control={control}
                                                                name={`section.${index}.adaptive_marking_for_each_question.${idx}.questionPenalty`}
                                                                render={({
                                                                    field: { ...field },
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormControl>
                                                                            <Input
                                                                                disabled={
                                                                                    form.getValues(
                                                                                        `section.${index}.negative_marking.checked`
                                                                                    )
                                                                                        ? false
                                                                                        : true
                                                                                }
                                                                                type="text"
                                                                                placeholder="00"
                                                                                className="w-11"
                                                                                value={field.value}
                                                                                onChange={
                                                                                    field.onChange
                                                                                }
                                                                            />
                                                                        </FormControl>
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        </TableCell>
                                                    )}
                                                    {watch(`testDuration.questionWiseDuration`) &&
                                                        examtype !== 'SURVEY' && (
                                                            <TableCell>
                                                                <div className="flex items-center gap-2">
                                                                    <FormField
                                                                        control={control}
                                                                        name={`section.${index}.adaptive_marking_for_each_question.${idx}.questionDuration.hrs`}
                                                                        render={({
                                                                            field: { ...field },
                                                                        }) => (
                                                                            <FormItem>
                                                                                <FormControl>
                                                                                    <Input
                                                                                        type="text"
                                                                                        placeholder="00"
                                                                                        className="w-11"
                                                                                        value={
                                                                                            field.value
                                                                                        }
                                                                                        onChange={
                                                                                            field.onChange
                                                                                        }
                                                                                    />
                                                                                </FormControl>
                                                                            </FormItem>
                                                                        )}
                                                                    />
                                                                    <span>:</span>
                                                                    <FormField
                                                                        control={control}
                                                                        name={`section.${index}.adaptive_marking_for_each_question.${idx}.questionDuration.min`}
                                                                        render={({
                                                                            field: { ...field },
                                                                        }) => (
                                                                            <FormItem>
                                                                                <FormControl>
                                                                                    <Input
                                                                                        type="text"
                                                                                        placeholder="00"
                                                                                        className="w-11"
                                                                                        value={
                                                                                            field.value
                                                                                        }
                                                                                        onChange={
                                                                                            field.onChange
                                                                                        }
                                                                                    />
                                                                                </FormControl>
                                                                            </FormItem>
                                                                        )}
                                                                    />
                                                                </div>
                                                            </TableCell>
                                                        )}
                                                    {examtype !== 'SURVEY' && (
                                                        <TableCell>
                                                            <CriteriaStatusBadge
                                                                status={
                                                                    (question as any)
                                                                        ?.evaluation_criteria_json
                                                                        ? ((question as any)
                                                                              ?.criteria_source as CriteriaSource) ||
                                                                          'manual'
                                                                        : 'not-added'
                                                                }
                                                                onClick={() => {
                                                                    setSelectedQuestionIndex(idx);
                                                                    setCriteriaDialogOpen(true);
                                                                }}
                                                                onPreview={
                                                                    (question as any)
                                                                        ?.evaluation_criteria_json
                                                                        ? () => {
                                                                              setCriteriaPreview(
                                                                                  parseCriteria(
                                                                                      (
                                                                                          question as any
                                                                                      )
                                                                                          .evaluation_criteria_json!
                                                                                  )
                                                                              );
                                                                              setPreviewDialogOpen(
                                                                                  true
                                                                              );
                                                                          }
                                                                        : undefined
                                                                }
                                                            />
                                                        </TableCell>
                                                    )}
                                                    {assessmentId !== 'defaultId' && (
                                                        <TableCell>
                                                            {/* Saved assessments only: a new one has no
                                                                question rows on the server to edit yet. */}
                                                            {question.questionId && (
                                                                <AssessmentQuestionEditDialog
                                                                    assessmentId={assessmentId}
                                                                    sectionId={form.getValues(
                                                                        `section.${index}.sectionId`
                                                                    )}
                                                                    questionId={question.questionId}
                                                                    examType={examtype}
                                                                    onSaved={(saved) => {
                                                                        setValue(
                                                                            `section.${index}.adaptive_marking_for_each_question.${idx}.questionName`,
                                                                            saved.questionName
                                                                        );
                                                                        setValue(
                                                                            `section.${index}.adaptive_marking_for_each_question.${idx}.questionType`,
                                                                            saved.questionType
                                                                        );
                                                                        setValue(
                                                                            `section.${index}.adaptive_marking_for_each_question.${idx}.options`,
                                                                            optionsOfSavedQuestion(
                                                                                saved
                                                                            )
                                                                        );
                                                                    }}
                                                                />
                                                            )}
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            );
                                        }
                                    )}
                            </TableBody>
                        </Table>
                    </div>
                )}
                {examtype !== 'SURVEY' &&
                    (watch(`section.${index}.marks_per_question`) ||
                        watch(`section.${index}.total_marks`)) && (
                        <div className="flex items-center justify-end">
                            <div className="flex items-center gap-2 rounded-full border border-primary-200 bg-gradient-to-r from-primary-50 to-primary-100/50 px-4 py-1.5">
                                <span className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                                    {t('totalMarks.label')}
                                </span>
                                <NumberTicker
                                    value={Number(
                                        calculateTotalMarks(
                                            getValues(
                                                `section.${index}.adaptive_marking_for_each_question`
                                            )
                                        ) || 0
                                    )}
                                    className="text-base font-bold text-primary-600"
                                />
                            </div>
                        </div>
                    )}
            </AccordionContent>

            {/* Criteria Dialogs */}
            {selectedQuestionIndex !== null && (
                <AddEditCriteriaDialog
                    question={{
                        text:
                            allSections[index]?.adaptive_marking_for_each_question[
                                selectedQuestionIndex
                            ]?.questionName || '',
                        question_type:
                            allSections[index]?.adaptive_marking_for_each_question[
                                selectedQuestionIndex
                            ]?.questionType || '',
                        max_marks: Number(
                            allSections[index]?.adaptive_marking_for_each_question[
                                selectedQuestionIndex
                            ]?.questionMark || 0
                        ),
                        subject: String(getValues('testCreation.subject' as any) ?? ''),
                    }}
                    existingCriteria={
                        allSections[index]?.adaptive_marking_for_each_question[
                            selectedQuestionIndex
                        ]?.evaluation_criteria_json
                            ? parseCriteria(
                                  allSections[index]?.adaptive_marking_for_each_question[
                                      selectedQuestionIndex
                                  ]?.evaluation_criteria_json!
                              ) ?? undefined
                            : undefined
                    }
                    open={criteriaDialogOpen}
                    onSave={(criteria: CriteriaJson, source: CriteriaSource) => {
                        // Update the question with criteria
                        const updatedQuestions = [
                            ...allSections[index]!.adaptive_marking_for_each_question,
                        ];
                        updatedQuestions[selectedQuestionIndex] = {
                            ...updatedQuestions[selectedQuestionIndex]!,
                            evaluation_criteria_json: stringifyCriteria(criteria),
                            criteria_source: source,
                        } as any;
                        setValue(
                            `section.${index}.adaptive_marking_for_each_question`,
                            updatedQuestions
                        );
                        setCriteriaDialogOpen(false);
                        setSelectedQuestionIndex(null);
                    }}
                    onClose={() => {
                        setCriteriaDialogOpen(false);
                        setSelectedQuestionIndex(null);
                    }}
                />
            )}

            {/* Criteria Preview Dialog */}
            <CriteriaPreviewDialog
                criteria={criteriaPreview}
                open={previewDialogOpen}
                onClose={() => {
                    setPreviewDialogOpen(false);
                    setCriteriaPreview(null);
                }}
            />
        </AccordionItem>
    );
};

export default Step2SectionInfo;
