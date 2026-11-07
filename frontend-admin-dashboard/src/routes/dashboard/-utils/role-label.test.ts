import { describe, expect, it } from 'vitest';
import { pickDashboardRole, resolveDashboardRoleLabel, titleCaseRole } from './role-label';

const LABELS: Record<string, () => string> = {
    ADMIN: () => 'Principal', // an institute that renamed Admin
    TEACHER: () => 'Faculty',
    'CONTENT CREATOR': () => 'Course Creator',
};

describe('pickDashboardRole', () => {
    it('prefers ADMIN wherever it sits in the list', () => {
        expect(pickDashboardRole(['STUDENT', 'TEACHER', 'ADMIN'])).toBe('ADMIN');
    });

    it('never picks a learner role', () => {
        expect(pickDashboardRole(['STUDENT', 'TEACHER'])).toBe('TEACHER');
        expect(pickDashboardRole(['LEARNER', 'COUNSELLOR'])).toBe('COUNSELLOR');
        expect(pickDashboardRole(['STUDENT'])).toBeNull();
        expect(pickDashboardRole([])).toBeNull();
    });
});

describe('resolveDashboardRoleLabel', () => {
    it('uses the terminology-aware label for known roles', () => {
        expect(resolveDashboardRoleLabel(['STUDENT', 'ADMIN'], LABELS)).toBe('Principal');
        expect(resolveDashboardRoleLabel(['TEACHER'], LABELS)).toBe('Faculty');
        expect(resolveDashboardRoleLabel(['CONTENT CREATOR'], LABELS)).toBe('Course Creator');
    });

    it('title-cases custom roles instead of printing the raw enum', () => {
        expect(resolveDashboardRoleLabel(['STUDENT', 'COUNSELLOR'], LABELS)).toBe('Counsellor');
        expect(resolveDashboardRoleLabel(['front_desk'], LABELS)).toBe('Front Desk');
    });

    it('returns null (caller shows its fallback) for a learner-only viewer', () => {
        expect(resolveDashboardRoleLabel(['STUDENT'], LABELS)).toBeNull();
    });
});

describe('titleCaseRole', () => {
    it('handles spaces, underscores and mixed case', () => {
        expect(titleCaseRole('ASSESSMENT CREATOR')).toBe('Assessment Creator');
        expect(titleCaseRole('  operations_LEAD ')).toBe('Operations Lead');
    });
});
