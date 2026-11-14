/**
 * Play a stored whiteboard the way the learner's lesson does: elements enter
 * one after another, diagram strokes draw themselves on, and diagram parts
 * marked with a `step` appear in order. Used by the Tutor Mode preview so an
 * admin can judge a board without opening a lesson.
 */
const DRAWABLE = 'path, line, polyline, polygon, circle, ellipse, rect';
const ELEMENT_MS = 700;
const STEP_MS = 1100;

interface BoardOpLike {
    op?: unknown;
    id?: unknown;
    parts?: Array<{ id?: unknown; step?: unknown }>;
}

/** Reset every animated class so the board can be replayed. */
export function resetBoard(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('.tb-op').forEach((el) => {
        el.classList.remove('tb-enter', 'tb-op');
    });
    root.querySelectorAll<SVGElement>('.tb-draw').forEach((el) => el.classList.remove('tb-draw'));
    root.querySelectorAll<SVGElement>('.tb-step, .tb-step-on').forEach((el) => {
        el.classList.remove('tb-step', 'tb-step-on');
    });
}

/**
 * Animate a materialized board. `ops` (the concept's board ops, cumulative
 * for the topic) supplies the diagram parts' steps; `root` holds the stored
 * HTML. Returns the timer handles so the caller can cancel on unmount.
 */
export function animateBoard(root: HTMLElement, ops: BoardOpLike[]): number[] {
    resetBoard(root);
    const timers: number[] = [];
    const elements = Array.from(root.querySelectorAll<HTMLElement>('.tutor-board > *'));
    const stepsById = new Map<string, number>();
    for (const op of ops) {
        if (op.op !== 'svg') continue;
        for (const p of op.parts ?? []) {
            const id = String(p.id ?? '');
            const step = Number(p.step) || 0;
            if (id && step > 0) stepsById.set(id, step);
        }
    }
    elements.forEach((el, i) => {
        el.classList.add('tb-op');
        const svg = el.querySelector('svg');
        let maxStep = 0;
        if (svg) {
            stepsById.forEach((step, id) => {
                const part = svg.querySelector<SVGElement>(`#${CSS.escape(id)}`);
                if (!part) return;
                part.classList.add('tb-step');
                part.dataset.step = String(step);
                maxStep = Math.max(maxStep, step);
            });
            let k = 0;
            svg.querySelectorAll<SVGElement>(DRAWABLE).forEach((shape) => {
                if (shape.closest('.tb-step')) return;
                shape.setAttribute('pathLength', '1');
                shape.style.animationDelay = `${Math.min(k, 24) * 70}ms`;
                k += 1;
            });
        }
        const at = i * ELEMENT_MS;
        timers.push(
            window.setTimeout(() => {
                el.classList.add('tb-enter');
                if (svg) {
                    svg.querySelectorAll<SVGElement>(DRAWABLE).forEach((shape) => {
                        if (!shape.closest('.tb-step')) shape.classList.add('tb-draw');
                    });
                    for (let step = 1; step <= maxStep; step++) {
                        timers.push(
                            window.setTimeout(
                                () => {
                                    svg.querySelectorAll<SVGElement>(
                                        `.tb-step[data-step="${step}"]`
                                    ).forEach((p) => p.classList.add('tb-step-on'));
                                },
                                600 + step * STEP_MS
                            )
                        );
                    }
                }
            }, at)
        );
    });
    return timers;
}
