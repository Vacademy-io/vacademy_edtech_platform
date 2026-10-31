import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { isCallerSubOrgAdmin } from '@/lib/auth/facultyAccessUtils';
import { useNavSnapshotStore } from '@/lib/capabilities/use-entitlement';
import { handleGetAdminDetails } from '@/services/student-list-section/getAdminDetails';
import { CrmDashboard } from './CrmDashboard';

/** How long to wait for the sidebar before falling back to the existing dashboard. */
const SIDEBAR_WAIT_MS = 4000;

/**
 * Picks the home page: the CRM Dashboard for people who work in the CRM (their
 * sidebar has an unlocked Leads tab), otherwise the existing dashboard exactly as
 * before (`legacy`). Sub-org admins keep the existing dashboard — its widgets are
 * all about their own sub-org — and so does anyone the CRM Dashboard refuses.
 *
 * Waits for the sidebar built from the role's own display settings, so a role that
 * hides Leads never mounts the CRM Dashboard on its way to the old one.
 */
export function DashboardSwitch({ legacy }: { legacy: React.ReactNode }) {
    const instituteId = getCurrentInstituteId();
    const snapshot = useNavSnapshotStore((s) => s.snapshot);
    const ready = !!snapshot && snapshot.instituteId === instituteId && !!snapshot.settingsReady;
    const subOrgAdmin = isCallerSubOrgAdmin();
    const useCrm =
        ready && !subOrgAdmin && snapshot.items.some((item) => item.id === 'leads' && !item.locked);

    const [timedOut, setTimedOut] = useState(false);
    useEffect(() => {
        if (ready) return;
        const id = window.setTimeout(() => setTimedOut(true), SIDEBAR_WAIT_MS);
        return () => window.clearTimeout(id);
    }, [ready]);

    const { data: admin } = useQuery({ ...handleGetAdminDetails(), enabled: useCrm });

    if (subOrgAdmin) return <>{legacy}</>;
    if (!ready && !timedOut) {
        return (
            <div className="flex flex-col gap-4">
                <Skeleton className="h-10 w-64 rounded-lg" />
                <Skeleton className="h-52 rounded-xl" />
            </div>
        );
    }
    if (!useCrm) return <>{legacy}</>;
    const first = admin?.full_name?.split(' ')?.[0] || admin?.full_name || undefined;
    return <CrmDashboard displayName={first} fallback={legacy} />;
}
