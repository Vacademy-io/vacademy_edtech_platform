import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
    NAV_MAX_AGE_MS,
    NAV_STEP_MAX_POLLS,
    NAV_STEP_POLL_MS,
    applyNavCounter,
    getRemoteTargetInfo,
    resetNavBaseline,
    seekRemoteTarget,
    subscribeRemoteTarget,
    useRemoteTarget,
    type RemoteTarget,
} from './remoteTarget';

function Registers({ target }: { target: RemoteTarget | null }) {
    useRemoteTarget(target);
    return null;
}

/** Same render order as the player: the child's effect runs before its parent's. */
function Parent({ target, child }: { target: RemoteTarget | null; child: RemoteTarget | null }) {
    useRemoteTarget(target);
    return <Registers target={child} />;
}

function fakeTarget(
    index = 0,
    total = 10,
    title = 'Slide'
): RemoteTarget & {
    next: ReturnType<typeof vi.fn>;
    prev: ReturnType<typeof vi.fn>;
} {
    return { next: vi.fn(), prev: vi.fn(), state: { index, total, title } };
}

const update = (nav_counter: number, nav_age_ms: number | null = 100, session_id = 's1') => ({
    session_id,
    nav_counter,
    nav_age_ms,
});

beforeEach(() => {
    resetNavBaseline();
    vi.useFakeTimers();
});

