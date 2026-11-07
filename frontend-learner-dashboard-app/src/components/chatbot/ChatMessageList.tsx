import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { WifiSlash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { celebrateCompletion } from "@/lib/play-celebration";
import { useChatbotContext } from "./useChatbotContext";
import { AssistantAvatar, ChatMarkdown, MessageBubble } from "./MessageBubble";
import { QuizComponent } from "./QuizComponent";
import { QuizFeedbackComponent } from "./QuizFeedbackComponent";
import { useQueryClient } from "@tanstack/react-query";
import { POINTS_ME_KEY } from "@/services/points";
import { ToolIndicator } from "./ToolIndicator";
import { ChatStarters } from "./ChatStarters";
import { AnswerActions, AnswerTransforms } from "./AnswerToolbelt";
import { ChatCard } from "./cards/ChatCard";
import { brandConfettiColors } from "./brand-colors";
import { visibleStreamText } from "./stream-text";
import { getMessageRating, type ChatMessage, type QuizFeedbackData } from "./types";

/** At most this many follow-up chips under the last reply. */
const MAX_FOLLOW_UPS = 3;

/** Follow new content only while the learner is this close to the bottom. */
const NEAR_BOTTOM_PX = 120;
const ANNOUNCE_MAX_CHARS = 600;

/** Plain text for the screen-reader announcement of a reply. */
const toSpeech = (msg: ChatMessage): string => {
  const raw = msg.content || msg.metadata?.quiz_data?.title || "";
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>$~|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ANNOUNCE_MAX_CHARS);
};

/** Avatar + full-width content: quizzes and their feedback. */
const AssistantBlock: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex w-full me-auto max-w-pct-95 gap-1.5">
    <AssistantAvatar className="mt-0.5" />
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

const MessageRow: React.FC<{ msg: ChatMessage; isGreeting?: boolean; isLatestReply?: boolean }> = ({
  msg,
  isGreeting = false,
  isLatestReply = false,
}) => {
  const { submitQuiz, isSessionClosed, setFeedback } = useChatbotContext();

  if (msg.role === "quiz" && msg.metadata?.quiz_data) {
    return (
      <AssistantBlock>
        {msg.content && (
          <div className="bg-muted text-foreground rounded-lg px-3 py-2 text-sm mb-2 w-fit max-w-full">
            <ChatMarkdown>{msg.content}</ChatMarkdown>
          </div>
        )}
        <QuizComponent quizData={msg.metadata.quiz_data} onSubmit={submitQuiz} disabled={isSessionClosed} />
      </AssistantBlock>
    );
  }

  if (msg.role === "quiz_feedback" && msg.metadata?.feedback) {
    return (
      <AssistantBlock>
        <QuizFeedbackComponent
          feedback={msg.metadata.feedback as QuizFeedbackData}
          content={msg.content}
          pointsAwarded={(msg.metadata as { points?: { awarded?: number } }).points?.awarded}
        />
      </AssistantBlock>
    );
  }

  if (msg.role === "card") return <ChatCard message={msg} />;

  if (msg.role === "user") {
    return (
      <MessageBubble role="user" content={msg.content} attachments={msg.attachments} status={msg.status} />
    );
  }

  // Assistant replies, plus any role this UI does not know yet (as markdown).
  if (!msg.content) return null;
  // Saved replies can be rated; not the greeting, nor notices made in this tab.
  const canRate = msg.role === "assistant" && !!msg.fromServer && !isGreeting;
  return (
    <MessageBubble
      role="assistant"
      content={msg.content}
      showAvatar={msg.role === "assistant"}
      stopped={!!msg.metadata?.stopped}
      rating={getMessageRating(msg)}
      onRate={canRate ? (rating) => void setFeedback(msg.id, rating) : undefined}
      // The full toolbelt sits under the latest reply; older ones stay compact.
      extraActions={canRate ? <AnswerActions msg={msg} compact={!isLatestReply} /> : undefined}
      belowActions={canRate && isLatestReply && !isSessionClosed ? <AnswerTransforms /> : undefined}
    />
  );
};

/**
 * A soft rise + fade for content that arrives while the learner watches; the
 * history replayed when a chat is opened appears without motion.
 */
const Entrance: React.FC<{ animate: boolean; children: React.ReactNode }> = ({ animate, children }) => {
  const reduceMotion = useReducedMotion();
  if (!animate || reduceMotion) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
};

/** Follow-up questions the last reply suggested; tapping one asks it. */
const FollowUpChips: React.FC<{ suggestions: string[] }> = ({ suggestions }) => {
  const { t } = useTranslation("chatFeatureB");
  const { sendMessage } = useChatbotContext();
  return (
    <div className="flex flex-wrap gap-1.5 ps-7" role="group" aria-label={t("messageList.followUpsLabel")}>
      {suggestions.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => sendMessage(text)}
          className="max-w-full rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-start text-caption font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {text}
        </button>
      ))}
    </div>
  );
};

