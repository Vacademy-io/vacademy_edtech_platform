import { useQuery } from '@tanstack/react-query';
import {
    UTM_SETTINGS_QUERY_KEY,
    fetchUtmSettings,
    type UtmSettingsData,
} from '@/services/utm-settings';
import { DEFAULT_UTM_SETTINGS } from '@/services/gtm-settings';

export interface UtmBuilderSwitch {
    /**
     * Whether to show the "Generate UTM link" action. Pessimistic — `false`
     * until the setting is known — because the feature ships OFF. An optimistic
     * `true` would flash a menu item into every share surface for the
     * overwhelming majority of institutes that never turn it on, then yank it
     * away a beat later.
     */
    enabled: boolean;
    /** Defaults and pick lists the builder pre-fills from. */
    settings: UtmSettingsData;
    /** The institute's actual preference is now known (success or failure). */
    isResolved: boolean;
}

/**
 * The institute's UTM link-builder switch.
 *
 * Reads through the settings page's query key, so however many share surfaces
 * are on screen they resolve from one cached request, and saving in Settings
 * invalidates that key so a flip shows up without a reload.
 *
 * The underlying fetch falls back to the legacy `GTM_SETTING.utm` location for
 * institutes configured before UTM became its own setting — see
 * services/utm-settings.
 */
export function useUtmBuilderEnabled(): UtmBuilderSwitch {
    const { data, isSuccess, isError } = useQuery({
        queryKey: UTM_SETTINGS_QUERY_KEY,
        queryFn: fetchUtmSettings,
        staleTime: 5 * 60 * 1000,
    });

    return {
        enabled: data?.enabled === true,
        settings: data ?? DEFAULT_UTM_SETTINGS,
        isResolved: isSuccess || isError,
    };
}
