import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Warning, Info, Hash } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
    fetchInvoiceNumberTokens,
    previewInvoiceNumbering,
    type InvoiceNumberingConfig,
    type InvoiceNumberPreview,
    type InvoiceNumberToken,
    type InvoiceSeqScope,
} from './invoice-settings-service';

const buildScopeOptions = (
    t: TFunction
): Array<{ value: InvoiceSeqScope; label: string; hint: string }> => [
    { value: 'NEVER', label: t('counter.scope.options.never.label'), hint: t('counter.scope.options.never.hint') },
    { value: 'YEARLY', label: t('counter.scope.options.yearly.label'), hint: t('counter.scope.options.yearly.hint') },
    { value: 'MONTHLY', label: t('counter.scope.options.monthly.label'), hint: t('counter.scope.options.monthly.hint') },
    { value: 'DAILY', label: t('counter.scope.options.daily.label'), hint: t('counter.scope.options.daily.hint') },
];

const buildMonths = (t: TFunction): string[] => [
    t('counter.months.january'),
    t('counter.months.february'),
    t('counter.months.march'),
    t('counter.months.april'),
    t('counter.months.may'),
    t('counter.months.june'),
    t('counter.months.july'),
    t('counter.months.august'),
    t('counter.months.september'),
    t('counter.months.october'),
    t('counter.months.november'),
    t('counter.months.december'),
];

const buildGroupLabels = (t: TFunction): Record<InvoiceNumberToken['group'], string> => ({
    SEQUENCE: t('format.tokenGroups.sequence'),
    INSTITUTE: t('format.tokenGroups.institute'),
    LEARNER: t('format.tokenGroups.learner'),
    DATE: t('format.tokenGroups.date'),
    TRANSACTION: t('format.tokenGroups.transaction'),
});

const GROUP_ORDER: Array<InvoiceNumberToken['group']> = [
    'SEQUENCE',
    'INSTITUTE',
    'DATE',
    'LEARNER',
    'TRANSACTION',
];

/** A few formats worth starting from, so admins rarely need to compose one by hand. */
const PRESETS: Array<{ label: string; format: string; scope: InvoiceSeqScope }> = [
    { label: 'INV-20260805-0001', format: 'INV-{{YYYYMMDD}}-{{seq}}', scope: 'DAILY' },
    { label: 'ACME/2026/0001', format: '{{institute_code}}/{{YYYY}}/{{seq}}', scope: 'YEARLY' },
    { label: 'ACME/2026-27/0001', format: '{{institute_code}}/{{FY}}/{{seq}}', scope: 'YEARLY' },
    { label: 'INV-202608-0001', format: 'INV-{{YYYYMM}}-{{seq}}', scope: 'MONTHLY' },
];

interface Props {
    value: InvoiceNumberingConfig;
    onChange: (patch: Partial<InvoiceNumberingConfig>) => void;
}

/**
 * The invoice-number format builder.
 *
 * <p>Validation and preview both come from the backend, which renders through the very same
 * formatter that issues real numbers — so what an admin sees here cannot disagree with what
 * gets stamped on an invoice. Previewing never consumes a sequence number.
 */
