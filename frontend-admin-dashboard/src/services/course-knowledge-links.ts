/**
 * Course knowledge — links between a course and the institute's knowledge
 * bases (ai_service /course-knowledge/v1/packages/{id}/links).
 *
 * A link tells the live tutor and the student AI which knowledge base a course
 * was built from (GROUNDING) or may quote as extra reading (REFERENCE). The
 * AI course creator writes one as soon as it saves a course; staff add, edit
 * and remove them on the course's AI knowledge tab. The whole surface exists
 * only while the platform flag `links_enabled` is on (GET /status): the server
 * answers 403 `links_not_enabled` otherwise, so callers check the status first.
 *
 * The server pins the caller to the institute in the `clientId` header (added
 * by the axios interceptor), requires a staff role and checks that the course
 * belongs to the institute. Every query keys under the shared
 * ['course-knowledge', …] prefix so a course AI data delete refetches it too.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import {
    COURSE_KNOWLEDGE_QUERY_KEY,
    COURSE_KNOWLEDGE_STATUS_QUERY_KEY,
    getCourseKnowledgeStatus,
} from '@/services/course-knowledge-settings';
import { courseKnowledgeErrorStatus } from '@/services/course-knowledge';

const BASE = `${AI_SERVICE_BASE_URL}/course-knowledge/v1`;

export type CourseKbLinkRole = 'GROUNDING' | 'REFERENCE';
export type CourseKbGroundingMode = 'STRICT' | 'BLENDED';
export type CourseKbUseIn = 'tutor' | 'chatbot';
export type CourseKbLinkProvenance = 'AI_COURSE_CREATOR' | 'ADMIN' | 'LEGACY_TUTOR_SETTING';

export const COURSE_KB_DEFAULT_USE_IN: CourseKbUseIn[] = ['tutor', 'chatbot'];

/** One active link of a course to a knowledge base. */
export interface CourseKbLink {
    id: string;
    institute_id: string;
    package_id: string;
    knowledge_base_id: string;
    /** Null when the knowledge base can no longer be read by this institute. */
    knowledge_base_name: string | null;
    role: CourseKbLinkRole;
    grounding_mode: CourseKbGroundingMode;
    use_in: CourseKbUseIn[];
    /** Topics the course covers; empty means the whole knowledge base. */
    topic_node_ids: string[];
    /** {chapter_id: [node_id, …]}: the topics each chapter was written from. */
    chapter_topics: Record<string, string[]>;
    provenance: CourseKbLinkProvenance;
    status: 'ACTIVE' | 'REMOVED';
    created_by: string | null;
    created_at: string | null;
    updated_at: string | null;
}

/**
 * The course's Tutor Mode knowledge-base grounding when no link uses that
 * knowledge base. Read-only: it becomes a link only through "Keep as link".
 */
export interface CourseKbLegacyLink {
    knowledge_base_id: string;
    knowledge_base_name: string | null;
    role: 'GROUNDING';
    grounding_mode: CourseKbGroundingMode;
    use_in: CourseKbUseIn[];
    topic_node_ids: string[];
    chapter_topics: Record<string, string[]>;
    provenance: 'LEGACY_TUTOR_SETTING';
    source: 'TUTOR_MODE_SETTING';
}

/** GET /packages/{id}/links */
export interface CourseKbLinks {
    links: CourseKbLink[];
    legacy: CourseKbLegacyLink | null;
}

/** The AI course creator's chapter map: chapter names resolve server side. */
export interface CourseKbChapterTopicsItem {
    chapter_name?: string;
    chapter_id?: string;
    node_ids: string[];
}

/** PUT /packages/{id}/links body. Keys left out keep their stored value on update. */
export interface CourseKbLinkUpsert {
    knowledge_base_id: string;
    role?: CourseKbLinkRole;
    grounding_mode?: CourseKbGroundingMode;
    use_in?: CourseKbUseIn[];
    topic_node_ids?: string[];
    chapter_topics?: Record<string, string[]> | CourseKbChapterTopicsItem[];
    provenance?: CourseKbLinkProvenance;
}

export const courseKbLinksQueryKey = (packageId: string) =>
    [COURSE_KNOWLEDGE_QUERY_KEY, 'links', packageId] as const;

export const getCourseKbLinks = async (packageId: string): Promise<CourseKbLinks> => {
    const res = await authenticatedAxiosInstance.get<CourseKbLinks>(
        `${BASE}/packages/${encodeURIComponent(packageId)}/links`
    );
    return res.data;
};

export const putCourseKbLink = async (
    packageId: string,
    body: CourseKbLinkUpsert
): Promise<CourseKbLink> => {
    const res = await authenticatedAxiosInstance.put<CourseKbLink>(
        `${BASE}/packages/${encodeURIComponent(packageId)}/links`,
        body
    );
    return res.data;
};

export const deleteCourseKbLink = async (
    packageId: string,
    linkId: string
): Promise<CourseKbLink> => {
    const res = await authenticatedAxiosInstance.delete<CourseKbLink>(
        `${BASE}/packages/${encodeURIComponent(packageId)}/links/${encodeURIComponent(linkId)}`
    );
    return res.data;
};

const noRetryOn4xx = (failureCount: number, error: unknown) => {
    const status = courseKnowledgeErrorStatus(error);
    if (status !== undefined && status >= 400 && status < 500) return false;
    return failureCount < 1;
};

export const useCourseKbLinks = (packageId: string, options?: { enabled?: boolean }) =>
    useQuery({
        queryKey: courseKbLinksQueryKey(packageId),
        queryFn: () => getCourseKbLinks(packageId),
        enabled: (options?.enabled ?? true) && !!packageId,
        staleTime: 30_000,
        retry: noRetryOn4xx,
    });

export const useSaveCourseKbLink = (packageId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (body: CourseKbLinkUpsert) => putCourseKbLink(packageId, body),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: courseKbLinksQueryKey(packageId) });
        },
    });
};

export const useRemoveCourseKbLink = (packageId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (linkId: string) => deleteCourseKbLink(packageId, linkId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: courseKbLinksQueryKey(packageId) });
        },
    });
};

/**
 * Whether links are on for the platform, from the cached course-knowledge
 * status when it is fresh (the same key and 5 min freshness as
 * useCourseKnowledgeStatus). Any failure reads as "off".
 */
export const courseKbLinksEnabled = async (queryClient: QueryClient): Promise<boolean> => {
    try {
        const status = await queryClient.fetchQuery({
            queryKey: COURSE_KNOWLEDGE_STATUS_QUERY_KEY,
            queryFn: getCourseKnowledgeStatus,
            staleTime: 5 * 60 * 1000,
        });
        return status?.links_enabled === true;
    } catch {
        return false;
    }
};
