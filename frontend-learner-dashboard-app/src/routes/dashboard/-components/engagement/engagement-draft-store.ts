import { useMemo } from "react";
import { create } from "zustand";

/**
 * In-progress answers for engagement tasks, kept outside component state so they
 * survive the Today module switching slots on resize, the runner closing, and (for
 * written answers) a reload within the tab.
 *
 * - `selectedId`: the option picked but not yet checked (memory only).
 * - `text`: a written answer draft, mirrored to sessionStorage.
 * - `pinnedUpNextId`: the task the Today module keeps pinned as "Up next" after it
 *   was answered, until the learner moves on ("Next task").
 */

interface Draft {
  selectedId?: string;
  text?: string;
}

interface EngagementDraftState {
  drafts: Record<string, Draft>;
  pinnedUpNextId: string | null;
  setSelected: (itemId: string, optionId: string | undefined) => void;
  setText: (itemId: string, text: string) => void;
  clear: (itemId: string) => void;
  pinUpNext: (itemId: string) => void;
  releaseUpNext: () => void;
}

const TEXT_STORAGE_KEY = "vacademy.engagementDrafts.v1";
/** Keep the stored drafts small; older ones are dropped first. */
const MAX_STORED_DRAFTS = 20;

function readStoredText(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(TEXT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStoredText(drafts: Record<string, Draft>): void {
  try {
    const entries = Object.entries(drafts)
      .filter(([, d]) => typeof d.text === "string" && d.text.length > 0)
      .map(([id, d]) => [id, d.text as string] as const)
      .slice(-MAX_STORED_DRAFTS);
    if (entries.length === 0) sessionStorage.removeItem(TEXT_STORAGE_KEY);
    else sessionStorage.setItem(TEXT_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage unavailable or full: the draft still lives in memory.
  }
}

function initialDrafts(): Record<string, Draft> {
  const stored = readStoredText();
  const out: Record<string, Draft> = {};
  for (const [id, text] of Object.entries(stored)) out[id] = { text };
  return out;
}

export const useEngagementDraftStore = create<EngagementDraftState>((set, get) => ({
  drafts: initialDrafts(),
  pinnedUpNextId: null,

  setSelected: (itemId, optionId) =>
    set((s) => ({
      drafts: { ...s.drafts, [itemId]: { ...s.drafts[itemId], selectedId: optionId } },
    })),

  setText: (itemId, text) => {
    set((s) => ({
      drafts: { ...s.drafts, [itemId]: { ...s.drafts[itemId], text } },
    }));
    writeStoredText(get().drafts);
  },

  clear: (itemId) => {
    if (!(itemId in get().drafts)) return;
    set((s) => {
      const next = { ...s.drafts };
      delete next[itemId];
      return { drafts: next };
    });
    writeStoredText(get().drafts);
  },

  pinUpNext: (itemId) => set({ pinnedUpNextId: itemId }),
  releaseUpNext: () => set({ pinnedUpNextId: null }),
}));

/** One task's draft plus its setters. Stable callbacks; re-renders only on this item's changes. */
export function useEngagementDraft(itemId: string): {
  selectedId?: string;
  text?: string;
  setSelected: (id: string | undefined) => void;
  setText: (t: string) => void;
  clear: () => void;
} {
  const selectedId = useEngagementDraftStore((s) => s.drafts[itemId]?.selectedId);
  const text = useEngagementDraftStore((s) => s.drafts[itemId]?.text);
  const actions = useMemo(() => {
    const store = useEngagementDraftStore.getState();
    return {
      setSelected: (id: string | undefined) => store.setSelected(itemId, id),
      setText: (t: string) => store.setText(itemId, t),
      clear: () => store.clear(itemId),
    };
  }, [itemId]);
  return { selectedId, text, ...actions };
}

/** The pinned "Up next" task id and its controls. */
export function usePinnedUpNext(): {
  pinnedId: string | null;
  pin: (itemId: string) => void;
  release: () => void;
} {
  const pinnedId = useEngagementDraftStore((s) => s.pinnedUpNextId);
  const { pinUpNext, releaseUpNext } = useEngagementDraftStore.getState();
  return { pinnedId, pin: pinUpNext, release: releaseUpNext };
}
