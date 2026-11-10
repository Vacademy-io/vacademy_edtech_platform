import { useTranslation } from 'react-i18next';
import { QuestionPaperTemplateFormProps } from '../../../-utils/question-paper-template-form';
import { formatStructure } from '../../../-utils/helper';
import { CbeQuestionEditor } from './cbe-question-editor';

/** Spreadsheet & Written Response (CBE_RESPONSE) — question papers, question bank, LMS slides. */
export const CbeResponseQuestionPaperTemplateMainView = ({
    form,
    currentQuestionIndex,
    className,
    showQuestionNumber = true,
    examType,
}: QuestionPaperTemplateFormProps) => {
    const { t } = useTranslation('assessmentCbeQP');
    const allQuestions = form.getValues('questions') || [];
    const questionsType = form.getValues('questionsType') || '';

    if (allQuestions.length === 0) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <p className="text-body text-neutral-500">{t('emptyState')}</p>
            </div>
        );
    }

    const number = questionsType
        ? formatStructure(questionsType, currentQuestionIndex + 1)
        : String(currentQuestionIndex + 1);

    return (
        <CbeQuestionEditor
            // The loose editor form type covers this schema's question shape.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            form={form as any}
            basePath={`questions.${currentQuestionIndex}`}
            questionTitle={showQuestionNumber ? t('questionNumber', { number }) : undefined}
            examType={examType}
            className={className}
        />
    );
};
