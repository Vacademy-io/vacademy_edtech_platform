import { CodingAnswerReview } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-test-records/coding-answer-review';
import { FeedbackBlock, QuestionText, type CardProps } from './common';

/** W3d: code, language, the stored run verdict and test cases (the test-report renderer). */
export const CodingCard = ({ detail, paper }: CardProps) => (
    <div className="flex flex-col gap-4">
        <QuestionText paper={paper} />
        <CodingAnswerReview studentResponse={detail.response_json} correctOptions={detail.auto_evaluation_json} />
        <FeedbackBlock feedback={detail.evaluator_feedback} />
    </div>
);
