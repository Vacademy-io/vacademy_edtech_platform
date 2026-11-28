import { useEffect } from "react";
import { useAssessmentStore } from "@/stores/assessment-store";
import {
  CLOCK_TICK_MS,
  isQuestionClockActive,
  isSectionClockActive,
  questionTickAction,
  remainingFromServerStart,
  sectionTickAction,
} from "./clock-logic";
import { getServerStartEndTime } from "./attempt-storage";

/**
 * Every exam clock, in one place that draws nothing. These used to tick inside
 * the header (whole test), the section tabs (sections) and the question view
 * (per question and time spent), so a layout without one of those parts would
 * have stopped that clock. Time-up auto-submit lives in the controller, which
 * owns submit.
 *
 * Each clock keeps its own interval and lifecycle exactly as before the move
 * (for example the per-question clocks restart on every question change), so
 * the time values sent to the server do not shift.
 */
export function useExamClock({ playMode }: { playMode: string }) {
  const assessment = useAssessmentStore((s) => s.assessment);
  const currentSection = useAssessmentStore((s) => s.currentSection);
  const currentQuestion = useAssessmentStore((s) => s.currentQuestion);
  const sectionTimers = useAssessmentStore((s) => s.sectionTimers);
  const questionTimers = useAssessmentStore((s) => s.questionTimers);
  const distribution = assessment?.distribution_duration;

  // Whole-test clock. Runs for every play mode; the store stops it at 0, and
  // untimed attempts sit at 0 from the start.
  useEffect(() => {
    const timer = setInterval(() => {
      useAssessmentStore.getState().updateEntireTestTimer();
    }, CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Section clock (distribution SECTION). When the current section reaches 0
  // and switching is off, move to the next section that still has time.
  useEffect(() => {
    if (!isSectionClockActive(assessment?.distribution_duration, playMode)) {
      return;
    }
    const timer = setInterval(() => {
      const action = sectionTickAction(
        sectionTimers[currentSection],
        Boolean(assessment?.can_switch_section),
      );
      const store = useAssessmentStore.getState();
      if (action.type === "tick") {
        store.updateSectionTimer(currentSection, action.timeLeft);
      } else if (action.type === "advance") {
        store.moveToNextAvailableSection();
      }
    }, CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [playMode, assessment, currentSection, sectionTimers]);

  // Time spent on the open question, sent as timeTakenInSeconds.
  useEffect(() => {
    if (!currentQuestion?.question_id) return;
    const questionId = currentQuestion.question_id;
    useAssessmentStore.getState().initializeQuestionTime(questionId);
    const interval = setInterval(() => {
      useAssessmentStore.getState().incrementQuestionTime(questionId);
    }, CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, [currentQuestion]);

  // Per-question clock (distribution QUESTION): at 0, go to the next question.
  useEffect(() => {
    if (!isQuestionClockActive(distribution, playMode, Boolean(currentQuestion))) {
      return;
    }
    if (!currentQuestion) return;
    const questionId = currentQuestion.question_id;
    const timer = setInterval(() => {
      const action = questionTickAction(questionTimers[questionId]);
      const store = useAssessmentStore.getState();
      if (action.type === "tick") {
        store.updateQuestionTimer(questionId, action.timeLeft);
      } else {
        store.moveToNextQuestion();
      }
    }, CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [currentQuestion, distribution, questionTimers, playMode]);

  // Coming back to the tab: the interval may have been throttled while the
  // page was hidden, so set the whole-test clock from the server start time.
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

      const remaining = remainingFromServerStart(
        totalDurationSeconds,
        new Date(start_time).getTime(),
        Date.now(),
      );
      if (remaining === null) return;
      state.setEntireTestTimer(remaining);
    };

    document.addEventListener("visibilitychange", reconcileTimer);
    return () => document.removeEventListener("visibilitychange", reconcileTimer);
  }, []);
}
