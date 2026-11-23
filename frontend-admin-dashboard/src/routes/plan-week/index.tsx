import { createFileRoute } from '@tanstack/react-router';
import { PlanWeekPage } from './-components/PlanWeekPage';

// Public: opened from the weekly planning email. The token in ?t= can only read this
// one request and send this week's topics; it never signs anyone in.
export const Route = createFileRoute('/plan-week/')({
    validateSearch: (search: Record<string, unknown>) => ({
        t: typeof search.t === 'string' ? search.t : undefined,
    }),
    component: PlanWeekRoute,
});

function PlanWeekRoute() {
    const { t } = Route.useSearch();
    return <PlanWeekPage token={t} />;
}
