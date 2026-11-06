import { create } from "zustand";

/**
 * Tracks whether a quiz is open (QuizViewer mounted) and whether it is on a screen
 * the learner works through: the start screen or the questions. The floating
 * chatbot button moves up for the first and, on phones, steps aside for the second.
 */
interface QuizActiveStore {
  isActive: boolean;
  setActive: (active: boolean) => void;
  isAttemptScreen: boolean;
  setAttemptScreen: (shown: boolean) => void;
}

export const useQuizActiveStore = create<QuizActiveStore>((set) => ({
  isActive: false,
  setActive: (active: boolean) => set({ isActive: active }),
  isAttemptScreen: false,
  setAttemptScreen: (shown: boolean) => set({ isAttemptScreen: shown }),
}));
