import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, CircleNotch, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { DialogButtons, OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { type InventoryError, inventoryErrorKey, readInventoryError } from '../-shared/inventory-errors';
import type { InventoryLocation } from '../-shared/inventory-types';
import { unitSign } from '../-shared/label-print';

/**
 * Small pieces the inventory screens share: the error sentence, an item cell,
 * a quantity, the "pick one place" card, a confirm dialog and a line's save
 * state.
 */

/** The mapped sentence of an inventory error (with its SKU or count filled in). */
export function useInventoryErrorText() {
    const { t } = useTranslation('commerce');
    return useCallback(
        (error: unknown) => {
            const read = readInventoryError(error);
            return t(inventoryErrorKey(read), {
                ...read.values,
                amount: read.amount ?? '',
                minutes: read.retryAfterSeconds ? Math.ceil(read.retryAfterSeconds / 60) : 1,
            });
        },
        [t]
    );
}

export function InventoryErrorNotice({ error, className }: { error: unknown; className?: string }) {
    const text = useInventoryErrorText();
    if (!error) return null;
    const read: InventoryError = readInventoryError(error);
    return (
        <OrderNotice tone="danger" className={className}>
            <p>{text(read)}</p>
            {read.showServerSentence && read.message && (
                <p className="text-caption text-muted-foreground">{read.message}</p>
            )}
        </OrderNotice>
    );
}

/** Name, variant and SKU (and a piece code) of an item, stacked. */
export function ItemCell({
    name,
    variant,
    sku,
    code,
}: {
    name: string | null | undefined;
    variant?: string | null;
    sku?: string | null;
    code?: string | null;
}) {
    return (
        <div className="flex min-w-0 flex-col">
            <span className="truncate text-body text-foreground">{name || sku || '—'}</span>
            {variant && <span className="truncate text-caption text-muted-foreground">{variant}</span>}
            <span className="truncate text-caption text-muted-foreground">
                {[sku, code].filter(Boolean).join(' · ')}
            </span>
        </div>
    );
}

export function Qty({
    qty,
    scale,
    unit,
    className,
}: {
    qty: number | null | undefined;
    scale: number;
    unit?: string | null;
    className?: string;
}) {
    const { t } = useTranslation('commerce');
    return (
        <span className={cn('tabular-nums', className)}>
            {qty === null || qty === undefined ? '—' : formatQuantity(qty, scale, qtyUnit(unit), t)}
        </span>
    );
}

/**
 * The unit after a measured quantity: metres in the admin's words ("m" /
 * "मीटर"), any other code as its short sign ("kg"), never a raw code ("MTR").
 */
export const qtyUnit = (unit: string | null | undefined): string | null => {
    const u = (unit ?? '').trim().toUpperCase();
    return u === 'MTR' || u === 'M' ? null : unitSign(unit);
};

/** A tab that works at one place, when "All my locations" is chosen. */
export function NeedOneLocation({
    places,
    onPick,
}: {
    places: InventoryLocation[];
    onPick: (id: string) => void;
}) {
    const { t } = useTranslation('commerce');
    return (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-6">
            <p className="text-body text-foreground">{t('inventory.location.pickOne')}</p>
            <PlainSelect
                className="max-w-sm"
                label={t('inventory.location.label')}
                value=""
                onChange={(id) => id && onPick(id)}
                options={places.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
            />
        </div>
    );
}

/** A yes/no question before an action that cannot be undone. */
export function ConfirmDialog({
    open,
    onOpenChange,
    heading,
    children,
    confirmLabel,
    onConfirm,
    danger,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    heading: string;
    children: ReactNode;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
    danger?: boolean;
}) {
    const [error, setError] = useState<unknown>(null);
    useEffect(() => {
        if (open) setError(null);
    }, [open]);
    return (
        <MyDialog
            heading={heading}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        className={cn(TOUCH, danger && 'bg-danger-600 hover:bg-danger-600')}
                        onAsyncClick={async () => {
                            setError(null);
                            try {
                                await onConfirm();
                                onOpenChange(false);
                            } catch (e) {
                                setError(e);
                            }
                        }}
                    >
                        {confirmLabel}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-3 text-body text-foreground">
                {children}
                <InventoryErrorNotice error={error} />
            </div>
        </MyDialog>
    );
}

export type SaveState = 'saved' | 'saving' | 'failed';

/** "Saved / Saving / Not saved, retry" next to a count line. */
export function SaveStateMark({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
    const { t } = useTranslation('commerce');
    if (state === 'saving') {
        return (
            <span className="flex items-center gap-1 text-caption text-muted-foreground" role="status">
                <CircleNotch size={14} className="animate-spin" />
                {t('inventory.save.saving')}
            </span>
        );
    }
    if (state === 'failed') {
        return (
            <button
                type="button"
                onClick={onRetry}
                className="flex min-h-12 items-center gap-1 text-caption text-danger-600 underline md:min-h-0"
            >
                <WarningCircle size={14} weight="fill" />
                {t('inventory.save.failed')}
            </button>
        );
    }
    return (
        <span className="flex items-center gap-1 text-caption text-success-600">
            <CheckCircle size={14} weight="fill" />
            {t('inventory.save.saved')}
        </span>
    );
}

/** A place's name for a list ("WH1 · Main warehouse"), else its id. */
export const placeLabel = (
    place: { code?: string | null; name?: string | null; id?: string } | null | undefined
): string => {
    if (!place) return '—';
    const parts = [place.code, place.name].filter(Boolean);
    return parts.length ? parts.join(' · ') : (place.id ?? '—');
};

/** Today's date as YYYY-MM-DD, and the same a number of days ago. */
export function isoDaysAgo(days: number, now: Date = new Date()): string {
    const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const two = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** 48 px buttons: the floor works on tablets and phones. */
export const TOUCH = 'h-12';

/** A required choice as large radio buttons (no default unless `value` has one). */
export function ChoiceGroup<V extends string>({
    label,
    value,
    options,
    onChange,
    name,
    columns = 2,
}: {
    label: string;
    value: V | null;
    options: { value: V; label: string; hint?: string }[];
    onChange: (value: V) => void;
    name: string;
    columns?: 1 | 2 | 3;
}) {
    return (
        <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-caption text-muted-foreground">{label}</legend>
            <div
                className={cn(
                    'grid grid-cols-1 gap-2',
                    columns === 2 && 'sm:grid-cols-2',
                    columns === 3 && 'sm:grid-cols-3'
                )}
            >
                {options.map((option) => {
                    const checked = option.value === value;
                    return (
                        <label
                            key={option.value}
                            className={cn(
                                'flex min-h-12 cursor-pointer items-start gap-2 rounded-md border p-3 text-body',
                                checked ? 'border-primary-500 bg-primary-50' : 'border-neutral-300 hover:border-primary-200'
                            )}
                        >
                            <input
                                type="radio"
                                name={name}
                                value={option.value}
                                checked={checked}
                                onChange={() => onChange(option.value)}
                                className="mt-1 size-4 shrink-0 accent-primary-500"
                            />
                            <span className="flex flex-col">
                                <span className="text-foreground">{option.label}</span>
                                {option.hint && <span className="text-caption text-muted-foreground">{option.hint}</span>}
                            </span>
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
}

/** A number typed in display units (2.5 m), read back to base units; null when it is not a number. */
export function parseDisplayQuantity(text: string, scale: number): number | null {
    const trimmed = text.trim().replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return null;
    return Math.round(value * Math.max(1, scale));
}

/** A collection's name in the admin's language, else any name it has. */
export const collectionName = (
    c: { id: string; slug?: string | null; name_i18n?: Record<string, string> | null },
    lang: 'hi' | 'en'
): string => c.name_i18n?.[lang] || c.name_i18n?.en || c.name_i18n?.hi || c.slug || c.id;
