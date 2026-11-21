import { QuestionPaperTemplateFormProps } from '../../../-utils/question-paper-template-form';
import { CbeQuestionSummary } from './cbe-question-summary';

/** Read-only summary of a CBE question: requirements, parts (kind, marks, scheme lines), total. */
export const CbeResponseQuestionPaperTemplatePPTView = ({
    form,
    currentQuestionIndex,
    className,
}: QuestionPaperTemplateFormProps) => (
    <CbeQuestionSummary
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        form={form as any}
        basePath={`questions.${currentQuestionIndex}`}
        className={className}
    />
);
