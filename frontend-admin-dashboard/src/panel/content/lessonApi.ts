/**
 * Read-only fetchers + react-query hooks for the Lessons screen, all through
 * the panel axios instance (Bearer + clientId).
 *
 * Endpoints (verified against prod responses, read-only):
 *   GET INIT_STUDY_LIBRARY?instituteId              → CourseWithSessionsType[]
 *       (course + sessions[].level_with_details[].subjects + package_sessions[])
 *   GET GET_MODULES_WITH_CHAPTERS?subjectId&packageSessionId → ModulesWithChapters[]
 *   GET GET_SLIDES?chapterId  (or ?packageSessionId for course_depth 2)  → Slide[]
 *   GET GET_PUBLIC_URL?fileId&expiryDays=1 (via getPublicUrl)           → signed URL
 *   GET {AI_SERVICE}/lms-video/v1/render/{id} (via getLmsVideoRender)   → MP4 state
 *
 * Types come in with `import type` only: the study-library zustand store and
 * the slides hooks module (which pulls the content store) never enter the graph.
 * Same fetch shapes as courses/-services/getStudyLibraryDetails.ts,
 * getModulesWithChapters.ts and getAllSlides.ts (not imported: their modules
 * write into admin zustand stores).
 *
 * Lists are network-first with the teacher's saved copy behind them (offline/).
 */
import { useQuery } from '@tanstack/react-query';
import { GET_MODULES_WITH_CHAPTERS, GET_SLIDES, INIT_STUDY_LIBRARY } from '@/constants/urls';
import type {
    CourseWithSessionsType,
    PackageSessionType,
    SubjectType,
} from '@/stores/study-library/use-study-library-store';
import type { ModulesWithChapters } from '@/stores/study-library/use-modules-with-chapters-store';
import type { Slide } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { getPublicUrl } from '@/services/upload_file';
import { getLmsVideoRender, type LmsVideoRenderState } from '@/services/lms-ai-video';
import { panelApi } from '../lib/api';
import { backoffDelay, networkFirst, refreshWhileSaved } from '../offline/networkFirst';

export type { CourseWithSessionsType, PackageSessionType, SubjectType, ModulesWithChapters, Slide };

/** The library tree changes rarely while a class is running. */
const LIST_STALE_MS = 10 * 60 * 1000;

const INACTIVE_STATUSES = ['DELETED', 'INACTIVE'];

/** Tries after a first failure; list and file calls back off between them. */
const NETWORK_RETRIES = 3;

function libraryKey(instituteId: string): string {
    return `library:${instituteId}`;
}

function modulesKey(subjectId: string, packageSessionId: string): string {
    return `modules:${subjectId}:${packageSessionId}`;
}

function slidesKey(scope: SlideScope): string {
    return 'chapterId' in scope
        ? `slides:c:${scope.chapterId}`
        : `slides:p:${scope.packageSessionId}`;
}

function isListed(status: string | null | undefined): boolean {
    return INACTIVE_STATUSES.indexOf((status || '').toUpperCase()) < 0;
}

// ------------------------------------------------------------- fetchers ---

export async function fetchStudyLibrary(instituteId: string): Promise<CourseWithSessionsType[]> {
    return networkFirst(libraryKey(instituteId), async () => {
        const response = await panelApi.get<CourseWithSessionsType[]>(INIT_STUDY_LIBRARY, {
            params: { instituteId },
        });
        return Array.isArray(response.data) ? response.data : [];
    });
}

export async function fetchModulesWithChapters(
    subjectId: string,
    packageSessionId: string
): Promise<ModulesWithChapters[]> {
    return networkFirst(modulesKey(subjectId, packageSessionId), async () => {
        const response = await panelApi.get<ModulesWithChapters[]>(GET_MODULES_WITH_CHAPTERS, {
            params: { subjectId, packageSessionId },
        });
        return Array.isArray(response.data) ? response.data : [];
    });
}

export type SlideScope = { chapterId: string } | { packageSessionId: string };

export async function fetchSlides(scope: SlideScope): Promise<Slide[]> {
    return networkFirst(slidesKey(scope), async () => {
        const response = await panelApi.get<Slide[]>(GET_SLIDES, { params: scope });
        const slides = Array.isArray(response.data) ? response.data : [];
        return slides
            .filter((slide) => isListed(slide.status))
            .sort((a, b) => (a.slide_order ?? 0) - (b.slide_order ?? 0));
    });
}

/**
 * Signed media URL for a file id (expiryDays=1). Never cached: every player
 * open re-resolves (spec: signed URLs expire). Rejects instead of returning ''
 * so the player can show its error state.
 */
export async function resolveFileUrl(fileId: string): Promise<string> {
    const url = await getPublicUrl(fileId);
    if (!url || typeof url !== 'string') throw new Error('No public URL for this file');
    return url;
}

