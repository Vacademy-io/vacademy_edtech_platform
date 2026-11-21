import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getTopics } from '../-services/paper-service';
import {
    archiveCompanion,
    createCompanion,
    getCompanion,
    getCompanionInsights,
    listCompanions,
    prepareLessons,
    updateCompanion,
} from '../-services/companion-service';
import type {
    CompanionDetail,
    CompanionPayload,
    CreateCompanionPayload,
} from '../-types/companion';

/** Lesson compile is seconds per card; a 10 s poll moves the "ready" count visibly. */
export const COMPANION_POLL_MS = 10_000;
/** The server treats a GENERATING row idle for 4 min as failed; stop polling after 5. */
const STALE_GENERATING_MS = 5 * 60 * 1000;

export const COMPANION_KEYS = {
    list: (kbId: string) => ['kb-companions', kbId] as const,
    one: (id: string) => ['kb-companion', id] as const,
    insights: (id: string) => ['kb-companion-insights', id] as const,
    topics: (kbId: string) => ['kb-topics', kbId] as const,
};

/** True while any leaf lesson is still compiling (and not stuck). */
export const hasGeneratingLessons = (detail: CompanionDetail | undefined): boolean =>
    Boolean(
        detail?.topics?.some((topic) =>
            topic.leaves.some((leaf) => {
                if (leaf.lesson?.status !== 'GENERATING') return false;
                const at = leaf.lesson.updated_at ? Date.parse(leaf.lesson.updated_at) : NaN;
                return Number.isNaN(at) || Date.now() - at < STALE_GENERATING_MS;
            })
        )
    );

export const useCompanions = (kbId: string) =>
    useQuery({
        queryKey: COMPANION_KEYS.list(kbId),
        queryFn: () => listCompanions(kbId),
        enabled: Boolean(kbId),
    });

export const useCompanion = (companionId: string | null | undefined) =>
    useQuery({
        queryKey: COMPANION_KEYS.one(companionId ?? ''),
        queryFn: () => getCompanion(companionId as string),
        enabled: Boolean(companionId),
        // Keeps "lessons ready 8 / 24" moving while a prepare batch runs.
        refetchInterval: (query) =>
            hasGeneratingLessons(query.state.data as CompanionDetail | undefined)
                ? COMPANION_POLL_MS
                : false,
    });

export const useCompanionInsights = (companionId: string, enabled: boolean) =>
    useQuery({
        queryKey: COMPANION_KEYS.insights(companionId),
        queryFn: () => getCompanionInsights(companionId),
        enabled: Boolean(companionId) && enabled,
    });

export const useKbTopics = (kbId: string, enabled: boolean) =>
    useQuery({
        queryKey: COMPANION_KEYS.topics(kbId),
        queryFn: () => getTopics(kbId),
        enabled: Boolean(kbId) && enabled,
        staleTime: 5 * 60 * 1000,
    });

export const useSaveCompanion = (kbId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            companionId,
            payload,
        }: {
            companionId?: string;
            payload: CompanionPayload;
        }) =>
            companionId
                ? updateCompanion(companionId, payload)
                : createCompanion({
                      ...payload,
                      knowledge_base_id: kbId,
                  } as CreateCompanionPayload),
        onSuccess: (detail) => {
            qc.setQueryData(COMPANION_KEYS.one(detail.id), detail);
            qc.invalidateQueries({ queryKey: COMPANION_KEYS.list(kbId) });
        },
    });
};

export const useArchiveCompanion = (kbId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (companionId: string) => archiveCompanion(companionId),
        onSuccess: () => qc.invalidateQueries({ queryKey: COMPANION_KEYS.list(kbId) }),
    });
};

export const usePrepareLessons = (companionId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: { node_ids?: string[]; dry_run: boolean }) =>
            prepareLessons(companionId, payload),
        onSuccess: (_data, variables) => {
            if (!variables.dry_run) {
                qc.invalidateQueries({ queryKey: COMPANION_KEYS.one(companionId) });
            }
        },
    });
};
