import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';

/** The institute's rule for moving a lead to CONVERTED when the person has no course or fee plan yet. */
export type AdmissionCourseMode = 'OFF' | 'WARN' | 'BLOCK';

/** status_key of the institute's admission status; the label is the institute's own. */
export const CONVERTED_STATUS_KEY = 'CONVERTED';

export interface AdmissionCheckResult {
    mode: AdmissionCourseMode;
    status_key: string;
    /** Leads of this institute that were checked. */
    checked: number;
    without_course_count: number;
    /** audience_response ids whose person has no course or fee plan here yet. */
    without_course: string[];
}

const URL = `${BASE_URL}/admin-core-service/v1/lead-status/admission-check`;

/** Above this many ids the check goes in a POST body instead of the query string. */
const GET_LIMIT = 50;

/**
 * Read-only: the institute's rule plus which of these leads have no course or fee plan yet.
 * With the rule OFF the server looks nothing up and answers with empty lists.
 */
export async function checkAdmission(
    instituteId: string,
    responseIds: string[]
): Promise<AdmissionCheckResult> {
    if (responseIds.length <= GET_LIMIT) {
        const { data } = await authenticatedAxiosInstance.get(URL, {
            params: { instituteId, responseIds: responseIds.join(',') },
        });
        return data as AdmissionCheckResult;
    }
    const { data } = await authenticatedAxiosInstance.post(URL, {
        institute_id: instituteId,
        response_ids: responseIds,
    });
    return data as AdmissionCheckResult;
}

/** The server's own words for a refused status change (409 under the BLOCK rule), if it gave any. */
export function serverRefusal(error: unknown): string | null {
    const response = (
        error as { response?: { status?: number; data?: { ex?: string; message?: string } } }
    )?.response;
    if (response?.status !== 409) return null;
    return response.data?.ex ?? response.data?.message ?? null;
}
