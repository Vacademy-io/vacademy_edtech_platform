import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Storage } from "@capacitor/storage";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { ASSESSMENT_SUBMIT, ASSESSMENT_SUBMIT_MANUAL } from "@/constants/urls";
import { useProctoring } from "@/hooks";
import { registerBackGuard } from "@/lib/back-guard";
import { commitCbeEditors } from "@/components/cbe/commit-registry";
import { getPackageSessionId } from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import {
  removePersistedAssessmentState,
  useAssessmentStore,
} from "@/stores/assessment-store";
import {
  readSlideReturnContext,
  clearSlideReturnContext,
  markAssessmentSlideComplete,
  buildSlideReturnUrl,
} from "../../study-library/level-material/subject-material/module-material/chapter-material/slide-material/assessment-slide-return";
import { useLiveTestUi } from "../live-test-ui-context";
import { buildAttemptPayload } from "./attempt-payload";
import { getServerStartMs, readStoredAssessmentId } from "./attempt-storage";
import {
  shouldAutoSubmitOnTimeUp,
  shouldAutoSubmitOnViolation,
} from "./clock-logic";

const SUBMIT_MAX_ATTEMPTS = 3;
const SUBMIT_RETRY_STEP_MS = 3000;

/** Drops the locally persisted attempt (after a successful submit). */
async function removeStoredAttempt(logMissing: boolean) {
  const { value } = await Storage.get({ key: "Assessment_questions" });
  if (!value) {
    if (logMissing) console.error("No data found in Assessment_questions.");
    return;
  }
  try {
    const attemptId = JSON.parse(value)?.attempt_id;
    if (attemptId) {
      await removePersistedAssessmentState(attemptId);
    } else if (logMissing) {
      console.error("Attempt ID not found in Assessment_questions.");
    }
  } catch (error) {
    console.error("Error parsing Assessment_questions:", error);
  }
}

export interface LiveTestController {
  /** Submits the attempt (3 tries) and leaves the exam screen. Throws when every try fails. */
  handleSubmit: () => Promise<void>;
  showSubmitModal: boolean;
  setShowSubmitModal: (open: boolean) => void;
  showTimesUpModal: boolean;
  setShowTimesUpModal: (open: boolean) => void;
  showWarningModal: boolean;
  setShowWarningModal: (open: boolean) => void;
  showExitWarningModal: boolean;
  setShowExitWarningModal: (open: boolean) => void;
  /** Tab-switch warning action: back to full screen, then close the warning. */
  returnToTest: () => void;
}

/**
 * Submit, auto-submit, proctoring and the exit guards of the live test. None
 * of it draws; the engine root renders the modals from this state, so a
 * layout without the header still submits on time-up and on tab switches.
 */
