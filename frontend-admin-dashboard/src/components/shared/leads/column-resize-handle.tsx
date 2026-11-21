import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from './use-lead-column-prefs';

interface ColumnResizeHandleProps {
    /** Column being resized — passed straight back to the callbacks. */
    columnId: string;
    /** Human label, for the handle's accessible name. */
    label: string;
    /** Live width during the drag; not persisted. */
    onResize: (id: string, width: number) => void;
    /** Drag finished — persist whatever the last width was. */
    onCommit: () => void;
    /** Double-click / Escape: drop back to the column's natural width. */
    onClear: (id: string) => void;
}

/** How far one arrow-key press moves the edge; Shift multiplies it. */
const KEY_STEP = 16;

/**
 * The grab strip on a column header's trailing edge.
 *
 * Pointer events rather than mouse events, so a trackpad, a mouse and a touch screen all
 * take the same path, and `setPointerCapture` keeps the drag alive when the cursor runs
 * outside the (scrollable) table — dragging a column wider almost always leaves the header.
 *
 * It is a real <button>, not a bare <div>: resizing is otherwise mouse-only, and a column
 * truncating someone's name is exactly the case a keyboard user also needs to fix. Arrow
 * keys nudge the edge, Escape restores the natural width.
 */
export function ColumnResizeHandle({
    columnId,
    label,
    onResize,
    onCommit,
    onClear,
}: ColumnResizeHandleProps) {
    // Width of the <th> when the drag started, plus the pointer x at that moment. Deltas
    // are measured against these rather than against the live width, so a drag that
    // outruns the clamp doesn't accumulate drift once it comes back inside the range.
    const drag = useRef<{ startX: number; startWidth: number } | null>(null);

    const headerWidth = useCallback((el: HTMLElement) => {
        const th = el.closest('th');
        return th ? th.getBoundingClientRect().width : 0;
    }, []);

    const handlePointerDown = useCallback(
        (e: React.PointerEvent<HTMLButtonElement>) => {
            // Left button only, and never let the header's sort button see this.
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            drag.current = {
                startX: e.clientX,
                startWidth: headerWidth(e.currentTarget),
            };
            e.currentTarget.setPointerCapture(e.pointerId);
        },
        [headerWidth]
    );

    const handlePointerMove = useCallback(
        (e: React.PointerEvent<HTMLButtonElement>) => {
            if (!drag.current) return;
            onResize(columnId, drag.current.startWidth + (e.clientX - drag.current.startX));
        },
        [columnId, onResize]
    );

    const endDrag = useCallback(
        (e: React.PointerEvent<HTMLButtonElement>) => {
            if (!drag.current) return;
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
            onCommit();
        },
        [onCommit]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLButtonElement>) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClear(columnId);
                return;
            }
            const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!dir) return;
            e.preventDefault();
            e.stopPropagation();
            const step = KEY_STEP * (e.shiftKey ? 4 : 1);
            onResize(columnId, headerWidth(e.currentTarget) + dir * step);
            onCommit();
        },
        [columnId, headerWidth, onClear, onCommit, onResize]
    );

    return (
        <button
            type="button"
            // A separator with a value range is what a screen reader needs to announce this
            // as a resizer rather than as a nameless button.
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${label} column`}
            aria-valuemin={MIN_COLUMN_WIDTH}
            aria-valuemax={MAX_COLUMN_WIDTH}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={handleKeyDown}
            onDoubleClick={() => onClear(columnId)}
            onClick={(e) => e.stopPropagation()}
            title={`Drag to resize · double-click to reset`}
            className={cn(
                // Straddles the cell border so the grab target is centred on the line people
                // actually aim at. 12px wide because an 8px target on a 1px line is a miss
                // more often than a hit. touch-none stops the browser claiming the gesture
                // as a scroll before the handler sees it.
                'group absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none items-stretch justify-center',
                'focus-visible:outline-none'
            )}
        >
            {/*
              Always drawn, not revealed on hover. A handle you can only find by sweeping the
              mouse along the header is a handle nobody finds — the first build hid these
              until hover to avoid a "picket fence", and the result was a feature that may as
              well not have shipped. At neutral-200 they read as ordinary column separators,
              which is exactly what every spreadsheet trains people to grab.
            */}
            <span
                aria-hidden="true"
                className="w-px bg-neutral-200 transition-colors group-hover:w-0.5 group-hover:bg-primary-400 group-focus-visible:w-0.5 group-focus-visible:bg-primary-500"
            />
        </button>
    );
}
