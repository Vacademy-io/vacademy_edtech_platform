// Types for Inventory Management System

export interface InventoryAvailability {
    packageSessionId: string;
    maxSeats: number | null;
    availableSlots: number | null;
    isUnlimited: boolean;
    /**
     * Stock reserved by checkouts still in progress (already taken out of availableSlots). The
     * server releases it after 30 minutes or when the payment window is closed. Always set once
     * the response has gone through the inventory service (0 when the server omits it).
     */
    heldSlots?: number;
    /**
     * The spelling the backend contract uses for the same figure, while the sibling fields are
     * camelCase. Only the service reads it, to fill heldSlots.
     */
    held_slots?: number | null;
}

export interface UpdateCapacityRequest {
    max_seats: number | null;
    available_slots: number | null;
}

export interface PackageSessionInventory {
    id: string;
    packageName: string;
    levelName: string;
    sessionName: string;
    status: string;
    startTime: string | null;
    // Inventory fields (fetched separately)
    maxSeats?: number | null;
    availableSlots?: number | null;
    isUnlimited?: boolean;
    /** Stock held by checkouts in progress; see InventoryAvailability.heldSlots. */
    heldSlots?: number;
    isLoadingInventory?: boolean;
}

export type ViewMode = 'table' | 'card';

export interface InventoryFilters {
    courseId?: string;
    levelId?: string;
    sessionId?: string;
    search?: string;
    availabilityStatus?: 'all' | 'limited' | 'unlimited' | 'low';
}

export interface InventoryStats {
    total_sessions: number;
    unlimited_sessions: number;
    limited_sessions: number;
    total_capacity: number;
    total_available: number;
    critical_sessions: number;
    low_availability_sessions: number;
}

// Paginated batches response (from /institute/v1/paginated-batches)
export interface PaginatedBatchesResponse {
    content: PaginatedBatchItem[];
    page_number: number;
    page_size: number;
    total_elements: number;
    total_pages: number;
    first: boolean;
    last: boolean;
    has_next: boolean;
    has_previous: boolean;
}

export interface PaginatedBatchItem {
    id: string;
    name?: string | null;
    level: { id: string; level_name: string };
    session: { id: string; session_name: string };
    start_time: string | null;
    status: string;
    package_dto: { id: string; package_name: string; thumbnail_id?: string | null };
    group?: { id: string; group_name: string } | null;
    read_time_in_minutes?: number;
    is_org_associated?: boolean;
    is_parent?: boolean;
    parent_id?: string | null;
}

// Batch availability response (from /package-session/inventory/batch-availability)
export type BatchAvailabilityMap = Record<string, InventoryAvailability>;

// Batches summary response (from /institute/v1/batches-summary)
export interface BatchesSummaryResponse {
    total_batches: number;
    has_org_associated: boolean;
    packages: { id: string; name: string }[];
    levels: { id: string; name: string }[];
    sessions: { id: string; name: string }[];
}
