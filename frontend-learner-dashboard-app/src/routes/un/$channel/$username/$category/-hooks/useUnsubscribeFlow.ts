import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { useTranslation } from "react-i18next";

import {
  resolveChannel,
  SUPPORT_EMAIL,
  type ChannelDescriptor,
} from "../-constants/channels";
import { maskIdentifier } from "../-utils/text";
import { getUnsubscribeErrorMessage } from "../-utils/errors";
import {
  updateAnnouncementPreferences,
  type AnnouncementPreferenceUpdateRequest,
  type AnnouncementPreferenceUpdateResponse,
} from "@/services/unsubscribe/unsubscribe-service";

type PreferenceAction = "UNSUBSCRIBE" | "RESUBSCRIBE";

export interface UseUnsubscribeFlowParams {
  channel?: string;
  username?: string;
  category?: string;
  instituteId?: string | null;
}

export interface UseUnsubscribeFlowResult {
  channelInfo: ChannelDescriptor | null;
  /** Localized display label for the channel — "Email" / "WhatsApp" in the active locale. */
  channelLabel: string;
  maskedRecipient: string;
  displayCategory: string;
  rawCategoryKey: string;
  activeAction: PreferenceAction;
  unsubscribeDisabled: boolean;
  formattedDate: string;
  supportEmail: string;
  status: "idle" | "pending" | "error" | "success";
  messages: {
    success: string;
    error: string;
  };
  retry: () => void;
  resubscribe: () => void;
  mutationError: unknown;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  unsubscribeResult?: AnnouncementPreferenceUpdateResponse;
}

export const useUnsubscribeFlow = ({
  channel,
  username,
  category,
  instituteId,
}: UseUnsubscribeFlowParams): UseUnsubscribeFlowResult => {
  const { t } = useTranslation("miscRoutesA");
  const decodedUsername = useMemo(
    () => decodeURIComponent(username ?? "").trim(),
    [username]
  );

  const decodedCategory = useMemo(
    () => decodeURIComponent(category ?? "").trim(),
    [category]
  );

  const channelInfo = useMemo(() => resolveChannel(channel), [channel]);

  const maskedRecipient = useMemo(
    () => maskIdentifier(decodedUsername, t),
    [decodedUsername, t]
  );

  const channelLabel = useMemo(() => {
    if (!channelInfo) return t("unsubscribe.channel.notification");
    return channelInfo.channel === "WHATSAPP"
      ? t("unsubscribe.channel.whatsapp")
      : t("unsubscribe.channel.email");
  }, [channelInfo, t]);

  const rawCategoryKey = decodedCategory || "GENERAL";
  const displayCategory = rawCategoryKey;

  const formattedDate = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    []
  );

  const unsubscribePayloadRef =
    useRef<AnnouncementPreferenceUpdateRequest | null>(null);
  const hasTriggeredRef = useRef(false);
  const lastActionRef = useRef<PreferenceAction>("UNSUBSCRIBE");
  const [activeAction, setActiveAction] = useState<PreferenceAction>("UNSUBSCRIBE");
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");

  const mutation = useMutation<
    AnnouncementPreferenceUpdateResponse,
    AxiosError | Error,
    AnnouncementPreferenceUpdateRequest
  >({
    mutationFn: (request) => updateAnnouncementPreferences(request),
    onSuccess: () => setStatus("success"),
    onError: () => setStatus("error"),
  });

  const buildPayload = (
    action: PreferenceAction,
    effectiveInstituteId: string
  ): AnnouncementPreferenceUpdateRequest | null => {
    if (!channelInfo || !decodedUsername || !effectiveInstituteId) {
      return null;
    }

    const emailPayload =
      channelInfo.channel === "EMAIL"
        ? {
            emailSenders: [
              {
                emailType: rawCategoryKey,
                unsubscribed: action === "UNSUBSCRIBE",
              },
            ],
          }
        : undefined;

    const whatsappPayload =
      channelInfo.channel === "WHATSAPP"
        ? { whatsappUnsubscribed: action === "UNSUBSCRIBE" }
        : undefined;

    return {
      username: decodedUsername,
      instituteId: effectiveInstituteId,
      payload: {
        username: decodedUsername,
        preferences: {
          ...(emailPayload ?? {}),
          ...(whatsappPayload ?? {}),
        },
      },
    };
  };

  useEffect(() => {
    if (!channelInfo || hasTriggeredRef.current || !decodedUsername) {
      return;
    }

    const resolvedInstituteId = instituteId ?? new URLSearchParams(window.location.search).get("instituteId");
    if (!resolvedInstituteId) {
      return;
    }

    const request = buildPayload("UNSUBSCRIBE", resolvedInstituteId);
    if (!request) return;

    unsubscribePayloadRef.current = request;
    hasTriggeredRef.current = true;
    lastActionRef.current = "UNSUBSCRIBE";
    setActiveAction("UNSUBSCRIBE");
    setStatus("pending");
    mutation.mutate(request);
  }, [
    category,
    channel,
    channelInfo,
    decodedUsername,
    mutation,
  ]);

  const retry = () => {
    const payload = unsubscribePayloadRef.current;
    if (!payload) {
      return;
    }
    lastActionRef.current = "UNSUBSCRIBE";
    setActiveAction("UNSUBSCRIBE");
    setStatus("pending");
    mutation.mutate(payload);
  };

  const resubscribe = () => {
    const resolvedInstituteId =
      instituteId ?? new URLSearchParams(window.location.search).get("instituteId");
    if (!resolvedInstituteId) return;
    const request = buildPayload("RESUBSCRIBE", resolvedInstituteId);
    if (!request) {
      return;
    }
    lastActionRef.current = "RESUBSCRIBE";
    setActiveAction("RESUBSCRIBE");
    setStatus("pending");
    mutation.mutate(request);
  };

  const statusState = status;

  const successMessage =
    lastActionRef.current === "RESUBSCRIBE"
      ? t("unsubscribe.messages.resubscribed", { channel: channelLabel })
      : t("unsubscribe.messages.unsubscribed", { channel: channelLabel });

  return {
    channelInfo,
    channelLabel,
    maskedRecipient,
    displayCategory,
    rawCategoryKey,
    activeAction,
    formattedDate,
    supportEmail: SUPPORT_EMAIL,
    status: statusState,
    messages: {
      success: successMessage,
      error: getUnsubscribeErrorMessage(mutation.error, t),
    },
    retry,
    resubscribe,
    mutationError: mutation.error,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    unsubscribeDisabled: statusState === "pending" && activeAction === "UNSUBSCRIBE",
    unsubscribeResult: mutation.data,
  };
};

