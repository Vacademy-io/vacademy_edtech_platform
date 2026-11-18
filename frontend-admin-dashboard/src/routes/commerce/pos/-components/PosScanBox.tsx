import type { KeyboardEvent, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Barcode, X } from '@phosphor-icons/react';

/**
 * The always-focused box at the top of the bill: a USB or Bluetooth scanner
 * types into it and presses Enter; a person types a name or SKU and picks from
 * the list under it. State lives in `useScanInput` (the caller), so the
 * caller can put text back after a code that matched nothing.
 */
export function PosScanBox({
    inputProps,
    label,
    onClear,
    message,
}: {
    inputProps: {
        ref: Ref<HTMLInputElement>;
        value: string;
        onChange: (event: { target: { value: string } }) => void;
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
        inputMode: 'text';
        autoComplete: string;
        autoCapitalize: string;
        spellCheck: boolean;
        enterKeyHint: 'go';
        maxLength: number;
    };
    label?: string;
    onClear: () => void;
    /** The last refusal or "not found", read out to the cashier. */
    message?: { tone: 'danger' | 'info'; text: string } | null;
}) {
    const { t } = useTranslation('commerce');
    const text = label ?? t('pos.sell.scan');
    return (
        <div className="flex flex-col gap-1">
            <div className="relative">
                <Barcode
                    size={24}
                    className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <input
                    {...inputProps}
                    aria-label={text}
                    placeholder={text}
                    data-testid="pos-scan"
                    className="h-14 w-full rounded-lg border-2 border-primary-200 bg-background pe-12 ps-12 text-subtitle text-foreground placeholder:text-body placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none"
                />
                {inputProps.value && (
                    <button
                        type="button"
                        aria-label={t('pos.sell.clearSearch')}
                        onClick={onClear}
                        className="absolute end-1 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                    >
                        <X size={20} />
                    </button>
                )}
            </div>
            <p
                role={message?.tone === 'danger' ? 'alert' : 'status'}
                aria-live="polite"
                data-testid="pos-scan-message"
                className={
                    message
                        ? message.tone === 'danger'
                            ? 'text-body text-danger-600'
                            : 'text-body text-info-600'
                        : 'sr-only'
                }
            >
                {message?.text ?? ''}
            </p>
        </div>
    );
}
