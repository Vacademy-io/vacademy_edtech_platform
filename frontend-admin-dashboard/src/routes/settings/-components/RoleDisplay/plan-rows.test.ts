import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    // Node's unconfigured Web Storage global shadows happy-dom's here.
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
            setItem: (k: string, v: string) => void store.set(k, String(v)),
            removeItem: (k: string) => void store.delete(k),
            clear: () => store.clear(),
        },
        configurable: true,
        writable: true,
    });
});

import { getSidebarItemsData } from '@/components/common/layout-container/sidebar/utils';
import { createEntitlement, FULL_ENTITLEMENT } from '@/lib/capabilities/entitlement';
import { canForModules, CRM_ONLY_MODULES, loadRealCatalog } from '@/lib/capabilities/test-support';
import {
    createPlanRowFilter,
    DISPLAY_CARD_FEATURES,
    DISPLAY_SECTION_CARDS,
    SIDE_VIEW_TAB_FEATURES,
    visibleSectionGroups,
    type DisplayCardId,
} from './plan-rows';

const catalog = loadRealCatalog();
const staticItems = getSidebarItemsData();
const roleTabs = staticItems.map((i) => ({ id: i.id, category: i.category }));

describe('Display Settings plan rows', () => {
    it('LEGACY shows every row and no note', () => {
        const rows = createPlanRowFilter(FULL_ENTITLEMENT, staticItems);
        expect(rows.managed).toBe(false);
        expect(rows.hidesSomething).toBe(false);
        staticItems.forEach((i) => {
            expect(rows.tab(i.id)).toBe(true);
            i.subItems?.forEach((s) => expect(rows.subTab(i.id, s.subItemId)).toBe(true));
        });
        ['CRM', 'LMS', 'AI', 'ERP'].forEach((c) => expect(rows.category(c, roleTabs)).toBe(true));
        expect(rows.widget('learningCenter')).toBe(true);
    });

    it('MANAGED with everything on hides nothing', () => {
        const rows = createPlanRowFilter(
            createEntitlement({ catalog, can: () => true, staticItems }),
            staticItems
        );
        expect(rows.managed).toBe(true);
        expect(rows.hidesSomething).toBe(false);
    });

    it('MANAGED CRM-only hides LMS/AI/ERP rows, keeps custom ones', () => {
        const rows = createPlanRowFilter(
            createEntitlement({
                catalog,
                can: canForModules(catalog, CRM_ONLY_MODULES),
                staticItems,
            }),
            staticItems
        );
        expect(rows.hidesSomething).toBe(true);
        expect(rows.tab('courses')).toBe(false);
        expect(rows.tab('leads')).toBe(true);
        expect(rows.tab('custom-123')).toBe(true);
        expect(rows.subTab('manage-institute', 'batches')).toBe(false);
        expect(rows.subTab('manage-institute', 'teams')).toBe(true);
        expect(rows.subTab('leads', 'custom-sub-1')).toBe(true);
        expect(rows.category('CRM', roleTabs)).toBe(true);
        expect(rows.category('LMS', roleTabs)).toBe(false);
        expect(rows.category('AI', roleTabs)).toBe(false);
        expect(rows.category('ERP', roleTabs)).toBe(false);
        // the admin's own custom tab keeps its category row
        expect(
            rows.category('LMS', [...roleTabs, { id: 'custom-9', category: 'LMS', isCustom: true }])
        ).toBe(true);
        expect(rows.widget('learningCenter')).toBe(false);
        expect(rows.widget('financeSummary')).toBe(true);
        expect(rows.widget('pendingActions')).toBe(true);
    });

    describe('editor cards, sections and side-view rows', () => {
        const knownFeatures = new Set(catalog.modules.flatMap((m) => m.features.map((f) => f.key)));
        const sectionGroups = [
            {
                sections: Object.keys(DISPLAY_SECTION_CARDS).map((id) => ({ id, label: id })),
            },
        ];
        const rowsFor = (modules: string[]) =>
            createPlanRowFilter(
                createEntitlement({ catalog, can: canForModules(catalog, modules), staticItems }),
                staticItems
            );

        it('maps to real catalogue features', () => {
            [...Object.values(DISPLAY_CARD_FEATURES), ...Object.values(SIDE_VIEW_TAB_FEATURES)]
                .flat()
                .forEach((f) => expect(knownFeatures.has(f as string), f as string).toBe(true));
        });

        it('LEGACY shows every card, section and side-view row; section list untouched', () => {
            const rows = createPlanRowFilter(FULL_ENTITLEMENT, staticItems);
            (Object.keys(DISPLAY_CARD_FEATURES) as DisplayCardId[]).forEach((c) =>
                expect(rows.card(c)).toBe(true)
            );
            Object.keys(DISPLAY_SECTION_CARDS).forEach((id) => expect(rows.section(id)).toBe(true));
            expect(rows.sideViewTab('coursesTab')).toBe(true);
            expect(visibleSectionGroups(sectionGroups, rows)).toBe(sectionGroups);
        });

        it('CRM-only (finance off too): LMS cards and rows go, Courses & Permissions keeps lead actions', () => {
            const rows = rowsFor(['crm', 'communications', 'automation', 'website']);
            (
                [
                    'courseCards',
                    'courseContentTypes',
                    'learnerListColumns',
                    'studentManagementActions',
                    'assessmentActions',
                    'liveClassActions',
                ] as DisplayCardId[]
            ).forEach((c) => expect(rows.card(c), c).toBe(false));
            expect(rows.card('leadActions')).toBe(true);
            expect(rows.section('grp-courses')).toBe(true);
            expect(rows.section('grp-learners')).toBe(true);
            expect(visibleSectionGroups(sectionGroups, rows)).toBe(sectionGroups);
            (
                ['coursesTab', 'progressTab', 'reportsTab', 'enrollDerollTab', 'testTab'] as const
            ).forEach((k) => expect(rows.sideViewTab(k), k).toBe(false));
            (
                [
                    'overviewTab',
                    'leadTab',
                    'enquiryTab',
                    'membershipTab',
                    'notificationTab',
                ] as const
            ).forEach((k) => expect(rows.sideViewTab(k), k).toBe(true));
        });

        it('LMS on, assessments and live classes off: only those cards go', () => {
            const rows = rowsFor(['lms', 'crm']);
            expect(rows.card('courseCards')).toBe(true);
            expect(rows.card('assessmentActions')).toBe(false);
            expect(rows.card('liveClassActions')).toBe(false);
            expect(rows.sideViewTab('coursesTab')).toBe(true);
            expect(rows.sideViewTab('testTab')).toBe(false);
        });

        it('a section left empty is dropped, so the editor opens on the first one with content', () => {
            const rows = rowsFor(['erp']); // no LMS, assessments, live classes or CRM
            expect(rows.section('grp-courses')).toBe(false);
            const groups = visibleSectionGroups(sectionGroups, rows);
            expect(groups.flatMap((g) => g.sections.map((s) => s.id))).toEqual([
                'grp-layout',
                'grp-learners',
                'grp-access',
            ]);
        });
    });
});
