import { AssessmentSubmissionsBulkActionInfo } from '@/routes/manage-students/students-list/-types/bulk-actions-types';
import { ReactNode } from 'react';
import { SubmissionStudentData } from '@/types/assessments/assessment-overview';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MyButton } from '@/components/design-system/button';
import { useSubmissionsBulkActionsDialogStorePending } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStorePending';
import { useTranslation } from 'react-i18next';

interface BulkActionsMenuProps {
    selectedCount: number;
    selectedStudentIds: string[];
    selectedStudents: SubmissionStudentData[];
    trigger: ReactNode;
}

// Internal action-type constants used for dispatch logic. These must never be
// swapped for translated display text — see handleMenuOptionsChange below.
const MENU_ACTION = {
    SEND_REMINDER: 'SEND_REMINDER',
    REMOVE_PARTICIPANTS: 'REMOVE_PARTICIPANTS',
} as const;

export const BulkActionsMenuPending = ({ selectedStudents, trigger }: BulkActionsMenuProps) => {
    const { t } = useTranslation('homeworkCreationBulkActionsMenuPending');
    const { openBulkSendReminderDialog, openBulkRemoveParticipantsDialog } =
        useSubmissionsBulkActionsDialogStorePending();

    const handleMenuOptionsChange = (value: string) => {
        const validStudents = selectedStudents.filter((student) => student && student.user_id);

        if (validStudents.length === 0) {
            console.error('No valid students selected');
            return;
        }

        const bulkActionInfo: AssessmentSubmissionsBulkActionInfo = {
            selectedStudentIds: validStudents.map((student) => student.user_id),
            selectedStudents: validStudents,
            displayText: t('actionInfo.selectedStudents', { count: validStudents.length }),
        };

        switch (value) {
            case MENU_ACTION.SEND_REMINDER:
                openBulkSendReminderDialog(bulkActionInfo);
                break;
            case MENU_ACTION.REMOVE_PARTICIPANTS:
                openBulkRemoveParticipantsDialog(bulkActionInfo);
                break;
        }
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="w-6 !min-w-6"
                    >
                        {trigger}
                    </MyButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleMenuOptionsChange(MENU_ACTION.SEND_REMINDER)}
                    >
                        {t('menu.sendReminder')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleMenuOptionsChange(MENU_ACTION.REMOVE_PARTICIPANTS)}
                    >
                        {t('menu.removeParticipants')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
};