export function InvoiceNumberingSection({ value, onChange }: Props) {
    const { t } = useTranslation('settingsInvoiceNumbering');
    const inputRef = useRef<HTMLInputElement>(null);
    const [preview, setPreview] = useState<InvoiceNumberPreview | null>(null);
    const [previewing, setPreviewing] = useState(false);

    const SCOPE_OPTIONS = useMemo(() => buildScopeOptions(t), [t]);
    const MONTHS = useMemo(() => buildMonths(t), [t]);
    const GROUP_LABELS = useMemo(() => buildGroupLabels(t), [t]);

    const { data: tokens = [] } = useQuery({
        queryKey: ['invoice-number-tokens'],
        queryFn: fetchInvoiceNumberTokens,
        staleTime: 60 * 60 * 1000, // static catalogue; only changes on deploy
    });

    // Debounced so typing in the format field doesn't fire a request per keystroke.
    useEffect(() => {
        let cancelled = false;
        setPreviewing(true);
        const timer = setTimeout(() => {
            previewInvoiceNumbering(value)
                .then((result) => {
                    if (!cancelled) setPreview(result);
                })
                .catch(() => {
                    if (!cancelled) setPreview(null);
                })
                .finally(() => {
                    if (!cancelled) setPreviewing(false);
                });
        }, 350);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [value]);

    const grouped = useMemo(() => {
        const map = new Map<InvoiceNumberToken['group'], InvoiceNumberToken[]>();
        tokens.forEach((token) => {
            const list = map.get(token.group) ?? [];
            list.push(token);
            map.set(token.group, list);
        });
        return map;
    }, [tokens]);

    /**
     * Insert at the caret rather than appending, and restore the caret afterwards —
     * appending would force admins to retype separators when editing mid-format.
     */
    const insertToken = (key: string) => {
        const input = inputRef.current;
        const token = `{{${key}}}`;
        if (!input) {
            onChange({ format: `${value.format}${token}` });
            return;
        }
        const start = input.selectionStart ?? value.format.length;
        const end = input.selectionEnd ?? value.format.length;
        const next = value.format.slice(0, start) + token + value.format.slice(end);
        onChange({ format: next });
        requestAnimationFrame(() => {
            input.focus();
            const caret = start + token.length;
            input.setSelectionRange(caret, caret);
        });
    };

    const usesFinancialYear = /\{\{\s*F(Y|YY|Q)\s*\}\}/.test(value.format);
    const errors = preview?.errors ?? [];
    const warnings = preview?.warnings ?? [];

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t('format.title')}</CardTitle>
                    <CardDescription>{t('format.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    {/* Presets */}
                    <div className="space-y-1.5">
                        <Label>{t('format.presets.label')}</Label>
                        <div className="flex flex-wrap gap-2">
                            {PRESETS.map((preset) => (
                                <Button
                                    key={preset.format}
                                    type="button"
                                    variant={value.format === preset.format ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() =>
                                        onChange({ format: preset.format, seqScope: preset.scope })
                                    }
                                >
                                    {preset.label}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {/* Format field */}
                    <div className="space-y-1.5">
                        <Label htmlFor="invoice-number-format">{t('format.formatField.label')}</Label>
                        <Input
                            id="invoice-number-format"
                            ref={inputRef}
                            value={value.format}
                            spellCheck={false}
                            onChange={(e) => onChange({ format: e.target.value })}
                            className={cn('font-mono', errors.length > 0 && 'border-danger-500')}
                            placeholder="INV-{{YYYYMMDD}}-{{seq}}"
                        />
                        <p className="text-caption text-neutral-500">
                            {t('format.formatField.hint', { braces: '{{ }}' })}
                        </p>
                    </div>

                    {/* Preview */}
                    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <Hash className="size-4 text-neutral-500" />
                            <span className="text-body font-medium text-neutral-700">
                                {t('format.preview.title')}
                            </span>
                        </div>
                        {errors.length > 0 ? (
                            <ul className="space-y-1">
                                {errors.map((error) => (
                                    <li
                                        key={error}
                                        className="flex items-start gap-2 text-caption text-danger-600"
                                    >
                                        <Warning className="mt-0.5 size-3.5 shrink-0" weight="fill" />
                                        <span>{error}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : preview?.samples?.length ? (
                            <div className="flex flex-wrap gap-2">
                                {preview.samples.map((sample) => (
                                    <code
                                        key={sample}
                                        className="rounded bg-white px-2 py-1 font-mono text-caption text-neutral-700 ring-1 ring-neutral-200"
                                    >
                                        {sample}
                                    </code>
                                ))}
                            </div>
                        ) : (
                            <p className="text-caption text-neutral-500">
                                {previewing ? t('format.preview.checking') : t('format.preview.unavailable')}
                            </p>
                        )}
                        {preview && errors.length === 0 && (
                            <p className="mt-2 text-caption text-neutral-500">
                                {t('format.preview.lengthHint', { count: preview.maxLength })}
                            </p>
                        )}
                    </div>

                    {warnings.map((warning) => (
                        <div
                            key={warning}
                            className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3"
                        >
                            <Warning
                                className="mt-0.5 size-4 shrink-0 text-warning-600"
                                weight="fill"
                            />
                            <p className="text-caption text-warning-700">{warning}</p>
                        </div>
                    ))}

                    {/* Token palette */}
                    <div className="space-y-3">
                        <Label>{t('format.tokenPalette.label')}</Label>
                        {GROUP_ORDER.filter((group) => grouped.has(group)).map((group) => (
                            <div key={group} className="space-y-1.5">
                                <p className="text-caption font-medium text-neutral-500">
                                    {GROUP_LABELS[group]}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    {(grouped.get(group) ?? []).map((token) => (
                                        <button
                                            key={token.key}
                                            type="button"
                                            onClick={() => insertToken(token.key)}
                                            title={t('format.tokenPalette.tokenTitle', {
                                                label: token.label,
                                                example: token.example,
                                            })}
                                            className={cn(
                                                'rounded-md border px-2 py-1 text-caption transition-colors',
                                                'border-neutral-200 bg-white hover:border-primary-300 hover:bg-primary-50',
                                                token.riskyForTax && 'border-warning-200 bg-warning-50'
                                            )}
                                        >
                                            {/* Label only. Showing the example inline doubled
                                                every chip's width and turned the palette into a
                                                wall of text; it lives in the tooltip instead. */}
                                            {token.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <div className="flex items-start gap-2 text-caption text-neutral-500">
                            <Info className="mt-0.5 size-3.5 shrink-0" />
                            <span>
                                {t('format.tokenPalette.shortenHint.part1')}
                                <code className="font-mono">:4</code>
                                {t('format.tokenPalette.shortenHint.part2')}
                                <code className="font-mono">:initials</code>
                                {t('format.tokenPalette.shortenHint.part3')}
                                <code className="font-mono">{'{{learner_name:initials}}'}</code>
                                {t('format.tokenPalette.shortenHint.part4')}
                            </span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t('counter.title')}</CardTitle>
                    <CardDescription>{t('counter.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="invoice-seq-scope">{t('counter.scope.label')}</Label>
                            <Select
                                value={value.seqScope}
                                onValueChange={(v) => onChange({ seqScope: v as InvoiceSeqScope })}
                            >
                                <SelectTrigger id="invoice-seq-scope">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {SCOPE_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {/* Hint lives here rather than inside the option, so the trigger
                                shows a short label instead of overflowing its column. */}
                            <p className="text-caption text-neutral-500">
                                {SCOPE_OPTIONS.find((o) => o.value === value.seqScope)?.hint}
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="invoice-seq-padding">{t('counter.padding.label')}</Label>
                            <Input
                                id="invoice-seq-padding"
                                type="number"
                                min={1}
                                max={12}
                                value={value.seqPadding}
                                onChange={(e) =>
                                    onChange({
                                        seqPadding: Math.max(
                                            1,
                                            Math.min(12, Number(e.target.value) || 1)
                                        ),
                                    })
                                }
                            />
                            <p className="text-caption text-neutral-500">{t('counter.padding.hint')}</p>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="invoice-institute-code">{t('counter.instituteCode.label')}</Label>
                            <Input
                                id="invoice-institute-code"
                                value={value.instituteCode}
                                maxLength={12}
                                onChange={(e) => onChange({ instituteCode: e.target.value })}
                                placeholder={t('counter.instituteCode.placeholder')}
                            />
                            <p className="text-caption text-neutral-500">
                                {t('counter.instituteCode.hint')}
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="invoice-start-from">{t('counter.startFrom.label')}</Label>
                            <Input
                                id="invoice-start-from"
                                type="number"
                                min={0}
                                value={value.startFrom || ''}
                                placeholder={t('counter.startFrom.placeholder', {
                                    count: preview?.nextSequence ?? 1,
                                })}
                                onChange={(e) =>
                                    onChange({ startFrom: Math.max(0, Number(e.target.value) || 0) })
                                }
                            />
                            <p className="text-caption text-neutral-500">
                                {t('counter.startFrom.hint')}
                            </p>
                        </div>

                        {usesFinancialYear && (
                            <div className="space-y-1.5">
                                <Label htmlFor="invoice-fy-start">{t('counter.fyStart.label')}</Label>
                                <Select
                                    value={String(value.fyStartMonth)}
                                    onValueChange={(v) => onChange({ fyStartMonth: Number(v) })}
                                >
                                    <SelectTrigger id="invoice-fy-start">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {MONTHS.map((month, index) => (
                                            <SelectItem key={month} value={String(index + 1)}>
                                                {month}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-caption text-neutral-500">
                                    {t('counter.fyStart.hint')}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between rounded-md border border-neutral-200 p-3">
                        <div className="space-y-0.5 pr-4">
                            <Label htmlFor="invoice-sanitize">{t('counter.sanitize.label')}</Label>
                            <p className="text-caption text-neutral-500">
                                {t('counter.sanitize.hint')}
                            </p>
                        </div>
                        <Switch
                            id="invoice-sanitize"
                            checked={value.sanitizeTokens}
                            onCheckedChange={(checked) => onChange({ sanitizeTokens: checked })}
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
