import React, { useRef, useEffect, useCallback, useState } from "react";
import {
  X,
  Plus,
  Trash,
  Gear,
  DotsSixVertical,
  ArrowsOutSimple,
  ArrowsInSimple,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion, type MotionProps } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useChatbotContext } from "./useChatbotContext";
import { cn } from "@/lib/utils";
import { useChatbotAvatarUrl } from "@/services/chatbot-settings";
import {
  shouldShowAiSettingsShortcut,
  useAiSettingsShortcutEnabled,
} from "@/services/ai-settings-shortcut";
import { useChatbotPanelStore } from "@/stores/chatbot/useChatbotPanelStore";
import { ChatMessageList } from "./ChatMessageList";
import { ChatComposer, ImageDropOverlay } from "./ChatComposer";
import { ChatHistoryPanel, ChatHistoryToggle } from "./ChatHistoryPanel";
import { useChatAttachments, useImageDrop } from "./useChatAttachments";
import { VoiceModeSelector } from "./VoiceModeSelector";
import { VoiceModePanel } from "./VoiceModePanel";

/** The subset of session modes the call screen handles. */
type VoiceCallMode = "voice_interview" | "voice_doubt" | "voice_oral_test";

export const ChatbotSidePanel: React.FC = () => {
  const avatarUrl = useChatbotAvatarUrl();
  // Hidden from learners by default. The institute can reveal it for everyone
  // (Admin -> Settings -> AI Settings -> Student AI), and this device can
  // reveal it just for itself from /ai-settings.
  const shortcutEnabledLocally = useAiSettingsShortcutEnabled();
  const { t } = useTranslation("chatFeatureB");
  const {
    isOpen,
    startNewChat,
    closeSession,
    chatbotSettings,
    instituteName,
    sessionId,
    setIsOpen,
    shouldShowChatbot,
    voiceMode,
    voiceTopic,
    suggestedVoiceTopic,
    showVoiceSelector,
    setShowVoiceSelector,
    enterVoiceMode,
    exitVoiceMode,
    voiceLanguage,
  } = useChatbotContext();

  const showAiSettingsShortcut = shouldShowAiSettingsShortcut(
    chatbotSettings.show_ai_settings_shortcut,
    shortcutEnabledLocally
  );

  const {
    panelWidth,
    setPanelWidth,
    viewMode,
    setViewMode,
    toggleViewMode,
    setIsOpen: setStorePanelOpen,
  } = useChatbotPanelStore();

  const reduceMotion = useReducedMotion();
  const [isResizing, setIsResizing] = useState(false);
  // Past chats shown in place of the conversation.
  const [showHistory, setShowHistory] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const attachments = useChatAttachments();
  const { isDragOver, dropHandlers } = useImageDrop(attachments.addFile);

  // Handle resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      setPanelWidth(newWidth);
    },
    [isResizing, setPanelWidth],
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Add/remove resize event listeners
  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
      return () => {
        document.removeEventListener("mousemove", handleResizeMove);
        document.removeEventListener("mouseup", handleResizeEnd);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Sync store isOpen with context isOpen
  useEffect(() => {
    setStorePanelOpen(isOpen);
  }, [isOpen, setStorePanelOpen]);

  // Reopening the panel always shows the conversation.
  useEffect(() => {
    if (!isOpen) setShowHistory(false);
  }, [isOpen]);

  // Escape leaves the popup the way a backdrop click does: back to docked,
  // conversation kept. The voice picker / call screen handle their own Escape.
  useEffect(() => {
    if (!isOpen || viewMode !== "popup" || showVoiceSelector || voiceMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setViewMode("docked");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, viewMode, showVoiceSelector, voiceMode, setViewMode]);

  const handleClose = () => {
    setIsOpen(false);
    setStorePanelOpen(false);
  };

  if (!isOpen || !shouldShowChatbot()) return null;

  // Docked: slides in from the edge with a spring. Popup: grows from the
  // launcher's corner. Reduced motion: a plain fade.
  const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const entrance: MotionProps = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
    : viewMode === "popup"
      ? {
          initial: { opacity: 0, scale: 0.9 },
          animate: { opacity: 1, scale: 1 },
          transition: { type: "spring", stiffness: 320, damping: 28 },
        }
      : {
          initial: { x: isRtl ? "-100%" : "100%" },
          animate: { x: 0 },
          transition: { type: "spring", stiffness: 300, damping: 32 },
        };

  return (
    <motion.div
      {...entrance}
      ref={panelRef}
      // In the popup the wrapper decides the width; docked keeps the drag-resized width.
      style={viewMode === "popup" ? undefined : { width: panelWidth }}
      className={cn(
        "h-full flex flex-col bg-background/95 backdrop-blur-sm relative shrink-0 shadow-xl",
        viewMode === "popup"
          ? "w-full ltr:origin-bottom-right rtl:origin-bottom-left"
          : "border-s border-border/50",
        isDragOver && "ring-2 ring-inset ring-primary/50"
      )}
      {...dropHandlers}
    >
      {/* Resize Handle */}
      <div
        ref={resizeRef}
        onMouseDown={handleResizeStart}
        className={cn(
          "absolute start-0 top-0 bottom-0 w-1 cursor-ew-resize z-10",
          "hover:bg-primary/20 transition-colors",
          isResizing && "bg-primary/30",
          viewMode === "popup" && "hidden",
        )}
      >
        <div className="absolute start-0 top-1/2 -translate-y-1/2 w-4 h-8 flex items-center justify-center -ms-1.5 opacity-0 hover:opacity-100 transition-opacity">
          <DotsSixVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Header */}
      <CardHeader className="bg-gradient-to-r from-primary to-primary/90 text-primary-foreground px-3 py-2 flex flex-row items-center justify-between space-y-0 border-b border-primary/20 shrink-0">
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          <Avatar className="h-7 w-7 bg-background ring-1 ring-primary-foreground/20 shrink-0">
            {avatarUrl ? (
              <AvatarImage
                src={avatarUrl}
                alt={chatbotSettings.assistant_name}
                className="object-cover"
              />
            ) : null}
            <AvatarFallback className="text-primary font-bold text-xs bg-primary-foreground">
              {chatbotSettings.assistant_name.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold tracking-tight truncate">
              {chatbotSettings.assistant_name}
            </CardTitle>
            <p className="text-caption text-primary-foreground/70 truncate">
              {instituteName}
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center shrink-0 ms-2">
          <ChatHistoryToggle
            active={showHistory}
            onToggle={() => setShowHistory((prev) => !prev)}
            className="h-7 w-7 rounded-full text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground"
            iconClassName="h-3.5 w-3.5"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground"
            onClick={() => {
              setShowHistory(false);
              startNewChat();
            }}
            title={t("common.startNewChat")}
            aria-label={t("common.startNewChat")}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground"
            onClick={toggleViewMode}
            title={viewMode === "popup" ? t("common.dockView") : t("common.popupView")}
            aria-label={viewMode === "popup" ? t("common.dockView") : t("common.popupView")}
          >
            {viewMode === "popup" ? (
              <ArrowsInSimple className="h-3.5 w-3.5" />
            ) : (
              <ArrowsOutSimple className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground"
            onClick={() => {
              setShowHistory(false);
              closeSession();
            }}
            title={t("common.closeSession")}
            aria-label={t("common.closeSession")}
          >
            <Trash className="h-3.5 w-3.5" />
          </Button>
          {showAiSettingsShortcut && (
            <Link to="/ai-settings">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground"
                title={t("common.aiGear")}
                aria-label={t("common.aiGear")}
              >
                <Gear className="h-3.5 w-3.5" />
              </Button>
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full text-primary-foreground/80 hover:bg-destructive/80 hover:text-destructive-foreground"
            onClick={handleClose}
            title={t("common.closePanel")}
            aria-label={t("common.closePanel")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      {showHistory ? (
        <ChatHistoryPanel onDone={() => setShowHistory(false)} />
      ) : (
        <>
          <ChatMessageList className="bg-gradient-to-b from-muted/20 to-background" />

          {isDragOver && <ImageDropOverlay />}

          <ChatComposer attachments={attachments} />
        </>
      )}

      {showVoiceSelector && (
        <VoiceModeSelector
          open={showVoiceSelector}
          onClose={() => setShowVoiceSelector(false)}
          onSelect={(mode, language, topic) => {
            setShowVoiceSelector(false);
            enterVoiceMode(mode, language, topic);
          }}
          enabledModes={chatbotSettings.enabled_modes}
          defaultTopic={suggestedVoiceTopic()}
          defaultLanguage={voiceLanguage}
        />
      )}

      {voiceMode && sessionId && (
        <VoiceModePanel
          sessionId={sessionId}
          mode={voiceMode as VoiceCallMode}
          language={voiceLanguage}
          voice={chatbotSettings.voice_settings?.default_voice || "shubh"}
          onClose={exitVoiceMode}
          chatbotSettings={chatbotSettings}
          topic={voiceTopic}
        />
      )}
    </motion.div>
  );
};
