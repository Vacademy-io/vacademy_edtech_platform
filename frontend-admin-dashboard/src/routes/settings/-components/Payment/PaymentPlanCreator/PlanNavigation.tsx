import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Calendar } from '@phosphor-icons/react';
import { PaymentPlans } from '@/types/payment';

interface PlanNavigationProps {
    currentStep: number;
    totalSteps: number;
    planType: string;
    planName: string;
    isSaving: boolean;
    showPreview: boolean;
    hasCustomIntervals: boolean;
    onBack: () => void;
    onNext: () => void;
    onSave: () => void;
    onClose: () => void;
    onPreviewToggle: () => void;
}

export const PlanNavigation: React.FC<PlanNavigationProps> = ({
    currentStep,
    totalSteps,
    planType,
    planName,
    isSaving,
    showPreview,
    hasCustomIntervals,
    onBack,
    onNext,
    onSave,
    onClose,
    onPreviewToggle,
}) => {
    const { t } = useTranslation('settingsPlanNavigation');

    const canProceed = () => {
        if (currentStep === 1) {
            return planName && planType;
        }

        return true;
    };

    const getButtonText = () => {
        if (isSaving) {
            return (
                <>
                    <div className="mr-2 size-4 animate-spin rounded-full border-b-2 border-white"></div>
                    {t('buttons.saving')}
                </>
            );
        }

        if (
            (planType === PaymentPlans.FREE && currentStep === 2) ||
            (planType === PaymentPlans.DONATION && currentStep === 2) ||
            (planType === PaymentPlans.CPO && currentStep === 2)
        ) {
            return t('buttons.createPlan');
        }

        if (currentStep < totalSteps) {
            return t('buttons.next');
        }

        return t('buttons.createPaymentPlan');
    };

    return (
        <div className="flex justify-between border-t pt-4">
            <div>
                {currentStep > 1 && (
                    <Button variant="outline" onClick={onBack}>
                        {t('buttons.back')}
                    </Button>
                )}
            </div>
            <div className="flex space-x-2">
                {(currentStep === 2 || currentStep === 3) &&
                    (hasCustomIntervals || planType === PaymentPlans.DONATION) && (
                        <Button
                            onClick={onPreviewToggle}
                            variant="outline"
                            className="flex items-center gap-2"
                        >
                            {showPreview ? t('buttons.hidePreview') : t('buttons.previewPlans')}
                            <Calendar className="size-4" />
                        </Button>
                    )}
                <Button variant="outline" onClick={onClose} disabled={isSaving}>
                    {t('buttons.cancel')}
                </Button>
                {currentStep < totalSteps ||
                (currentStep === 2 &&
                    (planType === PaymentPlans.FREE || planType === PaymentPlans.DONATION || planType === PaymentPlans.CPO)) ? (
                    <Button
                        onClick={onNext}
                        disabled={!canProceed() || isSaving}
                        className="bg-primary-400 text-white hover:bg-primary-500"
                    >
                        {getButtonText()}
                    </Button>
                ) : (
                    <Button
                        onClick={onSave}
                        className="bg-primary-400 text-white hover:bg-primary-500"
                        disabled={!planName || !planType || isSaving}
                    >
                        {getButtonText()}
                    </Button>
                )}
            </div>
        </div>
    );
};
