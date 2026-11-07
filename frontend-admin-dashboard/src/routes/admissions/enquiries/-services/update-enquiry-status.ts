import type { TFunction } from 'i18next';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { UPDATE_ENQUIRY_STATUS } from '@/constants/urls';

export type EnquiryStatus =
    | 'NEW'
    | 'CONTACTED'
    | 'QUALIFIED'
    | 'NOT_ELIGIBLE'
    | 'FOLLOW_UP'
    | 'CLOSED'
    | 'CONVERTED'
    | 'ADMITTED';

export type ConversionStatus = 'HOT' | 'COLD';

/**
 * NOTE: these English labels are kept as the canonical, untranslated source
 * of truth — `enquiry-bulk-import-utils.ts` matches raw spreadsheet text
 * (e.g. an uploaded column literally containing "New") against `label` to
 * resolve the enum value, so this array must stay in English regardless of
 * the active UI locale. For user-facing rendering (e.g. the bulk-action
 * dropdowns in EnquiryTable.tsx), use `buildEnquiryStatusOptions(t)` /
 * `buildConversionStatusOptions(t)` below instead.
 */
export const ENQUIRY_STATUS_OPTIONS: { value: EnquiryStatus; label: string }[] = [
    { value: 'NEW', label: 'New' },
    { value: 'CONTACTED', label: 'Contacted' },
    { value: 'QUALIFIED', label: 'Qualified' },
    { value: 'NOT_ELIGIBLE', label: 'Not Eligible' },
    { value: 'FOLLOW_UP', label: 'Follow up' },
    { value: 'CLOSED', label: 'Closed' },
    { value: 'CONVERTED', label: 'Converted' },
    { value: 'ADMITTED', label: 'Admitted' },
];

export const CONVERSION_STATUS_OPTIONS: { value: ConversionStatus; label: string }[] = [
    { value: 'HOT', label: 'Hot' },
    { value: 'COLD', label: 'Cold' },
];

/**
 * Translated enquiry status options for user-facing display (dropdowns,
 * selects, etc.). `t`, when supplied, may be bound to any namespace — keys
 * are resolved against `admissionsUpdateEnquiryStatus` explicitly so this
 * works regardless of the caller's own default namespace. `value` fields are
 * the stable enum values used for API calls and stay untouched.
 */
export const buildEnquiryStatusOptions = (
    t: TFunction
): { value: EnquiryStatus; label: string }[] => [
    { value: 'NEW', label: t('admissionsUpdateEnquiryStatus:status.new') },
    { value: 'CONTACTED', label: t('admissionsUpdateEnquiryStatus:status.contacted') },
    { value: 'QUALIFIED', label: t('admissionsUpdateEnquiryStatus:status.qualified') },
    { value: 'NOT_ELIGIBLE', label: t('admissionsUpdateEnquiryStatus:status.notEligible') },
    { value: 'FOLLOW_UP', label: t('admissionsUpdateEnquiryStatus:status.followUp') },
    { value: 'CLOSED', label: t('admissionsUpdateEnquiryStatus:status.closed') },
    { value: 'CONVERTED', label: t('admissionsUpdateEnquiryStatus:status.converted') },
    { value: 'ADMITTED', label: t('admissionsUpdateEnquiryStatus:status.admitted') },
];

/**
 * Translated conversion status options for user-facing display. See
 * `buildEnquiryStatusOptions` for the cross-namespace `t` contract.
 */
export const buildConversionStatusOptions = (
    t: TFunction
): { value: ConversionStatus; label: string }[] => [
    { value: 'HOT', label: t('admissionsUpdateEnquiryStatus:conversion.hot') },
    { value: 'COLD', label: t('admissionsUpdateEnquiryStatus:conversion.cold') },
];

export interface UpdateEnquiryStatusPayload {
    enquiry_ids: string[];
    enquiry_status?: EnquiryStatus;
    conversion_status?: ConversionStatus;
}

export const updateEnquiryStatus = async (payload: UpdateEnquiryStatusPayload): Promise<void> => {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];

    const response = await fetch(`${UPDATE_ENQUIRY_STATUS}?instituteId=${INSTITUTE_ID}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Failed to update enquiry status: ${response.statusText}`);
    }
};
