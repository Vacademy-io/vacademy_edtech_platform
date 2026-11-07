import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import type {
    CatalogueFilters,
    CatalogueResponse,
    FacetValues,
    LibraryListing,
    LibraryListingDetail,
    LibraryTaxonomy,
    ListingDraft,
    ListingStatus,
    PublisherListingRow,
    UnlockResult,
} from '../-types/library';

const BASE = `${AI_SERVICE_BASE_URL}/knowledge-base/v1/library`;

// ---- Catalogue -------------------------------------------------------------

/** Published libraries, each flagged with whether this institute owns it. */
export const getCatalogue = async (filters: CatalogueFilters = {}): Promise<CatalogueResponse> => {
    const { data } = await authenticatedAxiosInstance.get<CatalogueResponse>(
        `${BASE}/catalogue`,
        // Empty strings would filter on "" and return nothing, so drop them.
        {
            params: Object.fromEntries(
                Object.entries(filters).filter(([, v]) => v !== undefined && v !== '')
            ),
        }
    );
    return data;
};

/**
 * Every board, exam, class and subject the picker offers, each counted.
 * Counts are per medium when one is given, across all mediums otherwise.
 */
export const getTaxonomy = async (language?: string): Promise<LibraryTaxonomy> => {
    const { data } = await authenticatedAxiosInstance.get<LibraryTaxonomy>(`${BASE}/taxonomy`, {
        params: language ? { language } : {},
    });
    return data;
};

/** The filter values that actually exist, so the UI never offers a dead filter. */
export const getFacetValues = async (): Promise<FacetValues> => {
    const { data } = await authenticatedAxiosInstance.get<FacetValues>(`${BASE}/facets`);
    return data;
};

export const getListing = async (kbId: string): Promise<LibraryListingDetail> => {
    const { data } = await authenticatedAxiosInstance.get<LibraryListingDetail>(`${BASE}/${kbId}`);
    return data;
};

/**
 * Buy permanent access.
 *
 * Safe to call twice: the server answers 200 with already_owned rather than
 * charging again, because the entitlement row is unique per institute.
 */
export const unlockLibrary = async (kbId: string): Promise<UnlockResult> => {
    const { data } = await authenticatedAxiosInstance.post<UnlockResult>(
        `${BASE}/${kbId}/unlock`,
        {}
    );
    return data;
};

// ---- Publishing (internal institute only) ----------------------------------

export const getPublisherListings = async (): Promise<PublisherListingRow[]> => {
    const { data } = await authenticatedAxiosInstance.get<{ listings: PublisherListingRow[] }>(
        `${BASE}/publisher/listings`
    );
    return data.listings;
};

export const saveListing = async (kbId: string, draft: ListingDraft): Promise<LibraryListing> => {
    const { data } = await authenticatedAxiosInstance.put<LibraryListing>(
        `${BASE}/${kbId}/listing`,
        draft
    );
    return data;
};

/** Publish, withdraw from sale, or return to draft. */
export const setListingStatus = async (
    kbId: string,
    status: ListingStatus
): Promise<LibraryListing> => {
    const { data } = await authenticatedAxiosInstance.post<LibraryListing>(
        `${BASE}/${kbId}/listing/status`,
        { status }
    );
    return data;
};
