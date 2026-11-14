import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowsClockwise,
    GlobeHemisphereEast,
    Plus,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { SearchableSelect, prefixFirstFilter } from '@/components/design-system/searchable-select';
import { StatusChip } from '@/components/design-system/status-chips';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CURRENCIES, getCurrencySymbol } from '@/constants/currencies';
import {
    COUNTRY_CODES,
    countryKeywords,
    countryName,
    currencyName,
    currencyOfCountry,
} from '@/constants/countries';
import { useRegionalPricing, useRegionalPricingMutations } from '@/services/regional-pricing';
import type { RegionalPriceApi, RegionalPricingPlanApi } from '@/types/payment';
import { RegionalPricingSettingsFields } from './RegionalPricingSettingsFields';

interface RegionalPricingDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    paymentOptionId: string;
    paymentOptionName: string;
}

const errorMessage = (error: unknown, fallback: string): string => {
    const data = (error as { response?: { data?: { ex?: string; message?: string } } })?.response
        ?.data;
    return data?.ex || data?.message || fallback;
};

const formatMoney = (amount: number | null | undefined, currency: string, locale: string) =>
    amount == null ? '—' : `${getCurrencySymbol(currency)}${amount.toLocaleString(locale)}`;

const currencyLabel = (code: string, locale: string) => `${currencyName(code, locale)} (${code})`;

/**
 * Admin panel for one payment option's regional pricing, in two steps:
 *  1. switch it on and pick the currencies to price automatically;
 *  2. review each plan's prices: automatic ones per currency, plus fixed prices the admin
 *     sets for specific countries (picked by name, currency filled in from the country).
 */
