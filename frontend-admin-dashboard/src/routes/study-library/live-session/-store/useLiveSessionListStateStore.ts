import { create } from 'zustand';
import { SessionStatus } from '../-constants/enums';
import { type SelectOption } from '@/components/design-system/SelectChips';
import i18n from '@/i18n';

// This store is created outside any React render tree, so useTranslation()
// isn't available here — use the shared i18next singleton directly with a
// fixed namespace (same pattern as studyLibraryAssessmentToHtml). Not
// reactive to a runtime language switch without a remount of whatever reads
// ALL_BATCHES_OPTION's label — accepted tradeoff for this module-scope value.
const NAMESPACE = 'studyLibraryUseLiveSessionListStateStore';

/**
 * In-memory cache of the Live-Session list page's browsing state — tab,
 * pagination AND every committed filter — so that navigating to a class detail
 * and pressing browser-back returns the admin to exactly the view they left.
 *
 * Previously only tab + page lived here, so the filters were rebuilt from
 * scratch on the way back: the admin returned to a page index that belonged to
 * a filtered result set which no longer existed, which read as "everything
 * reset".
 *
 * State is only cleared by an explicit user action:
 *   - "Clear all" in the filter bar -> `clearFilters()`
 *   - switching tabs               -> `setSelectedTab()`
 *
 * Intentionally NOT persisted (no localStorage / sessionStorage middleware) —
 * a hard refresh resets to the Live tab + page 0 with no filters by design.
 */

export const ALL_BATCHES_OPTION: SelectOption = {
    label: i18n.t('allBatches', { ns: NAMESPACE }),
    value: 'all',
};

type Updater<T> = T | ((prev: T) => T);

const resolve = <T>(updater: Updater<T>, prev: T): T =>
    typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;

/** Committed filters — the values the search request is actually built from. */
export interface LiveSessionListFilters {
    searchQuery: string;
    startDate: Date | undefined;
    endDate: Date | undefined;
    meetingTypeFilter: string;
    subjectFilter: string[];
    accessFilter: string;
    streamingServiceFilter: string;
    startTimeOfDay: string;
    endTimeOfDay: string;
    selectedBatches: SelectOption[];
}

export const createDefaultLiveSessionFilters = (): LiveSessionListFilters => ({
    searchQuery: '',
    startDate: undefined,
    endDate: undefined,
    meetingTypeFilter: '',
    subjectFilter: [],
    accessFilter: '',
    streamingServiceFilter: '',
    startTimeOfDay: '',
    endTimeOfDay: '',
    selectedBatches: [ALL_BATCHES_OPTION],
});

interface LiveSessionListState extends LiveSessionListFilters {
    selectedTab: SessionStatus;
    currentPage: number;

    /** Switching tabs starts a fresh browse: filters and page are dropped. */
    setSelectedTab: (tab: SessionStatus) => void;
    setCurrentPage: (updater: Updater<number>) => void;

    setSearchQuery: (updater: Updater<string>) => void;
    setStartDate: (updater: Updater<Date | undefined>) => void;
    setEndDate: (updater: Updater<Date | undefined>) => void;
    setMeetingTypeFilter: (updater: Updater<string>) => void;
    setSubjectFilter: (updater: Updater<string[]>) => void;
    setAccessFilter: (updater: Updater<string>) => void;
    setStreamingServiceFilter: (updater: Updater<string>) => void;
    setStartTimeOfDay: (updater: Updater<string>) => void;
    setEndTimeOfDay: (updater: Updater<string>) => void;
    setSelectedBatches: (updater: Updater<SelectOption[]>) => void;

    /** "Clear all" in the filter bar. Keeps the current tab. */
    clearFilters: () => void;
}

export const useLiveSessionListStateStore = create<LiveSessionListState>((set) => ({
    selectedTab: SessionStatus.LIVE,
    currentPage: 0,
    ...createDefaultLiveSessionFilters(),

    setSelectedTab: (tab) =>
        set({ selectedTab: tab, currentPage: 0, ...createDefaultLiveSessionFilters() }),
    setCurrentPage: (updater) => set((s) => ({ currentPage: resolve(updater, s.currentPage) })),

    setSearchQuery: (updater) => set((s) => ({ searchQuery: resolve(updater, s.searchQuery) })),
    setStartDate: (updater) => set((s) => ({ startDate: resolve(updater, s.startDate) })),
    setEndDate: (updater) => set((s) => ({ endDate: resolve(updater, s.endDate) })),
    setMeetingTypeFilter: (updater) =>
        set((s) => ({ meetingTypeFilter: resolve(updater, s.meetingTypeFilter) })),
    setSubjectFilter: (updater) =>
        set((s) => ({ subjectFilter: resolve(updater, s.subjectFilter) })),
    setAccessFilter: (updater) => set((s) => ({ accessFilter: resolve(updater, s.accessFilter) })),
    setStreamingServiceFilter: (updater) =>
        set((s) => ({ streamingServiceFilter: resolve(updater, s.streamingServiceFilter) })),
    setStartTimeOfDay: (updater) =>
        set((s) => ({ startTimeOfDay: resolve(updater, s.startTimeOfDay) })),
    setEndTimeOfDay: (updater) => set((s) => ({ endTimeOfDay: resolve(updater, s.endTimeOfDay) })),
    setSelectedBatches: (updater) =>
        set((s) => ({ selectedBatches: resolve(updater, s.selectedBatches) })),

    clearFilters: () => set({ currentPage: 0, ...createDefaultLiveSessionFilters() }),
}));
