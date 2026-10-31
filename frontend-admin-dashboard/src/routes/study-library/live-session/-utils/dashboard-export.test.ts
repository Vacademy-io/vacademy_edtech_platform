import { describe, expect, it } from 'vitest';
import {
    exportFileName,
    parseDashboardUrl,
    toDashboardUrl,
    toStudentTable,
} from './dashboard-export';

describe('shareable dashboard link', () => {
    it('round-trips filters through the URL', () => {
        const url = toDashboardUrl({
            startDate: '2026-09-21',
            endDate: '2026-09-27',
            batchIds: ['b1', 'b2'],
            teacherIds: [],
        });
        expect(url).toEqual({
            from: '2026-09-21',
            to: '2026-09-27',
            batches: 'b1,b2',
            teachers: undefined,
        });
        expect(parseDashboardUrl(url)).toEqual({
            range: { start: '2026-09-21', end: '2026-09-27' },
            batchIds: ['b1', 'b2'],
            teacherIds: [],
        });
    });

    it('ignores a malformed or reversed range instead of breaking the page', () => {
        expect(parseDashboardUrl({ from: '21-09-2026', to: '2026-09-27' }).range).toBeNull();
        expect(parseDashboardUrl({ from: '2026-09-28', to: '2026-09-27' }).range).toBeNull();
        expect(parseDashboardUrl({ teachers: ' t1 , ,t2' }).teacherIds).toEqual(['t1', 't2']);
    });
});

describe('export helpers', () => {
    it('builds OS-safe file names', () => {
        expect(exportFileName('class_Maths: SPM/DL', '2026-09-27', '2026-09-27')).toBe(
            'class_Maths--SPM-DL_2026-09-27_to_2026-09-27.csv'
        );
    });

    it('maps a learner onto the shape the bulk message dialogs expect', () => {
        const s = toStudentTable({
            userId: 'u1',
            name: 'Asha',
            email: null,
            mobile: '9999999999',
            packageSessionId: 'ps1',
        });
        expect(s.user_id).toBe('u1');
        expect(s.full_name).toBe('Asha');
        expect(s.email).toBe('');
        expect(s.mobile_number).toBe('9999999999');
        expect(s.package_session_id).toBe('ps1');
    });
});
