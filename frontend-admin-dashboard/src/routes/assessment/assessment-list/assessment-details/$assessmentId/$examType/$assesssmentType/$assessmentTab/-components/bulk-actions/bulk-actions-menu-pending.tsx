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
import { Envelope, WhatsappLogo } from '@phosphor-icons/react';
import { useSubmissionsBulkActionsDialogStorePending } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStorePending';
import { useDialogStore } from '@/routes/manage-students/students-list/-hooks/useDialogStore';
import { toStudentTable } from '@/routes/study-library/live-session/-utils/dashboard-export';
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
    SEND_WHATSAPP: 'SEND_WHATSAPP',
    SEND_EMAIL: 'SEND_EMAIL',
    REMOVE_PARTICIPANTS: 'REMOVE_PARTICIPANTS',
} as const;

export const BulkActionsMenuPending = ({ selectedStudents, trigger }: BulkActionsMenuProps) => {
    const { t } = useTranslation('assessmentBulkActionsMenuPending');
    const { openBulkRemoveParticipantsDialog } = useSubmissionsBulkActionsDialogStorePending();
    // The reminder goes out through the same WhatsApp / email dialogs the students list
    // and the assessment dashboard use — there is no separate reminder endpoint.
    const { openBulkSendMessageDialog, openBulkSendEmailDialog } = useDialogStore();

    const handleMenuOptionsChange = (value: string) => {
        // One entry per learner: someone in two batches appears twice in the list and
        // would otherwise get the reminder twice.
        const validStudents = [
            ...new Map(
                selectedStudents
                    .filter((student) => student && student.user_id)
                    .map((student) => [student.user_id, student])
            ).values(),
        ];

        if (validStudents.length === 0) {
            console.error('No valid students selected');
            return;
        }

        const bulkActionInfo: AssessmentSubmissionsBulkActionInfo = {
            selectedStudentIds: validStudents.map((student) => student.user_id),
            selectedStudents: validStudents,
            displayText: t('actionInfo.selectedStudents', { count: validStudents.length }),
        };

        const messageInfo = () => {
            const students = validStudents.map((student) =>
                toStudentTable({
                    userId: student.user_id,
                    name: student.student_name,
                    email: student.user_email ?? null,
                    mobile: student.phone_number ?? null,
                    packageSessionId: student.batch_id || null,
                })
            );
            return {
                selectedStudentIds: bulkActionInfo.selectedStudentIds,
                selectedStudents: students,
                displayText: bulkActionInfo.displayText,
            };
        };

        switch (value) {
            case MENU_ACTION.SEND_WHATSAPP:
                openBulkSendMessageDialog(messageInfo());
                break;
            case MENU_ACTION.SEND_EMAIL:
                openBulkSendEmailDialog(messageInfo());
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
                        className="cursor-pointer gap-2"
                        onClick={() => handleMenuOptionsChange(MENU_ACTION.SEND_WHATSAPP)}
                    >
                        <WhatsappLogo size={16} />
                        {t('menu.sendWhatsApp')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer gap-2"
                        onClick={() => handleMenuOptionsChange(MENU_ACTION.SEND_EMAIL)}
                    >
                        <Envelope size={16} />
                        {t('menu.sendEmail')}
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
