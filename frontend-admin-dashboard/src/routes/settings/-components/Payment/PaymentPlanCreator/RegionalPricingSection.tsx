import React from 'react';
import { useTranslation } from 'react-i18next';
import { GlobeHemisphereEast } from '@phosphor-icons/react';
import { PaymentPlanType, PaymentPlans } from '@/types/payment';
import { RegionalPricingSettingsFields } from '../RegionalPricingSettingsFields';

interface RegionalPricingSectionProps {
    planType: PaymentPlanType;
    /** The plan's own currency; never offered as a regional currency. */
    baseCurrency?: string;
    enabled: boolean;
    onEnabledChange: (value: boolean) => void;
    currencies: string[];
    onCurrenciesChange: (value: string[]) => void;
}

const REGIONAL_TYPES: PaymentPlanType[] = [PaymentPlans.SUBSCRIPTION, PaymentPlans.UPFRONT];

/**
 * Regional pricing inside the create / edit payment plan screens. Saved together with the
 * plan; the backend then creates an automatic price per plan for each chosen currency. Fixed
 * prices for specific countries are set afterwards in the Regional pricing panel, which opens
 * by itself after saving.
 */
export const RegionalPricingSection: React.FC<RegionalPricingSectionProps> = ({
    planType,
    baseCurrency,
    enabled,
    onEnabledChange,
    currencies,
    onCurrenciesChange,
}) => {
    const { t } = useTranslation('settingsRegionalPricing');

    // Only paid one-time and subscription options can be priced by region.
    if (!REGIONAL_TYPES.includes(planType)) {
        return null;
    }

    return (
        <div className="space-y-3 rounded-md border border-border p-4">
            <p className="flex items-center gap-2 text-subtitle font-semibold text-neutral-800">
                <GlobeHemisphereEast className="size-5" />
                {t('section.title')}
            </p>
            <RegionalPricingSettingsFields
                enabled={enabled}
                onEnabledChange={onEnabledChange}
                currencies={currencies}
                onCurrenciesChange={onCurrenciesChange}
                baseCurrency={baseCurrency}
                idPrefix="regional-plan-form"
            />
            {enabled && <p className="text-caption text-neutral-500">{t('section.afterSave')}</p>}
        </div>
    );
};
