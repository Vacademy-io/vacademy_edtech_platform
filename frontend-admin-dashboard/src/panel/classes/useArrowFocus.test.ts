import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextInDirection, useArrowFocus, type FocusCandidate } from './useArrowFocus';

vi.mock('../router', () => ({ getCurrentRoute: () => ({ screen: 'home', params: {} }) }));

const ROW = { name: 'strip' };

function at(
    item: string,
    left: number,
    top: number,
    options: { row?: unknown; clipped?: boolean; width?: number; height?: number } = {}
): FocusCandidate<string> {
    return {
        item,
        box: {
            left,
            top,
            right: left + (options.width ?? 100),
            bottom: top + (options.height ?? 100),
        },
        row: options.row ?? null,
        clipped: options.clipped ?? false,
    };
}

const toggle = at('toggle', 800, 0, { height: 40 });
const card1 = at('card1', 0, 100, { row: ROW });
const card2 = at('card2', 120, 100, { row: ROW });
const card3 = at('card3', 900, 100, { row: ROW, clipped: true });
const tile1 = at('tile1', 0, 300);
const tile2 = at('tile2', 500, 300);
const all = [toggle, card1, card2, card3, tile1, tile2];

describe('nextInDirection', () => {
    it('moves along the row, into cards that are scrolled out of view', () => {
        expect(nextInDirection(card1, all, 'right')).toBe('card2');
        expect(nextInDirection(card2, all, 'right')).toBe('card3');
        expect(nextInDirection(card2, all, 'left')).toBe('card1');
    });

    it('does not leave the row sideways', () => {
        expect(nextInDirection(card3, all, 'right')).toBeNull();
        expect(nextInDirection(card1, all, 'left')).toBeNull();
    });

    it('down from a card reaches the tile under it', () => {
        expect(nextInDirection(card1, all, 'down')).toBe('tile1');
    });

    it('up from a tile never lands on a scrolled-out card', () => {
        const under = at('tile3', 900, 300);
        expect(nextInDirection(under, [...all, under], 'up')).toBe('toggle');
    });

    it('up from a card reaches the toggle', () => {
        expect(nextInDirection(card2, all, 'up')).toBe('toggle');
    });

    it('moves between tiles', () => {
        expect(nextInDirection(tile1, all, 'right')).toBe('tile2');
    });

    it('nothing further that way is nothing', () => {
        expect(nextInDirection(tile1, all, 'down')).toBeNull();
    });

    it('with nothing focused, starts at the top left', () => {
        expect(nextInDirection(null, [tile2, card1, tile1], 'down')).toBe('card1');
    });
});

describe('useArrowFocus', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('with the offline lock up, arrows stay on the lock and off what is behind it', () => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            top: 0,
            right: 100,
            bottom: 100,
            width: 100,
            height: 100,
        } as DOMRect);
        document.body.innerHTML = `
            <div class="panel-stage"><button id="hidden">Start</button></div>
            <div role="alert" data-panel-lock><button id="lock">Sign out</button></div>`;
        renderHook(() => useArrowFocus());
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        expect(document.activeElement?.id).toBe('lock');
    });
});
