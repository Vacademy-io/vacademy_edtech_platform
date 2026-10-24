"use client";

import { useEffect, useRef, useState } from "react";
import { isUntimedPlayMode } from "@/lib/untimed-play-mode";
import { readStoredPlayMode } from "@/hooks/use-stored-play-mode";
import { useTranslation } from "react-i18next";
import { QuestionDisplay } from "./question-display";
import { SectionTabs } from "./section-tabs";
import { Navbar } from "./navbar";
import { Footer } from "./footer";
import { Sidebar } from "./sidebar";
import { QuestionNavigator } from "./question-navigator";
import { LiveTestUiProvider, useLiveTestUi } from "./live-test-ui-context";
import { ExamCalculator } from "./tools/exam-calculator";
import { ExamScratchpad } from "./tools/exam-scratchpad";
import { useAssessmentStore } from "@/stores/assessment-store";
import { useLiveTestStore } from "@/stores/live-test-store";
import { cn } from "@/lib/utils";
import { useImmersiveMode } from "@/hooks/use-immersive-mode";
import { useIOSSafeAreaInsets } from "@/hooks/use-ios-safe-area-insets";
import { topSafeAreaInset } from "@/utils/safe-area";
import NetworkStatus from "./network-status";
import { Preferences } from "@capacitor/preferences";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { ASSESSMENT_SAVE } from "@/constants/urls";
import { toast } from "sonner";
import { safeParse } from "@/lib/storage";
import { ProctorLayer } from "@/components/common/proctoring/ProctorLayer";
import {
  LOCAL_SAVE_INTERVAL_MS,
  REMOTE_SAVE_INTERVAL_MS,
  REMOTE_SAVE_RETRY_ATTEMPTS,
  REMOTE_SAVE_RETRY_BASE_MS,
  REMOTE_SAVE_RETRY_MAX_MS,
} from "@/constants/assessment-timings";

export function convertToLocalDateTime(utcDate: string): string {
  if (!utcDate) return "";

  // Backend sends timestamps as UTC but sometimes omits the trailing 'Z'.
  // Force UTC interpretation when no zone marker is present.
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(utcDate);
  const normalized = hasTimezone ? utcDate : `${utcDate.replace(" ", "T")}Z`;
  const date = new Date(normalized);

  const options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };

  const formattedDate = date.toLocaleString("en-GB", options);
  return formattedDate
    .replace(",", "")
    .replace(/\s(am|pm)/i, (match) => match.toUpperCase());
}

// Function to format data from assessment-store
export const getServerStartEndTime = async () => {
  const { value } = await Preferences.get({ key: "server_start_end_time" });
  return safeParse<{ start_time?: string; end_time?: string }>(value, {});
};

