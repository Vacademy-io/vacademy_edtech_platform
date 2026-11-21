import { Preferences } from "@capacitor/preferences";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import {
  GET_DASHBOARD_DATA,
  GET_NOTIFCATIONS,
  GET_ANNOUNCEMENTS,
  GET_LAST_7_DAYS_PROGRESS,
} from "@/constants/urls";
import {
  DashbaordResponse,
  UserActivityArray,
} from "../-types/dashboard-data-types";
import {
  fetchAssessmentData,
  getStoredDetails,
} from "@/routes/assessment/examination/-utils.ts/useFetchAssessment";
import { assessmentTypes } from "@/types/assessment";
import { safeJsonParse } from "@/utils/safe-json-parse";
import { Student } from "@/types/user/user-detail";
import { getDataFromPreferences } from "@/utils/storage";

export const fetchUserData = async () => {
  const studentData = await Preferences.get({ key: "StudentDetails" });
  const userData = safeJsonParse(studentData.value);
  return userData;
};

export const fetchStaticData = async (
  setUsername: (username: string | null) => void,
  // setAssessmentCount: (count: number) => void,
  setTestAssigned: (count: number) => void,
  setHomeworkAssigned: (count: number) => void,
  setData?: (data: DashbaordResponse) => void
) => {
  const userData = await fetchUserData();

  if (!userData) {
    console.error("No user data found");
    setUsername(null);
    setTestAssigned(0);
    setHomeworkAssigned(0);
    return;
  }

  if (!userData) {
    console.error("No user data found");
    return;
  }

  const first_name = userData.full_name.split(" ")[0];
  const institute_id = userData.institute_id;
  const batch_id = userData.package_session_id;
  const params = { instituteId: institute_id, packageSessionId: batch_id };
  setUsername(first_name);

  // Use the institute_id from user data instead of getInstituteId()
  // const response1 = await fetchStudentDetails(institute_id, userData.id);
  const studentDetails = await getDataFromPreferences<Student[]>("students");

  const packageSessionIds = studentDetails
    ?.map((item) => item.package_session_id)
    .filter((id): id is string => !!id);

  try {
    const url = GET_DASHBOARD_DATA;
    const response = await authenticatedAxiosInstance({
      method: "POST",
      url,
      params,
      data: packageSessionIds,
    });
    if (setData) {
      setData(response.data);
    }
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
  }

  try {
    // The tile opens the Live tab, so it reports that tab's total, read the same
    // way the tab reads it (live batch list, same filter).
    const { institute } = await getStoredDetails();
    const live = institute
      ? await fetchAssessmentData(0, 1, assessmentTypes.LIVE, "ASSESSMENT")
      : null;
    const count = live?.total_elements ?? 0;
    setTestAssigned(count);
    // need to have a count for evaluation assigned separately from test assigned
    setHomeworkAssigned(count);
  } catch (error) {
    console.error("Error fetching assessment counts:", error);
  }
};

export const fetchNotifications = async () => {
  try {
    const url = GET_NOTIFCATIONS;
    const response = await authenticatedAxiosInstance({
      method: "GET",
      url: url,
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching assessments:", error);
  }
};

export const fetchAnnouncements = async () => {
  try {
    const url = GET_ANNOUNCEMENTS;
    const response = await authenticatedAxiosInstance({
      method: "GET",
      url: url,
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching assessments:", error);
  }
};

export const fetchLast7DaysProgress = async ({
  user_id,
  start_date,
  end_date,
}: {
  user_id: string;
  start_date: string;
  end_date: string;
}): Promise<UserActivityArray> => {
  try {
    const { student } = await getStoredDetails();
    if (!student) {
      console.error("No student details found");
      return [];
    }

    // Use the institute_id from stored student details instead of getInstituteId()
    const instituteId = student.institute_id;
    if (!instituteId) {
      console.error("No institute ID found in student details");
      return [];
    }

    const url = GET_LAST_7_DAYS_PROGRESS;
    const studentDetails = await getDataFromPreferences<Student[]>("students");
    const packageSessionIds = studentDetails
      ?.map((item) => item.package_session_id)
      .filter((id): id is string => !!id);
    const response = await authenticatedAxiosInstance({
      method: "POST",
      url: url,
      data: {
        user_id: user_id,
        package_session_ids: packageSessionIds,
        start_date: start_date,
        end_date: end_date,
      },
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching last 7 days progress:", error);
    return [];
  }
};
