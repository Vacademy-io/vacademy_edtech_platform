import { createFileRoute } from '@tanstack/react-router';

/**
 * ?session = the scan session being worked on; examType / assessmentType / tab
 * = the Submissions tab's route params, so "Start checking" can go back there.
 */
export interface ScanStationSearch {
    session?: string;
    examType?: string;
    assessmentType?: string;
    tab?: string;
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

// Route definition only - the page is lazy loaded from index.lazy.tsx
export const Route = createFileRoute('/assessment/assessment-list/scan-station/$assessmentId/')({
    validateSearch: (search: Record<string, unknown>): ScanStationSearch => ({
        session: text(search.session),
        examType: text(search.examType),
        assessmentType: text(search.assessmentType),
        tab: text(search.tab),
    }),
});
