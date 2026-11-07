import { create } from 'zustand';
import type { ProctoringConfigForm } from '@/types/assessments/proctoring';

interface BasicInfoState {
    assessmentPreview?: {
        checked: boolean;
        previewTimeLimit?: string;
    };
    reattemptCount?: string;
    durationDistribution?: string;
    evaluationType?: string;
    resultType?: string;
    aiEvaluationEnabled?: boolean;
    omrMode?: boolean;
    proctoring?: ProctoringConfigForm;
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
    setBasicInfo: (data: Partial<BasicInfoState>) => void;
    getBasicInfo: () => BasicInfoState;
    reset: () => void;
}

// ✅ Define the initial empty state
const initialState: Omit<BasicInfoState, 'setBasicInfo' | 'getBasicInfo' | 'reset'> = {
    assessmentPreview: undefined,
    reattemptCount: undefined,
    durationDistribution: undefined,
    evaluationType: undefined,
    resultType: undefined,
    aiEvaluationEnabled: undefined,
    omrMode: undefined,
    proctoring: undefined,
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
