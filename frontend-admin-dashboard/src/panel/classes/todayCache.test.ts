import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearTodayCache,
    isListCurrent,
    makeStoredList,
    readTodayList,
    writeTodayList,
} from './todayCache';
import { MIN, T0, makeClass } from './testRows';

const list = (classes = [makeClass()]) => makeStoredList(classes, false, T0, T0);

describe('today cache', () => {
    beforeEach(() => {
        clearTodayCache();
    });

    it('gives a list back to the same teacher, institute, scope and day', () => {
        writeTodayList('u1', 'inst-a', 'mine', list());
        expect(readTodayList('u1', 'inst-a', 'mine', T0 + 60 * MIN)?.classes).toHaveLength(1);
    });

    it('never gives one teacher the list of another', () => {
        writeTodayList('u1', 'inst-a', 'mine', list());
        expect(readTodayList('u2', 'inst-a', 'mine', T0)).toBeNull();
    });

    it('does not cross institutes or scopes', () => {
        writeTodayList('u1', 'inst-a', 'mine', list());
        expect(readTodayList('u1', 'inst-b', 'mine', T0)).toBeNull();
        expect(readTodayList('u1', 'inst-a', 'all', T0)).toBeNull();
    });

    it('stops at the end of the session day, not 24 h later', () => {
        writeTodayList('u1', 'inst-a', 'mine', list());
        // T0 is 10:00. 13 h 59 min on is 23:59 the same day; 14 h on is tomorrow.
        expect(readTodayList('u1', 'inst-a', 'mine', T0 + 839 * MIN)).not.toBeNull();
        expect(readTodayList('u1', 'inst-a', 'mine', T0 + 840 * MIN)).toBeNull();
    });

    it('a panel clock wrong by a day gets nothing', () => {
        writeTodayList('u1', 'inst-a', 'mine', list());
        expect(readTodayList('u1', 'inst-a', 'mine', T0 - 24 * 60 * MIN)).toBeNull();
    });

    it('a correct list survives a panel clock that was already off when it was fetched', () => {
        const wrongClock = T0 - 3 * 24 * 60 * MIN;
        const stored = makeStoredList([makeClass()], false, T0, wrongClock);
        expect(isListCurrent(stored, wrongClock + 5 * MIN)).toBe(true);
        writeTodayList('u1', 'inst-a', 'mine', stored);
        expect(readTodayList('u1', 'inst-a', 'mine', wrongClock + 5 * MIN)).not.toBeNull();
    });

    it('an empty answer clears that scope', () => {
        writeTodayList('u1', 'inst-a', 'mine', list());
        writeTodayList('u1', 'inst-a', 'mine', list([]));
        expect(readTodayList('u1', 'inst-a', 'mine', T0)).toBeNull();
    });

    it('a new day drops every older entry', () => {
        writeTodayList('u1', 'inst-a', 'mine', list());
        const tomorrow = T0 + 24 * 60 * MIN;
        writeTodayList(
            'u2',
            'inst-a',
            'mine',
            makeStoredList(
                [makeClass({ meeting_date: '2026-11-05', starts_at_ms: tomorrow })],
                false,
                tomorrow,
                tomorrow
            )
        );
        const raw = JSON.parse(window.localStorage.getItem('panel.classes.today') ?? '{}');
        expect(Object.keys(raw)).toEqual(['u2']);
    });

    it('survives junk in storage', () => {
        window.localStorage.setItem('panel.classes.today', '{"u1":{"institute_id":"inst-a"');
        expect(readTodayList('u1', 'inst-a', 'mine', T0)).toBeNull();
        window.localStorage.setItem(
            'panel.classes.today',
            JSON.stringify({ u1: { institute_id: 'inst-a', day: 'x', mine: { classes: 'no' } } })
        );
        expect(readTodayList('u1', 'inst-a', 'mine', T0)).toBeNull();
    });

    it('a user id like a built-in property name reads nothing', () => {
        expect(readTodayList('__proto__', 'inst-a', 'mine', T0)).toBeNull();
    });

    it('clear removes everything', () => {
        writeTodayList('u1', 'inst-a', 'mine', list());
        clearTodayCache();
        expect(readTodayList('u1', 'inst-a', 'mine', T0)).toBeNull();
    });
});
