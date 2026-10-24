import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from '@phosphor-icons/react';
import { MultiSelect } from '@/components/design-system/multi-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CURRENCIES } from '@/constants/currencies';
import { currencyName } from '@/constants/countries';

interface RegionalPricingSettingsFieldsProps {
    enabled: boolean;
    onEnabledChange: (value: boolean) => void;
    currencies: string[];
    onCurrenciesChange: (value: string[]) => void;
    /** The plan's own currency: never offered, every learner already pays in it by default. */
    baseCurrency?: string;
    /** Distinguishes the switch id when the fields appear twice on a page. */
    idPrefix?: string;
}

/**
 * The two option-level regional pricing settings, used both in the create / edit payment
 * plan screen and in the Regional pricing dialog: the on/off switch and the currencies the
 * system prices every plan in automatically (converted from the plan's own price).
 */
export const RegionalPricingSettingsFields = ({
    enabled,
    onEnabledChange,
    currencies,
    onCurrenciesChange,
    baseCurrency,
    idPrefix = 'regional',
}: RegionalPricingSettingsFieldsProps) => {
    const { t, i18n } = useTranslation('settingsRegionalPricing');

    const options = useMemo(
        () =>
            CURRENCIES.filter((c) => c.code !== baseCurrency).map((c) => ({
                label: `${currencyName(c.code, i18n.language)} (${c.code}) ${c.symbol}`,
                value: c.code,
            })),
        [baseCurrency, i18n.language]
    );

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <Label htmlFor={`${idPrefix}-enabled`} className="text-subtitle font-semibold">
                        {t('settings.enabledLabel')}
                    </Label>
                    <p className="text-caption text-neutral-500">{t('settings.enabledHelp')}</p>
                </div>
                <Switch
                    id={`${idPrefix}-enabled`}
                    checked={enabled}
                    onCheckedChange={onEnabledChange}
                />
            </div>

            {enabled && (
                <div className="space-y-1">
                    <Label className="text-body font-semibold">
                        {t('settings.currenciesLabel')}
                    </Label>
                    <p className="text-caption text-neutral-500">{t('settings.currenciesHelp')}</p>
                    <MultiSelect
                        options={options}
                        selected={currencies}
                        onChange={onCurrenciesChange}
                        placeholder={t('settings.currenciesPlaceholder')}
                        portal={false}
                        checkboxes
                    />
                    {currencies.length === 0 && (
                        <p className="text-caption text-warning-700">
                            {t('settings.noCurrencies')}
                        </p>
                    )}
                </div>
            )}

            {enabled && (
                <Alert>
                    <Globe className="size-4" />
                    <AlertDescription className="text-caption">
                        {t('settings.gatewayNote')}
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
};
