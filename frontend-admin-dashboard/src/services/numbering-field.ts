import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

/**
 * The institute's numbering-series field (e.g. branch): which receipt series a payment numbers
 * from. Asked once per enrolment, on its first recorded payment, and pinned on the enrolment so
 * later installments never ask again. Off unless the institute sets it up in Invoice Settings.
 * Backend: NumberingFieldService.
 */
export const NUMBERING_FIELD_URL = `${BASE_URL}/admin-core-service/v1/invoice/numbering-field`;

export interface NumberingFieldInfo {
    /** Show the field: the institute asks for it and the enrolment has no value yet. */
    ask: boolean;
    required: boolean;
    field_id?: string | null;
    label?: string | null;
    options: string[];
    /** Already pinned on the enrolment. */
    value?: string | null;
    /** The learner's own value (profile, else latest lead), to preselect. */
    suggested?: string | null;
}

/** Which enrolment / learner a dialog records for. New enrolments have no plan yet. */
export interface NumberingTarget {
    userPlanId?: string | null;
    userId?: string | null;
}

export const fetchNumberingField = async (
    instituteId: string,
    target: NumberingTarget
): Promise<NumberingFieldInfo> => {
    const res = await authenticatedAxiosInstance.get<NumberingFieldInfo>(NUMBERING_FIELD_URL, {
        params: {
            instituteId,
            userPlanId: target.userPlanId || undefined,
            userId: target.userId || undefined,
        },
    });
    return res.data;
};

export const useNumberingField = (target: NumberingTarget | null | undefined, instituteId?: string | null) => {
    const id = instituteId ?? getCurrentInstituteId();
    return useQuery({
        // Hashed by value, so a new object with the same ids reuses the cached answer.
        queryKey: ['numbering-field', id, target ?? null],
        queryFn: () => fetchNumberingField(id!, target!),
        enabled: !!id && !!target,
        // Always fresh: right after a first payment pins the value, the next dialog must not ask again.
        staleTime: 0,
    });
};
