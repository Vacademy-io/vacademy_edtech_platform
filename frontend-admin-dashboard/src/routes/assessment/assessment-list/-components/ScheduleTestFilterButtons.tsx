import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { SelectedQuestionPaperFilters } from './ScheduleTestMainComponent';

interface ScheduleTestFilterButtonsProps {
    selectedQuestionPaperFilters: SelectedQuestionPaperFilters;
    handleSubmitFilters: () => void;
    handleResetFilters: () => void;
}

/**
 * Apply / clear for the assessment-list filters.
 *
 * <p>These matter more than they look: picking a filter only stores it — the list is
 * refetched by a mutation on Apply, not by a query keyed on the filter state — so until
 * this is pressed the page still shows unfiltered results. The old labels ("Filter" /
 * "Reset") did not say that, which is why ticking boxes appeared to do nothing.
 */
const ScheduleTestFilterButtons = ({
    selectedQuestionPaperFilters,
    handleSubmitFilters,
    handleResetFilters,
}: ScheduleTestFilterButtonsProps) => {
    const { t } = useTranslation('assessmentScheduleTestFilterButtons');

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

    if (!isButtonEnabled()) return null;

    return (
        <div className="flex items-center gap-2">
            <MyButton
                buttonType="primary"
                scale="small"
                layoutVariant="default"
                className="h-9 cursor-pointer px-4"
                onClick={handleSubmitFilters}
            >
                {t('apply')}
            </MyButton>
            <button
                type="button"
                onClick={handleResetFilters}
                className="h-9 cursor-pointer rounded-lg px-3 text-sm font-medium text-neutral-500 transition-colors duration-200 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
                {t('clearAll')}
            </button>
        </div>
    );
};

export default ScheduleTestFilterButtons;
