import React, { createContext } from "react";
import { ChatMessage, QuizSubmission } from "./types";
import {
  AIStatus,
  ChatSessionSummary,
  ChatStartersResponse,
  FeedbackRating,
  MessageIntent,
  SessionMode,
} from "@/services/chatbot-api";
import { ChatbotSettingsData } from "@/services/chatbot-settings";
import { QueuedMessage } from "@/services/offline-queue";
import type { StartersState } from "./useChatbot";

export interface ChatbotContextType {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  messages: ChatMessage[];
  isLoading: boolean;
  aiStatus: AIStatus;
  inputValue: string;
  setInputValue: (value: string) => void;
  sendMessage: (message: string, intent?: MessageIntent, attachments?: Array<{type: string; url: string; mime_type?: string; name?: string}>) => void;
  submitQuiz: (submission: QuizSubmission) => void;
  startNewChat: () => void;
  closeSession: () => void;
  shouldShowChatbot: () => boolean;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  chatbotSettings: ChatbotSettingsData;
  instituteName: string;
  hasError: boolean;
  isCreditsExhausted: boolean;
  isSessionClosed: boolean;
  isInitializing: boolean;
  sessionId: string | null;
  isExpanded: boolean;
  setIsExpanded: (isExpanded: boolean) => void;
  isWaitingForResponse: boolean;
  activeToolCall: string | null;
  streamingContent: string;
  isStreaming: boolean;
  isOffline: boolean;
  pendingMessages: QueuedMessage[];
  voiceMode: SessionMode | null;
  /** Topic the current call is about, derived from the student's context. */
  voiceTopic: string;
  suggestedVoiceTopic: () => string;
  /** Starts a call, skipping the picker when only one voice mode is enabled. */
  startVoiceCall: () => void;
  /** Re-open the session's SSE stream (server resumes and answers any pending message). */
  reconnectStream: () => void;
  /** The learner's past chats, filled by loadSessions(). */
  sessions: ChatSessionSummary[];
  /** Fetch the past chats (rejects on failure; `sessions` keeps the last list). */
  loadSessions: () => Promise<ChatSessionSummary[]>;
  /** Switch to a past chat; false (current chat kept) if it cannot be opened. */
  openSession: (sessionId: string) => Promise<boolean>;
  /** Stop the reply being written; the partial text stays, marked stopped. */
  stopGeneration: () => void;
  /** Rate an assistant reply; "none" clears the rating. */
  setFeedback: (messageId: number, rating: FeedbackRating) => Promise<void>;
  /**
   * Save (bookmark) or unsave a reply; optimistic in the open chat. Pass
   * `targetSessionId` for a reply from another chat (the Saved list).
   */
  setSaved: (messageId: number, saved: boolean, targetSessionId?: string) => Promise<boolean>;
  /** Personal starters for the current page, filled by loadStarters(). */
  starters: ChatStartersResponse | null;
  startersState: StartersState;
  /** Fetch (or reuse) the starters for the current page; null when unavailable. */
  loadStarters: () => Promise<ChatStartersResponse | null>;
  /** Open the chat and send `prompt` once the chat is ready. */
  openAndSend: (prompt: string) => void;
  /** A tapped prompt still waiting for the chat to open; shown as sent. */
  queuedPrompt: string | null;
  /** The reply being read aloud / whose audio is loading. */
  speakingMessageId: number | null;
  speechLoadingId: number | null;
  /** Read a reply aloud, or stop it if it is the one playing. */
  toggleReadAloud: (messageId: number) => Promise<void>;
  stopSpeech: () => void;
  showVoiceSelector: boolean;
  setShowVoiceSelector: (show: boolean) => void;
  enterVoiceMode: (mode: SessionMode, language?: string, topic?: string) => Promise<void>;
  exitVoiceMode: () => void;
  voiceLanguage: string;
}

export const ChatbotContext = createContext<ChatbotContextType | undefined>(
  undefined
);
