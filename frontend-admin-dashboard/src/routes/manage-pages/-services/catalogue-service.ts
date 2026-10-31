import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_CATALOGUE_TAGS,
    CREATE_CATALOGUE,
    UPDATE_CATALOGUE,
    GET_CATALOGUE_BY_TAG,
    CATALOGUE_REVISION_DRAFT,
    CATALOGUE_REVISION_SAVE_DRAFT,
    CATALOGUE_REVISION_PUBLISH,
    CATALOGUE_REVISION_DISCARD,
    CATALOGUE_REVISION_HISTORY,
    CATALOGUE_REVISION_GET,
} from '@/constants/urls';
import { CatalogueTag, CreateCatalogueTagRequest } from '../-types/catalogue-types';
import { CatalogueConfig } from '../-types/editor-types';

// Backend returns array of catalogue objects
interface CatalogueResponse {
    id: string;
    catalogue_json: string;
    tag_name: string;
    status: string;
    source: string;
    source_id?: string;
    institute_id: string;
    is_default: boolean;
    updated_at?: string;
    created_at?: string;
}

export const getCatalogueTags = async (instituteId: string): Promise<CatalogueTag[]> => {
    const response = await authenticatedAxiosInstance.get<CatalogueResponse[]>(
        GET_CATALOGUE_TAGS(instituteId)
    );
    // Transform backend response to match our CatalogueTag type
    return (response.data || []).map((item) => ({
        tagName: item.tag_name,
        status: item.status as 'ACTIVE' | 'DRAFT' | 'ARCHIVED',
        lastModified: item.updated_at || item.created_at || undefined,
        catalogueJson: item.catalogue_json,
        id: item.id,
    }));
};

export const createCatalogueConfig = async (
    instituteId: string,
    data: CreateCatalogueTagRequest
): Promise<void> => {
    // Backend expects array of catalogues
    await authenticatedAxiosInstance.post(CREATE_CATALOGUE(instituteId), {
        catalogues: [
            {
                catalogue_json: data.catalogue_json,
                tag_name: data.tagName,
                status: 'DRAFT',
                source: 'INTERNAL',
                is_default: false,
            },
        ],
    });
};

export const getCatalogueConfig = async (
    instituteId: string,
    tagName: string
): Promise<{ catalogue_json: string }> => {
    const response = await authenticatedAxiosInstance.get<CatalogueResponse>(
        GET_CATALOGUE_BY_TAG(instituteId, tagName)
    );
    return { catalogue_json: response.data.catalogue_json };
};

/** Catalogue with its id — the revision endpoints are keyed by catalogueId. */
export interface CatalogueMeta {
    id: string;
    catalogue_json: string;
    status: string;
    /** When the live JSON last changed — only when the API sends it. */
    updated_at?: string;
}

export const getCatalogueMeta = async (
    instituteId: string,
    tagName: string
): Promise<CatalogueMeta> => {
    const response = await authenticatedAxiosInstance.get<CatalogueResponse>(
        GET_CATALOGUE_BY_TAG(instituteId, tagName)
    );
    return {
        id: response.data.id,
        catalogue_json: response.data.catalogue_json,
        status: response.data.status,
        ...(response.data.updated_at ? { updated_at: response.data.updated_at } : {}),
    };
};

/* ─── Draft / publish revisions (AI Page Builder Phase A) ──────────────── */

export interface CatalogueRevision {
    id: string;
    revision_no: number;
    status: 'DRAFT' | 'PUBLISHED' | 'DISCARDED';
    source?: string;
    ai_run_id?: string;
    created_by_user_id?: string;
    created_at?: string;
    updated_at?: string;
    catalogue_json?: string | null;
    /** Draft only, from servers that compare the draft with the live site:
     *  true when the live site changed after this draft was started. */
    live_changed_since_draft?: boolean;
    live_revision_no?: number;
    live_updated_at?: string;
}

export type DraftSource = 'MANUAL' | 'AI_WIZARD' | 'AI_COPILOT';

