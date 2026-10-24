import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash, Info } from '@phosphor-icons/react';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '../../NamingSettings';
import { getCurrencySymbol } from '../utils/utils';

interface DonationPlanConfigurationProps {
    currency: string;
    suggestedAmounts: string;
    minimumAmount: string;
    allowCustomAmount: boolean;
    newAmount: string;
    onMinimumAmountChange: (amount: string) => void;
    onAllowCustomAmountChange: (allow: boolean) => void;
    onNewAmountChange: (amount: string) => void;
    onAddAmount: () => void;
    onRemoveAmount: (index: number) => void;
}

export const DonationPlanConfiguration: React.FC<DonationPlanConfigurationProps> = ({
    currency,
    suggestedAmounts,
    minimumAmount,
    allowCustomAmount,
    newAmount,
    onMinimumAmountChange,
    onAllowCustomAmountChange,
    onNewAmountChange,
    onAddAmount,
    onRemoveAmount,
}) => {
    const { t } = useTranslation('settingsDonationPlanConfiguration');

    useEffect(() => {
        onAllowCustomAmountChange(allowCustomAmount);
    }, []);
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{t('title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <Label>
                        {t('suggestedAmounts.label', { currency: getCurrencySymbol(currency) })}
                    </Label>
                    <div className="mt-1 flex items-center space-x-2">
                        <Input
                            type="number"
                            min="0"
                            placeholder={t('suggestedAmounts.placeholder')}
                            value={newAmount}
                            onChange={(e) => onNewAmountChange(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    onAddAmount();
                                }
                            }}
                            className="flex-1"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onAddAmount}
                            disabled={!newAmount || isNaN(Number(newAmount))}
                        >
                            <Plus className="mr-2 size-4" />
                            {t('suggestedAmounts.add')}
                        </Button>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{t('suggestedAmounts.hint')}</p>

                    {/* Display current suggested amounts */}
                    {suggestedAmounts && (
                        <div className="mt-3">
                            <Label className="text-sm font-medium">
                                {t('suggestedAmounts.currentLabel')}
                            </Label>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {suggestedAmounts
                                    .split(',')
                                    .map((amt: string, idx: number) => (
                                        <div
                                            key={idx}
                                            className="flex items-center gap-2 rounded-md bg-gray-100 px-3 py-1"
                                        >
                                            <span className="text-sm font-medium">
                                                {getCurrencySymbol(currency)}
                                                {amt.trim()}
                                            </span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-auto p-0 text-red-600 hover:text-red-700"
                                                onClick={() => onRemoveAmount(idx)}
                                            >
                                                <Trash className="size-3" />
                                            </Button>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}
                </div>

                <div>
                    <Label>
                        {t('minimumAmount.label', { currency: getCurrencySymbol(currency) })}
                    </Label>
                    <Input
                        type="number"
                        placeholder={t('minimumAmount.placeholder')}
                        value={minimumAmount}
                        onChange={(e) => onMinimumAmountChange(e.target.value)}
                        className="mt-1"
                    />
                </div>

                <div className="flex items-center space-x-2">
                    <Checkbox
                        id="allowCustomAmount"
                        checked={allowCustomAmount}
                        onCheckedChange={onAllowCustomAmountChange}
                    />
                    <Label htmlFor="allowCustomAmount">{t('allowCustomAmount.label')}</Label>
                </div>

                <Alert>
                    <Info className="size-4" />
                    <AlertDescription>
                        {t('alert.part1')}
                        {getTerminology(ContentTerms.Course, SystemTerms.Course)}
                        {t('alert.part2')}
                        {getTerminology(RoleTerms.Learner, SystemTerms.Learner)}
                        {t('alert.part3')}
                    </AlertDescription>
                </Alert>
            </CardContent>
        </Card>
    );
};
