import { create } from 'zustand';

export type AddPaperWay = 'ai' | 'upload' | 'manual';

interface AddPaperFlowState {
    chooserOpen: boolean;
    way: AddPaperWay | null;
    setChooserOpen: (open: boolean) => void;
    /** Open one flow directly (from the chooser or the empty state). */
    pickWay: (way: AddPaperWay) => void;
    closeWay: () => void;
    backToChooser: () => void;
}

export const useAddPaperFlowStore = create<AddPaperFlowState>((set) => ({
    chooserOpen: false,
    way: null,
    setChooserOpen: (open) => set({ chooserOpen: open }),
    pickWay: (way) => set({ chooserOpen: false, way }),
    closeWay: () => set({ way: null }),
    backToChooser: () => set({ way: null, chooserOpen: true }),
}));
