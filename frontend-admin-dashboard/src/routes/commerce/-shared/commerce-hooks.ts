import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import {
    type ProductListFilters,
    fetchCollections,
    fetchCommerceStaff,
    fetchLocations,
    fetchMyPinStatus,
    fetchProducts,
    fetchStaffLocations,
    fetchTaxClasses,
    fetchTaxSettings,
    saveLocation,
    saveMyPin,
    saveStaffLocations,
    saveTaxClass,
    saveTaxSettings,
} from './commerce-api';
import type {
    CommerceLocationRequest,
    CommerceTaxSettingsRequest,
    StaffLocationsRequest,
    TaxClassRequest,
} from './commerce-types';

/**
 * TanStack Query bindings for the commerce admin API. Fetchers live in
 * `commerce-api`; this module owns the keys and the invalidation.
 *
 * Every key starts with the institute, so switching institute never shows the
 * previous shop's rows. `enabled` lets a screen hold a query back until the
 * person's role is known to be allowed: a warehouse login must not fire the
 * manager-only reads and collect 403s.
 */

const REFERENCE_STALE_MS = 5 * 60 * 1000; // setup data barely changes
const LIST_STALE_MS = 30 * 1000;

const root = () => ['commerce', getInstituteId() ?? 'none'] as const;

export const commerceKeys = {
    all: () => root(),
    taxSettings: () => [...root(), 'tax-settings'] as const,
    taxClasses: () => [...root(), 'tax-classes'] as const,
    locations: () => [...root(), 'locations'] as const,
    staff: () => [...root(), 'staff'] as const,
    staffLocations: (userId: string) => [...root(), 'staff-locations', userId] as const,
    myPin: () => [...root(), 'my-pin'] as const,
    products: (filters: ProductListFilters) => [...root(), 'products', filters] as const,
    collections: (page: number, size: number) => [...root(), 'collections', page, size] as const,
};

const isOn = (enabled: boolean | undefined) => enabled !== false && !!getInstituteId();

// ───────────────────────── Reads ─────────────────────────

export const useTaxSettings = (enabled?: boolean) =>
    useQuery({
        queryKey: commerceKeys.taxSettings(),
        queryFn: fetchTaxSettings,
        enabled: isOn(enabled),
        staleTime: REFERENCE_STALE_MS,
    });

export const useTaxClasses = (enabled?: boolean) =>
    useQuery({
        queryKey: commerceKeys.taxClasses(),
        queryFn: fetchTaxClasses,
        enabled: isOn(enabled),
        staleTime: REFERENCE_STALE_MS,
    });

export const useLocations = (enabled?: boolean) =>
    useQuery({
        queryKey: commerceKeys.locations(),
        queryFn: fetchLocations,
        enabled: isOn(enabled),
        staleTime: REFERENCE_STALE_MS,
    });

export const useCommerceStaff = (enabled?: boolean) =>
    useQuery({
        queryKey: commerceKeys.staff(),
        queryFn: fetchCommerceStaff,
        enabled: isOn(enabled),
        staleTime: LIST_STALE_MS,
    });

export const useStaffLocations = (userId: string | null | undefined, enabled?: boolean) =>
    useQuery({
        queryKey: commerceKeys.staffLocations(userId ?? ''),
        queryFn: () => fetchStaffLocations(userId as string),
        enabled: isOn(enabled) && !!userId,
        staleTime: LIST_STALE_MS,
    });

export const useMyPinStatus = (enabled?: boolean) =>
    useQuery({
        queryKey: commerceKeys.myPin(),
        queryFn: fetchMyPinStatus,
        enabled: isOn(enabled),
        staleTime: REFERENCE_STALE_MS,
    });

export const useProducts = (filters: ProductListFilters = {}, enabled?: boolean) =>
    useQuery({
        queryKey: commerceKeys.products(filters),
        queryFn: () => fetchProducts(filters),
        enabled: isOn(enabled),
        staleTime: LIST_STALE_MS,
    });

export const useCollections = (page = 0, size = 50, enabled?: boolean) =>
    useQuery({
        queryKey: commerceKeys.collections(page, size),
        queryFn: () => fetchCollections(page, size),
        enabled: isOn(enabled),
        staleTime: LIST_STALE_MS,
    });

// ───────────────────────── Mutations ─────────────────────────

export const useSaveTaxSettings = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (body: CommerceTaxSettingsRequest) => saveTaxSettings(body),
        onSuccess: (saved) => {
            queryClient.setQueryData(commerceKeys.taxSettings(), saved);
            // Tax classes are hidden outside REGULAR; the checklist reads both.
            void queryClient.invalidateQueries({ queryKey: commerceKeys.taxSettings() });
        },
    });
};

export const useSaveTaxClass = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ body, id }: { body: TaxClassRequest; id?: string }) =>
            saveTaxClass(body, id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: commerceKeys.taxClasses() }),
    });
};

export const useSaveLocation = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ body, id }: { body: CommerceLocationRequest; id?: string }) =>
            saveLocation(body, id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: commerceKeys.locations() }),
    });
};

export const useSaveStaffLocations = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (body: StaffLocationsRequest) => saveStaffLocations(body),
        onSuccess: (saved) =>
            queryClient.setQueryData(commerceKeys.staffLocations(saved.user_id), saved),
    });
};

export const useSaveMyPin = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (pin: string) => saveMyPin(pin),
        onSuccess: (saved) => queryClient.setQueryData(commerceKeys.myPin(), saved),
    });
};
