import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { LIVE_SESSION_MARK_ATTENDANCE_FOR_GUEST } from "@/constants/urls";
import { toast } from "sonner";
import { guestAxiosInstance } from "@/lib/auth/axiosInstance";
import { useTranslation } from "react-i18next";

interface MarkAttendancePayload {
  sessionId: string;
  scheduleId: string;
  userSourceType: "USER" | "EXTERNAL_USER";
  userSourceId: string;
  details?: string;
}

export const useMarkAttendance = () => {
  const { t } = useTranslation("liveClassGuest");
  return useMutation({
    mutationFn: async (payload: MarkAttendancePayload) => {
      const response = await guestAxiosInstance.post(LIVE_SESSION_MARK_ATTENDANCE_FOR_GUEST, payload);
      return response.data;
    },
    onSuccess: () => {

    },
    onError: (error: AxiosError) => {
      console.error("Failed to mark attendance:", error);

      // Don't show toast for 511 - already marked case
      // This is expected if the user refreshes the page or re-joins
      if (error.response?.status === 511) {
        return;
      }

      toast.error(t("common.markAttendanceFailed"));
    },
  });
};
