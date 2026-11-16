import type { CommerceLocation, CommerceTaxSettings, TaxClass } from './commerce-types';

/**
 * The setup checklist on Commerce Home: nine items, each linking
 * to its Settings card. Pure, so the rules are testable: which items are done,
 * which are not needed, which wait for a backend that is not built yet.
 *
 * The tenth item (accounts: opening balances) belongs to `commerce.accounts`
 * and is added with that feature.
 */
export type SetupItemId =
    | 'business'
    | 'locations'
    | 'onlineFulfilment'
    | 'taxClasses'
    | 'shipping'
    | 'payments'
    | 'documentSeries'
    | 'labels'
    | 'staff';

export type SetupItemStatus = 'DONE' | 'TODO' | 'NOT_NEEDED' | 'COMING_SOON' | 'UNKNOWN';

export interface SetupItem {
    id: SetupItemId;
    /** 1-based position in the checklist. */
    number: number;
    status: SetupItemStatus;
    /** The Settings page that completes it; null while that page is not built. */
    to: string | null;
    /** Items 1 to 6 must be complete before the shop can take an order. */
    blocksOrders: boolean;
}

/** `undefined` = not loaded or could not be read (status UNKNOWN, never TODO). */
export interface SetupInputs {
    taxSettings: CommerceTaxSettings | undefined;
    locations: CommerceLocation[] | undefined;
    taxClasses: TaxClass[] | undefined;
    hasPin: boolean | undefined;
}

const businessStatus = (settings: CommerceTaxSettings | undefined): SetupItemStatus => {
    if (!settings) return 'UNKNOWN';
    if (!settings.tax_mode) return 'TODO';
    if (settings.tax_mode === 'REGULAR' && !settings.seller_gstin) return 'TODO';
    return settings.seller_state_code ? 'DONE' : 'TODO';
};

const taxClassStatus = (
    settings: CommerceTaxSettings | undefined,
    taxClasses: TaxClass[] | undefined
): SetupItemStatus => {
    if (!settings) return 'UNKNOWN';
    // Tax classes exist only in tax mode REGULAR; the others print no tax lines.
    if (settings.tax_mode && settings.tax_mode !== 'REGULAR') return 'NOT_NEEDED';
    if (!taxClasses) return 'UNKNOWN';
    return taxClasses.some((taxClass) => taxClass.rules.length > 0) ? 'DONE' : 'TODO';
};

export function buildSetupChecklist(inputs: SetupInputs): SetupItem[] {
    const { taxSettings, locations, taxClasses, hasPin } = inputs;
    const activeLocations = locations?.filter(
        (location) => (location.status ?? 'ACTIVE').toUpperCase() !== 'INACTIVE'
    );
    const item = (
        number: number,
        id: SetupItemId,
        status: SetupItemStatus,
        to: string | null
    ): SetupItem => ({ id, number, status, to, blocksOrders: number <= 6 });

    return [
        item(1, 'business', businessStatus(taxSettings), '/commerce/settings/business'),
        item(
            2,
            'locations',
            !activeLocations ? 'UNKNOWN' : activeLocations.length > 0 ? 'DONE' : 'TODO',
            '/commerce/settings/locations'
        ),
        // Picking the location that ships website orders is a setting whose
        // endpoint is not built; a location already marked as selling online
        // (set by the server) counts as done.
        item(
            3,
            'onlineFulfilment',
            !activeLocations
                ? 'UNKNOWN'
                : activeLocations.some((location) => location.sells_online)
                  ? 'DONE'
                  : 'COMING_SOON',
            null
        ),
        item(
            4,
            'taxClasses',
            taxClassStatus(taxSettings, taxClasses),
            '/commerce/settings/tax-classes'
        ),
        item(5, 'shipping', 'COMING_SOON', null),
        item(6, 'payments', 'COMING_SOON', null),
        item(7, 'documentSeries', 'COMING_SOON', null),
        item(8, 'labels', 'COMING_SOON', null),
        item(
            9,
            'staff',
            hasPin === undefined ? 'UNKNOWN' : hasPin ? 'DONE' : 'TODO',
            '/commerce/settings/staff'
        ),
    ];
}

export interface SetupProgress {
    done: number;
    /** Items that can be completed today (not "coming soon", not "not needed"). */
    actionable: number;
    remaining: SetupItem[];
}

export function setupProgress(items: SetupItem[]): SetupProgress {
    const actionable = items.filter(
        (i) => i.status === 'DONE' || i.status === 'TODO' || i.status === 'UNKNOWN'
    );
    return {
        done: actionable.filter((i) => i.status === 'DONE').length,
        actionable: actionable.length,
        remaining: items.filter((i) => i.status === 'TODO'),
    };
}
