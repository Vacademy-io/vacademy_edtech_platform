import { create } from "zustand";
import { persist } from "zustand/middleware";

// Which side edge the floating chat button (FAB) hugs. It can be dragged freely,
// but on release it snaps horizontally to the nearest edge while keeping the
// vertical spot where it was dropped (so it can sit at any height, not a corner).
export type FabSide = "left" | "right";

// How the desktop chat renders: docked as a right-hand column, or popped out
// into a centered overlay that doesn't squeeze the page.
export type ChatViewMode = "docked" | "popup";

// Persisted position of the FAB. `null` means "use the default docked
// bottom-right position". `yRatio` (0..1 of viewport height) is resize-proof.
export interface FabPosition {
  side: FabSide;
  yRatio: number;
}

interface ChatbotPanelState {
  // Panel open/close state
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  togglePanel: () => void;

  // Panel width (for resizable behavior)
  panelWidth: number;
  setPanelWidth: (width: number) => void;

  // Docked mode: when true, the docked panel is being used instead of floating overlay
  isDockedMode: boolean;
  setIsDockedMode: (isDockedMode: boolean) => void;

  // Docked column vs popup overlay (desktop). Persisted: a learner who prefers
  // the popup gets it back next visit.
  viewMode: ChatViewMode;
  setViewMode: (mode: ChatViewMode) => void;
  toggleViewMode: () => void;

  // Floating button (FAB) position — where the user dragged the launcher to
  fabPosition: FabPosition | null;
  setFabPosition: (position: FabPosition | null) => void;

  // Constants
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
}

export const useChatbotPanelStore = create<ChatbotPanelState>()(
  persist(
    (set) => ({
      // Default state
      isOpen: false,
      panelWidth: 440,
      isDockedMode: false,
      viewMode: "docked",
      fabPosition: null,

      // Constants
      // A 350px column wrapped assistant replies into a narrow strip; 440 fits
      // a readable paragraph and a short code line. Resizable up to 760.
      minWidth: 320,
      maxWidth: 760,
      defaultWidth: 440,

      // Actions
      setIsOpen: (isOpen) => set({ isOpen }),
      togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),
      setPanelWidth: (width) =>
        set((state) => ({
          panelWidth: Math.max(state.minWidth, Math.min(state.maxWidth, width)),
        })),
      setIsDockedMode: (isDockedMode) => set({ isDockedMode }),
      setViewMode: (viewMode) => set({ viewMode }),
      toggleViewMode: () =>
        set((state) => ({ viewMode: state.viewMode === "popup" ? "docked" : "popup" })),
      setFabPosition: (fabPosition) => set({ fabPosition }),
    }),
    {
      name: "chatbot-panel-storage",
      version: 4,
      // Older builds used other position shapes ({ xRatio, yRatio }, { corner }).
      // Drop anything that isn't the current { side, yRatio } shape.
      migrate: (persisted: unknown, version: number): ChatbotPanelState => {
        let state = persisted as ChatbotPanelState;
        const p = state?.fabPosition as { side?: unknown } | null;
        if (version < 3 && p && p.side !== "left" && p.side !== "right") {
          state = { ...state, fabPosition: null };
        }
        // v4 widened the default column; lift everyone still on the old
        // narrow default (or narrower) rather than leaving them cramped.
        if (version < 4 && (!state?.panelWidth || state.panelWidth < 440)) {
          state = { ...state, panelWidth: 440 };
        }
        return state;
      },
      partialize: (state) => ({
        isOpen: state.isOpen,
        panelWidth: state.panelWidth,
        fabPosition: state.fabPosition,
        viewMode: state.viewMode,
      }),
    }
  )
);
