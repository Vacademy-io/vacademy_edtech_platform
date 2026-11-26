import { getInstituteId } from '@/constants/helper';
import { useStudentSidebar } from '../../../../../-context/selected-student-sidebar-context';
import { EnrolmentBreaksCard } from './enrolment-breaks-card';
import { JourneyStatusCard } from '../journey/journey-status-card';

/**
 * The breaks card for the learner open in the side panel. Used above Payment History when an
 * institute hides the Membership tab, so the feature is reachable whichever finance tab is shown.
 * Renders nothing unless Settings → Breaks and holds has ever been saved for the institute.
 */
export const SelectedLearnerBreaksCard = () => {
    const { selectedStudent } = useStudentSidebar();
    return (
        <div className="mb-4 space-y-4">
            {/* Journey status sits with breaks; renders nothing unless Settings → Journey status is on. */}
            <JourneyStatusCard
                userId={selectedStudent?.user_id || ''}
                instituteId={getInstituteId() || ''}
                learnerName={selectedStudent?.full_name}
            />
            <EnrolmentBreaksCard
                userId={selectedStudent?.user_id || ''}
                instituteId={getInstituteId() || ''}
                learnerName={selectedStudent?.full_name}
            />
        </div>
    );
};
