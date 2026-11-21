import { useCallback, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { TokenKey } from '@/constants/auth/tokens';
import { getInstituteId } from '@/constants/helper';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { COMMERCE_FEATURE, COMMERCE_ROLE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import {
    fetchChallanSeries,
    fetchCount,
    fetchCountReview,
    fetchCounts,
    fetchInventoryLocations,
    fetchLabels,
    fetchLabelsToReplace,
    fetchLowStock,
    fetchMovements,
    fetchOpeningReadiness,
    fetchOverview,
    fetchReceipt,
    fetchReceipts,
    fetchStockApprovers,
    fetchTransfer,
    fetchTransfers,
    searchVariants,
} from './inventory-api';
import type { InventoryLocation, LowKind, MovementFilters, OverviewFilter } from './inventory-types';

/**
 * Query bindings of the inventory screens. Every key starts with
 * `['commerce', <institute>, 'inventory']`, so one invalidation refreshes them
 * all after a write. Every query waits until the person's access is known and
 * opens the inventory screen (`commerce-inventory`: store manager, warehouse
 * staff, institute admin): a cashier, an accountant without the item or an
 * institute without the module fires no request.
 */

const LIST_STALE_MS = 15 * 1000;
const REFERENCE_STALE_MS = 5 * 60 * 1000;

export const inventoryRoot = () => ['commerce', getInstituteId() ?? 'none', 'inventory'] as const;

export const inventoryKeys = {
    all: () => inventoryRoot(),
    locations: () => [...inventoryRoot(), 'locations'] as const,
    approvers: (locationId: string) => [...inventoryRoot(), 'approvers', locationId] as const,
    variants: (q: string, locationId: string) => [...inventoryRoot(), 'variants', q, locationId] as const,
    overview: (args: object) => [...inventoryRoot(), 'overview', args] as const,
    low: (args: object) => [...inventoryRoot(), 'low', args] as const,
    movements: (filters: MovementFilters) => [...inventoryRoot(), 'movements', filters] as const,
    receipts: (args: object) => [...inventoryRoot(), 'receipts', args] as const,
    receipt: (id: string) => [...inventoryRoot(), 'receipt', id] as const,
    transfers: (args: object) => [...inventoryRoot(), 'transfers', args] as const,
    transfer: (id: string) => [...inventoryRoot(), 'transfer', id] as const,
    challanSeries: () => [...inventoryRoot(), 'challan-series'] as const,
    counts: (args: object) => [...inventoryRoot(), 'counts', args] as const,
    count: (id: string) => [...inventoryRoot(), 'count', id] as const,
    review: (id: string) => [...inventoryRoot(), 'review', id] as const,
    labels: (args: object) => [...inventoryRoot(), 'labels', args] as const,
    toReplace: (locationId: string) => [...inventoryRoot(), 'to-replace', locationId] as const,
    opening: (locationId: string) => [...inventoryRoot(), 'opening', locationId] as const,
};

/** Who is looking: the gate of every query and the manager-only parts. */
export function useInventoryAccess() {
    const access = useCommerceAccess();
    return useMemo(() => {
        const enabled = access.isResolved && access.canOpen('commerce-inventory') && !!getInstituteId();
        return {
            enabled,
            isManager: access.isManager,
            isAdmin: access.isAdmin,
            /** Cost is shown to managers and the accountant (and admins). */
            seesCost: access.isManager || access.commerceRoles.includes(COMMERCE_ROLE.ACCOUNTANT),
        };
    }, [access]);
}

/** The signed-in person's user id (who started a count), or null when it cannot be read. */
export function currentUserId(): string | null {
    try {
        return getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user ?? null;
    } catch {
        return null;
    }
}

export function useInvalidateInventory() {
    const queryClient = useQueryClient();
    return useCallback(() => queryClient.invalidateQueries({ queryKey: inventoryRoot() }), [queryClient]);
}

// ─── Places ──────────────────────────────────────────────────────────────────

export function useInventoryLocations() {
    const { enabled } = useInventoryAccess();
    return useQuery({
        queryKey: inventoryKeys.locations(),
        queryFn: fetchInventoryLocations,
        enabled,
        staleTime: REFERENCE_STALE_MS,
    });
}

/** The places the person works at (ADMIN: all), active first, by code. */
export function assignedLocations(all: InventoryLocation[] | undefined): InventoryLocation[] {
    return (all ?? [])
        .filter((l) => l.assigned)
        .sort((a, b) => {
            const activeA = a.status === 'INACTIVE' ? 1 : 0;
            const activeB = b.status === 'INACTIVE' ? 1 : 0;
            return activeA - activeB || a.code.localeCompare(b.code);
        });
}

const LOCATION_MEMORY = (instituteId: string) => `commerce.inventory.location.${instituteId}`;

export function readRememberedLocation(): string | null {
    try {
        return globalThis.localStorage?.getItem(LOCATION_MEMORY(getInstituteId() ?? 'none')) ?? null;
    } catch {
        return null;
    }
}

export function rememberLocation(value: string): void {
    try {
        globalThis.localStorage?.setItem(LOCATION_MEMORY(getInstituteId() ?? 'none'), value);
    } catch {
        // Blocked storage: the address still holds the choice.
    }
}

export function useStockApprovers(locationId: string | null, enabled: boolean) {
    const access = useInventoryAccess();
    return useQuery({
        queryKey: inventoryKeys.approvers(locationId ?? ''),
        queryFn: () => fetchStockApprovers(locationId as string),
        enabled: access.enabled && enabled && !!locationId,
        staleTime: LIST_STALE_MS,
    });
}

export function useVariantSearch(q: string, locationId: string | null) {
    const { enabled } = useInventoryAccess();
    const text = q.trim();
    return useQuery({
        queryKey: inventoryKeys.variants(text, locationId ?? ''),
        queryFn: () => searchVariants({ q: text, locationId: locationId ?? undefined }),
        enabled: enabled && text.length >= 2 && text.length <= 64,
        staleTime: LIST_STALE_MS,
        placeholderData: keepPreviousData,
    });
}

// ─── Lists and views ─────────────────────────────────────────────────────────

export function useOverview(args: {
    locationIds: string[];
    q: string;
    filter: OverviewFilter;
    collectionId: string;
    page: number;
    size: number;
}) {
    const { enabled } = useInventoryAccess();
    return useQuery({
        queryKey: inventoryKeys.overview(args),
        queryFn: () => fetchOverview(args),
        enabled: enabled && args.locationIds.length > 0,
        staleTime: LIST_STALE_MS,
        placeholderData: keepPreviousData,
    });
}

export function useLowStock(args: { locationId: string | null; kind: LowKind; page: number; size: number }) {
    const { enabled } = useInventoryAccess();
    return useQuery({
        queryKey: inventoryKeys.low(args),
        queryFn: () => fetchLowStock({ ...args, locationId: args.locationId as string }),
        enabled: enabled && !!args.locationId,
        staleTime: LIST_STALE_MS,
    });
}

export function useMovements(filters: MovementFilters) {
    const { enabled } = useInventoryAccess();
    return useQuery({
        queryKey: inventoryKeys.movements(filters),
        queryFn: () => fetchMovements(filters),
        enabled,
        staleTime: LIST_STALE_MS,
        placeholderData: keepPreviousData,
    });
}

export function useReceipts(args: { locationId: string | null; page: number; size: number }) {
    const { enabled } = useInventoryAccess();
    return useQuery({
        queryKey: inventoryKeys.receipts(args),
        queryFn: () => fetchReceipts({ ...args, locationId: args.locationId ?? undefined }),
        enabled: enabled && !!args.locationId,
        staleTime: LIST_STALE_MS,
    });
}

export function useReceipt(id: string) {
    const { enabled } = useInventoryAccess();
    return useQuery({ queryKey: inventoryKeys.receipt(id), queryFn: () => fetchReceipt(id), enabled: enabled && !!id });
}

export function useTransfers(args: {
    status?: string;
    direction?: string;
    locationId?: string;
    page: number;
    size: number;
}) {
    const { enabled } = useInventoryAccess();
    return useQuery({
        queryKey: inventoryKeys.transfers(args),
        queryFn: () => fetchTransfers(args),
        enabled,
        staleTime: LIST_STALE_MS,
        placeholderData: keepPreviousData,
    });
}

export function useTransfer(id: string) {
    const { enabled } = useInventoryAccess();
    return useQuery({ queryKey: inventoryKeys.transfer(id), queryFn: () => fetchTransfer(id), enabled: enabled && !!id });
}

export function useChallanSeries(enabled: boolean) {
    const access = useInventoryAccess();
    return useQuery({
        queryKey: inventoryKeys.challanSeries(),
        queryFn: fetchChallanSeries,
        enabled: access.enabled && enabled,
        staleTime: REFERENCE_STALE_MS,
    });
}

export function useCounts(args: { locationId?: string; status?: string; kind?: string; page: number; size: number }) {
    const { enabled } = useInventoryAccess();
    return useQuery({
        queryKey: inventoryKeys.counts(args),
        queryFn: () => fetchCounts(args),
        enabled,
        staleTime: LIST_STALE_MS,
        placeholderData: keepPreviousData,
    });
}

export function useCount(id: string) {
    const { enabled } = useInventoryAccess();
    return useQuery({ queryKey: inventoryKeys.count(id), queryFn: () => fetchCount(id), enabled: enabled && !!id });
}

/** The differences, read only when asked for (never while counting blind). */
/** `forPost`: the review a post binds to (read on the primary); the panel's review stays on the replica. */
export function useCountReview(id: string, open: boolean, forPost = false) {
    const { enabled } = useInventoryAccess();
    return useQuery({
        queryKey: forPost ? ([...inventoryKeys.review(id), 'post'] as const) : inventoryKeys.review(id),
        queryFn: () => fetchCountReview(id, forPost),
        enabled: enabled && open && !!id,
        staleTime: 0,
    });
}

export function useLabels(args: {
    locationId?: string;
    status?: string;
    sourceType?: string;
    sourceId?: string;
    page: number;
    size: number;
}) {
    const { enabled } = useInventoryAccess();
    return useQuery({
        queryKey: inventoryKeys.labels(args),
        queryFn: () => fetchLabels(args),
        enabled: enabled && (!!args.locationId || !!args.sourceId),
        staleTime: LIST_STALE_MS,
    });
}

export function useLabelsToReplace(locationId: string | null, open: boolean) {
    const { enabled } = useInventoryAccess();
    return useQuery({
        queryKey: inventoryKeys.toReplace(locationId ?? ''),
        queryFn: () => fetchLabelsToReplace(locationId as string),
        enabled: enabled && open && !!locationId,
        staleTime: LIST_STALE_MS,
    });
}

/**
 * Opening-stock readiness of one place (WP-53). Asked only when the institute has the
 * switch-over feature and a single place is chosen.
 */
export function useOpeningReadiness(locationId: string | null) {
    const { enabled } = useInventoryAccess();
    const access = useCommerceAccess();
    const featureOn = access.isFeatureOn(COMMERCE_FEATURE.MIGRATION);
    return useQuery({
        queryKey: inventoryKeys.opening(locationId ?? ''),
        queryFn: () => fetchOpeningReadiness(locationId as string),
        enabled: enabled && featureOn && !!locationId,
        staleTime: LIST_STALE_MS,
    });
}
