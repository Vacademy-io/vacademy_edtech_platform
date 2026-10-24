import { useState, useEffect, useRef, useReducer, useCallback } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { ChatCircle, Sparkle, Question, BookOpen } from "@phosphor-icons/react";
import { useLocation } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { useTranslation } from "react-i18next";
import { useChatbotContext } from "./useChatbotContext";
import { useDoubtSidebarStore } from "@/stores/study-library/doubt-sidebar-store";
import { useQuizActiveStore } from "@/stores/study-library/quiz-active-store";
import { useChatbotPanelStore } from "@/stores/chatbot/useChatbotPanelStore";
import type { FabPosition, FabSide } from "@/stores/chatbot/useChatbotPanelStore";
import { cn } from "@/lib/utils";
import { useChatbotAvatarUrl } from "@/services/chatbot-settings";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { LauncherPeek } from "./LauncherPeek";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";

// Fallbacks when the institute hasn't configured launcher_settings
const DEFAULT_NUDGE_INTERVAL_S = 120; // reveal the pill once every 2 minutes
const DEFAULT_NUDGE_DURATION_S = 5; // keep it open ~5s, then collapse to the icon

// Drag-to-move tuning for the floating launcher
const DRAG_THRESHOLD = 6; // px of travel before a press counts as a drag (vs a tap)
const EDGE_MARGIN = 24; // matches end-6 / bottom-6 (1.5rem)
const BUTTON_SIZE = 56; // h-14 collapsed launcher
// A stored position is only usable if it matches the current { side, yRatio } shape
const isValidFabPosition = (p: FabPosition | null): p is FabPosition =>
  !!p && (p.side === "left" || p.side === "right") && typeof p.yRatio === "number";

