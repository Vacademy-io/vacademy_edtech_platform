import { useMemo } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { getCatalogueTags } from '../../-services/catalogue-service';
import { findStoreSites, type StoreSiteRef } from '../-utils/store-page';

/**
 * The institute's sites, each with its whole catalogue JSON — the sites list's
 * own query, so whichever screen loads it first fills the cache for the other.
 */
const sitesQuery = (instituteId: string) => ({
    queryKey: ['catalogueTags', instituteId],
    queryFn: () => getCatalogueTags(instituteId),
    staleTime: 60_000,
});

/**
 * The websites whose site cart checks out through this product page (it is
 * their STORE page), or null while that is not known yet. Finding out loads
 * every site's whole catalogue JSON, so `fetch: false` only reads what the
 * sites list already cached and never sends a request — fetchStoreSites then
 * answers when it matters. A null / empty code skips the lookup ([]).
 */
export const useStoreSites = (
    instituteId: string,
    productPageCode: string | null | undefined,
    { fetch = true }: { fetch?: boolean } = {}
): StoreSiteRef[] | null => {
    const hasCode = !!(productPageCode || '').trim();
    const { data: catalogues } = useQuery({
        ...sitesQuery(instituteId),
        enabled: fetch && !!instituteId && hasCode,
    });
    // findStoreSites parses every site's whole catalogue JSON: redo it only
    // when the sites or the code change, not on every parent re-render.
    return useMemo(
        () =>
            hasCode && catalogues === undefined
                ? null
                : findStoreSites(catalogues, productPageCode),
        [hasCode, catalogues, productPageCode]
    );
};

/**
 * The same lookup on demand: no request while the cached sites are under a
 * minute old, one otherwise. Rejects when the sites cannot be loaded.
 */
export const fetchStoreSites = async (
    queryClient: QueryClient,
    instituteId: string,
    productPageCode: string | null | undefined
): Promise<StoreSiteRef[]> => {
    if (!instituteId || !(productPageCode || '').trim()) return [];
    return findStoreSites(await queryClient.fetchQuery(sitesQuery(instituteId)), productPageCode);
};
