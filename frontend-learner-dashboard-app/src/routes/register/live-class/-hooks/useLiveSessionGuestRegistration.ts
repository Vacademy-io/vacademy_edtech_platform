import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  COLLECT_PUBLIC_USER_DATA,
  LIVE_SESSION_PAYMENT_INFO,
  LIVE_SESSION_REGISTER_AND_PAY,
  LIVE_SESSION_REGISTER_GUEST_USER,
} from "@/constants/urls";
import {
  CollectPublicUserDataDTO,
  GuestRegistrationRequestDTO,
  PaidRegistrationRequestDTO,
} from "../-utils/helper";
import { LiveSessionPaymentInfo } from "../-types/type";
import { guestAxiosInstance } from "@/lib/auth/axiosInstance";

interface ErrorResponse {
  message: string;
  ex?: string;
  responseCode?: string;
}

export const useLiveSessionGuestRegistration = () => {
  const { t } = useTranslation("registrationA");
  return useMutation({
    mutationFn: async (payload: GuestRegistrationRequestDTO) => {
      const response = await guestAxiosInstance.post(
        LIVE_SESSION_REGISTER_GUEST_USER,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      return response.data;
    },
    onError: (error: AxiosError<ErrorResponse>) => {
      console.error("Registration failed:", error);

      // Don't show toast for 511 - already registered case
      // This will be handled in the component
      if (error.response?.status === 511) {
        return;
      }

      toast.error(error.response?.data?.message || t("liveClass.hooks.registrationFailed"));
    },
  });
};

// Paid live session: registers the guest AND raises the fee invoice in one call.
// The returned invoice_id is settled on the shared /pay/invoice/{id} page.
export const useLiveSessionRegisterAndPay = () => {
  const { t } = useTranslation("registrationA");
  return useMutation({
    mutationFn: async (payload: PaidRegistrationRequestDTO) => {
      const response = await guestAxiosInstance.post<LiveSessionPaymentInfo>(
        LIVE_SESSION_REGISTER_AND_PAY,
        payload,
        { headers: { "Content-Type": "application/json" } }
      );
      return response.data;
    },
    onError: (error: AxiosError<ErrorResponse>) => {
      toast.error(
        error.response?.data?.message || t("liveClass.hooks.registrationFailedRetry")
      );
    },
  });
};

export const fetchLiveSessionPaymentInfo = async (
  sessionId: string,
  email?: string,
  mobileNumber?: string
): Promise<LiveSessionPaymentInfo> => {
  const response = await guestAxiosInstance.get<LiveSessionPaymentInfo>(
    LIVE_SESSION_PAYMENT_INFO,
    {
      params: {
        sessionId,
        ...(email ? { email } : {}),
        ...(mobileNumber ? { mobileNumber } : {}),
      },
    }
  );
  return response.data;
};

export const useCollectPublicUserData = () => {
  return useMutation({
    mutationFn: async ({
      payload,
      instituteId,
    }: {
      payload: CollectPublicUserDataDTO;
      instituteId: string;
    }) => {
      const response = await guestAxiosInstance.post(COLLECT_PUBLIC_USER_DATA, payload, {
        params: { instituteId },
      });
      return response.data;
    },
    onError: (error: AxiosError<ErrorResponse>) => {
      // Lead-collection is a best-effort background call; the actual guest
      // registration is handled separately. Don't surface its failure to the
      // learner via a toast — just log it for debugging.
      console.error("Collecting public user data failed:", error);
    },
  });
};