const ThinkingIndicator: React.FC<{ generatingQuiz: boolean }> = ({ generatingQuiz }) => {
  const { t } = useTranslation("chatFeatureB");
  return (
    <div className="me-auto flex max-w-pct-90 items-end gap-1.5">
      <AssistantAvatar />
      <div className="rounded-xl rounded-es-sm bg-card text-card-foreground px-3 py-2 shadow-sm ring-1 ring-border/30">
        {generatingQuiz ? (
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            {t("panel.generatingQuiz")}
          </span>
        ) : (
          <span className="flex h-4 items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" aria-hidden="true" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce delay-150" aria-hidden="true" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce delay-300" aria-hidden="true" />
            <span className="sr-only">{t("messageList.thinking")}</span>
          </span>
        )}
      </div>
    </div>
  );
};

const EmptyState: React.FC = () => {
  const { t } = useTranslation("chatFeatureB");
  const { chatbotSettings } = useChatbotContext();
  return (
    <div className="flex flex-col items-center gap-2 px-4 pt-8 pb-2 text-center">
      <AssistantAvatar className="h-10 w-10" />
      <p className="text-sm font-semibold text-foreground">
        {t("messageList.emptyTitle", { assistantName: chatbotSettings.assistant_name })}
      </p>
      <p className="text-caption text-muted-foreground">{t("messageList.emptySubtitle")}</p>
    </div>
  );
};

/**
 * The conversation, shared by the desktop side panel and the mobile panel:
 * messages (text, quiz, quiz feedback, cards), the live streamed reply, the
 * thinking/tool indicators, and offline / error / ended notices.
 */
