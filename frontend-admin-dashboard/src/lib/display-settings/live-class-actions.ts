import { useEffect, useState } from 'react';
import {
    DISPLAY_SETTINGS_UPDATED_EVENT,
    getDisplaySettings,
    getDisplaySettingsFromCache,
} from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { ADMIN_DISPLAY_SETTINGS_KEY, type LiveClassActionSettings } from '@/types/display-settings';

/**
 * Per-role gating for actions on the live-class list
 * (Display Settings → Live Class Actions).
 *
 * Unlike the assessment actions, these default by ROLE: on for admin, off for
 * teachers and custom roles. A cold cache or an absent flag resolves to that
 * role default, so a teacher never sees the button flash in before settings load.
 */
export interface LiveClassActionVisibility {
    canDeletePastSessions: boolean;
}

export const resolveLiveClassActions = (
    settings: LiveClassActionSettings | undefined,
    roleKey: string
): LiveClassActionVisibility => ({
    canDeletePastSessions:
        settings?.allowDeletePastSessions ?? roleKey === ADMIN_DISPLAY_SETTINGS_KEY,
});

const readFromCache = (): LiveClassActionVisibility => {
    const roleKey = getActiveRoleDisplaySettingsKey();
    return resolveLiveClassActions(
        getDisplaySettingsFromCache(roleKey)?.liveClassActions,
        roleKey
    );
};

/**
 * Component-facing read. Seeds from the cache, fetches once if the cache is cold,
 * and re-reads whenever the settings blob is re-cached so an open page follows a
 * Display Settings save without a reload.
 */
export const useLiveClassActionVisibility = (): LiveClassActionVisibility => {
    const [visibility, setVisibility] = useState<LiveClassActionVisibility>(readFromCache);

    useEffect(() => {
        let cancelled = false;
        const sync = () => {
            if (!cancelled) setVisibility(readFromCache());
        };

        const roleKey = getActiveRoleDisplaySettingsKey();
        if (!getDisplaySettingsFromCache(roleKey)) {
            getDisplaySettings(roleKey)
                .then((settings) => {
                    if (!cancelled) {
                        setVisibility(resolveLiveClassActions(settings?.liveClassActions, roleKey));
                    }
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
