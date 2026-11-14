import { useMutation } from "@tanstack/react-query";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { LIVE_SESSION_MARK_ATTENDANCE } from "@/constants/urls";
import { toast } from "sonner";
import { AxiosError } from "axios";
import { useTranslation } from "react-i18next";

interface MarkAttendancePayload {
  sessionId: string;
  scheduleId: string;
  userSourceType: "USER" | "GUEST";
  userSourceId: string;
  details?: string;
}

export const useMarkAttendance = () => {
  const { t } = useTranslation("study");
  return useMutation({
    mutationFn: async (payload: MarkAttendancePayload) => {
      const response = await authenticatedAxiosInstance.post(
        LIVE_SESSION_MARK_ATTENDANCE,
        payload
      );
      return response.data;
    },
    onSuccess: () => {

    },
    onError: (error: AxiosError) => {
      console.error("Failed to mark attendance:", error);
      toast.error(t("liveClass.toast.markAttendanceFailed"));
    },
  });
};
