/**
 * Option lists for the editor's pickers. Courses, course tags and batches come
 * from the institute details the layout already loaded; the rest are fetched
 * once (react-query) and only when a picker that needs them is on screen.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { buildBatchOptions, buildCourseOptions } from '@/lib/batch-options';
import { getLanguageSetting } from '@/services/language-settings';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { normalizeTimezone } from '@/utils/timezone';
import {
    fetchAssessmentOptions,
    fetchHasStoreSite,
    fetchLearnerTagOptions,
    fetchProductPageOptions,
    fetchPublicLiveSessions,
    type PickerOption,
} from '../-services/learner-home-service';

const STALE = 5 * 60 * 1000;

export function useCourseOptions(): PickerOption[] {
    const { instituteDetails } = useInstituteDetailsStore();
    return useMemo(() => buildCourseOptions(instituteDetails), [instituteDetails]);
}

export function useBatchOptions() {
    const { instituteDetails } = useInstituteDetailsStore();
    return useMemo(() => buildBatchOptions(instituteDetails), [instituteDetails]);
}

/** Course tags (package.comma_separated_tags), for shelves and course-list links. */
export function useCourseTagOptions(): PickerOption[] {
    const { instituteDetails } = useInstituteDetailsStore();
    return useMemo(
        () =>
            Array.from(new Set(instituteDetails?.tags ?? []))
                .filter(Boolean)
                .map((tag) => ({ label: tag, value: tag })),
        [instituteDetails]
    );
}

export function useLearnerTagOptions(enabled = true) {
    return useQuery({
        queryKey: ['learner-home', 'learner-tags', getInstituteId()],
        queryFn: fetchLearnerTagOptions,
        enabled,
        staleTime: STALE,
    });
}

export function useProductPageOptions(enabled: boolean) {
    const instituteId = getInstituteId() ?? '';
    return useQuery({
        queryKey: ['learner-home', 'product-pages', instituteId],
        queryFn: () => fetchProductPageOptions(instituteId),
        enabled: enabled && !!instituteId,
        staleTime: STALE,
    });
}

export function useLiveSessionOptions(enabled: boolean) {
    const instituteId = getInstituteId() ?? '';
    return useQuery({
        queryKey: ['learner-home', 'public-live-sessions', instituteId],
        queryFn: () => fetchPublicLiveSessions(instituteId),
        enabled: enabled && !!instituteId,
        staleTime: STALE,
    });
}

export function useAssessmentOptions(enabled: boolean) {
    const instituteId = getInstituteId() ?? '';
    return useQuery({
        queryKey: ['learner-home', 'assessments', instituteId],
        queryFn: () => fetchAssessmentOptions(instituteId),
        enabled: enabled && !!instituteId,
        staleTime: STALE,
    });
}

/** Whether the institute has a store site; false until known (store links stay hidden). */
export function useHasStoreSite(): boolean {
    const instituteId = getInstituteId() ?? '';
    const q = useQuery({
        queryKey: ['learner-home', 'has-store-site', instituteId],
        queryFn: () => fetchHasStoreSite(instituteId),
        enabled: !!instituteId,
        staleTime: STALE,
    });
    return q.data === true;
}

/** The institute's timezone (Settings → Language); the platform fallback zone when unset (decision Q12). */
export function useInstituteZone(): string {
    return useMemo(() => normalizeTimezone(getLanguageSetting()?.timezone), []);
}
