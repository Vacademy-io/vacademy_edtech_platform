/**
 * Settings → Invoice → Numbering → Receipt series by field: number receipts from a separate
 * counter per value of a learner field (e.g. one series per branch). The field is asked on
 * the first recorded payment of each enrolment and pinned there, so every later installment
 * of that course stays in the same series. Learners matching no series use the default
 * numbering above. Off until an admin turns it on.
 *
 * Stored as INVOICE_SETTING.numberingSeries / numberingSeriesPolicy; read by
 * InvoiceNumberConfig and NumberingFieldService on the backend.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Plus, Trash, TreeStructure } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getCustomFieldSettings } from '@/services/custom-field-settings';
import type { InvoiceNumberingSeries, InvoiceNumberingSeriesPolicy } from './invoice-settings-service';

export interface SeriesValue {
    series: InvoiceNumberingSeries[];
    policy: InvoiceNumberingSeriesPolicy;
}

interface Props {
    value: SeriesValue;
    onChange: (next: SeriesValue) => void;
    /** The default numbering format, shown so the admin sees where unmatched learners go. */
    defaultFormat: string;
}

/**
 * The section's value from saved settings. A set-up saved without a policy (older data) takes
 * its field from the first series, so it validates and an unrelated save is never blocked.
 */
export const seriesValueOf = (settings: {
    numberingSeries?: InvoiceNumberingSeries[];
    numberingSeriesPolicy?: InvoiceNumberingSeriesPolicy;
}): SeriesValue => {
    const series = settings.numberingSeries ?? [];
    const policy = settings.numberingSeriesPolicy ?? { askOnFirstPayment: false, required: false };
    return { series, policy: { ...policy, fieldId: policy.fieldId || series[0]?.learnerFieldId || null } };
};

