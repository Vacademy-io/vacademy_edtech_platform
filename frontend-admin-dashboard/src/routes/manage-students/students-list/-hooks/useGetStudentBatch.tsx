// hooks/student-list/useGetStudentBatch.ts
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getBatchDisplayName } from '@/utils/helpers/student-management/batch-display-name';

export const useGetStudentBatch = (
    package_session_id: string
): { packageName: string; levelName: string; packageType: string | null; batchName: string } => {
    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);

    if (!instituteDetails)
        return { packageName: '', levelName: '', packageType: null, batchName: '' };

    const batch = instituteDetails.batches_for_sessions.find(
        (batch) => batch.id === package_session_id
    );

    return {
        levelName: batch?.level.level_name || '',
        packageName: batch?.package_dto.package_name || '',
        packageType: batch?.package_dto.package_type || null,
        // The batch's own name when it has one. levelName/packageName are left as
        // they were: other tables compose their own labels from them.
        batchName: getBatchDisplayName(batch),
    };
};
