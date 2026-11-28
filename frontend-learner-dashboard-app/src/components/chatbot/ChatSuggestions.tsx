import React from "react";
import { Microphone } from "@phosphor-icons/react";
import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MessageIntent } from "@/services/chatbot-api";
import { useChatbotContext } from "./useChatbotContext";
import { QuickActions } from "./QuickActions";

/**
 * Route-aware quick actions plus the voice-call chip. A prompt ending in a
 * space only prefills the input (the learner finishes the sentence); any
 * other prompt is sent straight away. `completeOnly` (the empty chat) offers
 * complete requests only; `voiceOnly` shows just the voice-call chip.
 */
export const ChatSuggestions: React.FC<{
  compact?: boolean;
  centered?: boolean;
  completeOnly?: boolean;
  voiceOnly?: boolean;
}> = ({ compact = false, centered = false, completeOnly = false, voiceOnly = false }) => {
  const { t } = useTranslation("chatFeatureB");
  const location = useLocation();
  const { isLoading, sessionId, sendMessage, setInputValue, chatbotSettings, startVoiceCall } =
    useChatbotContext();
  const disabled = isLoading || !sessionId;
  const hasVoice = !!chatbotSettings.enabled_modes?.some((m) => m.startsWith("voice_"));
  if (voiceOnly && !hasVoice) return null;

  return (
    <div className={cn("w-full flex flex-wrap", compact ? "gap-1" : "gap-1.5", centered && "justify-center")}>
      {!voiceOnly && (
        <QuickActions
          pathname={location.pathname}
          completeOnly={completeOnly}
          onAction={(prompt: string, intent?: MessageIntent) => {
            if (prompt.endsWith(" ")) {
              setInputValue(prompt);
            } else {
              sendMessage(prompt, intent);
            }
          }}
          disabled={disabled}
          compact={compact}
          className={cn(centered && "justify-center")}
        />
      )}
      {hasVoice && (
        <button
          type="button"
          onClick={startVoiceCall}
          disabled={disabled}
          title={t("common.startVoiceConversation")}
          className={cn(
            "inline-flex items-center rounded-full border border-primary/25 bg-primary/10 font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50",
            compact ? "h-5 px-2 text-caption" : "h-6 px-2.5 text-caption",
          )}
        >
          <Microphone className={cn("me-1", compact ? "h-2.5 w-2.5" : "h-3 w-3")} aria-hidden="true" />
          {t("common.voiceChatLabel")}
        </button>
      )}
    </div>
  );
};
