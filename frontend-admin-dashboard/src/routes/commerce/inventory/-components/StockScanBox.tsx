import { useTranslation } from 'react-i18next';
import { Barcode, X } from '@phosphor-icons/react';
import type { useStockScan } from '../-shared/use-stock-scan';
import type { VariantPick } from '../-shared/inventory-types';
import { VariantResults } from './ItemPicker';

export interface ScanMessage {
    tone: 'danger' | 'info' | 'success';
    text: string;
}

const MESSAGE_CLASS: Record<ScanMessage['tone'], string> = {
    danger: 'text-body text-danger-600',
    info: 'text-body text-info-600',
    success: 'text-body text-success-600',
};

/**
 * The one box of the receive, transfer, count and reprint screens: a USB or
 * Bluetooth scanner types a label's code (or its QR link) and Enter; a person
 * types a name or SKU and picks from the list under it. The state lives in
 * `useStockScan` (the caller), so the caller decides what a scan means.
 */
export function StockScanBox({
    scan,
    message,
    locationId,
    onPick,
    showOnHand,
    testId = 'stock-scan',
}: {
    scan: ReturnType<typeof useStockScan>;
    message: ScanMessage | null;
    locationId: string | null;
    /** A typed search's pick; leave out to scan only. */
    onPick?: (item: VariantPick) => void;
    showOnHand?: boolean;
    testId?: string;
}) {
    const { t } = useTranslation('commerce');
    const label = t('inventory.scan.placeholder');
    const { inputProps } = scan;
    return (
        <div className="flex flex-col gap-2">
            <div className="relative">
                <Barcode
                    size={24}
                    className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <input
                    {...inputProps}
                    aria-label={label}
                    placeholder={label}
                    aria-busy={scan.busy || undefined}
                    data-testid={testId}
                    className="h-14 w-full rounded-lg border-2 border-primary-200 bg-background pe-12 ps-12 text-subtitle text-foreground placeholder:text-body placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none"
                />
                {inputProps.value && (
                    <button
                        type="button"
                        aria-label={t('inventory.picker.clear')}
                        onClick={() => {
                            scan.setValue('');
                            scan.refocus();
                        }}
                        className="absolute end-1 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                    >
                        <X size={20} />
                    </button>
                )}
            </div>
            <p
                role={message?.tone === 'danger' ? 'alert' : 'status'}
                aria-live="polite"
                data-testid={`${testId}-message`}
                className={message ? MESSAGE_CLASS[message.tone] : 'sr-only'}
            >
                {message?.text ?? ''}
            </p>
            {onPick && (
                <VariantResults
                    text={inputProps.value}
                    locationId={locationId}
                    showOnHand={showOnHand}
                    onPick={(item) => {
                        scan.setValue('');
                        onPick(item);
                        scan.refocus();
                    }}
                />
            )}
        </div>
    );
}
