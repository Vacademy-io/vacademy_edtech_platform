import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { BASE_URL } from '@/constants/urls';
import {
    AssessmentSettingsData,
    AssessmentSettingsRequest,
    AssessmentSettingsResponse,
    DEFAULT_ASSESSMENT_SETTINGS,
    DEFAULT_REPORT_BRANDING,
    mergeExamExperience,
    normalizeCommentPlacement,
} from '@/types/assessment-settings';

const SETTINGS_KEY = 'ASSESSMENT_SETTING';
const LOCALSTORAGE_PREFIX = 'assessment-settings-cache';
const CACHE_EXPIRY_HOURS = 24;

const getLocalStorageKey = (instituteId: string | null | undefined): string | null => {
    if (!instituteId) return null;
    return `${LOCALSTORAGE_PREFIX}-${instituteId}`;
};

interface CachedSettings {
    data: AssessmentSettingsData;
    timestamp: number;
    instituteId: string;
}

export const mergeWithDefaults = (
    settings: Partial<AssessmentSettingsData>
): AssessmentSettingsData => {
    return {
        offlineEntry: {
            ...DEFAULT_ASSESSMENT_SETTINGS.offlineEntry,
            ...settings?.offlineEntry,
        },
        reportBranding: {
            ...DEFAULT_REPORT_BRANDING,
            ...settings?.reportBranding,
        },
        resultNotifications: {
            version: settings?.resultNotifications?.version ?? 1,
            roles: settings?.resultNotifications?.roles ?? {},
        },
        examExperience: mergeExamExperience(settings?.examExperience),
        aiCopyCheck: {
            commentPlacement: normalizeCommentPlacement(settings?.aiCopyCheck?.commentPlacement),
            ...(typeof settings?.aiCopyCheck?.instructions === 'string' && {
                instructions: settings.aiCopyCheck.instructions,
            }),
            ...(settings?.aiCopyCheck?.languageFeedback === 'HIGHLIGHT' && {
                languageFeedback: 'HIGHLIGHT' as const,
            }),
        },
        assessmentFolders: {
            enabled: settings?.assessmentFolders?.enabled === true,
        },
    };
};

const getCachedSettings = (): AssessmentSettingsData | null => {
    try {
        const instituteId = getInstituteId();
        if (!instituteId) return null;

        const key = getLocalStorageKey(instituteId);
        if (!key) return null;

        const cached = localStorage.getItem(key);
        if (!cached) return null;

        const cachedData: CachedSettings = JSON.parse(cached);
        const cacheAge = Date.now() - cachedData.timestamp;
        if (cacheAge > CACHE_EXPIRY_HOURS * 60 * 60 * 1000) {
            localStorage.removeItem(key);
            return null;
        }

        return mergeWithDefaults(cachedData.data);
    } catch {
        return null;
    }
};

const setCachedSettings = (settings: AssessmentSettingsData): void => {
    try {
        const instituteId = getInstituteId();
        if (!instituteId) return;

        const key = getLocalStorageKey(instituteId);
        if (!key) return;

        localStorage.setItem(
            key,
            JSON.stringify({ data: settings, timestamp: Date.now(), instituteId } as CachedSettings)
        );
    } catch {
        // ignore
    }
};

const fetchFromAPI = async (): Promise<AssessmentSettingsData> => {
    try {
        const instituteId = getInstituteId();
        if (!instituteId) return DEFAULT_ASSESSMENT_SETTINGS;

        const response = await authenticatedAxiosInstance.get<AssessmentSettingsResponse>(
            `${BASE_URL}/admin-core-service/institute/setting/v1/get`,
            { params: { instituteId, settingKey: SETTINGS_KEY } }
        );

        if (response.data?.data && Object.keys(response.data.data).length > 0) {
            const settings = mergeWithDefaults(response.data.data);
            setCachedSettings(settings);
            return settings;
        }

        return DEFAULT_ASSESSMENT_SETTINGS;
    } catch {
        return DEFAULT_ASSESSMENT_SETTINGS;
    }
};

export const getAssessmentSettings = async (
    forceRefresh = false
): Promise<AssessmentSettingsData> => {
    if (forceRefresh) return fetchFromAPI();

    const cached = getCachedSettings();
    if (cached) return cached;

    return fetchFromAPI();
};

export const getAssessmentSettingsFromCache = (): AssessmentSettingsData => {
    return getCachedSettings() || DEFAULT_ASSESSMENT_SETTINGS;
};

export const saveAssessmentSettings = async (settings: AssessmentSettingsData): Promise<void> => {
    const instituteId = getInstituteId();
    if (!instituteId) throw new Error('Institute ID not found');

    const requestData: AssessmentSettingsRequest = {
        setting_name: 'Assessment Configuration',
        setting_data: settings,
    };

    await authenticatedAxiosInstance.post(
        `${BASE_URL}/admin-core-service/institute/setting/v1/save-setting`,
        requestData,
        { params: { instituteId, settingKey: SETTINGS_KEY } }
    );

    setCachedSettings(mergeWithDefaults(settings));
};

export const clearAssessmentSettingsCache = (): void => {
    try {
        const instituteId = getInstituteId();
        const key = getLocalStorageKey(instituteId);
        if (key) localStorage.removeItem(key);
    } catch {
        // ignore
    }
};
