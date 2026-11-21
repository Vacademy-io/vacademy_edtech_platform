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
import { useTranslation } from 'react-i18next';
import { useSubmissionsBulkActionsDialogStoreOngoing } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStoreOngoing';

interface BulkActionsMenuProps {
    selectedCount: number;
    selectedStudentIds: string[];
    selectedStudents: SubmissionStudentData[];
    trigger: ReactNode;
}

export const BulkActionsMenuOngoing = ({ selectedStudents, trigger }: BulkActionsMenuProps) => {
    const { t } = useTranslation('evaluationBulkActionsMenuOngoing');
    const { openBulkIncreaseAssessmentTimeDialog, openBulkCloseSubmissionDialog } =
        useSubmissionsBulkActionsDialogStoreOngoing();

    const handleMenuOptionsChange = (value: string) => {
        const validStudents = selectedStudents.filter((student) => student && student.user_id);

        if (validStudents.length === 0) {
            console.error('No valid students selected');
            return;
        }

        const bulkActionInfo: AssessmentSubmissionsBulkActionInfo = {
            selectedStudentIds: validStudents.map((student) => student.user_id),
            selectedStudents: validStudents,
            displayText: t('studentsCount', { count: validStudents.length }),
        };

        switch (value) {
            case 'Increase Assessment Time':
                openBulkIncreaseAssessmentTimeDialog(bulkActionInfo);
                break;
            case 'Close Submission':
                openBulkCloseSubmissionDialog(bulkActionInfo);
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
                        onClick={() => handleMenuOptionsChange('Increase Assessment Time')}
                    >
                        {t('increaseAssessmentTime')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleMenuOptionsChange('Close Submission')}
                    >
                        {t('closeSubmission')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
};
