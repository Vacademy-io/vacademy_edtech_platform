import { MyDialog } from '../../dialog';
import { ReactNode } from 'react';
import { useDialogStore } from '../../../../routes/manage-students/students-list/-hooks/useDialogStore';
import { MyButton } from '../../button';
import { useTerminateEnrollmentMutation } from '@/routes/manage-students/students-list/-services/useStudentOperations';
import { useBulkTerminateEnrollmentMutation } from '@/routes/manage-students/students-list/-services/useBulkOperations';

interface DeleteStudentDialogProps {
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const DeleteStudentDialogContent = () => {
    const { selectedStudent, bulkActionInfo, isBulkAction, closeAllDialogs } = useDialogStore();
    const displayText = isBulkAction ? bulkActionInfo?.displayText : selectedStudent?.full_name;

    const { mutate: terminateSingle, isPending: isSinglePending } = useTerminateEnrollmentMutation();
    const { mutate: terminateBulk, isPending: isBulkPending } = useBulkTerminateEnrollmentMutation();

    const handleSubmit = () => {
        if (isBulkAction && bulkActionInfo?.selectedStudents) {
            const validStudents = bulkActionInfo.selectedStudents.filter(
                (student) => student && student.user_id && student.package_session_id
            );

            if (validStudents.length === 0) {
                console.error('No valid students found for bulk action');
                return;
            }

            terminateBulk(
                {
                    students: validStudents.map((student) => ({
                        userId: student.user_id,
                        currentPackageSessionId: student.package_session_id || '',
                    })),
                },
                {
                    onSuccess: closeAllDialogs,
                }
            );
        } else if (selectedStudent?.user_id && selectedStudent?.package_session_id) {
            terminateSingle(
                {
                    students: [
                        {
                            userId: selectedStudent.user_id,
                            currentPackageSessionId: selectedStudent.package_session_id,
                        },
                    ],
                },
                {
                    onSuccess: closeAllDialogs,
                }
            );
        }
    };

    const isLoading = isSinglePending || isBulkPending;

    return (
        <div className="flex flex-col gap-6 p-6 text-neutral-600">
            {/*
              * Sends operation=TERMINATE, which writes status TERMINATED. Nothing is actually
              * deleted — the row stays, the learner just drops off the active roster.
              *
              * NOTE: this dialog is currently unreachable. Nothing renders a menu item for it:
              * 'Delete Student' is absent from getMenuOptions() in student-menu-options.tsx, and
              * MENU_ACTION.DELETE has no entry in buildBulkActionDropdownList(). The store
              * actions and mutation are wired, so re-adding a menu item is all it would take —
              * but until then, TERMINATED reaches production only via the deassign v3 and
              * sub-org terminate endpoints.
              */}
            <div>
                <span className="text-primary-500">{displayText}</span> will be marked{' '}
                <span className="font-semibold">Terminated</span> and removed from the active
                roster. Their record is kept, not deleted.
            </div>
            <MyButton
                buttonType="primary"
                scale="large"
                layoutVariant="default"
                disable={isLoading}
                onClick={handleSubmit}
            >
                {isLoading ? 'Terminating...' : 'Terminate'}
            </MyButton>
        </div>
    );
};

export const DeleteStudentDialog = ({ trigger, open, onOpenChange }: DeleteStudentDialogProps) => {
    return (
        <MyDialog
            trigger={trigger}
            heading="Terminate Enrollment"
            dialogWidth="w-[400px] max-w-[400px]"
            content={<DeleteStudentDialogContent />}
            open={open}
            onOpenChange={onOpenChange}
        />
    );
};
