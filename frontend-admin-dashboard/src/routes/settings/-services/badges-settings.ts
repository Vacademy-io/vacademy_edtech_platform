import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    BADGES_REWARDS_SETTING_KEY,
    BadgeDefinitionConfig,
    BadgesRewardsConfig,
    DEFAULT_BADGE_CONFIG,
    DEFAULT_SCORING,
    ScoringConfig,
} from '../-constants/badge-config';

const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

const normalizeScoring = (raw: Partial<ScoringConfig> | undefined): ScoringConfig => {
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
    return {
        activityPerDay: num(raw?.activityPerDay, DEFAULT_SCORING.activityPerDay),
        streakPerDay: num(raw?.streakPerDay, DEFAULT_SCORING.streakPerDay),
        liveClassAttended: num(raw?.liveClassAttended, DEFAULT_SCORING.liveClassAttended),
        courseCompletion: num(raw?.courseCompletion, DEFAULT_SCORING.courseCompletion),
        assessmentBestScore: num(raw?.assessmentBestScore, DEFAULT_SCORING.assessmentBestScore),
    };
};

export interface BadgesRewardsState {
    enabled: boolean;
    scoring: ScoringConfig;
    badges: BadgeDefinitionConfig[];
    publicShowFullNames: boolean;
    /**
     * True when the server holds no badge list (key absent or empty array) and `badges` is
     * therefore the built-in default six. Callers that WRITE the blob back must know this.
     */
    storedBadgesEmpty: boolean;
}

/** Probe the SettingDto blob out of the axios response (shape varies with the wrapper). */
const extractBlob = (responseData: unknown): BadgesRewardsConfig | null => {
    const obj = (v: unknown): Record<string, unknown> | null =>
        v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    const r = obj(responseData);
    const keyed = obj(r?.[BADGES_REWARDS_SETTING_KEY])?.data;
    const nested = obj(obj(r?.data)?.[BADGES_REWARDS_SETTING_KEY])?.data;
    return (keyed ?? nested ?? r?.data ?? null) as BadgesRewardsConfig | null;
};

const toState = (blob: BadgesRewardsConfig | null): BadgesRewardsState => {
    const storedBadgesEmpty = !Array.isArray(blob?.badges) || blob!.badges.length === 0;
    const badges = storedBadgesEmpty ? DEFAULT_BADGE_CONFIG.badges : blob!.badges;
    // Master toggle defaults to OFF when absent — institutes must opt in.
    const enabled = blob?.enabled === true;
    const scoring = normalizeScoring(blob?.scoring);
    // Public leaderboard names default to anonymized (opt-in to show full names).
    const publicShowFullNames = blob?.publicShowFullNames === true;
    return { enabled, scoring, badges, publicShowFullNames, storedBadgesEmpty };
};

const fetchBlob = async (): Promise<BadgesRewardsConfig | null> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: BADGES_REWARDS_SETTING_KEY },
    });
    // SettingDto blob can be nested a couple of ways depending on the axios wrapper.
    // Probe the canonical shapes in the SAME order as services/display-settings.ts —
    // the real one is the bare `response.data.data` (NOT `[settingKey].data`).
    return extractBlob(response.data);
};

/**
 * Read the institute's full badge config (master toggle + scoring + badges), with defaults.
 * LENIENT: any fetch failure yields the defaults (feature off). Fine for READ-ONLY surfaces;
 * never feed its result into a save — use {@link getBadgesRewardsConfigStrict} for that.
 */
export const getBadgesRewardsConfig = async (): Promise<BadgesRewardsState> => {
    try {
        return toState(await fetchBlob());
    } catch (error) {
        console.error('Error fetching badge settings:', error);
        return {
            enabled: false,
            scoring: DEFAULT_SCORING,
            badges: DEFAULT_BADGE_CONFIG.badges,
            publicShowFullNames: false,
            storedBadgesEmpty: true,
        };
    }
};

/**
 * STRICT variant for write paths: throws on fetch failure instead of returning defaults, so a
 * transient error can never be echoed back as "the institute has no custom badges" and wipe
 * the catalogue on the next save.
 */
export const getBadgesRewardsConfigStrict = async (): Promise<BadgesRewardsState> => {
    return toState(await fetchBlob());
};

/**
 * Merge badges that exist on the server but not in a local working copy (e.g. a badge created
 * from the student view while the Settings page was open). Local edits win for shared ids;
 * server-only ids are appended in server order. Returns the merged list and what was added.
 */
export const mergeMissingBadges = (
    local: BadgeDefinitionConfig[],
    server: BadgeDefinitionConfig[]
): { merged: BadgeDefinitionConfig[]; added: BadgeDefinitionConfig[] } => {
    const localIds = new Set(local.map((b) => b.id));
    const added = server.filter((b) => !localIds.has(b.id));
    return { merged: added.length ? [...local, ...added] : local, added };
};

/** Badge list only (used by the student award picker). */
export const getBadgesSettings = async (): Promise<BadgeDefinitionConfig[]> => {
    return (await getBadgesRewardsConfig()).badges;
};

/** Whether the badges + leaderboard feature is enabled for this institute. */
export const getBadgesEnabled = async (): Promise<boolean> => {
    return (await getBadgesRewardsConfig()).enabled;
};

/** Persist the institute's badge config (master toggle + scoring + badges + public-names). */
export const saveBadgesSettings = async (
    badges: BadgeDefinitionConfig[],
    enabled: boolean,
    scoring: ScoringConfig,
    publicShowFullNames = false
): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    const settingData: BadgesRewardsConfig = {
        version: 1,
        enabled,
        scoring,
        badges,
        publicShowFullNames,
    };
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Badges & Rewards', setting_data: settingData },
        { params: { instituteId, settingKey: BADGES_REWARDS_SETTING_KEY } }
    );
};