export const ChatMessageList: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation("chatFeatureB");
  const {
    messages,
    isLoading,
    aiStatus,
    isInitializing,
    isOffline,
    isStreaming,
    streamingContent,
    activeToolCall,
    hasError,
    isCreditsExhausted,
    isSessionClosed,
    reconnectStream,
    startNewChat,
    chatbotSettings,
    queuedPrompt,
  } = useChatbotContext();

  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const nearBottomRef = useRef(true);
  const frameRef = useRef<number | null>(null);
  const lastSeenIdRef = useRef<number | undefined>(undefined);

  // The scroll container is Radix's viewport inside ScrollArea.
  useEffect(() => {
    const viewport = rootRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null;
    viewportRef.current = viewport;
    if (!viewport) return;
    const onScroll = () => {
      nearBottomRef.current =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= NEAR_BOTTOM_PX;
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.scrollTop = viewport.scrollHeight;
    return () => {
      viewport.removeEventListener("scroll", onScroll);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  // One instant jump per frame at most: streaming re-renders on every token,
  // and a smooth scroll per token fights itself and the learner.
  const scrollToBottom = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const viewport = viewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
  }, []);

  const lastMessage = messages[messages.length - 1];
  // A tapped starter waits for the chat to open (or replay); show it as sent
  // straight away, with the dots, instead of a screen that does not react.
  const showQueued = !!queuedPrompt && !hasError && !isCreditsExhausted;
  const showThinking =
    !isStreaming && (showQueued || isLoading || aiStatus === "thinking" || aiStatus === "generating_quiz");
  const visibleStreaming = isStreaming ? visibleStreamText(streamingContent) : "";
  // The greeting (a server reply before any question) is not rated.
  const greetingId =
    messages[0]?.role === "assistant" && messages[0].fromServer ? messages[0].id : undefined;
  const hasLearnerMessage = showQueued || messages.some((m) => m.role === "user");
  // The latest reply the learner can act on gets the full answer toolbelt.
  const latestReplyId = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.role === "user") return undefined;
      if (m?.role === "assistant") return m.fromServer && m.id !== greetingId ? m.id : undefined;
    }
    return undefined;
  })();
  // Before the first question the starters stand in for follow-up chips.
  const followUps =
    hasLearnerMessage &&
    lastMessage?.role === "assistant" &&
    !showThinking &&
    !isStreaming &&
    !isSessionClosed &&
    Array.isArray(lastMessage.metadata?.suggestions)
      ? lastMessage.metadata.suggestions
          .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
          .slice(0, MAX_FOLLOW_UPS)
      : [];

  useEffect(() => {
    if (lastMessage && lastMessage.id !== lastSeenIdRef.current) {
      lastSeenIdRef.current = lastMessage.id;
      // The learner's own message always brings the view back down.
      if (lastMessage.role === "user") nearBottomRef.current = true;
    }
    if (nearBottomRef.current) scrollToBottom();
  }, [
    lastMessage,
    messages.length,
    streamingContent,
    activeToolCall,
    showThinking,
    hasError,
    isSessionClosed,
    isCreditsExhausted,
    scrollToBottom,
  ]);

  // Screen readers hear each finished reply once (not every streamed token,
  // and not the history that was on screen when the panel opened).
  const [announcement, setAnnouncement] = useState("");
  const announcedIdRef = useRef<number | undefined>(lastMessage?.id);
  useEffect(() => {
    if (!lastMessage || lastMessage.role === "user" || lastMessage.id === announcedIdRef.current) return;
    announcedIdRef.current = lastMessage.id;
    const text = toSpeech(lastMessage);
    if (text) setAnnouncement(`${chatbotSettings.assistant_name}: ${text}`);
  }, [lastMessage, chatbotSettings.assistant_name]);

  const isEmpty = messages.length === 0 && !showQueued && !isInitializing && !isStreaming && !hasError && !isCreditsExhausted;
  // Messages already on screen when the list mounted (panel reopened) do not animate again.
  const initialIdsRef = useRef<Set<number> | null>(null);
  if (initialIdsRef.current === null) initialIdsRef.current = new Set(messages.map((m) => m.id));
  const isFresh = (msg: ChatMessage) => !msg.replayed && !initialIdsRef.current?.has(msg.id);

  // Not under a notice made in this tab (e.g. a usage limit that refused the chat).
  const showStarters =
    !hasLearnerMessage &&
    !isStreaming &&
    !hasError &&
    !isCreditsExhausted &&
    !isSessionClosed &&
    !messages.some((m) => m.role === "assistant" && !m.fromServer);

  const queryClient = useQueryClient();

  // One burst when a quiz comes back passed — live, not when history replays.
  const celebratedRef = useRef(new Set<number>());
  useEffect(() => {
    if (!lastMessage || lastMessage.role !== "quiz_feedback" || !isFresh(lastMessage)) return;
    if (celebratedRef.current.has(lastMessage.id)) return;
    celebratedRef.current.add(lastMessage.id);
    if ((lastMessage.metadata?.feedback as QuizFeedbackData | undefined)?.passed === true) {
      celebrateCompletion(brandConfettiColors());
    }
    // A pass can earn streak points: refresh every points pill.
    if ((lastMessage.metadata as { points?: { awarded?: number } } | undefined)?.points?.awarded) {
      void queryClient.invalidateQueries({ queryKey: POINTS_ME_KEY });
    }
  }, [lastMessage]);

  return (
    <div ref={rootRef} className={cn("flex-1 min-h-0 overflow-hidden", className)}>
      <ScrollArea className="h-full px-2 py-2 [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!min-w-0">
        <div className="flex flex-col gap-2.5" role="region" aria-label={t("messageList.ariaLabel")}>
          {isOffline && (
            <div className="flex items-center gap-2 rounded-md bg-warning-50 px-3 py-1.5 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-300">
              <WifiSlash className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{t("panel.offlineNotice")}</span>
            </div>
          )}

          {isInitializing && messages.length === 0 && !showQueued && (
            <div className="w-full rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden="true" />
                <span>{t("panel.initializing")}</span>
              </div>
            </div>
          )}

          {isEmpty && <EmptyState />}

          {messages.map((msg) => (
            <Entrance key={msg.id} animate={isFresh(msg)}>
              <MessageRow msg={msg} isGreeting={msg.id === greetingId} isLatestReply={msg.id === latestReplyId} />
            </Entrance>
          ))}

          {showQueued && (
            <Entrance animate>
              <MessageBubble role="user" content={queuedPrompt ?? ""} />
            </Entrance>
          )}

          {showStarters && <ChatStarters />}

          {followUps.length > 0 && <FollowUpChips suggestions={followUps} />}

          {visibleStreaming && (
            <MessageBubble role="assistant" content={visibleStreaming} streaming />
          )}

          <AnimatePresence>{activeToolCall && <ToolIndicator toolName={activeToolCall} />}</AnimatePresence>

          {showThinking && <ThinkingIndicator generatingQuiz={aiStatus === "generating_quiz"} />}

          {isCreditsExhausted && (
            <div className="w-full rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-center text-xs text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
              {t("common.creditsExhausted")}
            </div>
          )}

          {hasError && !isCreditsExhausted && (
            <div role="alert" className="w-full space-y-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-center">
              <p className="text-xs text-destructive">{t("panel.errorTitle")}</p>
              <div className="flex justify-center gap-3">
                <button type="button" onClick={reconnectStream} className="text-xs text-primary underline hover:text-primary/80">
                  {t("common.retry")}
                </button>
                <button type="button" onClick={startNewChat} className="text-xs text-muted-foreground underline hover:text-foreground">
                  {t("common.newChat")}
                </button>
              </div>
            </div>
          )}

          {isSessionClosed && (
            <div className="w-full rounded-lg border border-border/50 bg-muted/40 px-3 py-1.5 text-center">
              <p className="text-xs text-muted-foreground">{t("sidePanel.sessionEnded")}</p>
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
};
