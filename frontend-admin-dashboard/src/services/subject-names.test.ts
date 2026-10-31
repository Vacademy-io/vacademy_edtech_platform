import { describe, it, expect } from 'vitest';
import { resolveSubjectName, unresolvedSubjectIds } from './subject-names';

// The institute-details payload holds ONE subject per distinct name (admin_core builds it
// with DISTINCT ON (subject_name) over live package sessions), so an id an assessment
// stored is very often absent from it even though the subject exists.
const instituteSubjects = [
    { id: 'winner-default', subject_name: 'DEFAULT' },
    { id: 'physics-1', subject_name: 'Physics' },
];

describe('resolveSubjectName', () => {
    it('resolves an id that survived the institute list dedup', () => {
        expect(resolveSubjectName(instituteSubjects, {}, 'physics-1')).toBe('Physics');
    });

    it('falls back to the direct lookup for a same-named duplicate the dedup dropped', () => {
        expect(
            resolveSubjectName(instituteSubjects, { 'loser-default': 'DEFAULT' }, 'loser-default')
        ).toBe('DEFAULT');
    });

    it('treats the "N/A" sentinel older saves wrote into subject_id as no subject', () => {
        expect(resolveSubjectName(instituteSubjects, { 'N/A': 'nonsense' }, 'N/A')).toBe('');
    });

    it('returns empty for a missing or unresolvable id rather than a placeholder', () => {
        expect(resolveSubjectName(instituteSubjects, {}, null)).toBe('');
        expect(resolveSubjectName(instituteSubjects, {}, 'deleted-course-subject')).toBe('');
    });

    it('does not crash when the institute list has not loaded yet', () => {
        expect(resolveSubjectName(undefined, { a: 'Maths' }, 'a')).toBe('Maths');
    });
});

describe('unresolvedSubjectIds', () => {
    it('asks only for the ids the institute list cannot already answer', () => {
        expect(
            unresolvedSubjectIds(instituteSubjects, [
                'physics-1',
                'loser-default',
                'N/A',
                null,
                undefined,
                '',
            ])
        ).toEqual(['loser-default']);
    });

    it('returns everything resolvable when the institute list is missing', () => {
        expect(unresolvedSubjectIds(undefined, ['a', 'N/A', 'b'])).toEqual(['a', 'b']);
    });
});
