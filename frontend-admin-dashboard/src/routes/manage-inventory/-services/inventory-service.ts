import { BASE_URL, PAGINATED_BATCHES, BATCHES_SUMMARY } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    InventoryAvailability,
    UpdateCapacityRequest,
    PaginatedBatchesResponse,
    BatchAvailabilityMap,
    BatchesSummaryResponse,
    InventoryFilters,
    InventoryStats,
} from '../-types/inventory-types';

/**
 * Base URL for inventory management endpoints
 */
const INVENTORY_BASE = (packageSessionId: string) =>
    `${BASE_URL}/admin-core-service/package-session/${packageSessionId}/inventory`;

/**
 * Fills in heldSlots from whichever spelling the server used (`heldSlots` or `held_slots`), and
 * 0 when it sends neither (older servers hold no stock), so screens can rely on the number.
 */
const withHeldSlots = (availability: InventoryAvailability): InventoryAvailability => ({
    ...availability,
    heldSlots: availability.heldSlots ?? availability.held_slots ?? 0,
});

/**
 * Get availability for a specific package session
 */
export const getInventoryAvailability = async (
    packageSessionId: string
): Promise<InventoryAvailability> => {
    const response = await authenticatedAxiosInstance<InventoryAvailability>({
        method: 'GET',
        url: `${INVENTORY_BASE(packageSessionId)}/availability`,
    });
    return withHeldSlots(response.data);
};

/**
 * Update capacity (max_seats) for a package session
 * Pass null for unlimited capacity
 */
export const updateInventoryCapacity = async (
    packageSessionId: string,
    maxSeats: number | null,
    availableSlots: number | null
): Promise<any> => {
    const payload: UpdateCapacityRequest = { max_seats: maxSeats, available_slots: availableSlots };
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: `${INVENTORY_BASE(packageSessionId)}/update-capacity`,
        data: payload,
    });
    return response.data;
};

/**
 * Reserve a slot for a package session
 */
export const reserveInventorySlot = async (packageSessionId: string): Promise<string> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${INVENTORY_BASE(packageSessionId)}/reserve`,
    });
    return response.data;
};

/**
 * Release a slot for a package session
 */
export const releaseInventorySlot = async (packageSessionId: string): Promise<string> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${INVENTORY_BASE(packageSessionId)}/release`,
    });
    return response.data;
};

/**
 * Fetch paginated batches for the current institute
 */
export const fetchPaginatedBatches = async (
    filters: InventoryFilters,
    page: number,
    size: number
): Promise<PaginatedBatchesResponse> => {
    const instituteId = getCurrentInstituteId();

    const params = new URLSearchParams();
    params.append('page', String(page));
    params.append('size', String(size));

    if (filters.courseId) params.append('packageId', filters.courseId);
    if (filters.levelId) params.append('levelId', filters.levelId);
    if (filters.sessionId) params.append('sessionId', filters.sessionId);
    if (filters.search) params.append('search', filters.search);
    params.append('statuses', 'ACTIVE');
    params.append('sortBy', 'package_name');
    params.append('sortDirection', 'ASC');

    const response = await authenticatedAxiosInstance<PaginatedBatchesResponse>({
        method: 'GET',
        url: `${PAGINATED_BATCHES}/${instituteId}?${params.toString()}`,
    });

    return response.data;
};

/**
 * Fetch inventory availability for multiple package sessions in one call
 */
export const fetchBatchInventoryAvailability = async (
    packageSessionIds: string[]
): Promise<BatchAvailabilityMap> => {
    if (packageSessionIds.length === 0) return {};

    const response = await authenticatedAxiosInstance<BatchAvailabilityMap>({
        method: 'POST',
        url: `${BASE_URL}/admin-core-service/package-session/inventory/batch-availability`,
        data: packageSessionIds,
    });

    return Object.fromEntries(
        Object.entries(response.data).map(([id, availability]) => [
            id,
            withHeldSlots(availability),
        ])
    );
};

/**
 * Fetch batches summary for filter dropdowns
 */
export const fetchBatchesSummary = async (): Promise<BatchesSummaryResponse> => {
    const instituteId = getCurrentInstituteId();

    const response = await authenticatedAxiosInstance<BatchesSummaryResponse>({
        method: 'GET',
        url: `${BATCHES_SUMMARY}/${instituteId}`,
    });

    return response.data;
};

/**
 * Fetch aggregated inventory stats for the entire institute
 */
export const fetchInventoryStats = async (): Promise<InventoryStats> => {
    const instituteId = getCurrentInstituteId();

    const response = await authenticatedAxiosInstance<InventoryStats>({
        method: 'GET',
        url: `${BASE_URL}/admin-core-service/package-session/inventory/stats`,
        params: { instituteId },
    });

    return response.data;
};
