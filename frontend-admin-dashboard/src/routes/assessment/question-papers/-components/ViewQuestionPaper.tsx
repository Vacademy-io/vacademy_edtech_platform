import { FormProvider, useForm } from 'react-hook-form';
import { uploadQuestionPaperFormSchema } from '../-utils/upload-question-paper-form-schema';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { QuestionPaperTemplate } from './QuestionPaperTemplate';
import { Dispatch, ReactNode, SetStateAction, useEffect } from 'react';
import { getLevelNameById, getSubjectNameById } from '../-utils/helper';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useTranslation } from 'react-i18next';

export const ViewQuestionPaper = ({
    questionPaperId,
    title,
    subject,
    level,
    refetchData,
    isAssessment,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    examType,
    buttonText,
    triggerVariant,
}: {
    questionPaperId: string | undefined;
    title: string | undefined;
    subject: string | null;
    level: string | null;
    refetchData?: () => void;
    isAssessment?: boolean;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
    examType?: string;
    buttonText?: ReactNode;
    triggerVariant?: 'plain' | 'secondary';
}) => {
    const { instituteDetails } = useInstituteDetailsStore();
    const { t } = useTranslation('assessmentViewQuestionPaper');

    console.log('👁️ Creating ViewQuestionPaper form with examType:', {
        examType,
        isSurvey: examType === 'SURVEY',
        questionPaperId,
        title
    });

    const form = useForm<z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>>({
        resolver: zodResolver(uploadQuestionPaperFormSchema(examType)),
        mode: 'onChange',
        defaultValues: {
            questionPaperId: questionPaperId,
            isFavourite: false,
            title: title,
            createdOn: new Date(),
            yearClass: (instituteDetails && getLevelNameById(instituteDetails.levels, level)) || '',
            subject:
                (instituteDetails && instituteDetails.subjects && getSubjectNameById(instituteDetails.subjects, subject)) || '',
            questionsType: '',
            optionsType: '',
            answersType: '',
            explanationsType: '',
            fileUpload: null as unknown as File,
            questions: [],
        },
    });

    function onSubmit(values: z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>) {
        console.log(values);
    }

    const onInvalid = (err: unknown) => {
        console.error(err);
    };

    useEffect(() => {
        setCurrentQuestionIndex(0);
    }, []);
    return (
        <FormProvider {...form}>
            <form onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
                <QuestionPaperTemplate
                    form={form}
                    questionPaperId={questionPaperId}
                    isViewMode={true}
                    refetchData={refetchData}
                    buttonText={
                        buttonText ?? (isAssessment ? t('trigger.view') : t('trigger.viewQuestionPaper'))
                    }
                    isAssessment={isAssessment}
                    currentQuestionIndex={currentQuestionIndex}
                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                    examType={examType}
                    triggerVariant={triggerVariant}
                />
            </form>
        </FormProvider>
    );
};

export default ViewQuestionPaper;
