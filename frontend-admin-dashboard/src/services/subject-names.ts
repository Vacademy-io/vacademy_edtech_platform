import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_SUBJECTS_BY_IDS } from '@/constants/urls';

/**
 * Resolves stored subject ids to their names.
 *
 * The institute-details payload's `subjects` list is *not* a complete index of the
 * institute's subjects: admin_core builds it with `DISTINCT ON (subject_name)` over live
 * package sessions, so it holds exactly one row per distinct name and drops every subject
 * whose course was deleted. An assessment stores a raw subject id, and most of those ids
 * are not the row that survived the dedup — which is why the subject label read "N/A" for
 * the large majority of assessments even though a subject had been chosen.
 *
 * This looks the ids up directly, so it resolves duplicates-by-name and deleted-course
 * subjects alike. It is only ever a *fallback*: callers should try the institute list
 * first, which is already in memory, and come here for the ids it cannot resolve.
 */
export interface SubjectNameEntry {
    id: string;
    subject_name: string;
}

export const getSubjectsByIds = async (subjectIds: string[]): Promise<SubjectNameEntry[]> => {
    if (subjectIds.length === 0) return [];
    const response = await authenticatedAxiosInstance.post(GET_SUBJECTS_BY_IDS, subjectIds);
    return response?.data ?? [];
};

/**
 * `id -> name` for the ids that are not already resolvable from the institute list.
 *
 * `unresolvedIds` is sorted and de-duplicated before it reaches the query key, so a page
 * that re-renders with the same set of ids in a different order reuses the same request.
 */
export const useSubjectNamesByIds = (unresolvedIds: string[]) => {
    const ids = Array.from(new Set(unresolvedIds.filter(Boolean))).sort();
    const { data } = useQuery({
        queryKey: ['SUBJECT_NAMES_BY_IDS', ids],
        queryFn: () => getSubjectsByIds(ids),
        enabled: ids.length > 0,
        staleTime: 5 * 60 * 1000,
    });

    // Memoised so callers can safely put the map in a useMemo/useEffect dependency list
    // without it changing identity on every render.
    return useMemo(() => {
        const map: Record<string, string> = {};
        (data ?? []).forEach((subject) => {
            if (subject?.id && subject?.subject_name) map[subject.id] = subject.subject_name;
        });
        return map;
    }, [data]);
};

/**
 * Name for one stored subject id, preferring the institute list already in memory and
 * falling back to whatever {@link useSubjectNamesByIds} resolved. Returns an empty string
 * when the id is genuinely unresolvable (including the literal "N/A" that older saves
 * wrote into `subject_id`), so callers can pick their own placeholder.
 */
export const resolveSubjectName = (
    instituteSubjects: { id: string; subject_name: string }[] | undefined,
    fallbackNames: Record<string, string>,
    subjectId: string | null | undefined
): string => {
    if (!subjectId || subjectId === 'N/A') return '';
    const fromInstitute = instituteSubjects?.find((subject) => subject.id === subjectId);
    return fromInstitute?.subject_name || fallbackNames[subjectId] || '';
};

/** The ids on screen that the institute list cannot resolve — what to hand the hook. */
export const unresolvedSubjectIds = (
    instituteSubjects: { id: string; subject_name: string }[] | undefined,
    subjectIds: (string | null | undefined)[]
): string[] =>
    subjectIds.filter(
        (id): id is string =>
            !!id && id !== 'N/A' && !instituteSubjects?.some((subject) => subject.id === id)
    );
