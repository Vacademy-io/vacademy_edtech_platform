import { useTranslation } from 'react-i18next';
import { FolderSimplePlus } from '@phosphor-icons/react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { TestContent } from '@/types/assessments/schedule-test-list';
import { useAssessmentFolderUi } from './assessment-folder-context';

/** "Move to folder" in an assessment card's ⋮ menu; renders nothing when folders are off. */
export const MoveToFolderMenuItem = ({
    scheduleTestContent,
}: {
    scheduleTestContent: TestContent;
}) => {
    const { t } = useTranslation('assessmentFolders');
    const { enabled, canManage, openMove } = useAssessmentFolderUi();
    if (!enabled || !canManage) return null;
    return (
        <DropdownMenuItem
            className="cursor-pointer gap-2"
            onSelect={() =>
                openMove({
                    assessmentId: scheduleTestContent.assessment_id,
                    name: scheduleTestContent.name,
                })
            }
        >
            <FolderSimplePlus size={16} />
            {t('menu.moveToFolder')}
        </DropdownMenuItem>
    );
};
