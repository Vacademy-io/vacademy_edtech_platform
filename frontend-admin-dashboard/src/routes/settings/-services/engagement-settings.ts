import { isAxiosError } from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

/**
 * ENGAGEMENT_SETTING — the institute-level knobs for daily engagement.
 *
 * Every value has a working default on the server (EngagementSettingsService), so an
 * institute that never opens this screen behaves sensibly. The keys, defaults and
 * ranges here MUST stay in lock-step with that service.
 */
export const ENGAGEMENT_SETTING_KEY = 'ENGAGEMENT_SETTING';

export interface EngagementSettings {
    /** Tasks a learner is shown per day ACROSS ALL their batches. */
    dailyItemCap: number;
    /** Scroll depth needed for a reading to count, 0-100. */
    minScrollPercent: number;
    /** Seconds on the page needed for a reading to count. */
    minReadSeconds: number;
    /** Seconds a game must be open, measured by the server, before it pays out. */
    minGameSeconds: number;
    /**
     * Whether a self-reported game score may earn score-proportional points on top of
     * completion points. Off by default: the page reports its own score.
     */
    allowUnverifiedScoreBonus: boolean;
}

export const DEFAULT_ENGAGEMENT_SETTINGS: EngagementSettings = {
    dailyItemCap: 5,
    minScrollPercent: 80,
    minReadSeconds: 15,
    minGameSeconds: 20,
    allowUnverifiedScoreBonus: false,
};

/** The server clamps to these; the form validates against the same ranges. */
export const ENGAGEMENT_SETTING_RANGES = {
    dailyItemCap: { min: 1, max: 50 },
    minScrollPercent: { min: 0, max: 100 },
    minReadSeconds: { min: 0, max: 3600 },
    minGameSeconds: { min: 0, max: 3600 },
} as const satisfies Record<string, { min: number; max: number }>;

export type EngagementNumericSetting = keyof typeof ENGAGEMENT_SETTING_RANGES;

/**
 * What the screen loaded. `extra` holds any keys in the stored blob this screen does
 * not know about (added by a newer server or another tool); they are written back
 * untouched on save, because the save endpoint replaces the whole blob.
 */
export interface LoadedEngagementSettings {
    settings: EngagementSettings;
    extra: Record<string, unknown>;
}

const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

const KNOWN_KEYS = new Set<string>(Object.keys(DEFAULT_ENGAGEMENT_SETTINGS));

const clamp = (v: unknown, d: number, min: number, max: number) => {
    const n = Number(v);
    if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return d;
    return Math.max(min, Math.min(max, Math.round(n)));
};

const asObject = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const extractBlob = (responseData: unknown): Record<string, unknown> | null => {
    const r = asObject(responseData);
    const keyed = asObject(asObject(r?.[ENGAGEMENT_SETTING_KEY])?.data);
    const nested = asObject(asObject(asObject(r?.data)?.[ENGAGEMENT_SETTING_KEY])?.data);
    return keyed ?? nested ?? asObject(r?.data);
};

const range = (
    key: EngagementNumericSetting,
    raw: Partial<EngagementSettings> | null | undefined
) =>
    clamp(
        raw?.[key],
        DEFAULT_ENGAGEMENT_SETTINGS[key],
        ENGAGEMENT_SETTING_RANGES[key].min,
        ENGAGEMENT_SETTING_RANGES[key].max
    );

export const normalizeEngagementSettings = (
    raw: Partial<EngagementSettings> | null | undefined
): EngagementSettings => ({
    dailyItemCap: range('dailyItemCap', raw),
    minScrollPercent: range('minScrollPercent', raw),
    minReadSeconds: range('minReadSeconds', raw),
    minGameSeconds: range('minGameSeconds', raw),
    allowUnverifiedScoreBonus: raw?.allowUnverifiedScoreBonus === true,
});

/**
 * Loads the saved settings.
 *
 * Only "nothing saved yet" (a 404 or an empty blob) falls back to the defaults. Any
 * other failure THROWS: showing defaults as if they were saved, and then saving one
 * field, would overwrite the institute's real values.
 */
export const getEngagementSettings = async (): Promise<LoadedEngagementSettings> => {
    const instituteId = getCurrentInstituteId();
    let blob: Record<string, unknown> | null;
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: GET_INSITITUTE_SETTINGS,
            params: { instituteId, settingKey: ENGAGEMENT_SETTING_KEY },
        });
        blob = extractBlob(response.data);
    } catch (error) {
        if (isAxiosError(error) && error.response?.status === 404) {
            return { settings: DEFAULT_ENGAGEMENT_SETTINGS, extra: {} };
        }
        throw error;
    }
    if (!blob || Object.keys(blob).length === 0) {
        return { settings: DEFAULT_ENGAGEMENT_SETTINGS, extra: {} };
    }
    const extra = Object.fromEntries(Object.entries(blob).filter(([k]) => !KNOWN_KEYS.has(k)));
    return {
        settings: normalizeEngagementSettings(blob as Partial<EngagementSettings>),
        extra,
    };
};

export const saveEngagementSettings = async (
    settings: EngagementSettings,
    extra: Record<string, unknown> = {}
): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        {
            setting_name: 'Daily Engagement',
            setting_data: { ...extra, ...normalizeEngagementSettings(settings) },
        },
        { params: { instituteId, settingKey: ENGAGEMENT_SETTING_KEY } }
    );
};
