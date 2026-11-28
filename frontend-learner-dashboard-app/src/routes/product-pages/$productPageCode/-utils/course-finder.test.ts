import { describe, expect, it } from 'vitest';
import {
    FINDER_SKIPPED,
    finderCtaLabel,
    groupPackageSessionIds,
    isFinderUsable,
    mappingInGroup,
    parseCourseFinder,
    usableGroups,
} from './course-finder';
import type {
    ProductPageCourseFinder,
    ProductPageMappingResponse,
} from '../-types/product-page-types';

/**
 * The rules deciding which courses a "choose your class" button reveals.
 *
 * Shiksha Nation's scholarship tests are the case that shaped them: nine
 * courses, one per class, ALL on a single level called "Scholarship Test" with
 * the class only in the course name. Anything that groups by level name puts
 * all nine behind every button.
 */

const mapping = (
    packageSessionId: string,
    packageName: string,
    levelName: string,
    status = 'ACTIVE',
): ProductPageMappingResponse =>
    ({
        id: `map-${packageSessionId}`,
        ps_invite_payment_option_id: `bridge-${packageSessionId}`,
        enroll_invite_id: `inv-${packageSessionId}`,
        package_session_id: packageSessionId,
        payment_option_id: 'opt-1',
        payment_plan_id: 'plan-1',
        payment_plan: { actual_price: 0 },
        preselected: false,
        display_order: 0,
        status,
        package_name: packageName,
        level_name: levelName,
    }) as unknown as ProductPageMappingResponse;

/** The real shape: distinct courses, one shared level. */
const SN = [
    mapping('ps-6', 'UnlockX Scholarship Test - Class 6', 'Scholarship Test'),
    mapping('ps-7', 'UnlockX Scholarship Test - Class 7', 'Scholarship Test'),
    mapping('ps-8', 'UnlockX Scholarship Test - Class 8', 'Scholarship Test'),
];

const finderOf = (groups: ProductPageCourseFinder['groups']): ProductPageCourseFinder => ({
    enabled: true,
    groups,
});

describe('mappingInGroup', () => {
    it('matches on package_session_id', () => {
        const group = { id: 'g6', label: 'Class 6', packageSessionIds: ['ps-6'] };
        expect(mappingInGroup(SN[0]!, group)).toBe(true);
        expect(mappingInGroup(SN[1]!, group)).toBe(false);
    });

    it('matches on level name, case-insensitively, for level-modelled pages', () => {
        const group = { id: 'g', label: 'Class 6', levelNames: ['cyber ai- class 6'] };
        expect(mappingInGroup(mapping('x', 'Cyber AI', 'Cyber AI- Class 6'), group)).toBe(true);
    });

    it('prefers ids over level names when a group carries both', () => {
        // The level would match all three courses; the id must win, or every
        // button on an SN-shaped page reveals the whole catalogue.
        const group = {
            id: 'g6',
            label: 'Class 6',
            packageSessionIds: ['ps-6'],
            levelNames: ['Scholarship Test'],
        };
        expect(SN.filter((m) => mappingInGroup(m, group)).map((m) => m.package_session_id)).toEqual([
            'ps-6',
        ]);
    });

    it('matches nothing when a group names neither ids nor levels', () => {
        expect(SN.some((m) => mappingInGroup(m, { id: 'g', label: 'Empty' }))).toBe(false);
    });
});

describe('groupPackageSessionIds', () => {
    it('returns the ids the group actually covers on this page', () => {
        const group = { id: 'g', label: 'Senior', packageSessionIds: ['ps-7', 'ps-8', 'ps-99'] };
        // ps-99 is configured but not on the page — it must not reach the grid.
        expect(groupPackageSessionIds(group, SN)).toEqual(['ps-7', 'ps-8']);
    });
});

describe('usableGroups', () => {
    it('drops groups whose courses are not on the page', () => {
        const finder = finderOf([
            { id: 'g6', label: 'Class 6', packageSessionIds: ['ps-6'] },
            { id: 'g9', label: 'Class 9', packageSessionIds: ['ps-9'] },
        ]);
        expect(usableGroups(finder, SN).map((g) => g.id)).toEqual(['g6']);
    });

    it('drops unlabelled groups', () => {
        const finder = finderOf([
            { id: 'g6', label: '  ', packageSessionIds: ['ps-6'] },
            { id: 'g7', label: 'Class 7', packageSessionIds: ['ps-7'] },
        ]);
        expect(usableGroups(finder, SN).map((g) => g.id)).toEqual(['g7']);
    });

    it('ignores courses removed from the page', () => {
        const withDeleted = [...SN, mapping('ps-old', 'Last year', 'Scholarship Test', 'DELETED')];
        const finder = finderOf([{ id: 'gx', label: 'Old', packageSessionIds: ['ps-old'] }]);
        expect(usableGroups(finder, withDeleted)).toEqual([]);
    });

    it('keeps the authored order', () => {
        const finder = finderOf([
            { id: 'g8', label: 'Class 8', packageSessionIds: ['ps-8'] },
            { id: 'g6', label: 'Class 6', packageSessionIds: ['ps-6'] },
            { id: 'g7', label: 'Class 7', packageSessionIds: ['ps-7'] },
        ]);
        expect(usableGroups(finder, SN).map((g) => g.id)).toEqual(['g8', 'g6', 'g7']);
    });
});

