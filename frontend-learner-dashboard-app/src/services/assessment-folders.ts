import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";
import { ASSESSMENT_SETTING_KEY } from "@/types/assessment-experience";

/**
 * Assessment folders (e.g. "English") that the institute groups its tests into.
 * Authored in the admin dashboard; turned on per institute under
 * Settings → Assessment Settings (ASSESSMENT_SETTING.assessmentFolders.enabled).
 */

export interface LearnerAssessmentFolder {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  display_order: number;
  /** Only the tests this learner can see. */
  assessment_count: number;
}

export interface LearnerFolderList {
  folders: LearnerAssessmentFolder[];
  /** Visible tests that are in no folder ("Others"). */
  unfiled_count: number;
}

/** Search-param value of the "Others" folder. */
export const OTHERS_FOLDER_ID = "others";

const FLAG_CACHE_KEY = `${ASSESSMENT_SETTING_KEY}_FOLDERS_FLAG_V1`;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const readFlag = (instituteId: string): boolean | null => {
  try {
    const raw = localStorage.getItem(`${FLAG_CACHE_KEY}:${instituteId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; enabled: boolean };
    if (!parsed?.ts || Date.now() - parsed.ts > ONE_DAY_MS) return null;
    return parsed.enabled === true;
  } catch {
    return null;
  }
};

const writeFlag = (instituteId: string, enabled: boolean) => {
  try {
    localStorage.setItem(
      `${FLAG_CACHE_KEY}:${instituteId}`,
      JSON.stringify({ ts: Date.now(), enabled })
    );
  } catch {
    // Storage full / private mode: the flag is simply fetched again next time.
  }
};

/** Whether this institute shows its assessments in folders. Never throws. */
export async function getAssessmentFoldersEnabled(): Promise<boolean> {
  const instituteId = await getInstituteId();
  if (!instituteId) return false;
  const cached = readFlag(instituteId);
  if (cached !== null) return cached;
  try {
    const res = await authenticatedAxiosInstance.get<{
      data?: { assessmentFolders?: { enabled?: boolean } } | null;
    }>(`${BASE_URL}/admin-core-service/institute/setting/v1/get`, {
      params: { instituteId, settingKey: ASSESSMENT_SETTING_KEY },
    });
    const enabled = res.data?.data?.assessmentFolders?.enabled === true;
    writeFlag(instituteId, enabled);
    return enabled;
  } catch {
    return false;
  }
}

export async function fetchLearnerAssessmentFolders(params: {
  instituteId: string;
  batchIds: string[];
  userIds: string[];
  assessmentTypes: string[];
}): Promise<LearnerFolderList> {
  const res = await authenticatedAxiosInstance.post<LearnerFolderList>(
    `${BASE_URL}/assessment-service/assessment/folder/v1/learner/list`,
    {
      batch_ids: params.batchIds,
      user_ids: params.userIds,
      assessment_types: params.assessmentTypes,
    },
    { params: { instituteId: params.instituteId } }
  );
  return {
    folders: Array.isArray(res.data?.folders) ? res.data.folders : [],
    unfiled_count: res.data?.unfiled_count ?? 0,
  };
}
