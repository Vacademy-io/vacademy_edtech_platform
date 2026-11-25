import { create } from 'zustand';

export type AddPaperWay = 'ai' | 'upload' | 'vsmart' | 'manual';

interface AddPaperFlowState {
    chooserOpen: boolean;
    way: AddPaperWay | null;
    /** A file picked in another way that VSmart AI should start reading on open. */
    vsmartFile: File | null;
    setChooserOpen: (open: boolean) => void;
    /** Open one flow directly (from the chooser or the empty state). */
    pickWay: (way: AddPaperWay) => void;
    /** A PDF dropped in the Word / HTML upload: VSmart AI reads it instead. */
    handOffToVsmart: (file: File) => void;
    closeWay: () => void;
    backToChooser: () => void;
}

export const useAddPaperFlowStore = create<AddPaperFlowState>((set) => ({
    chooserOpen: false,
    way: null,
    vsmartFile: null,
    setChooserOpen: (open) => set({ chooserOpen: open }),
    pickWay: (way) => set({ chooserOpen: false, way, vsmartFile: null }),
    handOffToVsmart: (file) => set({ chooserOpen: false, way: 'vsmart', vsmartFile: file }),
    closeWay: () => set({ way: null, vsmartFile: null }),
    backToChooser: () => set({ way: null, chooserOpen: true, vsmartFile: null }),
}));
