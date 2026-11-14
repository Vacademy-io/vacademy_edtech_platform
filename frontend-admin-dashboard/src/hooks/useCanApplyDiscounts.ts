import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getActiveRoleDisplaySettingsKey, getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { fetchCanApplyAdminDiscounts } from '@/services/admin-discounts';
import {
    DISPLAY_SETTINGS_UPDATED_EVENT,
    getDisplaySettingsFromCache,
    getDisplaySettingsWithFallback,
} from '@/services/display-settings';
import { ADMIN_DISPLAY_SETTINGS_KEY } from '@/types/display-settings';

const QUERY_KEY = 'can-apply-discounts';

/**
 * May the viewer apply admin discounts (manual enroll, bulk assign, admin invoice)? Display
 * Settings → Learner Management → "Apply discounts", for the viewer's own role. ON for the admin
 * card when the flag was never saved, OFF for every other role; the loading state and a failed
 * lookup read as false.
 *
 * Both sides must say yes: the role's setting here (so flipping the switch shows/hides the field
 * at once) AND the server's own check (so the field is never offered when the server would
 * refuse the discount).
 */
export function useCanApplyDiscounts(instituteId?: string | null): boolean {
    const queryClient = useQueryClient();
    const roleKey = getActiveRoleDisplaySettingsKey();
    const resolvedInstituteId = instituteId || getCurrentInstituteId();

    const { data: settingOn } = useQuery({
        queryKey: [QUERY_KEY, roleKey],
        queryFn: async () => {
            const settings =
                getDisplaySettingsFromCache(roleKey) ??
                (await getDisplaySettingsWithFallback(roleKey));
            const flag = settings?.learnerManagement?.canApplyDiscounts;
            return typeof flag === 'boolean' ? flag : roleKey === ADMIN_DISPLAY_SETTINGS_KEY;
        },
        staleTime: 60_000,
    });

    // Asked only once the setting is on — roles without it make no extra call.
    const { data: serverAllows } = useQuery({
        queryKey: [QUERY_KEY, 'server', resolvedInstituteId],
        queryFn: () => fetchCanApplyAdminDiscounts(resolvedInstituteId),
        enabled: settingOn === true && !!resolvedInstituteId,
        staleTime: 60_000,
    });

    // Turning the setting on or off takes effect without a reload.
    useEffect(() => {
        const refresh = () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
        window.addEventListener(DISPLAY_SETTINGS_UPDATED_EVENT, refresh);
        return () => window.removeEventListener(DISPLAY_SETTINGS_UPDATED_EVENT, refresh);
    }, [queryClient]);

    return settingOn === true && serverAllows === true;
}
