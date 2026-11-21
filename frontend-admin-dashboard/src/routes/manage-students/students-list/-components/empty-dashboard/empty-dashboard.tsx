import { useTranslation } from 'react-i18next';
import { EnrollStudentsButton } from '@/components/common/students/enroll-students-button';
import EmptyDashboardImage from '@/assets/svgs/empty-student-dashboard.svg';
import { BulkDialogProvider } from '../../-providers/bulk-dialog-provider';
// import { EnrollManuallyButton } from "../enroll-manually/enroll-manually-button";

export const EmptyDashboard = () => {
    const { t } = useTranslation('manageStudentsEmptyDashboard');
    return (
        <div
            className={`flex w-full flex-col items-center justify-center gap-4 rounded-md bg-neutral-50 py-10`}
            style={{ height: `calc(100vh - 160px)` }}
        >
            <EmptyDashboardImage />
            <div className="text-title font-regular text-neutral-600">
                {t('noStudentDataAvailable')}
            </div>
            <BulkDialogProvider>
                <EnrollStudentsButton />
            </BulkDialogProvider>
        </div>
    );
};
