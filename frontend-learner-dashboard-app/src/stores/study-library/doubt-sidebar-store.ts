import { create } from "zustand";

export interface DoubtDraft {
  text: string;
  position?: number | undefined;
}

interface DoubtSidebarStore {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggle: () => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  /** Text and position a new doubt should start from, then consumed by the sidebar. */
  draft: DoubtDraft | null;
  openWithDraft: (draft: DoubtDraft) => void;
  clearDraft: () => void;
}

export const useDoubtSidebarStore = create<DoubtSidebarStore>((set, get) => ({
  isOpen: false,
  setIsOpen: (open: boolean) => set({ isOpen: open }),
  toggle: () => set({ isOpen: !get().isOpen }),
  openSidebar: () => set({ isOpen: true }),
  closeSidebar: () => set({ isOpen: false }),
  draft: null,
  openWithDraft: (draft) => set({ isOpen: true, draft }),
  clearDraft: () => set({ draft: null }),
})); 