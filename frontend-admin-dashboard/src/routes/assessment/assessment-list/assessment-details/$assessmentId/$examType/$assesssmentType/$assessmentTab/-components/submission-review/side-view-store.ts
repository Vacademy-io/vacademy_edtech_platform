import { create } from 'zustand';

/**
 * Which side view a Submissions-list click opens: the learner's profile ("student", from
 * the Name cell) or this attempt's submission ("submission", from any other cell of an
 * Attempted row). The submission view's "Student details" opens the learner with a way
 * back (`fromSubmission`).
 */
export type SubmissionsSidePanel = 'student' | 'submission';

interface SidePanelState {
    panel: SubmissionsSidePanel;
    /** The student view was opened from the submission view: offer "Back to submission". */
    fromSubmission: boolean;
    setPanel: (panel: SubmissionsSidePanel, fromSubmission?: boolean) => void;
}

export const useSubmissionsSidePanel = create<SidePanelState>((set) => ({
    panel: 'student',
    fromSubmission: false,
    setPanel: (panel, fromSubmission = false) => set({ panel, fromSubmission }),
}));
