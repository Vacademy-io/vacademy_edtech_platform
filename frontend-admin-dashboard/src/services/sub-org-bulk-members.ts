import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BULK_ADD_SUB_ORG_MEMBERS, MOVE_SUB_ORG_MEMBERS } from '@/constants/urls';

/** What happened to one learner in a bulk add / move into a sub-org. */
export type SubOrgBulkStatus = 'ADDED' | 'MOVED' | 'ALREADY_MEMBER' | 'FAILED';

export interface SubOrgBulkResultItem {
    user_id?: string | null;
    name?: string | null;
    email?: string | null;
    package_session_id?: string | null;
    status: SubOrgBulkStatus;
    message?: string | null;
}

export interface SubOrgBulkResult {
    total: number;
    added: number;
    moved: number;
    already_member: number;
    failed: number;
    results: SubOrgBulkResultItem[];
}

/** Learner to add: `id` for an existing account, otherwise email (or mobile) identifies them. */
export interface SubOrgBulkLearner {
    id?: string;
    full_name?: string;
    email?: string;
    mobile_number?: string;
    username?: string;
}

export interface SubOrgMoveMember {
    user_id: string;
    package_session_id: string;
}

/**
 * Learners per request. Each add creates an account and runs the enrollment workflow, so
 * small chunks keep every request short and let the progress bar move.
 */
export const SUB_ORG_ADD_CHUNK_SIZE = 10;
/** Moves only update existing rows; the server takes up to 500 per request. */
export const SUB_ORG_MOVE_CHUNK_SIZE = 100;

export const EMPTY_SUB_ORG_BULK_RESULT: SubOrgBulkResult = {
    total: 0,
    added: 0,
    moved: 0,
    already_member: 0,
    failed: 0,
    results: [],
};

export function chunkList<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

export function mergeSubOrgBulkResults(a: SubOrgBulkResult, b: SubOrgBulkResult): SubOrgBulkResult {
    return {
        total: a.total + b.total,
        added: a.added + b.added,
        moved: a.moved + b.moved,
        already_member: a.already_member + b.already_member,
        failed: a.failed + b.failed,
        results: [...a.results, ...b.results],
    };
}

/** A whole chunk the server never answered: every learner in it is reported as failed. */
export function failedChunk(
    items: { user_id?: string | null; name?: string | null; email?: string | null }[],
    message: string
): SubOrgBulkResult {
    return {
        ...EMPTY_SUB_ORG_BULK_RESULT,
        total: items.length,
        failed: items.length,
        results: items.map((i) => ({ ...i, status: 'FAILED' as const, message })),
    };
}

export const bulkAddSubOrgMembers = async (payload: {
    institute_id: string;
    sub_org_id: string;
    package_session_id: string;
    learners: SubOrgBulkLearner[];
}): Promise<SubOrgBulkResult> => {
    const response = await authenticatedAxiosInstance.post<SubOrgBulkResult>(
        BULK_ADD_SUB_ORG_MEMBERS,
        payload
    );
    return response.data;
};

export const moveSubOrgMembers = async (payload: {
    institute_id: string;
    sub_org_id: string;
    members: SubOrgMoveMember[];
}): Promise<SubOrgBulkResult> => {
    const response = await authenticatedAxiosInstance.post<SubOrgBulkResult>(
        MOVE_SUB_ORG_MEMBERS,
        payload
    );
    return response.data;
};
