import { create } from 'zustand';

interface BasicInfoState {
    assessmentPreview?: {
        checked: boolean;
        previewTimeLimit?: string;
    };
    reattemptCount?: string;
    durationDistribution?: string;
    evaluationType?: string;
    raiseReattemptRequest?: boolean;
    raiseTimeIncreaseRequest?: boolean;
    status?: string;
    submissionType?: string;
    switchSections?: boolean;
    testCreation?: {
        assessmentInstructions?: string;
        assessmentName?: string;
        liveDateRange?: {
            startDate?: string;
            endDate?: string;
        };
        subject?: string;
    };
    /**
     * The draft this wizard's step 1 created, and for which exam type. Saving step 1
     * again (back from a later step) updates that draft instead of creating a second
     * one. Cleared by reset() with the rest of the wizard's step 1 state.
     */
    savedDraft?: { assessmentId: string; examType?: string };
    setBasicInfo: (data: Partial<BasicInfoState>) => void;
    getBasicInfo: () => BasicInfoState;
    reset: () => void;
}

// ✅ Define the initial empty state
const initialState: Omit<BasicInfoState, 'setBasicInfo' | 'getBasicInfo' | 'reset'> = {
    savedDraft: undefined,
    assessmentPreview: undefined,
    reattemptCount: undefined,
    durationDistribution: undefined,
    evaluationType: undefined,
    raiseReattemptRequest: undefined,
    raiseTimeIncreaseRequest: undefined,
    status: undefined,
    submissionType: undefined,
    switchSections: undefined,
    testCreation: undefined,
};

export const useBasicInfoStore = create<BasicInfoState>((set, get) => ({
    ...initialState,
    setBasicInfo: (data) => set((state) => ({ ...state, ...data })),
    getBasicInfo: () => get(),
    reset: () => set(() => ({ ...initialState })), // ✅ Properly resets the state
}));

// Define the store
interface AssessmentUrlStore {
    assessmentUrl: string;
    setAssessmentUrl: (url: string) => void;
}

// Create the Zustand store
export const useAssessmentUrlStore = create<AssessmentUrlStore>((set) => ({
    assessmentUrl: '',
    setAssessmentUrl: (url) => set({ assessmentUrl: url }),
}));
