import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from '@phosphor-icons/react';
import { PaymentPlans } from '@/types/payment';

interface CustomInterval {
    value: number;
    unit: 'days' | 'months';
    price: number;
    features?: string[];
    newFeature?: string;
    title?: string;
}

interface PlanDiscountsConfigurationProps {
    planType: string;
    currency: string;
    customIntervals: CustomInterval[];
    upfrontPrice: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    planDiscounts: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onPlanDiscountsChange: (discounts: Record<string, any>) => void;
    getCurrencySymbol: (currency: string) => string;
}

export const PlanDiscountsConfiguration: React.FC<PlanDiscountsConfigurationProps> = ({
    planType,
    currency,
    customIntervals,
    upfrontPrice,
    planDiscounts,
    onPlanDiscountsChange,
    getCurrencySymbol,
}) => {
    const { t } = useTranslation('settingsPlanDiscountsConfiguration');

    const updateDiscount = (key: string, type: string, amount: string) => {
        const updatedDiscounts = {
            ...planDiscounts,
            [key]: {
                type,
                amount: type === 'none' ? '' : amount,
            },
        };
        onPlanDiscountsChange(updatedDiscounts);
    };

    const calculateFinalPrice = (
        originalPrice: number,
        discountType: string,
        discountAmount: string
    ) => {
        let finalPrice = originalPrice;
        if (discountType === 'percentage' && discountAmount) {
            finalPrice = originalPrice * (1 - parseFloat(discountAmount) / 100);
        } else if (discountType === 'fixed' && discountAmount) {
            finalPrice = Math.max(0, originalPrice - parseFloat(discountAmount));
        }
        return finalPrice;
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{t('header.title')}</CardTitle>
                <p className="text-sm text-gray-600">{t('header.subtitle')}</p>
            </CardHeader>
            <CardContent>
                {planType === PaymentPlans.SUBSCRIPTION && customIntervals.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse border border-gray-200">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="border border-gray-200 px-4 py-2 text-left font-medium">
                                        {t('table.headers.subscriptionInterval')}
                                    </th>
                                    <th className="border border-gray-200 px-4 py-2 text-left font-medium">
                                        {t('table.headers.originalPrice')}
                                    </th>
                                    <th className="border border-gray-200 px-4 py-2 text-left font-medium">
                                        {t('table.headers.discountType')}
                                    </th>
                                    <th className="border border-gray-200 px-4 py-2 text-left font-medium">
                                        {t('table.headers.discountAmount')}
                                    </th>
                                    <th className="border border-gray-200 px-4 py-2 text-left font-medium">
                                        {t('table.headers.finalPrice')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {customIntervals.map((interval, idx) => {
                                    const originalPrice = parseFloat(String(interval.price || '0'));
                                    const discountKey = `interval_${idx}`;
                                    const discountType = planDiscounts[discountKey]?.type || 'none';
                                    const discountAmount = planDiscounts[discountKey]?.amount || '';
                                    const finalPrice = calculateFinalPrice(
                                        originalPrice,
                                        discountType,
                                        discountAmount
                                    );

                                    return (
                                        <tr key={idx} className="hover:bg-gray-50">
                                            <td className="border border-gray-200 px-4 py-2">
                                                <span className="font-medium">
                                                    {interval.title ||
                                                        t('table.intervalPlanFallback', {
                                                            value: interval.value,
                                                            unit: interval.unit,
                                                        })}
                                                </span>
                                            </td>
                                            <td className="border border-gray-200 px-4 py-2">
                                                <span className="font-medium">
                                                    {getCurrencySymbol(currency)}
                                                    {originalPrice.toLocaleString()}
                                                </span>
                                            </td>
                                            <td className="border border-gray-200 px-4 py-2">
                                                <Select
                                                    value={discountType}
                                                    onValueChange={(value) =>
                                                        updateDiscount(
                                                            discountKey,
                                                            value,
                                                            discountAmount
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger className="w-32">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="none">
                                                            {t('discountOptions.none')}
                                                        </SelectItem>
                                                        <SelectItem value="percentage">
                                                            {t('discountOptions.percentage')}
                                                        </SelectItem>
                                                        <SelectItem value="fixed">
                                                            {t('discountOptions.fixed')}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </td>
                                            <td className="border border-gray-200 px-4 py-2">
                                                {discountType !== 'none' ? (
                                                    <div className="flex items-center space-x-2">
                                                        {discountType === 'fixed' && (
                                                            <span className="text-sm">
                                                                {getCurrencySymbol(currency)}
                                                            </span>
                                                        )}
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            max={
                                                                discountType === 'percentage'
                                                                    ? 100
                                                                    : originalPrice
                                                            }
                                                            placeholder={
                                                                discountType === 'percentage'
                                                                    ? t('placeholders.percentage')
                                                                    : t('placeholders.fixed')
                                                            }
                                                            value={discountAmount}
                                                            onChange={(e) =>
                                                                updateDiscount(
                                                                    discountKey,
                                                                    discountType,
                                                                    e.target.value
                                                                )
                                                            }
                                                            className="w-20"
                                                        />
                                                        {discountType === 'percentage' && (
                                                            <span className="text-sm">%</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-400">-</span>
                                                )}
                                            </td>
                                            <td className="border border-gray-200 px-4 py-2">
                                                <span
                                                    className={`font-medium ${finalPrice < originalPrice ? 'text-green-600' : 'text-gray-900'}`}
                                                >
                                                    {getCurrencySymbol(currency)}
                                                    {finalPrice.toLocaleString()}
                                                </span>
                                                {finalPrice < originalPrice && (
                                                    <div className="text-xs text-gray-500">
                                                        {t('table.savePrefix')}{' '}
                                                        {getCurrencySymbol(currency)}
                                                        {(
                                                            originalPrice - finalPrice
                                                        ).toLocaleString()}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : planType === PaymentPlans.UPFRONT ? (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse border border-gray-200">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="border border-gray-200 px-4 py-2 text-left font-medium">
                                        {t('table.headers.planType')}
                                    </th>
                                    <th className="border border-gray-200 px-4 py-2 text-left font-medium">
                                        {t('table.headers.originalPrice')}
                                    </th>
                                    <th className="border border-gray-200 px-4 py-2 text-left font-medium">
                                        {t('table.headers.discountType')}
                                    </th>
                                    <th className="border border-gray-200 px-4 py-2 text-left font-medium">
                                        {t('table.headers.discountAmount')}
                                    </th>
                                    <th className="border border-gray-200 px-4 py-2 text-left font-medium">
                                        {t('table.headers.finalPrice')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className="hover:bg-gray-50">
                                    <td className="border border-gray-200 px-4 py-2">
                                        <span className="font-medium">
                                            {t('table.oneTimePayment')}
                                        </span>
                                    </td>
                                    <td className="border border-gray-200 px-4 py-2">
                                        <span className="font-medium">
                                            {getCurrencySymbol(currency)}
                                            {parseFloat(upfrontPrice || '0').toLocaleString()}
                                        </span>
                                    </td>
                                    <td className="border border-gray-200 px-4 py-2">
                                        <Select
                                            value={planDiscounts.upfront?.type || 'none'}
                                            onValueChange={(value) =>
                                                updateDiscount(
                                                    'upfront',
                                                    value,
                                                    planDiscounts.upfront?.amount || ''
                                                )
                                            }
                                        >
                                            <SelectTrigger className="w-32">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">
                                                    {t('discountOptions.none')}
                                                </SelectItem>
                                                <SelectItem value="percentage">
                                                    {t('discountOptions.percentage')}
                                                </SelectItem>
                                                <SelectItem value="fixed">
                                                    {t('discountOptions.fixed')}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </td>
                                    <td className="border border-gray-200 px-4 py-2">
                                        {planDiscounts.upfront?.type !== 'none' ? (
                                            <div className="flex items-center space-x-2">
                                                {planDiscounts.upfront?.type === 'fixed' && (
                                                    <span className="text-sm">
                                                        {getCurrencySymbol(currency)}
                                                    </span>
                                                )}
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    max={
                                                        planDiscounts.upfront?.type === 'percentage'
                                                            ? 100
                                                            : parseFloat(upfrontPrice || '0')
                                                    }
                                                    placeholder={
                                                        planDiscounts.upfront?.type === 'percentage'
                                                            ? t('placeholders.percentage')
                                                            : t('placeholders.fixed')
                                                    }
                                                    value={planDiscounts.upfront?.amount || ''}
                                                    onChange={(e) =>
                                                        updateDiscount(
                                                            'upfront',
                                                            planDiscounts.upfront?.type ||
                                                                'percentage',
                                                            e.target.value
                                                        )
                                                    }
                                                    className="w-20"
                                                />
                                                {planDiscounts.upfront?.type === 'percentage' && (
                                                    <span className="text-sm">%</span>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="border border-gray-200 px-4 py-2">
                                        {(() => {
                                            const originalPrice = parseFloat(upfrontPrice || '0');
                                            const discountType =
                                                planDiscounts.upfront?.type || 'none';
                                            const discountAmount =
                                                planDiscounts.upfront?.amount || '';
                                            const finalPrice = calculateFinalPrice(
                                                originalPrice,
                                                discountType,
                                                discountAmount
                                            );

                                            return (
                                                <>
                                                    <span
                                                        className={`font-medium ${finalPrice < originalPrice ? 'text-green-600' : 'text-gray-900'}`}
                                                    >
                                                        {getCurrencySymbol(currency)}
                                                        {finalPrice.toLocaleString()}
                                                    </span>
                                                    {finalPrice < originalPrice && (
                                                        <div className="text-xs text-gray-500">
                                                            {t('table.savePrefix')}{' '}
                                                            {getCurrencySymbol(currency)}
                                                            {(
                                                                originalPrice - finalPrice
                                                            ).toLocaleString()}
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <Alert>
                        <Info className="size-4" />
                        <AlertDescription>{t('emptyState')}</AlertDescription>
                    </Alert>
                )}
            </CardContent>
        </Card>
    );
};
