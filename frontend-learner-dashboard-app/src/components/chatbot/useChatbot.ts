import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { ChatMessage, ChatbotContext, QuizSubmission } from "./types";
import { getCachedInstituteBranding } from "@/services/domain-routing";
import {
  chatbotAPI,
  ContextType,
  ContextMeta,
  MessageEvent,
  AIStatus,
  MessageIntent,
  SessionMode,
  type ChatStream,
  type ChatSessionSummary,
  type ChatStartersResponse,
  type FeedbackRating,
} from "@/services/chatbot-api";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { enqueueMessage, peekQueue, dequeueMessage, QueuedMessage } from "@/services/offline-queue";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { useInstituteDetailsStore } from "@/stores/study-library/useInstituteDetails";
import { useParentPortalStore } from "@/stores/parent-portal-store";
import { useCourseDetailsStore } from "@/stores/study-library/useCourseDetailsStore";
import { useStudyLibraryStore } from "@/stores/study-library/use-study-library-store";
import { useModulesWithChaptersStore } from "@/stores/study-library/use-modules-with-chapters-store";
import { getSubjectName } from "@/utils/study-library/get-name-by-id/getSubjectNameById";
import { getModuleName } from "@/utils/study-library/get-name-by-id/getModuleNameById";
import { getChapterName } from "@/utils/study-library/get-name-by-id/getChapterById";
import {
  ChatbotSettingsData,
  DEFAULT_CHATBOT_SETTINGS,
  getChatbotSettings,
} from "@/services/chatbot-settings";
import { isChatbotVisibleOnRoute, setChatbotPages } from "@/config/chatbot-routes";
import { parseAiUsageLimitBody, type AiUsageLimitBody } from "@/lib/ai-usage-limit";
import { aiUsageLimitMessage, claimAiUsageLimit } from "@/lib/ai-usage-limit-notify";
import { visibleStreamText } from "./stream-text";
import { useReplySpeech } from "./useReplySpeech";

/** Loading state of the personal starters (empty chat + launcher peek). */
export type StartersState = "idle" | "loading" | "ready" | "error";

// ── The learner's current chat, remembered across reloads ───────────────
// Scoped to learner + institute; reopened on the next visit within a day.
const LAST_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Starters are time-sensitive (a class about to start); refetch after this long. */
const STARTERS_TTL_MS = 5 * 60 * 1000;
/** Pause between Stop and re-opening the stream, so the server saves the partial reply first. */
const STOP_REATTACH_DELAY_MS = 300;

const lastSessionKey = async (): Promise<string | null> => {
  try {
    const { userId, instituteId } = await chatbotAPI.getScope();
    return userId ? `chatbot:last-session:${userId}:${instituteId}` : null;
  } catch {
    return null;
  }
};

const readLastSession = async (): Promise<string | null> => {
  const key = await lastSessionKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionId?: unknown; at?: unknown };
    if (typeof parsed.sessionId !== "string" || typeof parsed.at !== "number") return null;
    return Date.now() - parsed.at < LAST_SESSION_TTL_MS ? parsed.sessionId : null;
  } catch {
    return null;
  }
};

/** Remember `sessionId` as the current chat; `null` forgets it. */
const writeLastSession = async (sessionId: string | null): Promise<void> => {
  const key = await lastSessionKey();
  if (!key) return;
  try {
    if (sessionId) localStorage.setItem(key, JSON.stringify({ sessionId, at: Date.now() }));
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked (private mode, quota): the chat just starts fresh next time.
  }
};

