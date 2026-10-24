import { BULK_SUBMIT_APPLICATION_WITH_LEAD } from '@/constants/urls';
import type { TFunction } from 'i18next';

export interface BulkSubmitApplicationRow {
    session_id: string;
    destination_package_session_id: string;

    father_name?: string;
    father_mobile?: string;
    father_email?: string;
    mother_name?: string;
    mother_mobile?: string;
    mother_email?: string;

    child_name: string;
    child_dob: string; // yyyy-MM-dd
    child_gender: 'MALE' | 'FEMALE' | 'OTHER';

    address_line?: string;
}

export interface BulkSubmitApplicationRequest {
    institute_id: string;
    rows: BulkSubmitApplicationRow[];
}

export interface BulkRowResult {
    row_index: number;
    status: string; // SUCCESS / FAILED
    success: boolean;
    message?: string;
}

export interface BulkSubmitApplicationResponse {
    summary: {
        successful: number;
        failed: number;
    };
    results?: BulkRowResult[];
    [key: string]: unknown;
}

/**
 * `t`, when supplied, must be bound to the `admissionsSubmitApplicationBulk` namespace —
 * it only supplies the fallback wording used when the server response carries
 * no JSON body of its own (callers render the thrown `error.message` directly,
 * e.g. in a toast description).
 */
export const submitApplicationBulkWithLead = async (
    payload: BulkSubmitApplicationRequest,
    t?: TFunction
): Promise<BulkSubmitApplicationResponse> => {
    const response = await fetch(BULK_SUBMIT_APPLICATION_WITH_LEAD, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({
            message: t ? t('errors.bulkSubmitFailed') : 'Failed to submit application bulk import',
        }));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }

    return response.json().catch(() => ({} as BulkSubmitApplicationResponse));
};

