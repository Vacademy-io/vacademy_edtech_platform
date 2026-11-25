import { useQuery } from "@tanstack/react-query";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { LEARNER_PROFILE_CUSTOM_FIELDS } from "@/constants/urls";
import type {
  LearnerProfileCustomField,
  ProfileCustomFieldValue,
} from "./profile-custom-fields-utils";

export const PROFILE_CUSTOM_FIELDS_QUERY_KEY = "LEARNER_PROFILE_CUSTOM_FIELDS";

export const profileCustomFieldsQueryKey = (instituteId?: string | null) => [
  PROFILE_CUSTOM_FIELDS_QUERY_KEY,
  instituteId ?? "",
];

export const fetchProfileCustomFields = async (
  instituteId: string
): Promise<LearnerProfileCustomField[]> => {
  const response = await authenticatedAxiosInstance.get<LearnerProfileCustomField[]>(
    LEARNER_PROFILE_CUSTOM_FIELDS,
    { params: { instituteId } }
  );
  return Array.isArray(response.data) ? response.data : [];
};

/** Saves the learner's own values; the server answers with the refreshed field list. */
export const saveProfileCustomFields = async (
  instituteId: string,
  values: ProfileCustomFieldValue[]
): Promise<LearnerProfileCustomField[]> => {
  const response = await authenticatedAxiosInstance.put<LearnerProfileCustomField[]>(
    LEARNER_PROFILE_CUSTOM_FIELDS,
    values,
    { params: { instituteId } }
  );
  return Array.isArray(response.data) ? response.data : [];
};

/**
 * Invite / course-purchase answers and admin-entered values (School, College, Roll No…) for the
 * signed-in learner, plus the empty fields the institute put on the learner profile.
 */
export const useProfileCustomFields = (instituteId?: string | null) =>
  useQuery({
    queryKey: profileCustomFieldsQueryKey(instituteId),
    queryFn: () => fetchProfileCustomFields(instituteId as string),
    enabled: Boolean(instituteId),
    staleTime: 60 * 1000,
  });
