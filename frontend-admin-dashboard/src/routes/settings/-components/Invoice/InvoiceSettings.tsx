import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Check,
    CaretUpDown,
    FileText,
    Hash,
    Plus,
    Trash,
    Receipt,
    Percent,
} from '@phosphor-icons/react';
import {
    SettingsPageShell,
    SettingsSectionsLayout,
    type SettingsSectionGroup,
} from '@/components/settings/shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { COUNTRIES, countryCodeToFlag, findCountry } from '../../-utils/countries';
import {
    CURRENCY_OPTIONS,
    COUNTRY_TAX_PRESETS,
    COUNTRY_DEFAULT_CURRENCY,
    DEFAULT_INVOICE_SETTINGS,
    PACKAGE_TYPES,
    fetchInvoiceAdminOptions,
    fetchInvoiceNumberingState,
    fetchInvoiceSettings,
    saveInvoiceSettings,
    type InvoiceSettingsData,
    type InvoiceNumberingConfig,
    type TaxComponent,
} from './invoice-settings-service';
import { InvoiceTemplatesSection } from './InvoiceTemplatesSection';
import { InvoiceNumberingSection } from './InvoiceNumberingSection';
import { InvoiceSeriesSection, seriesErrors, seriesValueOf } from './InvoiceSeriesSection';
import { InvoiceNumberingChangeDialog } from './InvoiceNumberingChangeDialog';

function getInjectablePlaceholders(
    t: TFunction
): Array<{ tag: string; description: string }> {
    return [
        { tag: '{{country}}', description: t('injectablePlaceholders.country') },
        { tag: '{{country_code}}', description: t('injectablePlaceholders.countryCode') },
        {
            tag: '{{tax_registration_number}}',
            description: t('injectablePlaceholders.taxRegistrationNumber'),
        },
        { tag: '{{hsn_code}}', description: t('injectablePlaceholders.hsnCode') },
        {
            tag: '{{tax_components}}',
            description: t('injectablePlaceholders.taxComponents'),
        },
        { tag: '{{tax_label}}', description: t('injectablePlaceholders.taxLabel') },
        { tag: '{{tax_rate}}', description: t('injectablePlaceholders.taxRate') },
    ];
}

