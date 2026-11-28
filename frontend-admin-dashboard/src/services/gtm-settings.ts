import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

/**
 * The institute's `GTM_SETTING` blob — the container injection switch AND the
 * UTM link-builder switch that rides on the same setting key.
 *
 * WHY ONE KEY: UTM tags and a GTM container are the two halves of the same job
 * — the container is what READS `utm_*` off the landing URL, so an institute
 * that has not connected any tag manager has nothing to read the parameters an
 * admin would be generating. Keeping them in one settings card (and one row)
 * means an admin configures "how do we measure campaigns" once, and a single
 * cached request answers both questions everywhere in the app.
 */
export interface UtmSettingsData {
    /**
     * Off by default. When off, the "Generate UTM link" action is hidden from
     * every share surface — attribution is still RECORDED (see the learner
     * app's utm-attribution beacon), so an institute that switches this on
     * later still has its history rather than starting from zero.
     */
    enabled: boolean;
    /** Pre-filled in the builder; the admin can always override per link. */
    defaultSource: string;
    defaultMedium: string;
    /** Admin-curated pick lists, so campaign naming stays consistent. */
    sources: string[];
    mediums: string[];
    /**
     * When true the builder requires utm_campaign before it will hand over a
     * URL. Source/medium without a campaign is the single most common way a
     * report ends up unreadable, so this is opt-in strictness, default off.
     */
    requireCampaign: boolean;
}

export interface GtmSettingsData {
    enabled: boolean;
    containerId: string;
    utm: UtmSettingsData;
}

export const DEFAULT_UTM_SETTINGS: UtmSettingsData = {
    enabled: false,
    defaultSource: '',
    defaultMedium: '',
    sources: [],
    mediums: [],
    requireCampaign: false,
};

export const DEFAULT_GTM_SETTINGS: GtmSettingsData = {
    enabled: false,
    containerId: '',
    utm: DEFAULT_UTM_SETTINGS,
};

export const GTM_SETTING_KEY = 'GTM_SETTING';

/** Shared across the settings page and every share surface's gate. */
export const GTM_SETTINGS_QUERY_KEY = ['gtm-settings'] as const;

const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

/**
 * Older rows were saved before `utm` existed and have no such key; a few have
 * it as a partial object written by an earlier client. Normalising here means
 * no call site has to defend against either shape.
 */
const normalize = (raw: unknown): GtmSettingsData => {
    const data = (raw ?? {}) as Partial<GtmSettingsData> & { utm?: Partial<UtmSettingsData> };
    const utm: Partial<UtmSettingsData> = data.utm ?? {};
    return {
        enabled: data.enabled === true,
        containerId: typeof data.containerId === 'string' ? data.containerId : '',
        utm: {
            enabled: utm.enabled === true,
            defaultSource: typeof utm.defaultSource === 'string' ? utm.defaultSource : '',
            defaultMedium: typeof utm.defaultMedium === 'string' ? utm.defaultMedium : '',
            sources: Array.isArray(utm.sources)
                ? utm.sources.filter((entry): entry is string => typeof entry === 'string')
                : [],
            mediums: Array.isArray(utm.mediums)
                ? utm.mediums.filter((entry): entry is string => typeof entry === 'string')
                : [],
            requireCampaign: utm.requireCampaign === true,
        },
    };
};

/**
 * Never rejects: the share surfaces gate a menu item on this, and a settings
 * outage must degrade to "feature hidden", not to a broken dropdown.
 */
export const fetchGtmSettings = async (): Promise<GtmSettingsData> => {
    const instituteId = getCurrentInstituteId();
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: GET_INSITITUTE_SETTINGS,
            params: { instituteId, settingKey: GTM_SETTING_KEY },
        });
        return normalize(response.data?.data);
    } catch {
        return DEFAULT_GTM_SETTINGS;
    }
};

export const saveGtmSettings = async (data: GtmSettingsData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'GTM Settings', setting_data: data },
        { params: { instituteId, settingKey: GTM_SETTING_KEY } }
    );
};
