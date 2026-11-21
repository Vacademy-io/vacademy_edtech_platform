import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    REATTEMPT_REQUEST_LIST_URL,
    REATTEMPT_REQUEST_PENDING_COUNT_URL,
    REATTEMPT_REQUEST_REVIEW_URL,
} from '@/constants/urls';

export type ReattemptRequestType = 'REATTEMPT' | 'TIME_INCREASE';
export type ReattemptRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ReattemptRequest {
    id: string;
    assessment_id: string;
    assessment_name?: string | null;
    user_id: string;
    registration_id?: string | null;
    request_type: ReattemptRequestType;
    reason?: string | null;
    status: ReattemptRequestStatus;
    granted_count?: number | null;
    review_note?: string | null;
    reviewed_at?: string | null;
    created_at?: string | null;
    participant_name?: string | null;
    user_email?: string | null;
    phone_number?: string | null;
    attempts_allowed?: number | null;
    attempts_used?: number | null;
}

interface PageResponse<T> {
    content: T[];
    totalElements: number;
    totalPages: number;
    number: number;
}

/**
 * `assessmentId` omitted gives the institute-wide inbox.
 *
 * `status` goes over the wire comma-joined, never as an array. Axios's default serializer
 * writes an array as `status[]=PENDING` *with the brackets un-escaped* (it rewrites %5B/%5D
 * back to [ and ]), and the nginx ingress answers a request line containing raw brackets with
 * a 400 — which kills the CORS preflight, so the browser never even sends the GET and the tab
 * renders "Could not load requests". Spring splits a comma-separated value straight into the
 * `List<String> status` param; `status[]=…` binds to nothing at all, which silently turned the
 * status filter into a no-op on the requests that did get through.
 */
export const getReattemptRequests = async (params: {
    instituteId: string;
    assessmentId?: string;
    status?: ReattemptRequestStatus[];
    page?: number;
    size?: number;
}): Promise<PageResponse<ReattemptRequest>> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: REATTEMPT_REQUEST_LIST_URL,
        params: {
            instituteId: params.instituteId,
            assessmentId: params.assessmentId,
            status: params.status?.length ? params.status.join(',') : undefined,
            page: params.page ?? 0,
            size: params.size ?? 25,
        },
    });
    return response?.data;
};

/**
 * `assessmentId` omitted counts the whole institute's inbox. Anything badging a single
 * assessment must pass it: the institute-wide number is identical on every assessment page, so
 * an unscoped badge claims this exam has a request waiting when the request belongs to another
 * exam — and the tab it points at then loads empty.
 */
export const getPendingReattemptRequestCount = async (
    instituteId: string,
    assessmentId?: string
): Promise<number> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: REATTEMPT_REQUEST_PENDING_COUNT_URL,
        params: { instituteId, assessmentId },
    });
    return response?.data ?? 0;
};

/**
 * Approving a REATTEMPT request grants the attempts through the same path the participants
 * screen uses, so the learner's allowance and the ASSESSMENT_REATTEMPT_GRANTED event behave
 * identically however the grant was made.
 */
export const reviewReattemptRequest = async (params: {
    requestId: string;
    instituteId: string;
    status: 'APPROVED' | 'REJECTED';
    grantedCount?: number;
    reviewNote?: string;
}): Promise<ReattemptRequest> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${REATTEMPT_REQUEST_REVIEW_URL}/${params.requestId}/review`,
        params: { instituteId: params.instituteId },
        data: {
            status: params.status,
            granted_count: params.grantedCount,
            review_note: params.reviewNote,
        },
    });
    return response?.data;
};