function CountryCombobox({
    code,
    onSelect,
}: {
    code: string;
    onSelect: (code: string, name: string) => void;
}) {
    const { t } = useTranslation('settingsInvoice');
    const [open, setOpen] = useState(false);
    const selected = code ? findCountry(code) : undefined;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="flex h-9 w-full max-w-sm items-center justify-between rounded-md border border-slate-200 bg-white px-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                    {selected ? (
                        <span className="flex items-center gap-2">
                            <span className="text-base leading-none">
                                {countryCodeToFlag(selected.code)}
                            </span>
                            <span>{selected.name}</span>
                            <span className="text-xs uppercase text-slate-400">{selected.code}</span>
                        </span>
                    ) : (
                        <span className="text-slate-500">
                            {t('countryCombobox.selectPlaceholder')}
                        </span>
                    )}
                    <CaretUpDown className="size-4 text-slate-400" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
                <Command>
                    <CommandInput
                        placeholder={t('countryCombobox.searchPlaceholder')}
                        className="h-9"
                    />
                    <CommandList className="max-h-64">
                        <CommandEmpty>{t('countryCombobox.noResults')}</CommandEmpty>
                        <CommandGroup>
                            {COUNTRIES.map((country) => {
                                const checked = country.code === code;
                                return (
                                    <CommandItem
                                        key={country.code}
                                        value={`${country.name} ${country.nameFull} ${country.code} ${country.dialCode}`}
                                        onSelect={() => {
                                            onSelect(country.code, country.name);
                                            setOpen(false);
                                        }}
                                        className="flex items-center gap-2"
                                    >
                                        <Check
                                            className={cn(
                                                'size-4',
                                                checked ? 'opacity-100 text-blue-600' : 'opacity-0'
                                            )}
                                        />
                                        <span className="text-base leading-none">
                                            {countryCodeToFlag(country.code)}
                                        </span>
                                        <span className="flex-1 truncate text-sm">
                                            {country.name}
                                        </span>
                                        <span className="text-xs uppercase text-slate-400">
                                            {country.code}
                                        </span>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function AdminCopyMultiSelect({
    selectedIds,
    onChange,
}: {
    selectedIds: string[];
    onChange: (ids: string[]) => void;
}) {
    const { t } = useTranslation('settingsInvoice');
    const [open, setOpen] = useState(false);
    const { data: admins = [], isLoading } = useQuery({
        queryKey: ['invoice-admin-copy-options'],
        queryFn: fetchInvoiceAdminOptions,
        staleTime: 5 * 60 * 1000,
    });

    const toggle = (id: string) =>
        onChange(
            selectedIds.includes(id)
                ? selectedIds.filter((x) => x !== id)
                : [...selectedIds, id]
        );

    const selectedAdmins = admins.filter((a) => selectedIds.includes(a.id));

    return (
        <div className="space-y-2">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="flex h-9 w-full max-w-sm items-center justify-between rounded-md border border-slate-200 bg-white px-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                        {selectedIds.length > 0 ? (
                            <span>
                                {t('adminSelect.selectedCount', { count: selectedIds.length })}
                            </span>
                        ) : (
                            <span className="text-slate-500">
                                {t('adminSelect.selectPlaceholder')}
                            </span>
                        )}
                        <CaretUpDown className="size-4 text-slate-400" />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-[360px] p-0" align="start">
                    <Command>
                        <CommandInput
                            placeholder={t('adminSelect.searchPlaceholder')}
                            className="h-9"
                        />
                        <CommandList className="max-h-64">
                            <CommandEmpty>
                                {isLoading
                                    ? t('adminSelect.loading')
                                    : t('adminSelect.noResults')}
                            </CommandEmpty>
                            <CommandGroup>
                                {admins.map((admin) => {
                                    const checked = selectedIds.includes(admin.id);
                                    return (
                                        <CommandItem
                                            key={admin.id}
                                            value={`${admin.fullName} ${admin.email}`}
                                            onSelect={() => toggle(admin.id)}
                                            className="flex items-center gap-2"
                                        >
                                            <Check
                                                className={cn(
                                                    'size-4',
                                                    checked
                                                        ? 'opacity-100 text-blue-600'
                                                        : 'opacity-0'
                                                )}
                                            />
                                            <span className="flex-1 truncate text-sm">
                                                {admin.fullName || admin.email}
                                            </span>
                                            <span className="max-w-[150px] truncate text-xs text-slate-400">
                                                {admin.email}
                                            </span>
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            {selectedAdmins.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {selectedAdmins.map((admin) => (
                        <span
                            key={admin.id}
                            className="inline-flex items-center gap-1 rounded-full border bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
                        >
                            {admin.fullName || admin.email}
                            <button
                                type="button"
                                className="text-slate-400 hover:text-slate-600"
                                onClick={() => toggle(admin.id)}
                                title={t('adminSelect.remove')}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function TaxComponentEditor({
    components,
    onChange,
    emptyHint,
}: {
    components: TaxComponent[];
    onChange: (next: TaxComponent[]) => void;
    emptyHint?: string;
}) {
    const { t } = useTranslation('settingsInvoice');
    const update = (i: number, patch: Partial<TaxComponent>) =>
        onChange(components.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
    const add = () => onChange([...components, { label: '', rate: 0 }]);
    const remove = (i: number) => onChange(components.filter((_, idx) => idx !== i));

    return (
        <div className="space-y-2">
            {components.length === 0 ? (
                <p className="rounded-md border border-dashed bg-slate-50/50 px-3 py-2 text-xs italic text-slate-400">
                    {emptyHint ?? t('taxComponentEditor.emptyDefault')}
                </p>
            ) : (
                components.map((comp, index) => (
                    <div key={index} className="flex items-center gap-2">
                        <Input
                            className="max-w-[200px]"
                            placeholder={t('taxComponentEditor.labelPlaceholder')}
                            value={comp.label}
                            onChange={(e) => update(index, { label: e.target.value })}
                        />
                        <div className="relative w-28">
                            <Input
                                type="number"
                                min={0}
                                step="0.01"
                                className="pr-7"
                                placeholder={t('taxComponentEditor.ratePlaceholder')}
                                value={String(comp.rate)}
                                onChange={(e) => update(index, { rate: parseFloat(e.target.value) || 0 })}
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                %
                            </span>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="p-2 text-destructive hover:text-destructive"
                            onClick={() => remove(index)}
                            title={t('taxComponentEditor.removeTitle')}
                        >
                            <Trash className="size-4" />
                        </Button>
                    </div>
                ))
            )}
            <Button variant="outline" size="sm" className="mt-1" onClick={add}>
                <Plus className="mr-2 size-4" />
                {t('taxComponentEditor.addButton')}
            </Button>
        </div>
    );
}

function getInvoiceSettingsSections(t: TFunction): SettingsSectionGroup[] {
    return [
        {
            sections: [
                { id: 'grp-general', label: t('sections.general'), icon: Receipt },
                { id: 'grp-numbering', label: t('sections.numbering'), icon: Hash },
                { id: 'grp-tax', label: t('sections.tax'), icon: Percent },
                { id: 'grp-templates', label: t('sections.templates'), icon: FileText },
            ],
        },
    ];
}

/** Tokens that make numbering non-sequential — these escalate the save warning. */
const RISKY_TOKEN_PATTERN =
    /\{\{\s*(learner_name|learner_initials|learner_state|enrollment_no|plan_name|course_name|level_name|session_name)\b/;

const numberingChanged = (a: InvoiceNumberingConfig, b: InvoiceNumberingConfig) =>
    a.format !== b.format ||
    a.seqPadding !== b.seqPadding ||
    a.seqScope !== b.seqScope ||
    a.instituteCode !== b.instituteCode ||
    a.fyStartMonth !== b.fyStartMonth ||
    a.sanitizeTokens !== b.sanitizeTokens ||
    a.startFrom !== b.startFrom;

export default function InvoiceSettings() {
    const { t } = useTranslation('settingsInvoice');
    const { t: tSeries } = useTranslation('settingsInvoiceSeries');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<InvoiceSettingsData>(DEFAULT_INVOICE_SETTINGS);
    const [hasChanges, setHasChanges] = useState(false);
    const [selectedPkgType, setSelectedPkgType] = useState<string>(PACKAGE_TYPES[0]);
    const [numberingConfirmOpen, setNumberingConfirmOpen] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['invoice-settings'],
        queryFn: fetchInvoiceSettings,
        staleTime: 5 * 60 * 1000,
    });

    // How many invoices already exist — decides whether changing numbering needs a warning.
    const { data: numberingState } = useQuery({
        queryKey: ['invoice-numbering-state'],
        queryFn: fetchInvoiceNumberingState,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveInvoiceSettings,
        onSuccess: () => {
            toast.success(t('toasts.saved'));
            setHasChanges(false);
            setNumberingConfirmOpen(false);
            queryClient.invalidateQueries({ queryKey: ['invoice-settings'] });
            // The next number / current example both move once a new strategy is live.
            queryClient.invalidateQueries({ queryKey: ['invoice-numbering-state'] });
        },
        onError: () => toast.error(t('toasts.saveFailed')),
    });

    /**
     * Changing the number strategy is confirmed separately: it silently alters every future
     * invoice number, and once issued a number can't be changed. Only gate when the institute
     * actually has invoices — the first-time setup case needs no warning.
     */
    const numberingIsDirty = data ? numberingChanged(data.numbering, settings.numbering) : false;
    const numberingIsRisky =
        RISKY_TOKEN_PATTERN.test(settings.numbering.format) ||
        (data ? data.numbering.seqScope !== settings.numbering.seqScope : false);

    const handleSave = () => {
        // A half-filled receipt-series set-up would number nobody differently; say what is missing.
        const seriesProblems = seriesErrors(seriesValueOf(settings), tSeries);
        if (seriesProblems.length) {
            toast.error(seriesProblems[0]);
            return;
        }
        if (numberingIsDirty && (numberingState?.existingInvoiceCount ?? 0) > 0) {
            setNumberingConfirmOpen(true);
            return;
        }
        save(settings);
    };

    const update = (patch: Partial<InvoiceSettingsData>) => {
        setSettings((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };

    const updateCountry = (patch: Partial<InvoiceSettingsData['country']>) => {
        setSettings((prev) => ({ ...prev, country: { ...prev.country, ...patch } }));
        setHasChanges(true);
    };

    const updateTypeComponents = (type: string, next: TaxComponent[]) => {
        setSettings((prev) => ({
            ...prev,
            country: {
                ...prev.country,
                taxComponentsByPackageType: {
                    ...prev.country.taxComponentsByPackageType,
                    [type]: next,
                },
            },
        }));
        setHasChanges(true);
    };

    const handleCountrySelect = (code: string, name: string) => {
        setSettings((prev) => {
            const next: InvoiceSettingsData = {
                ...prev,
                country: { ...prev.country, code, name },
            };
            // Apply suggested tax components + currency only when nothing is configured yet,
            // so we never clobber an admin's existing edits.
            const preset = COUNTRY_TAX_PRESETS[code];
            if (prev.country.taxComponents.length === 0 && preset) {
                next.country.taxComponents = preset.map((c) => ({ ...c }));
                const suggestedCurrency = COUNTRY_DEFAULT_CURRENCY[code];
                if (suggestedCurrency) {
                    next.currency = suggestedCurrency;
                }
            }
            return next;
        });
        setHasChanges(true);
    };

    const updateTaxComponent = (index: number, patch: Partial<TaxComponent>) => {
        setSettings((prev) => {
            const components = prev.country.taxComponents.map((c, i) =>
                i === index ? { ...c, ...patch } : c
            );
            return { ...prev, country: { ...prev.country, taxComponents: components } };
        });
        setHasChanges(true);
    };

    const addTaxComponent = () => {
        setSettings((prev) => ({
            ...prev,
            country: {
                ...prev.country,
                taxComponents: [...prev.country.taxComponents, { label: '', rate: 0 }],
            },
        }));
        setHasChanges(true);
    };

    const removeTaxComponent = (index: number) => {
        setSettings((prev) => ({
            ...prev,
            country: {
                ...prev.country,
                taxComponents: prev.country.taxComponents.filter((_, i) => i !== index),
            },
        }));
        setHasChanges(true);
    };

    const totalConfiguredTax = useMemo(
        () => settings.country.taxComponents.reduce((sum, c) => sum + (Number(c.rate) || 0), 0),
        [settings.country.taxComponents]
    );

    if (isLoading) {
        return (
            <div className="p-6 text-sm text-muted-foreground">{t('page.loading')}</div>
        );
    }

    const invoiceSettingsSections = getInvoiceSettingsSections(t);
    const injectablePlaceholders = getInjectablePlaceholders(t);

    return (
        <SettingsPageShell
            title={t('page.title')}
            description={t('page.description')}
            maxWidth="max-w-7xl"
            dirty={hasChanges}
            saving={saving}
            onSave={handleSave}
            onDiscard={() => {
                if (data) {
                    setSettings(data);
                    setHasChanges(false);
                }
            }}
            saveLabel={t('page.saveLabel')}
        >
            <SettingsSectionsLayout groups={invoiceSettingsSections}>
            <section id="grp-general" className="space-y-6">
            {/* General invoice options */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t('general.title')}</CardTitle>
                    <CardDescription>{t('general.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                        {/* Currency */}
                        <div className="space-y-1.5">
                            <Label htmlFor="invoice-currency">{t('general.currency.label')}</Label>
                            <Select
                                value={settings.currency}
                                onValueChange={(v) => update({ currency: v })}
                            >
                                <SelectTrigger id="invoice-currency" className="max-w-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CURRENCY_OPTIONS.map((c) => (
                                        <SelectItem key={c.code} value={c.code}>
                                            {c.symbol} {c.code} — {c.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Tax label */}
                        <div className="space-y-1.5">
                            <Label htmlFor="invoice-tax-label">
                                {t('general.taxLabel.label')}
                            </Label>
                            <Input
                                id="invoice-tax-label"
                                className="max-w-xs"
                                placeholder={t('general.taxLabel.placeholder')}
                                value={settings.taxLabel}
                                onChange={(e) => update({ taxLabel: e.target.value })}
                            />
                        </div>

                        {/* Tax rate */}
                        <div className="space-y-1.5">
                            <Label htmlFor="invoice-tax-rate">
                                {t('general.taxRate.label')}
                            </Label>
                            <Input
                                id="invoice-tax-rate"
                                type="number"
                                min={0}
                                step="0.01"
                                className="max-w-xs"
                                value={String(settings.taxRate)}
                                onChange={(e) =>
                                    update({ taxRate: parseFloat(e.target.value) || 0 })
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                {t('general.taxRate.hint')}
                            </p>
                        </div>
                    </div>

                    {/* Toggles */}
                    <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                            <Label htmlFor="invoice-tax-included" className="cursor-pointer">
                                {t('general.taxIncluded.label')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {t('general.taxIncluded.hint')}
                            </p>
                        </div>
                        <Switch
                            id="invoice-tax-included"
                            checked={settings.taxIncluded}
                            onCheckedChange={(v) => update({ taxIncluded: v })}
                        />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                            <Label htmlFor="invoice-send-email" className="cursor-pointer">
                                {t('general.sendEmail.label')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {t('general.sendEmail.hint')}
                            </p>
                        </div>
                        <Switch
                            id="invoice-send-email"
                            checked={settings.sendInvoiceEmail}
                            onCheckedChange={(v) => update({ sendInvoiceEmail: v })}
                        />
                    </div>

                    <div className="space-y-1.5 rounded-lg border p-3">
                        <Label htmlFor="invoice-pdf-placement">
                            {t('general.pdfPlacement.label')}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            {t('general.pdfPlacement.hint')}
                        </p>
                        <Select
                            value={settings.invoicePdfPlacement}
                            onValueChange={(v) =>
                                update({
                                    invoicePdfPlacement: v as InvoiceSettingsData['invoicePdfPlacement'],
                                })
                            }
                        >
                            <SelectTrigger id="invoice-pdf-placement" className="max-w-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="INVOICE_EMAIL">
                                    {t('general.pdfPlacement.optionSeparate')}
                                </SelectItem>
                                <SelectItem value="PAYMENT_CONFIRMATION_EMAIL">
                                    {t('general.pdfPlacement.optionAttach')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-3 rounded-lg border p-3">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor="invoice-admin-copy" className="cursor-pointer">
                                    {t('general.adminCopy.label')}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {t('general.adminCopy.hint')}
                                </p>
                            </div>
                            <Switch
                                id="invoice-admin-copy"
                                checked={settings.sendAdminCopy}
                                onCheckedChange={(v) => update({ sendAdminCopy: v })}
                            />
                        </div>
                        {settings.sendAdminCopy && (
                            <div className="space-y-1.5">
                                <Label>{t('general.adminCopy.adminsToCopy')}</Label>
                                <AdminCopyMultiSelect
                                    selectedIds={settings.adminCopyUserIds}
                                    onChange={(ids) => update({ adminCopyUserIds: ids })}
                                />
                            </div>
                        )}
                    </div>

                    <div className="space-y-3 rounded-lg border p-3">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor="invoice-proforma" className="cursor-pointer">
                                    {t('general.proforma.label')}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {t('general.proforma.hint')}
                                </p>
                            </div>
                            <Switch
                                id="invoice-proforma"
                                checked={settings.proformaEnabled}
                                onCheckedChange={(v) => update({ proformaEnabled: v })}
                            />
                        </div>
                        {settings.proformaEnabled && (
                            <p className="rounded-md bg-warning-50 p-2 text-xs text-warning-700">
                                {t('general.proforma.warningPrefix')}{' '}
                                <span className="font-medium">
                                    {settings.numbering.format.includes('{{doc_type}}')
                                        ? t('general.proforma.usingProDocType')
                                        : `PRO-${settings.numbering.format}`}
                                </span>{' '}
                                {t('general.proforma.warningSuffix')}
                            </p>
                        )}
                    </div>

                    <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                            <Label htmlFor="invoice-manual-enroll" className="cursor-pointer">
                                {t('general.manualEnroll.label')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {t('general.manualEnroll.hint')}
                            </p>
                        </div>
                        <Switch
                            id="invoice-manual-enroll"
                            checked={settings.generateInvoiceOnManualEnroll}
                            onCheckedChange={(v) => update({ generateInvoiceOnManualEnroll: v })}
                        />
                    </div>
                </CardContent>
            </Card>
            </section>

            <section id="grp-numbering" className="space-y-6">
            <InvoiceNumberingSection
                value={settings.numbering}
                onChange={(patch) =>
                    update({ numbering: { ...settings.numbering, ...patch } })
                }
            />
            <InvoiceSeriesSection
                value={seriesValueOf(settings)}
                onChange={(next) => update({ numberingSeries: next.series, numberingSeriesPolicy: next.policy })}
                defaultFormat={settings.numbering.format}
            />
            </section>

            <section id="grp-tax" className="space-y-6">
            {/* Country & tax components */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t('tax.title')}</CardTitle>
                    <CardDescription>{t('tax.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>{t('tax.country.label')}</Label>
                            <CountryCombobox
                                code={settings.country.code}
                                onSelect={handleCountrySelect}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="invoice-tax-reg-no">
                                {t('tax.taxRegNumber.label')}
                            </Label>
                            <Input
                                id="invoice-tax-reg-no"
                                className="max-w-xs"
                                placeholder={t('tax.taxRegNumber.placeholder')}
                                value={settings.country.taxRegistrationNumber}
                                onChange={(e) =>
                                    updateCountry({ taxRegistrationNumber: e.target.value })
                                }
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="invoice-hsn-sac">{t('tax.hsnSac.label')}</Label>
                            <Input
                                id="invoice-hsn-sac"
                                className="max-w-xs"
                                placeholder={t('tax.hsnSac.placeholder')}
                                value={settings.country.hsnSacCode}
                                onChange={(e) => updateCountry({ hsnSacCode: e.target.value })}
                            />
                            <p className="text-xs text-muted-foreground">
                                {t('tax.hsnSac.hint')}
                            </p>
                        </div>
                    </div>

                    {/* Tax components editor */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>{t('tax.components.label')}</Label>
                            {settings.country.taxComponents.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                    {t('tax.components.total', { total: totalConfiguredTax })}
                                </span>
                            )}
                        </div>

                        {settings.country.taxComponents.length === 0 ? (
                            <p className="rounded-md border border-dashed bg-slate-50/50 px-3 py-2 text-xs italic text-slate-400">
                                {t('tax.components.empty')}
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {settings.country.taxComponents.map((comp, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <Input
                                            className="max-w-[200px]"
                                            placeholder={t('tax.components.labelPlaceholder')}
                                            value={comp.label}
                                            onChange={(e) =>
                                                updateTaxComponent(index, { label: e.target.value })
                                            }
                                        />
                                        <div className="relative w-28">
                                            <Input
                                                type="number"
                                                min={0}
                                                step="0.01"
                                                className="pr-7"
                                                placeholder={t('tax.components.ratePlaceholder')}
                                                value={String(comp.rate)}
                                                onChange={(e) =>
                                                    updateTaxComponent(index, {
                                                        rate: parseFloat(e.target.value) || 0,
                                                    })
                                                }
                                            />
                                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                                %
                                            </span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="p-2 text-destructive hover:text-destructive"
                                            onClick={() => removeTaxComponent(index)}
                                            title={t('tax.components.removeTitle')}
                                        >
                                            <Trash className="size-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-1"
                            onClick={addTaxComponent}
                        >
                            <Plus className="mr-2 size-4" />
                            {t('tax.components.addButton')}
                        </Button>
                    </div>

                    {/* Tax components by package type */}
                    <div className="space-y-2 rounded-lg border p-3">
                        <Label>{t('tax.byPackageType.label')}</Label>
                        <p className="text-xs text-muted-foreground">
                            {t('tax.byPackageType.description')}
                        </p>
                        <Select value={selectedPkgType} onValueChange={setSelectedPkgType}>
                            <SelectTrigger className="max-w-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PACKAGE_TYPES.map((pkgType) => {
                                    const count =
                                        settings.country.taxComponentsByPackageType[pkgType]
                                            ?.length ?? 0;
                                    return (
                                        <SelectItem key={pkgType} value={pkgType}>
                                            {pkgType}
                                            {count > 0 ? ` (${count})` : ''}
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                        <TaxComponentEditor
                            components={
                                settings.country.taxComponentsByPackageType[selectedPkgType] ?? []
                            }
                            onChange={(next) => updateTypeComponents(selectedPkgType, next)}
                            emptyHint={t('tax.byPackageType.emptyOverride', {
                                packageType: selectedPkgType,
                            })}
                        />
                    </div>

                    {/* Injectable placeholders reference */}
                    <div className="rounded-lg border bg-slate-50/60 p-3">
                        <p className="mb-2 text-xs font-semibold text-slate-600">
                            {t('injectablePlaceholders.sectionTitle')}
                        </p>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                            {injectablePlaceholders.map((p) => (
                                <div key={p.tag} className="flex items-center gap-2 text-xs">
                                    <code className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-slate-700">
                                        {p.tag}
                                    </code>
                                    <span className="text-slate-500">{p.description}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </CardContent>
            </Card>
            </section>

            <section id="grp-templates" className="space-y-6">
            <InvoiceTemplatesSection type="INVOICE" />
            <InvoiceTemplatesSection type="INVOICE_EMAIL" />
            </section>
            </SettingsSectionsLayout>

            <InvoiceNumberingChangeDialog
                open={numberingConfirmOpen}
                next={settings.numbering}
                requiresTypedConfirmation={numberingIsRisky}
                saving={saving}
                onCancel={() => setNumberingConfirmOpen(false)}
                onConfirm={() => save(settings)}
            />
        </SettingsPageShell>
    );
}