describe('isFinderUsable', () => {
    it('is false for a null finder', () => {
        expect(isFinderUsable(null, SN)).toBe(false);
    });

    it('is false when only one group survives — a screen with one button', () => {
        const finder = finderOf([
            { id: 'g6', label: 'Class 6', packageSessionIds: ['ps-6'] },
            { id: 'g9', label: 'Class 9', packageSessionIds: ['ps-9'] },
        ]);
        expect(isFinderUsable(finder, SN)).toBe(false);
    });

    it('is true from two usable groups up', () => {
        const finder = finderOf([
            { id: 'g6', label: 'Class 6', packageSessionIds: ['ps-6'] },
            { id: 'g7', label: 'Class 7', packageSessionIds: ['ps-7'] },
        ]);
        expect(isFinderUsable(finder, SN)).toBe(true);
    });
});

describe('parseCourseFinder', () => {
    it('returns null for absent, malformed or disabled config', () => {
        expect(parseCourseFinder(null)).toBeNull();
        expect(parseCourseFinder('{not json')).toBeNull();
        expect(parseCourseFinder('{"defaultStep":"CATALOG"}')).toBeNull();
        expect(parseCourseFinder('{"courseFinder":{"enabled":false,"groups":[]}}')).toBeNull();
    });

    it('returns null when groups is missing, so the page never gates on nothing', () => {
        expect(parseCourseFinder('{"courseFinder":{"enabled":true}}')).toBeNull();
    });

    it('reads an enabled finder', () => {
        const json = JSON.stringify({
            defaultStep: 'CATALOG',
            courseFinder: {
                enabled: true,
                heading: 'Select your class',
                groups: [{ id: 'g6', label: 'Class 6', packageSessionIds: ['ps-6'] }],
            },
        });
        expect(parseCourseFinder(json)?.heading).toBe('Select your class');
    });
});

describe('FINDER_SKIPPED', () => {
    it('cannot collide with a real group id', () => {
        // Group ids are minted as `cf-<hex>`; the sentinel shares the same
        // storage slot, so an overlap would read a skip as a pick.
        expect(FINDER_SKIPPED.startsWith('cf-')).toBe(false);
        const finder = finderOf([
            { id: FINDER_SKIPPED, label: 'Class 6', packageSessionIds: ['ps-6'] },
        ]);
        // Even if an id somehow equalled it, the group still resolves normally —
        // the sentinel only means "skipped" when nothing matches it.
        expect(usableGroups(finder, SN).map((g) => g.id)).toEqual([FINDER_SKIPPED]);
    });
});

describe('finderCtaLabel', () => {
    const FALLBACK = 'Continue to register';

    it('uses the fallback when nothing is authored', () => {
        expect(finderCtaLabel(undefined, null, FALLBACK)).toBe(FALLBACK);
        expect(finderCtaLabel('   ', 'Class 9', FALLBACK)).toBe(FALLBACK);
    });

    it('names the pick', () => {
        expect(finderCtaLabel('Register for {{class}}', 'Class 9', FALLBACK)).toBe(
            'Register for Class 9'
        );
        expect(finderCtaLabel('Register for {{ CLASS }}', 'Class 12 NEET', FALLBACK)).toBe(
            'Register for Class 12 NEET'
        );
    });

    it('falls back before a pick rather than leaving "Register for "', () => {
        expect(finderCtaLabel('Register for {{class}}', null, FALLBACK)).toBe(FALLBACK);
        // A placeholder-only label has nothing left at all.
        expect(finderCtaLabel('{{class}}', null, FALLBACK)).toBe(FALLBACK);
    });

    it('leaves a static custom label alone, picked or not', () => {
        expect(finderCtaLabel('Go', null, FALLBACK)).toBe('Go');
        expect(finderCtaLabel('Go', 'Class 9', FALLBACK)).toBe('Go');
    });

    it('is not affected by the regex global flag across calls', () => {
        // A module-level /g regex carries lastIndex between .test() calls, which
        // makes every second check return false.
        expect(finderCtaLabel('Register for {{class}}', null, FALLBACK)).toBe(FALLBACK);
        expect(finderCtaLabel('Register for {{class}}', null, FALLBACK)).toBe(FALLBACK);
        expect(finderCtaLabel('Register for {{class}}', null, FALLBACK)).toBe(FALLBACK);
    });
});
