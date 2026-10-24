import { create } from 'zustand';
import { rangeForPreset } from '../-utils/dashboard-format';

/**
 * In-memory filters of the Live Session Dashboard page, so opening a class from
 * the dashboard and pressing back returns to the same view. Not persisted: a
 * hard refresh starts from the URL filters or the default range.
 */
interface LiveClassDashboardState {
    startDate: string;
    endDate: string;
    batchIds: string[];
    teacherIds: string[];

    setRange: (start: string, end: string) => void;
    setBatchIds: (ids: string[]) => void;
    setTeacherIds: (ids: string[]) => void;
}

const defaultRange = () => rangeForPreset('last7');

export const useLiveClassDashboardStore = create<LiveClassDashboardState>((set) => ({
    startDate: defaultRange().start,
    endDate: defaultRange().end,
    batchIds: [],
    teacherIds: [],

    setRange: (startDate, endDate) => set({ startDate, endDate }),
    setBatchIds: (batchIds) => set({ batchIds }),
    setTeacherIds: (teacherIds) => set({ teacherIds }),
}));
