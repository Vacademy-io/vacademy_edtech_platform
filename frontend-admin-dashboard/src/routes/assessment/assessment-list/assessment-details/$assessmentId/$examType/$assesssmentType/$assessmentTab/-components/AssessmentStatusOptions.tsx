import StudentAttemptDropdown from './assessment-submissions-dropdown-individual/student-attempt-dropdown';
import StudentOngoingDropdown from './assessment-submissions-dropdown-individual/student-ongoing-dropdown';
import StudentPendingDropdown from './assessment-submissions-dropdown-individual/student-pending-dropdown';
import { AssessmentRevaluateStudentInterface } from '@/types/assessments/assessment-overview';

export const AssessmentStatusOptions = ({
    student,
    studentType,
    getPageAttemptIds,
}: {
    student: AssessmentRevaluateStudentInterface;
    studentType: string;
    /** The table page's attempt ids, for Prev / Next on the Submission page. */
    getPageAttemptIds?: () => string[];
}) => {
    return (
        <>
            {studentType === 'Attempted' && (
                <StudentAttemptDropdown student={student} getPageAttemptIds={getPageAttemptIds} />
            )}
            {studentType === 'Pending' && <StudentPendingDropdown student={student} />}
            {studentType === 'Ongoing' && <StudentOngoingDropdown student={student} />}
        </>
    );
};
