"use client";

import type React from "react";

import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { HelpModal } from "@/components/modals/help-modals";
import { useAssessmentStore } from "@/stores/assessment-store";
import { SubmitModal } from "@/components/modals/submit-modal";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Question,
  UploadSimple,
  FileText,
  Clock,
  CloudCheck,
  ArrowsClockwise,
  WarningCircle,
  Calculator as CalculatorIcon,
  PencilSimple,
  SidebarSimple,
} from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { cn } from "@/lib/utils";
import { useLiveTestUi } from "./live-test-ui-context";
import { TimesUpModal } from "@/components/modals/times-up-modal";
import { isUntimedPlayMode } from "@/lib/untimed-play-mode";
import { ASSESSMENT_SUBMIT, ASSESSMENT_SUBMIT_MANUAL } from "@/constants/urls";
import { getPackageSessionId } from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import {
  readSlideReturnContext,
  clearSlideReturnContext,
  markAssessmentSlideComplete,
  buildSlideReturnUrl,
} from "../study-library/level-material/subject-material/module-material/chapter-material/slide-material/assessment-slide-return";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { Preferences } from "@capacitor/preferences";
import { toast } from "sonner";
import { Storage } from "@capacitor/storage";
import { useProctoring } from "@/hooks";
import { registerBackGuard } from "@/lib/back-guard";
// import { formatDataFromStore } from "./page";
import { useFileUpload } from "@/hooks/use-file-upload";
// import { PdfViewerComponent } from "@/components/pdf-viewer"
import type {
  DocumentLoadEvent,
  PageChangeEvent,
} from "@react-pdf-viewer/core";
import { PdfViewerComponent } from "../study-library/level-material/subject-material/module-material/chapter-material/slide-material/pdf-viewer-component";
import { getServerStartEndTime } from "./page";

/** Save-state pill shown beside the assessment name. */
function AutoSaveStatus({
  status,
  compact,
}: {
  status: "idle" | "saving" | "success" | "failed";
  compact?: boolean;
}) {
  const { t } = useTranslation("questionTest");
  const map = {
    idle: {
      Icon: CloudCheck,
      label: t("navbar.autoSave.saved"),
      tone: "text-neutral-500",
    },
    success: {
      Icon: CloudCheck,
      label: t("navbar.autoSave.saved"),
      tone: "text-neutral-500",
    },
    saving: {
      Icon: ArrowsClockwise,
      label: t("navbar.autoSave.saving"),
      tone: "text-neutral-500",
    },
    failed: {
      Icon: WarningCircle,
      label: t("navbar.autoSave.notSaved"),
      tone: "text-danger-600",
    },
  } as const;
  const { Icon, label, tone } = map[status];
  return (
    <span
      className={cn("flex items-center gap-1.5 text-2xs font-medium", tone)}
      role="status"
      aria-live="polite"
    >
      <Icon
        size={compact ? 13 : 14}
        weight="duotone"
        className={cn("flex-none", status === "saving" && "animate-spin")}
      />
      {label}
    </span>
  );
}

