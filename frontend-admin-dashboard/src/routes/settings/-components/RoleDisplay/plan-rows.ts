import { useMemo } from 'react';
import type { Entitlement } from '@/lib/capabilities/entitlement';
import { useEntitlement } from '@/lib/capabilities/use-entitlement';
import { getSidebarItemsData } from '@/components/common/layout-container/sidebar/utils';
import type { SidebarItemsType } from '@/types/layout-container/layout-container-types';
import type { StudentSideViewVisibilityKey } from '@/types/display-settings';
import type { SettingsSectionGroup } from '@/components/settings/shell';

/**
 * Editor cards the catalogue does not list itself, mapped to the features that
 * own the pages they configure (several = all must be on). Only clearly
 * module-bound cards are listed; everything else is ungoverned and always shown.
 */
export const DISPLAY_CARD_FEATURES = {
    // Course page, course permission (incl. slide view actions), authored / course
    // list cards, course creation, course list tabs, course details tabs.
    courseCards: ['lms.courses'],
    // Content types offered when adding slides.
    courseContentTypes: ['lms.courses'],
    // Learner list page (/manage-students/students-list) columns and header buttons.
    learnerListColumns: ['lms.batches'],
    studentManagementActions: ['lms.batches'],
    assessmentActions: ['assessments.tests'],
    liveClassActions: ['live_classes.sessions'],
    leadActions: ['crm.leads'],
} as const satisfies Record<string, readonly string[]>;

export type DisplayCardId = keyof typeof DISPLAY_CARD_FEATURES;

/** Marks a section that also holds ungoverned content (never empty). */
export const UNGOVERNED_CONTENT = 'ungoverned' as const;

/**
 * What each editor section (SettingsSectionsLayout tab) holds, in the three role
 * editors. A section is shown when any of its cards is; the first shown one opens.
 */
export const DISPLAY_SECTION_CARDS: Readonly<
    Record<string, ReadonlyArray<DisplayCardId | typeof UNGOVERNED_CONTENT>>
> = {
    'grp-courses': ['courseCards', 'assessmentActions', 'liveClassActions', 'leadActions'],
    'grp-layout': [UNGOVERNED_CONTENT],
    'grp-learners': [
        'courseContentTypes',
        'learnerListColumns',
        'studentManagementActions',
        UNGOVERNED_CONTENT,
    ],
    'grp-access': [UNGOVERNED_CONTENT],
};

/**
 * Learner side-view tabs that only exist with an LMS-side module. Membership,
 * payments, CRM and contact tabs are not listed (shown in every plan).
 */
export const SIDE_VIEW_TAB_FEATURES: Partial<
    Record<StudentSideViewVisibilityKey, readonly string[]>
> = {
    coursesTab: ['lms.courses'],
    progressTab: ['lms.courses'],
    reportsTab: ['lms.reports'],
    enrollDerollTab: ['lms.batches'],
    testTab: ['assessments.tests'],
};

/**
 * Which Display Settings rows the editor SHOWS for the institute's plan
 * (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §3, §9: entitlement is a ceiling the
 * institute admin cannot raise).
 *
 * Only rendering is filtered. A row that is not shown keeps its stored values —
 * save writes the whole blob back unchanged for it — and the move buttons skip
 * it, so not even its `order` is touched. LEGACY: every row is shown.
 */
export interface PlanRowFilter {
    /** True when rows may be hidden (MANAGED + catalogue loaded). */
    managed: boolean;
    /** Some built-in tab or sub-tab is outside the plan → show the editor note. */
    hidesSomething: boolean;
    tab: (tabId: string) => boolean;
    subTab: (tabId: string, subId: string) => boolean;
    /**
     * A rail category is shown when at least one of the role's tabs in it is
     * (custom tabs count — they are the admin's own).
     */
    category: (
        categoryId: string,
        tabs: ReadonlyArray<{ id: string; category?: string; isCustom?: boolean }>
    ) => boolean;
    widget: (widgetId: string) => boolean;
    /** An editor card bound to a module (DISPLAY_CARD_FEATURES). */
    card: (cardId: DisplayCardId) => boolean;
    /** An editor section with at least one card left to show. */
    section: (sectionId: string) => boolean;
    /** A row of the learner side-view card (SIDE_VIEW_TAB_FEATURES). */
    sideViewTab: (key: StudentSideViewVisibilityKey) => boolean;
}

const SHOW_ALL: PlanRowFilter = Object.freeze({
    managed: false,
    hidesSomething: false,
    tab: () => true,
    subTab: () => true,
    category: () => true,
    widget: () => true,
    card: () => true,
    section: () => true,
    sideViewTab: () => true,
});

export function createPlanRowFilter(
    entitlement: Entitlement,
    staticItems: SidebarItemsType[]
): PlanRowFilter {
    if (!entitlement.managed) return SHOW_ALL;
    const categoryOf = new Map(staticItems.map((i) => [i.id, i.category || 'CRM']));
    const tab = (tabId: string) => !categoryOf.has(tabId) || entitlement.isNavItemEntitled(tabId);
    const hidesSomething = staticItems.some(
        (i) =>
            !entitlement.isNavItemEntitled(i.id) ||
            (i.subItems || []).some((s) => !entitlement.isNavItemEntitled(i.id, s.subItemId))
    );
    const allOn = (features: readonly string[] | undefined) =>
        (features ?? []).every((f) => entitlement.isFeatureOn(f));
    const card = (cardId: DisplayCardId) => allOn(DISPLAY_CARD_FEATURES[cardId]);
    return {
        managed: true,
        hidesSomething,
        tab,
        subTab: (tabId, subId) => entitlement.isNavItemEntitled(tabId, subId),
        category: (categoryId, tabs) =>
            tabs.some(
                (t) => (categoryOf.get(t.id) || t.category || 'CRM') === categoryId && tab(t.id)
            ),
        widget: (widgetId) => entitlement.isWidgetEntitled(widgetId),
        card,
        section: (sectionId) => {
            const contents = DISPLAY_SECTION_CARDS[sectionId];
            return !contents || contents.some((c) => c === UNGOVERNED_CONTENT || card(c));
        },
        sideViewTab: (key) => allOn(SIDE_VIEW_TAB_FEATURES[key]),
    };
}

/**
 * The editor's section tabs without the ones the plan leaves empty. Returns the
 * same array when nothing is dropped (LEGACY), so memoised layouts stay stable.
 */
export function visibleSectionGroups(
    groups: SettingsSectionGroup[],
    rows: PlanRowFilter
): SettingsSectionGroup[] {
    if (groups.every((g) => g.sections.every((s) => rows.section(s.id)))) return groups;
    return groups
        .map((g) => ({ ...g, sections: g.sections.filter((s) => rows.section(s.id)) }))
        .filter((g) => g.sections.length > 0);
}

export function usePlanRowFilter(): PlanRowFilter {
    const entitlement = useEntitlement();
    return useMemo(
        () =>
            entitlement.managed
                ? createPlanRowFilter(entitlement, getSidebarItemsData())
                : SHOW_ALL,
        [entitlement]
    );
}
