' use client';

import { MCQS, MCQM, Numerical, TrueFalse, LongAnswer, SingleWord, CMCQS, CMCQM } from '@/svgs';
import { QuestionType as QuestionTypeList } from '@/constants/dummy-data';
import { Separator } from '@/components/ui/separator';
import { z } from 'zod';
import { questionsFormSchema } from '@/routes/assessment/question-papers/-utils/question-form-schema';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { uploadQuestionPaperFormSchema } from '@/routes/assessment/question-papers/-utils/upload-question-paper-form-schema';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { toast } from 'sonner';
import {
    useSlidesMutations,
    useSlidesQuery,
    QuizSlidePayload,
    Slide,
} from '../../-hooks/use-slides';
import { Route } from '../..';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import QuizQuestionDialogAddPreview from './QuizQuestionDialog';
import {
    buildAppendReorderPayload,
    getNextSlideOrder,
} from '../../-helper/slide-naming-utils';

export interface QuestionTypeProps {
    icon: React.ReactNode;
    text: string;
    type?: string;
    handleAddQuestion: (type: string, questionPoints?: string, reattemptCount?: string) => void;
}

export type QuestionPaperFormType = z.infer<typeof questionsFormSchema>;

// Helper types for extra fields
type ExtraOptionType = { id?: string; name?: string; isSelected?: boolean };
type ExtraQuestionFields = {
    csingleChoiceOptions?: ExtraOptionType[];
    cmultipleChoiceOptions?: ExtraOptionType[];
    comprehensionText?: string;
    passage?: string;
    parentRichTextContent?: string;
    text?: { id?: string; content?: string };
    text_data?: { id?: string; content?: string };
    parent_rich_text?: { id?: string };
    parentRichTextId?: string;
    textId?: string;
    textDataId?: string;
    explanation_text?: { id?: string };
    explanation_text_data?: { id?: string };
    explanationTextId?: string;
    explanationTextDataId?: string;
    questionText?: string;
    subjectiveAnswerText?: string;
};

function getExtraField<T = unknown>(q: unknown, key: keyof ExtraQuestionFields): T | undefined {
    return q && typeof q === 'object' && key in q
        ? ((q as Record<string, unknown>)[key] as T)
        : undefined;
}

