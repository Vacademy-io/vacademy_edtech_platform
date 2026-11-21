import type { TFunction } from 'i18next';
import { BULK_SUBMIT_AUDIENCE_LEAD_ADMIN_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { SubmitLeadRequest, throwWithServerMessage } from './submit-audience-lead';

export interface BulkSubmitLeadRequest {
    audience_id: string;
    rows: SubmitLeadRequest[];
}

export interface BulkSubmitLeadResultItem {
    index: number;
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
    message: string;
    audience_response_id?: string;
    user_id?: string;
}

export interface BulkSubmitLeadSummary {
    total_requested: number;
    successful: number;
    failed: number;
    skipped: number;
}

export interface BulkSubmitLeadResponse {
    summary: BulkSubmitLeadSummary;
    results: BulkSubmitLeadResultItem[];
}

/**
 * Bulk-import leads as the signed-in admin/counsellor.
 *
 * Sent with the session token so the backend knows who ran the import: under the
 * "only leads assigned to <ROLE>" audience-access option, rows with no owner
 * column are stamped to the importer rather than landing unassigned and
 * invisible to them. Same payload and same pipeline as the open bulk endpoint
 * otherwise.
 *
 * `t` must be bound to the `audienceManagerBulkSubmitAudienceLead` namespace — it
 * only supplies the fallback wording used when the server response carries no
 * message of its own (see {@link throwWithServerMessage}).
 */
export const submitBulkAudienceLead = async (
    payload: BulkSubmitLeadRequest,
    t: TFunction
): Promise<BulkSubmitLeadResponse> => {
    try {
        const response = await authenticatedAxiosInstance({
            method: 'POST',
            url: BULK_SUBMIT_AUDIENCE_LEAD_ADMIN_URL,
            data: payload,
        });
        return response.data as BulkSubmitLeadResponse;
    } catch (error) {
        return throwWithServerMessage(error, t('errors.submitFailed'));
    }
};
