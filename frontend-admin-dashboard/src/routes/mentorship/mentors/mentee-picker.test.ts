import { describe, expect, it } from 'vitest';
import {
    assignmentBatchContext,
    batchLabelMap,
    buildBatchOptions,
    MAX_BULK_SELECT,
    mergeSelection,
    openSeats,
    seatsLeft,
    pageSelectionState,
    removeSelection,
    selectAllAffordance,
    studentLabel,
    type PickerBatch,
} from '../-utils/mentee-picker';
import type { StudentRow } from '../-types/mentorship-types';

const batch = (over: Partial<PickerBatch> & { id: string }): PickerBatch => ({
    level: { id: 'lvl-1', level_name: 'Class 10' },
    package_dto: { package_name: 'Science' },
    session: { id: 'sess-1', session_name: '2025-26' },
    ...over,
});

const student = (id: string, over: Partial<StudentRow> = {}): StudentRow => ({
    user_id: id,
    full_name: `Student ${id}`,
    ...over,
});

describe('buildBatchOptions', () => {
    it('names a batch by course and level', () => {
        const [opt] = buildBatchOptions([batch({ id: 'ps-1' })]);
        expect(opt).toEqual({ value: 'ps-1', label: 'Science · Class 10' });
    });

    it('drops a placeholder level so options are not all "Default <course>"', () => {
        const options = buildBatchOptions([
            batch({ id: 'ps-1', level: { id: 'DEFAULT', level_name: 'DEFAULT' } }),
            batch({ id: 'ps-2', level: { id: 'lvl-x', level_name: 'default' } }),
        ]);
        expect(options.map((o) => o.label)).toEqual(['Science', 'Science']);
    });

    it('appends the session only when the institute runs more than one', () => {
        const single = buildBatchOptions([batch({ id: 'ps-1' }), batch({ id: 'ps-2' })]);
        expect(single.every((o) => !o.label.includes('2025-26'))).toBe(true);

        const multi = buildBatchOptions([
            batch({ id: 'ps-1' }),
            batch({
                id: 'ps-2',
                session: { id: 'sess-2', session_name: '2026-27' },
            }),
        ]);
        expect(multi.map((o) => o.label)).toEqual([
            'Science · Class 10 (2025-26)',
            'Science · Class 10 (2026-27)',
        ]);
    });

    it('includes a child batch name and skips deleted package sessions', () => {
        const options = buildBatchOptions([
            batch({ id: 'ps-1', name: 'Morning' }),
            batch({ id: 'ps-2', status: 'DELETED' }),
        ]);
        expect(options).toEqual([{ value: 'ps-1', label: 'Science · Class 10 · Morning' }]);
    });

    it('survives missing batch data instead of throwing', () => {
        expect(buildBatchOptions(undefined)).toEqual([]);
        expect(buildBatchOptions([{ id: 'ps-1' }])).toEqual([{ value: 'ps-1', label: 'Course' }]);
    });

    it('maps ids to labels for captioning a student row', () => {
        expect(batchLabelMap(buildBatchOptions([batch({ id: 'ps-1' })]))).toEqual({
            'ps-1': 'Science · Class 10',
        });
    });
});

describe('selection', () => {
    it('merges without duplicating an already-selected student', () => {
        const selected = [student('a')];
        const next = mergeSelection(selected, [student('a'), student('b')]);
        expect(next.map((s) => s.user_id)).toEqual(['a', 'b']);
    });

    it('returns the same array when there is nothing new to add', () => {
        const selected = [student('a')];
        // Identity matters: a fresh array on every render would re-run the
        // consumers' effects and reset the picker's page.
        expect(mergeSelection(selected, [student('a')])).toBe(selected);
    });

    it('removes a page worth of students at once', () => {
        const selected = [student('a'), student('b'), student('c')];
        expect(
            removeSelection(selected, [student('a'), student('c')]).map((s) => s.user_id)
        ).toEqual(['b']);
    });

    it('reports none / some / all for the visible page', () => {
        const page = [student('a'), student('b')];
        expect(pageSelectionState([], page)).toBe('none');
        expect(pageSelectionState([student('a')], page)).toBe('some');
        expect(pageSelectionState([student('a'), student('b')], page)).toBe('all');
        // An empty page must not read as "all selected", or the header checkbox
        // would show ticked over nothing.
        expect(pageSelectionState([student('a')], [])).toBe('none');
    });

    it('ignores selections that are not on the visible page', () => {
        expect(pageSelectionState([student('z')], [student('a')])).toBe('none');
    });
});

