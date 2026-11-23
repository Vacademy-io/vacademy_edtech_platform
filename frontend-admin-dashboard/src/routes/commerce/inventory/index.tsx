import { createFileRoute } from '@tanstack/react-router';
import { INVENTORY_TABS, type InventoryTab } from './-shared/inventory-types';

/** Tab, place and the movements item filter live in the address (deep links, Back). */
export interface InventorySearch {
    tab?: InventoryTab;
    /** A location id, or `all` for every place the person works at. */
    location?: string;
    /** A package session id: the Movements tab filtered to that item. */
    item?: string;
}

const text = (value: unknown, max = 64): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined;

export const Route = createFileRoute('/commerce/inventory/')({
    validateSearch: (search: Record<string, unknown>): InventorySearch => {
        const tab = text(search.tab, 16);
        return {
            tab: tab && (INVENTORY_TABS as readonly string[]).includes(tab) ? (tab as InventoryTab) : undefined,
            location: text(search.location),
            item: text(search.item, 255),
        };
    },
});
