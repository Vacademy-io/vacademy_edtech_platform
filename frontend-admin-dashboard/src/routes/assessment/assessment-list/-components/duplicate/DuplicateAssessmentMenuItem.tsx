import { useTranslation } from 'react-i18next';
import { CopySimple } from '@phosphor-icons/react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useAssessmentActionVisibility } from '@/lib/display-settings/assessment-actions';

/**
 * "Duplicate Assessment" in an assessment card's ⋯ menu. A copy is a new assessment, so
 * it follows the role's Create Assessment toggle. The dialog itself is rendered next to
 * the menu (see ScheduleTestMainDropdownComponent), not inside it.
 */
export const DuplicateAssessmentMenuItem = ({ onSelect }: { onSelect?: () => void }) => {
    const { t } = useTranslation('assessmentScheduleTestDetailsDropdownMenu');
    const { canCreate } = useAssessmentActionVisibility();
    if (!onSelect || !canCreate) return null;
    return (
        <DropdownMenuItem
            className="cursor-pointer gap-2"
            onSelect={onSelect}
            data-testid="duplicate-assessment-menu-item"
        >
            <CopySimple size={16} />
            {t('menu.duplicateAssessment')}
        </DropdownMenuItem>
    );
};
