import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSTITUTE_SETTING_DATA, SAVE_INSTITUTE_SETTING } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

/**
 * Institute-wide Manage Payments preferences, shared by every admin of the institute (the card row
 * is per browser — see useKpiCardPrefs). Stored in the generic Institute.setting JSON map, so no
 * backend code of its own.
 */
export const MANAGE_PAYMENTS_SETTING_KEY = 'MANAGE_PAYMENTS_SETTINGS';

export interface ManagePaymentsSettings {
    /** Drop the Payment Plan field from the Filters panel. Missing = shown. */
    hide_payment_plan_filter?: boolean;
}

const queryKey = (instituteId: string | null) => ['manage-payments-settings', instituteId];

export const fetchManagePaymentsSettings = async (
    instituteId: string
): Promise<ManagePaymentsSettings> => {
    try {
        const res = await authenticatedAxiosInstance.get<ManagePaymentsSettings | null>(
            GET_INSTITUTE_SETTING_DATA,
            { params: { instituteId, settingKey: MANAGE_PAYMENTS_SETTING_KEY } }
        );
        return res.data && typeof res.data === 'object' ? res.data : {};
    } catch {
        // Never saved — the page keeps its defaults.
        return {};
    }
};

export const saveManagePaymentsSettings = async (
    instituteId: string,
    settings: ManagePaymentsSettings
): Promise<void> => {
    // GenericSettingRequest is snake_case on the BE; camelCase arrives as null and the save no-ops.
    await authenticatedAxiosInstance.post(
        SAVE_INSTITUTE_SETTING,
        { setting_name: 'Manage Payments', setting_data: settings },
        { params: { instituteId, settingKey: MANAGE_PAYMENTS_SETTING_KEY } }
    );
};

export const useManagePaymentsSettings = () => {
    const id = getCurrentInstituteId();
    return useQuery({
        queryKey: queryKey(id),
        queryFn: () => fetchManagePaymentsSettings(id!),
        enabled: !!id,
        staleTime: 5 * 60 * 1000,
    });
};

export const useSaveManagePaymentsSettings = () => {
    const queryClient = useQueryClient();
    const id = getCurrentInstituteId();
    return useMutation({
        mutationFn: (settings: ManagePaymentsSettings) => saveManagePaymentsSettings(id!, settings),
        onMutate: (settings) => {
            const previous = queryClient.getQueryData<ManagePaymentsSettings>(queryKey(id));
            queryClient.setQueryData(queryKey(id), settings);
            return { previous };
        },
        onError: (_err, _settings, context) => {
            queryClient.setQueryData(queryKey(id), context?.previous);
        },
    });
};
