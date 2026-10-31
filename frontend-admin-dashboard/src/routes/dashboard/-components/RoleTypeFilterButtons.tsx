import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { RoleTypeSelectedFilter } from './RoleTypeComponent';

interface RoleTypeFilterButtonsProps {
    selectedQuestionPaperFilters: RoleTypeSelectedFilter;
    handleSubmitFilters: () => void;
    handleResetFilters: () => void;
}

const RoleTypeFilterButtons = ({
    selectedQuestionPaperFilters,
    handleSubmitFilters,
    handleResetFilters,
}: RoleTypeFilterButtonsProps) => {
    const { t } = useTranslation('dashboardRoleTypeFilterButtons');
    const isButtonEnabled = () => {
        const { roles, status } = selectedQuestionPaperFilters;
        return roles?.length > 0 || status?.length > 0;
    };
    return (
        <>
            {!!isButtonEnabled() && (
                <div className="flex gap-6">
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        layoutVariant="default"
                        className="h-8"
                        onClick={handleSubmitFilters}
                    >
                        {t('filterButton')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        layoutVariant="default"
                        className="h-8 border border-neutral-400 bg-neutral-200 hover:border-neutral-500 hover:bg-neutral-300 active:border-neutral-600 active:bg-neutral-400"
                        onClick={handleResetFilters}
                    >
                        {t('resetButton')}
                    </MyButton>
                </div>
            )}
        </>
    );
};

export default RoleTypeFilterButtons;
