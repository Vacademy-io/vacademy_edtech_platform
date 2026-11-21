import { createFileRoute } from '@tanstack/react-router';
import { validateReportsSearch } from './-shared/report-search';

/** Reports home, or one report when `report` is in the address; every filter lives in the address. */
export const Route = createFileRoute('/commerce/reports/')({
    validateSearch: validateReportsSearch,
});
