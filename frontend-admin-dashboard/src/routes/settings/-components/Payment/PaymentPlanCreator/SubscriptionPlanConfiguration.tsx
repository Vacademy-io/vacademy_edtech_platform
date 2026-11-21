import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Plus, Trash } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { getCurrencySymbol } from '../utils/utils';
import { DAYS_IN_MONTH } from '@/routes/settings/-constants/terms';

interface CustomInterval {
    /** payment_plan.id — carried so an edit updates this plan instead of replacing it. */
    id?: string;
    value: number | string;
    unit: 'days' | 'months';
    price: number | string;
    features?: string[];
    newFeature?: string;
    title?: string;
    /** Members on another plan may switch to this interval. */
    planChangeAllowed?: boolean;
}

interface SubscriptionPlanConfigurationProps {
    currency: string;
    customIntervals: CustomInterval[];
    featuresGlobal: string[];
    setFeaturesGlobal: (features: string[]) => void;
    onCustomIntervalsChange: (intervals: CustomInterval[]) => void;
    selectedUnit: 'days' | 'months';
    onUnitChange: (unit: 'days' | 'months') => void;
    /**
     * Option-level master switch. The per-interval checkboxes are disabled while it is off,
     * because the backend ignores a plan's flag unless its option carries one too.
     */
    planChangeAllowed?: boolean;
}

