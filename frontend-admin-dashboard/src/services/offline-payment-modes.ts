import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

/**
 * The offline payment modes an institute offers when an admin records a payment (Cash, UPI
 * via PhonePe, bank transfer into an account, cheque ...), and the details an admin gives.
 * Backend: OfflinePaymentModeService / OfflinePaymentDetailsService.
 * See docs/OFFLINE_PAYMENT_RECORDING.md.
 */

export const OFFLINE_PAYMENT_MODES_URL = `${BASE_URL}/admin-core-service/v1/institute/offline-payment-modes`;

export type OfflineExtraField = 'cheque_date' | 'bank_name' | 'payer_name';
export const OFFLINE_EXTRA_FIELDS: OfflineExtraField[] = ['cheque_date', 'bank_name', 'payer_name'];

export interface OfflinePaymentSubMode {
    code?: string | null;
    label: string;
    active: boolean;
}

export type OfflineCustomFieldType = 'TEXT' | 'DATE' | 'NUMBER' | 'SELECT';
export const OFFLINE_CUSTOM_FIELD_TYPES: OfflineCustomFieldType[] = ['TEXT', 'DATE', 'NUMBER', 'SELECT'];

/** An input an institute adds to a mode (cheque status, branch, transaction date ...). */
export interface OfflineCustomField {
    /** Stable id within the mode; derived from the label on first save. */
    key?: string | null;
    label: string;
    type: OfflineCustomFieldType;
    required?: boolean;
    active: boolean;
    /** Choices of a SELECT field. */
    options?: string[];
}

export interface OfflinePaymentMode {
    code?: string | null;
    label: string;
    active: boolean;
    reference_label?: string | null;
    reference_required?: boolean;
    proof_required?: boolean;
    extra_fields?: OfflineExtraField[];
    /** Built-in extras that must be filled (subset of extra_fields). */
    required_extra_fields?: OfflineExtraField[];
    custom_fields?: OfflineCustomField[];
    /** What the options are called, e.g. "Account"; empty = a generic label. */
    sub_mode_label?: string | null;
    sub_mode_required?: boolean;
    sub_modes?: OfflinePaymentSubMode[];
}

export interface OfflinePaymentModes {
    require_mode: boolean;
    default_mode?: string | null;
    modes: OfflinePaymentMode[];
}

/** Sent as `payment_details` on every admin record-payment request. */
export interface OfflinePaymentDetails {
    mode?: string | null;
    sub_mode?: string | null;
    reference?: string | null;
    /** YYYY-MM-DD */
    payment_date?: string | null;
    notes?: string | null;
    proof_file_id?: string | null;
    extra?: Partial<Record<OfflineExtraField, string>>;
    /** Custom field values by field key. */
    custom?: Record<string, string>;
    /** The numbering-series field (e.g. branch) picked on an enrolment's first payment. */
    numbering_value?: string | null;
}

export const fetchOfflinePaymentModes = async (instituteId: string): Promise<OfflinePaymentModes> => {
    const res = await authenticatedAxiosInstance.get<OfflinePaymentModes>(OFFLINE_PAYMENT_MODES_URL, {
        params: { instituteId },
    });
    return res.data;
};

export const saveOfflinePaymentModes = async (
    instituteId: string,
    modes: OfflinePaymentModes
): Promise<OfflinePaymentModes> => {
    const res = await authenticatedAxiosInstance.put<OfflinePaymentModes>(OFFLINE_PAYMENT_MODES_URL, modes, {
        params: { instituteId },
    });
    return res.data;
};

const queryKey = (instituteId: string | undefined) => ['offline-payment-modes', instituteId];

/** The institute's modes (or the system defaults). Shared by every record-payment dialog. */
export const useOfflinePaymentModes = (instituteId?: string | null) => {
    const id = instituteId ?? getCurrentInstituteId();
    return useQuery({
        queryKey: queryKey(id),
        queryFn: () => fetchOfflinePaymentModes(id!),
        enabled: !!id,
        staleTime: 5 * 60 * 1000,
    });
};

export const useSaveOfflinePaymentModes = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ instituteId, modes }: { instituteId: string; modes: OfflinePaymentModes }) =>
            saveOfflinePaymentModes(instituteId, modes),
        onSuccess: (saved, { instituteId }) => {
            queryClient.setQueryData(queryKey(instituteId), saved);
        },
    });
};

/** The mode in force for a code, if active. */
export const findActiveMode = (modes: OfflinePaymentModes | undefined, code?: string | null) =>
    code ? modes?.modes.find((m) => m.active && m.code === code) : undefined;

