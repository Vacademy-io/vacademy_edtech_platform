import { create } from 'zustand';

/**
 * Where the teacher was in the Submissions tab, so Back from the Submission page lands on
 * the same page, filters and search instead of page 1 of the unfiltered list. The tab keeps
 * all of this in component state, which is lost when the route changes.
 *
 * Kept in memory only (a reload starts fresh). The tab saves its place on every change;
 * opening the Submission page marks "coming back"; the tab's next mount reads the place
 * once, for the same assessment only, and clears the mark.
 */
export interface SubmissionsListPlace<Filter = unknown> {
    page: number;
    pageSize: number;
    /** The filter state the toolbar shows (may hold picks not yet applied). */
    selectedFilter: Filter;
    /** The exact filter behind the rows on screen (tab source and attempt type included). */
    listedFilter: Filter;
    searchText: string;
    selectedTab: string;
    selectedParticipantsTab: string;
    batchSelectionTab: string;
}

interface ListReturnState {
    saved: { assessmentId: string; place: SubmissionsListPlace } | null;
    returning: boolean;
    save: (assessmentId: string, place: SubmissionsListPlace) => void;
    /** Called when the Submission page is opened. */
    markLeaving: () => void;
    /** Called once the tab has mounted: the place is used at most once. */
    clearReturning: () => void;
}

export const useSubmissionsListReturnStore = create<ListReturnState>((set) => ({
    saved: null,
    returning: false,
    save: (assessmentId, place) => set({ saved: { assessmentId, place } }),
    markLeaving: () => set({ returning: true }),
    clearReturning: () => set({ returning: false }),
}));

/**
 * The place to restore for this assessment, or null. Pure (no writes), so it is safe in a
 * useState initializer, which React may call twice in development.
 */
export const placeToRestore = <Filter>(assessmentId: string): SubmissionsListPlace<Filter> | null => {
    const { saved, returning } = useSubmissionsListReturnStore.getState();
    if (!returning || !saved || saved.assessmentId !== assessmentId) return null;
    return saved.place as SubmissionsListPlace<Filter>;
};
