import { create } from 'zustand';
import { DoubtFilter } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

// Zustand store for doubt filters
interface DoubtFilterStore {
    filters: DoubtFilter;
    updateFilters: (filters: Partial<DoubtFilter>) => void;
    resetFilters: () => void;
}

const defaultFilters: DoubtFilter = {
    name: '',
    start_date: '',
    end_date: '',
    user_ids: [],
    content_positions: [],
    content_types: [],
    sources: [],
    source_ids: [],
    status: [],
    types: [],
    batch_ids: [],
    assignee_user_ids: [],
    unassigned_only: false,
    workflow_statuses: [],
    // Seed at store creation so the first inbox query is already institute-scoped — avoids the
    // mount-time fetch with a blank institute (which returns an empty page) + a second refetch.
    institute_id: getCurrentInstituteId() ?? '',
    // Newest query first. Without an explicit sort the backend pages an unordered result set, so the
    // inbox showed the oldest doubts on top and rows could repeat/skip across pages.
    sort_columns: { raised_time: 'DESC' },
};

export const useDoubtFilters = create<DoubtFilterStore>((set) => ({
    filters: defaultFilters,
    updateFilters: (newFilters) =>
        set((state) => ({
            filters: { ...state.filters, ...newFilters },
        })),
    resetFilters: () => set({ filters: defaultFilters }),
}));