export const formatDataFromStore = async (
  assessment_id: string,
  status: string
) => {
  const parsedValue = await getServerStartEndTime();
  const start_time = parsedValue.start_time
    ? new Date(parsedValue.start_time).getTime()
    : 0;

  const state = useAssessmentStore.getState();
  const attemptId = state.assessment?.attempt_id;
  // With a clock, elapsed = duration - remaining. Without one (practice,
  // survey) count from the server start time, so the report's "time taken"
  // is real instead of 0.
  const timeElapsedInSeconds = state.assessment?.duration
    ? state.assessment.duration * 60 - state.entireTestTimer
    : start_time > 0
      ? Math.max(0, Math.round((Date.now() - start_time) / 1000))
      : 0;
  const clientLastSync = new Date(
    start_time + timeElapsedInSeconds * 1000
  ).toISOString();

  return {
    attemptId: attemptId,
    clientLastSync,
    assessment: {
      assessmentId: assessment_id,
      entireTestDurationLeftInSeconds: state.entireTestTimer,
      timeElapsedInSeconds,
      status: status,
      tabSwitchCount: state.tabSwitchCount || 0,
    },
    sections: state.assessment?.section_dtos?.map((section, idx) => {
      const sectionTimeLeftSeconds = Math.round(
        (state.sectionTimers?.[idx]?.timeLeft || 0) / 1000
      );
      return {
      sectionId: section.id,
      sectionDurationLeftInSeconds: sectionTimeLeftSeconds,
      timeElapsedInSeconds: section.duration
        ? section.duration * 60 - sectionTimeLeftSeconds
        : 0,
      questions: section.question_preview_dto_list?.map((question) => {
        const rawAnswer = state.answers?.[question.question_id];
        const normalizedAnswer = Array.isArray(rawAnswer)
          ? rawAnswer[0]
          : rawAnswer;
        const codingAnswer = state.codingAnswers?.[question.question_id];

        let responseData: Record<string, unknown> = {
          type: question.question_type,
        };
        if (question.question_type === "CODING") {
          responseData = {
            type: "CODING",
            language: codingAnswer?.language || "",
            sourceCode: codingAnswer?.sourceCode || "",
            verdict: codingAnswer?.verdict || "",
            passedCount: codingAnswer?.passedCount ?? 0,
            totalCount: codingAnswer?.totalCount ?? 0,
            score: codingAnswer?.score ?? 0,
            totalTimeMs: codingAnswer?.totalTimeMs ?? 0,
            peakMemoryKb: codingAnswer?.peakMemoryKb ?? 0,
            testCaseResults: codingAnswer?.testCaseResults ?? [],
            pasteAttemptCount: codingAnswer?.pasteAttemptCount ?? 0,
          };
        } else if (question.question_type === "NUMERIC") {
          responseData = {
            type: "NUMERIC",
            validAnswer:
              normalizedAnswer !== undefined &&
              normalizedAnswer !== null &&
              !isNaN(parseFloat(normalizedAnswer))
                ? parseFloat(normalizedAnswer)
                : null,
          };
        } else if (
          ["ONE_WORD", "LONG_ANSWER"].includes(question.question_type)
        ) {
          responseData = {
            type: question.question_type,
            answer: normalizedAnswer || "",
          };
        } else {
          responseData = {
            type: question.question_type,
            optionIds: rawAnswer || [],
          };
        }

        return {
          questionId: question.question_id,
          questionDurationLeftInSeconds:
            state.questionTimers?.[question.question_id] || 0,
          timeTakenInSeconds:
            state.questionTimeSpent[question.question_id] || 0,
          isMarkedForReview:
            state.questionStates[question.question_id]?.isMarkedForReview ||
            false,
          isVisited:
            state.questionStates[question.question_id]?.isVisited || false,
          responseData,
        };
      }),
      };
    }),
  };
};

export default function Page() {
  return (
    <LiveTestUiProvider>
      <LiveTestShell />
    </LiveTestUiProvider>
  );
}