export const SubscriptionPlanConfiguration: React.FC<SubscriptionPlanConfigurationProps> = ({
    currency,
    customIntervals,
    featuresGlobal,
    setFeaturesGlobal,
    onCustomIntervalsChange,
    selectedUnit,
    onUnitChange,
    planChangeAllowed = false,
}) => {
    const { t } = useTranslation('settingsSubscriptionPlanConfiguration');

    // Helper function to convert unit and value to days
    const convertToDays = (value: number, unit: 'days' | 'months'): number => {
        if (unit === 'days') {
            return value;
        } else if (unit === 'months') {
            return value * DAYS_IN_MONTH;
        }
        return value;
    };

    // Helper function to convert days to display value based on unit
    const convertDaysToDisplayValue = (days: number, unit: 'days' | 'months'): number => {
        if (unit === 'days') {
            return days;
        } else if (unit === 'months') {
            return Math.round(days / DAYS_IN_MONTH);
        }
        return days;
    };

    const handleUnitChange = (newUnit: 'days' | 'months') => {
        onUnitChange(newUnit);

        // Update all intervals to use the new unit and convert values
        const updatedIntervals = customIntervals.map((interval) => {
            // Convert current value to days first (handle string values)
            const numericValue =
                typeof interval.value === 'string'
                    ? parseFloat(interval.value) || 0
                    : interval.value;
            const currentDays = convertToDays(numericValue, selectedUnit);
            // Then convert to new unit's display value
            const newDisplayValue = convertDaysToDisplayValue(currentDays, newUnit);

            return {
                ...interval,
                value: newDisplayValue,
                unit: newUnit,
            };
        });
        onCustomIntervalsChange(updatedIntervals);
    };

    const addInterval = () => {
        const newInterval = {
            value: 1,
            unit: selectedUnit,
            price: 0,
            features: [...featuresGlobal],
            newFeature: '',
            planChangeAllowed: false,
        };
        onCustomIntervalsChange([...customIntervals, newInterval as CustomInterval]);
    };

    const updateInterval = (index: number, updates: Partial<CustomInterval>) => {
        const updatedIntervals = [...customIntervals];
        if (updatedIntervals[index]) {
            const currentInterval = updatedIntervals[index];
            if (!currentInterval) return;
            // Create a new interval with only the properties that are actually defined.
            // Every field the interval can carry must be listed here — this rebuilds the
            // object from scratch, so anything omitted is silently dropped on the first
            // edit (which is how `id` would be lost, retiring the plan on save).
            const updatedInterval: CustomInterval = {
                id: updates.id !== undefined ? updates.id : currentInterval.id,
                value: updates.value !== undefined ? updates.value : currentInterval.value,
                unit: updates.unit !== undefined ? updates.unit : currentInterval.unit,
                price: updates.price !== undefined ? updates.price : currentInterval.price,
                features:
                    updates.features !== undefined ? updates.features : currentInterval.features,
                newFeature:
                    updates.newFeature !== undefined
                        ? updates.newFeature
                        : currentInterval.newFeature,
                title: updates.title !== undefined ? updates.title : currentInterval.title,
                planChangeAllowed:
                    updates.planChangeAllowed !== undefined
                        ? updates.planChangeAllowed
                        : currentInterval.planChangeAllowed,
            };

            updatedIntervals[index] = updatedInterval;
        }
        onCustomIntervalsChange(updatedIntervals);
    };

    const removeInterval = (index: number) => {
        const updatedIntervals = customIntervals.filter((_, i) => i !== index);
        onCustomIntervalsChange(updatedIntervals);
    };

    const addFeature = (intervalIndex: number) => {
        const interval = customIntervals[intervalIndex];
        if (!interval) return;
        const newFeature = interval.newFeature?.trim();

        if (newFeature && !featuresGlobal.includes(newFeature)) {
            // Add to global features
            setFeaturesGlobal([...featuresGlobal, newFeature]);

            // Add to all intervals
            const updatedIntervals = customIntervals.map((intv, i) => ({
                ...intv,
                features: [...(intv.features || []), newFeature],
                newFeature: i === intervalIndex ? '' : intv.newFeature,
            }));

            onCustomIntervalsChange(updatedIntervals);
        }
    };

    const toggleFeature = (intervalIndex: number, feature: string, checked: boolean) => {
        const interval = customIntervals[intervalIndex];
        if (!interval) return;
        const currentFeatures = interval.features || [];

        let newFeatures: string[];
        if (checked) {
            newFeatures = [...currentFeatures, feature];
        } else {
            newFeatures = currentFeatures.filter((f) => f !== feature);
        }

        updateInterval(intervalIndex, { features: newFeatures });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{t('title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Global Unit Selection */}
                <div className="mb-4">
                    <Label className="text-sm font-medium">{t('durationUnit.label')}</Label>
                    <Select
                        value={selectedUnit}
                        onValueChange={(value: 'days' | 'months') => handleUnitChange(value)}
                    >
                        <SelectTrigger className="mt-1 w-48">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="days">{t('durationUnit.days')}</SelectItem>
                            <SelectItem value="months">{t('durationUnit.months')}</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-gray-500">{t('durationUnit.hint')}</p>
                </div>

                {/* Custom Intervals Section */}
                <div className="space-y-6">
                    <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-sm font-medium">{t('pricingIntervals.heading')}</h3>
                        <Button type="button" variant="outline" size="sm" onClick={addInterval}>
                            <Plus className="mr-2 size-4" />
                            {t('pricingIntervals.addButton')}
                        </Button>
                    </div>

                    <div className="space-y-3">
                        {customIntervals.map((interval, idx) => (
                            <div key={idx} className="space-y-4 rounded-lg border p-4">
                                <div className="grid flex-1 grid-cols-3 gap-3">
                                    <div>
                                        <Label className="text-xs">
                                            {t('pricingIntervals.interval.titleLabel')}
                                        </Label>
                                        <Input
                                            type="text"
                                            placeholder={t(
                                                'pricingIntervals.interval.titlePlaceholder'
                                            )}
                                            value={interval.title || ''}
                                            onChange={(e) =>
                                                updateInterval(idx, { title: e.target.value })
                                            }
                                            className="mt-1"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs">
                                            {t('pricingIntervals.interval.durationLabel', {
                                                unit: selectedUnit,
                                            })}
                                        </Label>
                                        <Input
                                            type="number"
                                            value={interval.value}
                                            onChange={(e) => {
                                                const inputValue = e.target.value;
                                                updateInterval(idx, {
                                                    value:
                                                        inputValue === ''
                                                            ? ''
                                                            : parseInt(inputValue) || 1,
                                                });
                                            }}
                                            className="mt-1"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs">
                                            {t('pricingIntervals.interval.priceLabel')}
                                        </Label>
                                        <div className="mt-1 flex items-center space-x-2">
                                            <span className="text-sm">
                                                {getCurrencySymbol(currency)}
                                            </span>
                                            <Input
                                                type="number"
                                                placeholder={t(
                                                    'pricingIntervals.interval.pricePlaceholder'
                                                )}
                                                value={interval.price}
                                                onChange={(e) => {
                                                    const inputValue = e.target.value;
                                                    updateInterval(idx, {
                                                        price:
                                                            inputValue === ''
                                                                ? ''
                                                                : parseFloat(inputValue) || 0,
                                                    });
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Features for this interval */}
                                <div className="mt-4">
                                    <h4 className="mb-2 text-xs font-semibold">
                                        {t('pricingIntervals.interval.featuresHeading')}
                                    </h4>
                                    <div className="space-y-2">
                                        {featuresGlobal.map((feature, fidx) => (
                                            <div key={fidx} className="flex items-center gap-2">
                                                <Checkbox
                                                    checked={
                                                        interval.features?.includes(feature) ||
                                                        false
                                                    }
                                                    onCheckedChange={(checked) =>
                                                        toggleFeature(idx, feature, !!checked)
                                                    }
                                                />
                                                <span>{feature}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-2 flex gap-2">
                                        <Input
                                            type="text"
                                            className="flex-1 rounded border px-2 py-1"
                                            placeholder={t(
                                                'pricingIntervals.interval.addFeaturePlaceholder'
                                            )}
                                            value={interval.newFeature || ''}
                                            onChange={(e) =>
                                                updateInterval(idx, { newFeature: e.target.value })
                                            }
                                        />
                                        <Button
                                            type="button"
                                            className="rounded border hover:bg-gray-200"
                                            onClick={() => addFeature(idx)}
                                        >
                                            {t('pricingIntervals.interval.addFeatureButton')}
                                        </Button>
                                    </div>
                                </div>

                                {/* Switchable target opt-in for this interval */}
                                <div className="mt-4 border-t pt-3">
                                    <label
                                        className={cn(
                                            'flex items-start gap-2 text-xs',
                                            planChangeAllowed
                                                ? 'cursor-pointer text-neutral-700'
                                                : 'cursor-not-allowed text-neutral-400'
                                        )}
                                    >
                                        <Checkbox
                                            className="mt-0.5"
                                            checked={interval.planChangeAllowed || false}
                                            disabled={!planChangeAllowed}
                                            onCheckedChange={(checked) =>
                                                updateInterval(idx, {
                                                    planChangeAllowed: !!checked,
                                                })
                                            }
                                        />
                                        <span>
                                            {t('pricingIntervals.interval.planChangeLabel')}
                                            {!planChangeAllowed && (
                                                <span className="ms-1 text-neutral-400">
                                                    {t('pricingIntervals.interval.planChangeHint')}
                                                </span>
                                            )}
                                        </span>
                                    </label>
                                </div>

                                {/* Remove interval button */}
                                <div className="flex justify-end">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeInterval(idx)}
                                        className="text-red-600 hover:text-red-700"
                                    >
                                        <Trash className="me-2 size-4" />
                                        {t('pricingIntervals.interval.removeButton')}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
