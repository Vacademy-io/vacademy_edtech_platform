import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { DEFAULT_UTM_SETTINGS, fetchGtmSettings, type UtmSettingsData } from './gtm-settings';

export type { UtmSettingsData };

/**
 * The institute's UTM campaign-link settings.
 *
 * WHY THIS IS ITS OWN KEY, not a corner of GTM_SETTING: UTM attribution here
 * is entirely first-party. The capture and the beacon are ours, so an
 * institute with no tag manager, no GA4 and no container id still gets full
 * campaign attribution on every learner. A container only matters if they want
 * their OWN Analytics to read the same parameters.
 *
 * Filing it under "GTM" therefore hid campaign tracking from precisely the
 * schools most likely to want it — the ones who have never heard of Tag
 * Manager and have no reason to open a tab named after it.
 */
export const UTM_SETTING_KEY = 'UTM_SETTING';

/** Shared by the settings page and every share surface's gate. */
export const UTM_SETTINGS_QUERY_KEY = ['utm-settings'] as const;

const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

const normalize = (raw: unknown): UtmSettingsData => {
    const utm = (raw ?? {}) as Partial<UtmSettingsData>;
    return {
        enabled: utm.enabled === true,
        defaultSource: typeof utm.defaultSource === 'string' ? utm.defaultSource : '',
        defaultMedium: typeof utm.defaultMedium === 'string' ? utm.defaultMedium : '',
        sources: Array.isArray(utm.sources) ? utm.sources.filter((s) => typeof s === 'string') : [],
        mediums: Array.isArray(utm.mediums) ? utm.mediums.filter((s) => typeof s === 'string') : [],
        requireCampaign: utm.requireCampaign === true,
    };
};

/**
 * Reads the new key, falling back to the old `GTM_SETTING.utm` blob.
 *
 * The fallback is NOT temporary scaffolding to delete later. Institutes
 * configured before the split keep their setting exactly where it is until
 * someone next saves; without this read they would silently lose the toggle
 * the moment this build shipped, their "Generate UTM link" actions would
 * vanish from all six share surfaces, and nothing would say why.
 *
 * Never rejects: the share surfaces gate a menu item on this, and a settings
 * outage must degrade to "feature hidden", not to a broken dropdown.
 */
export const fetchUtmSettings = async (): Promise<UtmSettingsData> => {
    const instituteId = getCurrentInstituteId();
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: GET_INSITITUTE_SETTINGS,
            params: { instituteId, settingKey: UTM_SETTING_KEY },
        });
        const own = response.data?.data;
        // An institute that has saved since the split has its own row.
        if (own && typeof own === 'object' && 'enabled' in own) return normalize(own);
    } catch {
        /* fall through to the legacy location */
    }

    try {
        return (await fetchGtmSettings()).utm;
    } catch {
        return DEFAULT_UTM_SETTINGS;
    }
};

export const saveUtmSettings = async (data: UtmSettingsData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'UTM Settings', setting_data: data },
        { params: { instituteId, settingKey: UTM_SETTING_KEY } }
    );
};
