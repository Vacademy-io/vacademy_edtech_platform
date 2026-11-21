import { getInstituteId } from '@/constants/helper';
import { useStudentSidebar } from '../../../../../-context/selected-student-sidebar-context';
import { EnrolmentBreaksCard } from './enrolment-breaks-card';

/**
 * The breaks card for the learner open in the side panel. Used above Payment History when an
 * institute hides the Membership tab, so the feature is reachable whichever finance tab is shown.
 * Renders nothing unless Settings → Breaks and holds has ever been saved for the institute.
 */
export const SelectedLearnerBreaksCard = () => {
    const { selectedStudent } = useStudentSidebar();
    return (
        <div className="mb-4">
            <EnrolmentBreaksCard
                userId={selectedStudent?.user_id || ''}
                instituteId={getInstituteId() || ''}
                learnerName={selectedStudent?.full_name}
            />
        </div>
    );
};
