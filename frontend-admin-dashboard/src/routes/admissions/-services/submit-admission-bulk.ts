import { BULK_SUBMIT_ADMISSION_WITH_LEAD } from '@/constants/urls';
import type { TFunction } from 'i18next';

export interface BulkSubmitAdmissionRow {
    session_id: string;
    destination_package_session_id: string;

    father_name?: string;
    father_email?: string;
    father_mobile?: string;
    mother_name?: string;
    mother_email?: string;
    mother_mobile?: string;
    guardian_name?: string;
    guardian_mobile?: string;

    child_name: string;
    child_dob: string; // yyyy-MM-dd
    child_gender: 'MALE' | 'FEMALE' | 'OTHER';

    status?: string;
    source_type?: string;
}

export interface BulkSubmitAdmissionRequest {
    institute_id: string;
    rows: BulkSubmitAdmissionRow[];
}

export interface BulkAdmissionRowResult {
    row_index: number;
    status: string; // SUCCESS / FAILED
    success: boolean;
    message?: string;
}

export interface BulkSubmitAdmissionResponse {
    summary: {
        successful: number;
        failed: number;
    };
    results?: BulkAdmissionRowResult[];
    [key: string]: unknown;
}

/**
 * `t`, when supplied, must be bound to the `admissionsSubmitAdmissionBulk`
 * namespace — it only supplies the fallback wording used when the server
 * response carries no JSON body of its own (callers render the thrown
 * `error.message` directly, e.g. in a toast description).
 */
export const submitAdmissionBulkWithLead = async (
    payload: BulkSubmitAdmissionRequest,
    t?: TFunction
): Promise<BulkSubmitAdmissionResponse> => {
    const response = await fetch(BULK_SUBMIT_ADMISSION_WITH_LEAD, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({
            message: t ? t('errors.bulkSubmitFailed') : 'Failed to submit admission bulk import',
        }));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }

    return response.json().catch(() => ({} as BulkSubmitAdmissionResponse));
};

