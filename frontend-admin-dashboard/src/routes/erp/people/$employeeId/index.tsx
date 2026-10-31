import { createFileRoute } from '@tanstack/react-router';

import { EMPLOYEE_DETAIL_TABS, type EmployeeDetailTab } from '../-components/EmployeeFields';

// Route definition only — the component is lazy loaded from index.lazy.tsx.
export const Route = createFileRoute('/erp/people/$employeeId/')({
    // ?tab=salary deep-links straight to a tab, so "what is this person paid" is a
    // shareable URL instead of something you have to click your way back to.
    validateSearch: (search: Record<string, unknown>): { tab?: EmployeeDetailTab } => {
        const tab = search.tab;
        return EMPLOYEE_DETAIL_TABS.includes(tab as EmployeeDetailTab)
            ? { tab: tab as EmployeeDetailTab }
            : {};
    },
});
