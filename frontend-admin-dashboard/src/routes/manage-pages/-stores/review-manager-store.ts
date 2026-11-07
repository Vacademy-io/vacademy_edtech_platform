import { create } from 'zustand';

/**
 * Site reviews are moderated from inside the Website Builder (a full-screen
 * dialog over the sites list or the site editor), like blog posts.
 */
interface ReviewManagerState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export const useReviewManagerStore = create<ReviewManagerState>((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));
