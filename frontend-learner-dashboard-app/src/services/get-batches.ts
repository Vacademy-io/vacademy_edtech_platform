import { GET_BATCH_LIST } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { getInstituteId } from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import { Preferences } from "@capacitor/preferences";
import { useQuery } from "@tanstack/react-query";

export interface BatchType {
  batch_name: string;
  batch_status: "ACTIVE" | "INACTIVE";
  count_students: number;
  start_date: string;
  package_session_id: string;
  invite_code: string;
}
export interface PackageType {
  id: string;
  package_name: string;
  thumbnail_file_id: string;
  package_type?: string | null;
}

export interface BatchData {
  package_dto: PackageType;
  batches: BatchType[];
}

export const getSesssionId = async (): Promise<string | undefined> => {
  const { value } = await Preferences.get({ key: "sessionList" });
  if (!value) {
    console.error("No data found in Preferences with key 'sessionList'");
    return;
  }
  try {
    const parsedData = JSON.parse(value);
    if (Array.isArray(parsedData) && parsedData.length > 0) {
      const course = parsedData[0];
      return course.session?.id;
    } else if (typeof parsedData === "object" && parsedData !== null) {
      const course = parsedData;
      return course.session?.id;
    }
  } catch (error) {
    console.error("Error parsing sessionList:", error);
    return;
  }
};

/** Shipping and deposits are enrolments only for the payment plumbing; nobody attends them. */
export const withoutChargePackages = <T extends { package_dto?: { package_type?: string | null } }>(
  batches: T[],
): T[] =>
  batches.filter(
    (batch) =>
      !["DELIVERY_CHARGE", "SECURITY_DEPOSIT"].includes(batch.package_dto?.package_type ?? ""),
  );

export const fetchBatches = async () => {
  const INSTITUTE_ID = await getInstituteId();
  const sessionId = await getSesssionId();
  const params: Record<string, string> = { instituteId: INSTITUTE_ID };
  if (sessionId) {
    params.sessionId = sessionId;
  }
  const response = await authenticatedAxiosInstance.get(GET_BATCH_LIST, {
    params,
  });
  return Array.isArray(response.data) ? withoutChargePackages(response.data) : response.data;
};

export const useGetBatchesQuery = () => {
  return useQuery<BatchData | null>({
    queryKey: ["GET_BATCHES"],
    queryFn: async () => {
      const response = fetchBatches();
      return response;
    },
    staleTime: 3600000,
  });
};
