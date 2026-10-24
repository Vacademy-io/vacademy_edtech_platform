import { describe, expect, it } from 'vitest';
import {
    buildTeacherIndex,
    problemTeacherEntries,
    resolveTeacherEntry,
    resolvedTeacherIds,
    splitTeacherEntries,
} from './teacherDirectory';

const index = buildTeacherIndex([
    { id: 'u1', full_name: 'Asha Rao', email: 'Asha@School.org', username: 'asha01' },
    { id: 'u2', full_name: 'Ravi K', email: 'ravi@school.org', username: 'ravik' },
    // Two staff accounts sharing one mailbox.
    { id: 'u3', full_name: 'Front Desk A', email: 'office@school.org', username: 'desk_a' },
    { id: 'u4', full_name: 'Front Desk B', email: 'office@school.org', username: 'desk_b' },
    { id: 'u5', full_name: 'No Email', email: null, username: 'noemail' },
]);

describe('resolveTeacherEntry', () => {
    it('matches an email case-insensitively and ignores surrounding spaces', () => {
        expect(resolveTeacherEntry(index, '  asha@SCHOOL.org ')).toEqual({
            kind: 'user',
            user: expect.objectContaining({ id: 'u1' }),
        });
    });

    it('matches a username and a user id', () => {
        expect(resolveTeacherEntry(index, 'RaviK')).toMatchObject({
            kind: 'user',
            user: { id: 'u2' },
        });
        expect(resolveTeacherEntry(index, 'u5')).toMatchObject({
            kind: 'user',
            user: { id: 'u5' },
        });
    });

    it('refuses to guess when two staff share an email', () => {
        const match = resolveTeacherEntry(index, 'office@school.org');
        expect(match.kind).toBe('ambiguous');
    });

    it('reports an unknown entry as unmatched', () => {
        expect(resolveTeacherEntry(index, 'nobody@school.org')).toEqual({ kind: 'unmatched' });
        expect(resolveTeacherEntry(index, '   ')).toEqual({ kind: 'unmatched' });
    });
});

describe('row helpers', () => {
    it('collapses entries that point at the same person', () => {
        expect(resolvedTeacherIds(index, ['asha@school.org', 'u1', 'asha01', 'ravik'])).toEqual([
            'u1',
            'u2',
        ]);
    });

    it('lists the entries that need attention', () => {
        expect(
            problemTeacherEntries(index, [
                'asha@school.org',
                'typo@school.org',
                'office@school.org',
            ])
        ).toEqual(['typo@school.org', 'office@school.org']);
    });

    it('sorts entries into people, misses and shared identifiers', () => {
        expect(
            splitTeacherEntries(index, [
                'u1',
                'asha@school.org',
                'typo@school.org',
                'office@school.org',
            ])
        ).toEqual({
            userIds: ['u1'],
            unmatched: ['typo@school.org'],
            ambiguous: ['office@school.org'],
        });
    });
});
