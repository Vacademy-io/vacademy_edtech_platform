/**
 * Extra classes: a learner linked to another batch for a few days (a make-up class), with no fee
 * and no message. Part of Settings → Breaks and holds: the same switch gates adding them.
 */
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    EXTRA_CLASSES_BASE,
    EXTRA_CLASSES_FOR_LEARNER,
    EXTRA_CLASS_BATCHES,
    EXTRA_CLASS_END,
} from '@/constants/urls';

export type ExtraClassState = 'UPCOMING' | 'CURRENT' | 'ENDED';

export interface ExtraClass {
    id: string;
    package_session_id: string;
    batch_label: string;
    course_name: string | null;
    level_name: string | null;
    batch_name: string | null;
    from: string | null;
    to: string | null;
    state: ExtraClassState;
    access_status: string;
    imported: boolean;
    note: string | null;
    added_by: string | null;
    added_at: string | null;
}

export interface LearnerExtraClasses {
    enabled: boolean;
    extra_classes: ExtraClass[];
}

export interface ExtraClassBatch {
    package_session_id: string;
    course_name: string | null;
    level_name: string | null;
    batch_name: string | null;
    label: string;
}

export interface AddExtraClassRequest {
    user_id: string;
    package_session_id: string;
    from_date: string;
    to_date: string;
    note: string | null;
}

export const EXTRA_CLASSES_QUERY_KEY = 'extra-classes';

export const useLearnerExtraClasses = (userId: string, instituteId: string, enabled: boolean) =>
    useQuery({
        queryKey: [EXTRA_CLASSES_QUERY_KEY, 'learner', userId, instituteId],
        queryFn: async (): Promise<LearnerExtraClasses> => {
            const res = await authenticatedAxiosInstance.get(EXTRA_CLASSES_FOR_LEARNER(userId), {
                params: { instituteId },
            });
            return res.data;
        },
        enabled: enabled && Boolean(userId) && Boolean(instituteId),
        staleTime: 30_000,
    });

/** The institute's active batches; loaded when the add dialog opens. */
export const useExtraClassBatches = (instituteId: string) =>
    useQuery({
        queryKey: [EXTRA_CLASSES_QUERY_KEY, 'batches', instituteId],
        queryFn: async (): Promise<ExtraClassBatch[]> => {
            const res = await authenticatedAxiosInstance.get(EXTRA_CLASS_BATCHES, {
                params: { instituteId },
            });
            return res.data;
        },
        enabled: Boolean(instituteId),
        staleTime: 5 * 60_000,
    });

export const addExtraClass = async (
    instituteId: string,
    body: AddExtraClassRequest
): Promise<{ id: string }> => {
    const res = await authenticatedAxiosInstance.post(EXTRA_CLASSES_BASE, body, {
        params: { instituteId },
    });
    return res.data;
};

/** Ends it now, or removes it when it has not started. */
export const endExtraClass = async (
    instituteId: string,
    id: string
): Promise<{ id: string; result: 'ENDED' | 'REMOVED' }> => {
    const res = await authenticatedAxiosInstance.post(EXTRA_CLASS_END(id), null, {
        params: { instituteId },
    });
    return res.data;
};
