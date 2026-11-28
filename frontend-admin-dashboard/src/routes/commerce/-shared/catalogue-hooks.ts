import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import {
    attachProductMedia,
    changeProductStatus,
    deleteAttribute,
    deleteAttributeValue,
    fetchAttributes,
    fetchCollectionProductIds,
    fetchCollectionTree,
    fetchImportColumns,
    fetchImportJob,
    fetchProduct,
    fetchMediaTags,
    fetchProductMedia,
    importJobIsRunning,
    removeProductMedia,
    reorderProductMedia,
    retryMediaRendition,
    saveAttribute,
    saveAttributeValue,
    saveCollection,
    saveCollectionProductIds,
    saveProduct,
    updateProductMedia,
} from './catalogue-api';
import type {
    AttributeRequest,
    AttributeValueRequest,
    CollectionRequest,
    ProductMediaRequest,
    ProductRequest,
} from './catalogue-types';
import { commerceKeys } from './commerce-hooks';
import type { ProductStatus } from './commerce-types';
import { renditionInProgress } from './media-renditions';

/**
 * TanStack Query bindings for the catalogue screens. Keys start with the
 * institute (through `commerceKeys.all`), so another shop's rows never show.
 */

const REFERENCE_STALE_MS = 5 * 60 * 1000;
const LIST_STALE_MS = 30 * 1000;
/** How often a running import is asked for its progress. */
export const IMPORT_POLL_MS = 2000;
const RENDITION_POLL_MS = 10_000;

export const catalogueKeys = {
    productsRoot: () => [...commerceKeys.all(), 'products'] as const,
    product: (id: string) => [...commerceKeys.all(), 'product', id] as const,
    media: (id: string) => [...commerceKeys.all(), 'product-media', id] as const,
    mediaTags: () => [...commerceKeys.all(), 'media-tags'] as const,
    attributes: () => [...commerceKeys.all(), 'attributes'] as const,
    collectionsRoot: () => [...commerceKeys.all(), 'collections'] as const,
    collectionTree: () => [...commerceKeys.all(), 'collections', 'tree'] as const,
    collectionProducts: (id: string) =>
        [...commerceKeys.all(), 'collections', 'products', id] as const,
    importJob: (id: string) => [...commerceKeys.all(), 'import-job', id] as const,
    importColumns: () => [...commerceKeys.all(), 'import-columns'] as const,
};

const isOn = (enabled: boolean | undefined) => enabled !== false && !!getInstituteId();

// ───────────────────────── Reads ─────────────────────────

export const useProduct = (packageId: string | null) =>
    useQuery({
        queryKey: catalogueKeys.product(packageId ?? ''),
        queryFn: () => fetchProduct(packageId as string),
        enabled: isOn(true) && !!packageId,
        staleTime: 0,
        // The editor resets its form to what this query holds; a refetch behind
        // the person's back must not replace what they are typing.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });

export const useProductMedia = (packageId: string | null) =>
    useQuery({
        queryKey: catalogueKeys.media(packageId ?? ''),
        queryFn: () => fetchProductMedia(packageId as string),
        enabled: isOn(true) && !!packageId,
        staleTime: LIST_STALE_MS,
        // Renditions are made after the upload; look again while any is in progress.
        refetchInterval: (query) =>
            (query.state.data ?? []).some((media) => renditionInProgress(media.renditions))
                ? RENDITION_POLL_MS
                : false,
    });

/** The photo tags of the institute; they change rarely, so they are kept for the session. */
export const useMediaTags = () =>
    useQuery({
        queryKey: catalogueKeys.mediaTags(),
        queryFn: fetchMediaTags,
        enabled: isOn(true),
        staleTime: 10 * 60 * 1000,
    });

export const useAttributes = (enabled?: boolean) =>
    useQuery({
        queryKey: catalogueKeys.attributes(),
        queryFn: fetchAttributes,
        enabled: isOn(enabled),
        staleTime: REFERENCE_STALE_MS,
    });

export const useCollectionTree = (enabled?: boolean) =>
    useQuery({
        queryKey: catalogueKeys.collectionTree(),
        queryFn: fetchCollectionTree,
        enabled: isOn(enabled),
        staleTime: LIST_STALE_MS,
    });

export const useCollectionProductIds = (collectionId: string | null) =>
    useQuery({
        queryKey: catalogueKeys.collectionProducts(collectionId ?? ''),
        queryFn: () => fetchCollectionProductIds(collectionId as string),
        enabled: isOn(true) && !!collectionId,
        staleTime: 0,
    });

/** The column guide of the import template; it changes only with a release. */
export const useImportColumns = () =>
    useQuery({
        queryKey: catalogueKeys.importColumns(),
        queryFn: fetchImportColumns,
        enabled: isOn(true),
        staleTime: REFERENCE_STALE_MS,
    });

/** Polls GET /import/{jobId} until the job has finished or failed. */
export const useImportJob = (jobId: string | null) =>
    useQuery({
        queryKey: catalogueKeys.importJob(jobId ?? ''),
        queryFn: () => fetchImportJob(jobId as string),
        enabled: isOn(true) && !!jobId,
        staleTime: 0,
        refetchInterval: (query) =>
            !query.state.data || importJobIsRunning(query.state.data) ? IMPORT_POLL_MS : false,
    });

// ───────────────────────── Mutations ─────────────────────────

export const useSaveProduct = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ body, id }: { body: ProductRequest; id?: string }) => saveProduct(body, id),
        onSuccess: (saved) => {
            queryClient.setQueryData(catalogueKeys.product(saved.package_id), saved);
            void queryClient.invalidateQueries({ queryKey: catalogueKeys.productsRoot() });
        },
    });
};

