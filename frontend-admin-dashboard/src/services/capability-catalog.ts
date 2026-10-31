import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CAPABILITIES_CATALOG } from '@/constants/urls';
import { type CapabilityCatalog, normalizeCatalog } from '@/lib/capabilities/entitlement';

/**
 * Capability catalogue — GET /admin-core-service/capabilities/v1/catalog → {catalog, nav}
 * (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §12.2).
 *
 * Only MANAGED institutes need it, so the query is enabled by the caller and a
 * LEGACY institute never sends the request. The catalogue changes only with a
 * deploy, so one fetch per page session is enough. A failure or a malformed body
 * resolves to null, which callers treat as "no catalogue" = nothing is gated.
 */

export const CAPABILITY_CATALOG_QUERY_KEY = ['capabilities', 'catalog'] as const;

export function normalizeCatalogResponse(raw: unknown): CapabilityCatalog | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return normalizeCatalog((raw as Record<string, unknown>).catalog);
}

export async function fetchCapabilityCatalog(): Promise<CapabilityCatalog | null> {
    const res = await authenticatedAxiosInstance.get<unknown>(CAPABILITIES_CATALOG);
    return normalizeCatalogResponse(res.data);
}

export function useCapabilityCatalog(enabled: boolean) {
    return useQuery({
        queryKey: CAPABILITY_CATALOG_QUERY_KEY,
        queryFn: fetchCapabilityCatalog,
        enabled,
        staleTime: Infinity,
        gcTime: Infinity,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
}