export const ChatbotFloatingButton = () => {
  const avatarUrl = useChatbotAvatarUrl();
  const { t } = useTranslation("chatFeatureB");
  const { isOpen, setIsOpen, shouldShowChatbot, chatbotSettings, voiceMode } =
    useChatbotContext();
  const reduceMotion = useReducedMotion();
  const [isPeekVisible, setIsPeekVisible] = useState(false);

  const ROTATING_MESSAGES = [
    { text: t("floatingButton.nudgeMessages.doubts"), icon: Question },
    { text: t("floatingButton.nudgeMessages.learnSomething"), icon: Sparkle },
    { text: t("floatingButton.nudgeMessages.practice"), icon: BookOpen },
  ];

  // Admin-configurable launcher behavior (all default-on / previous behavior)
  const launcher = chatbotSettings.launcher_settings ?? {};
  const isDraggable = launcher.draggable !== false;
  const nudgeEnabled = launcher.nudge_enabled !== false;
  const bounceEnabled = launcher.bounce !== false;
  const nudgeIntervalMs =
    Math.max(10, launcher.nudge_interval_seconds ?? DEFAULT_NUDGE_INTERVAL_S) * 1000;
  const nudgeDurationMs =
    Math.max(1, launcher.nudge_duration_seconds ?? DEFAULT_NUDGE_DURATION_S) * 1000;

  const isDoubtSidebarOpen = useDoubtSidebarStore((state) => state.isOpen);
  const isQuizActive = useQuizActiveStore((state) => state.isActive);
  const location = useLocation();

  // Move button higher on video/slide pages to avoid overlapping player controls
  const isOnVideoPage = location.pathname.includes("/slides") || location.pathname.includes("/content");
  const isNativePlatform = Capacitor.getPlatform() === "android" || Capacitor.getPlatform() === "ios";
  // Play themes show a bottom tab bar below md (layout-container PlayBottomNav).
  const isPlayTheme = usePlayTheme();
  const isCleanerPlayTheme = useCleanerPlayTheme();
  const hasBottomTabBar = isPlayTheme || isCleanerPlayTheme;

  const [isHovered, setIsHovered] = useState(false);
  const [activeMessageIndex, setActiveMessageIndex] = useState(0);
  const [showPill, setShowPill] = useState(false);

  // ---- Drag-to-move ----------------------------------------------------
  // The launcher can be dragged anywhere; on release it snaps to the nearest
  // corner. We use window-level pointer listeners (NOT setPointerCapture, which
  // can swallow the trailing click on some WebViews) — the same document-listener
  // approach the chat panel drag uses. A plain tap opens the chat via onClick.
  const { fabPosition, setFabPosition } = useChatbotPanelStore();
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef({ startX: 0, startY: 0, originX: 0, originY: 0, moved: false });
  // Set true once a press becomes a drag, so the trailing click never opens chat
  const didDragRef = useRef(false);

  // Re-render when the viewport changes so a saved corner stays anchored
  const [, forceViewportUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const onResize = () => forceViewportUpdate();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Self-heal: if a legacy/invalid position shape survived in storage (e.g. an
  // older build stranded the button mid-screen), drop it back to the default.
  useEffect(() => {
    if (fabPosition && !isValidFabPosition(fabPosition)) {
      setFabPosition(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bottomMargin = EDGE_MARGIN + (isNativePlatform ? 40 : 0);
  const topMargin = EDGE_MARGIN + (isNativePlatform ? 40 : 0); // clear notch/status bar

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isDraggable) return; // dragging disabled by admin → tap-only launcher
    if (e.button !== 0) return; // primary button / touch / pen only
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    pressRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    didDragRef.current = false;
    setIsPressing(true);
  };

  const handleWindowMove = useCallback((e: PointerEvent) => {
    const p = pressRef.current;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    p.moved = true;
    didDragRef.current = true;
    setIsDragging(true);
    const w = wrapRef.current?.offsetWidth || BUTTON_SIZE;
    const h = wrapRef.current?.offsetHeight || BUTTON_SIZE;
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, p.originX + dx));
    const y = Math.max(4, Math.min(window.innerHeight - h - 4, p.originY + dy));
    dragPosRef.current = { x, y };
    setDragPos({ x, y });
  }, []);

  const handleWindowUp = useCallback(() => {
    const p = pressRef.current;
    const dropped = dragPosRef.current;
    if (p.moved && dropped) {
      // Snap horizontally to the nearest side edge, keep the vertical spot so it
      // can rest at any height (top, middle or bottom) — never a floating center.
      const w = wrapRef.current?.offsetWidth || BUTTON_SIZE;
      const side: FabSide = dropped.x + w / 2 < window.innerWidth / 2 ? "left" : "right";
      const yRatio = Math.min(1, Math.max(0, dropped.y / window.innerHeight));
      setFabPosition({ side, yRatio });
    }
    // A tap (no move) is opened by the button's onClick handler.
    dragPosRef.current = null;
    setDragPos(null);
    setIsDragging(false);
    setIsPressing(false);
  }, [setFabPosition]);

  // Listen on window only while a press is active (mirrors the ChatbotPanel drag)
  useEffect(() => {
    if (!isPressing) return;
    window.addEventListener("pointermove", handleWindowMove);
    window.addEventListener("pointerup", handleWindowUp);
    window.addEventListener("pointercancel", handleWindowUp);
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", handleWindowMove);
      window.removeEventListener("pointerup", handleWindowUp);
      window.removeEventListener("pointercancel", handleWindowUp);
      document.body.style.userSelect = "";
    };
  }, [isPressing, handleWindowMove, handleWindowUp]);

  const handleClick = () => {
    // Swallow the click that follows a drag; a genuine tap opens the chat
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    setIsOpen(true);
  };

  // Gentle nudge: peek the pill open on the configured interval for a few
  // seconds, then collapse back to just the icon. Stays quiet the rest of the
  // time so it doesn't distract the learner. Admin can disable it entirely.
  useEffect(() => {
    if (!nudgeEnabled) {
      setShowPill(false);
      return;
    }
    let hideTimeout: NodeJS.Timeout | undefined;
    const reveal = () => {
      setShowPill(true);
      hideTimeout = setTimeout(() => {
        setShowPill(false);
        // Rotate to the next message for the following reveal
        setActiveMessageIndex((prev) => (prev + 1) % ROTATING_MESSAGES.length);
      }, nudgeDurationMs);
    };
    const interval = setInterval(reveal, nudgeIntervalMs);
    return () => {
      clearInterval(interval);
      if (hideTimeout) clearTimeout(hideTimeout);
    };
  }, [nudgeEnabled, nudgeIntervalMs, nudgeDurationMs]);


  const isTutorRoute = location.pathname.includes("/course-details/tutor");
  // The launcher peek only speaks while the launcher is idle on screen.
  const peekEnabled =
    !isOpen && !voiceMode && !isDoubtSidebarOpen && !isTutorRoute && !isDragging && shouldShowChatbot();

  if (!shouldShowChatbot()) {
    return null;
  }

  // The Live AI Tutor is its own conversation: no second assistant on screen.
  if (isTutorRoute) {
    return null;
  }

  // Hide the floating button when the panel is open
  if (isOpen) {
    return null;
  }

  // Hide the floating button while the doubt sidebar is open so it never
  // covers the doubt submit controls in the bottom-right corner
  if (isDoubtSidebarOpen) {
    return null;
  }

  const CurrentIcon = ROTATING_MESSAGES[activeMessageIndex].icon;

  // Don't expand the launcher (hover/pill) while it's being dragged
  // The pill only expands on the 2-minute timer (showPill) — deliberately NOT on
  // hover, so it can't get stuck open under the cursor / a stale touch-hover.
  const isExpanded = showPill && !isDragging && !isPeekVisible;

  // Only honor a saved position when dragging is enabled and it matches the
  // current { side, yRatio } shape; otherwise fall back to the default corner.
  const savedPosition =
    isDraggable && isValidFabPosition(fabPosition) ? fabPosition : null;

  // Resolve where the launcher renders: a live drag follows the pointer; a saved
  // edge position parks it there; otherwise the default docked bottom-right.
  const hasCustomPosition = dragPos !== null || savedPosition !== null;
  let positionStyle: CSSProperties | undefined;
  let alignEnd = true; // right-anchored → align children to the right edge
  if (dragPos) {
    positionStyle = { left: dragPos.x, top: dragPos.y };
    alignEnd = false;
  } else if (savedPosition) {
    // Clamp the vertical spot so it never tucks under the notch or off the bottom
    const y = Math.min(
      window.innerHeight - BUTTON_SIZE - bottomMargin,
      Math.max(topMargin, savedPosition.yRatio * window.innerHeight)
    );
    const isLeft = savedPosition.side === "left";
    positionStyle = {
      ...(isLeft ? { left: EDGE_MARGIN } : { right: EDGE_MARGIN }),
      top: y,
    };
    alignEnd = !isLeft;
  }

  const peekBelow = !dragPos && !!savedPosition && savedPosition.yRatio < 0.35;

  return (
    <div
      style={positionStyle}
      className={cn(
        "fixed z-50 flex flex-col gap-3 pointer-events-none",
        alignEnd ? "items-end" : "items-start",
        // Default docked position (only when the user hasn't moved the launcher)
        !hasCustomPosition && "end-6",
        !hasCustomPosition &&
          // While a quiz is being taken, float higher so the button never covers
          // the quiz Next/Finish controls in the bottom-right corner
          (isQuizActive ? "bottom-40" : isOnVideoPage ? "bottom-20" : "bottom-6"),
        !hasCustomPosition && !isQuizActive && hasBottomTabBar && "max-md:bottom-24",
        !hasCustomPosition && isNativePlatform && "mb-10"
      )}
    >
      {/* Out of the flow, so the bubble never moves the launcher; below it
          when the launcher was parked near the top of the screen. */}
      <div
        className={cn(
          "absolute",
          peekBelow ? "top-full mt-3" : "bottom-full mb-3",
          alignEnd ? "end-0" : "start-0",
        )}
      >
        <LauncherPeek
          enabled={peekEnabled}
          alignEnd={alignEnd}
          below={peekBelow}
          onVisibleChange={setIsPeekVisible}
        />
      </div>

      <motion.div
        ref={wrapRef}
        className="pointer-events-auto relative"
        // Bounce the whole launcher while the nudge pill is showing, to catch
        // the eye — only when enabled and not mid-drag.
        animate={isExpanded && bounceEnabled && !reduceMotion ? { y: [0, -12, 0, -6, 0] } : { y: 0 }}
        transition={
          isExpanded && bounceEnabled && !reduceMotion
            ? { duration: 1, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.6 }
            : { duration: 0.25 }
        }
      >
          {/* Pulsing Glow Ring - draws attention */}
          <motion.div
            className="absolute inset-0 rounded-full bg-primary/30"
            animate={{
              scale: isDragging || reduceMotion ? 1 : [1, 1.3, 1],
              opacity: isDragging || reduceMotion ? 0 : [0.6, 0, 0.6],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />

          {/* Main Button — tap to open, drag to move */}
          <motion.button
            // Disable layout animation while dragging so the button tracks the
            // pointer 1:1 instead of spring-lagging as the parent repositions
            layout={!isDragging}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onPointerDown={handlePointerDown}
            onClick={handleClick}
            title={isDraggable ? t("floatingButton.tooltip.draggable") : t("floatingButton.tooltip.tapOnly")}
            className={cn(
              // touch-none stops a touch-drag from scrolling the page underneath;
              // select-none stops the iOS long-press text-selection/callout
              "relative h-14 shadow-2xl flex items-center justify-center focus:outline-none overflow-hidden group touch-none select-none",
              isDragging ? "cursor-grabbing" : "cursor-pointer",
              avatarUrl ? "rounded-full bg-background p-0" : "rounded-full bg-primary text-primary-foreground"
            )}
            initial={{ width: 56 }} // w-14
            animate={{
              width: isExpanded ? "auto" : 56,
              scale: isDragging ? 1.1 : isHovered ? 1.05 : 1
            }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
             <div className="flex items-center px-1">
                {/* Avatar / Icon Container */}
                <div className="w-14 h-14 flex items-center justify-center shrink-0">
                  {avatarUrl ? (
                    <motion.div
                        className="w-full h-full p-0.5"
                        animate={{ rotate: isExpanded ? 360 : 0 }}
                        transition={{ duration: 0.5 }}
                    >
                      <img
                        src={avatarUrl}
                        alt={chatbotSettings.assistant_name}
                        draggable={false}
                        // route long-press/pointer to the button so iOS shows no
                        // image save/copy callout mid-drag
                        className="w-full h-full object-cover rounded-full border-2 border-primary/20 pointer-events-none select-none"
                      />
                    </motion.div>
                  ) : (
                    <motion.div
                       key={activeMessageIndex}
                       initial={{ scale: 0.5, opacity: 0 }}
                       animate={{ scale: 1, opacity: 1 }}
                       transition={{ duration: 0.2 }}
                    >
                        {/* Show specific icon for the message if showing pill, else default icon */}
                        {isExpanded ? <CurrentIcon className="h-7 w-7" /> : <ChatCircle className="h-7 w-7" />}
                    </motion.div>
                  )}
                </div>

                {/* Text Label (Truncated in idle, reveals in expanded) */}
                <AnimatePresence mode="wait">
                  {isExpanded && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: "auto" }}
                      exit={{ opacity: 0, width: 0 }}
                      className="whitespace-nowrap font-medium pe-5 ps-1 overflow-hidden h-full flex items-center"
                    >
                      {ROTATING_MESSAGES[activeMessageIndex].text}
                    </motion.span>
                  )}
                </AnimatePresence>
             </div>
          </motion.button>
          
          {/* Notification Dot (Optional - just visual flair) */}
          <motion.div
            className="absolute top-0 end-0 w-3 h-3 bg-danger-500 rounded-full border-2 border-background z-10"
            initial={{ scale: 0 }}
            animate={{ scale: isExpanded ? 0 : 1 }}
          />
      </motion.div>
    </div>
  );
};