export function Navbar({
  playMode,
  evaluationType,
}: {
  playMode: string;
  evaluationType: string;
}) {
  const { t } = useTranslation("questionTest");
  const {
    settings,
    isCompact,
    activeTool,
    toggleTool,
    isRailOpen,
    setRailOpen,
    submitRequestId,
  } = useLiveTestUi();
  const {
    assessment,
    isSubmitted,
    submitAssessment,
    updateEntireTestTimer,
    tabSwitchCount,
    incrementTabSwitchCount,
    proctorAutoSubmitRequested,
    entireTestTimer,
    setEntireTestTimer,
    resetAssessment,
    setPdfFile,
    pdfFile,
    currentQuestion,
  } = useAssessmentStore();
  const remoteSaveStatus = useAssessmentStore((s) => s.remoteSaveStatus);

  const navigate = useNavigate();
  const [assessmentName, setAssessmentName] = useState("");
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showTimesUpModal, setShowTimesUpModal] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [showExitWarningModal, setShowExitWarningModal] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAutoSubmittedRef = useRef(false);

  const [isUploading, setIsUploading] = useState(false);

  const { uploadFile, getPublicUrl } = useFileUpload();

  const [INSTITUTE_ID, setInstituteId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [pdfDocumentInfo, setPdfDocumentInfo] = useState({
    numPages: 0,
    currentPage: 0,
  });

  const formatDataFromStore = async (
    assessment_id: string,
    status: string,
    evaluationType: string,
    fileId: string,
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
      start_time + timeElapsedInSeconds * 1000,
    ).toISOString();

    const base = {
      attemptId,
      ...(evaluationType === "MANUAL" && {
        fileId: fileId,
        setId: "ggcgc",
      }),
      clientLastSync,
      assessment: {
        assessmentId: assessment_id,
        entireTestDurationLeftInSeconds: state.entireTestTimer,
        timeElapsedInSeconds,
        status,
        tabSwitchCount: state.tabSwitchCount || 0,
      },
      sections: state.assessment?.section_dtos?.map((section, idx) => ({
        sectionId: section.id,
        sectionDurationLeftInSeconds: state.sectionTimers?.[idx]?.timeLeft || 0,
        timeElapsedInSeconds: section.duration
          ? (state.sectionTimers?.[idx]?.timeLeft || 0) - section.duration * 60
          : 0,
        questions: section.question_preview_dto_list?.map((question) => {
          const rawAnswer = state.answers?.[question.question_id];
          const normalizedAnswer = Array.isArray(rawAnswer)
            ? rawAnswer[0]
            : rawAnswer;

          const baseQuestionData = {
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
          };

          // Submit the response payload whenever the assessment is AUTO, OR
          // it's MANUAL but no PDF was uploaded (e.g. CODING-only assessment).
          const codingAnswer = state.codingAnswers?.[question.question_id];
          const includeResponse =
            evaluationType !== "MANUAL" || !pdfFile;
          if (includeResponse) {
            let responseData: Record<string, unknown>;
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
            return { ...baseQuestionData, responseData };
          } else {
            return baseQuestionData;
          }
        }),
      })),
    };

    return base;
  };

  useEffect(() => {
    const fetchInstituteAndUserId = async () => {
      const instituteResult = await Preferences.get({ key: "InstituteId" });
      setInstituteId(instituteResult.value || null);

      const userResult = await Preferences.get({ key: "StudentDetails" });
      const userDetails = userResult.value
        ? JSON.parse(userResult.value)
        : null;
      setUserId(userDetails?.user_id || null);

      // Paper title for the header. Lives in the same storage blob the start
      // flow writes; the live-test store only carries the question payload.
      const stored = await Preferences.get({ key: "InstructionID_and_AboutID" });
      if (stored.value) {
        try {
          setAssessmentName(JSON.parse(stored.value)?.name ?? "");
        } catch {
          setAssessmentName("");
        }
      }
    };

    fetchInstituteAndUserId();
  }, []);

  // The question palette's "Submit paper" button routes here rather than
  // re-implementing submission — this component owns the modal and retry loop.
  useEffect(() => {
    if (submitRequestId > 0) setShowSubmitModal(true);
  }, [submitRequestId]);

  interface HelpType {
    type: "instructions" | "alerts" | "reattempt" | "time" | null;
  }
  const { fullScreen } = useProctoring({
    forceFullScreen: true,
    preventTabSwitch: true,
    preventContextMenu: true,
    preventUserSelection: true,
    preventCopy: true,
  });

  const [helpType, setHelpType] = useState<HelpType["type"]>(null);

  const sendFormattedData = async () => {
    const state = useAssessmentStore.getState();
    const InstructionID_and_AboutID = await Preferences.get({
      key: "InstructionID_and_AboutID",
    });

    const assessment_id_json = InstructionID_and_AboutID.value
      ? JSON.parse(InstructionID_and_AboutID.value)
      : null;
    const formattedData = await formatDataFromStore(
      assessment_id_json?.assessment_id,
      "END",
      evaluationType ?? "",
      pdfFile?.fileId ?? "",
    );
    console.log("evaluationType", evaluationType, "pdfFile", pdfFile);
    if (evaluationType === "MANUAL" && pdfFile) {
      console.log("Submitting manual assessment with PDF file:", pdfFile);
      const response = await authenticatedAxiosInstance.post(
        `${ASSESSMENT_SUBMIT_MANUAL}`,
        {
          json_content: JSON.stringify(formattedData),
          set_id: pdfFile.fileId,
        },
        {
          params: {
            attemptId: state.assessment?.attempt_id,
            assessmentId: assessment_id_json?.assessment_id,
            instituteId: INSTITUTE_ID,
          },
        },
      );
      console.log("response of manual", response);
      if (response?.data) {
        const { value } = await Storage.get({ key: "Assessment_questions" });

        if (value) {
          try {
            const parsedData = JSON.parse(value);
            const attemptId = parsedData?.attempt_id;

            if (attemptId) {
              const storageKey = `ASSESSMENT_STATE_${attemptId}`;
              await Storage.remove({ key: storageKey });
            } else {
              console.error("Attempt ID not found in Assessment_questions.");
            }
          } catch (error) {
            console.error("Error parsing Assessment_questions:", error);
          }
        } else {
          console.error("No data found in Assessment_questions.");
        }
      }

      return response?.data;
    } else if (
      evaluationType === "AUTO" ||
      (evaluationType === "MANUAL" && !pdfFile)
    ) {
      // Fallback: MANUAL assessments without a PDF (e.g. CODING-only or any
      // live-answer-only assessment) submit through the AUTO endpoint. The
      // per-question evaluationType still controls whether each question is
      // auto-scored or sits PENDING for evaluator override.
      const response = await authenticatedAxiosInstance.post(
        `${ASSESSMENT_SUBMIT}`,
        { json_content: JSON.stringify(formattedData) },
        {
          params: {
            attemptId: state.assessment?.attempt_id,
            assessmentId: assessment_id_json?.assessment_id,
          },
        },
      );

      if (response?.data) {
        const { value } = await Storage.get({ key: "Assessment_questions" });

        if (value) {
          try {
            const parsedData = JSON.parse(value);
            const attemptId = parsedData?.attempt_id;

            if (attemptId) {
              const storageKey = `ASSESSMENT_STATE_${attemptId}`;
              await Storage.remove({ key: storageKey });
            } else {
              console.error("Attempt ID not found in Assessment_questions.");
            }
          } catch (error) {
            console.error("Error parsing Assessment_questions:", error);
          }
        } else {
          console.error("No data found in Assessment_questions.");
        }
      }

      return response?.data;
    }
  };

  useEffect(() => {
    // Bail out until the assessment has loaded. `handleSubmit` is declared
    // below the `if (!assessment) return null` early-return, so on a render
    // where `assessment` is still null that const is never initialized — calling
    // it here would throw "Cannot access 'handleSubmit' before initialization".
    if (!assessment) return;
    if (
      evaluationType !== "MANUAL" &&
      (tabSwitchCount >= 3 || proctorAutoSubmitRequested)
    ) {
      setShowSubmitModal(true);
      handleSubmit();
    }
  }, [tabSwitchCount, proctorAutoSubmitRequested, evaluationType, assessment]);

  useEffect(() => {
    // Native back (Android hardware/gesture). We register a guard rather than our
    // own listener: Capacitor runs every backButton listener and ignores the
    // return value, so the global one in __root would still have navigated to the
    // dashboard underneath this modal.
    const unregisterBackGuard = registerBackGuard(() => {
      setShowExitWarningModal(true);
      return true; // consumed — __root must not navigate
    });

    // Browser/PWA back. beforeunload does not fire on an in-app route change, so
    // trap popstate: park an extra history entry and immediately re-park it every
    // time the learner pops it, which leaves them on the test with a warning.
    const trapHistoryEntry = () => {
      window.history.pushState(
        { liveTestGuard: true },
        "",
        window.location.href,
      );
    };
    trapHistoryEntry();

    const handlePopState = () => {
      setShowExitWarningModal(true);
      trapHistoryEntry();
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        incrementTabSwitchCount();
        setShowWarningModal(true);
      }
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      unregisterBackGuard();
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const updateEntireTimeLeft = () => {
      const { entireTestTimer } = useAssessmentStore.getState();
      setEntireTestTimer(entireTestTimer);
    };

    updateEntireTimeLeft();
    const timer = setInterval(() => {
      updateEntireTestTimer();
      updateEntireTimeLeft();
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Guard against the uninitialized-assessment render: when `assessment` is
    // null the component early-returns above the `const handleSubmit`
    // declaration, leaving it in the temporal dead zone. Without this guard the
    // effect fires (entireTestTimer defaults to 0, so it isn't > 0) and calls
    // `handleSubmit()` -> "Cannot access 'handleSubmit' before initialization".
    // It's also semantically correct: never auto-submit a test that hasn't
    // loaded. `setAssessment` sets `assessment` and `entireTestTimer` together,
    // so a loaded assessment always has entireTestTimer > 0 here.
    if (!assessment) return;
    if (evaluationType === "MANUAL") return;
    // The play mode arrives from storage a beat after the assessment; until it
    // is known, a timer at 0 cannot be told apart from "no clock at all".
    if (!playMode) return;
    // A practice test or survey has no clock; its timer sits at 0 from the
    // start (no duration), which is not "time's up".
    if (isUntimedPlayMode(playMode)) return;
    if (isSubmitted) return;
    if (entireTestTimer > 0) return;
    if (hasAutoSubmittedRef.current) return;

    hasAutoSubmittedRef.current = true;
    setShowTimesUpModal(true);
    void handleSubmit();
  }, [entireTestTimer, evaluationType, isSubmitted, assessment, playMode]);

  const formatTime = (timeInSeconds: number) => {
    const hours = Math.floor(timeInSeconds / 3600);
    const minutes = Math.floor((timeInSeconds % 3600) / 60);
    const seconds = timeInSeconds % 60;

    const padNumber = (num: number) => num.toString().padStart(2, "0");

    return `${padNumber(hours)}:${padNumber(minutes)}:${padNumber(seconds)}`;
  };

  if (!assessment) return null;

  // const isAllTimeUp = entireTestTimer === 0;

  const handleSubmit = async () => {
    const state = useAssessmentStore.getState();
    const attemptId = state.assessment?.attempt_id;

    if (!attemptId) {
      console.error("Attempt ID is missing. Cannot proceed with submission.");
      toast.error(t("navbar.toast.missingAttemptId"));
      throw new Error("Attempt ID missing");
    }

    const MAX_ATTEMPTS = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const data = await sendFormattedData();
        if (!data) {
          throw new Error("Submission returned no data");
        }

        submitAssessment();
        toast.success(t("navbar.toast.submitSuccess"));
        resetAssessment();

        // Clean up attempt-scoped local storage before navigating away.
        try {
          const { value } = await Storage.get({ key: "Assessment_questions" });
          if (value) {
            const parsedData = JSON.parse(value);
            const innerAttemptId = parsedData?.attempt_id;
            if (innerAttemptId) {
              await Storage.remove({
                key: `ASSESSMENT_STATE_${innerAttemptId}`,
              });
            }
          }
        } catch (cleanupError) {
          console.error("Error cleaning assessment storage:", cleanupError);
        }

        if (document.fullscreenElement) {
          await document.exitFullscreen().catch(() => {});
        }

        // If this assessment was launched from a study-library slide, return
        // the learner to that slide instead of the assessment list, and mark
        // the slide complete so the chapter tree shows progress.
        const returnContext = await readSlideReturnContext();
        if (returnContext?.returnSlideId) {
          // chapterId/moduleId/subjectId ride along in the captured
          // returnSearch (the study-library slide route's query string);
          // packageSessionId isn't part of that URL, so resolve it the same
          // way the rest of study-library does.
          const returnSearchParams = new URLSearchParams(
            returnContext.returnSearch,
          );
          const packageSessionId = await getPackageSessionId();
          await markAssessmentSlideComplete(
            returnContext.returnSlideId,
            attemptId,
            pdfFile?.fileId,
            {
              chapterId: returnSearchParams.get("chapterId") || undefined,
              moduleId: returnSearchParams.get("moduleId") || undefined,
              subjectId: returnSearchParams.get("subjectId") || undefined,
              packageSessionId: packageSessionId || undefined,
            },
          );
          await clearSlideReturnContext();
          // Use a raw URL string here — the captured pathname + search lives
          // outside TanStack's typed route table, so we don't try to
          // type-check it via navigate(). `window.location.assign` performs a
          // hard navigation which is exactly what we want after exiting the
          // fullscreen proctoring shell.
          window.location.assign(buildSlideReturnUrl(returnContext));
        } else {
          navigate({
            to: "/assessment/examination",
            replace: true,
          });
        }

        return;
      } catch (err) {
        lastError = err;
        console.error(
          `Submission attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
          err,
        );
        if (attempt < MAX_ATTEMPTS) {
          toast.error(
            t("navbar.toast.retrying", { attempt, max: MAX_ATTEMPTS }),
          );
          const delay = 3000 * attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    toast.error(t("navbar.toast.submitFailed"));
    throw lastError;
  };

  const handleDocumentLoad = (e: DocumentLoadEvent) => {
    setPdfDocumentInfo((prev) => ({
      ...prev,
      numPages: e.doc.numPages,
    }));
    console.log("pdfDocumentInfo", pdfDocumentInfo);
  };

  const handlePageChange = (e: PageChangeEvent) => {
    setPdfDocumentInfo((prev) => ({
      ...prev,
      currentPage: e.currentPage,
    }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const fileId = await uploadFile({
        file,
        setIsUploading,
        userId: userId ?? "",
        source: INSTITUTE_ID ?? undefined,
        sourceId: "EVALUATIONS",
      });

      if (fileId) {
        const publicUrl = await getPublicUrl(fileId);
        console.log("Public URL:", publicUrl);
        console.log("File ID:", fileId);
        setPdfFile({
          fileId,
          fileName: file.name,
          fileUrl: publicUrl,
          size: file.size,
          file: file,
        });
        // Open the preview automatically so the learner can verify their
        // uploaded response right away before submitting.
        setShowPdfPreview(true);
      }
    } catch (error) {
      console.error("PDF Upload failed:", error);
    } finally {
      setIsUploading(false);
    }
  };

  const handlePreviewPdf = () => {
    if (pdfFile) {
      setShowPdfPreview(true);
    }
  };

  // useEffect(()=>{

  //   if (isAllTimeUp && !showTimesUpModal) {
  //     setShowTimesUpModal(true);
  //   }
  // }, []);

  const showTimer =
    playMode !== "PRACTICE" && playMode !== "SURVEY" && entireTestTimer > 0;
  const totalSeconds = (assessment.duration || 0) * 60;
  const remainingFraction = totalSeconds ? entireTestTimer / totalSeconds : 1;
  const timerTone =
    remainingFraction <= 0.05
      ? "border-danger-200 bg-danger-50 text-danger-600"
      : remainingFraction <= 0.15
        ? "border-warning-200 bg-warning-50 text-warning-700"
        : "border-neutral-200 bg-neutral-100 text-neutral-800";

  const isManualUpload =
    evaluationType === "MANUAL" && currentQuestion?.question_type !== "CODING";
  // Tools live in the header on desktop and in the footer's tool menu on a
  // phone, where header width is reserved for the timer and Submit.
  const showHeaderTools = !isCompact;
  // The question rail's own close button only hides it; this is the one place
  // that brings it back, so it stays in the header regardless of rail state.
  const showRailToggle = !isCompact && settings.questionPalette.enabled;

  return (
    <>
      <header className="flex h-14 flex-none items-center gap-2 border-b border-neutral-200 bg-white px-3 md:h-16 md:gap-4 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0">
            {assessmentName && (
              <p className="truncate text-caption font-semibold text-neutral-900 md:text-body">
                {assessmentName}
              </p>
            )}
            <AutoSaveStatus status={remoteSaveStatus} compact={isCompact} />
          </div>
        </div>

        {showTimer && (
          <div
            title={t("navbar.timer.title")}
            className={cn(
              "flex flex-none items-center gap-1.5 rounded-lg border px-2 py-1.5 md:px-3",
              timerTone,
            )}
          >
            <Clock size={15} weight="duotone" className="flex-none" />
            <span className="font-mono text-caption font-semibold tabular-nums md:text-body">
              {formatTime(entireTestTimer)}
            </span>
          </div>
        )}

        <div className="flex flex-none items-center gap-1.5 md:gap-2">
          {showHeaderTools && settings.calculator.enabled && (
            <Button
              variant="outline"
              size="icon"
              aria-label={t("common.tools.calculator")}
              aria-pressed={activeTool === "calculator"}
              onClick={() => toggleTool("calculator")}
              className={cn(
                "size-9 border-neutral-200",
                activeTool === "calculator" &&
                  "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white",
              )}
            >
              <CalculatorIcon size={17} />
            </Button>
          )}
          {showHeaderTools && settings.scratchpad.enabled && (
            <Button
              variant="outline"
              size="icon"
              aria-label={t("common.tools.scratchpad")}
              aria-pressed={activeTool === "scratchpad"}
              onClick={() => toggleTool("scratchpad")}
              className={cn(
                "size-9 border-neutral-200",
                activeTool === "scratchpad" &&
                  "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white",
              )}
            >
              <PencilSimple size={17} />
            </Button>
          )}

          {showRailToggle && (
            <Button
              variant="outline"
              size="icon"
              aria-label={
                isRailOpen
                  ? t("navbar.questionPanel.hide")
                  : t("navbar.questionPanel.show")
              }
              title={
                isRailOpen
                  ? t("navbar.questionPanel.hide")
                  : t("navbar.questionPanel.show")
              }
              aria-pressed={isRailOpen}
              onClick={() => setRailOpen(!isRailOpen)}
              className="size-9 border-neutral-200"
            >
              {/* Open is the default, so it reads as weight (like ViewToggle)
                  rather than the filled "tool active" treatment next door.
                  The glyph draws its bar on the start side; the rail is on
                  the end. */}
              <SidebarSimple
                size={17}
                weight={isRailOpen ? "fill" : "regular"}
                className="-scale-x-100 rtl:scale-x-100"
              />
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("navbar.help.ariaLabel")}
                className="size-9 border-neutral-200"
              >
                <Question size={17} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setHelpType("instructions")}>
                {t("navbar.help.menu.instructions")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHelpType("alerts")}>
                {t("navbar.help.menu.alerts")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHelpType("reattempt")}>
                {t("navbar.help.menu.reattempt")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHelpType("time")}>
                {t("navbar.help.menu.timeIncrease")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {isManualUpload ? (
            <>
              <input
                type="file"
                ref={fileInputRef}
                accept="application/pdf"
                onChange={handleFileUpload}
                className="hidden"
              />

              {pdfFile ? (
                <MyButton
                  scale="small"
                  buttonType="secondary"
                  layoutVariant="default"
                  onClick={handlePreviewPdf}
                  className="flex h-9 items-center gap-2 px-3"
                >
                  <FileText className="size-4" />
                  <span className="hidden md:inline">
                    {t("navbar.pdf.preview")}
                  </span>
                </MyButton>
              ) : (
                <MyButton
                  scale="small"
                  buttonType="primary"
                  layoutVariant="default"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-9 items-center gap-2 px-3"
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <span className="loader size-4"></span>
                  ) : (
                    <UploadSimple className="size-4" />
                  )}
                  {isUploading
                    ? t("navbar.pdf.uploading")
                    : t("navbar.pdf.upload")}
                </MyButton>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowSubmitModal(true)}
              className="h-9 rounded-lg bg-neutral-900 px-4 text-caption font-semibold text-white transition-colors hover:bg-neutral-800 md:text-body"
            >
              {t("common.submit")}
            </button>
          )}
        </div>
      </header>

      {showPdfPreview && pdfFile ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-5xl h-screen-90 flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              {/* <h2 className="text-lg font-semibold">
                PDF Preview: {pdfFile.fileName} {pdfDocumentInfo.currentPage + 1}/{pdfDocumentInfo.numPages}
              </h2> */}
              <Button variant="ghost" onClick={() => setShowPdfPreview(false)}>
                <span className="sr-only">{t("navbar.pdf.back")}</span>←{" "}
                {t("navbar.pdf.back")}
              </Button>
            </div>
            <div className="flex-1 overflow-auto">
              <PdfViewerComponent
                pdfUrl={pdfFile.fileUrl}
                handleDocumentLoad={handleDocumentLoad}
                handlePageChange={handlePageChange}
              />
            </div>
            <div className="flex justify-between p-4 border-t">
              <MyButton
                // variant="outline"
                buttonType="secondary"
                onClick={() => {
                  setShowPdfPreview(false);
                  fileInputRef.current?.click();
                }}
              >
                {t("navbar.pdf.replace")}
              </MyButton>
              <MyButton
                buttonType="primary"
                onClick={() => {
                  setShowPdfPreview(false);
                  setShowSubmitModal(true);
                }}
              >
                {t("common.submit")}
              </MyButton>
            </div>
          </div>
        </div>
      ) : null}

      <SubmitModal
        open={showSubmitModal}
        onOpenChange={setShowSubmitModal}
        onConfirm={handleSubmit}
      />

      <TimesUpModal
        open={showTimesUpModal}
        onOpenChange={setShowTimesUpModal}
        onFinish={handleSubmit}
      />
      {evaluationType !== "MANUAL" ? (
        <AlertDialog open={showWarningModal} onOpenChange={setShowWarningModal}>
          <AlertDialogContent>
            <AlertDialogDescription>
              {t("common.tabSwitchWarning", { count: tabSwitchCount })}
            </AlertDialogDescription>
            <AlertDialogAction
              onClick={() => {
                fullScreen.trigger();
                setTimeout(() => {
                  setShowWarningModal(false);
                }, 100);
              }}
            >
              {t("common.returnToTest")}
            </AlertDialogAction>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {/* Back pressed during a live test. Deliberately offers no way out except
          returning to the test or the normal Submit flow — an accidental back
          press must not end the attempt or drop the learner on the dashboard. */}
      <AlertDialog
        open={showExitWarningModal}
        onOpenChange={setShowExitWarningModal}
      >
        <AlertDialogContent>
          <AlertDialogDescription>
            {t("navbar.exitWarning.description")}
          </AlertDialogDescription>
          <AlertDialogAction onClick={() => setShowExitWarningModal(false)}>
            {t("common.returnToTest")}
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>

      <HelpModal
        open={helpType !== null}
        onOpenChange={(open) => !open && setHelpType(null)}
        type={helpType || "instructions"}
      />
    </>
  );
}
