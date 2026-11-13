import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Preferences } from "@capacitor/preferences";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { ASSESSMENT_SAVE } from "@/constants/urls";
import { readStoredPlayMode } from "@/hooks/use-stored-play-mode";
import { safeParse } from "@/lib/storage";
import { useAssessmentStore } from "@/stores/assessment-store";
import {
  LOCAL_SAVE_INTERVAL_MS,
  REMOTE_SAVE_INTERVAL_MS,
  REMOTE_SAVE_RETRY_ATTEMPTS,
  REMOTE_SAVE_RETRY_BASE_MS,
  REMOTE_SAVE_RETRY_MAX_MS,
} from "@/constants/assessment-timings";
import { buildAttemptPayload } from "./attempt-payload";
import {
  getServerStartMs,
  readStoredAssessmentId,
} from "./attempt-storage";
import { shouldAutosave } from "./clock-logic";

/** The autosave payload (status LIVE, or any status passed) from the store. */
export async function formatDataFromStore(assessmentId: string, status: string) {
  const startTimeMs = await getServerStartMs();
  return buildAttemptPayload(useAssessmentStore.getState(), {
    assessmentId,
    status,
    startTimeMs,
    nowMs: Date.now(),
  });
}

/**
 * Resume and autosave: restores the local copy on open, saves it locally on an
 * interval and on leave, and sends the attempt to the server on an interval
 * with retries. Returns the send function for the "retry" banner.
 */
export function useAttemptAutosave({ playMode }: { playMode: string }) {
  const { t } = useTranslation("questionTest");
  const isSubmitted = useAssessmentStore((s) => s.isSubmitted);
  // Read by the autosave interval, whose closure is created once.
  const playModeRef = useRef<string>("");
  // Latches so we show the "save failed" toast exactly once per failure streak
  // and the "recovered" toast exactly once when it clears.
  const hasShownSaveFailureToastRef = useRef(false);

  useEffect(() => {
    if (playMode) playModeRef.current = playMode;
  }, [playMode]);

  const sendFormattedData = useCallback(async () => {
    const state = useAssessmentStore.getState();
    state.setRemoteSaveStatus("saving");
    const assessmentId = await readStoredAssessmentId();
    const formattedData = await formatDataFromStore(assessmentId ?? "", "LIVE");

    let lastError: unknown;
    for (let attempt = 0; attempt < REMOTE_SAVE_RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await authenticatedAxiosInstance.post(
          `${ASSESSMENT_SAVE}`,
          { json_content: JSON.stringify(formattedData) },
          {
            params: {
              attemptId: state.assessment?.attempt_id,
              assessmentId,
            },
          },
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
          REMOTE_SAVE_RETRY_MAX_MS,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    state.setRemoteSaveStatus("failed");
    console.error("Error sending data after retries:", lastError);
    throw lastError;
  }, []);

  // Remote autosave: now, then every REMOTE_SAVE_INTERVAL_MS.
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
        // Only toast on the first failure in a streak; the persistent
        // NetworkStatus banner keeps the user informed after that.
        if (!hasShownSaveFailureToastRef.current) {
          hasShownSaveFailureToastRef.current = true;
          toast.error(t("page.toast.savingFailed"));
        }
      }
    };

    const sent = async () => {
      const state = useAssessmentStore.getState();
      if (!playModeRef.current) {
        playModeRef.current = (await readStoredPlayMode()) ?? "";
      }
      if (
        shouldAutosave({
          isSubmitted,
          entireTestTimer: state.entireTestTimer,
          playMode: playModeRef.current,
        })
      ) {
        await sendData();
      }
    };

    sent();
    const interval = setInterval(() => {
      sent();
    }, REMOTE_SAVE_INTERVAL_MS);
    return () => clearInterval(interval);
    // `t` is left out on purpose, as before: a language switch must not
    // trigger an extra immediate save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubmitted, sendFormattedData]);

  // Resume from the local copy, then save it locally on an interval and on leave.
  useEffect(() => {
    const store = useAssessmentStore.getState();
    const initializeAssessment = async () => {
      // Check if this is a survey and we already have assessment data
      const state = useAssessmentStore.getState();
      const assessmentData = await Preferences.get({
        key: "InstructionID_and_AboutID",
      });
      const assessment = safeParse<{ play_mode?: string } | null>(
        assessmentData.value,
        null,
      );

      // For surveys, only load state if we don't already have assessment data
      if (assessment?.play_mode === "SURVEY" && state.assessment && state.currentQuestion) {
        console.log("Survey assessment already initialized, skipping loadState");
        return;
      }

      await store.loadState();
    };

    initializeAssessment();

    const saveInterval = setInterval(() => {
      store.saveState();
    }, LOCAL_SAVE_INTERVAL_MS);

    return () => {
      clearInterval(saveInterval);
      store.saveState();
    };
  }, []);

  return sendFormattedData;
}
