/**
 * The AI copy check's pen marks, turned into ordinary evaluator-canvas objects.
 *
 * The AI's checked copy is a flat PDF: a teacher cannot move a tick, fix a
 * note's position or add to it. Here each AI annotation (anchored to an OCR
 * line of the layout map) becomes a fabric object on the raw answer sheet -
 * a tick / cross path, a circle, a line, a text note, the question's score -
 * which the teacher then moves, deletes, edits or adds to with the usual
 * tools, and submits like any manual evaluation.
 *
 * `planAiMarks` is pure (layout + verdicts -> positioned descriptors, in the
 * canvas's own pixels) so the geometry is testable; `toFabricObject` builds
 * the fabric object for one descriptor.
 */
import { Ellipse, IText, Line, Path, Textbox, type FabricObject } from 'fabric';

export interface AiLayoutLine {
    line_id: string;
    box: [number, number, number, number];
}
export interface AiLayoutRegion {
    region_id: string;
    box: [number, number, number, number];
}
export interface AiLayoutPage {
    page_id: string;
    page_index?: number;
    width: number;
    height: number;
    lines?: AiLayoutLine[];
    regions?: AiLayoutRegion[];
}
export interface AiLayoutMap {
    pages: AiLayoutPage[];
}
export interface AiMarkAnnotation {
    target?: string | null;
    page_id?: string | null;
    style?: string | null;
    text?: string | null;
}
export interface AiQuestionVerdict {
    question_id: string;
    status?: string;
    marks_awarded?: number | null;
    max_marks?: number | null;
    annotations?: AiMarkAnnotation[] | null;
}

export type AiMarkKind = 'tick' | 'cross' | 'ellipse' | 'line' | 'text';

export interface AiMarkPlan {
    /** 1-based page number in the evaluator. */
    page: number;
    kind: AiMarkKind;
    left: number;
    top: number;
    width: number;
    height: number;
    text?: string;
    fontSize?: number;
}

/** The pen colour of the imported marks (the evaluator's own cross is drawn in red too). */
export const AI_MARK_INK = 'red';

const NOTE_STYLES = new Set([
    'margin_note',
    'region_note',
    'deduction_reason',
    'feedback',
    'language',
    'summary',
]);

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/**
 * Where each AI mark goes on the evaluator's canvas. `canvasSize(page)` is the
 * canvas size of that 1-based page; layout boxes ([x, y, w, h] in the layout
 * image's pixels) are scaled onto it.
 */
export function planAiMarks(
    layout: AiLayoutMap | null | undefined,
    questions: AiQuestionVerdict[],
    canvasSize: (page: number) => { width: number; height: number }
): AiMarkPlan[] {
    if (!layout?.pages?.length) return [];
    const where = new Map<
        string,
        { page: number; box: [number, number, number, number]; lp: AiLayoutPage }
    >();
    layout.pages.forEach((lp, i) => {
        const page = (lp.page_index ?? i) + 1;
        for (const l of lp.lines ?? []) where.set(l.line_id, { page, box: l.box, lp });
        for (const r of lp.regions ?? []) where.set(r.region_id, { page, box: r.box, lp });
    });

    const out: AiMarkPlan[] = [];
    for (const q of questions) {
        if (q.status && q.status !== 'COMPLETED') continue;
        const anns = q.annotations ?? [];
        let lastAnchor: { page: number; x: number; y: number; h: number; right: number } | null =
            null;
        let hasScore = false;
        for (const a of anns) {
            const style = String(a.style ?? '').toLowerCase();
            const hit = a.target ? where.get(a.target) : undefined;
            if (!hit) continue;
            const { width: cw, height: ch } = canvasSize(hit.page);
            const sx = cw / (hit.lp.width || cw);
            const sy = ch / (hit.lp.height || ch);
            const [bx, by, bw, bh] = hit.box;
            const x = bx * sx;
            const y = by * sy;
            const w = bw * sx;
            const h = Math.max(bh * sy, 10);
            const markSize = Math.min(Math.max(h * 1.1, 14), 40);
            const right = Math.min(x + w + 6, cw - markSize - 4);
            lastAnchor = { page: hit.page, x, y, h, right };

            if (style === 'tick' || style === 'cross') {
                out.push({
                    page: hit.page,
                    kind: style,
                    left: right,
                    top: y,
                    width: markSize,
                    height: markSize,
                });
            } else if (style === 'circle') {
                out.push({
                    page: hit.page,
                    kind: 'ellipse',
                    left: x - 4,
                    top: y - 3,
                    width: w + 8,
                    height: h + 6,
                });
            } else if (style === 'underline') {
                out.push({
                    page: hit.page,
                    kind: 'line',
                    left: x,
                    top: y + h + 1,
                    width: w,
                    height: 0,
                });
            } else if (style === 'strike' || style === 'strikethrough') {
                out.push({
                    page: hit.page,
                    kind: 'line',
                    left: x,
                    top: y + h / 2,
                    width: w,
                    height: 0,
                });
            } else if (style === 'score' && a.text) {
                hasScore = true;
                const fs = Math.min(Math.max(h, 14), 32);
                out.push({
                    page: hit.page,
                    kind: 'text',
                    left: Math.max(4, cw - fs * 4),
                    top: y,
                    width: fs * 3.6,
                    height: fs,
                    text: a.text,
                    fontSize: fs,
                });
            } else if ((NOTE_STYLES.has(style) || style === '') && a.text) {
                const fs = Math.min(Math.max(h * 0.7, 12), 22);
                // Beside the line when there is room, else on the line below it.
                const room = cw - (x + w + 8) - 4;
                const besides = room >= Math.min(220, cw * 0.25);
                const left = besides ? x + w + 8 : x;
                const width = besides ? room : Math.max(cw - x - 8, 120);
                out.push({
                    page: hit.page,
                    kind: 'text',
                    left,
                    top: besides ? y : y + h + 2,
                    width,
                    height: fs * 1.3,
                    text: a.text,
                    fontSize: fs,
                });
            }
        }
        // No score mark from the AI (an older copy): put the question's mark
        // beside its last answer line so the teacher can still see and move it.
        if (!hasScore && lastAnchor && q.marks_awarded != null) {
            const { width: cw } = canvasSize(lastAnchor.page);
            const fs = Math.min(Math.max(lastAnchor.h, 14), 32);
            const label =
                q.max_marks != null
                    ? `${fmt(q.marks_awarded)}/${fmt(q.max_marks)}`
                    : fmt(q.marks_awarded);
            out.push({
                page: lastAnchor.page,
                kind: 'text',
                left: Math.max(4, cw - fs * 4),
                top: lastAnchor.y,
                width: fs * 3.6,
                height: fs,
                text: label,
                fontSize: fs,
            });
        }
    }
    return out;
}

