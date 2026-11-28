import React, { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  X,
  Plus,
  Trash,
  ArrowsOut,
  ArrowsIn,
  Gear,
  DotsSixVertical,
} from "@phosphor-icons/react";
import { Capacitor } from "@capacitor/core";
import { Link } from "@tanstack/react-router";
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

interface ChatbotPanelProps {
  onOpenChange?: (isOpen: boolean) => void;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;
const DEFAULT_WIDTH = 380;
const DEFAULT_HEIGHT = 520;

export const ChatbotPanel: React.FC<ChatbotPanelProps> = ({ onOpenChange }) => {
  const avatarUrl = useChatbotAvatarUrl();
  // Hidden from learners by default. The institute can reveal it for everyone
  // (Admin -> Settings -> AI Settings -> Student AI), and this device can
  // reveal it just for itself from /ai-settings.
  const shortcutEnabledLocally = useAiSettingsShortcutEnabled();
  const { t } = useTranslation("chatFeatureB");
  const {
    isOpen,
    setIsOpen,
    startNewChat,
    closeSession,
    shouldShowChatbot,
    chatbotSettings,
    instituteName,
    sessionId,
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

  // Check if the docked panel should be used - checking store AND route for immediate detection
  const { isDockedMode } = useChatbotPanelStore();
  // Always use docked mode on desktop - the floating panel is no longer needed
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;
  const shouldUseDockedMode = isDockedMode || isDesktop;
  const isNativePlatform = Capacitor.getPlatform() === "android" || Capacitor.getPlatform() === "ios";

  // Panel dimensions and position
  const [panelSize, setPanelSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0 });
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const [hasInitializedPosition, setHasInitializedPosition] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Past chats shown in place of the conversation.
  const [showHistory, setShowHistory] = useState(false);
  const reduceMotion = useReducedMotion();
  
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, panelX: 0, panelY: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0, panelX: 0, panelY: 0 });
  
  const attachments = useChatAttachments();
  const { isDragOver, dropHandlers } = useImageDrop(attachments.addFile);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 640; // sm breakpoint
      setIsMobile(mobile);
      if (mobile && isOpen) {
        setIsFullScreen(true);
      }
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [isOpen]);

  // Initialize panel position to center of screen
  useEffect(() => {
    if (isOpen && !hasInitializedPosition) {
      // On mobile, go fullscreen immediately
      if (window.innerWidth < 640) {
        setIsFullScreen(true);
        setPanelPosition({ x: 0, y: 0 });
      } else {
        // Calculate safe dimensions for current viewport
        const safeWidth = Math.min(DEFAULT_WIDTH, window.innerWidth - 40);
        const safeHeight = Math.min(DEFAULT_HEIGHT, window.innerHeight - 40);
        setPanelSize({ width: safeWidth, height: safeHeight });
        
        const x = Math.max(20, (window.innerWidth - safeWidth) / 2);
        const y = Math.max(20, (window.innerHeight - safeHeight) / 2);
        setPanelPosition({ x, y });
      }
      setHasInitializedPosition(true);
    }
  }, [isOpen, hasInitializedPosition]);

  // Drag handling
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isFullScreen) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panelX: panelPosition.x,
      panelY: panelPosition.y,
    };
  }, [isFullScreen, panelPosition]);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;
    
    const newX = Math.max(0, Math.min(window.innerWidth - panelSize.width, dragStartRef.current.panelX + deltaX));
    const newY = Math.max(0, Math.min(window.innerHeight - panelSize.height, dragStartRef.current.panelY + deltaY));
    
    setPanelPosition({ x: newX, y: newY });
  }, [isDragging, panelSize]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Resize handling
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    if (isFullScreen) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: panelSize.width,
      height: panelSize.height,
      panelX: panelPosition.x,
      panelY: panelPosition.y,
    };
  }, [isFullScreen, panelSize, panelPosition]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeDirection) return;
    
    const deltaX = e.clientX - resizeStartRef.current.x;
    const deltaY = e.clientY - resizeStartRef.current.y;
    
    let newWidth = resizeStartRef.current.width;
    let newHeight = resizeStartRef.current.height;
    let newX = resizeStartRef.current.panelX;
    let newY = resizeStartRef.current.panelY;
    
    // Handle different resize directions
    if (resizeDirection.includes("e")) {
      newWidth = Math.max(MIN_WIDTH, resizeStartRef.current.width + deltaX);
    }
    if (resizeDirection.includes("w")) {
      const potentialWidth = resizeStartRef.current.width - deltaX;
      if (potentialWidth >= MIN_WIDTH) {
        newWidth = potentialWidth;
        newX = resizeStartRef.current.panelX + deltaX;
      }
    }
    if (resizeDirection.includes("s")) {
      newHeight = Math.max(MIN_HEIGHT, resizeStartRef.current.height + deltaY);
    }
    if (resizeDirection.includes("n")) {
      const potentialHeight = resizeStartRef.current.height - deltaY;
      if (potentialHeight >= MIN_HEIGHT) {
        newHeight = potentialHeight;
        newY = resizeStartRef.current.panelY + deltaY;
      }
    }
    
    // Constrain to viewport
    newWidth = Math.min(newWidth, window.innerWidth - newX);
    newHeight = Math.min(newHeight, window.innerHeight - newY);
    
    setPanelSize({ width: newWidth, height: newHeight });
    setPanelPosition({ x: newX, y: newY });
  }, [isResizing, resizeDirection]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    setResizeDirection(null);
  }, []);

  // Global mouse event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleDragMove);
      document.addEventListener("mouseup", handleDragEnd);
      document.body.style.userSelect = "none";
      return () => {
        document.removeEventListener("mousemove", handleDragMove);
        document.removeEventListener("mouseup", handleDragEnd);
        document.body.style.userSelect = "";
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
      document.body.style.userSelect = "none";
      return () => {
        document.removeEventListener("mousemove", handleResizeMove);
        document.removeEventListener("mouseup", handleResizeEnd);
        document.body.style.userSelect = "";
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  useEffect(() => {
    onOpenChange?.(isOpen);
    // Reopening the panel always shows the conversation.
    if (!isOpen) setShowHistory(false);
  }, [isOpen, onOpenChange]);

  // Early return if chatbot should not be shown or if docked mode is active
  if (!shouldShowChatbot() || shouldUseDockedMode) {
    return null;
  }

  // Phones open full screen (decided in an effect, so also check the width now).
  const slideUp = isFullScreen || window.innerWidth < 640;

  const toggleFullScreen = () => {
    setIsFullScreen(!isFullScreen);
  };

  // Resize handle component - only show on desktop
  const ResizeHandle = ({ direction, className }: { direction: string; className: string }) => {
    if (isMobile) return null;
    return (
      <div
        onMouseDown={(e) => handleResizeStart(e, direction)}
        className={cn(
          "absolute z-10 opacity-0 hover:opacity-100 transition-opacity",
          className,
          isResizing && resizeDirection === direction && "opacity-100"
        )}
      />
    );
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <>

            {/* Chat Panel - Floating Overlay */}
            <motion.div
              ref={panelRef}
              // Full screen (phones) slides up from the bottom; the floating
              // window grows in place. Reduced motion: a plain fade.
              initial={
                reduceMotion
                  ? { opacity: 0 }
                  : slideUp
                    ? { opacity: 1, y: "100%" }
                    : { opacity: 0, scale: 0.9 }
              }
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : slideUp
                    ? { opacity: 1, y: "100%" }
                    : { opacity: 0, scale: 0.9 }
              }
              transition={
                reduceMotion ? { duration: 0.15 } : { type: "spring", damping: 30, stiffness: 300 }
              }
              style={
                isFullScreen
                  ? isNativePlatform
                    ? { left: 0, right: 0, width: "100%", top: "2.5rem", bottom: "2.5rem" }
                    : { left: 0, top: 0, right: 0, bottom: 0, width: "100%", height: "100%" }
                  : {
                      left: panelPosition.x,
                      top: panelPosition.y,
                      width: panelSize.width,
                      height: panelSize.height,
                    }
              }
              className={cn(
                "fixed z-50 flex flex-col bg-background border border-border rounded-xl shadow-2xl overflow-hidden",
                isDragging && "cursor-grabbing",
                isFullScreen && !isNativePlatform && "rounded-none",
                isDragOver && "ring-2 ring-inset ring-primary/50"
              )}
              {...dropHandlers}
            >
              {isDragOver && <ImageDropOverlay />}

              {/* Resize Handles (hidden in fullscreen) */}
              {!isFullScreen && (
                <>
                  {/* Corner handles */}
                  <ResizeHandle direction="nw" className="top-0 start-0 w-3 h-3 cursor-nwse-resize" />
                  <ResizeHandle direction="ne" className="top-0 end-0 w-3 h-3 cursor-nesw-resize" />
                  <ResizeHandle direction="sw" className="bottom-0 start-0 w-3 h-3 cursor-nesw-resize" />
                  <ResizeHandle direction="se" className="bottom-0 end-0 w-3 h-3 cursor-nwse-resize" />
                  {/* Edge handles */}
                  <ResizeHandle direction="n" className="top-0 start-3 end-3 h-1 cursor-ns-resize" />
                  <ResizeHandle direction="s" className="bottom-0 start-3 end-3 h-1 cursor-ns-resize" />
                  <ResizeHandle direction="w" className="start-0 top-3 bottom-3 w-1 cursor-ew-resize" />
                  <ResizeHandle direction="e" className="end-0 top-3 bottom-3 w-1 cursor-ew-resize" />
                </>
              )}

              {/* Header - Draggable */}
              <CardHeader
                onMouseDown={handleDragStart}
                className={cn(
                  "bg-primary text-primary-foreground px-3 py-2 flex flex-row items-center justify-between space-y-0 border-b shrink-0",
                  !isFullScreen && "cursor-grab",
                  isDragging && "cursor-grabbing"
                )}
              >
                <div className="flex items-center space-x-2 flex-1 min-w-0">
                  {/* Drag indicator */}
                  {!isFullScreen && (
                    <DotsSixVertical className="h-4 w-4 text-primary-foreground/60 shrink-0" />
                  )}
                  <Avatar className="h-7 w-7 bg-background shrink-0">
                    {avatarUrl ? (
                      <AvatarImage
                        src={avatarUrl}
                        alt={chatbotSettings.assistant_name}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="text-primary font-bold text-xs">
                      {chatbotSettings.assistant_name
                        .substring(0, 2)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <CardTitle className="text-sm font-bold truncate">
                      {chatbotSettings.assistant_name}
                    </CardTitle>
                    <p className="text-xs text-primary-foreground/80 truncate">
                      {instituteName}
                    </p>
                  </div>
                </div>

                {/* Header Actions */}
                <div className="flex items-center space-x-0.5 shrink-0 ms-2">
                  <ChatHistoryToggle
                    active={showHistory}
                    onToggle={() => setShowHistory((prev) => !prev)}
                    className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
                    iconClassName="h-4 w-4"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
                    onClick={(e) => { e.stopPropagation(); setShowHistory(false); startNewChat(); }}
                    title={t("common.startNewChat")}
                    aria-label={t("common.startNewChat")}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
                    onClick={(e) => { e.stopPropagation(); setShowHistory(false); closeSession(); }}
                    title={t("common.closeSession")}
                    aria-label={t("common.closeSession")}
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                  {showAiSettingsShortcut && (
                    <Link to="/ai-settings" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
                        title={t("common.aiGear")}
                        aria-label={t("common.aiGear")}
                      >
                        <Gear className="h-4 w-4" />
                      </Button>
                    </Link>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
                    onClick={(e) => { e.stopPropagation(); toggleFullScreen(); }}
                    title={isFullScreen ? t("panel.exitFullscreen") : t("panel.fullscreen")}
                    aria-label={isFullScreen ? t("panel.exitFullscreen") : t("panel.fullscreen")}
                  >
                    {isFullScreen ? (
                      <ArrowsIn className="h-4 w-4" />
                    ) : (
                      <ArrowsOut className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
                    title={t("common.closePanel")}
                    aria-label={t("common.closePanel")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>

              {showHistory ? (
                <ChatHistoryPanel onDone={() => setShowHistory(false)} />
              ) : (
                <>
                  <ChatMessageList />

                  <ChatComposer attachments={attachments} />
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
    </>
  );
};
