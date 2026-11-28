import { describe, expect, it } from 'vitest';
import { applyReviewEdits, planAiMarks, toFabricObject } from './ai-marks-to-fabric';

const layout = {
    pages: [
        {
            page_id: 'P1',
            page_index: 0,
            width: 1000,
            height: 1400,
            lines: [
                { line_id: 'L1', box: [100, 200, 400, 40] as [number, number, number, number] },
                { line_id: 'L2', box: [100, 300, 800, 40] as [number, number, number, number] },
            ],
        },
        {
            page_id: 'P2',
            page_index: 1,
            width: 1000,
            height: 1400,
            lines: [{ line_id: 'L9', box: [50, 100, 300, 40] as [number, number, number, number] }],
        },
    ],
};
const canvas = () => ({ width: 500, height: 700 });

describe('AI marks on the evaluator canvas', () => {
    it('scales each mark from the layout image onto the canvas, on its own page', () => {
        const plans = planAiMarks(
            layout,
            [
                {
                    question_id: 'q1',
                    status: 'COMPLETED',
                    marks_awarded: 3,
                    max_marks: 5,
                    annotations: [
                        { target: 'L1', style: 'tick' },
                        { target: 'L1', style: 'score', text: '3/5' },
                        { target: 'L9', style: 'circle' },
                        { target: 'nope', style: 'cross' },
                    ],
                },
            ],
            canvas
        );
        expect(plans.map((p) => [p.page, p.kind])).toEqual([
            [1, 'tick'],
            [1, 'text'],
            [2, 'ellipse'],
        ]);
        // L1 is x 100..500 of 1000 → 50..250 on a 500px canvas; the tick sits just past it.
        expect(plans[0]!.left).toBeCloseTo(256);
        expect(plans[0]!.top).toBeCloseTo(100);
        expect(plans[1]!.text).toBe('3/5');
    });

    it('puts a note beside its line when there is room, else under it', () => {
        const plans = planAiMarks(
            layout,
            [
                {
                    question_id: 'q1',
                    annotations: [
                        { target: 'L1', style: 'margin_note', text: 'Give the unit.' },
                        { target: 'L2', style: 'deduction_reason', text: 'Second step missing.' },
                    ],
                },
            ],
            canvas
        );
        const [beside, under] = plans;
        expect(beside!.left).toBeGreaterThan(250);
        expect(beside!.top).toBeCloseTo(100);
        expect(under!.left).toBeCloseTo(50);
        expect(under!.top).toBeGreaterThan(150 + 20);
    });

    it("adds the question's mark when the AI drew none, and skips ungraded questions", () => {
        const plans = planAiMarks(
            layout,
            [
                {
                    question_id: 'q1',
                    marks_awarded: 2.5,
                    max_marks: 4,
                    annotations: [{ target: 'L2', style: 'tick' }],
                },
                {
                    question_id: 'q2',
                    status: 'FAILED',
                    annotations: [{ target: 'L1', style: 'cross' }],
                },
            ],
            canvas
        );
        expect(plans.map((p) => p.text ?? p.kind)).toEqual(['tick', '2.5/4']);
    });

    it("applies the teacher's review-page edits first", () => {
        const anns = [
            { target: 'L1', page_id: 'P1', style: 'margin_note', text: 'why?' },
            { target: 'L2', page_id: 'P1', style: 'margin_note', text: 'unit' },
        ];
        const out = applyReviewEdits(anns, [
            { target: 'L1', page_id: 'P1', style: 'margin_note', text: 'why?', action: 'DELETE' },
            {
                target: 'L2',
                page_id: 'P1',
                style: 'margin_note',
                text: 'unit',
                action: 'EDIT',
                new_text: 'Write the unit',
            },
        ]);
        expect(out).toEqual([
            { target: 'L2', page_id: 'P1', style: 'margin_note', text: 'Write the unit' },
        ]);
    });

    it('builds real, selectable fabric shapes that serialise for other pages', () => {
        // Text objects need a real canvas to measure glyphs (absent in jsdom);
        // the shapes do not.
        const tick = toFabricObject({
            page: 1,
            kind: 'tick',
            left: 10,
            top: 20,
            width: 30,
            height: 30,
        });
        const ring = toFabricObject({
            page: 1,
            kind: 'ellipse',
            left: 1,
            top: 2,
            width: 80,
            height: 20,
        });
        const line = toFabricObject({
            page: 1,
            kind: 'line',
            left: 0,
            top: 50,
            width: 120,
            height: 0,
        });
        expect(tick.selectable).toBe(true);
        expect(tick.left).toBe(10);
        expect(tick.getScaledWidth()).toBeGreaterThan(24);
        expect(tick.getScaledWidth()).toBeLessThan(40);
        expect((ring.toObject() as Record<string, unknown>).type).toMatch(/ellipse/i);
        expect((line.toObject() as Record<string, unknown>).type).toMatch(/line/i);
        expect((tick.toObject() as Record<string, unknown>).type).toMatch(/path/i);
    });
});
