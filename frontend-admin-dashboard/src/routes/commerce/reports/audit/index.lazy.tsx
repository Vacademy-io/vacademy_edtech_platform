import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { AuditLogPage } from '@/routes/commerce/reports/audit/-components/AuditLogPage';

/** WP-51: who changed what (audit rows) and approvals given with a manager's PIN. */
export const Route = createLazyFileRoute('/commerce/reports/audit/')({
    component: () => (
        <LayoutContainer>
            <AuditLogPage />
        </LayoutContainer>
    ),
});
