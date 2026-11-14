import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { bundleForRoles } from './dashboard-role-bundles';
import { quickActionsForRoles } from './dashboard-quick-actions';

describe('bundleForRoles', () => {
    it('gives ADMIN the admin bundle (finance snapshot on)', () => {
        expect(bundleForRoles(['TEACHER', 'ADMIN']).showFinanceSummary).toBe(true);
    });

    it('never falls back to the admin bundle for an unknown/custom role', () => {
        const bundle = bundleForRoles(['COUNSELLOR']);
        expect(bundle.showFinanceSummary).toBe(false);
        expect(bundle).toEqual(bundleForRoles(['TEACHER']));
    });

    it('falls back to the teacher bundle when there are no roles', () => {
        expect(bundleForRoles([])).toEqual(bundleForRoles(['TEACHER']));
    });

    it("matches the real 'CONTENT CREATOR' role (KPI band off, no finance)", () => {
        const bundle = bundleForRoles(['CONTENT CREATOR']);
        expect(bundle.showKpiBand).toBe(false);
        expect(bundle.showFinanceSummary).toBe(false);
        expect(bundle.recommendedWidgets).toContain('myCourses');
    });
});

describe('quickActionsForRoles', () => {
    const t = ((key: string) => key) as unknown as TFunction;

    it("gives 'CONTENT CREATOR' the course-creator actions", () => {
        const ids = quickActionsForRoles(['CONTENT CREATOR'], t).map((a) => a.id);
        expect(ids).toEqual(['my-courses', 'new-course']);
    });

    it('gives an unknown role no actions rather than the admin set', () => {
        expect(quickActionsForRoles(['COUNSELLOR'], t)).toEqual([]);
    });
});
