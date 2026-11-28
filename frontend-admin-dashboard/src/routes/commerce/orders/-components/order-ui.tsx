import { type ReactNode, createContext, useCallback, useContext } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle, Info, Warning, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { formatMoney } from '@/components/design-system/money-cell';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { readCurrentInstituteIdSafely, syncCapabilitiesOnce } from '@/services/capabilities';
import {
    type OrderError,
    orderErrorKey,
    orderErrorKind,
    readOrderError,
} from '@/routes/commerce/orders/-shared/order-errors';
import { invalidateOrders } from '@/routes/commerce/orders/-shared/order-hooks';
import type { OrderAddress } from '@/routes/commerce/orders/-shared/order-types';

/**
 * Small pieces every order desk screen and dialog shares: a toned notice, the
 * mapped error sentence, the reaction to a failed write (contract §4), labelled
 * fields and an address block.
 */

type Tone = 'danger' | 'warning' | 'info' | 'success';

const TONE_CLASS: Record<Tone, string> = {
    danger: 'border-danger-200 bg-danger-50 text-danger-600',
    warning: 'border-warning-200 bg-warning-50 text-warning-600',
    info: 'border-info-200 bg-info-50 text-info-600',
    success: 'border-success-200 bg-success-50 text-success-600',
};

const TONE_ICON: Record<Tone, ReactNode> = {
    danger: <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" />,
    warning: <Warning size={18} weight="fill" className="mt-0.5 shrink-0" />,
    info: <Info size={18} weight="fill" className="mt-0.5 shrink-0" />,
    success: <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0" />,
};

export function OrderNotice({
    tone,
    children,
    action,
    className,
}: {
    tone: Tone;
    children: ReactNode;
    action?: ReactNode;
    className?: string;
}) {
    return (
        <div
            role={tone === 'danger' ? 'alert' : 'status'}
            className={cn(
                'flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between',
                TONE_CLASS[tone],
                className
            )}
        >
            <div className="flex items-start gap-2 text-body">
                {TONE_ICON[tone]}
                <div className="flex flex-col gap-1">{children}</div>
            </div>
            {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
    );
}

/** The mapped sentence of an error, with its amount formatted. */
export function useOrderErrorText() {
    const { t } = useTranslation('commerce');
    return useCallback(
        (error: OrderError, currency = 'INR') =>
            t(orderErrorKey(error), {
                amount: error.amount ? formatMoney(error.amount, currency) : '',
                minutes: error.retryAfterSeconds ? Math.ceil(error.retryAfterSeconds / 60) : 1,
                step: error.step ?? '',
            }),
        [t]
    );
}

/** The mapped sentence and, when it names the field or the code is new, the server's own. */
export function OrderErrorAlert({ error, currency }: { error: OrderError | null; currency?: string }) {
    const text = useOrderErrorText();
    if (!error) return null;
    return (
        <OrderNotice tone="danger">
            <p>{text(error, currency)}</p>
            {error.showServerSentence && (
                <p className="text-caption text-muted-foreground">{error.message}</p>
            )}
        </OrderNotice>
    );
}

/**
 * Where a 403 is shown after its dialog closes: the detail page provides it
 * (an inline notice above the order); elsewhere a toast is used.
 */
export const OrderAccessAlertContext = createContext<((message: string) => void) | null>(null);

/**
 * The reaction to a failed write (contract §4):
 *  - FEATURE_DISABLED: capabilities are read again; the gate then locks the page.
 *  - 403 role/location: the no-access sentence on the page, refetch, close.
 *  - 409 state codes: a toast, refetch, close.
 *  - IDEMPOTENCY_MISMATCH: a new request id next time, the sentence inline.
 *  - everything else: returned, for the dialog to show inline (it stays open).
 */
export function useOrderErrorHandler() {
    const queryClient = useQueryClient();
    const text = useOrderErrorText();
    const showAccess = useContext(OrderAccessAlertContext);
    return useCallback(
        (
            raw: unknown,
            options: { close?: () => void; resetRequestId?: () => void; currency?: string } = {}
        ): OrderError | null => {
            const error = readOrderError(raw);
            const kind = orderErrorKind(error);
            if (kind === 'feature') {
                void syncCapabilitiesOnce(readCurrentInstituteIdSafely());
                toast.error(text(error));
                options.close?.();
                return null;
            }
            if (kind === 'access') {
                void invalidateOrders(queryClient);
                options.close?.();
                if (showAccess) showAccess(text(error));
                else toast.error(text(error));
                return null;
            }
            if (kind === 'state') {
                void invalidateOrders(queryClient);
                toast.error(text(error));
                options.close?.();
                return null;
            }
            if (kind === 'idempotency') options.resetRequestId?.();
            else if (error.status === 409) void invalidateOrders(queryClient);
            return error;
        },
        [queryClient, showAccess, text]
    );
}

export function Field({
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

export function TextAreaField({
    id,
    label,
    value,
    onChange,
    required,
    error,
    maxLength = 500,
    hint,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    required?: boolean;
    error?: string | null;
    maxLength?: number;
    hint?: ReactNode;
}) {
    return (
        <Field label={label} htmlFor={id} required={required} error={error} hint={hint}>
            <Textarea
                id={id}
                value={value}
                maxLength={maxLength}
                aria-invalid={!!error || undefined}
                onChange={(event) => onChange(event.target.value)}
                className="min-h-20 text-body"
            />
        </Field>
    );
}

/** Native input with the design-system look, for dates and numbers in dialogs. */
export const inputClass =
    'h-12 w-full rounded-md border border-neutral-300 bg-background px-3 text-body text-foreground hover:border-primary-200 focus:border-primary-500 focus:outline-none md:h-9';

export function DialogButtons({
    onCancel,
    children,
}: {
    onCancel: () => void;
    children: ReactNode;
}) {
    const { t } = useTranslation('commerce');
    return (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <MyButton type="button" buttonType="secondary" scale="medium" onClick={onCancel}>
                {t('common.cancel')}
            </MyButton>
            {children}
        </div>
    );
}

const ADDRESS_KEYS: (keyof OrderAddress)[] = ['line1', 'line2', 'landmark'];

export function AddressBlock({ address }: { address: OrderAddress | null | undefined }) {
    const { t } = useTranslation('commerce');
    if (!address) return <p className="text-body text-muted-foreground">—</p>;
    const cityLine = [address.city, address.state_code ? t(`states.${address.state_code}`, address.state_code) : null, address.pincode]
        .filter(Boolean)
        .join(', ');
    return (
        <address className="flex flex-col gap-0.5 text-body not-italic text-foreground">
            {address.name && <span className="font-medium">{address.name}</span>}
            {ADDRESS_KEYS.map((key) =>
                address[key] ? <span key={key}>{address[key]}</span> : null
            )}
            {cityLine && <span>{cityLine}</span>}
            {address.phone && (
                <a href={`tel:${address.phone}`} className="text-primary-500 hover:underline">
                    {address.phone}
                </a>
            )}
        </address>
    );
}

/** A money amount as text (for sentences and summaries). */
export const money = (value: number | string | null | undefined, currency?: string | null) =>
    formatMoney(value ?? 0, currency ?? 'INR');