afterEach(() => {
    resetNavBaseline();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('applyNavCounter', () => {
    it('sets the baseline on a new session and moves nothing, however high the counter', () => {
        const target = fakeTarget();
        render(<Registers target={target} />);
        expect(applyNavCounter(update(41))).toEqual({ outcome: 'BASELINE', steps: 0 });
        expect(target.next).not.toHaveBeenCalled();
        expect(applyNavCounter(update(41))).toEqual({ outcome: 'NO_CHANGE', steps: 0 });
    });

    it('applies one fresh press', () => {
        const target = fakeTarget();
        render(<Registers target={target} />);
        applyNavCounter(update(5));
        expect(applyNavCounter(update(6))).toEqual({ outcome: 'APPLIED', steps: 1 });
        expect(target.next).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(NAV_STEP_POLL_MS * (NAV_STEP_MAX_POLLS + 1));
        expect(applyNavCounter(update(5))).toEqual({ outcome: 'APPLIED', steps: -1 });
        expect(target.prev).toHaveBeenCalledTimes(1);
    });

    it('applies a press exactly at the age limit and drops one just over it for good', () => {
        const target = fakeTarget();
        render(<Registers target={target} />);
        applyNavCounter(update(0));
        expect(applyNavCounter(update(1, NAV_MAX_AGE_MS)).outcome).toBe('APPLIED');
        expect(target.next).toHaveBeenCalledTimes(1);

        expect(applyNavCounter(update(2, NAV_MAX_AGE_MS + 1)).outcome).toBe('STALE');
        expect(target.next).toHaveBeenCalledTimes(1);
        // The baseline moved, so the dropped press does not fire on the next sync.
        expect(applyNavCounter(update(2, 50)).outcome).toBe('NO_CHANGE');
        expect(target.next).toHaveBeenCalledTimes(1);
    });

    it('treats a missing age as stale', () => {
        const target = fakeTarget();
        render(<Registers target={target} />);
        applyNavCounter(update(0));
        expect(applyNavCounter(update(1, null)).outcome).toBe('STALE');
        expect(target.next).not.toHaveBeenCalled();
    });

    it('clamps to three steps, one at a time, in both directions', () => {
        const target = fakeTarget();
        const { rerender } = render(<Registers target={target} />);
        applyNavCounter(update(0));
        expect(applyNavCounter(update(10))).toEqual({ outcome: 'APPLIED', steps: 3 });
        expect(target.next).toHaveBeenCalledTimes(1);

        // The first step lands: the next one goes on the following tick.
        const moved = { ...target, state: { ...target.state, index: 1 } };
        rerender(<Registers target={moved} />);
        vi.advanceTimersByTime(NAV_STEP_POLL_MS);
        expect(target.next).toHaveBeenCalledTimes(2);

        const movedAgain = { ...target, state: { ...target.state, index: 2 } };
        rerender(<Registers target={movedAgain} />);
        vi.advanceTimersByTime(NAV_STEP_POLL_MS);
        expect(target.next).toHaveBeenCalledTimes(3);
        vi.advanceTimersByTime(NAV_STEP_POLL_MS * 20);
        expect(target.next).toHaveBeenCalledTimes(3);

        expect(applyNavCounter(update(0))).toEqual({ outcome: 'APPLIED', steps: -3 });
        expect(target.prev).toHaveBeenCalledTimes(1);
    });

    it('gives up waiting for a target that does not move, so the last page cannot stall', () => {
        const target = fakeTarget(9, 10);
        render(<Registers target={target} />);
        applyNavCounter(update(0));
        applyNavCounter(update(2));
        expect(target.next).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(NAV_STEP_POLL_MS * NAV_STEP_MAX_POLLS);
        expect(target.next).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(NAV_STEP_POLL_MS);
        expect(target.next).toHaveBeenCalledTimes(2);
    });

    it('a later press does not wait on an earlier one that moved nothing', () => {
        const target = fakeTarget(9, 10);
        render(<Registers target={target} />);
        applyNavCounter(update(0));
        applyNavCounter(update(1));
        expect(target.next).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(NAV_STEP_POLL_MS * (NAV_STEP_MAX_POLLS + 1));
        expect(applyNavCounter(update(0)).outcome).toBe('APPLIED');
        expect(target.prev).toHaveBeenCalledTimes(1);
    });

    it('opposite presses before a step fires cancel out', () => {
        const target = fakeTarget();
        render(<Registers target={target} />);
        applyNavCounter(update(0));
        applyNavCounter(update(2));
        expect(target.next).toHaveBeenCalledTimes(1);
        applyNavCounter(update(1));
        vi.advanceTimersByTime(NAV_STEP_POLL_MS * 30);
        expect(target.next).toHaveBeenCalledTimes(1);
        expect(target.prev).not.toHaveBeenCalled();
    });

    it('drops a press when no target is registered, without firing it later', () => {
        applyNavCounter(update(0));
        expect(applyNavCounter(update(1))).toEqual({ outcome: 'NO_TARGET', steps: 0 });
        const target = fakeTarget();
        render(<Registers target={target} />);
        expect(applyNavCounter(update(1)).outcome).toBe('NO_CHANGE');
        expect(target.next).not.toHaveBeenCalled();
    });

    it.each(['dialog', 'alertdialog'])('drops a press while a %s is open', (role) => {
        const target = fakeTarget();
        render(<Registers target={target} />);
        applyNavCounter(update(0));
        const dialog = document.createElement('div');
        dialog.setAttribute('role', role);
        document.body.appendChild(dialog);
        expect(applyNavCounter(update(1))).toEqual({ outcome: 'DIALOG_OPEN', steps: 0 });
        expect(target.next).not.toHaveBeenCalled();
        dialog.remove();
        expect(applyNavCounter(update(1)).outcome).toBe('NO_CHANGE');
        expect(target.next).not.toHaveBeenCalled();
    });

    it('stops queued steps when a dialog opens or the target goes away', () => {
        const target = fakeTarget();
        const { rerender } = render(<Registers target={target} />);
        applyNavCounter(update(0));
        applyNavCounter(update(3));
        expect(target.next).toHaveBeenCalledTimes(1);
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        document.body.appendChild(dialog);
        vi.advanceTimersByTime(NAV_STEP_POLL_MS * 30);
        expect(target.next).toHaveBeenCalledTimes(1);
        dialog.remove();

        applyNavCounter(update(6));
        expect(target.next).toHaveBeenCalledTimes(2);
        rerender(<Registers target={null} />);
        vi.advanceTimersByTime(NAV_STEP_POLL_MS * 30);
        expect(target.next).toHaveBeenCalledTimes(2);
    });

    it('takes a new baseline on a new session and drops steps queued for the old one', () => {
        const target = fakeTarget();
        render(<Registers target={target} />);
        applyNavCounter(update(0));
        applyNavCounter(update(3));
        expect(target.next).toHaveBeenCalledTimes(1);
        expect(applyNavCounter(update(100, 50, 's2')).outcome).toBe('BASELINE');
        vi.advanceTimersByTime(NAV_STEP_POLL_MS * 30);
        expect(target.next).toHaveBeenCalledTimes(1);
        expect(applyNavCounter(update(101, 50, 's2')).outcome).toBe('APPLIED');
        expect(target.next).toHaveBeenCalledTimes(2);
    });

    it('needs a new baseline after resetNavBaseline, even for the same session', () => {
        const target = fakeTarget();
        render(<Registers target={target} />);
        applyNavCounter(update(0));
        resetNavBaseline();
        expect(applyNavCounter(update(9)).outcome).toBe('BASELINE');
        expect(target.next).not.toHaveBeenCalled();
    });

    it('calls the latest committed target, not the one that first registered', () => {
        const first = fakeTarget();
        const second = fakeTarget(1);
        const { rerender } = render(<Registers target={first} />);
        rerender(<Registers target={second} />);
        applyNavCounter(update(0));
        applyNavCounter(update(1));
        expect(first.next).not.toHaveBeenCalled();
        expect(second.next).toHaveBeenCalledTimes(1);
    });
});

describe('useRemoteTarget', () => {
    it('clears the slot on unmount', () => {
        const { unmount } = render(<Registers target={fakeTarget(2, 8, 'Forces')} />);
        expect(getRemoteTargetInfo()).toEqual({
            hasTarget: true,
            state: { index: 2, total: 8, title: 'Forces' },
        });
        unmount();
        expect(getRemoteTargetInfo()).toEqual({ hasTarget: false, state: null });
    });

    it('a parent passing null does not wipe a child mounted inside it', () => {
        const child = fakeTarget(4, 12, 'PDF page');
        render(<Parent target={null} child={child} />);
        expect(getRemoteTargetInfo().state).toEqual({ index: 4, total: 12, title: 'PDF page' });
        applyNavCounter(update(0));
        applyNavCounter(update(1));
        expect(child.next).toHaveBeenCalledTimes(1);
    });

    it('a parent re-rendering with null keeps the child, and the child leaving empties the slot', () => {
        const child = fakeTarget();
        const { rerender } = render(<Parent target={null} child={child} />);
        rerender(<Parent target={null} child={child} />);
        expect(getRemoteTargetInfo().hasTarget).toBe(true);
        rerender(<Parent target={null} child={null} />);
        expect(getRemoteTargetInfo().hasTarget).toBe(false);
    });

    it('notifies only when presence or position changes', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeRemoteTarget(listener);
        const { rerender, unmount } = render(<Registers target={fakeTarget(0, 5, 'A')} />);
        expect(listener).toHaveBeenCalledTimes(1);
        rerender(<Registers target={fakeTarget(0, 5, 'A')} />);
        expect(listener).toHaveBeenCalledTimes(1);
        rerender(<Registers target={fakeTarget(1, 5, 'A')} />);
        expect(listener).toHaveBeenCalledTimes(2);
        act(() => unmount());
        expect(listener).toHaveBeenCalledTimes(3);
        unsubscribe();
    });

    it('seekRemoteTarget reports when there is nothing that can seek', () => {
        expect(seekRemoteTarget(3)).toBe(false);
        const { rerender } = render(<Registers target={fakeTarget()} />);
        expect(seekRemoteTarget(3)).toBe(false);
        const seek = vi.fn();
        rerender(<Registers target={{ ...fakeTarget(), seek }} />);
        expect(seekRemoteTarget(3)).toBe(true);
        expect(seek).toHaveBeenCalledWith(3);
    });
});
