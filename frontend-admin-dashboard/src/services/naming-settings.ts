import { CREATE_NAMING_SETTINGS, UPDATE_NAMING_SETTINGS, GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export interface NamingSettingsRequest {
    Course: string;
    Level: string;
    Session: string;
    Subjects: string;
    Modules: string;
    Chapters: string;
    Slides: string;
    Admin: string;
    Teacher: string;
    CourseCreator: string;
    AssessmentCreator: string;
    Evaluator: string;
    Student: string;
    LiveSession: string;
    Batch: string;
    Package?: string;
    PopularTag?: string;
    AudienceList?: string;
    Invite?: string;
    Inventory?: string;
    SubOrg?: string;
    // Plural variants are sent as {key}_plural
    [key: string]: string | undefined;
}

// The institute being worked in (selected institute; the token's first only when none is
// selected) — not always the token's first institute. Otherwise a multi-institute admin read
// and saved naming on the wrong institute, and the backend now rejects a setting save whose
// clientId isn't the target instituteId.
const resolveInstituteId = (): string => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) {
        throw new Error('No institute ID found in token');
    }
    return instituteId;
};

export const createNamingSettings = async (nameRequest: NamingSettingsRequest): Promise<void> => {
    const instituteId = resolveInstituteId();

    const response = await authenticatedAxiosInstance.post(
        CREATE_NAMING_SETTINGS,
        { name_request: nameRequest },
        {
            params: { instituteId },
        }
    );

    return response.data;
};

export const updateNamingSettings = async (nameRequest: NamingSettingsRequest): Promise<void> => {
    const instituteId = resolveInstituteId();

    const response = await authenticatedAxiosInstance.post(
        UPDATE_NAMING_SETTINGS,
        { name_request: nameRequest },
        {
            params: { instituteId },
        }
    );

    return response.data;
};

interface NamingSettingResponseItem {
    key: string;
    systemValue: string | null;
    customValue: string;
}

export const getNamingSettings = async (): Promise<NamingSettingResponseItem[] | null> => {
    const instituteId = resolveInstituteId();

    try {
        const response = await authenticatedAxiosInstance.get(
            GET_INSITITUTE_SETTINGS,
            {
                params: {
                    instituteId,
                    settingKey: 'NAMING_SETTING',
                },
            }
        );

        if (response.data && response.data.data && Array.isArray(response.data.data.data)) {
            return response.data.data.data as NamingSettingResponseItem[];
        }

        return null;
    } catch (error) {
        console.error('Error fetching naming settings:', error);
        return null;
    }
};
