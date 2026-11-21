import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { useVariantSearch } from '../-shared/inventory-hooks';
import type { VariantPick } from '../-shared/inventory-types';
import { InventoryErrorNotice, Qty } from './inventory-ui';

/** A short pause after typing before searching (one request per word, not per key). */
export function useDebounced<T>(value: T, ms = 300): T {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(timer);
    }, [value, ms]);
    return settled;
}

/** The name to show for a picked item, in the admin's language first. */
export const pickName = (item: VariantPick, lang: 'hi' | 'en'): string =>
    (lang === 'hi' ? (item.names.hi ?? item.names.en) : (item.names.en ?? item.names.hi)) ?? item.product_name ?? item.sku ?? '—';

/**
 * Items matching typed text (`GET /stock/variants`: SKU prefix, label code or
 * barcode, names), as a list of 48 px rows. Product search is manager-only,
 * so every stock screen picks items here.
 */
export function VariantResults({
    text,
    locationId,
    onPick,
    showOnHand,
}: {
    text: string;
    locationId: string | null;
    onPick: (item: VariantPick) => void;
    showOnHand?: boolean;
}) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    const q = useDebounced(text.trim());
    const query = useVariantSearch(q, locationId);
    if (q.length < 2) return null;
    if (query.isLoading) return <CommerceLoadingRows rows={2} />;
    if (query.isError) return <InventoryErrorNotice error={query.error} />;
    const items = query.data ?? [];
    if (items.length === 0) {
        return <p className="text-caption text-muted-foreground">{t('inventory.picker.none')}</p>;
    }
    return (
        <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card">
            {items.map((item) => (
                <li key={item.package_session_id}>
                    <button
                        type="button"
                        onClick={() => onPick(item)}
                        className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none"
                    >
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate text-body text-foreground">{pickName(item, lang)}</span>
                            <span className="truncate text-caption text-muted-foreground">
                                {[item.variant_name, item.sku, item.status === 'DRAFT' ? t('inventory.picker.draft') : null]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                        </span>
                        {showOnHand && item.on_hand !== null && (
                            <span className="shrink-0 text-caption text-muted-foreground">
                                {t('inventory.stock.onHand')}: <Qty qty={item.on_hand} scale={item.qty_scale} unit={item.unit} />
                            </span>
                        )}
                    </button>
                </li>
            ))}
        </ul>
    );
}

/** A search box with its results, for screens without a scan box (filters, reprint). */
export function ItemPicker({
    label,
    locationId,
    onPick,
    selected,
    onClear,
}: {
    label: string;
    locationId: string | null;
    onPick: (item: VariantPick) => void;
    /** The current choice, shown in place of the box (filters). */
    selected?: string | null;
    onClear?: () => void;
}) {
    const { t } = useTranslation('commerce');
    const id = useId();
    const [text, setText] = useState('');
    if (selected) {
        return (
            <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-caption text-muted-foreground">{label}</span>
                <div className="flex h-12 items-center justify-between gap-2 rounded-md border border-neutral-300 px-3 md:h-9">
                    <span className="truncate text-body">{selected}</span>
                    {onClear && (
                        <button
                            type="button"
                            aria-label={t('inventory.picker.clear')}
                            onClick={onClear}
                            className="flex size-9 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
            </div>
        );
    }
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={id} className="text-caption text-muted-foreground">
                {label}
            </label>
            <div className="relative">
                <MagnifyingGlass
                    size={16}
                    className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <input
                    id={id}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder={t('inventory.picker.placeholder')}
                    autoComplete="off"
                    maxLength={64}
                    className="h-12 w-full rounded-md border border-neutral-300 bg-background pe-3 ps-9 text-body focus:border-primary-500 focus:outline-none md:h-9"
                />
            </div>
            <VariantResults
                text={text}
                locationId={locationId}
                onPick={(item) => {
                    setText('');
                    onPick(item);
                }}
            />
        </div>
    );
}
