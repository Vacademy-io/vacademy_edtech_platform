import React from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Globe, CreditCard, Heart, CurrencyDollar, Stack } from '@phosphor-icons/react';
import { PaymentPlans, PaymentPlanType } from '@/types/payment';
import { isFreePlanDisabled, getFreePlanRestrictionMessage, FreePlanInfo } from '../utils/utils';

interface PlanTypeSelectionProps {
    planName: string;
    planType: PaymentPlanType;
    existingFreePlans: FreePlanInfo[];
    onPlanNameChange: (name: string) => void;
    onPlanTypeChange: (type: PaymentPlanType) => void;
}

export const PlanTypeSelection: React.FC<PlanTypeSelectionProps> = ({
    planName,
    planType,
    existingFreePlans,
    onPlanNameChange,
    onPlanTypeChange,
}) => {
    const { t } = useTranslation('settingsPlanTypeSelection');
    const isFreeDisabled = isFreePlanDisabled(existingFreePlans);
    const restrictionMessage = getFreePlanRestrictionMessage(existingFreePlans);

    return (
        <div className="space-y-2">
            {/* Plan Name Input */}
            <div>
                <Label htmlFor="planName" className="text-sm font-medium">
                    {t('planName.label')}
                </Label>
                <Input
                    id="planName"
                    value={planName}
                    onChange={(e) => onPlanNameChange(e.target.value)}
                    placeholder={t('planName.placeholder')}
                    className="mt-1"
                    required
                />
                <p className="mt-1 text-xs text-gray-500">{t('planName.hint')}</p>
            </div>

            <RadioGroup
                value={planType}
                onValueChange={(value: PaymentPlanType) => onPlanTypeChange(value)}
                className="space-y-8"
            >
                <div>
                    <div className="mb-2 text-lg font-semibold text-primary-500">
                        {t('sections.freeOptions')}
                    </div>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        {/* Free Plan */}
                        <label
                            htmlFor="free"
                            className={`rounded-lg border-2 p-4 transition-all ${
                                isFreeDisabled
                                    ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
                                    : planType === PaymentPlans.FREE
                                      ? 'cursor-pointer border-primary-500 bg-primary-50'
                                      : 'cursor-pointer border-gray-200 hover:border-gray-300'
                            }`}
                        >
                            <div className="flex items-start space-x-3">
                                <RadioGroupItem
                                    value={PaymentPlans.FREE}
                                    id="free"
                                    className="mt-1"
                                    disabled={isFreeDisabled}
                                />
                                <div className="flex-1">
                                    <div className="mb-2 flex items-center space-x-2">
                                        <Globe className="size-5 text-gray-600" />
                                        <Label
                                            htmlFor="free"
                                            className={`font-medium ${
                                                isFreeDisabled
                                                    ? 'cursor-not-allowed text-gray-500'
                                                    : 'cursor-pointer text-gray-900'
                                            }`}
                                        >
                                            {t('free.title')}
                                        </Label>
                                    </div>
                                    <p className="text-sm text-gray-600">
                                        {t('free.description')}
                                    </p>
                                    <div className="mt-2 text-xs text-gray-500">
                                        ✓ {t('free.features.access')}
                                        <br />✓ {t('free.features.noPayment')}
                                        <br />✓ {t('free.features.promotional')}
                                    </div>

                                    {/* Show restriction message if any */}
                                    {restrictionMessage && (
                                        <div className="mt-3 rounded-md bg-amber-50 p-2">
                                            <p className="text-xs text-amber-800">
                                                <strong>{t('free.restriction')}</strong>{' '}
                                                {restrictionMessage}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </label>

                        {/* Optional Donation */}
                        <label
                            htmlFor="donation"
                            className={`cursor-pointer rounded-lg border-2 p-4 transition-all ${planType === PaymentPlans.DONATION ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                        >
                            <div className="flex items-start space-x-3">
                                <RadioGroupItem
                                    value={PaymentPlans.DONATION}
                                    id="donation"
                                    className="mt-1"
                                />
                                <div className="flex-1">
                                    <div className="mb-2 flex items-center space-x-2">
                                        <Heart className="size-5 text-red-600" />
                                        <Label
                                            htmlFor="donation"
                                            className="cursor-pointer font-medium text-gray-900"
                                        >
                                            {t('donation.title')}
                                        </Label>
                                    </div>
                                    <p className="text-sm text-gray-600">
                                        {t('donation.description')}
                                    </p>
                                    <div className="mt-2 text-xs text-gray-500">
                                        ✓ {t('donation.features.access')}
                                        <br />✓ {t('donation.features.suggestedAmounts')}
                                        <br />✓ {t('donation.features.support')}
                                    </div>
                                </div>
                            </div>
                        </label>
                    </div>
                </div>

                <div>
                    <div className="mb-2 text-lg font-semibold text-primary-500">
                        {t('sections.paidOptions')}
                    </div>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        {/* Subscription */}
                        <label
                            htmlFor="subscription"
                            className={`cursor-pointer rounded-lg border-2 p-4 transition-all ${planType === PaymentPlans.SUBSCRIPTION ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                        >
                            <div className="flex items-start space-x-3">
                                <RadioGroupItem
                                    value={PaymentPlans.SUBSCRIPTION}
                                    id="subscription"
                                    className="mt-1"
                                />
                                <div className="flex-1">
                                    <div className="mb-2 flex items-center space-x-2">
                                        <CreditCard className="size-5 text-blue-600" />
                                        <Label
                                            htmlFor="subscription"
                                            className="cursor-pointer font-medium text-gray-900"
                                        >
                                            {t('subscription.title')}
                                        </Label>
                                    </div>
                                    <p className="text-sm text-gray-600">
                                        {t('subscription.description')}
                                    </p>
                                    <div className="mt-2 text-xs text-gray-500">
                                        ✓ {t('subscription.features.autoRenewal')}
                                        <br />✓ {t('subscription.features.billingPeriods')}
                                        <br />✓ {t('subscription.features.revenue')}
                                    </div>
                                </div>
                            </div>
                        </label>

                        {/* One-Time Payment */}
                        <label
                            className={`cursor-pointer rounded-lg border-2 p-4 transition-all ${planType === PaymentPlans.UPFRONT ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                        >
                            <div className="flex items-start space-x-3">
                                <RadioGroupItem
                                    value={PaymentPlans.UPFRONT}
                                    id="upfront"
                                    className="mt-1"
                                />
                                <div className="flex-1">
                                    <div className="mb-2 flex items-center space-x-2">
                                        <CurrencyDollar className="size-5 text-green-600" />
                                        <Label
                                            htmlFor="upfront"
                                            className="cursor-pointer font-medium text-gray-900"
                                        >
                                            {t('upfront.title')}
                                        </Label>
                                    </div>
                                    <p className="text-sm text-gray-600">
                                        {t('upfront.description')}
                                    </p>
                                    <div className="mt-2 text-xs text-gray-500">
                                        ✓ {t('upfront.features.lifetime')}
                                        <br />✓ {t('upfront.features.installments')}
                                        <br />✓ {t('upfront.features.noRecurring')}
                                    </div>
                                </div>
                            </div>
                        </label>

                        {/* Custom Payment Option (CPO) */}
                        <label
                            htmlFor="cpo"
                            className={`cursor-pointer rounded-lg border-2 p-4 transition-all ${planType === PaymentPlans.CPO ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                        >
                            <div className="flex items-start space-x-3">
                                <RadioGroupItem
                                    value={PaymentPlans.CPO}
                                    id="cpo"
                                    className="mt-1"
                                />
                                <div className="flex-1">
                                    <div className="mb-2 flex items-center space-x-2">
                                        <Stack className="size-5 text-purple-600" />
                                        <Label
                                            htmlFor="cpo"
                                            className="cursor-pointer font-medium text-gray-900"
                                        >
                                            {t('cpo.title')}
                                        </Label>
                                    </div>
                                    <p className="text-sm text-gray-600">
                                        {t('cpo.description')}
                                    </p>
                                    <div className="mt-2 text-xs text-gray-500">
                                        ✓ {t('cpo.features.feeTypes')}
                                        <br />✓ {t('cpo.features.schedules')}
                                        <br />✓ {t('cpo.features.batches')}
                                    </div>
                                </div>
                            </div>
                        </label>
                    </div>
                </div>
            </RadioGroup>
        </div>
    );
};
