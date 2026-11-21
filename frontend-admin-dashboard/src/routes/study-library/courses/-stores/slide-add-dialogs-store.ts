import { create } from 'zustand';

interface DialogState {
    // Dialog open states
    isPdfDialogOpen: boolean;
    isDocUploadDialogOpen: boolean;
    isVideoDialogOpen: boolean;
    isVideoFileDialogOpen: boolean;
    isQuestionDialogOpen: boolean;
    isAssignmentDialogOpen: boolean;
    isQuizDialogOpen: boolean;
    isAudioDialogOpen: boolean;
    isPptDialogOpen: boolean;
    isScormDialogOpen: boolean;
    isVimeoDialogOpen: boolean;
    isAssessmentDialogOpen: boolean;
    isAiVideoDialogOpen: boolean;

    // Dialog actions
    openPdfDialog: () => void;
    closePdfDialog: () => void;
    togglePdfDialog: () => void;

    openDocUploadDialog: () => void;
    closeDocUploadDialog: () => void;
    toggleDocUploadDialog: () => void;

    openVideoDialog: () => void;
    closeVideoDialog: () => void;
    toggleVideoDialog: () => void;

    openVideoFileDialog: () => void;
    closeVideoFileDialog: () => void;
    toggleVideoFileDialog: () => void;

    openQuestionDialog: () => void;
    closeQuestionDialog: () => void;
    toggleQuestionDialog: () => void;

    openAssignmentDialog: () => void;
    closeAssignmentDialog: () => void;
    toggleAssignmentDialog: () => void;

    openQuizDialog: () => void;
    closeQuizDialog: () => void;
    toggleQuizDialog: () => void;

    openAudioDialog: () => void;
    closeAudioDialog: () => void;
    toggleAudioDialog: () => void;

    openPptDialog: () => void;
    closePptDialog: () => void;
    togglePptDialog: () => void;

    openScormDialog: () => void;
    closeScormDialog: () => void;
    toggleScormDialog: () => void;

    openVimeoDialog: () => void;
    closeVimeoDialog: () => void;
    toggleVimeoDialog: () => void;

    openAssessmentDialog: () => void;
    closeAssessmentDialog: () => void;
    toggleAssessmentDialog: () => void;

    openAiVideoDialog: () => void;
    closeAiVideoDialog: () => void;

    resetDialogs: () => void;
}

export const useDialogStore = create<DialogState>((set) => ({
    isPdfDialogOpen: false,
    isDocUploadDialogOpen: false,
    isVideoDialogOpen: false,
    isVideoFileDialogOpen: false,
    isQuestionDialogOpen: false,
    isAssignmentDialogOpen: false,
    isQuizDialogOpen: false,
    isAudioDialogOpen: false,
    isPptDialogOpen: false,
    isScormDialogOpen: false,
    isVimeoDialogOpen: false,
    isAssessmentDialogOpen: false,
    isAiVideoDialogOpen: false,

    // PDF Dialog actions
    openPdfDialog: () => set({ isPdfDialogOpen: true }),
    closePdfDialog: () => set({ isPdfDialogOpen: false }),
    togglePdfDialog: () => set((state) => ({ isPdfDialogOpen: !state.isPdfDialogOpen })),

    // Doc Upload Dialog actions
    openDocUploadDialog: () => set({ isDocUploadDialogOpen: true }),
    closeDocUploadDialog: () => set({ isDocUploadDialogOpen: false }),
    toggleDocUploadDialog: () =>
        set((state) => ({ isDocUploadDialogOpen: !state.isDocUploadDialogOpen })),

    // Video Dialog actions
    openVideoDialog: () => set({ isVideoDialogOpen: true }),
    closeVideoDialog: () => set({ isVideoDialogOpen: false }),
    toggleVideoDialog: () => set((state) => ({ isVideoDialogOpen: !state.isVideoDialogOpen })),

    // Video File Dialog actions
    openVideoFileDialog: () => set({ isVideoFileDialogOpen: true }),
    closeVideoFileDialog: () => set({ isVideoFileDialogOpen: false }),
    toggleVideoFileDialog: () =>
        set((state) => ({ isVideoFileDialogOpen: !state.isVideoFileDialogOpen })),

    // Question Dialog actions
    openQuestionDialog: () => set({ isQuestionDialogOpen: true }),
    closeQuestionDialog: () => set({ isQuestionDialogOpen: false }),
    toggleQuestionDialog: () =>
        set((state) => ({ isQuestionDialogOpen: !state.isQuestionDialogOpen })),

    // Assignment Dialog actions
    openAssignmentDialog: () => set({ isAssignmentDialogOpen: true }),
    closeAssignmentDialog: () => set({ isAssignmentDialogOpen: false }),
    toggleAssignmentDialog: () =>
        set((state) => ({ isAssignmentDialogOpen: !state.isAssignmentDialogOpen })),

    // Quiz Dialog actions
    openQuizDialog: () => set({ isQuizDialogOpen: true }),
    closeQuizDialog: () => set({ isQuizDialogOpen: false }),
    toggleQuizDialog: () => set((state) => ({ isQuizDialogOpen: !state.isQuizDialogOpen })),

    // Audio Dialog actions
    openAudioDialog: () => set({ isAudioDialogOpen: true }),
    closeAudioDialog: () => set({ isAudioDialogOpen: false }),
    toggleAudioDialog: () => set((state) => ({ isAudioDialogOpen: !state.isAudioDialogOpen })),

    // PPT Dialog actions
    openPptDialog: () => set({ isPptDialogOpen: true }),
    closePptDialog: () => set({ isPptDialogOpen: false }),
    togglePptDialog: () => set((state) => ({ isPptDialogOpen: !state.isPptDialogOpen })),

    // SCORM Dialog actions
    openScormDialog: () => set({ isScormDialogOpen: true }),
    closeScormDialog: () => set({ isScormDialogOpen: false }),
    toggleScormDialog: () => set((state) => ({ isScormDialogOpen: !state.isScormDialogOpen })),

    // Vimeo Dialog actions
    openVimeoDialog: () => set({ isVimeoDialogOpen: true }),
    closeVimeoDialog: () => set({ isVimeoDialogOpen: false }),
    toggleVimeoDialog: () => set((state) => ({ isVimeoDialogOpen: !state.isVimeoDialogOpen })),

    // Assessment Dialog actions
    openAssessmentDialog: () => set({ isAssessmentDialogOpen: true }),
    closeAssessmentDialog: () => set({ isAssessmentDialogOpen: false }),
    toggleAssessmentDialog: () =>
        set((state) => ({ isAssessmentDialogOpen: !state.isAssessmentDialogOpen })),

    // AI Video (generate with AI) Dialog actions
    openAiVideoDialog: () => set({ isAiVideoDialogOpen: true }),
    closeAiVideoDialog: () => set({ isAiVideoDialogOpen: false }),

    // Reset all dialogs
    resetDialogs: () =>
        set({
            isPdfDialogOpen: false,
            isDocUploadDialogOpen: false,
            isVideoDialogOpen: false,
            isVideoFileDialogOpen: false,
            isQuestionDialogOpen: false,
            isAssignmentDialogOpen: false,
            isQuizDialogOpen: false,
            isAudioDialogOpen: false,
            isPptDialogOpen: false,
            isScormDialogOpen: false,
            isVimeoDialogOpen: false,
            isAssessmentDialogOpen: false,
            isAiVideoDialogOpen: false,
        }),
}));
