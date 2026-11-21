import { create } from 'zustand';
import { AssessmentSubmissionsBulkActionInfo } from '@/routes/manage-students/students-list/-types/bulk-actions-types';
import { SubmissionStudentData } from '@/types/assessments/assessment-overview';

interface AssessmentSubmissionsDialogStore {
    removeParticipants: boolean;
    selectedStudent: SubmissionStudentData | null;
    bulkActionInfo: AssessmentSubmissionsBulkActionInfo | null;
    isBulkAction: boolean;

    // Individual student actions
    openRemoveParticipantsDialog: (student: SubmissionStudentData) => void;

    // Bulk actions
    openBulkRemoveParticipantsDialog: (info: AssessmentSubmissionsBulkActionInfo) => void;

    closeAllDialogs: () => void;
}

export const useSubmissionsBulkActionsDialogStorePending = create<AssessmentSubmissionsDialogStore>(
    (set) => ({
        removeParticipants: false,
        selectedStudent: null,
        bulkActionInfo: null,
        isBulkAction: false,

        // Individual student actions
        openRemoveParticipantsDialog: (student) =>
            set({
                removeParticipants: true,
                selectedStudent: student,
                bulkActionInfo: null,
                isBulkAction: false,
            }),

        // Bulk actions
        openBulkRemoveParticipantsDialog: (info) =>
            set({
                removeParticipants: true,
                selectedStudent: null,
                bulkActionInfo: info,
                isBulkAction: true,
            }),

        closeAllDialogs: () =>
            set({
                removeParticipants: false,
                selectedStudent: null,
                bulkActionInfo: null,
                isBulkAction: false,
            }),
    })
);
