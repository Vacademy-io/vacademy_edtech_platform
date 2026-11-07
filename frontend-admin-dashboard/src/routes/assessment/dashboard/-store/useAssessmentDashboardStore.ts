import { create } from 'zustand';
import { rangeForPreset } from '@/routes/study-library/live-session/-utils/dashboard-format';

/**
 * In-memory filters of the Assessment Dashboard page, so opening a test from
 * the dashboard and pressing back returns to the same view. Not persisted: a
 * hard refresh starts from the URL filters or the default range.
 */
interface AssessmentDashboardState {
    startDate: string;
    endDate: string;
    batchIds: string[];
    playModes: string[];

    setRange: (start: string, end: string) => void;
    setBatchIds: (ids: string[]) => void;
    setPlayModes: (modes: string[]) => void;
}

// A month by default: most institutes run a handful of tests a week.
const defaultRange = () => rangeForPreset('last30');

export const useAssessmentDashboardStore = create<AssessmentDashboardState>((set) => ({
    startDate: defaultRange().start,
    endDate: defaultRange().end,
    batchIds: [],
    playModes: [],

    setRange: (startDate, endDate) => set({ startDate, endDate }),
    setBatchIds: (batchIds) => set({ batchIds }),
    setPlayModes: (playModes) => set({ playModes }),
}));
