import { useEffect, useState } from 'react';
import {
    DISPLAY_SETTINGS_UPDATED_EVENT,
    getDisplaySettings,
    getDisplaySettingsFromCache,
} from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import type { LeadActionSettings } from '@/types/display-settings';

/**
 * Per-role gating for actions on the leads pages
 * (Display Settings → Lead Actions).
 *
 * Off for every role, admin included: a cold cache or an absent flag resolves
 * to hidden, so the button never flashes in before settings load.
 */
export interface LeadActionVisibility {
    canAddLead: boolean;
}

export const resolveLeadActions = (
    settings: LeadActionSettings | undefined
): LeadActionVisibility => ({
    canAddLead: settings?.showAddLead === true,
});

const readFromCache = (): LeadActionVisibility =>
    resolveLeadActions(getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey())?.leadActions);

/**
 * Component-facing read. Seeds from the cache, fetches once if the cache is cold,
 * and re-reads whenever the settings blob is re-cached so an open page follows a
 * Display Settings save without a reload.
 */
export const useLeadActionVisibility = (): LeadActionVisibility => {
    const [visibility, setVisibility] = useState<LeadActionVisibility>(readFromCache);

    useEffect(() => {
        let cancelled = false;
        const sync = () => {
            if (!cancelled) setVisibility(readFromCache());
        };

        const roleKey = getActiveRoleDisplaySettingsKey();
        if (!getDisplaySettingsFromCache(roleKey)) {
            getDisplaySettings(roleKey)
                .then((settings) => {
                    if (!cancelled) setVisibility(resolveLeadActions(settings?.leadActions));
                })
                .catch(() => {
                    /* hidden stands */
                });
        }

        window.addEventListener(DISPLAY_SETTINGS_UPDATED_EVENT, sync);
        return () => {
            cancelled = true;
            window.removeEventListener(DISPLAY_SETTINGS_UPDATED_EVENT, sync);
        };
    }, []);

    return visibility;
};
