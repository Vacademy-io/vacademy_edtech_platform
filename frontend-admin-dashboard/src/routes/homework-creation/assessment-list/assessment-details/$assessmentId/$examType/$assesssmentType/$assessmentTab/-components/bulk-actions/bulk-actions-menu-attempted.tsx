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
import { useSubmissionsBulkActionsDialogStoreAttempted } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStoreAttempted';
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
    PROVIDE_REATTEMPT: 'PROVIDE_REATTEMPT',
    REVALUATE_QUESTION_WISE: 'REVALUATE_QUESTION_WISE',
    REVALUATE_ENTIRE_ASSESSMENT: 'REVALUATE_ENTIRE_ASSESSMENT',
    RELEASE_RESULT: 'RELEASE_RESULT',
} as const;

export const BulkActionsMenuAttempted = ({ selectedStudents, trigger }: BulkActionsMenuProps) => {
    const { t } = useTranslation('homeworkCreationBulkActionsMenuAttempted');
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
            displayText: t('actionInfo.selectedStudents', { count: validStudents.length }),
        };

        switch (value) {
            case MENU_ACTION.PROVIDE_REATTEMPT:
                openBulkProvideReattemptDialog(bulkActionInfo);
                break;
            case MENU_ACTION.REVALUATE_QUESTION_WISE:
                openBulkProvideRevaluateQuestionWiseDialog(bulkActionInfo);
                break;
            case MENU_ACTION.REVALUATE_ENTIRE_ASSESSMENT:
                openBulkProvideRevaluateAssessmentDialog(bulkActionInfo);
                break;
            case MENU_ACTION.RELEASE_RESULT:
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
                        onClick={() => handleMenuOptionsChange(MENU_ACTION.PROVIDE_REATTEMPT)}
                    >
                        {t('menu.provideReattempt')}
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="cursor-pointer">
                            {t('menu.revaluate')}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() =>
                                    handleMenuOptionsChange(MENU_ACTION.REVALUATE_QUESTION_WISE)
                                }
                            >
                                {t('menu.questionWise')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() =>
                                    handleMenuOptionsChange(
                                        MENU_ACTION.REVALUATE_ENTIRE_ASSESSMENT
                                    )
                                }
                            >
                                {t('menu.entireAssessment')}
                            </DropdownMenuItem>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleMenuOptionsChange(MENU_ACTION.RELEASE_RESULT)}
                    >
                        {t('menu.releaseResult')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
};