function LiveTestShell() {
  const { t } = useTranslation("questionTest");
  const { loadState, saveState, currentQuestion } = useAssessmentStore();
  const {
    settings,
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
  const [playMode, setPlayMode] = useState<string>("");
  // Read by the autosave interval, whose closure is created once.
  const playModeRef = useRef<string>("");
  const [evaluationType, setEvaluationType] = useState<string>("");
  const [assessmentIdForProctor, setAssessmentIdForProctor] = useState<string>("");
  // Latches so we show the "save failed" toast exactly once per failure streak
  // and the "recovered" toast exactly once when it clears.
  const hasShownSaveFailureToastRef = useRef(false);

  const sendFormattedData = async () => {
    const state = useAssessmentStore.getState();
    state.setRemoteSaveStatus("saving");
    const InstructionID_and_AboutID = await Preferences.get({
      key: "InstructionID_and_AboutID",
    });

    const assessment_id_json = safeParse<{ assessment_id?: string } | null>(
      InstructionID_and_AboutID.value,
      null
    );
    const formattedData = await formatDataFromStore(
      assessment_id_json?.assessment_id ?? "",
      "LIVE"
    );

    let lastError: unknown;
    for (let attempt = 0; attempt < REMOTE_SAVE_RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await authenticatedAxiosInstance.post(
          `${ASSESSMENT_SAVE}`,
          { json_content: JSON.stringify(formattedData) },
          {
            params: {
              attemptId: state.assessment?.attempt_id,
              assessmentId: assessment_id_json?.assessment_id,
            },
          }
        );

        // Save announcements in local storage
        await Preferences.set({
          key: "announcements",
          value: JSON.stringify(response.data),
        });

        state.setRemoteSaveStatus("success");
        return response.data;
      } catch (error) {
        lastError = error;
        const isLastAttempt = attempt === REMOTE_SAVE_RETRY_ATTEMPTS - 1;
        if (isLastAttempt) break;
        const delay = Math.min(
          REMOTE_SAVE_RETRY_BASE_MS * 2 ** attempt,
          REMOTE_SAVE_RETRY_MAX_MS
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    state.setRemoteSaveStatus("failed");
    console.error("Error sending data after retries:", lastError);
    throw lastError;
  };

  const { isSubmitted } = useAssessmentStore();

  useEffect(() => {
    const sendData = async () => {
      try {
        await sendFormattedData();
        if (hasShownSaveFailureToastRef.current) {
          hasShownSaveFailureToastRef.current = false;
          toast.success(t("page.toast.savingResumed"));
        }
      } catch (error) {
        console.error("Error in periodic data sending:", error);
        // Only toast on the first failure in a streak — the persistent
        // NetworkStatus banner keeps the user informed after that.
        if (!hasShownSaveFailureToastRef.current) {
          hasShownSaveFailureToastRef.current = true;
          toast.error(t("page.toast.savingFailed"));
        }
      }
    };

    const sent = async () => {
      // Save while the attempt is open and the clock (if it has one) is still
      // running. Practice tests and surveys have no clock, so their timer is 0
      // from the start - skipping them here left those answers unsaved.
      const state = useAssessmentStore.getState();
      if (!playModeRef.current) {
        playModeRef.current = (await readStoredPlayMode()) ?? "";
      }

      if (
        !isSubmitted &&
        (state.entireTestTimer > 0 || isUntimedPlayMode(playModeRef.current))
      ) {
        await sendData();
      }
    };

    sent();

    const interval = setInterval(() => {
      sent();
    }, REMOTE_SAVE_INTERVAL_MS);

    // Cleanup function to clear the interval
    return () => clearInterval(interval);
  }, [isSubmitted]);

  useEffect(() => {
    const initializeAssessment = async () => {
      // Check if this is a survey and we already have assessment data
      const state = useAssessmentStore.getState();
      const assessmentData = await Preferences.get({
        key: "InstructionID_and_AboutID",
      });
      const assessment = safeParse<{ play_mode?: string } | null>(
        assessmentData.value,
        null
      );

      // For surveys, only load state if we don't already have assessment data
      if (assessment?.play_mode === "SURVEY" && state.assessment && state.currentQuestion) {
        console.log("Survey assessment already initialized, skipping loadState");
        return;
      }

      await loadState();
    };

    initializeAssessment();

    const saveInterval = setInterval(() => {
      saveState();
    }, LOCAL_SAVE_INTERVAL_MS);

    return () => {
      clearInterval(saveInterval);
      saveState();
    };
  }, []);
  useEffect(() => {
    const reconcileTimer = async () => {
      if (document.hidden) return;
      const state = useAssessmentStore.getState();
      const totalDurationSeconds = state.assessment?.duration
        ? state.assessment.duration * 60
        : 0;
      if (!totalDurationSeconds) return;

      const { start_time } = await getServerStartEndTime();
      if (!start_time) return;

      const startMs = new Date(start_time).getTime();
      if (Number.isNaN(startMs)) return;

      const elapsedSeconds = Math.floor((Date.now() - startMs) / 1000);
      const remaining = Math.max(0, totalDurationSeconds - elapsedSeconds);
      state.setEntireTestTimer(remaining);
    };

    document.addEventListener("visibilitychange", reconcileTimer);
    return () => document.removeEventListener("visibilitychange", reconcileTimer);
  }, []);

  useEffect(() => {
    const fetchPlayMode = async () => {
      const storedMode = await Preferences.get({
        key: "InstructionID_and_AboutID",
      });
      const parsedData = safeParse<{
        play_mode?: string;
        evaluation_type?: string;
        assessment_id?: string;
      } | null>(storedMode.value, null);
      if (parsedData) {
        setPlayMode(parsedData.play_mode ?? "");
        playModeRef.current = parsedData.play_mode ?? "";
        setEvaluationType(parsedData.evaluation_type ?? "");
        setAssessmentIdForProctor(parsedData.assessment_id ?? "");
      }
    };

    fetchPlayMode();
  }, []);

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
      className="fixed inset-0 flex w-full flex-col overflow-hidden bg-white"
      style={{ // design-lint-ignore: dynamic safe-area inset padding
        paddingTop: topSafeAreaInset(immersiveActive),
      }}
    >
      <Navbar playMode={playMode} evaluationType={evaluationType} />
      {/* Renders nothing unless the assessment is proctored (V48). */}
      {assessmentIdForProctor && <ProctorLayer assessmentId={assessmentIdForProctor} />}
      <NetworkStatus onRetrySave={sendFormattedData} />
      <SectionTabs />

      <div className="flex min-h-0 flex-1">
        {/* Question column. The footer lives inside it so the desktop palette
            keeps its own full-height rail and its own Submit action. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <main
              ref={questionScrollRef}
              className={cn(
                "h-full overflow-auto overscroll-contain px-4 py-5 md:px-8 md:py-7",
                // Room to scroll the last option out from behind an open tool
                // panel — it is docked over the canvas, not stacked below it.
                toolPanel && "pb-tool-dock",
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