export const RegionalPricingDialog = ({
    open,
    onOpenChange,
    paymentOptionId,
    paymentOptionName,
}: RegionalPricingDialogProps) => {
    const { t, i18n } = useTranslation('settingsRegionalPricing');
    const { data, isLoading, isError, refetch } = useRegionalPricing(paymentOptionId, open);
    const mutations = useRegionalPricingMutations(paymentOptionId);

    const [enabled, setEnabled] = useState(false);
    const [currencies, setCurrencies] = useState<string[]>([]);

    useEffect(() => {
        if (data) {
            setEnabled(data.enabled);
            setCurrencies(data.currencies);
        }
    }, [data]);

    const baseCurrency = data?.plans?.[0]?.base_currency;

    const settingsDirty =
        !!data &&
        (enabled !== data.enabled ||
            [...currencies].sort().join(',') !== [...data.currencies].sort().join(','));

    const saveSettings = async () => {
        try {
            await mutations.updateSettings.mutateAsync({ enabled, currencies });
            toast.success(t('toast.settingsSaved'));
        } catch (e) {
            toast.error(errorMessage(e, t('toast.saveFailed')));
        }
    };

    const refreshRates = async () => {
        try {
            await mutations.refresh.mutateAsync();
            toast.success(t('toast.refreshed'));
        } catch (e) {
            toast.error(errorMessage(e, t('toast.refreshFailed')));
        }
    };

    return (
        <MyDialog
            heading={t('title', { name: paymentOptionName })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-4xl"
            footer={
                <MyButton buttonType="secondary" onClick={() => onOpenChange(false)}>
                    {t('actions.close')}
                </MyButton>
            }
        >
            {isLoading ? (
                <div className="space-y-4">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-40 w-full" />
                </div>
            ) : isError || !data ? (
                <Alert variant="destructive">
                    <WarningCircle className="size-4" />
                    <AlertDescription className="flex items-center justify-between gap-4">
                        {t('error.load')}
                        <MyButton buttonType="secondary" scale="small" onClick={() => refetch()}>
                            {t('actions.retry')}
                        </MyButton>
                    </AlertDescription>
                </Alert>
            ) : (
                <div className="space-y-6">
                    <section className="space-y-2">
                        <h3 className="text-subtitle font-semibold text-neutral-800">
                            {t('steps.settings')}
                        </h3>
                        <Card>
                            <CardContent className="space-y-4 p-4">
                                <RegionalPricingSettingsFields
                                    enabled={enabled}
                                    onEnabledChange={setEnabled}
                                    currencies={currencies}
                                    onCurrenciesChange={setCurrencies}
                                    baseCurrency={baseCurrency}
                                    idPrefix="regional-dialog"
                                />
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-caption text-neutral-500">
                                        {data.rates_fetched_at
                                            ? t('settings.ratesFetched', {
                                                  date: new Date(
                                                      data.rates_fetched_at
                                                  ).toLocaleString(i18n.language),
                                              })
                                            : t('settings.ratesNever')}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <MyButton
                                            buttonType="text"
                                            scale="medium"
                                            onAsyncClick={refreshRates}
                                            loadingText={t('actions.refreshing')}
                                            disable={!data.enabled}
                                        >
                                            <ArrowsClockwise className="size-4" />
                                            {t('actions.refresh')}
                                        </MyButton>
                                        <MyButton
                                            buttonType="primary"
                                            scale="medium"
                                            onAsyncClick={saveSettings}
                                            loadingText={t('actions.saving')}
                                            disable={!settingsDirty}
                                        >
                                            {t('actions.saveSettings')}
                                        </MyButton>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </section>

                    <section className="space-y-2">
                        <h3 className="text-subtitle font-semibold text-neutral-800">
                            {t('steps.prices')}
                        </h3>
                        <p className="text-caption text-neutral-500">{t('plans.explain')}</p>
                        {!data.enabled && (
                            <Alert>
                                <WarningCircle className="size-4" />
                                <AlertDescription className="text-caption">
                                    {t('plans.offNote')}
                                </AlertDescription>
                            </Alert>
                        )}
                        {data.plans.length === 0 ? (
                            <p className="text-body text-neutral-500">{t('plans.empty')}</p>
                        ) : (
                            data.plans.map((plan) => (
                                <PlanRegionalPrices
                                    key={plan.payment_plan_id}
                                    plan={plan}
                                    paymentOptionId={paymentOptionId}
                                />
                            ))
                        )}
                    </section>
                </div>
            )}
        </MyDialog>
    );
};

const PlanRegionalPrices = ({
    plan,
    paymentOptionId,
}: {
    plan: RegionalPricingPlanApi;
    paymentOptionId: string;
}) => {
    const { t, i18n } = useTranslation('settingsRegionalPricing');
    const currencyWide = plan.regional_prices.filter((r) => !r.country_code);
    const perCountry = plan.regional_prices.filter((r) => r.country_code);
    return (
        <Card>
            <CardHeader className="p-4 pb-2">
                <CardTitle className="text-title flex flex-wrap items-baseline justify-between gap-2">
                    <span>{plan.name}</span>
                    <span className="text-body font-regular text-neutral-500">
                        {t('plans.basePrice', {
                            price: formatMoney(
                                plan.base_actual_price,
                                plan.base_currency,
                                i18n.language
                            ),
                        })}
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0">
                {plan.base_actual_price <= 0 ? (
                    <p className="text-caption text-neutral-500">{t('plans.freePlan')}</p>
                ) : (
                    <>
                        <div className="space-y-2">
                            <p className="text-caption font-semibold uppercase text-neutral-500">
                                {t('plans.byCurrency')}
                            </p>
                            {currencyWide.length === 0 ? (
                                <p className="text-caption text-neutral-500">
                                    {t('plans.noCurrencyPrices')}
                                </p>
                            ) : (
                                currencyWide.map((row) => (
                                    <RegionalPriceRow
                                        key={row.id}
                                        row={row}
                                        paymentOptionId={paymentOptionId}
                                    />
                                ))
                            )}
                        </div>
                        <div className="space-y-2">
                            <p className="text-caption font-semibold uppercase text-neutral-500">
                                {t('plans.byCountry')}
                            </p>
                            {perCountry.length === 0 && (
                                <p className="text-caption text-neutral-500">
                                    {t('plans.noCountryPrices')}
                                </p>
                            )}
                            {perCountry.map((row) => (
                                <RegionalPriceRow
                                    key={row.id}
                                    row={row}
                                    paymentOptionId={paymentOptionId}
                                />
                            ))}
                            <AddCountryPrice
                                plan={plan}
                                paymentOptionId={paymentOptionId}
                                usedCountries={perCountry.map((r) => r.country_code as string)}
                            />
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
};

const RegionalPriceRow = ({
    row,
    paymentOptionId,
}: {
    row: RegionalPriceApi;
    paymentOptionId: string;
}) => {
    const { t, i18n } = useTranslation('settingsRegionalPricing');
    const mutations = useRegionalPricingMutations(paymentOptionId);
    const [price, setPrice] = useState(String(row.actual_price));
    const [strike, setStrike] = useState(
        row.elevated_price != null ? String(row.elevated_price) : ''
    );
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        setPrice(String(row.actual_price));
        setStrike(row.elevated_price != null ? String(row.elevated_price) : '');
    }, [row.actual_price, row.elevated_price]);

    const dirty =
        price !== String(row.actual_price) ||
        strike !== (row.elevated_price != null ? String(row.elevated_price) : '');
    const priceNumber = Number(price);
    const priceInvalid = price.trim() === '' || !(priceNumber > 0);

    const region = row.country_code
        ? countryName(row.country_code, i18n.language)
        : t('row.allCountries', { currency: currencyLabel(row.currency, i18n.language) });
    const subtitle = row.country_code
        ? t('row.paidIn', { currency: currencyLabel(row.currency, i18n.language) })
        : null;

    const save = async () => {
        try {
            await mutations.upsert.mutateAsync({
                payment_plan_id: row.payment_plan_id,
                currency: row.currency,
                country_code: row.country_code ?? undefined,
                actual_price: priceNumber,
                elevated_price: strike.trim() === '' ? undefined : Number(strike),
            });
            toast.success(t('toast.priceSaved'));
        } catch (e) {
            toast.error(errorMessage(e, t('toast.saveFailed')));
        }
    };

    const run = async (action: () => Promise<unknown>, success: string) => {
        try {
            await action();
            toast.success(success);
        } catch (e) {
            toast.error(errorMessage(e, t('toast.saveFailed')));
        }
    };

    return (
        <div className="border-border flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
                <p className="text-body truncate font-semibold text-neutral-700">{region}</p>
                {subtitle && <p className="text-caption text-neutral-500">{subtitle}</p>}
                <div className="flex flex-wrap items-center gap-2">
                    {row.needs_review ? (
                        <StatusChip
                            text={t('source.review')}
                            textSize="text-caption"
                            status="WARNING"
                        />
                    ) : row.price_source === 'MANUAL' ? (
                        <StatusChip
                            text={t('source.manual')}
                            textSize="text-caption"
                            status="SUCCESS"
                        />
                    ) : (
                        <StatusChip
                            text={t('source.auto')}
                            textSize="text-caption"
                            status="INFO"
                            showIcon={false}
                        />
                    )}
                    {row.needs_review && (
                        <span className="text-caption text-warning-700">{t('row.reviewHint')}</span>
                    )}
                </div>
            </div>
            <MyInput
                inputType="number"
                size="small"
                labelStyle="text-body"
                label={t('row.price', {
                    currency: `${getCurrencySymbol(row.currency)} ${row.currency}`,
                })}
                input={price}
                onChangeFunction={(e) => setPrice(e.target.value)}
                error={priceInvalid ? t('row.priceInvalid') : null}
                className="sm:w-32"
                min={0}
            />
            <MyInput
                inputType="number"
                size="small"
                labelStyle="text-body"
                label={t('row.strikePrice')}
                input={strike}
                onChangeFunction={(e) => setStrike(e.target.value)}
                className="sm:w-32"
                min={0}
            />
            <div className="flex flex-wrap items-center gap-1">
                {dirty && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onAsyncClick={save}
                        disable={priceInvalid}
                    >
                        {t('actions.save')}
                    </MyButton>
                )}
                {row.needs_review && (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onAsyncClick={() =>
                            run(() => mutations.markReviewed.mutateAsync(row.id), t('toast.kept'))
                        }
                    >
                        {t('actions.keep')}
                    </MyButton>
                )}
                {row.price_source === 'MANUAL' && (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onAsyncClick={() =>
                            run(() => mutations.resetToAuto.mutateAsync(row.id), t('toast.reset'))
                        }
                    >
                        {t('actions.resetToAuto')}
                    </MyButton>
                )}
                {row.country_code && (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        aria-label={t('actions.delete')}
                        onClick={() => setConfirmDelete(true)}
                    >
                        <Trash className="text-danger-600 size-4" />
                    </MyButton>
                )}
            </div>

            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('delete.title', { region })}</AlertDialogTitle>
                        <AlertDialogDescription>{t('delete.description')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() =>
                                run(() => mutations.remove.mutateAsync(row.id), t('toast.deleted'))
                            }
                        >
                            {t('actions.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

/**
 * Fixed price for one country: pick the country by name (searchable, with flag), its
 * currency is filled in from the country and can be changed, then type the price or let the
 * system convert it from the exchange rate.
 */
const AddCountryPrice = ({
    plan,
    paymentOptionId,
    usedCountries,
}: {
    plan: RegionalPricingPlanApi;
    paymentOptionId: string;
    usedCountries: string[];
}) => {
    const { t, i18n } = useTranslation('settingsRegionalPricing');
    const mutations = useRegionalPricingMutations(paymentOptionId);
    const [adding, setAdding] = useState(false);
    const [country, setCountry] = useState('');
    const [currency, setCurrency] = useState('');
    const [price, setPrice] = useState('');
    const [auto, setAuto] = useState(false);

    const countryOptions = useMemo(
        () =>
            COUNTRY_CODES.filter((c) => !usedCountries.includes(c))
                .map((c) => ({ code: c, name: countryName(c, i18n.language) }))
                .sort((a, b) => a.name.localeCompare(b.name, i18n.language))
                .map(({ code, name }) => ({
                    value: code,
                    label: name,
                    keywords: countryKeywords(code),
                })),
        [usedCountries, i18n.language]
    );

    const currencyOptions = useMemo(() => {
        const codes = new Set(CURRENCIES.map((c) => c.code));
        const own = country ? currencyOfCountry(country) : undefined;
        if (own) codes.add(own);
        codes.add(plan.base_currency);
        return [...codes]
            .map((c) => ({ value: c, label: currencyLabel(c, i18n.language) }))
            .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
    }, [country, plan.base_currency, i18n.language]);

    const pickCountry = (code: string) => {
        setCountry(code);
        // The country's own currency by default; the admin can still pick another one.
        setCurrency(currencyOfCountry(code) ?? plan.base_currency);
    };

    const priceInvalid = !auto && !(Number(price) > 0);
    const canSave = !!country && !!currency && !priceInvalid;

    const reset = () => {
        setAdding(false);
        setCountry('');
        setCurrency('');
        setPrice('');
        setAuto(false);
    };

    const add = async () => {
        try {
            await mutations.upsert.mutateAsync({
                payment_plan_id: plan.payment_plan_id,
                country_code: country,
                currency,
                actual_price: auto ? undefined : Number(price),
                auto,
            });
            toast.success(t('toast.priceSaved'));
            reset();
        } catch (e) {
            toast.error(errorMessage(e, t('toast.saveFailed')));
        }
    };

    if (!adding) {
        return (
            <MyButton buttonType="text" scale="small" onClick={() => setAdding(true)}>
                <Plus className="size-4" />
                {t('add.button')}
            </MyButton>
        );
    }

    return (
        <div className="border-border space-y-3 rounded-md border border-dashed p-3">
            <p className="text-body flex items-center gap-2 font-semibold text-neutral-700">
                <GlobeHemisphereEast className="size-4" />
                {t('add.title')}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                    <Label className="text-body">{t('add.country')}</Label>
                    <SearchableSelect
                        options={countryOptions}
                        value={country}
                        onChange={pickCountry}
                        placeholder={t('add.countryPlaceholder')}
                        searchPlaceholder={t('add.countrySearch')}
                        emptyText={t('add.countryEmpty')}
                        portal={false}
                        filter={prefixFirstFilter}
                    />
                </div>
                <div className="space-y-1">
                    <Label className="text-body">{t('add.currency')}</Label>
                    <SearchableSelect
                        options={currencyOptions}
                        value={currency}
                        onChange={setCurrency}
                        placeholder={t('add.currencyPlaceholder')}
                        searchPlaceholder={t('add.currencySearch')}
                        emptyText={t('add.currencyEmpty')}
                        disabled={!country}
                        portal={false}
                        filter={prefixFirstFilter}
                    />
                    {country && (
                        <p className="text-caption text-neutral-500">
                            {t('add.currencyHint', {
                                country: countryName(country, i18n.language),
                            })}
                        </p>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-2">
                <Checkbox
                    id={`auto-${plan.payment_plan_id}`}
                    checked={auto}
                    onCheckedChange={(v) => setAuto(v === true)}
                />
                <Label htmlFor={`auto-${plan.payment_plan_id}`} className="text-body">
                    {t('add.auto')}
                </Label>
            </div>
            {!auto && (
                <MyInput
                    inputType="number"
                    size="small"
                    labelStyle="text-body"
                    label={t('add.price', {
                        currency: currency ? `${getCurrencySymbol(currency)} ${currency}` : '',
                    })}
                    input={price}
                    onChangeFunction={(e) => setPrice(e.target.value)}
                    className="sm:w-40"
                    min={0}
                    disabled={!country}
                />
            )}
            <div className="flex items-center gap-2">
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onAsyncClick={add}
                    disable={!canSave}
                >
                    {t('add.save')}
                </MyButton>
                <MyButton buttonType="text" scale="small" onClick={reset}>
                    {t('actions.cancel')}
                </MyButton>
            </div>
        </div>
    );
};
