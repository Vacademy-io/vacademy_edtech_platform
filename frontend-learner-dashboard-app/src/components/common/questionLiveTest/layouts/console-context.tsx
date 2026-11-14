import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAssessmentStore } from "@/stores/assessment-store";
import type { ResolvedExamTheme } from "@/types/exam-theme";
import {
  EXAM_ACTIONS,
  runExamAction,
  type ExamActionContext,
  type ExamActionId,
} from "../actions";
import { useLiveTestEngine } from "../engine/live-test-engine-context";
import { useLiveTestUi } from "../live-test-ui-context";
import { consoleChromeFor, type ConsoleChrome } from "./console-chrome";

export type ConsoleOverlay = "question-paper" | "instructions" | null;

interface ConsoleContextValue {
  theme: ResolvedExamTheme;
  chrome: ConsoleChrome;
  actionContext: ExamActionContext;
  runAction: (id: ExamActionId) => void;
  overlay: ConsoleOverlay;
  setOverlay: (overlay: ConsoleOverlay) => void;
  isPaletteCollapsed: boolean;
  setPaletteCollapsed: (collapsed: boolean) => void;
  /** Question text zoom step (0 = 100%), for presets with Zoom In / Out. */
  zoomStep: number;
  setZoomStep: (step: number) => void;
}

/** Zoom steps of the question pane: 100% to 160% in 10% steps. */
export const MAX_ZOOM_STEP = 6;

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

/**
 * Opening a question marks it visited, so an open question with no saved
 * answer shows as Not Answered (the console rule). Navigation does this
 * through setCurrentQuestion; the first question of a freshly loaded paper
 * and the question opened by a section time-up switch are set directly, so
 * they are covered here.
 */
function useMarkOpenQuestionVisited() {
  const questionId = useAssessmentStore((s) => s.currentQuestion?.question_id);
  const isVisited = useAssessmentStore((s) =>
    questionId ? Boolean(s.questionStates[questionId]?.isVisited) : true,
  );
  const isSubmitted = useAssessmentStore((s) => s.isSubmitted);
  useEffect(() => {
    if (!questionId || isVisited || isSubmitted) return;
    useAssessmentStore.getState().setQuestionState(questionId, { isVisited: true });
  }, [questionId, isVisited, isSubmitted]);
}

/** Shared state of the console layout: theme, chrome, actions and overlays. */
export function ConsoleProvider({ children }: { children: ReactNode }) {
  useMarkOpenQuestionVisited();
  const { examTheme } = useLiveTestUi();
  const { playMode, openSubmitModal } = useLiveTestEngine();
  const [overlay, setOverlay] = useState<ConsoleOverlay>(null);
  const [isPaletteCollapsed, setPaletteCollapsed] = useState(false);
  const [zoomStep, setZoomStepState] = useState(0);
  const setZoomStep = useCallback(
    (step: number) => setZoomStepState(Math.min(MAX_ZOOM_STEP, Math.max(0, step))),
    [],
  );

  const actionContext = useMemo<ExamActionContext>(
    () => ({
      getStore: useAssessmentStore.getState,
      theme: examTheme,
      playMode,
      openSubmit: openSubmitModal,
      openQuestionPaper: () => setOverlay("question-paper"),
      openInstructions: () => setOverlay("instructions"),
    }),
    [examTheme, playMode, openSubmitModal],
  );

  const runAction = useCallback(
    (id: ExamActionId) => {
      runExamAction(id, actionContext);
    },
    [actionContext],
  );

  const value = useMemo<ConsoleContextValue>(
    () => ({
      theme: examTheme,
      chrome: consoleChromeFor(examTheme),
      actionContext,
      runAction,
      overlay,
      setOverlay,
      isPaletteCollapsed,
      setPaletteCollapsed,
      zoomStep,
      setZoomStep,
    }),
    [examTheme, actionContext, runAction, overlay, isPaletteCollapsed, zoomStep, setZoomStep],
  );

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}

export function useConsole(): ConsoleContextValue {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error("useConsole must be used inside ConsoleProvider");
  return value;
}

/**
 * Whether an action is enabled, re-checked when the store values the rules
 * read change. Submit also follows the clock (its lock lifts at 0).
 */
export function useActionEnabled(id: ExamActionId): boolean {
  const { actionContext } = useConsole();
  // Subscribing to these re-renders the button when its rule may change.
  useAssessmentStore((s) => s.currentQuestion);
  useAssessmentStore((s) => s.currentSection);
  useAssessmentStore((s) => s.isSubmitted);
  useAssessmentStore((s) => s.sectionTimers);
  useAssessmentStore((s) => s.assessment);
  useAssessmentStore((s) => (id === "submit" ? s.entireTestTimer > 0 : 0));
  return EXAM_ACTIONS[id].isEnabled(actionContext);
}