export interface AiReviewEdit {
    style?: string | null;
    target?: string | null;
    page_id?: string | null;
    text?: string | null;
    action: 'DELETE' | 'EDIT';
    new_text?: string | null;
}

/**
 * The AI's marks with the teacher's review-page edits applied (a removed note
 * stays off, a rewritten one carries the new words), matched the way the
 * re-drawn copy matches them: on style, target, page and text.
 */
export function applyReviewEdits(
    annotations: AiMarkAnnotation[] | null | undefined,
    edits: AiReviewEdit[] | null | undefined
): AiMarkAnnotation[] {
    const out = [...(annotations ?? [])];
    for (const e of edits ?? []) {
        const i = out.findIndex(
            (a) =>
                (a.style ?? null) === (e.style ?? null) &&
                (a.target ?? null) === (e.target ?? null) &&
                (a.page_id ?? null) === (e.page_id ?? null) &&
                (a.text ?? null) === (e.text ?? null)
        );
        if (i < 0) continue;
        if (e.action === 'EDIT' && e.new_text?.trim())
            out[i] = { ...out[i], text: e.new_text.trim() };
        else out.splice(i, 1);
    }
    return out;
}

/** The fabric object for one planned mark, selectable and editable like a hand-placed one. */
export function toFabricObject(plan: AiMarkPlan): FabricObject {
    const base = {
        selectable: true,
        strokeLineCap: 'round' as const,
        strokeLineJoin: 'round' as const,
    };
    const stroke = Math.max(2, Math.round(plan.height / 10));
    switch (plan.kind) {
        case 'tick': {
            const p = new Path('M 4 18 L 14 30 L 34 4', {
                ...base,
                stroke: AI_MARK_INK,
                strokeWidth: 4,
                fill: '',
            });
            p.scaleToWidth(plan.width);
            p.set({ left: plan.left, top: plan.top });
            return p;
        }
        case 'cross': {
            const p = new Path('M 4 4 L 30 30 M 30 4 L 4 30', {
                ...base,
                stroke: AI_MARK_INK,
                strokeWidth: 4,
                fill: '',
            });
            p.scaleToWidth(plan.width);
            p.set({ left: plan.left, top: plan.top });
            return p;
        }
        case 'ellipse':
            return new Ellipse({
                ...base,
                left: plan.left,
                top: plan.top,
                rx: plan.width / 2,
                ry: plan.height / 2,
                stroke: AI_MARK_INK,
                strokeWidth: Math.min(stroke, 3),
                fill: '',
            });
        case 'line':
            return new Line([plan.left, plan.top, plan.left + plan.width, plan.top], {
                ...base,
                stroke: AI_MARK_INK,
                strokeWidth: 2,
            });
        case 'text':
        default:
            if ((plan.text ?? '').length <= 8) {
                return new IText(plan.text ?? '', {
                    left: plan.left,
                    top: plan.top,
                    fontSize: plan.fontSize ?? 18,
                    fill: AI_MARK_INK,
                    fontStyle: 'italic',
                    selectable: true,
                });
            }
            return new Textbox(plan.text ?? '', {
                left: plan.left,
                top: plan.top,
                width: plan.width,
                fontSize: plan.fontSize ?? 16,
                fill: AI_MARK_INK,
                fontStyle: 'italic',
                selectable: true,
            });
    }
}
