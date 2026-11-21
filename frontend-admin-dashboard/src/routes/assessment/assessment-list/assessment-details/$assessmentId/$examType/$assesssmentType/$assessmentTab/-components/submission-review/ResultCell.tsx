import type { Row } from '@tanstack/react-table';
import type { StudentTable } from '@/types/student-table-types';
import { Route } from '../..';
import { ResultView } from './ResultView';
import { useAttemptMarking } from './use-attempt-marking';

export { ResultView };

export const ResultCell = ({ row }: { row: Row<StudentTable> }) => {
    const { assessmentId } = Route.useParams();
    const original = row.original as StudentTable & { attempt_id?: string; result_status?: string | null };
    const { data: marking } = useAttemptMarking(assessmentId, original.attempt_id);
    return <ResultView marking={marking} legacyStatus={original.result_status} />;
};
