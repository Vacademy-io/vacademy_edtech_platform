import { describe, it, expect } from 'vitest';
import { applyColumnLayout, toggleableColumnIds, columnIdOf } from './column-layout';

/** The Attempted tab's columns, declared the way the real ones are. */
const ATTEMPTED = [
    { id: 'checkbox' },
    { id: 'details' },
    { accessorKey: 'full_name' },
    { accessorKey: 'package_session_id' },
    { accessorKey: 'attempt_date' },
    { accessorKey: 'score' },
    { accessorKey: 'result_status' },
    { accessorKey: 'email' },
    { accessorKey: 'mobile_number' },
    { accessorKey: 'username' },
    { id: 'options' },
];

const ids = (columns: { id?: string; accessorKey?: string }[]) => columns.map(columnIdOf);

describe('columnIdOf', () => {
    it('reads an id or an accessorKey, whichever the column was declared with', () => {
        expect(columnIdOf({ id: 'options' })).toBe('options');
        expect(columnIdOf({ accessorKey: 'full_name' })).toBe('full_name');
        expect(columnIdOf({})).toBe('');
    });
});

describe('toggleableColumnIds', () => {
    it('never offers the select box, detail arrow or row menu', () => {
        expect(toggleableColumnIds(ATTEMPTED)).not.toContain('checkbox');
        expect(toggleableColumnIds(ATTEMPTED)).not.toContain('details');
        expect(toggleableColumnIds(ATTEMPTED)).not.toContain('options');
        expect(toggleableColumnIds(ATTEMPTED)).toContain('email');
    });
});

describe('applyColumnLayout — hiding', () => {
    it('drops hidden columns', () => {
        const out = ids(applyColumnLayout(ATTEMPTED, new Set(['username', 'score']), []));
        expect(out).not.toContain('username');
        expect(out).not.toContain('score');
        expect(out).toContain('email');
    });

    it('keeps Name even if something tries to hide it', () => {
        const out = ids(applyColumnLayout(ATTEMPTED, new Set(['full_name']), []));
        expect(out).toContain('full_name');
    });

    it('keeps the structural cells even if something tries to hide them', () => {
        const out = ids(
            applyColumnLayout(ATTEMPTED, new Set(['checkbox', 'details', 'options']), [])
        );
        expect(out).toEqual(expect.arrayContaining(['checkbox', 'details', 'options']));
    });

    it('an empty layout is the natural order, untouched', () => {
        expect(ids(applyColumnLayout(ATTEMPTED, new Set(), []))).toEqual(ids(ATTEMPTED));
    });
});

describe('applyColumnLayout — ordering', () => {
    // The regression this helper exists for: orderColumnIds anchors an unlisted column to
    // whichever saved column naturally precedes it, so running the row menu through it
    // dragged the sticky "..." column into the middle as soon as its anchor moved.
    it('pins the select box and detail arrow first and the row menu last, whatever the order', () => {
        const saved = ['full_name', 'username', 'email', 'mobile_number', 'package_session_id'];
        const out = ids(applyColumnLayout(ATTEMPTED, new Set(), saved));

        expect(out[0]).toBe('checkbox');
        expect(out[1]).toBe('details');
        expect(out.at(-1)).toBe('options');
        expect(out.filter((id) => id === 'options')).toHaveLength(1);
    });

    it('applies the order the user dragged', () => {
        const saved = ['email', 'full_name', 'username'];
        const out = ids(applyColumnLayout(ATTEMPTED, new Set(), saved));
        expect(out.indexOf('email')).toBeLessThan(out.indexOf('full_name'));
        expect(out.indexOf('full_name')).toBeLessThan(out.indexOf('username'));
    });

    it('loses no column and invents none', () => {
        const saved = ['username', 'email', 'full_name'];
        const out = applyColumnLayout(ATTEMPTED, new Set(), saved);
        expect(out).toHaveLength(ATTEMPTED.length);
        expect(new Set(ids(out))).toEqual(new Set(ids(ATTEMPTED)));
    });

    it('ignores saved ids this tab does not have (Pending has no score)', () => {
        const pending = [
            { id: 'checkbox' },
            { id: 'details' },
            { accessorKey: 'full_name' },
            { accessorKey: 'email' },
            { accessorKey: 'mobile_number' },
            { accessorKey: 'username' },
            { id: 'options' },
        ];
        const saved = ['full_name', 'score', 'username', 'email', 'mobile_number'];
        const out = ids(applyColumnLayout(pending, new Set(), saved));

        expect(out).not.toContain('score');
        expect(out[0]).toBe('checkbox');
        expect(out.at(-1)).toBe('options');
        expect(out.indexOf('username')).toBeLessThan(out.indexOf('email'));
    });

    it('a hidden column does not disturb the ends', () => {
        const saved = ['username', 'full_name', 'email', 'mobile_number', 'package_session_id'];
        const out = ids(applyColumnLayout(ATTEMPTED, new Set(['email', 'score']), saved));
        expect(out[0]).toBe('checkbox');
        expect(out.at(-1)).toBe('options');
        expect(out).not.toContain('email');
    });
});
