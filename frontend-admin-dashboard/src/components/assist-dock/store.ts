import { create } from 'zustand';

/** Which slide-out panel (if any) the right Assist Dock currently shows. */
export type AssistPanel =
    | 'none'
    | 'tutorials'
    | 'training'
    | 'assistant'
    | 'support'
    | 'roadmap'
    | 'explore'
    | 'adminApp';

const MINIMIZED_KEY = 'assistDockMinimized';

function readMinimized(): boolean {
    try {
        return localStorage.getItem(MINIMIZED_KEY) === '1';
    } catch {
        return false;
    }
}

interface AssistDockState {
    panel: AssistPanel;
    setPanel: (panel: AssistPanel) => void;
    togglePanel: (panel: Exclude<AssistPanel, 'none'>) => void;
    /** A question handed to the assistant from elsewhere (e.g. the dashboard
     *  launch bar) — the assistant panel consumes and sends it on open. */
    pendingPrompt: string | null;
    askAssistant: (prompt: string) => void;
    clearPendingPrompt: () => void;
    /** The walkthrough currently open in the big viewer (null = closed). */
    activeTutorial: { file: string; title: string } | null;
    openTutorial: (file: string, title: string) => void;
    closeTutorial: () => void;
    /** Whether the right rail is collapsed to a small pull-tab. Persisted across sessions. */
    minimized: boolean;
    setMinimized: (minimized: boolean) => void;
    /** Per-role resolved visibility of the whole dock (ui.showAssistDock in
     *  display settings). null until AssistDock resolves it. Components that
     *  reserve space for the rail read it via useAssistDockVisible() so they
     *  stay in lockstep with the rail itself. */
    dockVisible: boolean | null;
    setDockVisible: (dockVisible: boolean) => void;
}

export const useAssistDock = create<AssistDockState>((set) => ({
    panel: 'none',
    setPanel: (panel) => set({ panel }),
    togglePanel: (panel) => set((s) => ({ panel: s.panel === panel ? 'none' : panel })),
    pendingPrompt: null,
    askAssistant: (prompt) => set({ panel: 'assistant', pendingPrompt: prompt }),
    clearPendingPrompt: () => set({ pendingPrompt: null }),
    activeTutorial: null,
    openTutorial: (file, title) => set({ activeTutorial: { file, title } }),
    closeTutorial: () => set({ activeTutorial: null }),
    dockVisible: null,
    setDockVisible: (dockVisible) => set({ dockVisible }),
    minimized: readMinimized(),
    setMinimized: (minimized) => {
        try {
            localStorage.setItem(MINIMIZED_KEY, minimized ? '1' : '0');
        } catch {
            // private mode / storage disabled — the preference just won't persist
        }
        set({ minimized });
    },
}));
