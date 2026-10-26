// StudentMenuOptions.tsx
import { MyDropdown } from '../../dropdown';
import { MyButton } from '../../button';
import { DotsThree } from '@phosphor-icons/react';
import { useDialogStore } from '../../../../routes/manage-students/students-list/-hooks/useDialogStore';
import { StudentTable } from '@/types/student-table-types';
import { useState } from 'react';
import { EnrollManuallyButton } from '@/components/common/students/enroll-manually/enroll-manually-button';

const getMenuOptions = (status?: string) => {
    if (status === 'INACTIVE') {
        // return ["View Student Portal", "Re-enroll Student", "Delete Student"];
        return ['Re-enroll Student'];
    }

    return [
        'Change Batch',
        'Extend Course Access',
        'Make Inactive',
        'Re-register for Next Session',
    ];
};

export const StudentMenuOptions = ({ student }: { student: StudentTable }) => {
    const {
        openChangeBatchDialog,
        openExtendSessionDialog,
        openReRegisterDialog,
        openTerminateRegistrationDialog,
        openDeleteDialog,
        openBulkExtendAccessDialog,
    } = useDialogStore();

    const [showReEnrollDialog, setShowReEnrollDialog] = useState(false);
    const menuOptions = getMenuOptions(student.status);

    const handleMenuOptionsChange = (value: string) => {
        switch (value) {
            case 'Re-enroll Student':
                setShowReEnrollDialog(true);
                break;
            case 'Change Batch':
                openChangeBatchDialog(student);
                break;
            // Reuses the bulk dialog with a single-learner selection: it already targets
            // user_ids x package_session_ids, and one row is simply the 1x1 case. Avoids a
            // second dialog that would have to stay behaviourally in step with it.
            case 'Extend Course Access':
                openBulkExtendAccessDialog({
                    selectedStudentIds: [student.id],
                    selectedStudents: [student],
                    displayText: student.full_name || '1 learner',
                });
                break;
            case 'Extend Session':
                openExtendSessionDialog(student);
                break;
            case 'Re-register for Next Session':
                openReRegisterDialog(student);
                break;
            case 'Make Inactive':
                openTerminateRegistrationDialog(student);
                break;
            // Unreachable: 'Delete Student' is not returned by getMenuOptions(). Kept because
            // the dialog + mutation behind it are complete; re-adding the menu entry is all it
            // would take. Until then TERMINATED reaches the DB only via the deassign v3 and
            // sub-org terminate-member endpoints, never from this screen.
            case 'Delete Student':
                openDeleteDialog(student);
                break;
            // Handle View Student Portal if needed
            case 'View Student Portal':
                // Add portal view logic here
                break;
        }
    };

    return (
        <>
            <MyDropdown dropdownList={menuOptions} onSelect={handleMenuOptionsChange}>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="icon"
                    className="flex items-center justify-center"
                >
                    <DotsThree />
                </MyButton>
            </MyDropdown>

            {/* Always render the button but with programmatic open control */}
            <EnrollManuallyButton
                initialValues={student}
                triggerButton={<div className="hidden" />}
                forceOpen={showReEnrollDialog}
                onClose={() => setShowReEnrollDialog(false)}
            />
        </>
    );
};
