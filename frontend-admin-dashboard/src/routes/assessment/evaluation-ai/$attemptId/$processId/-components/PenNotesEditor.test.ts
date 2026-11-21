import { describe, expect, it } from 'vitest';
import { buildAnnotationEdits, editableNotes, initialNoteChoices } from './PenNotesEditor';

const annotations = [
    { style: 'tick', target: 'L1', page_id: 'P1' },
    { style: 'score', target: 'L1', page_id: 'P1', text: '3/5' },
    { style: 'margin_note', target: 'L2', page_id: 'P1', text: 'why?' },
    { style: 'deduction_reason', target: 'L3', page_id: 'P2', text: 'Missing unit.' },
];

describe('pen notes', () => {
    it('leaves the mark and total to the marks box', () => {
        expect(editableNotes(annotations).map((n) => n.index)).toEqual([0, 2, 3]);
    });

    it('sends only notes the teacher changed, named by their stored fields', () => {
        const edits = buildAnnotationEdits(annotations, {
            0: { action: 'KEEP', newText: '' },
            2: { action: 'EDIT', newText: '  Good point  ' },
            3: { action: 'DELETE', newText: '' },
        });
        expect(edits).toEqual([
            {
                style: 'margin_note',
                target: 'L2',
                page_id: 'P1',
                text: 'why?',
                action: 'EDIT',
                new_text: 'Good point',
            },
            {
                style: 'deduction_reason',
                target: 'L3',
                page_id: 'P2',
                text: 'Missing unit.',
                action: 'DELETE',
            },
        ]);
    });

    it('drops an empty rewrite instead of blanking the note', () => {
        expect(buildAnnotationEdits(annotations, { 2: { action: 'EDIT', newText: ' ' } })).toEqual(
            []
        );
    });

    it('round-trips the saved edits back onto the right notes', () => {
        const saved = buildAnnotationEdits(annotations, {
            2: { action: 'EDIT', newText: 'Good point' },
            3: { action: 'DELETE', newText: '' },
        });
        expect(initialNoteChoices(annotations, saved)).toEqual({
            2: { action: 'EDIT', newText: 'Good point' },
            3: { action: 'DELETE', newText: '' },
        });
        expect(initialNoteChoices(annotations, null)).toEqual({});
    });
});
