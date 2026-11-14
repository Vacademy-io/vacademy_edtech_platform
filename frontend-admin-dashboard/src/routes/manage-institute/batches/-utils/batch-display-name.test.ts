/**
 * What to call a batch.
 *
 * The bug this guards: an institute migrated in bulk carries the level name
 * "default" on every session, so composing the title from level + course gave
 * every batch of a course the SAME label — 116 cards reading "default Adv
 * Diploma In Cosmetology", with nothing to tell them apart — while
 * package_session.name held "2026_05_11_ADCT_OF_PUN" all along.
 *
 * Lives here rather than beside the helper in src/utils because the vitest
 * include list does not cover src/utils, and widening it would also start
 * running two suites under src/utils/__tests__ that have never run.
 */
import { describe, it, expect } from 'vitest';
import {
    getBatchDisplayName,
    getBatchOwnName,
} from '@/utils/helpers/student-management/batch-display-name';
import type { BatchForSessionType } from '@/schemas/student/student-list/institute-schema';

const batch = (name?: string | null): BatchForSessionType =>
    ({
        id: 'ps1',
        name,
        level: { id: 'l1', level_name: 'default', duration_in_days: null, thumbnail_file_id: null },
        session: { id: 's1', session_name: '2026', status: 'ACTIVE', start_date: null },
        start_time: null,
        status: 'ACTIVE',
        package_dto: {
            id: 'p1',
            package_name: 'Adv Diploma In Cosmetology',
            thumbnail_file_id: null,
        },
    }) as unknown as BatchForSessionType;

describe('getBatchOwnName', () => {
    it('returns the name the institute gave the batch', () => {
        expect(getBatchOwnName(batch('2026_05_11_ADCT_OF_PUN'))).toBe('2026_05_11_ADCT_OF_PUN');
    });

    it('trims, so a stored "  A  " still reads as A', () => {
        expect(getBatchOwnName(batch('  A  '))).toBe('A');
    });

    it.each([undefined, null, '', '   '])('is empty for %p', (name) => {
        expect(getBatchOwnName(batch(name))).toBe('');
    });

    // These two are what the platform writes when nobody named the batch, so
    // they must not win over the level + course fallback.
    it.each(['default', 'DEFAULT', 'General', 'general'])(
        'treats the placeholder %s as unnamed',
        (name) => {
            expect(getBatchOwnName(batch(name))).toBe('');
        }
    );
});

describe('getBatchDisplayName', () => {
    it('prefers the batch name', () => {
        expect(getBatchDisplayName(batch('2026_05_11_ADCT_OF_PUN'))).toBe('2026_05_11_ADCT_OF_PUN');
    });

    it('falls back to level + course, which is what every caller printed before', () => {
        expect(getBatchDisplayName(batch(null))).toBe('default Adv Diploma In Cosmetology');
    });

    it('is empty for a package_session_id that matches no batch', () => {
        expect(getBatchDisplayName(undefined)).toBe('');
    });

    it('gives two batches of one course different names', () => {
        const names = ['2026_05_11_ADCT_OF_PUN', '2026_02_16_ADCT_OF_MUM'].map((n) =>
            getBatchDisplayName(batch(n))
        );
        expect(new Set(names).size).toBe(2);
    });
});
