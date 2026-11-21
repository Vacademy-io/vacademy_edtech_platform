import { create } from 'zustand';

interface SectionDetailsState {
    status?: string;
    /**
     * The assessment whose step 2 save produced the section ids in `section`.
     * The store outlives an abandoned wizard; ids from another assessment are
     * dropped on load (see Step2AddingQuestions).
     */
    savedForAssessmentId?: string;
    testDuration?: {
        entireTestDuration: {
            checked: boolean;
            testDuration?: {
                hrs: string;
                min: string;
            };
        };
        questionWiseDuration: boolean;
        sectionWiseDuration: boolean;
    };
    section?: {
        sectionId: string;
        sectionName: string;
        questionPaperTitle?: string;
        uploaded_question_paper?: string | null;
        subject?: string;
        yearClass?: string;
        question_duration: {
            hrs: string;
            min: string;
        };
        section_description: string;
        section_duration: {
            hrs: string;
            min: string;
        };
        marks_per_question: string;
        total_marks: string;
        negative_marking: {
            checked: boolean;
            value: string;
        };
        partial_marking: boolean;
        cutoff_marks: {
            checked: boolean;
            value: string;
        };
        problem_randomization: boolean;
        adaptive_marking_for_each_question: {
            questionId?: string;
            questionName: string;
            questionType: string;
            questionMark: string;
            questionPenalty: string;
            correctOptionIdsCnt?: number;
            questionDuration: {
                hrs: string;
                min: string;
            };
        }[];
    }[];
    setSectionDetails: (data: Partial<SectionDetailsState>) => void;
    getSectionDetails: () => SectionDetailsState;
    reset: () => void;
}

// ✅ Define the initial empty state (excluding functions)
const initialState: Omit<SectionDetailsState, 'setSectionDetails' | 'getSectionDetails' | 'reset'> =
    {
        status: undefined,
        savedForAssessmentId: undefined,
        testDuration: undefined,
        section: undefined,
    };

export const useSectionDetailsStore = create<SectionDetailsState>((set, get) => ({
    ...initialState,
    setSectionDetails: (data) => set((state) => ({ ...state, ...data })),
    getSectionDetails: () => get(),
    reset: () => set(() => ({ ...initialState })), // ✅ Properly resets to initial state
}));
