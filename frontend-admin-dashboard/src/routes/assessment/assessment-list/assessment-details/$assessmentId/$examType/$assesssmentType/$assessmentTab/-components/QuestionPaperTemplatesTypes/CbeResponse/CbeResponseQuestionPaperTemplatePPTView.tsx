import { SectionQuestionPaperFormProps } from '../../../-utils/assessment-question-paper';
import { CbeQuestionSummary } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/CbeResponse/cbe-question-summary';

/** Read-only summary of a CBE question in an assessment section. */
export const CbeResponseQuestionPaperTemplatePPTView = ({
    form,
    currentQuestionIndex,
    className,
    selectedSectionIndex,
}: SectionQuestionPaperFormProps) => (
    <CbeQuestionSummary
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        form={form as any}
        basePath={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}`}
        className={className}
    />
);
