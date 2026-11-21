import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { EXAM_INTERFACE } from "@/constants/urls";
import type { ExamInterface } from "@/types/exam-theme";

/**
 * The assessment's `exam_interface`, for screens shown before an attempt
 * exists (instructions). Never throws: an unknown assessment, an older
 * backend without the endpoint, or a network error all mean the default
 * screen (null).
 */
export const fetchExamInterface = async (
  assessmentId: string
): Promise<ExamInterface | null> => {
  try {
    const response = await authenticatedAxiosInstance.get(EXAM_INTERFACE, {
      params: { assessmentId },
    });
    const value = (response.data as { exam_interface?: unknown } | null)
      ?.exam_interface;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as ExamInterface)
      : null;
  } catch (error) {
    console.warn("[exam-theme] exam interface fetch failed, using default", error);
    return null;
  }
};
