import { AssessmentSubmissionsBulkActionInfo } from '@/routes/manage-students/students-list/-types/bulk-actions-types';
import { ReactNode } from 'react';
import { SubmissionStudentData } from '@/types/assessments/assessment-overview';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { MyButton } from '@/components/design-system/button';
import { useTranslation } from 'react-i18next';
import { useSubmissionsBulkActionsDialogStoreAttempted } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStoreAttempted';

interface BulkActionsMenuProps {
    selectedCount: number;
    selectedStudentIds: string[];
    selectedStudents: SubmissionStudentData[];
    trigger: ReactNode;
}

export const BulkActionsMenuAttempted = ({ selectedStudents, trigger }: BulkActionsMenuProps) => {
    const { t } = useTranslation('evaluationBulkActionsMenuAttempted');
    const {
        openBulkProvideReattemptDialog,
        openBulkProvideRevaluateAssessmentDialog,
        openBulkProvideRevaluateQuestionWiseDialog,
        openBulkProvideReleaseDialog,
    } = useSubmissionsBulkActionsDialogStoreAttempted();

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
            case 'Provide Reattempt':
                openBulkProvideReattemptDialog(bulkActionInfo);
                break;
            case 'Revaluate Question Wise':
                openBulkProvideRevaluateQuestionWiseDialog(bulkActionInfo);
                break;
            case 'Revaluate Entire Assessment':
                openBulkProvideRevaluateAssessmentDialog(bulkActionInfo);
                break;
            case 'Release Result':
                openBulkProvideReleaseDialog(bulkActionInfo);
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
                        onClick={() => handleMenuOptionsChange('Provide Reattempt')}
                    >
                        {t('provideReattempt')}
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="cursor-pointer">
                            {t('revaluate')}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() => handleMenuOptionsChange('Revaluate Question Wise')}
                            >
                                {t('questionWise')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() =>
                                    handleMenuOptionsChange('Revaluate Entire Assessment')
                                }
                            >
                                {t('entireAssessment')}
                            </DropdownMenuItem>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleMenuOptionsChange('Release Result')}
                    >
                        {t('releaseResult')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
};
