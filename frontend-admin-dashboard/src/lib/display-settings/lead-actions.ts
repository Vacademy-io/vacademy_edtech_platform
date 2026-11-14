import { useEffect, useState } from 'react';
import {
    DISPLAY_SETTINGS_UPDATED_EVENT,
    getDisplaySettings,
    getDisplaySettingsFromCache,
} from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { ADMIN_DISPLAY_SETTINGS_KEY, type LeadActionSettings } from '@/types/display-settings';

/**
 * Per-role gating for actions on the leads pages
 * (Display Settings → Lead Actions).
 *
 * Add New Lead is off for every role, admin included: a cold cache or an absent
 * flag resolves to hidden, so the button never flashes in before settings load.
 * Editing form answers defaults by ROLE instead — on for admin, off otherwise.
 */
export interface LeadActionVisibility {
    canAddLead: boolean;
    canEditFormResponses: boolean;
}

export const resolveLeadActions = (
    settings: LeadActionSettings | undefined,
    roleKey: string
): LeadActionVisibility => ({
    canAddLead: settings?.showAddLead === true,
    canEditFormResponses:
        settings?.allowEditFormResponses ?? roleKey === ADMIN_DISPLAY_SETTINGS_KEY,
});

const readFromCache = (): LeadActionVisibility => {
    const roleKey = getActiveRoleDisplaySettingsKey();
    return resolveLeadActions(getDisplaySettingsFromCache(roleKey)?.leadActions, roleKey);
};

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
                    if (!cancelled)
                        setVisibility(resolveLeadActions(settings?.leadActions, roleKey));
                })
                .catch(() => {
                    /* role default stands */
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
