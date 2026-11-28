import { create } from 'zustand';

/**
 * A paper just added on the Question Papers page, waiting for its folder. The save hook
 * sets it; the folder workspace shows the "Add to a folder" step for it. When folders
 * are off the page clears it, so nothing is shown.
 */
interface PendingPaperFolderPromptState {
    pending: { questionPaperId: string; title: string } | null;
    setPending: (pending: { questionPaperId: string; title: string } | null) => void;
}

export const usePendingPaperFolderPrompt = create<PendingPaperFolderPromptState>((set) => ({
    pending: null,
    setPending: (pending) => set({ pending }),
}));
