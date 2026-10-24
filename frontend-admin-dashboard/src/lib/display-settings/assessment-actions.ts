import { useEffect, useState } from 'react';
import {
    DISPLAY_SETTINGS_UPDATED_EVENT,
    getDisplaySettings,
    getDisplaySettingsFromCache,
} from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import type { AssessmentActionSettings } from '@/types/display-settings';

/**
 * Per-role gating for the assessment create / edit / delete actions
 * (Display Settings → Assessment Actions).
 *
 * Every flag defaults to ON: an institute that has never touched the toggles,
 * or a cold cache, resolves to `true` so nothing disappears unexpectedly. All
 * reads go through `!== false` for that reason — never a truthiness check.
 */
export interface AssessmentActionVisibility {
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    /** Create / edit / delete / reorder folders and move assessments between them. */
    canManageFolders: boolean;
}

const resolve = (settings: AssessmentActionSettings | undefined): AssessmentActionVisibility => ({
    canCreate: settings?.showCreateAssessment !== false,
    canEdit: settings?.showEditAssessment !== false,
    canDelete: settings?.showDeleteAssessment !== false,
    canManageFolders: settings?.showManageFolders !== false,
});

const readFromCache = (): AssessmentActionVisibility =>
    resolve(getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey())?.assessmentPage);

/**
 * Component-facing read. Seeds from the cache for an instant first paint, fetches
 * once if the cache is cold (so a hidden action isn't briefly visible on a fresh
 * login), and re-reads whenever the settings blob is re-cached — that keeps open
 * pages in sync right after an admin saves Display Settings.
 */
export const useAssessmentActionVisibility = (): AssessmentActionVisibility => {
    const [visibility, setVisibility] = useState<AssessmentActionVisibility>(readFromCache);

    useEffect(() => {
        let cancelled = false;
        const sync = () => {
            if (!cancelled) setVisibility(readFromCache());
        };

        const roleKey = getActiveRoleDisplaySettingsKey();
        if (!getDisplaySettingsFromCache(roleKey)) {
            getDisplaySettings(roleKey)
                .then((settings) => {
                    if (!cancelled) setVisibility(resolve(settings?.assessmentPage));
                })
                .catch(() => {
                    /* defaults-on stands */
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
