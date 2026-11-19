import { createFileRoute } from '@tanstack/react-router';
import { validateAuditSearch } from '../-shared/report-search';

/** Audit log: tab and filters live in the address. */
export const Route = createFileRoute('/commerce/reports/audit/')({
    validateSearch: validateAuditSearch,
});
