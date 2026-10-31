import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Heart } from '@phosphor-icons/react';
import { getCurrencySymbol } from './utils/utils';

interface DonationPlanPreviewProps {
    currency: string;
    suggestedAmounts: string;
    minimumAmount: string;
    allowCustomAmount: boolean;
    onSelectAmount?: (amount: string) => void;
}

export const DonationPlanPreview: React.FC<DonationPlanPreviewProps> = ({
    currency,
    suggestedAmounts,
    minimumAmount,
    allowCustomAmount,
    onSelectAmount,
}) => {
    const { t } = useTranslation('settingsDonationPlanPreview');
    const [selectedAmount, setSelectedAmount] = useState<string>('');
    const [customAmount, setCustomAmount] = useState<string>('');

    const handleAmountSelect = (amount: string) => {
        setSelectedAmount(amount);
        setCustomAmount('');
        onSelectAmount?.(amount);
    };

    const handleCustomAmountChange = (value: string) => {
        setCustomAmount(value);
        setSelectedAmount('');
        onSelectAmount?.(value);
    };

    const amountsList = suggestedAmounts
        ? suggestedAmounts
              .split(',')
              .map((a: string) => a.trim())
              .filter(Boolean)
        : [];

    const minAmount = parseFloat(minimumAmount) || 0;

    return (
        <Card className="mx-auto w-full max-w-md">
            <CardHeader className="pb-4 text-center">
                <CardTitle className="flex items-center justify-center gap-2 text-xl">
                    <Heart className="size-6 text-red-500" />
                    {t('title')}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="text-center">
                    <Label className="text-sm text-gray-600">{t('chooseAmount')}</Label>
                </div>

                {/* Suggested amounts grid */}
                {amountsList.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                        {amountsList.map((amount, index) => (
                            <Button
                                key={index}
                                variant={selectedAmount === amount ? 'default' : 'outline'}
                                className={`h-12 text-sm font-medium ${
                                    selectedAmount === amount
                                        ? 'bg-primary-500 text-white'
                                        : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                                }`}
                                onClick={() => handleAmountSelect(amount)}
                            >
                                {getCurrencySymbol(currency)}
                                {amount}
                            </Button>
                        ))}
                    </div>
                )}

                {/* Custom amount input */}
                {allowCustomAmount && (
                    <div className="space-y-2">
                        <Label className="text-sm text-gray-600">
                            {t('customAmount.label', {
                                currency,
                                symbol: getCurrencySymbol(currency),
                            })}
                        </Label>
                        <Input
                            type="number"
                            min={minAmount}
                            placeholder={t('customAmount.placeholder')}
                            value={customAmount}
                            onChange={(e) => handleCustomAmountChange(e.target.value)}
                            className={`h-12 text-center text-lg font-medium ${
                                customAmount ? 'border-primary-500' : ''
                            }`}
                        />
                        {minAmount > 0 && (
                            <p className="text-center text-xs text-red-500">
                                {t('customAmount.minimumAmount', {
                                    symbol: getCurrencySymbol(currency),
                                    amount: minAmount,
                                })}
                            </p>
                        )}
                    </div>
                )}

                {/* Continue button */}
                <Button
                    className="h-12 w-full bg-primary-400 font-medium text-white hover:bg-primary-500"
                    disabled={!selectedAmount && !customAmount}
                >
                    {t('continueButton')}
                </Button>
            </CardContent>
        </Card>
    );
};
