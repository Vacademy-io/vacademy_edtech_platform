/**
 * Arrow keys on Home. A WebView only moves focus on arrows by itself on some devices, and
 * where it does it also stops on the scrolling strip itself, so Home does this on its own
 * and every remote gets the same behaviour. Inside the strip, left and right stay in the
 * strip. Up and down only land on what can be seen.
 */
import { useEffect } from 'react';
import { getCurrentRoute } from '../router';

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

export interface FocusBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface FocusCandidate<T> {
    item: T;
    box: FocusBox;
    /** The scrolling row it sits in, if any. */
    row: unknown;
    /** Scrolled out of its row. */
    clipped: boolean;
}

const DIRECTIONS: Record<string, ArrowDirection> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
};

/** Marks a scrolling row of focusable things. */
export const ARROW_ROW_ATTRIBUTE = 'data-arrow-row';

const center = (box: FocusBox) => ({
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
});

export function nextInDirection<T>(
    from: FocusCandidate<T> | null,
    candidates: FocusCandidate<T>[],
    direction: ArrowDirection
): T | null {
    const visible = candidates.filter((c) => !c.clipped);
    if (!from) {
        const first = visible
            .slice()
            .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
        return first[0]?.item ?? null;
    }
    const horizontal = direction === 'left' || direction === 'right';
    const sign = direction === 'left' || direction === 'up' ? -1 : 1;
    const origin = center(from.box);
    let pool: FocusCandidate<T>[];
    if (horizontal && from.row) pool = candidates.filter((c) => c.row === from.row);
    else if (horizontal) pool = candidates.filter((c) => !c.row || !c.clipped);
    else pool = visible;

    let best: FocusCandidate<T> | null = null;
    let bestScore = Infinity;
    pool.forEach((candidate) => {
        if (candidate.item === from.item) return;
        const point = center(candidate.box);
        const along = horizontal ? (point.x - origin.x) * sign : (point.y - origin.y) * sign;
        const across = Math.abs(horizontal ? point.y - origin.y : point.x - origin.x);
        if (along <= 1) return;
        const score = along + across * 2;
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    });
    return best ? (best as FocusCandidate<T>).item : null;
}

function describe(element: HTMLElement): FocusCandidate<HTMLElement> {
    const rect = element.getBoundingClientRect();
    const row = element.closest(`[${ARROW_ROW_ATTRIBUTE}]`);
    let clipped = false;
    if (row) {
        const rowRect = row.getBoundingClientRect();
        const middle = (rect.left + rect.right) / 2;
        clipped = middle < rowRect.left || middle > rowRect.right;
    }
    return {
        item: element,
        box: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        row,
        clipped,
    };
}

function focusablesIn(root: Element): HTMLElement[] {
    const nodes = root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]');
    const out: HTMLElement[] = [];
    for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (node && node.getBoundingClientRect().width > 0) out.push(node);
    }
    return out;
}

export function useArrowFocus(): void {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const direction = DIRECTIONS[event.key];
            if (!direction || event.defaultPrevented || event.altKey || event.ctrlKey) return;
            // The sign-in overlay opens over Home with its own route.
            if (getCurrentRoute().screen !== 'home') return;
            // The topmost layer that blocks the screen: the offline lock, then a dialog.
            const root =
                document.querySelector('[data-panel-lock]') ??
                document.querySelector('[role="alertdialog"]') ??
                document.querySelector('.panel-stage');
            if (!root) return;
            const active = document.activeElement as HTMLElement | null;
            const list = focusablesIn(root);
            const from = active && list.indexOf(active) >= 0 ? describe(active) : null;
            const next = nextInDirection(from, list.map(describe), direction);
            event.preventDefault();
            if (!next) return;
            next.focus();
            next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
}
