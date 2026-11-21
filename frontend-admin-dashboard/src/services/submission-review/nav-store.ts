import { create } from 'zustand';

/**
 * The ordered attempts the Submission page walks with Prev / Next (contract §9.1). Seeded
 * by whatever opened the page: the list's current page, the strip's "need marking" list,
 * or the "waiting for marking" list.
 */
export type SubmissionNavSource = 'list' | 'needs_marking' | 'waiting';

interface SubmissionNavState {
    assessmentId: string | null;
    attemptIds: string[];
    source: SubmissionNavSource;
    set: (assessmentId: string, attemptIds: string[], source: SubmissionNavSource) => void;
    clear: () => void;
}

export const useSubmissionNavStore = create<SubmissionNavState>((set) => ({
    assessmentId: null,
    attemptIds: [],
    source: 'list',
    set: (assessmentId, attemptIds, source) =>
        set({ assessmentId, attemptIds: attemptIds.filter(Boolean), source }),
    clear: () => set({ assessmentId: null, attemptIds: [], source: 'list' }),
}));

/** Prev / next around `current` in the walked list; null when it is not in it. */
export const neighboursOf = (
    ids: string[],
    current: string
): { prev: string | null; next: string | null; index: number } | null => {
    const index = ids.indexOf(current);
    if (index === -1) return null;
    return {
        prev: index > 0 ? ids[index - 1]! : null,
        next: index < ids.length - 1 ? ids[index + 1]! : null,
        index,
    };
};
