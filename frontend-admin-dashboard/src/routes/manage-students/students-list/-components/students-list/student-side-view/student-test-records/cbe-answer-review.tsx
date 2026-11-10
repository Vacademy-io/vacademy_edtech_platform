import { useMemo } from 'react';
import { CbeAnswerView, CbeSolutionView } from '@/components/common/cbe-review';
import {
    cbeConfigFromEvaluationJson,
    parseCbeAnswer,
} from '@/routes/assessment/question-papers/-utils/cbe-question';

interface Props {
    /** Raw response JSON (question_wise_marks.response_json). */
    studentResponse: unknown;
    /** The question config (auto_evaluation_json); redacted until the result is released. */
    correctOptions: unknown;
}

/**
 * A Spreadsheet & Written Response answer in the admin test report: each part
 * as a read-only sheet / document, then the model solution when the report
 * carries it (only after the result is released).
 */
export function CbeAnswerReview({ studentResponse, correctOptions }: Props) {
    const answer = useMemo(() => parseCbeAnswer(studentResponse), [studentResponse]);
    const config = useMemo(() => cbeConfigFromEvaluationJson(correctOptions), [correctOptions]);
    const hasSolution = (config?.data.parts ?? []).some(
        (part) => !!part.solution || (part.markingScheme?.length ?? 0) > 0
    );
    return (
        <div className="flex w-full min-w-0 flex-col gap-4">
            <CbeAnswerView answer={answer} config={config} />
            {hasSolution && <CbeSolutionView config={config} />}
        </div>
    );
}
