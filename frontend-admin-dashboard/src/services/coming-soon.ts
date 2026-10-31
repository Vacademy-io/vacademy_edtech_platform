import { getInstituteId } from '@/constants/helper';
import { getPackageSettingData, savePackageSettingKey } from '@/services/package-settings';
import { createAudienceCampaign } from '@/routes/audience-manager/list/-services/create-audience-campaign';
import { fetchCampaignLeads } from '@/routes/audience-manager/list/-services/get-campaign-users';
import { convertFieldsToPayload } from '@/routes/audience-manager/list/-utils/campaignFormFields';
import { getCampaignCustomFieldsAsync } from '@/routes/audience-manager/list/-utils/getCampaignCustomFields';

/**
 * "Coming Soon" for a course — `package.course_setting → setting.COMING_SOON.data`.
 *
 * While enabled, the public catalogue shows the course with a ribbon and a "Notify me" button
 * instead of enrol/buy (backend: ComingSoonDTO, read by the open package search and
 * course-init). The button collects leads into the course's own audience list, which is created
 * on first enable so the launch message reaches exactly the people who asked about THIS course.
 */

export const COMING_SOON_SETTING_KEY = 'COMING_SOON';

export interface ComingSoonSetting {
    enabled: boolean;
    /** yyyy-MM-dd, display only — going live is always this switch. */
    launchDate?: string;
    ribbonText?: string;
    buttonText?: string;
    audienceId?: string;
    audienceName?: string;
    /** ISO time the "it's live" message was last sent, so the dialog can say so. */
    notifiedAt?: string;
}

export const DEFAULT_COMING_SOON: ComingSoonSetting = { enabled: false };

export const getComingSoonSetting = async (packageId: string): Promise<ComingSoonSetting> => {
    const data = (await getPackageSettingData(
        packageId,
        COMING_SOON_SETTING_KEY
    )) as Partial<ComingSoonSetting> | null;
    if (!data || typeof data !== 'object') return { ...DEFAULT_COMING_SOON };
    return { ...DEFAULT_COMING_SOON, ...data, enabled: data.enabled === true };
};

export const saveComingSoonSetting = async (
    packageId: string,
    setting: ComingSoonSetting
): Promise<void> => {
    // Own key, so this never read-modify-writes another feature's blob.
    await savePackageSettingKey(packageId, COMING_SOON_SETTING_KEY, setting, 'Coming Soon');
};

const isoDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Creates the course's "Coming Soon – <course>" audience list with the institute's standard
 * lead fields (name / email / phone and any defaults the institute configured). Returns its id.
 */
export const createComingSoonAudience = async (
    courseName: string,
    listName: string,
    userId?: string
): Promise<string> => {
    const instituteId = getInstituteId();
    if (!instituteId) throw new Error('No institute selected');

    const fields = await getCampaignCustomFieldsAsync();
    const today = new Date();
    const nextYear = new Date(today);
    nextYear.setFullYear(today.getFullYear() + 1);

    const created = await createAudienceCampaign({
        institute_id: instituteId,
        campaign_name: listName,
        // Same source the backend gives its other auto-made website lists.
        campaign_type: 'WEBSITE',
        description: courseName,
        campaign_objective: 'COURSE_INQUIRY',
        to_notify: '',
        send_respondent_email: false,
        created_by_user_id: userId,
        // Display only — campaign dates never close a form.
        start_date_local: `${isoDate(today)}T00:00:00`,
        end_date_local: `${isoDate(nextYear)}T23:59:59`,
        status: 'ACTIVE',
        institute_custom_fields: convertFieldsToPayload(fields, instituteId),
    });

    // The endpoint answers with the bare id string, not an object.
    const id =
        typeof created === 'string'
            ? created.replace(/^"|"$/g, '').trim()
            : String(created?.id || created?.campaign_id || '');
    if (!id) throw new Error('Audience list was not created');
    return id;
};

/** How many people are waiting on this course's list. */
export const getComingSoonLeadCount = async (audienceId: string): Promise<number> => {
    const page = await fetchCampaignLeads({ audience_id: audienceId, page: 0, size: 1 });
    return page?.totalElements ?? 0;
};
