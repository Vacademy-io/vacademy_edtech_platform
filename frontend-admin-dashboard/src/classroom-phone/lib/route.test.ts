// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { consumeLocation, forgetTap, initRoute, parseFragment, rememberTap } from './route';

describe('parseFragment', () => {
    it('reads each fragment form', () => {
        expect(parseFragment('#c=abc_DEF-123')).toEqual({ kind: 'approve', t: 'abc_DEF-123' });
        expect(parseFragment('#pair=K7QF2M9X')).toEqual({ kind: 'pair', code: 'K7QF2M9X' });
        expect(parseFragment('#s=sched-1&i=inst-a')).toEqual({
            kind: 'start',
            scheduleId: 'sched-1',
            instituteId: 'inst-a',
        });
    });

    it('ignores empty, partial and oversized values', () => {
        expect(parseFragment('')).toBeNull();
        expect(parseFragment('#c=')).toBeNull();
        expect(parseFragment('#s=only-schedule')).toBeNull();
        expect(parseFragment(`#c=${'x'.repeat(129)}`)).toBeNull();
    });
});

describe('stored tap', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        window.history.replaceState(null, '', '/classroom#c=tok');
    });

    it('keeps who tapped, and sign-out drops the tap but not the step', () => {
        initRoute();
        rememberTap(42, 'teacher-a');
        expect(consumeLocation()).toEqual({
            kind: 'approve',
            t: 'tok',
            tapped: 42,
            tappedBy: 'teacher-a',
        });
        forgetTap();
        expect(consumeLocation()).toEqual({ kind: 'approve', t: 'tok' });
    });
});

describe('consumeLocation', () => {
    const NOW = 1_800_000_000_000;

    beforeEach(() => {
        window.sessionStorage.clear();
        window.history.replaceState(null, '', '/classroom');
    });

    it('takes the fragment off the URL and keeps it for this tab', () => {
        window.location.hash = '#c=token-1';
        expect(consumeLocation(NOW)).toEqual({ kind: 'approve', t: 'token-1' });
        expect(window.location.hash).toBe('');
        expect(window.location.href).not.toContain('token-1');
        expect(consumeLocation(NOW + 60_000)).toEqual({ kind: 'approve', t: 'token-1' });
    });

    it('drops the stash after 10 minutes', () => {
        window.location.hash = '#pair=ABCD2345';
        consumeLocation(NOW);
        expect(consumeLocation(NOW + 10 * 60_000 + 1)).toBeNull();
        expect(consumeLocation(NOW)).toBeNull();
    });

    it('clears a fragment it does not understand', () => {
        window.location.hash = '#nonsense=1';
        expect(consumeLocation(NOW)).toBeNull();
        expect(window.location.hash).toBe('');
    });
});
