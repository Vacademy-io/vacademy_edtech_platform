import { BASE_URL } from "@/constants/urls";
import axios from "axios";
import { getInstituteIdSync } from "../../helper";

// The sign-in page fills this query with the host's institute, and the hour it
// stays fresh would carry that answer into the signed-in app. Sign-in hydration
// names its institute here, so it reads an entry and an answer of its own.
let hydratedInstituteId: string | null = null;

export const setPublicInstituteDetailsScope = (instituteId: string) => {
  hydratedInstituteId = instituteId;
};

export const getPublicInstituteDetails = async () => {
  const instituteId = hydratedInstituteId ?? (await getInstituteIdSync());
  if (!instituteId) {
    throw new Error("Institute ID not available");
  }
  try {
    const response = await axios.get(
      `${BASE_URL}/admin-core-service/public/institute/v1/details-non-batches/${instituteId}`
    );
    return response.data;
  } catch (error) {
    console.log(error);
    throw new Error("Failed to fetch institute details");
  }
};

export const handleGetPublicInstituteDetails = () => {
  return {
    queryKey: ["GET_PUBLIC_INIT_INSTITUTE", hydratedInstituteId],
    queryFn: () => getPublicInstituteDetails(),
    staleTime: 3600000,
  };
};
