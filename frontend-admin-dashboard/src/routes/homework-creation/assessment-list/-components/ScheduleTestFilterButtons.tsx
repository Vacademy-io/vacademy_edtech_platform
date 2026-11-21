import { MyButton } from '@/components/design-system/button';
import { SelectedQuestionPaperFilters } from './ScheduleTestMainComponent';
import { useTranslation } from 'react-i18next';

interface ScheduleTestFilterButtonsProps {
    selectedQuestionPaperFilters: SelectedQuestionPaperFilters;
    handleSubmitFilters: () => void;
    handleResetFilters: () => void;
}

const ScheduleTestFilterButtons = ({
    selectedQuestionPaperFilters,
    handleSubmitFilters,
    handleResetFilters,
}: ScheduleTestFilterButtonsProps) => {
    const { t } = useTranslation('homeworkCreationScheduleTestFilterButtons');
    const isButtonEnabled = () => {
        const {
            name,
            batch_ids,
            subjects_ids,
            tag_ids,
            assessment_statuses,
            assessment_modes,
            access_statuses,
            evaluation_types,
        } = selectedQuestionPaperFilters;

        // Check if 'name' is a string and call trim on it, otherwise check if it's an array
        const isNameValid = typeof name === 'string' ? name.trim() !== '' : name.length > 0;

        return (
            isNameValid ||
            batch_ids?.length > 0 ||
            subjects_ids?.length > 0 ||
            tag_ids?.length > 0 ||
            assessment_statuses?.length > 0 ||
            assessment_modes?.length > 0 ||
            access_statuses?.length > 0 ||
            evaluation_types?.length > 0
        );
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
                        {t('filter')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        layoutVariant="default"
                        className="h-8 border border-neutral-400 bg-neutral-200 hover:border-neutral-500 hover:bg-neutral-300 active:border-neutral-600 active:bg-neutral-400"
                        onClick={handleResetFilters}
                    >
                        {t('reset')}
                    </MyButton>
                </div>
            )}
        </>
    );
};

export default ScheduleTestFilterButtons;
