import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { CriteriaJson } from '../../../-services/criteria-services';

interface CriteriaPreviewDialogProps {
    criteria: CriteriaJson | null;
    open: boolean;
    onClose: () => void;
}

export const CriteriaPreviewDialog = ({ criteria, open, onClose }: CriteriaPreviewDialogProps) => {
    const { t } = useTranslation('assessmentCriteriaPreviewDialog');

    if (!criteria) return null;

    // Defensive check for criteria array
    const hasInvalidStructure = !criteria.criteria || !Array.isArray(criteria.criteria);
    const totalMarks = criteria.max_marks;

    return (
        <MyDialog
            open={open}
            onOpenChange={onClose}
            heading={t('heading')}
            dialogWidth="max-w-2xl"
        >
            {hasInvalidStructure ? (
                <div className="flex flex-col items-center justify-center py-8">
                    <div className="mb-4 text-center">
                        <p className="text-lg font-semibold text-red-600">
                            {t('invalidFormat.title')}
                        </p>
                        <p className="mt-2 text-sm text-neutral-600">
                            {t('invalidFormat.description')}
                        </p>
                    </div>
                    <pre className="max-w-md overflow-auto rounded-md bg-neutral-100 p-3 text-xs text-neutral-700">
                        {JSON.stringify(criteria, null, 2)}
                    </pre>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Total Marks */}
                    <div className="flex items-center justify-between rounded-md bg-neutral-50 p-3">
                        <span className="font-medium text-neutral-700">
                            {t('totalMarksLabel')}
                        </span>
                        <span className="text-lg font-semibold text-primary-600">
                            {t('totalMarksValue', { count: totalMarks })}
                        </span>
                    </div>

                    {/* Criteria Items */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-neutral-700">
                            {t('breakdownHeading')}
                        </h3>
                        {criteria.criteria.map((item, index) => (
                            <div
                                key={index}
                                className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-white p-3"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <h4 className="font-medium text-neutral-800">
                                            {index + 1}. {item.name}
                                        </h4>
                                        {item.description && (
                                            <p className="mt-1 text-sm text-neutral-600">
                                                {item.description}
                                            </p>
                                        )}
                                    </div>
                                    <span className="ml-3 rounded-md bg-primary-50 px-2 py-1 text-sm font-semibold text-primary-600">
                                        {t('itemMarks', { count: item.max_marks })}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </MyDialog>
    );
};
