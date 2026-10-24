import { create } from 'zustand';

/**
 * A just-published assessment waiting for its folder. The create wizard sets it and
 * navigates to the list as before; the list's folder workspace shows the "Add to a
 * folder" step for it. Kept outside the wizard so the wizard can unmount and reset.
 */
interface PendingFolderPromptState {
    pending: { assessmentId: string; name: string } | null;
    setPending: (pending: { assessmentId: string; name: string } | null) => void;
}

export const usePendingFolderPrompt = create<PendingFolderPromptState>((set) => ({
    pending: null,
    setPending: (pending) => set({ pending }),
}));