export const useChangeProductStatus = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, status }: { id: string; status: ProductStatus }) =>
            changeProductStatus(id, status),
        onSuccess: (saved) => {
            queryClient.setQueryData(catalogueKeys.product(saved.package_id), saved);
            void queryClient.invalidateQueries({ queryKey: catalogueKeys.productsRoot() });
        },
    });
};

export const useSaveAttribute = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ body, id }: { body: AttributeRequest; id?: string }) =>
            saveAttribute(body, id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogueKeys.attributes() }),
    });
};

export const useDeleteAttribute = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => deleteAttribute(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogueKeys.attributes() }),
    });
};

export const useSaveAttributeValue = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: {
            attributeId: string;
            body: AttributeValueRequest;
            valueId?: string;
        }) => saveAttributeValue(input.attributeId, input.body, input.valueId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogueKeys.attributes() }),
    });
};

export const useDeleteAttributeValue = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: { attributeId: string; valueId: string }) =>
            deleteAttributeValue(input.attributeId, input.valueId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogueKeys.attributes() }),
    });
};

export const useSaveCollection = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ body, id }: { body: CollectionRequest; id?: string }) =>
            saveCollection(body, id),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: catalogueKeys.collectionsRoot() }),
    });
};

export const useSaveCollectionProducts = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: { collectionId: string; packageIds: string[] }) =>
            saveCollectionProductIds(input.collectionId, input.packageIds),
        onSuccess: (saved, input) => {
            queryClient.setQueryData(catalogueKeys.collectionProducts(input.collectionId), saved);
            void queryClient.invalidateQueries({ queryKey: catalogueKeys.productsRoot() });
        },
    });
};

/** Every gallery write refreshes the gallery of that product. */
export const useMediaMutations = (packageId: string) => {
    const queryClient = useQueryClient();
    const refresh = () =>
        queryClient.invalidateQueries({ queryKey: catalogueKeys.media(packageId) });
    return {
        attach: useMutation({
            mutationFn: (body: ProductMediaRequest) =>
                attachProductMedia({ ...body, package_id: packageId }),
            onSuccess: refresh,
        }),
        update: useMutation({
            mutationFn: (input: { id: string; body: ProductMediaRequest }) =>
                updateProductMedia(input.id, input.body),
            onSuccess: refresh,
        }),
        remove: useMutation({
            mutationFn: (id: string) => removeProductMedia(id),
            onSuccess: refresh,
        }),
        retryRendition: useMutation({
            mutationFn: (id: string) => retryMediaRendition(id),
            onSuccess: refresh,
        }),
        reorder: useMutation({
            mutationFn: (mediaRowIds: string[]) => reorderProductMedia(packageId, mediaRowIds),
            onSuccess: (saved) => queryClient.setQueryData(catalogueKeys.media(packageId), saved),
        }),
    };
};
