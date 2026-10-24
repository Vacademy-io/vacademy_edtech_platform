import {
  GET_OPEN_REGISTRATION_DETAILS,
  GET_PARTICIPANTS_STATUS,
  GET_USERID_URL,
  PUBLIC_INSTITUTE_BRANDING_URL,
  REGISTER_PARTICIPANT_URL,
  STUDENT_DETAIL,
} from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import axios from "axios";
import {
  mergeDataToGetUserId,
  transformIntoCustomFieldRequestListData,
} from "../-utils/helper";
import {
  AssessmentCustomFieldOpenRegistration,
  DynamicSchemaData,
  ParticipantsDataInterface,
} from "@/types/assessment-open-registration";
import { trackUtmAttribution } from "@/lib/utm-attribution";
import { isTransientRequestError } from "../-utils/request-error";

export const OPEN_REGISTRATION_DETAILS_QUERY_KEY = "GET_OPEN_REGISTRATION_DETAILS";

const handleGetOpenTestRegistrationDetails = async (code: string | number) => {
  const response = await axios({
    method: "GET",
    url: GET_OPEN_REGISTRATION_DETAILS,
    params: {
      code: code,
    },
  });
  return response?.data;
};
export const getOpenTestRegistrationDetails = (code: string | number) => {
  return {
    queryKey: [OPEN_REGISTRATION_DETAILS_QUERY_KEY, code],
    queryFn: () => handleGetOpenTestRegistrationDetails(code),
    staleTime: 3600000,
    // A dropped connection or a pod mid-restart deserves a couple of quiet
    // retries before the learner sees an error screen; a bad share code or a
    // backend rejection (510/511) is final and should surface immediately.
    retry: (failureCount: number, error: unknown) =>
      isTransientRequestError(error) && failureCount < 2,
  };
};

export const handleGetParticipantsTest = async (
  assessmentId: string,
  instituteId: string,
  userId: string | undefined,
  psIds?: string
) => {
  const response = await authenticatedAxiosInstance({
    method: "GET",
    url: GET_PARTICIPANTS_STATUS,
    params: {
      assessmentId,
      instituteId,
      userId,
      ...(psIds && { psIds }),
    },
  });
  return response?.data;
};

export const handleRegisterOpenParticipant = async (
  assessment_custom_fields: AssessmentCustomFieldOpenRegistration[],
  institute_id: string,
  assessment_id: string,
  participantsDto: ParticipantsDataInterface,
  custom_field_request_list: DynamicSchemaData
) => {
  // A blank user_id is persisted into the backend's UNIQUE(assessment_id, user_id)
  // column, so every anonymous registrant would collide on user_id=''. Fail fast
  // here instead of triggering a duplicate-key 500 on the second registration.
  if (!participantsDto.user_id || participantsDto.user_id.trim() === "") {
    throw new Error(
      "Cannot register: your account could not be resolved. Please verify your email and try again."
    );
  }
  const response = await axios({
    method: "POST",
    url: REGISTER_PARTICIPANT_URL,
    params: {
      userId: participantsDto.user_id,
    },
    data: {
      institute_id: institute_id,
      assessment_id: assessment_id,
      participant_dto: participantsDto,
      custom_field_request_list: transformIntoCustomFieldRequestListData(
        assessment_custom_fields,
        custom_field_request_list
      ).custom_field_request_list,
    },
  });
  // Axios throws on a non-2xx, so reaching here means the registration stuck.
  // Recorded in the service rather than at each caller — the form registers
  // from two separate paths (new registrant and already-known email) and one
  // of them would inevitably be missed.
  trackUtmAttribution({
    instituteId: institute_id,
    userId: participantsDto.user_id,
    email: participantsDto.email,
    mobileNumber: participantsDto.mobile_number,
    sourceType: "ASSESSMENT",
    sourceId: assessment_id,
  });
  return response?.data;
};

export const handleGetStudentDetailsOfInstitute = async (
  instituteId: string
) => {
  const response = await authenticatedAxiosInstance({
    method: "GET",
    url: STUDENT_DETAIL,
    params: {
      instituteId,
    },
  });
  return response?.data;
};

export interface PublicInstituteBranding {
  institute_id: string;
  institute_name: string;
  logo_file_id: string | null;
  institute_theme_code: string | null;
}

export const handleGetPublicInstituteBranding = async (
  instituteId: string
): Promise<PublicInstituteBranding> => {
  const response = await axios({
    method: "GET",
    url: `${PUBLIC_INSTITUTE_BRANDING_URL}/${instituteId}`,
  });
  return response?.data;
};

export const handleGetUserId = async (
  instituteId: string,
  data: DynamicSchemaData
) => {
  const data1 = {
    id: "",
    username: "",
    email: "",
    full_name: "",
    address_line: "",
    city: "",
    region: "",
    pin_code: "",
    mobile_number: "",
    date_of_birth: "",
    gender: "",
    password: "",
    profile_pic_file_id: "",
    roles: [],
    root_user: true,
  };
  const response = await axios({
    method: "POST",
    url: GET_USERID_URL,
    params: {
      instituteId,
    },
    data: mergeDataToGetUserId(data1, data),
  });
  return response?.data;
};
