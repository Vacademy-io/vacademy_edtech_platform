import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getActiveRoleDisplaySettingsKey, getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { fetchCanDeletePayments } from '@/services/payment-logs';
import {
    DISPLAY_SETTINGS_UPDATED_EVENT,
    getDisplaySettingsFromCache,
    getDisplaySettingsWithFallback,
} from '@/services/display-settings';

const QUERY_KEY = 'can-delete-payments';

/**
 * May the viewer PERMANENTLY delete payments and invoices? Display Settings → Learner Management
 * → "delete payments & invoices", for the viewer's own role. OFF unless explicitly switched on —
 * a missing flag, a failed lookup and the loading state all read as false.
 *
 * Both sides must say yes: the role's setting here (so flipping the switch shows/hides the buttons
 * at once) AND the server's own check (so a button is never offered that the server would refuse
 * — the two once disagreed and an admin with the switch on got "turned off for your role").
 */
export function useCanDeletePayments(): boolean {
    const queryClient = useQueryClient();
    const roleKey = getActiveRoleDisplaySettingsKey();

    const { data: settingOn } = useQuery({
        queryKey: [QUERY_KEY, roleKey],
        queryFn: async () => {
            const settings =
                getDisplaySettingsFromCache(roleKey) ??
                (await getDisplaySettingsWithFallback(roleKey));
            return settings?.learnerManagement?.allowDeletePayments === true;
        },
        staleTime: 60_000,
    });

    // Asked only once the setting is on — institutes that never enable it make no extra call.
    const { data: serverAllows } = useQuery({
        queryKey: [QUERY_KEY, 'server', getCurrentInstituteId()],
        queryFn: fetchCanDeletePayments,
        enabled: settingOn === true,
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
