import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDisplaySettingsWithFallback } from '@/services/display-settings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    type ListBuiltInFilter,
    type ListCustomFieldSurface,
} from '@/types/display-settings';

export interface ListBuiltInFilterControlsResult {
    /** False once an admin has switched this filter off for the surface. */
    isVisible: (filter: ListBuiltInFilter) => boolean;
    isLoading: boolean;
}

/**
 * Which of a list surface's built-in filters (counsellor, campaign type,
 * audience) an admin has left switched on. Institute-wide, stored on the ADMIN
 * display-settings blob beside the custom-field and UTM filter controls and
 * edited from the same "Manage filters" popup.
 *
 * Absent config means every filter shows, so an institute that never opens the
 * popup sees exactly what it saw before this existed. While the settings are
 * loading everything is treated as visible — a filter bar that fills in is
 * better than one that flickers away.
 */
export function useListBuiltInFilterControls(
    surface: ListCustomFieldSurface
): ListBuiltInFilterControlsResult {
    const { data: displaySettings, isLoading } = useQuery({
        queryKey: ['display-settings', ADMIN_DISPLAY_SETTINGS_KEY, 'list-built-in-filters'],
        queryFn: () => getDisplaySettingsWithFallback(ADMIN_DISPLAY_SETTINGS_KEY),
        // Refresh on mount so a just-saved change shows when the admin comes
        // back to the list. The fetch is localStorage-backed, so this is cheap.
        staleTime: 0,
    });

    const hidden = displaySettings?.listBuiltInFilterControls?.[surface]?.hidden;

    const isVisible = useCallback(
        (filter: ListBuiltInFilter) => !hidden?.includes(filter),
        [hidden]
    );

    return { isVisible, isLoading };
}
