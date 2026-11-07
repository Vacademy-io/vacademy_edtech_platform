import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodayClass, TodayResponse, TodayScope } from '@/classroom-shared/apiTypes';
import { clearTodayCache } from './todayCache';
import {
    TODAY_REFRESH_JITTER_MS,
    TODAY_REFRESH_MS,
    TODAY_RETURN_STALE_MS,
    createTodayFlow,
    type TodayChoice,
    type TodayView,
} from './todayFlow';
import { T0, makeClass } from './testRows';

const offlineError = new Error('offline');

function answer(classes: TodayClass[], truncated = false): TodayResponse {
    return { server_time_ms: T0, classes, truncated };
}

function setup(initialChoice?: TodayChoice, random?: () => number) {
    const calls: TodayScope[] = [];
    const answers: Record<TodayScope, Array<TodayResponse | Error | Promise<TodayResponse>>> = {
        mine: [],
        all: [],
    };
    const views: TodayView[] = [];
    const flow = createTodayFlow({
        userId: 'u1',
        instituteId: 'inst-a',
        initialChoice,
        random,
        fetchToday: (scope) => {
            calls.push(scope);
            const next = answers[scope].length > 1 ? answers[scope].shift() : answers[scope][0];
            if (next instanceof Error) return Promise.reject(next);
            return Promise.resolve(next ?? answer([]));
        },
        isOffline: (error) => error === offlineError,
        onView: (view) => views.push(view),
    });
    return { flow, calls, answers, views, last: () => views[views.length - 1]! };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('today flow', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        clearTodayCache();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts on a skeleton, then shows Mine without asking for All', async () => {
        const { flow, calls, answers, views, last } = setup();
        answers.mine = [answer([makeClass()])];
        flow.start();
        expect(views[0]?.phase).toBe('loading');
        await flush();
        expect(calls).toEqual(['mine']);
        expect(last()).toMatchObject({ phase: 'list', scope: 'mine', fellBack: false });
        flow.stop();
    });

    it('Mine empty falls back to All with the label', async () => {
        const { flow, calls, answers, last } = setup();
        answers.mine = [answer([])];
        answers.all = [answer([makeClass({ title: 'Other' })])];
        flow.start();
        await flush();
        expect(calls).toEqual(['mine', 'all']);
        expect(last()).toMatchObject({ phase: 'list', scope: 'all', fellBack: true });
        flow.stop();
    });

    it('both empty is the empty state, with All selected', async () => {
        const { flow, last } = setup();
        flow.start();
        await flush();
        expect(last()).toMatchObject({ phase: 'empty', scope: 'all', fellBack: false });
        flow.stop();
    });

    it('choosing Mine stays on Mine even when empty', async () => {
        const { flow, calls, answers, last } = setup();
        answers.all = [answer([makeClass()])];
        flow.start();
        await flush();
        calls.length = 0;
        flow.choose('mine');
        await flush();
        expect(calls).toEqual(['mine']);
        expect(last()).toMatchObject({ phase: 'empty', scope: 'mine', choice: 'mine' });
        flow.stop();
    });

    it('choosing All does not fall back or ask for Mine', async () => {
        const { flow, calls, answers, last } = setup('all');
        answers.all = [answer([makeClass()])];
        flow.start();
        await flush();
        expect(calls).toEqual(['all']);
        expect(last()).toMatchObject({ phase: 'list', scope: 'all', fellBack: false });
        flow.stop();
    });

    it('a failed refresh keeps the list, with Retry state and the time of that list', async () => {
        const { flow, answers, last } = setup();
        answers.mine = [answer([makeClass()]), new Error('500')];
        flow.start();
        await flush();
        flow.refresh();
        await flush();
        expect(last()).toMatchObject({
            phase: 'list',
            problem: 'error',
            asOf: '10:00',
        });
        expect(last().classes).toHaveLength(1);
        flow.stop();
    });

    it('with no list at all a failure is the failed state', async () => {
        const { flow, answers, last } = setup();
        answers.mine = [new Error('500')];
        flow.start();
        await flush();
        expect(last()).toMatchObject({ phase: 'failed', problem: 'error' });
        flow.stop();
    });

    it('offline at boot shows the stored list with As of, from a new flow', async () => {
        const first = setup();
        first.answers.mine = [answer([makeClass()])];
        first.flow.start();
        await flush();
        first.flow.stop();

        const second = setup();
        second.answers.mine = [offlineError];
        second.flow.start();
        expect(second.views[0]).toMatchObject({ phase: 'list', problem: null, asOf: null });
        await flush();
        expect(second.last()).toMatchObject({ phase: 'list', problem: 'offline', asOf: '10:00' });
        second.flow.stop();
    });

    it('offline after a fallback shows All as the fallback', async () => {
        const first = setup();
        first.answers.all = [answer([makeClass()])];
        first.flow.start();
        await flush();
        first.flow.stop();

        const second = setup();
        second.answers.mine = [offlineError];
        second.flow.start();
        await flush();
        expect(second.last()).toMatchObject({ scope: 'all', fellBack: true, problem: 'offline' });
        second.flow.stop();
    });

    it('offline with nothing stored is the failed state, marked offline', async () => {
        const { flow, answers, last } = setup();
        answers.mine = [offlineError];
        flow.start();
        await flush();
        expect(last()).toMatchObject({ phase: 'failed', problem: 'offline' });
        flow.stop();
    });

    it('a stored list from yesterday is not used', async () => {
        const first = setup();
        first.answers.mine = [answer([makeClass()])];
        first.flow.start();
        await flush();
        first.flow.stop();

        vi.setSystemTime(T0 + 24 * 60 * 60 * 1000);
        const second = setup();
        second.answers.mine = [offlineError];
        second.flow.start();
        await flush();
        expect(second.last()).toMatchObject({ phase: 'failed', problem: 'offline' });
        second.flow.stop();
    });

    it('status time follows the server even with a wrong panel clock', async () => {
        vi.setSystemTime(T0 - 2 * 24 * 60 * 60 * 1000);
        const { flow, answers, last } = setup();
        answers.mine = [answer([makeClass()])];
        flow.start();
        await flush();
        expect(Date.now() + last().serverOffsetMs).toBe(T0);
        flow.stop();
    });

    it('refreshes after 5 min plus jitter, and only once per timer', async () => {
        const { flow, calls, answers } = setup(undefined, () => 0.5);
        answers.mine = [answer([makeClass()])];
        flow.start();
        await flush();
        calls.length = 0;
        await vi.advanceTimersByTimeAsync(TODAY_REFRESH_MS + TODAY_REFRESH_JITTER_MS / 2 - 1);
        expect(calls).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(calls).toEqual(['mine']);
        flow.stop();
    });

    it('jitter spreads panels across the window', async () => {
        const low = setup(undefined, () => 0);
        low.flow.start();
        await flush();
        low.calls.length = 0;
        await vi.advanceTimersByTimeAsync(TODAY_REFRESH_MS);
        expect(low.calls.length).toBeGreaterThan(0);
        low.flow.stop();

        const high = setup(undefined, () => 0.99);
        high.flow.start();
        await flush();
        high.calls.length = 0;
        await vi.advanceTimersByTimeAsync(TODAY_REFRESH_MS);
        expect(high.calls).toEqual([]);
        high.flow.stop();
    });

    it('nothing fires after stop', async () => {
        const { flow, calls, views } = setup();
        flow.start();
        await flush();
        flow.stop();
        calls.length = 0;
        const count = views.length;
        await vi.advanceTimersByTimeAsync(TODAY_REFRESH_MS + TODAY_REFRESH_JITTER_MS);
        expect(calls).toEqual([]);
        expect(views.length).toBe(count);
    });

    it('a slow answer for the old scope cannot overwrite the new one', async () => {
        let releaseMine: (value: TodayResponse) => void = () => undefined;
        const views: TodayView[] = [];
        const flow = createTodayFlow({
            userId: 'u1',
            instituteId: 'inst-a',
            fetchToday: (scope) =>
                scope === 'mine'
                    ? new Promise((resolve) => {
                          releaseMine = resolve;
                      })
                    : Promise.resolve(answer([makeClass({ title: 'All list' })])),
            isOffline: () => false,
            onView: (view) => views.push(view),
        });
        flow.start();
        flow.choose('all');
        await flush();
        releaseMine(answer([makeClass({ title: 'Late mine' })]));
        await flush();
        expect(views[views.length - 1]?.classes[0]?.title).toBe('All list');
        flow.stop();
    });

    it('coming back refreshes only a list that has gone stale', async () => {
        const { flow, calls, answers } = setup();
        answers.mine = [answer([makeClass()])];
        flow.start();
        await flush();
        calls.length = 0;
        flow.noteReturned();
        await flush();
        expect(calls).toEqual([]);
        await vi.advanceTimersByTimeAsync(TODAY_RETURN_STALE_MS + 1);
        flow.noteReturned();
        await flush();
        expect(calls).toEqual(['mine']);
        flow.stop();
    });

    it('the network coming back retries only after a failure', async () => {
        const { flow, calls, answers, last } = setup();
        answers.mine = [answer([makeClass()])];
        flow.start();
        await flush();
        calls.length = 0;
        flow.noteOnline();
        await flush();
        expect(calls).toEqual([]);

        answers.mine = [offlineError, answer([makeClass()])];
        flow.refresh();
        await flush();
        expect(last().problem).toBe('offline');
        calls.length = 0;
        flow.noteOnline();
        await flush();
        expect(calls).toEqual(['mine']);
        expect(last().problem).toBeNull();
        flow.stop();
    });
});
