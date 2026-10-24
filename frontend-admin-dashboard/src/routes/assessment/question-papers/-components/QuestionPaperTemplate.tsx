import { DotsSixVertical, Plus, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useFieldArray } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PPTComponentFactory } from './QuestionPaperTemplatesTypes/PPTComponentFactory';
import { MainViewComponentFactory } from './QuestionPaperTemplatesTypes/MainViewComponentFactory';
import { QuestionPaperTemplateProps } from '@/types/assessments/question-paper-template';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    getQuestionPaperById,
    getQuestionTagsQuery,
    updateQuestionPaper,
} from '../-utils/question-paper-services';
import { SubjectTagInput } from './SubjectTagInput';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { MyButton } from '@/components/design-system/button';
import {
    getIdByLevelName,
    getIdBySubjectName,
    transformResponseDataToMyQuestionsSchema,
    getPPTViewTitle,
    findNumericQuestionWithoutAnswer,
} from '../-utils/helper';
import {
    MyQuestion,
    MyQuestionPaperFormEditInterface,
    MyQuestionPaperFormInterface,
} from '../../../../types/assessments/question-paper-form';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { toast } from 'sonner';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { QuestionPaperEditDialog } from './QuestionPaperEditDialogue';
import { useRefetchStore } from '../-global-states/refetch-store';
import useInstituteLogoStore from '@/components/common/layout-container/sidebar/institutelogo-global-zustand';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { QuestionType } from '@/constants/dummy-data';
import { cn } from '@/lib/utils';
import { QuestionTypeSelection } from './QuestionTypeSelection';
import { DialogClose } from '@radix-ui/react-dialog';

