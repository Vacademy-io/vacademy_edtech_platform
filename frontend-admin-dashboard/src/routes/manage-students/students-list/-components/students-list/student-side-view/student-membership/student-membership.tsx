import { useStudentSidebar } from '../../../../-context/selected-student-sidebar-context';
import StudentPlanDetails from '../student-overview/StudentPlanDetails';
import { getInstituteId } from '@/constants/helper';
import { EnrolmentBreaksCard } from './breaks/enrolment-breaks-card';
import { JourneyStatusCard } from './journey/journey-status-card';
import { ExtraClassesCard } from './breaks/extra-classes-card';

export const StudentMembership = ({ isSubmissionTab }: { isSubmissionTab?: boolean }) => {
    const { selectedStudent } = useStudentSidebar();
    const userId = isSubmissionTab ? selectedStudent?.id || '' : selectedStudent?.user_id || '';

    return (
        <div className="space-y-4">
            {/* Renders nothing unless Settings → Journey status is on. */}
            <JourneyStatusCard
                userId={userId}
                instituteId={getInstituteId() || ''}
                learnerName={selectedStudent?.full_name}
            />
            {/* Renders nothing unless Settings → Breaks and holds is on. */}
            <EnrolmentBreaksCard
                userId={userId}
                instituteId={getInstituteId() || ''}
                learnerName={selectedStudent?.full_name}
            />
            {/* Same switch: renders nothing unless Breaks and holds is on (or one is running). */}
            <ExtraClassesCard
                userId={userId}
                instituteId={getInstituteId() || ''}
                learnerName={selectedStudent?.full_name}
            />
            <StudentPlanDetails userId={userId} />
        </div>
    );
};
