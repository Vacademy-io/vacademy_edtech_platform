"use client";

import { useEffect, useRef } from "react";
import { QuestionDisplay } from "./question-display";
import { SectionTabs } from "./section-tabs";
import { Navbar } from "./navbar";
import { Footer } from "./footer";
import { Sidebar } from "./sidebar";
import { QuestionNavigator } from "./question-navigator";
import { LiveTestUiProvider, useLiveTestUi } from "./live-test-ui-context";
import { LiveTestEngine } from "./engine/live-test-engine";
import { useLiveTestEngine } from "./engine/live-test-engine-context";
import { ExamCalculator } from "./tools/exam-calculator";
import { ExamScratchpad } from "./tools/exam-scratchpad";
import { useAssessmentStore } from "@/stores/assessment-store";
import { useLiveTestStore } from "@/stores/live-test-store";
import { cn } from "@/lib/utils";
import { useImmersiveMode } from "@/hooks/use-immersive-mode";
import { useIOSSafeAreaInsets } from "@/hooks/use-ios-safe-area-insets";
import { topSafeAreaInset } from "@/utils/safe-area";
import NetworkStatus from "./network-status";
import { QUESTION_TYPES } from "@/types/assessment";
import { ProctorLayer } from "@/components/common/proctoring/ProctorLayer";

export default function Page() {
  return (
    <LiveTestUiProvider>
      {/* Clocks, autosave, submit, proctoring and guards: mounted once and
          independent of which parts the layout below draws. */}
      <LiveTestEngine>
        <LiveTestShell />
      </LiveTestEngine>
    </LiveTestUiProvider>
  );
}

function LiveTestShell() {
  const currentQuestion = useAssessmentStore((s) => s.currentQuestion);
  const { evaluationType, assessmentId, retrySave } = useLiveTestEngine();
  const {
    settings,
    examTheme,
    isCompact,
    activeTool,
    closeTool,
    scratchpad,
    setScratchpad,
    isPaletteOpen,
    setPaletteOpen,
    isRailOpen,
    setRailOpen,
  } = useLiveTestUi();
  const setLiveTest = useLiveTestStore((s) => s.setLiveTest);
  const immersiveActive = useLiveTestStore((s) => s.immersiveActive);
  // The question area is the only scroller (see the h-dvh layout below), so it
  // keeps its offset when the question swaps — the learner would land partway
  // down the next question, often mid-options. Reset it on every change.
  const questionScrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // "auto" not "smooth": a visible scroll animation on every Next tap reads as
    // lag on low-end devices, and the learner is already looking at the top.
    questionScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [currentQuestion?.question_id]);

  // Stand down the app-level chrome (chatbot launcher, OTA banner, announcement
  // overlays) for as long as the learner is inside the attempt — see
  // `stores/live-test-store.ts` for why they can't simply be z-indexed away.
  const hideAppChrome = settings.mobile.hideAppNavigation;
  useEffect(() => {
    setLiveTest({ isActive: true, hideAppChrome });
    return () => setLiveTest({ isActive: false, hideAppChrome: false });
  }, [setLiveTest, hideAppChrome]);

  // Take Android's system bars down for the attempt — they otherwise sit on top
  // of this shell's own header and footer.
  useImmersiveMode(hideAppChrome);
  useIOSSafeAreaInsets();

  // Spreadsheet & Written Response questions own the whole question area as a
  // split screen with their own scrolling panes (desktop only; phones stack).
  const isCbeQuestion =
    currentQuestion?.question_type === QUESTION_TYPES.CBE_RESPONSE;
  const cbeSplitScreen = isCbeQuestion && !isCompact;

  // Give the spreadsheet the room: collapse the desktop rail while a CBE
  // question is open (the header toggle still brings it back), and reopen it
  // afterwards only if it was this effect that closed it.
  const railCollapsedForCbeRef = useRef(false);
  useEffect(() => {
    if (isCompact) return;
    if (isCbeQuestion) {
      if (isRailOpen) {
        railCollapsedForCbeRef.current = true;
        setRailOpen(false);
      }
    } else if (railCollapsedForCbeRef.current) {
      railCollapsedForCbeRef.current = false;
      setRailOpen(true);
    }
    // Only on entering / leaving a CBE question — not when the learner
    // reopens the rail by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCbeQuestion, isCompact]);

  const showPalette = settings.questionPalette.enabled;
  // The header's panel toggle brings a collapsed rail back (see Navbar).
  const showDesktopPalette = showPalette && !isCompact && isRailOpen;

  const toolPanel =
    activeTool === "calculator" && settings.calculator.enabled ? (
      <ExamCalculator mode={settings.calculator.mode} onClose={closeTool} />
    ) : activeTool === "scratchpad" && settings.scratchpad.enabled ? (
      <ExamScratchpad
        value={scratchpad}
        onChange={setScratchpad}
        onClose={closeTool}
      />
    ) : null;

  return (
    // fixed inset-0, not h-dvh: body carries safe-area padding, so a 100dvh child
    // starts below the top inset and overflows the screen by that much — pushing
    // the footer off the bottom, behind the Android nav bar, where it can't be
    // tapped. Positioning against the viewport ignores that padding, so the top
    // inset is re-applied here (see topSafeAreaInset). The bottom inset is
    // handled inside Footer.
    <div
      // Exam theme hooks for styles/exam-themes/*.css. "default" keeps today's
      // look; any other value also fences the app skins out (see tokens.css).
      data-exam-theme={examTheme.id}
      data-exam-theme-family={examTheme.family}
      className="fixed inset-0 flex w-full flex-col overflow-hidden bg-white"
      style={{ // design-lint-ignore: dynamic safe-area inset padding
        paddingTop: topSafeAreaInset(immersiveActive),
      }}
    >
      <Navbar />
      {/* Renders nothing unless the assessment is proctored (V48). */}
      {assessmentId && <ProctorLayer assessmentId={assessmentId} />}
      <NetworkStatus onRetrySave={retrySave} />
      <SectionTabs />

      <div className="flex min-h-0 flex-1">
        {/* Question column. The footer lives inside it so the desktop palette
            keeps its own full-height rail and its own Submit action. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <main
              ref={questionScrollRef}
              className={cn(
                cbeSplitScreen
                  ? // The CBE split view scrolls its two panes itself.
                    "h-full overflow-hidden"
                  : "h-full overflow-auto overscroll-contain px-4 py-5 md:px-8 md:py-7",
                // Room to scroll the last option out from behind an open tool
                // panel — it is docked over the canvas, not stacked below it.
                toolPanel && !cbeSplitScreen && "pb-tool-dock",
              )}
            >
              <QuestionDisplay />
            </main>

            {toolPanel && (
              <div className="pointer-events-none absolute bottom-3 end-3 start-3 z-30 flex justify-end md:start-auto">
                <div className="pointer-events-auto w-full max-w-reg-320">
                  {toolPanel}
                </div>
              </div>
            )}
          </div>

          <Footer
            onToggleSidebar={() => setPaletteOpen(true)}
            evaluationType={evaluationType}
          />
        </div>

        {showDesktopPalette && (
          <aside className="flex w-reg-320 flex-none flex-col border-s border-neutral-200">
            <QuestionNavigator
              onClose={() => {}}
              onCollapse={() => setRailOpen(false)}
              evaluationType={evaluationType}
            />
          </aside>
        )}
      </div>

      {showPalette && isCompact && (
        <Sidebar
          isOpen={isPaletteOpen}
          onClose={() => setPaletteOpen(false)}
          evaluationType={evaluationType}
        />
      )}
    </div>
  );
}
