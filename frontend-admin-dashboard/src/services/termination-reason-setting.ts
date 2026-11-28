import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS, SAVE_INSTITUTE_SETTING } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

/**
 * Reason box on Remove from Course → Hard Terminate. `enabled` shows it,
 * `required` blocks the termination until it is filled — admin-core enforces
 * `required` too (BulkDeassignmentService), so the API cannot skip it.
 */
export interface TerminationReasonSetting {
    enabled: boolean;
    required: boolean;
}

const SETTING_KEY = 'LEARNER_TERMINATION_REASON';

// No setting saved yet → ask for a reason, but let the admin leave it blank.
export const DEFAULT_TERMINATION_REASON_SETTING: TerminationReasonSetting = {
    enabled: true,
    required: false,
};

export const fetchTerminationReasonSetting = async (
    instituteId?: string
): Promise<TerminationReasonSetting> => {
    const resolvedInstituteId = instituteId || getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId: resolvedInstituteId, settingKey: SETTING_KEY },
    });
    const val = response.data?.data;
    if (!val || typeof val !== 'object') return DEFAULT_TERMINATION_REASON_SETTING;
    const enabled = val.enabled !== false;
    return { enabled, required: enabled && val.required === true };
};

export const saveTerminationReasonSetting = async (
    setting: TerminationReasonSetting
): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_INSTITUTE_SETTING,
        { setting_name: 'Learner Termination Reason', setting_data: setting },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

export const terminationReasonQueryKey = (instituteId?: string | null) => [
    'termination-reason-setting',
    instituteId || getCurrentInstituteId(),
];

export const useTerminationReasonSetting = (instituteId?: string) => {
    return useQuery({
        queryKey: terminationReasonQueryKey(instituteId),
        queryFn: () => fetchTerminationReasonSetting(instituteId),
        staleTime: 5 * 60 * 1000,
    });
};