/** Latest draft revision, or null when none exists (backend returns 204). */
export const getDraftRevision = async (catalogueId: string): Promise<CatalogueRevision | null> => {
    const response = await authenticatedAxiosInstance.get<CatalogueRevision>(
        CATALOGUE_REVISION_DRAFT(catalogueId)
    );
    return response.status === 204 ? null : response.data;
};

export const saveDraftRevision = async (
    catalogueId: string,
    config: CatalogueConfig,
    /** null = keep the draft's current source (the server defaults a new draft to MANUAL). */
    source: DraftSource | null = 'MANUAL',
    aiRunId?: string,
    /** "Keep my draft": the live site changed after the draft began and the
     *  admin keeps the draft — the server re-bases it, so it is no longer
     *  reported stale (nor refused by the AI tools) until live moves again.
     *  An older server ignores the field. */
    options?: { acknowledgeLive?: boolean }
): Promise<CatalogueRevision> => {
    const response = await authenticatedAxiosInstance.post<CatalogueRevision>(
        CATALOGUE_REVISION_SAVE_DRAFT(catalogueId),
        {
            catalogue_json: JSON.stringify(config),
            ...(source ? { source } : {}),
            ai_run_id: aiRunId,
            ...(options?.acknowledgeLive ? { acknowledge_live: true } : {}),
        }
    );
    return response.data;
};

/**
 * `overrideStale` publishes a draft even though the live site changed after it
 * was started. `expectedLiveRevisionNo` is the live version the editor loaded:
 * the server refuses (409) when the live site has moved on since.
 */
export const publishDraftRevision = async (
    catalogueId: string,
    {
        overrideStale = false,
        expectedLiveRevisionNo,
    }: { overrideStale?: boolean; expectedLiveRevisionNo?: number | null } = {}
): Promise<CatalogueRevision> => {
    let url = CATALOGUE_REVISION_PUBLISH(catalogueId);
    if (overrideStale) url += '&overrideStale=true';
    if (typeof expectedLiveRevisionNo === 'number') {
        url += `&expectedLiveRevisionNo=${expectedLiveRevisionNo}`;
    }
    const response = await authenticatedAxiosInstance.post<CatalogueRevision>(url);
    return response.data;
};

export const discardDraftRevision = async (catalogueId: string): Promise<void> => {
    await authenticatedAxiosInstance.post(CATALOGUE_REVISION_DISCARD(catalogueId));
};

export const getRevisionHistory = async (catalogueId: string): Promise<CatalogueRevision[]> => {
    const response = await authenticatedAxiosInstance.get<CatalogueRevision[]>(
        CATALOGUE_REVISION_HISTORY(catalogueId)
    );
    return response.data || [];
};

export const getRevision = async (revisionId: string): Promise<CatalogueRevision> => {
    const response = await authenticatedAxiosInstance.get<CatalogueRevision>(
        CATALOGUE_REVISION_GET(revisionId)
    );
    return response.data;
};

export const saveCatalogueConfig = async (
    instituteId: string,
    tagName: string,
    config: CatalogueConfig
): Promise<void> => {
    // First, get the catalogue to find its ID
    const catalogue = await authenticatedAxiosInstance.get<CatalogueResponse>(
        GET_CATALOGUE_BY_TAG(instituteId, tagName)
    );

    // Then update using the catalogue ID
    await authenticatedAxiosInstance.put(UPDATE_CATALOGUE(catalogue.data.id), {
        catalogue_json: JSON.stringify(config),
        tag_name: tagName,
        status: catalogue.data.status,
        source: catalogue.data.source,
        source_id: catalogue.data.source_id,
        is_default: catalogue.data.is_default,
    });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const deleteCatalogueConfig = async (
    instituteId: string,
    tagName: string
): Promise<void> => {
    // Backend doesn't have a delete endpoint in the documentation provided
    // This might need to be implemented on backend or use a different approach
    console.warn('Delete catalogue endpoint not yet implemented in backend');
    throw new Error('Delete functionality not available - please archive the catalogue instead');
};