export async function fetchAiVideoRender(videoId: string): Promise<LmsVideoRenderState> {
    return getLmsVideoRender(videoId);
}

// -------------------------------------------------------------- helpers ---

export function courseName(course: CourseWithSessionsType): string {
    return course.course.package_name || '';
}

/** Batches of a course that a teacher can open (DELETED / INACTIVE dropped). */
export function courseBatches(course: CourseWithSessionsType): PackageSessionType[] {
    return (course.package_sessions || []).filter((ps) => isListed(ps.status));
}

/** "Class 8 · 2025-26", or the batch's own name when it has one. */
export function batchLabel(batch: PackageSessionType): string {
    if (batch.name) return batch.name;
    const parts = [batch.level?.level_name, batch.session?.session_name].filter(
        (part): part is string => !!part && part.toUpperCase() !== 'DEFAULT'
    );
    return parts.length ? parts.join(' · ') : batch.package_dto?.package_name || batch.id;
}

/** Subjects of the batch's level within its session (course-init shape). */
export function batchSubjects(
    course: CourseWithSessionsType,
    batch: PackageSessionType
): SubjectType[] {
    const session = (course.sessions || []).find(
        (item) => item.session_dto?.id === batch.session?.id
    );
    const level = session?.level_with_details?.find((item) => item.id === batch.level?.id);
    const subjects = level?.subjects || [];
    return subjects.slice().sort((a, b) => (a.subject_order ?? 0) - (b.subject_order ?? 0));
}

/** "DEFAULT" / "default" names are placeholders the admin hides. */
export function displayName(name: string | null | undefined, fallback: string): string {
    if (!name || name.trim().toUpperCase() === 'DEFAULT') return fallback;
    return name;
}

// ---------------------------------------------------------------- hooks ---

export function useStudyLibrary(instituteId: string | null) {
    return useQuery({
        queryKey: ['panel', 'lessons', 'library', instituteId],
        queryFn: () => fetchStudyLibrary(instituteId as string),
        enabled: !!instituteId,
        staleTime: LIST_STALE_MS,
        retry: NETWORK_RETRIES,
        retryDelay: backoffDelay,
        refetchInterval: refreshWhileSaved(libraryKey(instituteId ?? '')),
    });
}

export function useModulesWithChapters(
    subjectId: string | undefined,
    packageSessionId: string | undefined
) {
    return useQuery({
        queryKey: ['panel', 'lessons', 'modules', subjectId, packageSessionId],
        queryFn: () => fetchModulesWithChapters(subjectId as string, packageSessionId as string),
        enabled: !!subjectId && !!packageSessionId,
        staleTime: LIST_STALE_MS,
        retry: NETWORK_RETRIES,
        retryDelay: backoffDelay,
        refetchInterval: refreshWhileSaved(modulesKey(subjectId ?? '', packageSessionId ?? '')),
    });
}

export function useSlides(scope: SlideScope | null) {
    return useQuery({
        // The scope object itself: react-query hashes it structurally.
        queryKey: ['panel', 'lessons', 'slides', scope],
        queryFn: () => fetchSlides(scope as SlideScope),
        enabled: !!scope,
        staleTime: 60 * 1000,
        retry: NETWORK_RETRIES,
        retryDelay: backoffDelay,
        refetchInterval: scope ? refreshWhileSaved(slidesKey(scope)) : false,
    });
}

/**
 * Signed URL for a media file id, resolved on EVERY mount (staleTime 0,
 * gcTime 0): a panel left on a lesson overnight must not reuse an expired link.
 * The saved copy of a PDF or scene is looked up before this runs (offline/).
 * Not fetched again when the network comes back: PanelPlayer keys the player on
 * dataUpdatedAt, so a new answer would reload the page or video from the start. An
 * expired link has its own path (onExpired, Retry).
 */
export function useSignedUrl(fileId: string | null) {
    return useQuery({
        queryKey: ['panel', 'lessons', 'signed-url', fileId],
        queryFn: () => resolveFileUrl(fileId as string),
        enabled: !!fileId,
        staleTime: 0,
        gcTime: 0,
        refetchOnReconnect: false,
        retry: NETWORK_RETRIES,
        retryDelay: backoffDelay,
    });
}

/**
 * MP4 render state of an AI video (404 = never rendered through /lms-video). Not
 * fetched again on reconnect, for the same reason as useSignedUrl.
 */
export function useAiVideoRender(videoId: string) {
    return useQuery({
        queryKey: ['panel', 'lessons', 'ai-render', videoId],
        queryFn: () => fetchAiVideoRender(videoId),
        staleTime: 0,
        gcTime: 0,
        refetchOnReconnect: false,
        retry: false,
    });
}
