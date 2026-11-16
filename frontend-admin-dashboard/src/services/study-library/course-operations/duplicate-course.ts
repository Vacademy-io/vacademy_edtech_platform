import { useMutation, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { DUPLICATE_COURSE } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { invalidateInstituteDetails } from '@/services/student-list-section/getInstituteDetails';

/** Response of POST /course/v1/duplicate/{instituteId}/{courseId} (snake_case on the wire). */
export interface DuplicateCourseResponse {
    course_id: string;
    course_name: string;
    /** First new batch, so the new course can open on it. */
    session_id?: string | null;
    level_id?: string | null;
    batches_copied: number;
    copied_subjects: number;
    copied_modules: number;
    copied_chapters: number;
    copied_slides: number;
    warnings: string[];
}

export interface DuplicateCourseVariables {
    courseId: string;
    newCourseName: string;
}

export const DUPLICATE_NAME_MAX_LENGTH = 255;

/** The name the dialog starts with: "<name> (Copy)", matching the backend default. */
export const defaultDuplicateName = (sourceName: string | null | undefined, copySuffix: string) => {
    const base = (sourceName ?? '').trim();
    const name = base ? `${base} ${copySuffix}` : copySuffix;
    return name.slice(0, DUPLICATE_NAME_MAX_LENGTH);
};

/** The trimmed name the request sends; empty means "let the server use its default". */
export const normaliseDuplicateName = (name: string) =>
    name.trim().slice(0, DUPLICATE_NAME_MAX_LENGTH);

/** The server's message for a failed duplicate (VacademyException body), else undefined. */
export const duplicateErrorMessage = (error: unknown): string | undefined => {
    if (!error || typeof error !== 'object') return undefined;
    const data = (error as { response?: { data?: unknown } }).response?.data;
    if (data && typeof data === 'object') {
        const body = data as { ex?: unknown; message?: unknown; error?: unknown };
        for (const candidate of [body.ex, body.message, body.error]) {
            if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        }
    }
    if (typeof data === 'string' && data.trim()) return data.trim();
    return undefined;
};

/**
 * One-click course duplicate: a new course with the same details and batches and a separate
 * copy of every batch's content. Learners, payments, invite links and certificates stay behind.
 */
export const useDuplicateCourse = () => {
    const queryClient = useQueryClient();

    return useMutation<DuplicateCourseResponse, unknown, DuplicateCourseVariables>({
        mutationFn: async ({ courseId, newCourseName }) => {
            const instituteId = getCurrentInstituteId();
            const response = await authenticatedAxiosInstance.post<DuplicateCourseResponse>(
                `${DUPLICATE_COURSE}/${instituteId}/${courseId}`,
                { new_course_name: normaliseDuplicateName(newCourseName) || null }
            );
            return response.data;
        },
        onSuccess: async () => {
            queryClient.invalidateQueries({ queryKey: ['GET_INIT_STUDY_LIBRARY'] });
            queryClient.invalidateQueries({ queryKey: ['GET_SESSION_DATA'] });
            queryClient.invalidateQueries({ queryKey: ['GET_BATCHES'] });
            queryClient.invalidateQueries({ queryKey: ['allCourses'] });
            queryClient.invalidateQueries({ queryKey: ['authoredCourses'] });
            queryClient.invalidateQueries({ queryKey: ['my-courses'] });
            // New package sessions: the course page reads them from the institute details.
            await invalidateInstituteDetails(queryClient);
        },
    });
};
