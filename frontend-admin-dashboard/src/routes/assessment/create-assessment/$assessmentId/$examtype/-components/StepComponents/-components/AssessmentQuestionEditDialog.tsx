import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PencilSimpleLine } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getInstituteId } from '@/constants/helper';
import { QuestionType } from '@/constants/dummy-data';
import { uploadQuestionPaperFormSchema } from '@/routes/assessment/question-papers/-utils/upload-question-paper-form-schema';
import {
    convertQuestionsDataToResponse,
    transformResponseDataToMyQuestionsSchemaSingleQuestion,
} from '@/routes/assessment/question-papers/-utils/helper';
import { MainViewComponentFactory } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/MainViewComponentFactory';
import type { QuestionResponse } from '@/types/assessments/question-paper-template';
import type { MyQuestion } from '@/types/assessments/question-paper-form';
import {
    editAssessmentQuestions,
    getFullQuestionsOfSections,
} from '../../../-services/assessment-services';

type QuestionPaperForm = z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>;

/**
 * Edit one question of a saved assessment - text, options, answer key,
 * explanation - with the same editor the question-paper screen uses.
 *
 * Questions added to an assessment never had an editable surface once the
 * assessment existed: Step 2 rendered them read-only and the only editor in
 * the app was the question paper's, which many assessments do not have. The
 * edit goes to the question by id, so every section that maps it sees the
 * change, and the copy-check rubric for it is regenerated on the next run.
 */
export const AssessmentQuestionEditDialog = ({
    assessmentId,
    sectionId,
    questionId,
    examType,
    onSaved,
}: {
    assessmentId: string;
    sectionId: string;
    questionId: string;
    examType?: string;
    /** Called with the question as saved, so the caller can refresh its own row. */
    onSaved?: (question: MyQuestion) => void;
}) => {
    const { t } = useTranslation('assessmentStep2SectionInfo');
    const [open, setOpen] = useState(false);
    const instituteId = getInstituteId();
    const queryClient = useQueryClient();

    // Fetched on open, not on mount: a 40-question section would otherwise
    // fire 40 identical requests for the whole section's full DTOs.
    const { data: fullQuestions, isLoading } = useQuery({
        queryKey: ['ASSESSMENT_FULL_QUESTIONS', assessmentId, sectionId],
        queryFn: () => getFullQuestionsOfSections({ assessmentId, sectionIds: sectionId }),
        enabled: open,
        staleTime: 0,
    });
    const source: QuestionResponse | undefined = (fullQuestions?.[sectionId] ?? []).find(
        (q) => q.id === questionId
    );

    return (
        <>
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                layoutVariant="icon"
                aria-label={t('table.editQuestion')}
                onClick={() => setOpen(true)}
            >
                <PencilSimpleLine size={16} />
            </MyButton>
            <MyDialog
                heading={t('table.editQuestion')}
                open={open}
                onOpenChange={setOpen}
                dialogWidth="max-w-dialog-xl"
            >
                {isLoading || !source ? (
                    <div className="flex h-40 items-center justify-center">
                        {isLoading ? (
                            <DashboardLoader />
                        ) : (
                            <p className="text-sm text-neutral-500">
                                {t('table.editQuestionMissing')}
                            </p>
                        )}
                    </div>
                ) : (
                    <QuestionEditor
                        key={source.id ?? questionId}
                        source={source}
                        examType={examType}
                        onCancel={() => setOpen(false)}
                        onSubmit={async (updated) => {
                            await editAssessmentQuestions({
                                assessmentId,
                                instituteId,
                                updatedQuestions: updated,
                            });
                        }}
                        onSaved={(saved) => {
                            setOpen(false);
                            queryClient.invalidateQueries({
                                queryKey: ['ASSESSMENT_FULL_QUESTIONS', assessmentId],
                            });
                            queryClient.invalidateQueries({
                                queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS', assessmentId],
                            });
                            onSaved?.(saved);
                        }}
                    />
                )}
            </MyDialog>
        </>
    );
};

const QuestionEditor = ({
    source,
    examType,
    onCancel,
    onSubmit,
    onSaved,
}: {
    source: QuestionResponse;
    examType?: string;
    onCancel: () => void;
    onSubmit: (updated: unknown[]) => Promise<void>;
    onSaved: (question: MyQuestion) => void;
}) => {
    const { t } = useTranslation('assessmentStep2SectionInfo');
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const form = useForm<QuestionPaperForm>({
        resolver: zodResolver(uploadQuestionPaperFormSchema(examType)),
        mode: 'onChange',
        defaultValues: {
            questionPaperId: '',
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
            questions: [transformResponseDataToMyQuestionsSchemaSingleQuestion(source)],
        },
    });

    const save = useMutation({
        mutationFn: async (values: QuestionPaperForm) => {
            // Same cast the question-paper template makes at its own save: the
            // zod-inferred form row and MyQuestion describe the same object.
            const question = (values as unknown as { questions: MyQuestion[] }).questions[0];
            if (!question) throw new Error('no question');
            // The paper editor's own serialiser, so options/answer key/explanation
            // reach the backend in exactly the shape its update path expects.
            await onSubmit(convertQuestionsDataToResponse([question], 'updated'));
            return question;
        },
        onSuccess: (question) => {
            toast.success(t('toasts.questionUpdated'));
            onSaved(question as MyQuestion);
        },
        onError: () => toast.error(t('toasts.questionUpdateFailed')),
    });

    return (
        <FormProvider {...form}>
            <form
                onSubmit={async (event) => {
                    event.preventDefault();
                    // Validate only the question: the paper-level fields of this
                    // shared schema (title, upload) are meaningless for one
                    // question and must not block the save.
                    const ok = await form.trigger('questions');
                    if (!ok) {
                        toast.error(t('toasts.questionInvalid'));
                        return;
                    }
                    save.mutate(form.getValues());
                }}
                className="flex flex-col gap-4"
            >
                <MainViewComponentFactory
                    type={form.getValues('questions.0.questionType') as QuestionType}
                    props={{
                        form,
                        currentQuestionIndex,
                        setCurrentQuestionIndex,
                        className: 'flex w-full flex-col gap-6 pb-2',
                        examType,
                        showQuestionNumber: false,
                    }}
                />
                <div className="flex justify-end gap-2 border-t border-neutral-200 pt-4">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={onCancel}
                    >
                        {t('dialogs.cancel')}
                    </MyButton>
                    <MyButton
                        type="submit"
                        buttonType="primary"
                        scale="medium"
                        disabled={save.isPending}
                    >
                        {save.isPending ? t('table.savingQuestion') : t('table.saveQuestion')}
                    </MyButton>
                </div>
            </form>
        </FormProvider>
    );
};

export default AssessmentQuestionEditDialog;
