import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';

/** Per-bucket outcome — partial success is expected, not an error. */
export interface BulkLeadStatusResult {
    updated: number;
    /** Leads already on the target status; counted, not rewritten. */
    unchanged: number;
    failed: number;
    /** Up to the first few failure reasons, for the toast. */
    errors: string[];
}

/**
 * Change the lead status of many leads in one call.
 *
 * Hits the bulk endpoint rather than looping the single-lead one client-side: the
 * server runs every lead through the same `changeLeadStatus` path (history row,
 * timeline entry, LEAD_STATUS_CHANGED trigger, conversion_status mirror), and a
 * client-side loop over a few thousand selected leads would be thousands of
 * round trips.
 *
 * Note this takes audience_response ids — the row identity in the list — not user
 * ids, unlike the single-lead inline chip which goes through the per-user profile
 * endpoint.
 */
export async function bulkChangeLeadStatus(params: {
    responseIds: string[];
    statusId: string;
    instituteId: string;
}): Promise<BulkLeadStatusResult> {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${BASE_URL}/admin-core-service/v1/lead-status/leads/bulk`,
        data: {
            response_ids: params.responseIds,
            status_id: params.statusId,
            institute_id: params.instituteId,
            source: 'BULK_MANUAL',
        },
    });
    return response.data as BulkLeadStatusResult;
}
