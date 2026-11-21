import { createContext, useContext } from "react";
import type { QuestionNavigation } from "./use-question-navigation";

export interface LiveTestEngineValue {
  /** "" until storage has been read. */
  playMode: string;
  evaluationType: string;
  assessmentId: string;
  /** Paper title for the header. */
  assessmentName: string;
  instituteId: string | null;
  userId: string | null;
  /** Opens the submit confirmation (header Submit, PDF preview Submit). */
  openSubmitModal: () => void;
  /** Sends the autosave now (the save-failure banner's retry). */
  retrySave: () => Promise<unknown>;
  navigation: QuestionNavigation;
}

const noop = () => {};

const FALLBACK: LiveTestEngineValue = {
  playMode: "",
  evaluationType: "",
  assessmentId: "",
  assessmentName: "",
  instituteId: null,
  userId: null,
  openSubmitModal: noop,
  retrySave: async () => undefined,
  navigation: {
    sectionQuestions: [],
    currentIndex: -1,
    isTimeUp: false,
    isLastOfTest: false,
    goPrev: noop,
    goNext: noop,
    goToSection: noop,
    isSectionTabAvailable: () => false,
  },
};

export const LiveTestEngineContext = createContext<LiveTestEngineValue>(FALLBACK);

/** Engine state for the drawing components of the exam screen. */
export function useLiveTestEngine(): LiveTestEngineValue {
  return useContext(LiveTestEngineContext);
}