/**
 * What blocks submitting the details, as a translation key (namespace
 * commonOfflinePaymentFields), mirroring the backend checks. Null when they can be sent.
 */
export const offlinePaymentDetailsError = (
    value: OfflinePaymentDetails | null | undefined,
    modes: OfflinePaymentModes | undefined
): string | null => {
    if (!modes) return null;
    const mode = findActiveMode(modes, value?.mode);
    if (!mode) return modes.require_mode ? 'errors.modeRequired' : null;
    if (mode.sub_mode_required && !value?.sub_mode && (mode.sub_modes ?? []).some((s) => s.active))
        return 'errors.subModeRequired';
    if (mode.reference_required && !value?.reference?.trim()) return 'errors.referenceRequired';
    if ((mode.required_extra_fields ?? []).some((f) => (mode.extra_fields ?? []).includes(f) && !value?.extra?.[f]?.trim()))
        return 'errors.fieldRequired';
    if (activeCustomFields(mode).some((f) => f.required && !value?.custom?.[f.key!]?.trim()))
        return 'errors.fieldRequired';
    if (mode.proof_required && !value?.proof_file_id) return 'errors.proofRequired';
    return null;
};

/** A mode's custom fields that are switched on and saved (have a key). */
export const activeCustomFields = (mode: OfflinePaymentMode | undefined): OfflineCustomField[] =>
    (mode?.custom_fields ?? []).filter((f) => f.active && f.key);

/** The details to send: null when nothing was filled in, empty strings dropped. */
export const toOfflinePaymentDetailsPayload = (
    value: OfflinePaymentDetails | null | undefined
): OfflinePaymentDetails | null => {
    if (!value) return null;
    const extra = Object.fromEntries(
        Object.entries(value.extra ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
    );
    const custom = Object.fromEntries(
        Object.entries(value.custom ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
    );
    const out: OfflinePaymentDetails = {
        mode: value.mode || null,
        sub_mode: value.mode && value.sub_mode ? value.sub_mode : null,
        reference: value.reference?.trim() || null,
        payment_date: value.payment_date || null,
        notes: value.notes?.trim() || null,
        proof_file_id: value.proof_file_id || null,
        extra: Object.keys(extra).length ? extra : undefined,
        custom: value.mode && Object.keys(custom).length ? custom : undefined,
        numbering_value: value.numbering_value?.trim() || undefined,
    };
    const empty =
        !out.mode &&
        !out.reference &&
        !out.payment_date &&
        !out.notes &&
        !out.proof_file_id &&
        !out.extra &&
        !out.custom &&
        !out.numbering_value;
    return empty ? null : out;
};

/** Starting value for a dialog: the institute's default mode preselected. */
export const initialOfflinePaymentDetails = (modes: OfflinePaymentModes | undefined): OfflinePaymentDetails => ({
    mode: findActiveMode(modes, modes?.default_mode)?.code ?? null,
});

/** How a recorded payment was made, read back from a payment log (labels as recorded). */
export interface RecordedPaymentDetails {
    /** "UPI · PhonePe", or null when no mode was recorded. */
    label: string | null;
    reference: string | null;
    notes: string | null;
    proofFileId: string | null;
    extra: Partial<Record<OfflineExtraField, string>>;
    /** Custom field values with their labels as recorded. */
    custom: { key: string; label: string; value: string }[];
}

export const readRecordedPaymentDetails = (log?: {
    payment_mode?: string | null;
    payment_reference?: string | null;
    payment_details_json?: string | null;
} | null): RecordedPaymentDetails | null => {
    if (!log || (!log.payment_mode && !log.payment_reference && !log.payment_details_json)) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: Record<string, any> = {};
    try {
        json = log.payment_details_json ? JSON.parse(log.payment_details_json) : {};
    } catch {
        json = {};
    }
    const modeLabel = json.mode_label ?? log.payment_mode ?? null;
    const label = modeLabel ? [modeLabel, json.sub_mode_label].filter(Boolean).join(' · ') : null;
    const extra: Partial<Record<OfflineExtraField, string>> = {};
    for (const f of OFFLINE_EXTRA_FIELDS) if (json[f]) extra[f] = json[f];
    return {
        label,
        reference: log.payment_reference ?? null,
        notes: json.notes ?? null,
        proofFileId: json.proof_file_id ?? null,
        extra,
        custom: Array.isArray(json.custom_fields)
            ? json.custom_fields.filter(
                  (c: unknown): c is { key: string; label: string; value: string } =>
                      !!c && typeof (c as { value?: unknown }).value === 'string'
              )
            : [],
    };
};