export function useLiveTestController({
  playMode,
  evaluationType,
  instituteId,
}: {
  playMode: string;
  evaluationType: string;
  instituteId: string | null;
}): LiveTestController {
  const { t } = useTranslation("questionTest");
  const navigate = useNavigate();
  const { submitRequestId } = useLiveTestUi();
  const assessment = useAssessmentStore((s) => s.assessment);
  const isSubmitted = useAssessmentStore((s) => s.isSubmitted);
  const tabSwitchCount = useAssessmentStore((s) => s.tabSwitchCount);
  const proctorAutoSubmitRequested = useAssessmentStore(
    (s) => s.proctorAutoSubmitRequested,
  );
  const entireTestTimer = useAssessmentStore((s) => s.entireTestTimer);
  const pdfFile = useAssessmentStore((s) => s.pdfFile);

  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showTimesUpModal, setShowTimesUpModal] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [showExitWarningModal, setShowExitWarningModal] = useState(false);
  const hasAutoSubmittedRef = useRef(false);

  // The question palette's "Submit paper" (and any other surface) asks
  // through the UI context; the submit flow lives here only.
  useEffect(() => {
    if (submitRequestId > 0) setShowSubmitModal(true);
  }, [submitRequestId]);

  const { fullScreen } = useProctoring({
    forceFullScreen: true,
    preventTabSwitch: true,
    preventContextMenu: true,
    preventUserSelection: true,
    preventCopy: true,
  });

  const sendFormattedData = async () => {
    const state = useAssessmentStore.getState();
    const assessmentId = await readStoredAssessmentId();
    const formattedData = buildAttemptPayload(state, {
      assessmentId: assessmentId ?? "",
      status: "END",
      startTimeMs: await getServerStartMs(),
      nowMs: Date.now(),
      submit: {
        evaluationType,
        fileId: pdfFile?.fileId ?? "",
        hasPdf: Boolean(pdfFile),
      },
    });

    if (evaluationType === "MANUAL" && pdfFile) {
      const response = await authenticatedAxiosInstance.post(
        `${ASSESSMENT_SUBMIT_MANUAL}`,
        {
          json_content: JSON.stringify(formattedData),
          set_id: pdfFile.fileId,
        },
        {
          params: {
            attemptId: state.assessment?.attempt_id,
            assessmentId,
            instituteId,
          },
        },
      );
      if (response?.data) await removeStoredAttempt(true);
      return response?.data;
    }
    if (evaluationType === "AUTO" || (evaluationType === "MANUAL" && !pdfFile)) {
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
            assessmentId,
          },
        },
      );
      if (response?.data) await removeStoredAttempt(true);
      return response?.data;
    }
    return undefined;
  };

  const handleSubmit = async () => {
    // Save a spreadsheet cell still being typed in and the grid's debounced
    // change before reading the store (time-up / proctoring submits too).
    commitCbeEditors();
    const state = useAssessmentStore.getState();
    const attemptId = state.assessment?.attempt_id;

    if (!attemptId) {
      console.error("Attempt ID is missing. Cannot proceed with submission.");
      toast.error(t("navbar.toast.missingAttemptId"));
      throw new Error("Attempt ID missing");
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= SUBMIT_MAX_ATTEMPTS; attempt++) {
      try {
        const data = await sendFormattedData();
        if (!data) {
          throw new Error("Submission returned no data");
        }

        state.submitAssessment();
        toast.success(t("navbar.toast.submitSuccess"));
        state.resetAssessment();

        // Clean up attempt-scoped local storage before navigating away.
        try {
          await removeStoredAttempt(false);
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
          // A raw URL: the captured pathname + search lives outside
          // TanStack's typed route table. A hard navigation is what we want
          // after leaving the fullscreen proctoring shell.
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
          `Submission attempt ${attempt}/${SUBMIT_MAX_ATTEMPTS} failed:`,
          err,
        );
        if (attempt < SUBMIT_MAX_ATTEMPTS) {
          toast.error(
            t("navbar.toast.retrying", { attempt, max: SUBMIT_MAX_ATTEMPTS }),
          );
          const delay = SUBMIT_RETRY_STEP_MS * attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    toast.error(t("navbar.toast.submitFailed"));
    throw lastError;
  };

  // Auto-submits fire from effects; they always call the latest submit.
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;
  const submitLatest = useCallback(() => handleSubmitRef.current(), []);

  // Tab switches (3) or the proctoring ceiling end a non-MANUAL attempt.
  useEffect(() => {
    if (
      !shouldAutoSubmitOnViolation({
        hasAssessment: Boolean(assessment),
        evaluationType,
        tabSwitchCount,
        proctorAutoSubmitRequested,
      })
    ) {
      return;
    }
    setShowSubmitModal(true);
    // Next tick, outside React's effect phase: the CBE commit inside
    // handleSubmit needs flushSync, which React ignores during effects.
    window.setTimeout(() => void submitLatest(), 0);
  }, [tabSwitchCount, proctorAutoSubmitRequested, evaluationType, assessment, submitLatest]);

  // Exit guards and tab-switch counting.
  useEffect(() => {
    // Native back (Android hardware/gesture). We register a guard rather than our
    // own listener: Capacitor runs every backButton listener and ignores the
    // return value, so the global one in __root would still have navigated to the
    // dashboard underneath this modal.
    const unregisterBackGuard = registerBackGuard(() => {
      setShowExitWarningModal(true);
      return true; // consumed: __root must not navigate
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
        useAssessmentStore.getState().incrementTabSwitchCount();
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

  // Whole-test clock at 0: submit once.
  useEffect(() => {
    if (
      !shouldAutoSubmitOnTimeUp({
        hasAssessment: Boolean(assessment),
        evaluationType,
        playMode,
        isSubmitted,
        entireTestTimer,
        alreadyAutoSubmitted: hasAutoSubmittedRef.current,
      })
    ) {
      return;
    }
    hasAutoSubmittedRef.current = true;
    setShowTimesUpModal(true);
    // Next tick for the same reason as the violation auto-submit above.
    window.setTimeout(() => void submitLatest(), 0);
  }, [entireTestTimer, evaluationType, isSubmitted, assessment, playMode, submitLatest]);

  const returnToTest = useCallback(() => {
    fullScreen.trigger();
    setTimeout(() => {
      setShowWarningModal(false);
    }, 100);
  }, [fullScreen]);

  return {
    handleSubmit: submitLatest,
    showSubmitModal,
    setShowSubmitModal,
    showTimesUpModal,
    setShowTimesUpModal,
    showWarningModal,
    setShowWarningModal,
    showExitWarningModal,
    setShowExitWarningModal,
    returnToTest,
  };
}
