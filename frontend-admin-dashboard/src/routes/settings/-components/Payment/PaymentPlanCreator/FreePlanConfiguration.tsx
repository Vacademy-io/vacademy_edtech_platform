import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type FreeAccessType = 'unlimited' | 'limited';

interface FreePlanConfigurationProps {
    accessType: FreeAccessType;
    onAccessTypeChange: (accessType: FreeAccessType) => void;
    validityDays: number | undefined;
    onValidityDaysChange: (days: number | undefined) => void;
}

export const FreePlanConfiguration: React.FC<FreePlanConfigurationProps> = ({
    accessType,
    onAccessTypeChange,
    validityDays,
    onValidityDaysChange,
}) => {
    const { t } = useTranslation('settingsFreePlanConfiguration');

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{t('title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div>
                    <Label>{t('courseAccess.label')}</Label>
                    <RadioGroup
                        value={accessType}
                        onValueChange={(value) => onAccessTypeChange(value as FreeAccessType)}
                        className="mt-2 flex flex-col gap-2"
                    >
                        <div className="flex items-center gap-2">
                            <RadioGroupItem value="unlimited" id="free-access-unlimited" />
                            <Label
                                htmlFor="free-access-unlimited"
                                className="cursor-pointer font-normal"
                            >
                                {t('courseAccess.unlimited')}
                            </Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <RadioGroupItem value="limited" id="free-access-limited" />
                            <Label
                                htmlFor="free-access-limited"
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
                        </div>
                    )}

                    <p className="mt-2 text-xs text-gray-500">{t('accessNote')}</p>
                </div>
            </CardContent>
        </Card>
    );
};
