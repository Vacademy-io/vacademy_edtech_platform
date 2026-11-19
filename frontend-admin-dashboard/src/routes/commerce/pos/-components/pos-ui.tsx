import { type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatMoney } from '@/components/design-system/money-cell';
import { formatDateTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { ORDER_ERROR_CODES } from '@/routes/commerce/orders/-shared/order-errors';
import type { LineMark } from '../-shared/pos-cart';
import {
    POS_ERROR_CODES,
    type PosError,
    posErrorKey,
    readPosError,
    showPosServerSentence,
} from '../-shared/pos-errors';

/**
 * Small pieces every counter screen shares: the admin's language, money as
 * text, the mapped error sentence and a labelled number box sized for a
 * finger (48 px).
 */

export function usePosLang(): 'hi' | 'en' {
    const { i18n } = useTranslation('commerce');
    return (i18n?.language ?? '').toLowerCase().startsWith('hi') ? 'hi' : 'en';
}

export const rupees = (value: number | string | null | undefined) => formatMoney(value ?? 0, 'INR');

/** A difference with its sign in front of the symbol: "− ₹198.00", "+ ₹20.00", "₹0.00". */
export const signedRupees = (value: number): string =>
    value < 0 ? `− ${rupees(-value)}` : value > 0 ? `+ ${rupees(value)}` : rupees(0);

/** The sentence for a counter error, with its amount, time or line filled in. */
export function usePosErrorText() {
    const { t } = useTranslation('commerce');
    return useCallback(
        (error: PosError) =>
            t(posErrorKey(error), {
                amount: error.amount ? rupees(error.amount) : '',
                time: error.time ?? '',
                step: error.step ?? '',
                minutes: error.retryAfterSeconds ? Math.ceil(error.retryAfterSeconds / 60) : 1,
            }),
        [t]
    );
}

export function PosErrorNotice({ error, className }: { error: unknown; className?: string }) {
    const text = usePosErrorText();
    if (!error) return null;
    const read = readPosError(error);
    return (
        <OrderNotice tone="danger" className={className}>
            <p>{text(read)}</p>
            {showPosServerSentence(read) && <p className="text-caption">{read.message}</p>}
        </OrderNotice>
    );
}

/** Big-touch input: 48 px tall, the design-system border and focus. */
export const posInputClass =
    'h-12 w-full rounded-md border border-neutral-300 bg-background px-3 text-subtitle text-foreground hover:border-primary-200 focus:border-primary-500 focus:outline-none disabled:bg-neutral-50';

export function PosField({
    label,
    htmlFor,
    hint,
    error,
    required,
    children,
    className,
}: {
    label: string;
    htmlFor?: string;
    hint?: ReactNode;
    error?: string | null;
    required?: boolean;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
            <label htmlFor={htmlFor} className="text-caption text-muted-foreground">
                {label}
                {required && <span className="text-danger-600"> *</span>}
            </label>
            {children}
            {hint && !error && <p className="text-caption text-muted-foreground">{hint}</p>}
            {error && (
                <p role="alert" className="text-caption text-danger-600">
                    {error}
                </p>
            )}
        </div>
    );
}

/** Money typed by a person: digits and one dot, at most 2 decimals. */
export const sanitizeAmount = (raw: string): string => {
    const cleaned = raw.replace(/[^\d.]/g, '');
    const [whole = '', ...rest] = cleaned.split('.');
    if (rest.length === 0) return whole.slice(0, 9);
    return `${whole.slice(0, 9)}.${rest.join('').slice(0, 2)}`;
};

export const isAmount = (text: string, { allowZero = false } = {}): boolean => {
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(text.trim())) return false;
    const value = Number(text);
    return allowZero ? value >= 0 : value > 0;
};

/** A label and a figure on one row (totals, Z-report). */
export function PosFigure({
    label,
    value,
    strong,
    tone,
    testId,
}: {
    label: ReactNode;
    value: ReactNode;
    strong?: boolean;
    tone?: 'danger' | 'success' | 'muted';
    testId?: string;
}) {
    return (
        <div
            className={cn(
                'flex items-baseline justify-between gap-3',
                strong ? 'text-title font-medium text-foreground' : 'text-body text-neutral-600'
            )}
        >
            <span>{label}</span>
            <span
                data-testid={testId}
                className={cn(
                    'tabular-nums text-end',
                    tone === 'danger' && 'text-danger-600',
                    tone === 'success' && 'text-success-600',
                    tone === 'muted' && 'text-muted-foreground'
                )}
            >
                {value}
            </span>
        </div>
    );
}

/**
 * "3 here": units at this counter's location from the catalogue (a hint; the
 * server decides at the sale). Null for untracked items.
 */
export function stockHint(
    t: TFunction,
    onHand: number | null,
    qtyScale: number,
    unit: string | null
): string | null {
    if (onHand === null) return null;
    // `count` carries the formatted amount ("2.5 m"); the key has no plural forms.
    return t('pos.sell.here', { count: formatQuantity(onHand, qtyScale, unit, t) as unknown as number });
}

/** The sentence under a bill line the server refused (stock, price, not sellable). */
export function useMarkText() {
    const { t } = useTranslation('commerce');
    return useCallback(
        (mark: LineMark): string => {
            if (mark.code === 'PRICE_CHANGED') return t('pos.lineMarks.PRICE_CHANGED');
            if ((POS_ERROR_CODES as readonly string[]).includes(mark.code)) {
                return t(`pos.errors.${mark.code}`, { time: mark.time ?? '' });
            }
            if ((ORDER_ERROR_CODES as readonly string[]).includes(mark.code)) return t(`orders.errors.${mark.code}`);
            return t('pos.lineMarks.UNAVAILABLE');
        },
        [t]
    );
}

/** "5:30 pm" in the admin's language (who opened a counter, since when). */
export const timeOnly = (iso: string | null | undefined) =>
    iso ? formatDateTime(iso, { day: undefined, month: undefined, year: undefined }) : '';
