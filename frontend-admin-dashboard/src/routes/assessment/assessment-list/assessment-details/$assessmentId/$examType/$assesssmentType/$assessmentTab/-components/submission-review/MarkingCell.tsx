import type { Row } from '@tanstack/react-table';
import type { StudentTable } from '@/types/student-table-types';
import { EvaluationStatusCell } from '../EvaluationStatusCell';
import { Route } from '../..';
import { MarkingChip } from './MarkingChip';
import { useAttemptMarking, useOpenSubmission } from './use-attempt-marking';

export { MarkingChip };

/**
 * W1 Marking column. Falls back to the old evaluation chip while the marking status is
 * unknown (not loaded, or the summary call failed), and keeps the evaluated-copy eye
 * button for answer-sheet tests; its Edit copy opens the Submission with the sheet.
 */
export const MarkingCell = ({ row }: { row: Row<StudentTable> }) => {
    const { assessmentId } = Route.useParams();
    const attemptId = (row.original as StudentTable & { attempt_id?: string }).attempt_id;
    const { data: marking } = useAttemptMarking(assessmentId, attemptId);
    const openSubmission = useOpenSubmission();
    const onEditCopy = attemptId
        ? () => openSubmission(attemptId, { search: { sheet: '1' } })
        : undefined;
    if (!marking) return <EvaluationStatusCell row={row} onEditCopy={onEditCopy} />;
    return (
        <EvaluationStatusCell
            row={row}
            chip={<MarkingChip marking={marking} />}
            evaluated={marking.marking === 'DONE' || marking.marking === 'CHECK_AI'}
            onEditCopy={onEditCopy}
        />
    );
};
