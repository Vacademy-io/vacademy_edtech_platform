import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS, SAVE_INSTITUTE_SETTING } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

/**
 * When on, a sub-org's staff lose access once its last active admin has left: straight away on a
 * hard terminate, on the last access date on a soft cancel. admin-core reads this in
 * SubOrgExitService. No setting saved = off.
 */
export interface SubOrgAdminExitCascadeSetting {
    enabled: boolean;
}

const SETTING_KEY = 'SUB_ORG_ADMIN_EXIT_CASCADE';

export const fetchSubOrgAdminExitCascadeSetting = async (
    instituteId?: string
): Promise<SubOrgAdminExitCascadeSetting> => {
    const resolvedInstituteId = instituteId || getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId: resolvedInstituteId, settingKey: SETTING_KEY },
    });
    return { enabled: response.data?.data?.enabled === true };
};

export const saveSubOrgAdminExitCascadeSetting = async (
    setting: SubOrgAdminExitCascadeSetting
): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_INSTITUTE_SETTING,
        { setting_name: 'Sub-org admin exit cascade', setting_data: setting },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

export const subOrgAdminExitCascadeQueryKey = (instituteId?: string | null) => [
    'suborg-admin-exit-cascade-setting',
    instituteId || getCurrentInstituteId(),
];

export const useSubOrgAdminExitCascadeSetting = (instituteId?: string) => {
    return useQuery({
        queryKey: subOrgAdminExitCascadeQueryKey(instituteId),
        queryFn: () => fetchSubOrgAdminExitCascadeSetting(instituteId),
        staleTime: 5 * 60 * 1000,
    });
};