export const useChatbot = () => {
  const { t, i18n } = useTranslation("chatFeatureB");
  // Check if parent portal is active
  const parentPortal = useParentPortalStore();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [chatbotSettings, setChatbotSettings] = useState<ChatbotSettingsData>(
    DEFAULT_CHATBOT_SETTINGS,
  );
  // Rendered in the chatbot header. Seeding it with "Vacademy" meant every
  // white-label learner saw the Vacademy name until getChatbotSettings resolved
  // — and permanently if that call failed. Start from the branding already
  // resolved for this hostname instead.
  const [instituteName, setInstituteName] = useState<string>(
    () => getCachedInstituteBranding()?.instituteName || "",
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AIStatus>("idle");
  const [isInitializing, setIsInitializing] = useState(false);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isCreditsExhausted, setIsCreditsExhausted] = useState(false);
  // Session init was refused by an AI usage limit (429 AI_USAGE_LIMIT): the
  // reason is an assistant bubble, not the generic error card, and the
  // open-effect must not retry init until "New chat".
  const [isUsageLimited, setIsUsageLimited] = useState(false);
  const [isSessionClosed, setIsSessionClosed] = useState(false);
  const [activeToolCall, setActiveToolCall] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pendingMessages, setPendingMessages] = useState<QueuedMessage[]>([]);
  const [voiceMode, setVoiceMode] = useState<SessionMode | null>(null);
  const [voiceTopic, setVoiceTopic] = useState<string>("");
  const [showVoiceSelector, setShowVoiceSelector] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState(
    chatbotSettings.voice_settings?.default_language || "en-IN"
  );
  /** The learner's past chats, for the history list (see loadSessions). */
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  /** Personal starters for the current page (see loadStarters). */
  const [starters, setStarters] = useState<ChatStartersResponse | null>(null);
  const [startersState, setStartersState] = useState<StartersState>("idle");

  // Ref to scroll to bottom
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<ChatStream | null>(null);
  // Latest values for callbacks that must not re-bind on every token.
  const streamingContentRef = useRef("");
  streamingContentRef.current = streamingContent;
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;
  const stopReattachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Per-message counter so a failed rating only reverts if no newer click happened. */
  const feedbackSeqRef = useRef(new Map<number, number>());
  /** Same, for saving a reply. */
  const savedSeqRef = useRef(new Map<number, number>());
  /** Page + language the shown starters were made for, and the request in flight. */
  const startersKeyRef = useRef<string | null>(null);
  const startersRef = useRef<ChatStartersResponse | null>(null);
  startersRef.current = starters;
  const startersRequestRef = useRef<{ key: string; promise: Promise<ChatStartersResponse | null> } | null>(null);
  const startersFetchedAtRef = useRef(0);
  /** A request to send once the chat is ready (launcher peek tapped while closed). */
  const pendingPromptRef = useRef<string | null>(null);
  const [pendingPromptTick, setPendingPromptTick] = useState(0);
  // The tapped prompt, shown at once while the chat opens (or replays) and
  // the real send has to wait.
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);

  // Subscribe to stores for reactive context
  const activeSlide = useContentStore((state) => state.activeItem);
  const instituteDetails = useInstituteDetailsStore(
    (state) => state.instituteDetails,
  );
  const getCourseDetails = useCourseDetailsStore(
    (state) => state.getCourseDetails,
  );
  const studyLibraryData = useStudyLibraryStore(
    (state) => state.studyLibraryData,
  );
  const modulesWithChaptersData = useModulesWithChaptersStore(
    (state) => state.modulesWithChaptersData,
  );

  // Cleanup on unmount only. Never on a session change: reopening a chat sets
  // the id and attaches its stream in the same tick, and a cleanup here would
  // close that new stream (the reply then waited for the 45 s watchdog).
  // Switching chats closes the old stream itself.
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (sessionIdRef.current) {
        chatbotAPI.closeSession(sessionIdRef.current).catch(console.error);
      }
    };
  }, []);

  // Flush offline queue when back online
  const flushOfflineQueue = useCallback(async () => {
    if (!sessionId) return;
    const queued = peekQueue();
    for (const msg of queued) {
      if (msg.sessionId === sessionId) {
        try {
          await chatbotAPI.sendMessage(sessionId, msg.message, msg.intent as MessageIntent | undefined);
          dequeueMessage();
        } catch (e) {
          console.error("Failed to flush queued message:", e);
          break; // Stop if sending fails
        }
      }
    }
    setPendingMessages([]);
  }, [sessionId]);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      flushOfflineQueue();
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flushOfflineQueue]);

  // Reset inactivity timer
  const resetInactivityTimer = useCallback(() => {
    // No longer auto-closing sessions on inactivity
    // Users must explicitly close or start new chat
  }, []);

  useEffect(() => {
    resetInactivityTimer();
  }, [resetInactivityTimer]);

  // Fetch settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        getChatbotSettings(true).then((settings) => {
          setChatbotSettings(settings);
          // An admin-set name wins, but the untouched default is the literal
          // "Vacademy" — and it is also what a failed fetch returns. Fall back
          // to this hostname's branding rather than re-branding a white-label
          // institute's chatbot as Vacademy.
          setInstituteName(
            settings.institute_name &&
              settings.institute_name !== DEFAULT_CHATBOT_SETTINGS.institute_name
              ? settings.institute_name
              : getCachedInstituteBranding()?.instituteName || "",
          );
          // The institute's default call language, which only exists once the
          // settings land — the initial state was seeded from the defaults.
          if (settings.voice_settings?.default_language) {
            setVoiceLanguage(settings.voice_settings.default_language);
          }
          // Update chatbot page visibility from admin settings
          if (settings.chatbot_pages) {
            setChatbotPages(settings.chatbot_pages);
          }
        });
      } catch (error) {
        console.error("Failed to fetch chatbot settings:", error);
      }
    };
    fetchSettings();
  }, []);

  const shouldShowChatbot = () => {
    // Restrict chatbot for parent portal users
    if (parentPortal.selectedChild) return false;
    // Check global visibility setting first
    if (!chatbotSettings.enable) return false;
    // Check centralized route configuration
    return isChatbotVisibleOnRoute(location.pathname);
  };

  const getContext = useCallback((): ChatbotContext => {
    const searchParams = new URLSearchParams(window.location.search);

    return {
      route: location.pathname,
      courseId: searchParams.get("courseId") || undefined,
      packageSessionId: searchParams.get("packageSessionId") || undefined,
      subjectId: searchParams.get("subjectId") || undefined,
      moduleId: searchParams.get("moduleId") || undefined,
      chapterId: searchParams.get("chapterId") || undefined,
      slideId: searchParams.get("slideId") || undefined,
      sessionId: searchParams.get("sessionId") || undefined,
    };
  }, [location.pathname]);

  const getContextType = useCallback((): ContextType => {
    const path = location.pathname;

    // Check if we're on the slide page
    if (path.includes("/slides")) {
      return "slide";
    }
    // Check if we're on course details page (but not on nested routes)
    else if (path.includes("/course-details") && !path.includes("/subjects")) {
      return "course_details";
    }
    return "general";
  }, [location.pathname]);

  const buildPageContextMeta = useCallback(async (): Promise<ContextMeta> => {
    const contextType = getContextType();
    const context = getContext();

    if (contextType === "slide") {
      // Data is already subscribed via hooks above
      if (activeSlide) {
        // Determine slide type
        let slideType = "DOCUMENT";
        let slideContent = "";
        let questions: string[] = [];
        let options: string[] = [];

        if (activeSlide.source_type === "VIDEO") {
          slideType = "VIDEO";
          if (activeSlide.video_slide) {
            slideContent = activeSlide.video_slide.description || "";
          }
        } else if (activeSlide.source_type === "DOCUMENT") {
          if (activeSlide.document_slide?.type === "CODE") {
            slideType = "CODE";
            slideContent = activeSlide.document_slide.published_data || "";
          } else slideType = "DOCUMENT";
          if (activeSlide.document_slide) {
            slideContent = activeSlide.document_slide.published_data || "";
          }
        } else if (activeSlide.source_type === "QUESTION") {
          slideType = "QUESTION";
          if (activeSlide.question_slide) {
            questions = [activeSlide.question_slide.text_data?.content];
            options =
              activeSlide.question_slide.options?.map(
                (opt) => opt.text?.content || "",
              ) || [];
          }
        } else if (activeSlide.source_type === "QUIZ") {
          slideType = "QUIZ";
          if (activeSlide.quiz_slide) {
            // Todo handle the case where quiz slide has multiple questions and options to store them all
            // we have to store all the questions of that quiz slide
            const quizQuestions = activeSlide.quiz_slide.questions;
            if (quizQuestions && quizQuestions.length > 0) {
              questions = quizQuestions.map((q) => q.text?.content || "");
              //  for options we can send 2d array or we can send as string joined by new line
              // send like [["option1","option2"],["option1","option2"]]
              //@ts-expect-error : options type issue
              options = quizQuestions.map((q) =>
                q.options?.map((opt) => opt.text?.content || ""),
              ) as string[][];
            }
          }
        } else if (
          activeSlide.source_type === "SCORM" ||
          activeSlide.source_type === "HTML_VIDEO" ||
          activeSlide.source_type === "AUDIO"
        ) {
          // The app has no text for these (a package iframe, an AI video, a
          // recording); the server fills `content` from the lesson using slide_id.
          slideType = activeSlide.source_type;
        } else if (activeSlide.source_type === "ASSIGNMENT") {
          slideType = "ASSIGNMENT";
          if (activeSlide.assignment_slide) {
            questions = [activeSlide.assignment_slide.text_data?.content || ""];
          }
        }

        // Get course info from batches
        let courseName = "";
        if (context.courseId) {
          let matches = instituteDetails?.batches_for_sessions || [];
          if (!matches || matches.length === 0) {
            try {
              const { fetchBatchesForCourse } =
                await import("@/services/courseBatches");
              matches = await fetchBatchesForCourse(context.courseId);
            } catch (e) {
              console.error(e);
            }
          }

          const batch = matches?.find(
            (b) => b.package_dto.id === context.courseId,
          );
          courseName = batch?.package_dto?.package_name || "";
        }

        // Resolve chapter/subject/module names from stores using URL params
        const chapterNameStr = context.chapterId
          ? getChapterName(context.chapterId, modulesWithChaptersData) || ""
          : "";
        const moduleNameStr = context.moduleId
          ? getModuleName(context.moduleId, modulesWithChaptersData)
          : "";
        const subjectNameStr = context.subjectId
          ? getSubjectName(context.subjectId, studyLibraryData) || ""
          : "";

        return {
          name: activeSlide.title || "Current Slide",
          type: slideType,
          content: slideContent,
          questions: questions || undefined,
          options: options.length > 0 ? options : undefined,
          order: activeSlide.slide_order,
          chapter: chapterNameStr,
          module: moduleNameStr,
          subject: subjectNameStr,
          course: courseName,
          progress: `${Math.round(activeSlide.percentage_completed || 0)}%`,
        };
      }

      // Fallback if no active slide
      return {
        name: "Current Slide",
        type: "DOCUMENT",
        content: "",
        level: "",
        order: 0,
        chapter: "",
        module: "",
        subject: "",
        course: "",
      };
    } else if (contextType === "course_details") {
      // Data subscribed via hooks
      if (context.courseId) {
        // Try to get cached course details first
        // @ts-expect-error : course details type issue
        const courseDetails: {
          about_the_course_html: string;
          package_name: string;
          read_time_in_minutes: number | null;
          why_learn_html: string;
          who_should_learn_html: string;
        } = getCourseDetails(context.courseId);
        console.log("Building context meta for course details:", courseDetails);

        // Find batch info for basic metadata
        let matches = instituteDetails?.batches_for_sessions || [];
        if (!matches || matches.length === 0) {
          try {
            const { fetchBatchesForCourse } =
              await import("@/services/courseBatches");
            matches = await fetchBatchesForCourse(context.courseId);
          } catch (e) {
            console.error(e);
          }
        }

        const batch = matches?.find(
          (b) => b.package_dto.id === context.courseId,
        );

        if (courseDetails?.package_name) {
          // Helper to strip HTML tags and clean text
          const stripHtml = (html: string) => {
            if (!html) return "";
            return html
              .replace(/<[^>]*>/g, "")
              .replace(/&nbsp;/g, " ")
              .trim();
          };

          return {
            name: courseDetails.package_name || "Current Course",
            total_length_in_minutes: courseDetails.read_time_in_minutes || null, // TODO: Calculate from course progress
            about: stripHtml(courseDetails.about_the_course_html) || "",
            why_learn: stripHtml(courseDetails.why_learn_html) || "",
            who_should_learn:
              stripHtml(courseDetails.who_should_learn_html) || "",
          };
        } else if (batch) {
          // Fallback to basic batch info if course details not available
          return {
            name: batch.package_dto?.package_name || "Current Course",
            total_length_in_minutes: null,
            about: "",
          };
        }
      }

      return {
        name: "Current Course",
        total_length_in_minutes: null,
        about: "",
      };
    }

    return {};
  }, [
    getContextType,
    getContext,
    activeSlide,
    instituteDetails,
    getCourseDetails,
    studyLibraryData,
    modulesWithChaptersData,
  ]);

  /**
   * Page context plus the ids the tutor's tools act on: which lesson (so a
   * doubt sent to a teacher is attached to it and routed to its subject
   * teacher) and which batch the learner is studying in. The chapter and the
   * learner's IANA time zone are hints for course-material search (which
   * chapter is current, what "today" is for drip dates); the server
   * re-derives access and only uses them inside what the learner may read.
   */
  const buildContextMeta = useCallback(async (): Promise<ContextMeta> => {
    const meta = await buildPageContextMeta();
    const context = getContext();
    let timeZone: string | undefined;
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
      timeZone = undefined;
    }
    return {
      ...meta,
      ...(context.slideId && { slide_id: context.slideId }),
      ...(context.chapterId && { chapter_id: context.chapterId }),
      ...(context.subjectId && { subject_id: context.subjectId }),
      ...((context.sessionId || context.packageSessionId) && {
        package_session_id: context.sessionId || context.packageSessionId,
      }),
      ...(timeZone && { tz: timeZone }),
    };
  }, [buildPageContextMeta, getContext]);

  // ── SSE stream lifecycle ──────────────────────────────────────────────
  // Replies are produced by the server INSIDE the session's SSE loop, so a
  // message sent while the stream is down is never answered. The browser does
  // not retry a CLOSED EventSource, so we reconnect with backoff, and a
  // watchdog below forces a reconnect when a turn looks stuck.
  const MAX_STREAM_RECONNECTS = 6;
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachStreamRef = useRef<(sid: string) => void>(() => {});
  /**
   * Set when an existing chat is opened into an empty view: the server's
   * transcript replay (everything before its first status event) then also
   * fills in the learner's own messages, which live turns show optimistically.
   * Stays set across a reconnect until a replay has completed.
   */
  const hydratePendingRef = useRef(false);
  /**
   * Set from attaching a stream until its first status event. A new chat's
   * greeting arrives before that status, so a queued prompt waits for it and
   * lands below the greeting rather than above it.
   */
  const firstStatusPendingRef = useRef(false);

  /** Show an AI usage limit inline (one bubble; a repeat of the same text is not re-added). */
  const showUsageLimit = useCallback((body: AiUsageLimitBody) => {
    setIsWaitingForResponse(false);
    setIsLoading(false);
    setAiStatus("idle");
    const content = aiUsageLimitMessage(body);
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.content === content) return prev;
      return [...prev, { id: Date.now(), role: "assistant", content, timestamp: Date.now() }];
    });
  }, []);

  const closeStream = useCallback(() => {
    hydratePendingRef.current = false;
    if (stopReattachTimerRef.current) {
      clearTimeout(stopReattachTimerRef.current);
      stopReattachTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const scheduleStreamReconnect = useCallback((sid: string) => {
    if (reconnectTimerRef.current) return;
    const attempt = reconnectAttemptsRef.current;
    if (attempt >= MAX_STREAM_RECONNECTS) {
      console.error("[chatbot] stream could not be re-established; giving up");
      setHasError(true);
      setIsLoading(false);
      setIsWaitingForResponse(false);
      setAiStatus("idle");
      return;
    }
    const delay = Math.min(30_000, 1000 * 2 ** attempt);
    reconnectAttemptsRef.current = attempt + 1;
    console.warn(`[chatbot] stream lost; reconnecting in ${delay}ms (attempt ${attempt + 1})`);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      attachStreamRef.current(sid);
    }, delay);
  }, []);

  /** Open (or re-open) the SSE stream for a session and wire its handlers. */
  const attachStream = useCallback(
    (sid: string) => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      firstStatusPendingRef.current = true;

      const showCreditsExhausted = () => {
        setIsCreditsExhausted(true);
        setIsWaitingForResponse(false);
        setIsLoading(false);
        setAiStatus("idle");
        const creditsMessage: ChatMessage = {
          id: Date.now(),
          role: "assistant",
          content: t("common.creditsExhausted"),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, creditsMessage]);
      };

      const handleMessage = (raw: string) => {
        const messageData: MessageEvent = JSON.parse(raw);

        const usageLimit = parseAiUsageLimitBody(messageData);
        if (usageLimit) {
          showUsageLimit(usageLimit);
          return;
        }

        // Check for credits exhausted error in message data
        const maybeError = messageData as unknown as { type?: string; code?: number };
        if (maybeError.type === "ERROR" && maybeError.code === 402) {
          showCreditsExhausted();
          return;
        }

        // Handle tool_call: show indicator; tool_result: clear it
        if (messageData.type === "tool_call") {
          setActiveToolCall(messageData.metadata?.tool_name || null);
          return;
        }
        if (messageData.type === "tool_result") {
          setActiveToolCall(null);
          return;
        }

        // Skip user messages from SSE since we already show them optimistically
        // — except while replaying an opened chat's transcript.
        if (messageData.type === "user") {
          if (!hydratePendingRef.current) return;
          const meta = messageData.metadata as { attachments?: ChatMessage["attachments"] } | undefined;
          const replayed: ChatMessage = {
            id: messageData.id,
            role: "user",
            content: messageData.content,
            timestamp: new Date(messageData.created_at).getTime(),
            attachments: Array.isArray(meta?.attachments) ? meta.attachments : undefined,
            fromServer: true,
            replayed: true,
          };
          setMessages((prev) =>
            prev.some((msg) => msg.id === replayed.id) ? prev : [...prev, replayed],
          );
          return;
        }

        // Clear waiting state and tool indicator when we get an actual assistant message
        setIsWaitingForResponse(false);
        setActiveToolCall(null);

        // When we receive a full assistant message, clear streaming state
        if (messageData.type === "assistant") {
          setIsStreaming(false);
          setStreamingContent("");
        }

        const newMessage: ChatMessage = {
          id: messageData.id,
          role: messageData.type as ChatMessage["role"],
          content: messageData.content,
          timestamp: new Date(messageData.created_at).getTime(),
          metadata: messageData.metadata as ChatMessage["metadata"],
          fromServer: true,
          ...(hydratePendingRef.current && { replayed: true }),
        };

        setMessages((prev) => {
          // The server replays the transcript on every (re)connect.
          const exists = prev.some((msg) => msg.id === newMessage.id);
          if (exists) return prev;
          // After Stop, the first new assistant message is the server's copy
          // of that reply: it takes the local partial bubble's place.
          const localIndex =
            newMessage.role === "assistant" ? prev.findIndex((msg) => msg.isLocal) : -1;
          if (localIndex !== -1) {
            return [
              ...prev.slice(0, localIndex),
              newMessage,
              ...prev.slice(localIndex + 1).filter((msg) => !msg.isLocal),
            ];
          }
          return [...prev, newMessage];
        });
      };

      const handleStatus = (raw: string) => {
        // The server sends its first status right after the transcript replay.
        hydratePendingRef.current = false;
        firstStatusPendingRef.current = false;
        const statusData = JSON.parse(raw);
        setAiStatus(statusData.ai_status);
        if (statusData.session_status === "CLOSED") {
          setIsSessionClosed(true);
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
        }
      };

      // A structured `error` event (credits exhausted, usage limit, a failed turn).
      const handleErrorEvent = (raw: string) => {
        const errorData = JSON.parse(raw);
        const usageLimit = parseAiUsageLimitBody(errorData);
        if (usageLimit) {
          showUsageLimit(usageLimit);
          return;
        }
        if (errorData.type === "ERROR" && errorData.code === 402) {
          showCreditsExhausted();
        }
      };

      const stream = chatbotAPI.openStream(sid, {
        onOpen: () => {
          reconnectAttemptsRef.current = 0;
        },
        onEvent: (event, data) => {
          try {
            if (event === "message") handleMessage(data);
            else if (event === "token") {
              const parsed = JSON.parse(data);
              setIsStreaming(true);
              setStreamingContent((prev) => prev + (parsed.content || ""));
            } else if (event === "status") handleStatus(data);
            else if (event === "error") handleErrorEvent(data);
          } catch (error) {
            console.error(`[chatbot] could not handle '${event}' event:`, error);
          }
        },
        onDisconnect: ({ status }) => {
          if (eventSourceRef.current === stream) eventSourceRef.current = null;
          // 403: the session is not this learner's; 404: it no longer exists.
          // Retrying cannot help — stop and let Retry / New chat start over.
          if (status === 403 || status === 404) {
            console.error(`[chatbot] stream refused (${status}); not retrying`);
            setHasError(true);
            setIsLoading(false);
            setIsWaitingForResponse(false);
            setAiStatus("idle");
            return;
          }
          // Dropped connection, 5xx during a deploy, or the server's 30-minute
          // idle close: reconnect. The server replays the transcript and
          // answers any question that was left unanswered.
          scheduleStreamReconnect(sid);
        },
      });
      eventSourceRef.current = stream;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, scheduleStreamReconnect, showUsageLimit],
  );
  attachStreamRef.current = attachStream;

  /** Re-establish the stream for the current session (Retry button, watchdog). */
  const reconnectStream = useCallback(() => {
    setHasError(false);
    reconnectAttemptsRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (sessionId) {
      attachStream(sessionId);
    }
  }, [sessionId, attachStream]);

  const initializeSession = useCallback(async () => {
    if (isInitializing || sessionId) return;

    setIsInitializing(true);
    setIsWaitingForResponse(true);
    setHasError(false);
    setIsSessionClosed(false);
    console.log("Starting session initialization...");

    try {
      // Reopen the learner's current chat from an earlier visit, if any. A
      // refused or vanished session (403/404) is forgotten and a new one made.
      const storedSessionId = await readLastSession();
      if (storedSessionId) {
        try {
          await chatbotAPI.resumeSession(storedSessionId);
          setMessages([]);
          setIsWaitingForResponse(false);
          setAiStatus("idle");
          setSessionId(storedSessionId);
          void writeLastSession(storedSessionId);
          // The server replays the transcript on attach.
          hydratePendingRef.current = true;
          attachStream(storedSessionId);
          return;
        } catch (error) {
          console.warn("[chatbot] could not reopen the last chat; starting a new one", error);
          await writeLastSession(null);
        }
      }

      const contextType = getContextType();
      const context = getContext();

      // Pre-fetch course details if we're on course_details page
      if (contextType === "course_details" && context.courseId) {
        try {
          const { fetchCourseDetails } = useCourseDetailsStore.getState();
          await fetchCourseDetails(context.courseId);
        } catch (error) {
          console.warn(
            "Failed to fetch course details, will use basic info:",
            error,
          );
        }
      }

      const contextMeta = await buildContextMeta();
      console.log("Initializing session with context:", contextMeta);

      const response = await chatbotAPI.initSession(
        undefined,
        contextType,
        contextMeta,
      );

      setSessionId(response.session_id);
      setAiStatus(response.status);
      void writeLastSession(response.session_id);

      console.log("Setting up SSE connection...");

      attachStream(response.session_id);

    } catch (error) {
      console.error("Failed to initialize session:", error);
      const initUsageLimit = claimAiUsageLimit(error);
      if (initUsageLimit) {
        // No session yet: stop the open-effect from re-initialising in a loop
        // (the role hasError plays for other failures) until "New chat".
        setIsUsageLimited(true);
        setMessages([]);
        showUsageLimit(initUsageLimit);
        return;
      }
      setHasError(true);

      const assistantName = chatbotSettings.assistant_name;
      let errorMessage: string;
      if (axios.isAxiosError(error)) {
        if (error.code === "ERR_NETWORK") {
          errorMessage = t("useChatbot.initErrorNetwork", { assistantName });
        } else if (error.response?.status === 404) {
          errorMessage = t("useChatbot.initErrorNotFound", { assistantName });
        } else if (
          error.response?.status === 403 ||
          error.response?.status === 401
        ) {
          errorMessage = t("useChatbot.initErrorAuth", { assistantName });
        } else {
          errorMessage = t("useChatbot.initErrorGeneric", {
            assistantName,
            errorMessage: error.message,
          });
        }
      } else {
        errorMessage = t("useChatbot.initErrorFallback", { assistantName });
      }

      setMessages([
        {
          id: Date.now(),
          role: "assistant",
          content: errorMessage,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsInitializing(false);
    }
  }, [
    isInitializing,
    sessionId,
    chatbotSettings.assistant_name,
    getContextType,
    getContext,
    buildContextMeta,
    t,
    attachStream,
    showUsageLimit,
  ]);


  // Watchdog: if a turn stays "thinking" with nothing arriving, the stream is
  // probably dead on the server side. First re-open it (the server resumes and
  // processes the unanswered message); if it is still stuck, stop the dots and
  // show the error card instead of spinning forever.
  const aiStatusRef = useRef(aiStatus);
  aiStatusRef.current = aiStatus;
  useEffect(() => {
    const busy = aiStatus === "thinking" || aiStatus === "generating_quiz";
    if (!busy || !sessionId) return;
    const firstStage = aiStatus === "generating_quiz" ? 90_000 : 45_000;
    const t1 = setTimeout(() => {
      if (aiStatusRef.current !== aiStatus) return;
      console.warn("[chatbot] turn looks stuck; re-opening the stream");
      reconnectAttemptsRef.current = 0;
      attachStreamRef.current(sessionId);
    }, firstStage);
    const t2 = setTimeout(() => {
      if (aiStatusRef.current !== aiStatus) return;
      console.error("[chatbot] turn still stuck after reconnect; surfacing error");
      setAiStatus("idle");
      setIsLoading(false);
      setIsWaitingForResponse(false);
      setHasError(true);
    }, firstStage + 45_000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [aiStatus, sessionId]);

  // Initialize session when chatbot opens
  useEffect(() => {
    if (isOpen && !sessionId && !isInitializing && !hasError && !isUsageLimited) {
      initializeSession();
    }
  }, [isOpen, sessionId, isInitializing, hasError, isUsageLimited, initializeSession]);

  // Update context when page/route changes or active slide changes
  useEffect(() => {
    if (!isOpen || !sessionId || isInitializing) return;

    const updateContextAsync = async () => {
      try {
        const contextType = getContextType();
        const contextMeta = await buildContextMeta();
        // During a call the topic is part of the context; a resync that omits
        // it would replace the session's context_meta and the agent would
        // lose what the interview/test is about.
        if (voiceMode && voiceTopic) {
          contextMeta.voice_topic = voiceTopic;
        }

        console.log("Updating context:", { contextType, contextMeta });

        await chatbotAPI.updateContext(sessionId, contextType, contextMeta);
        console.log("Context updated successfully");
      } catch (error) {
        console.error("Failed to update context:", error);
        // Don't show error to user - context update is non-critical
      }
    };

    updateContextAsync();
  }, [
    sessionId,
    isOpen,
    isInitializing,
    getContextType,
    buildContextMeta,
    location.pathname,
    activeSlide,
    voiceMode,
    voiceTopic,
  ]);

  const sendMessage = async (content: string, intent?: MessageIntent, attachments?: Array<{type: string; url: string; mime_type?: string; name?: string}>) => {
    // A photo of a question with no typed text is a real message.
    const hasAttachments = !!attachments && attachments.length > 0;
    if ((!content.trim() && !hasAttachments) || !sessionId) return;

    if (isCreditsExhausted) {
      const creditsMessage: ChatMessage = {
        id: Date.now(),
        role: "assistant",
        content: t("common.creditsExhausted"),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, creditsMessage]);
      return;
    }

    // Queue message if offline
    if (!navigator.onLine) {
      enqueueMessage({ sessionId, message: content, intent });
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: "user",
          content,
          timestamp: Date.now(),
          status: "pending",
        },
      ]);
      setPendingMessages(peekQueue());
      setInputValue("");
      return;
    }

    const newMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content,
      timestamp: Date.now(),
      attachments: attachments?.map(att => ({ ...att, type: att.type as 'image' | 'video' })),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputValue("");
    void writeLastSession(sessionId);
    // If intent is practice, show generating_quiz status, else thinking
    setIsLoading(true);
    setAiStatus(intent === "practice" ? "generating_quiz" : "thinking");

    try {
      await chatbotAPI.sendMessage(sessionId, content, intent, undefined, attachments);
      // Response will come through SSE
    } catch (error) {
      console.error("Failed to send message:", error);

      const sendUsageLimit = claimAiUsageLimit(error);
      // Check for 402 credits exhausted
      if (sendUsageLimit) {
        showUsageLimit(sendUsageLimit);
      } else if (axios.isAxiosError(error) && error.response?.status === 402) {
        setIsCreditsExhausted(true);
        const creditsMsg: ChatMessage = {
          id: Date.now(),
          role: "assistant",
          content: t("common.creditsExhausted"),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, creditsMsg]);
        setAiStatus("idle");
      } else if (axios.isAxiosError(error) && error.response?.status === 429) {
        // Per-learner send rate limit: not an error state, just slow down.
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            role: "assistant",
            content: t("useChatbot.sendingTooFast"),
            timestamp: Date.now(),
          },
        ]);
        setAiStatus("idle");
      } else {
        setHasError(true);
        const errorMessage: ChatMessage = {
          id: Date.now(),
          role: "assistant",
          content: t("useChatbot.processingFailed"),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
        setAiStatus("idle");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const submitQuiz = async (submission: QuizSubmission) => {
    if (!sessionId) return;

    setIsLoading(true);
    setAiStatus("thinking");

    try {
      await chatbotAPI.sendMessage(
        sessionId,
        "Quiz completed",
        undefined,
        submission,
      );
      // Response will come through SSE as quiz_feedback
    } catch (error) {
      console.error("Failed to submit quiz:", error);
      const quizUsageLimit = claimAiUsageLimit(error);
      if (quizUsageLimit) {
        showUsageLimit(quizUsageLimit);
        return;
      }
      setHasError(true);
      const errorMessage: ChatMessage = {
        id: Date.now(),
        role: "assistant",
        content: t("useChatbot.quizSubmitFailed"),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setAiStatus("idle");
    } finally {
      setIsLoading(false);
    }
  };

  const startNewChat = useCallback(async () => {
    // Forget the remembered chat first, so the re-init below starts fresh.
    await writeLastSession(null);
    // Close existing session
    if (sessionId) {
      try {
        await chatbotAPI.closeSession(sessionId);
      } catch (error) {
        console.error("Failed to close session:", error);
      }
    }

    // Close EventSource connection
    closeStream();

    // Reset state
    pendingPromptRef.current = null;
    setQueuedPrompt(null);
    setSessionId(null);
    setMessages([]);
    setInputValue("");
    setIsLoading(false);
    setAiStatus("idle");
    setIsInitializing(false);
    setIsWaitingForResponse(false);
    setHasError(false);
    setIsCreditsExhausted(false);
    setIsUsageLimited(false);
    setIsSessionClosed(false);
    setActiveToolCall(null);
    setStreamingContent("");
    setIsStreaming(false);

    // Initialize new session
    await initializeSession();
  }, [sessionId, initializeSession]);

  /**
   * What a voice call should be about, taken from where the student already is:
   * chapter, then module, then subject, then course. Nobody should have to type
   * their topic when the app is already sitting inside it.
   */
  const suggestedVoiceTopic = useCallback((): string => {
    const contextType = getContextType();
    const context = getContext();

    const courseName = (() => {
      if (!context.courseId) return "";
      const batch = (instituteDetails?.batches_for_sessions || []).find(
        (b) => b.package_dto.id === context.courseId,
      );
      return (
        getCourseDetails(context.courseId)?.package_name ||
        batch?.package_dto?.package_name ||
        ""
      );
    })();

    if (contextType === "slide") {
      const chapterName = context.chapterId
        ? getChapterName(context.chapterId, modulesWithChaptersData) || ""
        : "";
      const moduleName = context.moduleId
        ? getModuleName(context.moduleId, modulesWithChaptersData) || ""
        : "";
      const subjectName = context.subjectId
        ? getSubjectName(context.subjectId, studyLibraryData) || ""
        : "";
      return chapterName || moduleName || subjectName || courseName;
    }

    return courseName;
  }, [
    getContext,
    getContextType,
    getCourseDetails,
    instituteDetails,
    modulesWithChaptersData,
    studyLibraryData,
  ]);

  const enterVoiceMode = useCallback(async (mode: SessionMode, language: string = chatbotSettings.voice_settings?.default_language || "en-IN", topic?: string) => {
    // Close current text session if exists
    if (sessionId) {
      try {
        await chatbotAPI.closeSession(sessionId);
      } catch {
        // best-effort: the voice session starts regardless
      }
    }
    closeStream();
    // The call screen mounts on `voiceMode && sessionId`. Clear the id BEFORE
    // flipping the mode, or it mounts against the text session we just closed,
    // opens a socket to it, and is then torn down mid-handshake when the real
    // voice session id lands — which left the mic permanently dead in prod.
    setSessionId(null);

    const resolvedTopic = (topic || suggestedVoiceTopic()).trim();

    setVoiceMode(mode);
    setVoiceLanguage(language);
    setVoiceTopic(resolvedTopic);
    setMessages([]);
    setIsInitializing(true);

    try {
      const contextType = getContextType();
      const contextMeta = await buildContextMeta();
      // Add voice topic to context so backend knows what to interview/test on
      if (resolvedTopic) {
        contextMeta.voice_topic = resolvedTopic;
      }
      const response = await chatbotAPI.initSession(undefined, contextType, contextMeta, mode);
      setSessionId(response.session_id);
    } catch (error) {
      console.error("Failed to start voice session:", error);
      setVoiceMode(null);
    } finally {
      setIsInitializing(false);
    }
  }, [sessionId, getContextType, buildContextMeta, suggestedVoiceTopic]);

  /**
   * Entry point for the "Voice Call" chip. With a single voice mode enabled —
   * the common case — there is nothing to choose, so the call starts straight
   * away instead of asking the student to fill in a dialog first.
   */
  const startVoiceCall = useCallback(() => {
    const voiceModes = (chatbotSettings.enabled_modes || []).filter((m) =>
      m.startsWith("voice_"),
    );
    if (voiceModes.length === 1 && voiceModes[0]) {
      enterVoiceMode(voiceModes[0] as SessionMode, voiceLanguage);
      return;
    }
    setShowVoiceSelector(true);
  }, [chatbotSettings.enabled_modes, enterVoiceMode, voiceLanguage]);

  const exitVoiceMode = useCallback(() => {
    setVoiceMode(null);
    setShowVoiceSelector(false);
    // Don't close the session — the VoiceModePanel handles that
  }, []);

  const closeSession = useCallback(async () => {
    // Forget the remembered chat first, so the re-init below starts fresh.
    await writeLastSession(null);
    // Close existing session
    if (sessionId) {
      try {
        await chatbotAPI.closeSession(sessionId);
      } catch (error) {
        console.error("Failed to close session:", error);
      }
    }

    // Close EventSource connection
    closeStream();

    // Reset state
    pendingPromptRef.current = null;
    setQueuedPrompt(null);
    setSessionId(null);
    setMessages([]);
    setInputValue("");
    setIsLoading(false);
    setAiStatus("idle");
    setIsInitializing(false);
    setIsWaitingForResponse(false);
    setHasError(false);
    setIsSessionClosed(true);
    setActiveToolCall(null);
    setStreamingContent("");
    setIsStreaming(false);
  }, [sessionId]);

  /** Fetch the learner's past chats into `sessions` (and return them). */
  const loadSessions = useCallback(async (): Promise<ChatSessionSummary[]> => {
    const list = await chatbotAPI.listSessions(20);
    setSessions(list);
    return list;
  }, []);

  /**
   * Switch to one of the learner's chats. The current chat is left untouched
   * if the server refuses (403) or no longer has it (404): resolves false.
   */
  const openSession = useCallback(
    async (id: string): Promise<boolean> => {
      if (id === sessionId && !isSessionClosed && !hasError) return true;
      try {
        await chatbotAPI.resumeSession(id);
      } catch (error) {
        console.error("[chatbot] could not open chat:", error);
        return false;
      }
      closeStream();
      reconnectAttemptsRef.current = 0;
      setMessages([]);
      setStreamingContent("");
      setIsStreaming(false);
      setActiveToolCall(null);
      setIsLoading(false);
      setAiStatus("idle");
      setIsWaitingForResponse(false);
      setHasError(false);
      setIsUsageLimited(false);
      setIsSessionClosed(false);
      // A new id also re-syncs the page context (the context effect above).
      setSessionId(id);
      void writeLastSession(id);
      // The server replays the transcript on attach, repopulating messages.
      hydratePendingRef.current = true;
      attachStream(id);
      return true;
    },
    [sessionId, isSessionClosed, hasError, closeStream, attachStream],
  );

  /**
   * Stop the reply being written. Closing the stream makes the server save
   * the partial reply (metadata.stopped); it is shown locally until that
   * copy arrives on the re-opened stream.
   */
  const stopGeneration = useCallback(() => {
    const sid = sessionId;
    const busy =
      isLoading || isStreaming || aiStatus === "thinking" || aiStatus === "generating_quiz";
    if (!sid || !busy) return;
    closeStream();
    const partial = visibleStreamText(streamingContentRef.current);
    if (partial) {
      const now = Date.now();
      setMessages((prev) => [
        ...prev,
        {
          id: -now,
          role: "assistant",
          content: partial,
          timestamp: now,
          isLocal: true,
          metadata: { stopped: true },
        },
      ]);
    }
    setStreamingContent("");
    setIsStreaming(false);
    setActiveToolCall(null);
    setIsLoading(false);
    setIsWaitingForResponse(false);
    setAiStatus("idle");
    reconnectAttemptsRef.current = 0;
    // Tell the server first, so the stopped question is never picked up again
    // by the stream we re-open (or another tab); then re-open so the saved
    // partial copy and later replies still arrive.
    const reattach = () => {
      stopReattachTimerRef.current = setTimeout(() => {
        stopReattachTimerRef.current = null;
        if (sessionIdRef.current === sid) attachStreamRef.current(sid);
      }, STOP_REATTACH_DELAY_MS);
    };
    chatbotAPI.stopTurn(sid).then(reattach, reattach);
  }, [sessionId, isLoading, isStreaming, aiStatus, closeStream]);

  /** Thumbs up / down on an assistant reply ("none" clears). Optimistic; reverts on failure. */
  const setFeedback = useCallback(
    async (messageId: number, rating: FeedbackRating) => {
      const sid = sessionId;
      const target = messagesRef.current.find((m) => m.id === messageId);
      if (!sid || !target?.fromServer) return;
      const previous = target.metadata?.feedback;
      const seq = (feedbackSeqRef.current.get(messageId) ?? 0) + 1;
      feedbackSeqRef.current.set(messageId, seq);
      const applyFeedback = (feedback: NonNullable<ChatMessage["metadata"]>["feedback"]) =>
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, metadata: { ...m.metadata, feedback } } : m,
          ),
        );
      applyFeedback({ rating });
      try {
        await chatbotAPI.sendFeedback(sid, messageId, rating);
      } catch (error) {
        console.error("[chatbot] could not save feedback:", error);
        if (feedbackSeqRef.current.get(messageId) === seq) applyFeedback(previous);
      }
    },
    [sessionId],
  );

  /**
   * Save (bookmark) or unsave a reply. Optimistic for a reply in the open chat;
   * reverts on failure. `targetSessionId` unsaves from the Saved list, where the
   * reply may belong to another chat. Resolves whether the server accepted it.
   */
  const setSaved = useCallback(
    async (messageId: number, saved: boolean, targetSessionId?: string): Promise<boolean> => {
      const sid = targetSessionId || sessionId;
      if (!sid) return false;
      const target = messagesRef.current.find((m) => m.id === messageId && m.fromServer);
      const previous = target?.metadata?.saved_at ?? null;
      const seq = (savedSeqRef.current.get(messageId) ?? 0) + 1;
      savedSeqRef.current.set(messageId, seq);
      const applySaved = (savedAt: string | null) =>
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, metadata: { ...m.metadata, saved_at: savedAt } } : m,
          ),
        );
      if (target) applySaved(saved ? new Date().toISOString() : null);
      try {
        await chatbotAPI.setSaved(sid, messageId, saved);
        return true;
      } catch (error) {
        console.error("[chatbot] could not save the reply:", error);
        if (target && savedSeqRef.current.get(messageId) === seq) applySaved(previous);
        return false;
      }
    },
    [sessionId],
  );

  // ── Personal starters ────────────────────────────────────────────────
  /** What the learner is looking at, named for the starters (lesson or course). */
  const getStarterLesson = useCallback((): string => {
    const contextType = getContextType();
    if (contextType === "slide") return activeSlide?.title || "";
    if (contextType === "course_details") {
      const { courseId } = getContext();
      if (!courseId) return "";
      const details = getCourseDetails(courseId) as unknown as { package_name?: string } | undefined;
      const batch = (instituteDetails?.batches_for_sessions || []).find(
        (b) => b.package_dto.id === courseId,
      );
      return details?.package_name || batch?.package_dto?.package_name || "";
    }
    return "";
  }, [getContextType, getContext, activeSlide, getCourseDetails, instituteDetails]);

  /**
   * Fetch the starters for the current page (cached a few minutes per page +
   * language; concurrent calls share one request). Resolves null when they
   * could not be loaded, e.g. signed out or offline.
   */
  const loadStarters = useCallback((): Promise<ChatStartersResponse | null> => {
    const contextType = getContextType();
    const lesson = getStarterLesson();
    const key = `${contextType}|${lesson}|${i18n.language}`;
    const fresh = Date.now() - startersFetchedAtRef.current < STARTERS_TTL_MS;
    if (startersKeyRef.current === key && startersRef.current && fresh) {
      return Promise.resolve(startersRef.current);
    }
    if (startersRequestRef.current?.key === key) return startersRequestRef.current.promise;
    const isCurrent = () => startersRequestRef.current?.key === key;
    const promise = (async (): Promise<ChatStartersResponse | null> => {
      let token: string | null = null;
      try {
        token = await getTokenFromStorage(TokenKey.accessToken);
      } catch {
        token = null;
      }
      // Signed out (a public page): there is nothing personal to suggest.
      if (!token) {
        if (isCurrent()) setStartersState("error");
        return null;
      }
      if (isCurrent()) setStartersState("loading");
      try {
        const data = await chatbotAPI.getStarters(contextType, lesson || undefined);
        if (isCurrent()) {
          startersKeyRef.current = key;
          startersFetchedAtRef.current = Date.now();
          setStarters(data);
          setStartersState("ready");
        }
        return data;
      } catch (error) {
        console.warn("[chatbot] could not load starters:", error);
        if (isCurrent()) setStartersState("error");
        return null;
      } finally {
        if (isCurrent()) startersRequestRef.current = null;
      }
    })();
    startersRequestRef.current = { key, promise };
    return promise;
  }, [getContextType, getStarterLesson, i18n.language]);

  const hasLearnerMessage = messages.some((m) => m.role === "user");

  // The empty chat shows starters for the page the learner is on.
  useEffect(() => {
    if (!isOpen || voiceMode || hasLearnerMessage) return;
    const timer = setTimeout(() => void loadStarters(), 250);
    return () => clearTimeout(timer);
  }, [isOpen, voiceMode, hasLearnerMessage, loadStarters]);

  /** Open the chat and send `prompt` as soon as the chat is ready (launcher peek). */
  const openAndSend = useCallback((prompt: string) => {
    if (!prompt.trim()) return;
    pendingPromptRef.current = prompt;
    setQueuedPrompt(prompt);
    setIsOpen(true);
    setPendingPromptTick((n) => n + 1);
  }, []);

  // A chat that could not open drops the waiting prompt with it.
  useEffect(() => {
    if (!hasError && !isUsageLimited) return;
    pendingPromptRef.current = null;
    setQueuedPrompt(null);
  }, [hasError, isUsageLimited]);

  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  useEffect(() => {
    if (!pendingPromptRef.current || !sessionId || isInitializing || voiceMode) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // An opened chat replays its transcript, and a new one sends its greeting,
    // before the stream's first status; send after that, so the question lands
    // below them.
    const trySend = (attempt: number) => {
      if ((hydratePendingRef.current || firstStatusPendingRef.current) && attempt < 40) {
        timer = setTimeout(() => trySend(attempt + 1), 250);
        return;
      }
      const prompt = pendingPromptRef.current;
      pendingPromptRef.current = null;
      // Same render as the real bubble, so the hand-over does not flicker.
      setQueuedPrompt(null);
      if (prompt) void sendMessageRef.current(prompt);
    };
    trySend(0);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, isInitializing, voiceMode, pendingPromptTick]);

  // ── Read aloud ───────────────────────────────────────────────────────
  const { speakingMessageId, speechLoadingId, toggleReadAloud, stopSpeech } =
    useReplySpeech(sessionId);
  useEffect(() => {
    if (!isOpen || voiceMode) stopSpeech();
  }, [isOpen, voiceMode, stopSpeech]);

  return {
    isOpen,
    setIsOpen,
    messages,
    isLoading:
      isLoading || aiStatus === "thinking" || aiStatus === "generating_quiz",
    inputValue,
    setInputValue,
    sendMessage,
    submitQuiz,
    startNewChat,
    closeSession,
    shouldShowChatbot,
    messagesEndRef,
    chatbotSettings,
    instituteName,
    isExpanded,
    setIsExpanded,
    aiStatus,
    sessionId,
    isWaitingForResponse,
    hasError,
    isCreditsExhausted,
    isUsageLimited,
    isSessionClosed,
    isInitializing,
    activeToolCall,
    streamingContent,
    isStreaming,
    isOffline,
    pendingMessages,
    reconnectStream,
    sessions,
    loadSessions,
    openSession,
    stopGeneration,
    setFeedback,
    setSaved,
    starters,
    startersState,
    loadStarters,
    openAndSend,
    queuedPrompt,
    speakingMessageId,
    speechLoadingId,
    toggleReadAloud,
    stopSpeech,
    voiceMode,
    voiceTopic,
    suggestedVoiceTopic,
    startVoiceCall,
    showVoiceSelector,
    setShowVoiceSelector,
    enterVoiceMode,
    exitVoiceMode,
    voiceLanguage,
  };
};
