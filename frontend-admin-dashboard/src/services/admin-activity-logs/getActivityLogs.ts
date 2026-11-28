import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    ADMIN_ACTIVITY_LOGS_LIST,
    ADMIN_ACTIVITY_LOG_BY_ID,
    ADMIN_ACTIVITY_LOGS_EXPORT_CSV,
} from '@/constants/urls';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

export interface AdminActivityLog {
    id: string;
    institute_id: string;
    actor_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
    entity_type: string;
    entity_id: string | null;
    action: string;
    http_method: string | null;
    endpoint: string | null;
    description: string | null;
    request_payload: unknown;
    before_payload: unknown;
    ip_address: string | null;
    user_agent: string | null;
    response_status: number | null;
    response_time_ms: number | null;
    created_at: string;
}

export interface AdminActivityLogPage {
    content: AdminActivityLog[];
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
    first: boolean;
    last: boolean;
}

export interface AdminActivityLogFilters {
    startDate?: number;
    endDate?: number;
    /** Actors to include. Empty/undefined means every actor. */
    actorIds?: string[];
    /** Resources to include. Empty/undefined means every resource. */
    entityTypes?: string[];
    entityId?: string;
    /** Activities to include. Empty/undefined means every activity. */
    actions?: string[];
    page?: number;
    size?: number;
}

/**
 * Multi-value filters travel as ONE comma-separated param (`actorId=a,b,c`),
 * never as repeated `actorId[]=` keys: the ingress rejects raw brackets in a
 * query string with a 400 before the request reaches the service. The backend
 * splits on commas and falls back to a plain equality when there is one value.
 */
const csvParam = (values: string[] | undefined): string | undefined => {
    if (!values || values.length === 0) return undefined;
    const cleaned = values.map((v) => v.trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned.join(',') : undefined;
};

const toQueryParams = (
    filters: Omit<AdminActivityLogFilters, 'page' | 'size'>
): Record<string, string | number> => {
    const params: Record<string, string | number> = {};
    if (filters.startDate !== undefined) params.startDate = filters.startDate;
    if (filters.endDate !== undefined) params.endDate = filters.endDate;

    const actorId = csvParam(filters.actorIds);
    if (actorId) params.actorId = actorId;

    const entityType = csvParam(filters.entityTypes);
    if (entityType) params.entityType = entityType;

    const action = csvParam(filters.actions);
    if (action) params.action = action;

    if (filters.entityId) params.entityId = filters.entityId;
    return params;
};

const fetchActivityLogs = async (
    filters: AdminActivityLogFilters
): Promise<AdminActivityLogPage> => {
    const params = {
        ...toQueryParams(filters),
        page: filters.page ?? 0,
        size: filters.size ?? 20,
    };

    const response = await authenticatedAxiosInstance.get<AdminActivityLogPage>(
        ADMIN_ACTIVITY_LOGS_LIST,
        { params }
    );
    return response.data;
};

const fetchActivityLogById = async (id: string): Promise<AdminActivityLog> => {
    const response = await authenticatedAxiosInstance.get<AdminActivityLog>(
        ADMIN_ACTIVITY_LOG_BY_ID(id)
    );
    return response.data;
};

export const useActivityLogs = (filters: AdminActivityLogFilters) =>
    useQuery({
        queryKey: ['admin-activity-logs', filters],
        queryFn: () => fetchActivityLogs(filters),
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    });

export const useActivityLogById = (id: string | null) =>
    useQuery({
        queryKey: ['admin-activity-logs', 'by-id', id],
        queryFn: () => fetchActivityLogById(id as string),
        enabled: !!id,
        staleTime: 60_000,
    });

/**
 * Trigger a CSV download honoring the current filters. Streams the file as
 * a Blob; browser saves it via an anchor click. Backend caps the row count
 * at 50,000 (see AdminActivityLogReadService).
 */
export const exportActivityLogsCsv = async (
    filters: Omit<AdminActivityLogFilters, 'page' | 'size'>
): Promise<void> => {
    const response = await authenticatedAxiosInstance.get<Blob>(ADMIN_ACTIVITY_LOGS_EXPORT_CSV, {
        params: toQueryParams(filters),
        responseType: 'blob',
    });

    // Prefer the filename the backend hints at via Content-Disposition; fall
    // back to a sensible date-stamped name.
    const disposition = response.headers['content-disposition'] as string | undefined;
    const match = disposition?.match(/filename="?([^"]+)"?/);
    const filename =
        match?.[1] || `admin-activity-logs-${new Date().toISOString().slice(0, 10)}.csv`;

    const url = window.URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
};
