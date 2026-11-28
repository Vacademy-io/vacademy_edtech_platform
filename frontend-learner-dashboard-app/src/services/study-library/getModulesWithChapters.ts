// services/study-library/getModulesWithChapters.ts
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import {
  MODULES_WITH_CHAPTERS,
  MODULES_WITH_CHAPTERS_PRIVATE,
} from "@/constants/urls";
import { useModulesWithChaptersStore } from "@/stores/study-library/use-modules-with-chapters-store";

export const fetchModulesWithChaptersPublic = async (
  subjectId: string,
  packageSessionId: string,
) => {
  const response = await authenticatedAxiosInstance.get(MODULES_WITH_CHAPTERS, {
    params: {
      subjectId: subjectId,
      packageSessionId: packageSessionId,
    },
  });
  return response.data;
};

export const fetchModulesWithChapters = async (
  subjectId: string,
  packageSessionId: string,
  signal?: AbortSignal,
) => {
  const response = await authenticatedAxiosInstance.get(
    MODULES_WITH_CHAPTERS_PRIVATE,
    {
      signal,
      params: {
        subjectId: subjectId,
        packageSessionId: packageSessionId,
      },
    },
  );
  return response.data;
};

export const useModulesWithChaptersQuery = (
  subjectId: string,
  packageSessionId: string,
) => {
  const setModulesData = useModulesWithChaptersStore(
    (state) => state.setModulesWithChaptersData,
  );

  return {
    queryKey: ["GET_MODULES_WITH_CHAPTERS", subjectId, packageSessionId],
    queryFn: async () => {
      const data = await fetchModulesWithChapters(subjectId, packageSessionId);
      setModulesData(data);
      return data;
    },
    staleTime: 60000,
  };
};
