/**
 * Learner home builder access (spec 8.1, 12.1).
 *
 * Two gates, both needed:
 *  - FEATURE: `learner_home.builder`, a feature of the opt-in module
 *    `learner_home`. It reads as off (fail closed) in every mode until the
 *    institute's module row is switched on, the same as Commerce.
 *  - ROLE: institute ADMIN only. Teachers and custom roles never see it.
 *
 * This decides what the UI offers. The admin endpoints check both again.
 */
import type { SidebarItemsType } from '@/types/layout-container/layout-container-types';

export const LEARNER_HOME_MODULE_KEY = 'learner_home';
export const LEARNER_HOME_FEATURE = 'learner_home.builder';
export const LEARNER_HOME_NAV_ID = 'learner-home';
export const LEARNER_HOME_ROUTE = '/learner-home';

/** Drops the Learner home tab unless the institute has the feature. */
export function filterLearnerHomeSidebar(
    items: SidebarItemsType[],
    isFeatureOn: (featureKey: string) => boolean
): SidebarItemsType[] {
    if (isFeatureOn(LEARNER_HOME_FEATURE)) return items;
    return items.filter((item) => item.id !== LEARNER_HOME_NAV_ID);
}
