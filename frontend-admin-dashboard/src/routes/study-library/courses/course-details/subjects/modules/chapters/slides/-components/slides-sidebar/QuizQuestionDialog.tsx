'use client';

import { QuestionType } from '@/constants/dummy-data';
import { MainViewComponentFactory } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/MainViewComponentFactory';
import { uploadQuestionPaperFormSchema } from '@/routes/assessment/question-papers/-utils/upload-question-paper-form-schema';
import { Dispatch, MutableRefObject, SetStateAction, useEffect } from 'react';
import { FormProvider, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { Slide } from '../../-hooks/use-slides';

type QuestionPaperForm = z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>;

const QuizQuestionDialogAddPreview = ({
    quizQuestionForm,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    previewQuestionDialog,
    setPreviewQuestionDialog,
    isAddQuestionTypeRef,
    variantTitle,
    onCreate,
}: {
    quizQuestionForm: UseFormReturn<QuestionPaperForm>;
    addedQuestionForm: UseFormReturn<QuestionPaperForm>;
    formRefData: MutableRefObject<UploadQuestionPaperFormType>;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
    previewQuestionDialog: boolean;
    setPreviewQuestionDialog: Dispatch<SetStateAction<boolean>>;
    formData: UploadQuestionPaperFormType;
    setFormData: Dispatch<SetStateAction<UploadQuestionPaperFormType>>;
    isAddQuestionTypeRef: React.RefObject<HTMLButtonElement>;
    variantTitle?: string;
    onCreate: () => Promise<string | null>;
}) => {
    const { t } = useTranslation('studyLibraryQuizQuestionDialog');
    const { setActiveItem, getSlideById, updateActiveSlideQuestions } = useContentStore();

    useEffect(() => {

    }, [previewQuestionDialog]);

    const handleClose = () => {

        setCurrentQuestionIndex(0);
        quizQuestionForm.reset({
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
        });

        setPreviewQuestionDialog(false);
        isAddQuestionTypeRef.current?.click();
    };

    const handleCreateQuiz = async () => {
        const questions = quizQuestionForm.getValues('questions');

        if (!questions || questions.length === 0) {
            console.warn('[QuizDialog] ⚠️ No questions found. Aborting creation.');
            return;
        }

        const slideId = await onCreate();


        if (slideId) {
            const newSlide = getSlideById(slideId);

            if (newSlide) {
                const updatedSlide = {
                    ...newSlide,
                    quiz_slide: {
                        ...newSlide.quiz_slide,
                        id: newSlide.quiz_slide?.id || crypto.randomUUID(),
                        title: newSlide.quiz_slide?.title || 'Untitled Quiz',
                        media_id: newSlide.quiz_slide?.media_id || '',
                        parent_rich_text: newSlide.quiz_slide?.parent_rich_text || {
                            id: '',
                            content: '',
                            type: 'TEXT',
                        },
                        explanation_text_data: newSlide.quiz_slide?.explanation_text_data || {
                            id: '',
                            content: '',
                            type: 'TEXT',
                        },
                        questions,
                        question_response_type:
                            newSlide.quiz_slide?.question_response_type || 'OPTION',
                        access_level: newSlide.quiz_slide?.access_level || 'INSTITUTE',
                        evaluation_type: newSlide.quiz_slide?.evaluation_type || 'AUTO',
                        default_question_time_mins:
                            newSlide.quiz_slide?.default_question_time_mins || 1,
                        re_attempt_count: newSlide.quiz_slide?.re_attempt_count || 0,
                        source_type: newSlide.quiz_slide?.source_type || 'QUIZ',
                    },
                };

                setActiveItem(updatedSlide as Slide);
                updateActiveSlideQuestions(questions);
                handleClose();
            } else {
                console.warn('[QuizDialog] ⚠️ Slide not found in store after creation.');
            }
        }
    };

    return (
        <Dialog open={previewQuestionDialog} onOpenChange={setPreviewQuestionDialog}>
            <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0 [&>button]:hidden">
                <div className="flex w-full items-center justify-between bg-primary-50">
                    <h1 className="p-4 font-semibold text-primary-500">
                        {variantTitle || t('defaultTitle')}
                    </h1>
                    <div className="mr-4 flex items-center gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            layoutVariant="default"
                            className="mr-3"
                            onClick={() => {

                                setPreviewQuestionDialog(false);
                            }}
                        >
                            {t('close')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            layoutVariant="default"
                            className="mr-3"
                            disabled={quizQuestionForm.getValues('questions').length === 0}
                            onClick={handleCreateQuiz}
                        >
                            {t('create')}
                        </MyButton>
                    </div>
                </div>

                <div>
                    <FormProvider {...quizQuestionForm}>
                        {quizQuestionForm.getValues('questions')?.length === 0 ? (
                            <p className="p-6 text-center text-muted">{t('nothingToShow')}</p>
                        ) : (
                            <div className="my-4 flex flex-col gap-2">
                                <MainViewComponentFactory
                                    key={currentQuestionIndex}
                                    type={
                                        quizQuestionForm.getValues(
                                            `questions.${currentQuestionIndex}.questionType`
                                        ) as QuestionType
                                    }
                                    props={{
                                        form: quizQuestionForm,
                                        currentQuestionIndex,
                                        setCurrentQuestionIndex,
                                        className:
                                            'dialog-height overflow-auto ml-6 flex w-full flex-col gap-6 pr-6 pt-4',
                                        // Quiz options get the full rich-text editor on demand (expand-to-modal)
                                        enableOptionModalCompose: true,
                                    }}
                                />
                            </div>
                        )}
                    </FormProvider>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default QuizQuestionDialogAddPreview;
