import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { SubmitModal } from "@/components/modals/submit-modal";
import { TimesUpModal } from "@/components/modals/times-up-modal";
import { useAssessmentStore } from "@/stores/assessment-store";
import { useAttemptContext } from "./attempt-storage";
import { useAttemptAutosave } from "./use-attempt-autosave";
import { useExamClock } from "./use-exam-clock";
import { useLiveTestController } from "./use-live-test-controller";
import { useQuestionNavigation } from "./use-question-navigation";
import {
  LiveTestEngineContext,
  type LiveTestEngineValue,
} from "./live-test-engine-context";

/**
 * The exam engine: resume and autosave, every clock, submit and auto-submit,
 * proctoring and the exit guards, and the modals they open. Mounted once
 * around the exam layout, which only draws and reads this through
 * `useLiveTestEngine()`.
 */
export function LiveTestEngine({ children }: { children: ReactNode }) {
  const { t } = useTranslation("questionTest");
  const attempt = useAttemptContext();
  // Order matters: the clock's interval must be registered before the
  // autosave intervals, as it was when the clock lived in the navbar (a child
  // effect, so it ran first). When both fire in the same second, the saves
  // must read the already-decremented time, or a LIVE save with 1 s left goes
  // out alongside the time-up submit.
  useExamClock({ playMode: attempt.playMode });
  const retrySave = useAttemptAutosave({ playMode: attempt.playMode });
  const controller = useLiveTestController({
    playMode: attempt.playMode,
    evaluationType: attempt.evaluationType,
    instituteId: attempt.instituteId,
  });
  const navigation = useQuestionNavigation();
  const hasAssessment = useAssessmentStore((s) => Boolean(s.assessment));
  const tabSwitchCount = useAssessmentStore((s) => s.tabSwitchCount);

  const { setShowSubmitModal } = controller;
  const value = useMemo<LiveTestEngineValue>(
    () => ({
      ...attempt,
      openSubmitModal: () => setShowSubmitModal(true),
      retrySave,
      navigation,
    }),
    [attempt, setShowSubmitModal, retrySave, navigation],
  );

  return (
    <LiveTestEngineContext.Provider value={value}>
      {children}

      {/* The modals wait for the assessment, as they did inside the header. */}
      {hasAssessment && (
        <>
          <SubmitModal
            open={controller.showSubmitModal}
            onOpenChange={controller.setShowSubmitModal}
            onConfirm={controller.handleSubmit}
          />

          <TimesUpModal
            open={controller.showTimesUpModal}
            onOpenChange={controller.setShowTimesUpModal}
            onFinish={controller.handleSubmit}
          />

          {attempt.evaluationType !== "MANUAL" ? (
            <AlertDialog
              open={controller.showWarningModal}
              onOpenChange={controller.setShowWarningModal}
            >
              <AlertDialogContent>
                <AlertDialogDescription>
                  {t("common.tabSwitchWarning", { count: tabSwitchCount })}
                </AlertDialogDescription>
                <AlertDialogAction onClick={controller.returnToTest}>
                  {t("common.returnToTest")}
                </AlertDialogAction>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}

          {/* Back pressed during a live test. Deliberately offers no way out
              except returning to the test or the normal Submit flow: an
              accidental back press must not end the attempt or drop the
              learner on the dashboard. */}
          <AlertDialog
            open={controller.showExitWarningModal}
            onOpenChange={controller.setShowExitWarningModal}
          >
            <AlertDialogContent>
              <AlertDialogDescription>
                {t("navbar.exitWarning.description")}
              </AlertDialogDescription>
              <AlertDialogAction
                onClick={() => controller.setShowExitWarningModal(false)}
              >
                {t("common.returnToTest")}
              </AlertDialogAction>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </LiveTestEngineContext.Provider>
  );
}
