import { useMemo } from 'react';
import { create } from 'zustand';
import { useCapabilities } from '@/services/capabilities';
import { useCapabilityCatalog } from '@/services/capability-catalog';
import { getSidebarItemsData } from '@/components/common/layout-container/sidebar/utils';
import type { SidebarItemsType } from '@/types/layout-container/layout-container-types';
import { createEntitlement, FULL_ENTITLEMENT, type Entitlement } from './entitlement';
import type { CategoryState } from './nav-access';

/**
 * The current institute's entitlement. FULL_ENTITLEMENT (nothing gated) unless
 * `/capabilities/me` is loaded for this institute, says MANAGED, and the
 * catalogue loaded — so LEGACY institutes never even request the catalogue.
 */
export function useEntitlement(): Entitlement {
    const { mode, can, isLoaded } = useCapabilities();
    const managed = isLoaded && mode === 'MANAGED';
    const { data: catalog } = useCapabilityCatalog(managed);
    return useMemo(
        () =>
            managed && catalog
                ? createEntitlement({ catalog, can, staticItems: getSidebarItemsData() })
                : FULL_ENTITLEMENT,
        [managed, catalog, can]
    );
}

/**
 * The sidebar as the user sees it, published by MySidebar for the route guard
 * and anything else that must agree with it (role- and entitlement-filtered).
 * null until the sidebar has computed it with the role's settings loaded.
 */
export interface NavSnapshot {
    instituteId: string;
    items: SidebarItemsType[];
    sidebarCategories: CategoryState[] | null;
    /** True once the role's display settings were applied (false = still the defaults). */
    settingsReady?: boolean;
}

export const useNavSnapshotStore = create<{
    snapshot: NavSnapshot | null;
    setSnapshot: (snapshot: NavSnapshot | null) => void;
}>((set) => ({
    snapshot: null,
    setSnapshot: (snapshot) => set({ snapshot }),
}));