describe('selectAllAffordance', () => {
    it('offers select-all for a match set within the cap', () => {
        expect(selectAllAffordance(250)).toEqual({ available: true, blocked: false });
    });

    it('blocks rather than silently truncating an oversized match set', () => {
        expect(selectAllAffordance(MAX_BULK_SELECT + 1)).toEqual({
            available: false,
            blocked: true,
        });
    });

    it('offers nothing when nothing matches', () => {
        expect(selectAllAffordance(0)).toEqual({ available: false, blocked: false });
    });
});

describe('seatsLeft', () => {
    it('reports remaining seats for a capped mentor', () => {
        expect(seatsLeft({ max_mentees: 10, available_slots: 4 })).toBe(4);
    });

    it('reads no cap as unlimited', () => {
        expect(seatsLeft({ max_mentees: null, available_slots: null })).toBe(null);
        expect(seatsLeft({})).toBe(null);
    });

    it('reads a zero or negative cap as unlimited, matching the server', () => {
        // MentorService.normalizeCapacity stores 0/negative as null and
        // atCapacity() treats <= 0 as uncapped. Reading `max_mentees: 0` as "zero
        // seats" would warn that nothing can be assigned to a mentor the server
        // would happily fill.
        expect(seatsLeft({ max_mentees: 0, available_slots: null })).toBe(null);
        expect(seatsLeft({ max_mentees: -1, available_slots: null })).toBe(null);
    });

    it('never reports a negative count', () => {
        expect(seatsLeft({ max_mentees: 5, available_slots: -3 })).toBe(0);
    });
});

describe('openSeats', () => {
    it('sums the free seats of capped mentors', () => {
        expect(
            openSeats([
                { max_mentees: 10, available_slots: 4 },
                { max_mentees: 5, available_slots: 1 },
            ])
        ).toBe(5);
    });

    it('treats an uncapped mentor as unlimited room, not as zero', () => {
        expect(
            openSeats([
                { max_mentees: null, available_slots: null },
                { max_mentees: 5, available_slots: 1 },
            ])
        ).toBe(null);
    });

    it('has no room when no mentor is chosen', () => {
        expect(openSeats([])).toBe(0);
    });

    it('never counts a negative slot value', () => {
        expect(openSeats([{ max_mentees: 5, available_slots: -3 }])).toBe(0);
    });

    it('treats a zero cap in the group as unlimited too', () => {
        expect(
            openSeats([
                { max_mentees: 0, available_slots: null },
                { max_mentees: 5, available_slots: 1 },
            ])
        ).toBe(null);
    });
});

describe('assignmentBatchContext', () => {
    const inBatch = (id: string, ps?: string) => student(id, { package_session_id: ps });

    it('stamps the batch every selected student shares', () => {
        expect(assignmentBatchContext([inBatch('a', 'ps-1'), inBatch('b', 'ps-1')])).toBe('ps-1');
    });

    it('stamps nothing when the selection spans batches', () => {
        // The picker keeps a selection while the filter moves, so this is the
        // normal case for an admin who ticked Class 9 then switched to Class 10 —
        // reading the batch off the filter would mislabel the Class 9 rows.
        expect(
            assignmentBatchContext([inBatch('a', 'ps-1'), inBatch('b', 'ps-2')])
        ).toBeUndefined();
    });

    it('stamps nothing when a student carries no batch at all', () => {
        expect(assignmentBatchContext([inBatch('a', 'ps-1'), inBatch('b')])).toBeUndefined();
        expect(assignmentBatchContext([inBatch('a')])).toBeUndefined();
        expect(assignmentBatchContext([])).toBeUndefined();
    });
});

describe('studentLabel', () => {
    it('falls back through name, username, email, then id', () => {
        expect(studentLabel(student('a'))).toBe('Student a');
        expect(studentLabel({ user_id: 'a', full_name: '  ', username: 'nick' })).toBe('nick');
        expect(studentLabel({ user_id: 'a', email: 'x@y.z' })).toBe('x@y.z');
        expect(studentLabel({ user_id: 'a' })).toBe('a');
    });
});
