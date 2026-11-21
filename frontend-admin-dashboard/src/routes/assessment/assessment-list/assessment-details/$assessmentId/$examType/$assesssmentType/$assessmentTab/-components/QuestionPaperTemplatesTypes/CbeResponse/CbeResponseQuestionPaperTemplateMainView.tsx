import { useTranslation } from 'react-i18next';
import { SectionQuestionPaperFormProps } from '../../../-utils/assessment-question-paper';
import { CbeQuestionEditor } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/CbeResponse/cbe-question-editor';

/** Spreadsheet & Written Response (CBE_RESPONSE) inside an assessment's sections. */
export const CbeResponseQuestionPaperTemplateMainView = ({
    form,
    currentQuestionIndex,
    className,
    selectedSectionIndex,
}: SectionQuestionPaperFormProps) => {
    const { t } = useTranslation('assessmentCbeQP');
    return (
        <CbeQuestionEditor
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            form={form as any}
            basePath={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}`}
            questionTitle={t('questionNumber', { number: currentQuestionIndex + 1 })}
            className={className}
        />
    );
};
