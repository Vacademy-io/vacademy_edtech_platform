import { describe, expect, it } from 'vitest';
import { paneForKey } from './pane-keys';

describe('pane tabs keyboard', () => {
    it.each([
        ['list', 'ArrowRight', 'edit'],
        ['preview', 'ArrowRight', 'list'],
        ['list', 'ArrowLeft', 'preview'],
        ['edit', 'Home', 'list'],
        ['edit', 'End', 'preview'],
        ['edit', 'Enter', null],
    ] as const)('%s + %s → %s', (from, key, to) => {
        expect(paneForKey(from, key)).toBe(to);
    });
});