export function QuestionPaperTemplate({
    form,
    questionPaperId,
    isViewMode,
    isManualCreated,
    buttonText,
    isAssessment,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    examType,
    triggerVariant = 'plain',
    open,
    onOpenChange,
    hideTrigger = false,
    onValidSave,
}: QuestionPaperTemplateProps) {
    const { t } = useTranslation('assessmentQuestionPaperTemplate');
    const [internalOpen, setInternalOpen] = useState(false);
    // Controlled when the parent passes `open`; otherwise the built-in trigger owns it.
    const isQuestionPaperTemplateDialog = open ?? internalOpen;
    const setIsQuestionPaperTemplateDialog = (value: boolean) => {
        if (open === undefined) setInternalOpen(value);
        onOpenChange?.(value);
    };
    const { instituteLogo } = useInstituteLogoStore();
    const { handleRefetchData } = useRefetchStore();
    const queryClient = useQueryClient();
    const { instituteDetails } = useInstituteDetailsStore();
    const [addQuestionDialogBox, setAddQuestionDialogBox] = useState(false);
    const { getValues, setValue, formState, watch } = form;
    const questions = watch('questions') || [];
    const title = watch('title') || '';
    const yearClass = getValues('yearClass') || '';
    const subject = getValues('subject') || '';
    const [isQuestionDataLoading, setIsQuestionDataLoading] = useState(false);
    const [previousQuestionPaperData, setPreviousQuestionPaperData] = useState(
        {} as MyQuestionPaperFormEditInterface
    );

    watch(`questions.${currentQuestionIndex}`);
    watch(`questions.${currentQuestionIndex}.questionType`);
    watch(`questions.${currentQuestionIndex}.tags`);

    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];
    const { data: questionTags } = useQuery(getQuestionTagsQuery(INSTITUTE_ID));
    const tagSuggestions = (questionTags ?? []).map((tag) => tag.tag_name);

    // Copy the current question's tags onto every question (case-insensitive merge).
    const applyCurrentTagsToAll = () => {
        const currentTags: string[] = getValues(`questions.${currentQuestionIndex}.tags`) || [];
        if (currentTags.length === 0) {
            toast.error(t('toasts.addTagFirst'));
            return;
        }
        const allQuestions = getValues('questions') || [];
        allQuestions.forEach((_, idx) => {
            const existing: string[] = getValues(`questions.${idx}.tags`) || [];
            const seen = new Set(existing.map((tg) => tg.toLowerCase()));
            const merged = [...existing];
            currentTags.forEach((tg) => {
                if (!seen.has(tg.toLowerCase())) {
                    seen.add(tg.toLowerCase());
                    merged.push(tg);
                }
            });
            setValue(`questions.${idx}.tags`, merged, { shouldDirty: true });
        });
        toast.success(
            t('toasts.tagsApplied', {
                tags: t('common.tagCount', { count: currentTags.length }),
                questions: t('common.questionCount', { count: allQuestions.length }),
            })
        );
    };

    // UseFieldArray to manage questions array
    const { fields, append, move } = useFieldArray({
        control: form.control,
        name: 'questions', // Name of the field array
    });

    // Function to handle adding a new question
    const handleAddNewQuestion = (newQuestionType: string) => {
        append({
            questionId: String(questions.length + 1),
            questionName: '',
            explanation: '',
            questionType: newQuestionType,
            questionPenalty: '',
            questionDuration: {
                hrs: '',
                min: '',
            },
            questionMark: '',
            singleChoiceOptions: [
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
            ],
            multipleChoiceOptions: [
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
            ],
            trueFalseOptions: [
                {
                    name: 'True',
                    isSelected: false,
                },
                {
                    name: 'False',
                    isSelected: false,
                },
            ],
            csingleChoiceOptions: [
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
            ],
            cmultipleChoiceOptions: [
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
                {
                    name: '',
                    isSelected: false,
                },
            ],
            validAnswers: [],
            subjectiveAnswerText: '',
            numericType: '',
            parentRichTextContent: null,
            decimals: 0,
            questionResponseType: null,
            questionPoints: '',
            reattemptCount: '',
            timestamp: '',
        });
        // Set current question index to the newly added question (last question)
        setCurrentQuestionIndex(questions.length);
        setAddQuestionDialogBox(false);
        form.trigger();
    };

    const handleUpdateQuestionPaper = useMutation({
        mutationFn: ({
            data,
            previousQuestionPaperData,
        }: {
            data: MyQuestionPaperFormInterface;
            previousQuestionPaperData: MyQuestionPaperFormEditInterface;
        }) => updateQuestionPaper(data, previousQuestionPaperData),
        onSuccess: () => {
            setCurrentQuestionIndex(0);
            handleRefetchData();
            toast.success(t('toasts.updateSuccess'), {
                className: 'success-toast',
                duration: 2000,
            });
            setIsQuestionPaperTemplateDialog(false);
            queryClient.invalidateQueries({ queryKey: ['GET_QUESTION_PAPER_FILTERED_DATA'] });
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    // A numeric question saved without an answer grades every learner wrong, so stop
    // on the first one and take the teacher to it. Only where the paper is known to be
    // graded: surveys have no answer key, and the library and assignment editors do
    // not say what the paper is for.
    const stopOnMissingNumericAnswer = (
        questions?: MyQuestionPaperFormInterface['questions'],
        previous?: MyQuestionPaperFormInterface['questions']
    ) => {
        if (!examType || examType === 'SURVEY') return false;
        const index = findNumericQuestionWithoutAnswer(questions, previous);
        if (index === -1) return false;
        setCurrentQuestionIndex(index);
        toast.error(t('toasts.numericAnswerMissing', { number: index + 1 }), {
            className: 'error-toast',
            duration: 3000,
        });
        return true;
    };

    const handleSaveClick = (values: MyQuestionPaperFormInterface) => {
        if (stopOnMissingNumericAnswer(values.questions, previousQuestionPaperData?.questions)) {
            return;
        }
        const changedValues = {
            ...values,
            ...(values.yearClass !== 'N/A' && {
                yearClass: getIdByLevelName(instituteDetails?.levels || [], yearClass),
            }),
            ...(values.subject !== 'N/A' && {
                subject: getIdBySubjectName(instituteDetails?.subjects || [], subject),
            }),
        };
        handleUpdateQuestionPaper.mutate({ data: changedValues, previousQuestionPaperData });
    };

    const handleMutationViewQuestionPaper = useMutation({
        mutationFn: ({ questionPaperId }: { questionPaperId: string | undefined }) =>
            getQuestionPaperById(questionPaperId),
        onMutate: () => {
            setIsQuestionDataLoading(true);
        },
        onSettled: () => {
            setIsQuestionDataLoading(false);
        },
        onSuccess: async (data) => {
            const transformQuestionsData: MyQuestion[] = transformResponseDataToMyQuestionsSchema(
                data.question_dtolist
            );
            setPreviousQuestionPaperData({
                questionPaperId: questionPaperId,
                title: title,
                ...(data.yearClass !== 'N/A' && {
                    level_id: getIdByLevelName(instituteDetails?.levels || [], yearClass),
                }),
                ...(data.subject !== 'N/A' && {
                    subject_id: getIdBySubjectName(instituteDetails?.subjects || [], subject),
                }),
                // Deep-clone: this snapshot must stay independent of the live form value below,
                // since react-hook-form's setValue mutates nested question objects in place —
                // sharing references here made edits invisible to the added/updated/deleted diff.
                questions: structuredClone(transformQuestionsData),
            });
            setValue('questions', transformQuestionsData);
            queryClient.invalidateQueries({ queryKey: ['GET_QUESTION_PAPER_FILTERED_DATA'] });
        },
        onError: (error: unknown) => {
            setIsQuestionDataLoading(false);
            throw error;
        },
    });

    const handleViewQuestionPaper = () => {
        handleMutationViewQuestionPaper.mutate({ questionPaperId });
    };

    // Re-validate form when examType changes
    useEffect(() => {
        if (examType) {
            // Clear any existing errors first
            form.clearErrors();
            // Then trigger validation with the new schema
            form.trigger();
        }
    }, [examType, form]);

    const handleTriggerForm = () => {
        form.trigger();
        if (stopOnMissingNumericAnswer(form.getValues('questions') as MyQuestion[])) return;

        const errors = form.formState.errors;
        if (Object.values(errors).length > 0) {
            toast.error(t('toasts.incompleteQuestions'), {
                className: 'error-toast',
                duration: 3000,
            });
            return;
        }

        if (onValidSave) {
            onValidSave();
            return;
        }

        setIsQuestionPaperTemplateDialog(false);
    };

    return (
        <Dialog
            open={isQuestionPaperTemplateDialog}
            onOpenChange={setIsQuestionPaperTemplateDialog}
        >
            <DialogTrigger
                asChild={isViewMode && triggerVariant === 'secondary'}
                // Controlled callers open the dialog themselves.
                className={hideTrigger ? 'hidden' : undefined}
            >
                {isViewMode ? (
                    triggerVariant === 'secondary' ? (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            layoutVariant="default"
                            className="h-8 gap-1.5"
                            onClick={handleViewQuestionPaper}
                        >
                            {buttonText}
                        </MyButton>
                    ) : (
                        <Button
                            type="button"
                            variant="outline"
                            className={cn(
                                'm-0 border-none pl-2 font-normal shadow-none',
                                isAssessment ? 'text-primary-500' : ''
                            )}
                            onClick={handleViewQuestionPaper}
                        >
                            {buttonText}
                        </Button>
                    )
                ) : (
                    <Button type="button" variant="outline" className="w-52 border">
                        {isManualCreated ? (
                            <p className="flex items-center gap-1">
                                {buttonText} <Plus className="!size-4" />
                            </p>
                        ) : (
                            buttonText
                        )}
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="no-scrollbar !m-0 !h-screen !w-full !max-w-full !gap-0 !overflow-hidden !rounded-none !p-0 [&>button]:hidden">
                {isQuestionDataLoading ? (
                    <DashboardLoader />
                ) : (
                    <div className="flex h-screen flex-col">
                        <div className="flex h-14 w-full shrink-0 items-center justify-between gap-4 border-b border-neutral-200 bg-primary-50 px-4">
                            <div className="flex min-w-0 items-center gap-3">
                                <img
                                    src={instituteLogo}
                                    alt={t('header.logoAlt')}
                                    className="size-9 shrink-0 rounded-full object-cover"
                                />
                                <div className="flex min-w-0 items-center gap-1">
                                    <h1 className="truncate text-title font-semibold text-neutral-700">
                                        {title || t('header.untitled')}
                                    </h1>
                                    <QuestionPaperEditDialog form={form} />
                                </div>
                                <span className="hidden shrink-0 rounded-full bg-white px-2 py-0.5 text-caption text-neutral-600 sm:inline">
                                    {t('common.questionCount', { count: questions.length })}
                                </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <DialogClose asChild>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="medium"
                                        layoutVariant="default"
                                        className="min-w-24 sm:min-w-24"
                                    >
                                        {t('header.exit')}
                                    </MyButton>
                                </DialogClose>
                                <MyButton
                                    type="button"
                                    buttonType="primary"
                                    scale="medium"
                                    layoutVariant="default"
                                    className="min-w-24 sm:min-w-24"
                                    onClick={
                                        isViewMode
                                            ? () =>
                                                  handleSaveClick(
                                                      form.getValues() as MyQuestionPaperFormInterface
                                                  )
                                            : handleTriggerForm
                                    }
                                >
                                    {t('header.save')}
                                </MyButton>
                            </div>
                        </div>
                        <div className="flex min-h-0 flex-1 items-stretch">
                            <div className="flex h-full w-48 shrink-0 flex-col gap-3 border-r border-neutral-200 bg-neutral-50 p-3">
                                <AlertDialog
                                    open={addQuestionDialogBox}
                                    onOpenChange={setAddQuestionDialogBox}
                                >
                                    <AlertDialogTrigger asChild>
                                        <MyButton
                                            type="button"
                                            buttonType="primary"
                                            scale="medium"
                                            layoutVariant="default"
                                            className="w-full gap-1 sm:min-w-0"
                                        >
                                            <Plus size={16} />
                                            {t('actions.addQuestion')}
                                        </MyButton>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent className="h-4/5 overflow-y-auto p-0">
                                        <div className="sticky top-0 flex items-center justify-between rounded-md bg-primary-50">
                                            <h1 className="rounded-sm p-4 font-bold text-primary-500">
                                                {t('dialogs.addQuestion.title')}
                                            </h1>
                                            <AlertDialogCancel
                                                onClick={() => setAddQuestionDialogBox(false)}
                                                className="border-none bg-primary-50 shadow-none hover:bg-primary-50"
                                            >
                                                <X className="text-neutral-600" />
                                            </AlertDialogCancel>
                                        </div>
                                        <QuestionTypeSelection
                                            currentQuestionIndex={currentQuestionIndex}
                                            setCurrentQuestionIndex={setCurrentQuestionIndex}
                                            isDirectAdd={false}
                                            handleSelect={handleAddNewQuestion}
                                        ></QuestionTypeSelection>
                                    </AlertDialogContent>
                                </AlertDialog>
                                <span className="px-1 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                    {t('sidebar.questionsLabel')}
                                </span>
                                <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-1">
                                    <Sortable
                                        value={fields}
                                        onMove={({ activeIndex, overIndex }) =>
                                            move(activeIndex, overIndex)
                                        }
                                    >
                                        <div className="flex flex-col gap-2 overflow-x-hidden pb-4">
                                            {fields.map((field, index) => {
                                                // Check if the current question has an error
                                                const hasError =
                                                    formState.errors?.questions?.[index];
                                                const isActive = currentQuestionIndex === index;
                                                return (
                                                    <SortableItem
                                                        key={field.id}
                                                        value={field.id}
                                                        asChild
                                                    >
                                                        <div
                                                            onClick={() =>
                                                                setCurrentQuestionIndex(index)
                                                            }
                                                            className={cn(
                                                                'group cursor-pointer rounded-lg border bg-white p-2 transition-colors',
                                                                isActive
                                                                    ? 'border-primary-500 ring-1 ring-primary-500'
                                                                    : 'border-neutral-200 hover:border-primary-200',
                                                                hasError && !isActive
                                                                    ? 'border-danger-300'
                                                                    : ''
                                                            )}
                                                        >
                                                            <div className="flex items-center gap-1.5">
                                                                <span
                                                                    className={cn(
                                                                        'flex size-5 shrink-0 items-center justify-center rounded-sm text-caption font-semibold',
                                                                        isActive
                                                                            ? 'bg-primary-500 text-white'
                                                                            : 'bg-neutral-100 text-neutral-600'
                                                                    )}
                                                                >
                                                                    {index + 1}
                                                                </span>
                                                                <span className="min-w-0 flex-1 truncate text-caption text-neutral-500">
                                                                    {getPPTViewTitle(
                                                                        getValues(
                                                                            `questions.${index}.questionType`
                                                                        ) as QuestionType
                                                                    )}
                                                                </span>
                                                                {hasError && (
                                                                    <TooltipProvider>
                                                                        <Tooltip>
                                                                            <TooltipTrigger asChild>
                                                                                <span
                                                                                    className="flex shrink-0 items-center"
                                                                                    aria-label={t(
                                                                                        'sidebar.questionIncompleteAriaLabel'
                                                                                    )}
                                                                                >
                                                                                    <WarningCircle
                                                                                        weight="fill"
                                                                                        className="size-4 text-danger-500"
                                                                                    />
                                                                                </span>
                                                                            </TooltipTrigger>
                                                                            <TooltipContent side="right">
                                                                                <p>
                                                                                    {t(
                                                                                        'sidebar.questionIncompleteTooltip'
                                                                                    )}
                                                                                </p>
                                                                            </TooltipContent>
                                                                        </Tooltip>
                                                                    </TooltipProvider>
                                                                )}
                                                                <SortableDragHandle
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="size-5 shrink-0 text-neutral-400 opacity-40 transition-opacity group-hover:opacity-100"
                                                                >
                                                                    <DotsSixVertical className="size-4" />
                                                                </SortableDragHandle>
                                                            </div>
                                                            {/* Scaled-down live preview. Capped on the
                                                                unzoomed wrapper so a long question
                                                                can't stretch the rail. */}
                                                            <div className="mt-1.5 max-h-32 overflow-hidden rounded-md">
                                                                <div className="question-rail-zoom">
                                                                    <PPTComponentFactory
                                                                        key={index}
                                                                        type={
                                                                            getValues(
                                                                                `questions.${index}.questionType`
                                                                            ) as QuestionType
                                                                        }
                                                                        props={{
                                                                            form: form,
                                                                            currentQuestionIndex:
                                                                                index,
                                                                            setCurrentQuestionIndex:
                                                                                setCurrentQuestionIndex,
                                                                            className:
                                                                                'relative rounded-xl border-4 border-neutral-200 bg-white p-4',
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </SortableItem>
                                                );
                                            })}
                                        </div>
                                    </Sortable>
                                </div>
                            </div>
                            {questions.length === 0 ? (
                                <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
                                    <h2 className="text-h3-semibold text-neutral-700">
                                        {t('emptyState.title')}
                                    </h2>
                                    <p className="max-w-sm text-body text-neutral-500">
                                        {t('emptyState.description')}
                                    </p>
                                    <MyButton
                                        type="button"
                                        buttonType="primary"
                                        scale="medium"
                                        layoutVariant="default"
                                        className="gap-1"
                                        onClick={() => setAddQuestionDialogBox(true)}
                                    >
                                        <Plus size={16} />
                                        {t('actions.addQuestion')}
                                    </MyButton>
                                </div>
                            ) : (
                                <div className="mx-auto flex h-full w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
                                    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                                        <div className="flex items-end justify-between gap-4">
                                            <div className="flex flex-col">
                                                <span className="text-subtitle font-semibold text-neutral-700">
                                                    {t('tags.title')}
                                                </span>
                                                <span className="text-caption text-neutral-500">
                                                    {t('tags.description')}
                                                </span>
                                            </div>
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="small"
                                                layoutVariant="default"
                                                className="h-8 shrink-0"
                                                onClick={applyCurrentTagsToAll}
                                            >
                                                {t('tags.applyToAll')}
                                            </MyButton>
                                        </div>
                                        <SubjectTagInput
                                            value={
                                                getValues(
                                                    `questions.${currentQuestionIndex}.tags`
                                                ) || []
                                            }
                                            onChange={(tags) =>
                                                setValue(
                                                    `questions.${currentQuestionIndex}.tags`,
                                                    tags,
                                                    { shouldDirty: true }
                                                )
                                            }
                                            suggestions={tagSuggestions}
                                        />
                                    </div>
                                    <MainViewComponentFactory
                                        key={currentQuestionIndex}
                                        type={
                                            getValues(
                                                `questions.${currentQuestionIndex}.questionType`
                                            ) as QuestionType
                                        }
                                        props={{
                                            form: form,
                                            currentQuestionIndex: currentQuestionIndex,
                                            setCurrentQuestionIndex: setCurrentQuestionIndex,
                                            className: 'flex w-full flex-col gap-6 pb-6',
                                            examType: examType,
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
