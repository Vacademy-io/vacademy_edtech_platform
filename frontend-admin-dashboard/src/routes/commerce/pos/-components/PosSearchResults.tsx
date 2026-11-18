import { useTranslation } from 'react-i18next';
import { Plus } from '@phosphor-icons/react';
import { pickText } from '../-shared/pos-cart';
import type { CatalogueItem } from '../-shared/pos-types';
import { rupees, stockHint, usePosLang } from './pos-ui';

/** Typed-search matches under the scan box; one tap adds the item. */
export function PosSearchResults({
    items,
    loading,
    onPick,
}: {
    items: CatalogueItem[];
    loading?: boolean;
    onPick: (item: CatalogueItem) => void;
}) {
    const { t } = useTranslation('commerce');
    const lang = usePosLang();
    if (loading && items.length === 0) {
        return <p className="px-1 text-body text-muted-foreground">{t('pos.sell.searching')}</p>;
    }
    if (items.length === 0) {
        return <p className="px-1 text-body text-muted-foreground">{t('pos.sell.noMatch')}</p>;
    }
    return (
        <ul aria-label={t('pos.sell.results')} className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {items.map((item) => {
                const variant = pickText(item.variant_label, lang);
                return (
                    <li key={item.variant_id}>
                        <button
                            type="button"
                            onClick={() => onPick(item)}
                            className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start hover:bg-primary-50"
                        >
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-body font-medium text-foreground">
                                    {pickText(item.names, lang) || item.sku}
                                    {variant ? ` · ${variant}` : ''}
                                </span>
                                <span className="truncate text-caption text-muted-foreground">
                                    {[item.sku, stockHint(t, item.on_hand, item.qty_scale, item.unit)]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </span>
                            </span>
                            <span className="shrink-0 tabular-nums text-body text-foreground">{rupees(item.unit_price)}</span>
                            <Plus size={20} className="shrink-0 text-primary-500" />
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
