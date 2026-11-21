import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { POLL_INTERVAL_MS } from '../-constants';
import {
    addSource,
    askKnowledgeBase,
    createKnowledgeBase,
    deleteKnowledgeBase,
    deleteSource,
    getKnowledgeBase,
    listKnowledgeBases,
    listReviewPages,
    reindexSource,
    setSourceActive,
    updateKnowledgeBase,
} from '../-services/knowledge-base-service';
import { getCatalogue, getTaxonomy } from '../-services/library-service';
import type { KbPurpose, KnowledgeBase, SourceKind } from '../-types';
import type { CatalogueFilters } from '../-types/library';

const KEYS = {
    all: ['knowledge-bases'] as const,
    one: (id: string) => ['knowledge-base', id] as const,
    review: (id: string) => ['knowledge-base-review', id] as const,
    taxonomy: (language?: string) => ['knowledge-base-taxonomy', language ?? ''] as const,
    catalogue: (filters: CatalogueFilters) => ['knowledge-base-catalogue', filters] as const,
};

/**
 * The curriculum picker's tree (boards → classes → subjects, exams →
 * subjects) with library counts. Static apart from the counts, so it is
 * cached for the session and only refetched per medium.
 */
export const useLibraryTaxonomy = (language?: string) =>
    useQuery({
        queryKey: KEYS.taxonomy(language),
        queryFn: () => getTaxonomy(language),
        staleTime: 5 * 60 * 1000,
        // Switching medium refetches the counts; the picker must not blink
        // out to a skeleton while it does.
        placeholderData: keepPreviousData,
    });

export const useLibraryCatalogue = (
    filters: CatalogueFilters,
    { enabled = true, keepPrevious = false }: { enabled?: boolean; keepPrevious?: boolean } = {}
) =>
    useQuery({
        queryKey: KEYS.catalogue(filters),
        queryFn: () => getCatalogue(filters),
        enabled,
        staleTime: 60 * 1000,
        // A browsing grid keeps the last shelf on screen while the next loads;
        // anything that ACTS on the answer (auto-picking a book) must not.
        placeholderData: keepPrevious ? keepPreviousData : undefined,
    });

export const useKnowledgeBases = () =>
    useQuery({
        queryKey: KEYS.all,
        queryFn: listKnowledgeBases,
        // Keep the list fresh while anything anywhere is still ingesting, so the
        // "2 documents being read" badge resolves without a manual refresh.
        refetchInterval: (query) => {
            const data = query.state.data as KnowledgeBase[] | undefined;
            return data?.some((kb) => kb.processing_count > 0) ? POLL_INTERVAL_MS : false;
        },
    });

export const useKnowledgeBase = (kbId: string) =>
    useQuery({
        queryKey: KEYS.one(kbId),
        queryFn: () => getKnowledgeBase(kbId),
        enabled: Boolean(kbId),
        // A 300-page scanned book takes minutes; polling is how the progress bar
        // and per-stage label actually move.
        refetchInterval: (query) => {
            const data = query.state.data as KnowledgeBase | undefined;
            const busy = data?.sources?.some(
                (s) => s.status === 'PENDING' || s.status === 'PROCESSING'
            );
            return busy ? POLL_INTERVAL_MS : false;
        },
    });

export const useReviewPages = (kbId: string, enabled: boolean) =>
    useQuery({
        queryKey: KEYS.review(kbId),
        queryFn: () => listReviewPages(kbId),
        enabled: Boolean(kbId) && enabled,
    });

export const useCreateKnowledgeBase = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: {
            name: string;
            description?: string;
            purpose: KbPurpose;
            language_hint?: string;
        }) => createKnowledgeBase(payload),
        onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
    });
};

export const useUpdateKnowledgeBase = (kbId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: Parameters<typeof updateKnowledgeBase>[1]) =>
            updateKnowledgeBase(kbId, payload),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: KEYS.one(kbId) });
            qc.invalidateQueries({ queryKey: KEYS.all });
        },
    });
};

export const useDeleteKnowledgeBase = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (kbId: string) => deleteKnowledgeBase(kbId),
        onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
    });
};

export const useAddSource = (kbId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: {
            source_kind: SourceKind;
            title?: string;
            file_id?: string;
            source_url?: string;
            raw_text?: string;
            expected_pages?: number;
        }) => addSource(kbId, payload),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: KEYS.one(kbId) });
            qc.invalidateQueries({ queryKey: KEYS.all });
        },
    });
};

export const useSourceActions = (kbId: string) => {
    const qc = useQueryClient();
    const invalidate = () => {
        qc.invalidateQueries({ queryKey: KEYS.one(kbId) });
        qc.invalidateQueries({ queryKey: KEYS.all });
        qc.invalidateQueries({ queryKey: KEYS.review(kbId) });
    };
    return {
        toggleActive: useMutation({
            mutationFn: ({ sourceId, isActive }: { sourceId: string; isActive: boolean }) =>
                setSourceActive(sourceId, isActive),
            onSuccess: invalidate,
        }),
        reindex: useMutation({
            mutationFn: (sourceId: string) => reindexSource(sourceId),
            onSuccess: invalidate,
        }),
        remove: useMutation({
            mutationFn: (sourceId: string) => deleteSource(sourceId),
            onSuccess: invalidate,
        }),
    };
};

export const useAskKnowledgeBase = (kbId: string) =>
    useMutation({
        mutationFn: (payload: {
            question: string;
            history?: Array<{ role: string; content: string }>;
            answer_language?: string;
        }) => askKnowledgeBase(kbId, payload),
    });
