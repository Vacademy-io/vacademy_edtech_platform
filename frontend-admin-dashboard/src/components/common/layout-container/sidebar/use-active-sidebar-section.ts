import { useMemo } from 'react';
import { useLocation } from '@tanstack/react-router';
import { useNavSnapshotStore } from '@/lib/capabilities/use-entitlement';
import { pickActiveSidebarLink } from './helper';

export interface ActiveSidebarSection {
    link: string;
    /** The sub-item's label, or the tab's when the tab itself is the link. */
    label: string;
    /** The tab a sub-item sits under ("Enquiry"). */
    parentLabel?: string;
}

/**
 * The sidebar entry (built-in or custom tab, sub-item or tab) the user is on, so
 * a page can say WHICH list it is. Several sub-tabs open the same page with a
 * different query — I2CAN's Untouched, Processed and All Leads are all Recent
 * Leads — and the page title alone can't tell them apart.
 */
export function useActiveSidebarSection(): ActiveSidebarSection | null {
    const snapshot = useNavSnapshotStore((s) => s.snapshot);
    const { pathname, search } = useLocation();

    return useMemo(() => {
        if (!snapshot) return null;
        const entries: ActiveSidebarSection[] = [];
        for (const item of snapshot.items) {
            if (item.locked) continue;
            if (item.showForInstitute && item.showForInstitute !== snapshot.instituteId) continue;
            if (item.to) entries.push({ link: item.to, label: item.title });
            for (const sub of item.subItems ?? []) {
                if (!sub.subItemLink || sub.locked || !sub.subItem) continue;
                entries.push({
                    link: sub.subItemLink,
                    label: sub.subItem,
                    parentLabel: item.title,
                });
            }
        }
        const link = pickActiveSidebarLink(
            entries.map((e) => e.link),
            pathname,
            search as Record<string, unknown>
        );
        return entries.find((e) => e.link === link) ?? null;
    }, [snapshot, pathname, search]);
}
