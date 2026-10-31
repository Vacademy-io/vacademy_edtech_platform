import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useOfflinePaymentModes, type OfflinePaymentModes } from '@/services/offline-payment-modes';

/** Select value for "no field": Radix Select items cannot have an empty value. */
const RECORDED = '__recorded__';

export interface ReceiptDateFieldOption {
    key: string;
    label: string;
    modes: string[];
}

/**
 * The DATE fields of the active offline payment modes, one per field key, with the modes
 * that carry it. The receipt reads the payment's value by key, so a key on several modes
 * is one choice.
 */
export const receiptDateFieldOptions = (
    modes: OfflinePaymentModes | undefined
): ReceiptDateFieldOption[] => {
    const byKey = new Map<string, ReceiptDateFieldOption>();
    for (const mode of modes?.modes ?? []) {
        if (!mode.active) continue;
        for (const field of mode.custom_fields ?? []) {
            if (field.type !== 'DATE' || !field.active || !field.key) continue;
            const option = byKey.get(field.key) ?? {
                key: field.key,
                label: field.label,
                modes: [],
            };
            option.modes.push(mode.label);
            byKey.set(field.key, option);
        }
    }
    return [...byKey.values()];
};

interface Props {
    fromPayment: boolean;
    field: string | null | undefined;
    onChange: (patch: { receiptDateFromPayment?: boolean; receiptDateField?: string }) => void;
}

/**
 * INVOICE_SETTING.receiptDateFromPayment / receiptDateField, read by InvoiceService:
 * whether the receipt is dated by the payment, and which payment-mode date field (e.g. a
 * Transaction Date) is that payment date when the payment has it.
 */
export function InvoiceReceiptDateSection({ fromPayment, field, onChange }: Props) {
    const { t } = useTranslation('settingsInvoice');
    const { data: modes } = useOfflinePaymentModes();
    const options = receiptDateFieldOptions(modes);
    // A saved key the modes do not list; until the modes load it is shown as the bare key,
    // not as removed.
    const missing = !!field && !options.some((o) => o.key === field);

    return (
        <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                    <Label htmlFor="invoice-receipt-date-from-payment" className="cursor-pointer">
                        {t('general.receiptDate.label')}
                    </Label>
                    <p className="text-xs text-muted-foreground">{t('general.receiptDate.hint')}</p>
                </div>
                <Switch
                    id="invoice-receipt-date-from-payment"
                    checked={fromPayment}
                    onCheckedChange={(v) => onChange({ receiptDateFromPayment: v })}
                />
            </div>
            <div className="space-y-1.5">
                <Label>{t('general.receiptDate.fieldLabel')}</Label>
                <Select
                    value={field || RECORDED}
                    onValueChange={(v) =>
                        onChange({ receiptDateField: v === RECORDED ? undefined : v })
                    }
                >
                    <SelectTrigger className="sm:max-w-md">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={RECORDED}>
                            {t('general.receiptDate.recorded')}
                        </SelectItem>
                        {options.map((o) => (
                            <SelectItem key={o.key} value={o.key}>
                                {`${o.label} · ${o.modes.join(', ')}`}
                            </SelectItem>
                        ))}
                        {missing && (
                            <SelectItem value={field!}>
                                {modes ? t('general.receiptDate.missing', { key: field }) : field}
                            </SelectItem>
                        )}
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                    {t('general.receiptDate.fieldHint')}
                </p>
            </div>
        </div>
    );
}