const AddQuizDialog = ({ openState }: { openState?: (open: boolean) => void }) => {
    const { t } = useTranslation('studyLibraryAddQuizDialog');
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { setActiveItem, setItems, items } = useContentStore();

    const quizQuestionForm = useForm<UploadQuestionPaperFormType>({
        resolver: zodResolver(uploadQuestionPaperFormSchema()),
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
            questions: [],
        },
    });

    const formRefData = useRef<UploadQuestionPaperFormType>(quizQuestionForm.getValues());
    const isAddQuestionTypeRef = useRef<HTMLButtonElement>(null);
    const [previewQuestionDialog, setPreviewQuestionDialog] = useState(false);
    const [formData, setFormData] = useState<UploadQuestionPaperFormType>(
        quizQuestionForm.getValues()
    );
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } = Route.useSearch();

    const { addUpdateQuizSlide, updateSlideOrder } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );

    const { fields } = useFieldArray({
        control: quizQuestionForm.control,
        name: 'questions',
    });

    const createSlide = async (
        questions: UploadQuestionPaperFormType['questions']
    ): Promise<string | null> => {
        if (!questions || questions.length === 0) {
            toast.error(t('errors.noQuestions'));
            return null;
        }

        const quizSlides = items.filter((slide) => slide.source_type === 'QUIZ');
        const quizIndex = quizSlides.length + 1;
        const autoTitle = t('quizTitle', { number: quizIndex });

        // Check for duplicate titles
        const existingTitles = quizSlides.map((slide) => slide.title.toLowerCase().trim());
        const proposedTitle = autoTitle.toLowerCase().trim();

        let finalTitle = autoTitle;
        if (existingTitles.includes(proposedTitle)) {
            // Find the next available number
            let counter = quizIndex + 1;
            let newTitle = t('quizTitle', { number: counter });
            while (existingTitles.includes(newTitle.toLowerCase().trim())) {
                counter++;
                newTitle = t('quizTitle', { number: counter });
            }


            finalTitle = newTitle;
        }

        // Helper function to transform questions
        const transformQuestions = (questions: UploadQuestionPaperFormType['questions']) => {
            return questions.map((q, index) => {
                // Use only the fields from q, and access extra fields via (q as any) below
                // Determine which options array to use based on question type
                let options: Array<{
                    id: string;
                    quiz_slide_question_id: string;
                    text: { id: string; type: string; content: string };
                    explanation_text: { id: string; type: string; content: string };
                    explanation_text_data: { id: string; type: string; content: string };
                    media_id: string;
                }> = [];
                let questionResponseType = 'OPTION';
                let evaluationType = 'AUTO';

                switch (q.questionType) {
                    case 'MCQS':
                        options = (q.singleChoiceOptions || [])
                                                        .map((option: ExtraOptionType) => ({
                                id: option.id || crypto.randomUUID(),
                                quiz_slide_question_id: '',
                                text: { id: '', type: 'TEXT', content: option.name || '' },
                                explanation_text: { id: '', type: 'TEXT', content: '' },
                                explanation_text_data: { id: '', type: 'TEXT', content: '' },
                                media_id: '',
                            }));
                        break;
                    case 'MCQM':
                        options = (q.multipleChoiceOptions || [])
                                                        .map((option: ExtraOptionType) => ({
                                id: option.id || crypto.randomUUID(),
                                quiz_slide_question_id: '',
                                text: { id: '', type: 'TEXT', content: option.name || '' },
                                explanation_text: { id: '', type: 'TEXT', content: '' },
                                explanation_text_data: { id: '', type: 'TEXT', content: '' },
                                media_id: '',
                            }));
                        break;
                    case 'CMCQS':
                        options = (
                            getExtraField<ExtraOptionType[]>(q, 'csingleChoiceOptions') ?? []
                        )
                                                        .map((option: ExtraOptionType) => ({
                                id: option.id || crypto.randomUUID(),
                                quiz_slide_question_id: '',
                                text: { id: '', type: 'TEXT', content: option.name || '' },
                                explanation_text: { id: '', type: 'TEXT', content: '' },
                                explanation_text_data: { id: '', type: 'TEXT', content: '' },
                                media_id: '',
                            }));
                        break;
                    case 'CMCQM':
                        options = (
                            getExtraField<ExtraOptionType[]>(q, 'cmultipleChoiceOptions') ?? []
                        )
                                                        .map((option: ExtraOptionType) => ({
                                id: option.id || crypto.randomUUID(),
                                quiz_slide_question_id: '',
                                text: { id: '', type: 'TEXT', content: option.name || '' },
                                explanation_text: { id: '', type: 'TEXT', content: '' },
                                explanation_text_data: { id: '', type: 'TEXT', content: '' },
                                media_id: '',
                            }));
                        break;
                    case 'TRUE_FALSE':
                        options = (q.trueFalseOptions || []).map((option: ExtraOptionType) => ({
                            id: option.id || crypto.randomUUID(),
                            quiz_slide_question_id: '',
                            text: { id: '', type: 'TEXT', content: option.name || '' },
                            explanation_text: { id: '', type: 'TEXT', content: '' },
                            explanation_text_data: { id: '', type: 'TEXT', content: '' },
                            media_id: '',
                        }));
                        break;
                    case 'NUMERIC':
                    case 'CNUMERIC':
                        questionResponseType = 'NUMERIC';
                        evaluationType = 'AUTO';
                        break;
                    case 'LONG_ANSWER':
                        questionResponseType = 'TEXT';
                        evaluationType = 'MANUAL';
                        break;
                    case 'ONE_WORD':
                        questionResponseType = 'TEXT';
                        evaluationType = 'AUTO';
                        break;
                    default:
                        options = (q.singleChoiceOptions || [])
                                                        .map((option: ExtraOptionType) => ({
                                id: option.id || crypto.randomUUID(),
                                quiz_slide_question_id: '',
                                text: { id: '', type: 'TEXT', content: option.name || '' },
                                explanation_text: { id: '', type: 'TEXT', content: '' },
                                explanation_text_data: { id: '', type: 'TEXT', content: '' },
                                media_id: '',
                            }));
                }

                // Helper to get correct answer indices for MCQ/CMCQ/TRUE_FALSE
                const getCorrectAnswerIndices = (question: typeof q): number[] => {
                    let opts: { isSelected?: boolean }[] = [];
                    if (question.questionType === 'MCQS') {
                        opts = (question.singleChoiceOptions ?? []).slice(0, 4);
                    } else if (question.questionType === 'MCQM') {
                        opts = (question.multipleChoiceOptions ?? []).slice(0, 4);
                    } else if (question.questionType === 'CMCQS') {
                        opts = (
                            getExtraField<ExtraOptionType[]>(question, 'csingleChoiceOptions') ?? []
                        ).slice(0, 4);
                    } else if (question.questionType === 'CMCQM') {
                        opts = (
                            getExtraField<ExtraOptionType[]>(question, 'cmultipleChoiceOptions') ??
                            []
                        ).slice(0, 4);
                    } else if (question.questionType === 'TRUE_FALSE') {
                        opts = question.trueFalseOptions ?? [];
                    }
                    return opts
                        .map((opt, idx) => (opt.isSelected ? idx : null))
                        .filter((idx): idx is number => idx !== null);
                };

                // Calculate question time in milliseconds
                const calculateQuestionTimeInMillis = (question: typeof q): number => {
                    const duration = question.questionDuration;
                    if (duration) {
                        const hours = parseInt(duration.hrs || '0') * 60 * 60 * 1000;
                        const minutes = parseInt(duration.min || '0') * 60 * 1000;
                        return hours + minutes;
                    }
                    return 0;
                };

                // Create auto evaluation JSON
                const createAutoEvaluationJson = (question: typeof q): string => {
                    if (
                        question.questionType === 'MCQS' ||
                        question.questionType === 'MCQM' ||
                        question.questionType === 'CMCQS' ||
                        question.questionType === 'CMCQM' ||
                        question.questionType === 'TRUE_FALSE'
                    ) {
                        const correctAnswers = getCorrectAnswerIndices(question);
                        return JSON.stringify({ correctAnswers });
                    }
                    if (
                        question.questionType === 'LONG_ANSWER' ||
                        question.questionType === 'ONE_WORD'
                    ) {
                        const subjectiveAnswerText = getExtraField<string>(
                            question,
                            'subjectiveAnswerText'
                        );
                        if (subjectiveAnswerText && subjectiveAnswerText.trim() !== '') {
                            return JSON.stringify({
                                data: {
                                    answer:
                                        question.questionType === 'LONG_ANSWER'
                                            ? { content: subjectiveAnswerText }
                                            : subjectiveAnswerText,
                                },
                            });
                        } else if (question.validAnswers && question.validAnswers.length > 0) {
                            return JSON.stringify({ correctAnswers: question.validAnswers });
                        }
                    } else if (question.validAnswers && question.validAnswers.length > 0) {
                        return JSON.stringify({ correctAnswers: question.validAnswers });
                    }
                    return '';
                };

                // For comprehension types, set parent_rich_text to passage, text to question text, and include ids
                let parentRichTextContent = '';
                let parentRichTextId = '';
                let textContent = '';
                let textId = '';
                let textDataId = '';
                let explanationTextId = '';
                let explanationTextDataId = '';
                if (
                    q.questionType === 'CMCQS' ||
                    q.questionType === 'CMCQM' ||
                    q.questionType === 'CNUMERIC'
                ) {
                    parentRichTextContent =
                        getExtraField<string>(q, 'comprehensionText') ??
                        getExtraField<string>(q, 'passage') ??
                        getExtraField<string>(q, 'parentRichTextContent') ??
                        getExtraField<{ content?: string }>(q, 'text')?.content ??
                        getExtraField<{ content?: string }>(q, 'text_data')?.content ??
                        '';
                    parentRichTextId =
                        getExtraField<{ id?: string }>(q, 'parent_rich_text')?.id ??
                        getExtraField<string>(q, 'parentRichTextId') ??
                        '';
                    textContent = q.questionName ?? getExtraField<string>(q, 'questionText') ?? '';
                    textId =
                        getExtraField<{ id?: string }>(q, 'text')?.id ??
                        getExtraField<string>(q, 'textId') ??
                        '';
                    textDataId =
                        getExtraField<{ id?: string }>(q, 'text_data')?.id ??
                        getExtraField<string>(q, 'textDataId') ??
                        '';
                } else {
                    parentRichTextContent = '';
                    parentRichTextId = '';
                    textContent = q.questionName ?? getExtraField<string>(q, 'questionText') ?? '';
                    textId =
                        getExtraField<{ id?: string }>(q, 'text')?.id ??
                        getExtraField<string>(q, 'textId') ??
                        '';
                    textDataId =
                        getExtraField<{ id?: string }>(q, 'text_data')?.id ??
                        getExtraField<string>(q, 'textDataId') ??
                        '';
                }
                explanationTextId =
                    getExtraField<{ id?: string }>(q, 'explanation_text')?.id ??
                    getExtraField<string>(q, 'explanationTextId') ??
                    '';
                explanationTextDataId =
                    getExtraField<{ id?: string }>(q, 'explanation_text_data')?.id ??
                    getExtraField<string>(q, 'explanationTextDataId') ??
                    '';

                return {
                    id: q.id ?? crypto.randomUUID(),
                    parent_rich_text: {
                        id: parentRichTextId,
                        type: 'TEXT',
                        content: parentRichTextContent,
                    },
                    text: {
                        id: textId,
                        type: 'TEXT',
                        content: textContent,
                    },
                    text_data: {
                        id: textDataId,
                        type: 'TEXT',
                        content: textContent,
                    },
                    explanation_text: {
                        id: explanationTextId,
                        type: 'TEXT',
                        content: q.explanation || '',
                    },
                    explanation_text_data: {
                        id: explanationTextDataId,
                        type: 'TEXT',
                        content: q.explanation || '',
                    },
                    media_id: '',
                    status: 'ACTIVE',
                    question_response_type: questionResponseType,
                    question_type: q.questionType,
                    questionType: q.questionType, // Fix: Add questionType field for backend compatibility
                    access_level: 'INSTITUTE',
                    auto_evaluation_json: createAutoEvaluationJson(q),
                    evaluation_type: evaluationType,
                    question_time_in_millis: calculateQuestionTimeInMillis(q),
                    question_order: index + 1,
                    quiz_slide_id: '',
                    can_skip: q.canSkip || false,
                    new_question: true,
                    options: options,
                };
            });
        };

        try {
            const transformedQuestions = transformQuestions(questions);

            const response: string = await addUpdateQuizSlide({
                id: `quiz-${crypto.randomUUID()}`,
                source_id: '',
                source_type: 'QUIZ',
                title: finalTitle,
                description: 'Quiz',
                image_file_id: '',
                status: 'DRAFT',
                slide_order: getNextSlideOrder(items || []),
                video_slide: null,
                document_slide: null,
                question_slide: null,
                assignment_slide: null,
                quiz_slide: {
                    id: crypto.randomUUID(),
                    title: finalTitle,
                    description: { id: '', content: '', type: 'TEXT' },
                    questions: transformedQuestions,
                },
                is_loaded: true,
                new_slide: true,
            } as QuizSlidePayload);

            if (response) {
                const reorderedSlides = buildAppendReorderPayload(response, items || []);

                await updateSlideOrder({
                    chapterId: chapterId || '',
                    slideOrderPayload: reorderedSlides,
                });

                toast.success(t('toasts.quizAdded'));
                quizQuestionForm.reset();
                return response;
            }
        } catch (error) {
            console.error('Error creating quiz slide:', error);
            toast.error(t('errors.addFailed'));
        }

        return null;
    };
    const { refetch } = useSlidesQuery(chapterId || '');
    const handleAddQuestion = async (
        type: string,
        questionPoints?: string,
        reattemptCount?: string
    ) => {
        const newQuestion = {
            questionType: type,
            questionId: String(fields.length + 1),
            questionName: '',
            explanation: '',
            questionPenalty: '',
            questionDuration: { hrs: '', min: '' },
            questionMark: questionPoints ?? '1',
            singleChoiceOptions: Array(4).fill({ id: '', name: '', isSelected: false }),
            multipleChoiceOptions: Array(4).fill({ id: '', name: '', isSelected: false }),
            csingleChoiceOptions: Array(4).fill({ id: '', name: '', isSelected: false }),
            cmultipleChoiceOptions: Array(4).fill({ id: '', name: '', isSelected: false }),
            trueFalseOptions: Array(2).fill({ id: '', name: '', isSelected: false }),
            parentRichTextContent: '',
            decimals: 0,
            numericType: '',
            validAnswers: [0],
            questionResponseType: 'OPTION',
            subjectiveAnswerText: '',
            reattemptCount: reattemptCount ?? '0',
        };

        quizQuestionForm.setValue('questions', [newQuestion]);
        setPreviewQuestionDialog(true);
    };

    const handleEdit = (index: number) => {
        const question = quizQuestionForm.getValues(`questions.${index}`);
        // Prefill CMCQS/CMCQM options for edit dialog just like MCQ types
        if (question.questionType === 'CMCQS' && question.singleChoiceOptions) {
            question.csingleChoiceOptions = question.singleChoiceOptions;
        }
        if (question.questionType === 'CMCQM' && question.multipleChoiceOptions) {
            question.cmultipleChoiceOptions = question.multipleChoiceOptions;
        }
        quizQuestionForm.reset({ ...quizQuestionForm.getValues(), questions: [question] });
        setCurrentQuestionIndex(index);
    };

    const handleCreateQuizSlide = async (): Promise<string | null> => {
        const questions = quizQuestionForm.getValues('questions');

        if (!questions || questions.length === 0) {
            toast.error(t('errors.addAtLeastOneQuestion'));
            return null;
        }

        // Validate that all questions have required fields
        const invalidQuestions = questions.filter((q) => !q.questionName || !q.questionName.trim());
        if (invalidQuestions.length > 0) {
            toast.error(t('errors.questionNameRequired'));
            return null;
        }


        const slideId = await createSlide(questions);

        if (!slideId) {
            toast.error(t('errors.slideCreationFailed'));
            return null;
        }



        // Immediately update the store with the new quiz data
        try {
            // Create a temporary slide object with the questions data
            const tempSlide: Slide = {
                id: slideId,
                source_id: slideId,
                source_type: 'QUIZ',
                title: t('quizTitle', {
                    number: items.filter((slide) => slide.source_type === 'QUIZ').length + 1,
                }),
                image_file_id: '',
                description: 'Quiz',
                status: 'DRAFT',
                slide_order: getNextSlideOrder(items || []),
                video_slide: null,
                document_slide: null,
                question_slide: null,
                assignment_slide: null,
                quiz_slide: {
                    id: crypto.randomUUID(),
                    title: t('quizTitle', {
                        number: items.filter((slide) => slide.source_type === 'QUIZ').length + 1,
                    }),
                    description: { id: '', content: '', type: 'TEXT' },
                    questions: questions.map((q, index) => {
                        // Use only the fields from q, and access extra fields via (q as any) below
                        let parentRichTextContent = '';
                        let parentRichTextId = '';
                        let textContent = '';
                        let textId = '';
                        let textDataId = '';
                        let explanationTextId = '';
                        let explanationTextDataId = '';
                        if (
                            q.questionType === 'CMCQS' ||
                            q.questionType === 'CMCQM' ||
                            q.questionType === 'CNUMERIC'
                        ) {
                            parentRichTextContent =
                                getExtraField<string>(q, 'comprehensionText') ??
                                getExtraField<string>(q, 'passage') ??
                                getExtraField<string>(q, 'parentRichTextContent') ??
                                getExtraField<{ content?: string }>(q, 'text')?.content ??
                                getExtraField<{ content?: string }>(q, 'text_data')?.content ??
                                '';
                            parentRichTextId =
                                getExtraField<{ id?: string }>(q, 'parent_rich_text')?.id ??
                                getExtraField<string>(q, 'parentRichTextId') ??
                                '';
                            textContent =
                                q.questionName ?? getExtraField<string>(q, 'questionText') ?? '';
                            textId =
                                getExtraField<{ id?: string }>(q, 'text')?.id ??
                                getExtraField<string>(q, 'textId') ??
                                '';
                            textDataId =
                                getExtraField<{ id?: string }>(q, 'text_data')?.id ??
                                getExtraField<string>(q, 'textDataId') ??
                                '';
                        } else {
                            parentRichTextContent = '';
                            parentRichTextId = '';
                            textContent =
                                q.questionName ?? getExtraField<string>(q, 'questionText') ?? '';
                            textId =
                                getExtraField<{ id?: string }>(q, 'text')?.id ??
                                getExtraField<string>(q, 'textId') ??
                                '';
                            textDataId =
                                getExtraField<{ id?: string }>(q, 'text_data')?.id ??
                                getExtraField<string>(q, 'textDataId') ??
                                '';
                        }
                        explanationTextId =
                            getExtraField<{ id?: string }>(q, 'explanation_text')?.id ??
                            getExtraField<string>(q, 'explanationTextId') ??
                            '';
                        explanationTextDataId =
                            getExtraField<{ id?: string }>(q, 'explanation_text_data')?.id ??
                            getExtraField<string>(q, 'explanationTextDataId') ??
                            '';
                        return {
                            id: q.id ?? crypto.randomUUID(),
                            parent_rich_text: {
                                id: parentRichTextId,
                                type: 'TEXT',
                                content: parentRichTextContent,
                            },
                            text: {
                                id: textId,
                                type: 'TEXT',
                                content: textContent,
                            },
                            text_data: {
                                id: textDataId,
                                type: 'TEXT',
                                content: textContent,
                            },
                            explanation_text: {
                                id: explanationTextId,
                                type: 'TEXT',
                                content: q.explanation || '',
                            },
                            explanation_text_data: {
                                id: explanationTextDataId,
                                type: 'TEXT',
                                content: q.explanation || '',
                            },
                            media_id: '',
                            status: 'ACTIVE',
                            question_response_type: 'OPTION',
                            question_type: q.questionType,
                            questionType: q.questionType, // Fix: Add questionType field for backend compatibility
                            access_level: 'INSTITUTE',
                            auto_evaluation_json: q.validAnswers
                                ? JSON.stringify({ correctAnswers: q.validAnswers })
                                : '',
                            evaluation_type: 'AUTO',
                            question_order: index + 1,
                            quiz_slide_id: '',
                            can_skip: q.canSkip || false,
                            options: [],
                        };
                    }),
                },
                is_loaded: true,
                new_slide: true,
            };

            // Add the new slide to the items array
            const updatedItems = [tempSlide, ...items];
            setItems(updatedItems);

            // Set the new slide as active immediately
            setActiveItem(tempSlide);

            openState?.(false);
            toast.success(t('toasts.quizCreated'));

            // Refetch data in the background to get the complete backend data
            setTimeout(async () => {
                const refreshed = await refetch();

                if (refreshed.data) {
                    const refreshedSlide = refreshed.data.find((s) => s.id === slideId);
                    if (refreshedSlide) {
                        setItems(refreshed.data as Slide[]);
                        setActiveItem(refreshedSlide as Slide);
                    }
                }
            }, 1000);

            return slideId;
        } catch (error) {
            console.error('[AddQuizDialog] Error updating store immediately:', error);
            // Fallback to the original approach
            toast.warning(t('toasts.previewUpdateIssue'));
            return slideId;
        }
    };

    const QuestionType = ({ icon, text, type = QuestionTypeList.MCQS }: QuestionTypeProps) => (
        <div
            className="flex w-full cursor-pointer flex-row items-center gap-4 rounded-md border px-4 py-3"
            onClick={() => handleAddQuestion(type, '1', '0')}
        >
            {icon}
            <div className="text-body">{text}</div>
        </div>
    );

    return (
        <>
            <div className="flex flex-col gap-4">
                <div className="text-subtitle font-semibold">{t('sections.quickAccess')}</div>
                <QuestionType
                    icon={<MCQS />}
                    text={t('questionTypes.mcqSingle')}
                    type={QuestionTypeList.MCQS}
                    handleAddQuestion={handleAddQuestion}
                />
                <QuestionType
                    icon={<MCQM />}
                    text={t('questionTypes.mcqMultiple')}
                    type={QuestionTypeList.MCQM}
                    handleAddQuestion={handleAddQuestion}
                />
                <QuestionType
                    icon={<Numerical />}
                    text={t('questionTypes.numerical')}
                    type={QuestionTypeList.NUMERIC}
                    handleAddQuestion={handleAddQuestion}
                />
                <QuestionType
                    icon={<TrueFalse />}
                    text={t('questionTypes.trueFalse')}
                    type={QuestionTypeList.TRUE_FALSE}
                    handleAddQuestion={handleAddQuestion}
                />
            </div>

            <Separator className="my-6" />

            <div className="flex flex-col gap-4">
                <div className="text-subtitle font-semibold">{t('sections.writingSkills')}</div>
                <QuestionType
                    icon={<LongAnswer />}
                    text={t('questionTypes.longAnswer')}
                    type={QuestionTypeList.LONG_ANSWER}
                    handleAddQuestion={handleAddQuestion}
                />
                <QuestionType
                    icon={<SingleWord />}
                    text={t('questionTypes.singleWord')}
                    type={QuestionTypeList.ONE_WORD}
                    handleAddQuestion={handleAddQuestion}
                />
            </div>

            <Separator className="my-6" />

            <div className="flex flex-col gap-4">
                <div className="text-subtitle font-semibold">{t('sections.readingSkills')}</div>
                <QuestionType
                    icon={<CMCQS />}
                    text={t('questionTypes.comprehensionMcqSingle')}
                    type={QuestionTypeList.CMCQS}
                    handleAddQuestion={handleAddQuestion}
                />
                <QuestionType
                    icon={<CMCQM />}
                    text={t('questionTypes.comprehensionMcqMultiple')}
                    type={QuestionTypeList.CMCQM}
                    handleAddQuestion={handleAddQuestion}
                />
                <QuestionType
                    icon={<Numerical />}
                    text={t('questionTypes.comprehensionNumeric')}
                    type={QuestionTypeList.CNUMERIC}
                    handleAddQuestion={handleAddQuestion}
                />
            </div>

            <QuizQuestionDialogAddPreview
                quizQuestionForm={quizQuestionForm}
                addedQuestionForm={quizQuestionForm}
                formRefData={formRefData}
                currentQuestionIndex={currentQuestionIndex}
                setCurrentQuestionIndex={setCurrentQuestionIndex}
                previewQuestionDialog={previewQuestionDialog}
                setPreviewQuestionDialog={setPreviewQuestionDialog}
                formData={formData}
                setFormData={setFormData}
                isAddQuestionTypeRef={isAddQuestionTypeRef}
                variantTitle={t('quizQuestionVariantTitle')}
                onCreate={handleCreateQuizSlide}
            />
        </>
    );
};

export default AddQuizDialog;
