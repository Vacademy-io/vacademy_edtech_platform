import { create } from 'zustand';

/**
 * Blog posts are managed from inside the Website Builder (a full-screen
 * dialog over the sites list or the site editor), not on a page of their
 * own. `postId` picks the face: null = list, 'new' = create, else edit.
 */
interface BlogManagerState {
    isOpen: boolean;
    postId: string | null;
    open: (postId?: string | null) => void;
    showList: () => void;
    close: () => void;
}

export const useBlogManagerStore = create<BlogManagerState>((set) => ({
    isOpen: false,
    postId: null,
    open: (postId = null) => set({ isOpen: true, postId }),
    showList: () => set({ postId: null }),
    close: () => set({ isOpen: false, postId: null }),
}));
