import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import i18n from "@/i18n";
import { fetchSlideNotes } from "@/lib/notes/api";
import {
  flushOutbox,
  mergeWithOutbox,
  queueWrite,
  readOutbox,
  readSlideCache,
  writeSlideCache,
} from "@/lib/notes/outbox";
import type { LearnerNote, LessonContext } from "@/lib/notes/types";

interface LessonNotesState {
  context: LessonContext | null;
  /** The open course's name, from the lesson page's own lookup. */
  courseName: string | null;
  setCourseName: (name: string | null) => void;
  notes: LearnerNote[];
  loading: boolean;
  panelOpen: boolean;
  /** Dragging a box on the PDF instead of scrolling or selecting. */
  areaMode: boolean;
  /** The note whose editor should open and scroll into view. */
  focusNoteId: string | null;
  /** Writes this device has not delivered yet. */
  pending: number;
  setContext: (context: LessonContext | null) => void;
  load: (slideId: string) => Promise<void>;
  openPanel: (focusNoteId?: string | null) => void;
  closePanel: () => void;
  togglePanel: () => void;
  setAreaMode: (on: boolean) => void;
  clearFocus: () => void;
  /** Creates a note on the current lesson; null when no lesson is open. */
  addNote: (fields: Partial<LearnerNote> & Pick<LearnerNote, "kind">) => LearnerNote | null;
  updateNote: (id: string, patch: Partial<LearnerNote>) => void;
  removeNote: (id: string) => void;
  /** Sends anything waiting. Safe to call at any time. */
  sync: () => Promise<void>;
}

export const useLessonNotesStore = create<LessonNotesState>((set, get) => {
  // Bumped on every local write, so a slow load cannot overwrite one made meanwhile.
  let localWrites = 0;
  const persist = (notes: LearnerNote[]) => {
    localWrites += 1;
    const slideId = get().context?.slide_id;
    if (slideId) writeSlideCache(slideId, notes);
    set({ notes });
  };

  return {
    context: null,
    courseName: null,
    setCourseName: (courseName) => set({ courseName }),
    notes: [],
    loading: false,
    panelOpen: false,
    areaMode: false,
    focusNoteId: null,
    pending: 0,

    setContext: (context) => {
      const previous = get().context?.slide_id;
      set({ context });
      if (context?.slide_id !== previous) set({ areaMode: false, focusNoteId: null });
    },

    load: async (slideId) => {
      const offlineCopy = mergeWithOutbox(readSlideCache(slideId), readOutbox(), slideId);
      set({ notes: offlineCopy, loading: true });
      const writesAtStart = localWrites;
      try {
        const server = await fetchSlideNotes(slideId);
        if (get().context?.slide_id !== slideId || localWrites !== writesAtStart) return;
        const merged = mergeWithOutbox(server, readOutbox(), slideId);
        writeSlideCache(slideId, merged);
        set({ notes: merged });
      } catch {
        // Offline or a hiccup: the device's copy is already showing.
      } finally {
        if (get().context?.slide_id === slideId) set({ loading: false });
      }
    },

    openPanel: (focusNoteId = null) => set({ panelOpen: true, focusNoteId }),
    closePanel: () => set({ panelOpen: false, areaMode: false, focusNoteId: null }),
    togglePanel: () => {
      if (get().panelOpen) get().closePanel();
      else get().openPanel();
    },
    setAreaMode: (on) => set({ areaMode: on }),
    clearFocus: () => set({ focusNoteId: null }),

    addNote: (fields) => {
      const context = get().context;
      if (!context) return null;
      const now = new Date().toISOString();
      const note: LearnerNote = {
        ...context,
        ...fields,
        id: uuidv4(),
        created_at: now,
        updated_at: now,
      };
      persist([...get().notes, note]);
      queueWrite({ op: "save", note });
      void get().sync();
      return note;
    },

    updateNote: (id, patch) => {
      const current = get().notes.find((note) => note.id === id);
      if (!current) return;
      const note = { ...current, ...patch, updated_at: new Date().toISOString() };
      persist(get().notes.map((item) => (item.id === id ? note : item)));
      queueWrite({ op: "save", note });
      void get().sync();
    },

    removeNote: (id) => {
      persist(get().notes.filter((note) => note.id !== id));
      queueWrite({ op: "delete", id });
      void get().sync();
    },

    sync: async () => {
      set({ pending: readOutbox().length });
      const result = await flushOutbox();
      set({ pending: result.pending });
      if (result.rejected > 0) {
        toast.error(i18n.t("saveRefused", { ns: "notebook" }));
      }
    },
  };
});
