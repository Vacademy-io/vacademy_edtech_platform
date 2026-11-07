import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { getCurrencySymbol } from '../utils/utils';

export type UpfrontAccessType = 'lifetime' | 'limited';

interface UpfrontPlanConfigurationProps {
    currency: string;
    fullPrice: string;
    onFullPriceChange: (price: string) => void;
    accessType: UpfrontAccessType;
    onAccessTypeChange: (accessType: UpfrontAccessType) => void;
    validityDays: number | undefined;
    onValidityDaysChange: (days: number | undefined) => void;
}

export const UpfrontPlanConfiguration: React.FC<UpfrontPlanConfigurationProps> = ({
    currency,
    fullPrice,
    onFullPriceChange,
    accessType,
    onAccessTypeChange,
    validityDays,
    onValidityDaysChange,
}) => {
    const { t } = useTranslation('settingsUpfrontPlanConfiguration');

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{t('title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div>
                    <Label>
                        {t('fullPrice.label', { currency: getCurrencySymbol(currency) })}
                    </Label>
                    <Input
                        type="number"
                        placeholder={t('fullPrice.placeholder')}
                        value={fullPrice}
                        onChange={(e) => onFullPriceChange(e.target.value)}
                        className="mt-1"
                    />
                    <p className="mt-1 text-xs text-gray-500">{t('fullPrice.hint')}</p>
                </div>

                <div>
                    <Label>{t('courseAccess.label')}</Label>
                    <RadioGroup
                        value={accessType}
                        onValueChange={(value) => onAccessTypeChange(value as UpfrontAccessType)}
                        className="mt-2 flex flex-col gap-2"
                    >
                        <div className="flex items-center gap-2">
                            <RadioGroupItem value="lifetime" id="upfront-access-lifetime" />
                            <Label
                                htmlFor="upfront-access-lifetime"
                                className="cursor-pointer font-normal"
                            >
                                {t('courseAccess.lifetime')}
                            </Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <RadioGroupItem value="limited" id="upfront-access-limited" />
                            <Label
                                htmlFor="upfront-access-limited"
                                className="cursor-pointer font-normal"
                            >
                                {t('courseAccess.limited')}
                            </Label>
                        </div>
                    </RadioGroup>

                    {accessType === 'limited' && (
                        <div className="mt-3">
                            <Label>{t('accessDuration.label')}</Label>
                            <Input
                                type="number"
                                placeholder={t('accessDuration.placeholder')}
                                value={validityDays ?? ''}
                                onChange={(e) =>
                                    onValidityDaysChange(
                                        e.target.value ? parseInt(e.target.value) : undefined
                                    )
                                }
                                className="mt-1"
                                min="1"
                            />
                            <p className="mt-1 text-xs text-gray-500">
                                {t('accessDuration.hint')}
                            </p>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