/** "Branch B East" → BRANCH_B_EAST, at most 16, unique among `taken`. */
const keyFrom = (label: string, taken: string[]): string => {
    const base = (label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SERIES').slice(0, 16);
    let key = base;
    for (let i = 2; taken.includes(key); i++) key = `${base.slice(0, 16 - String(i).length - 1)}_${i}`;
    return key;
};

/**
 * What blocks saving, as translated messages; empty when the series can be saved.
 * Exported so the settings page can refuse to save a half-filled set-up.
 */
export const seriesErrors = (value: SeriesValue, t: TFunction): string[] => {
    if (!value.series.length) return [];
    const errors: string[] = [];
    if (!value.policy.fieldId) errors.push(t('errors.field'));
    const seen = new Set<string>();
    value.series.forEach((s, i) => {
        const n = i + 1;
        if (!s.values.length) errors.push(t('errors.values', { n }));
        if (!s.format.includes('{{seq')) errors.push(t('errors.format', { n, token: '{{seq}}' }));
        for (const v of s.values) {
            if (seen.has(v.toLowerCase())) errors.push(t('errors.duplicateValue', { value: v }));
            seen.add(v.toLowerCase());
        }
    });
    return errors;
};

export const InvoiceSeriesSection = ({ value, onChange, defaultFormat }: Props) => {
    const { t } = useTranslation('settingsInvoiceSeries');
    const { data: fieldSettings, isLoading } = useQuery({
        queryKey: ['custom-field-settings-for-series'],
        queryFn: () => getCustomFieldSettings(),
        staleTime: 5 * 60 * 1000,
    });
    const choiceFields = [...(fieldSettings?.instituteFields ?? []), ...(fieldSettings?.customFields ?? [])]
        .filter((f, i, all) => (f.options?.length ?? 0) > 0 && all.findIndex((x) => x.id === f.id) === i);
    const field = choiceFields.find((f) => f.id === value.policy.fieldId);
    const enabled = value.series.length > 0;

    const setSeries = (series: InvoiceNumberingSeries[]) => onChange({ ...value, series });
    const setPolicy = (patch: Partial<InvoiceNumberingSeriesPolicy>) =>
        onChange({ ...value, policy: { ...value.policy, ...patch } });
    const updateSeries = (i: number, patch: Partial<InvoiceNumberingSeries>) =>
        setSeries(value.series.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    const blankSeries = (fieldId: string): InvoiceNumberingSeries => ({
        key: '',
        format: '',
        startFrom: 1,
        learnerFieldId: fieldId,
        values: [],
    });

    const toggle = (on: boolean) =>
        on
            ? onChange({
                  series: [blankSeries(value.policy.fieldId ?? '')],
                  policy: { askOnFirstPayment: true, required: true, fieldId: value.policy.fieldId ?? null },
              })
            : onChange({ series: [], policy: { ...value.policy, askOnFirstPayment: false } });

    const pickField = (fieldId: string) =>
        onChange({
            series: value.series.map((s) => ({ ...s, learnerFieldId: fieldId, values: [] })),
            policy: { ...value.policy, fieldId },
        });

    const toggleValue = (i: number, option: string, checked: boolean) => {
        const s = value.series[i];
        if (!s) return;
        const values = checked ? [...s.values, option] : s.values.filter((v) => v !== option);
        // The key names the counter, so once set it never changes; a new series takes it from
        // its first value.
        const taken = value.series.filter((_, j) => j !== i).map((x) => x.key);
        const key = s.key || (values[0] ? keyFrom(values[0], taken) : '');
        updateSeries(i, { values, key });
    };

    const errors = seriesErrors(value, t);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <TreeStructure className="size-5" />
                    {t('title')}
                </CardTitle>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="flex items-start gap-3">
                    <Switch id="invoice-series-enabled" checked={enabled} onCheckedChange={toggle} />
                    <div>
                        <Label htmlFor="invoice-series-enabled" className="cursor-pointer">
                            {t('enable.label')}
                        </Label>
                        <p className="mt-0.5 text-xs text-neutral-500">{t('enable.hint')}</p>
                    </div>
                </div>

                {enabled && (
                    <>
                        <div className="max-w-sm">
                            <Label className="mb-1 block text-xs text-neutral-500">{t('field.label')}</Label>
                            <Select value={value.policy.fieldId ?? ''} onValueChange={(v) => v && pickField(v)}>
                                <SelectTrigger className="bg-white">
                                    <SelectValue placeholder={isLoading ? t('field.loading') : t('field.placeholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {choiceFields.map((f) => (
                                        <SelectItem key={f.id} value={f.id}>
                                            {f.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="mt-1 text-xs text-neutral-500">{t('field.hint')}</p>
                        </div>

                        {field && (
                            <div className="flex flex-col gap-3">
                                {value.series.map((s, i) => (
                                    <div key={s.key || `new-${i}`} className="rounded-lg border border-neutral-200 p-3">
                                        <div className="mb-2 flex items-center justify-between">
                                            <p className="text-sm font-medium text-neutral-700">
                                                {t('series.heading', { n: i + 1 })}
                                            </p>
                                            {value.series.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setSeries(value.series.filter((_, j) => j !== i))}
                                                    aria-label={t('series.remove')}
                                                    className="text-neutral-500 hover:text-danger-600"
                                                >
                                                    <Trash className="size-4" />
                                                </button>
                                            )}
                                        </div>
                                        <p className="mb-1 text-xs text-neutral-500">
                                            {t('series.values', { field: field.name })}
                                        </p>
                                        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
                                            {(field.options ?? []).map((o) => (
                                                <label key={o} className="flex items-center gap-2 text-sm text-neutral-700">
                                                    <Checkbox
                                                        checked={s.values.includes(o)}
                                                        onCheckedChange={(v) => toggleValue(i, o, v === true)}
                                                    />
                                                    {o}
                                                </label>
                                            ))}
                                        </div>
                                        <div className="flex flex-wrap items-end gap-3">
                                            <div className="min-w-56 flex-1">
                                                <Label className="mb-1 block text-xs text-neutral-500">
                                                    {t('series.format')}
                                                </Label>
                                                <Input
                                                    value={s.format}
                                                    onChange={(e) => updateSeries(i, { format: e.target.value })}
                                                    placeholder={t('series.formatPlaceholder', { example: 'RCPT-B-{{seq}}' })}
                                                    className="bg-white"
                                                />
                                            </div>
                                            <div className="w-36">
                                                <Label className="mb-1 block text-xs text-neutral-500">
                                                    {t('series.startFrom')}
                                                </Label>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    value={s.startFrom || ''}
                                                    onChange={(e) =>
                                                        updateSeries(i, {
                                                            startFrom: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                                                        })
                                                    }
                                                    className="bg-white"
                                                />
                                            </div>
                                        </div>
                                        {s.format.includes('{{seq') && (
                                            <p className="mt-2 text-xs text-neutral-500">
                                                {t('series.example', {
                                                    example: s.format.replace(/\{\{seq(:\d+)?\}\}/g, String(s.startFrom || 1)),
                                                })}
                                            </p>
                                        )}
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setSeries([...value.series, blankSeries(field.id)])}
                                    className="flex w-fit items-center gap-1 text-sm font-medium text-primary-600 hover:underline"
                                >
                                    <Plus className="size-4" />
                                    {t('series.add')}
                                </button>
                                <p className="text-xs text-neutral-500">{t('defaultSeries', { format: defaultFormat })}</p>
                            </div>
                        )}

                        <div className="flex flex-col gap-2 text-sm text-neutral-700">
                            <label className="flex items-center gap-2">
                                <Checkbox
                                    checked={value.policy.askOnFirstPayment}
                                    onCheckedChange={(v) => setPolicy({ askOnFirstPayment: v === true })}
                                />
                                {t('policy.ask')}
                            </label>
                            {value.policy.askOnFirstPayment && (
                                <label className="ml-6 flex items-center gap-2">
                                    <Checkbox
                                        checked={value.policy.required}
                                        onCheckedChange={(v) => setPolicy({ required: v === true })}
                                    />
                                    {t('policy.required')}
                                </label>
                            )}
                            <p className="text-xs text-neutral-500">{t('policy.hint')}</p>
                        </div>

                        {errors.length > 0 && (
                            <ul role="alert" className="list-disc pl-5 text-xs font-medium text-danger-600">
                                {errors.map((e) => (
                                    <li key={e}>{e}</li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
};
