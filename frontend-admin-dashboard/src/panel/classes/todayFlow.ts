/**
 * The Today list as a small state machine, separate from React so its timing can be
 * tested. It decides which scope to ask for, falls back from Mine to All, keeps the last
 * list when a refresh fails, and re-arms a jittered refresh.
 *
 *   auto  Mine, and when Mine is empty, All with the "All classes today" label
 *   mine  Mine, even when empty (the teacher asked for it)
 *   all   All
 */
import type { TodayClass, TodayResponse, TodayScope } from '@/classroom-shared/apiTypes';
import {
    isListCurrent,
    makeStoredList,
    readTodayList,
    writeTodayList,
    type StoredTodayList,
} from './todayCache';
import { zonedTime } from './todayStatus';

export type TodayChoice = 'auto' | TodayScope;
export type TodayProblem = 'offline' | 'error';

export interface TodayView {
    phase: 'loading' | 'list' | 'empty' | 'failed';
    /** The scope on screen, which is what the toggle highlights. */
    scope: TodayScope;
    choice: TodayChoice;
    classes: TodayClass[];
    /** Mine was empty, so this is All. */
    fellBack: boolean;
    truncated: boolean;
    /** The latest attempt failed. Any list on screen is the last good one. */
    problem: TodayProblem | null;
    /** HH:mm of the list on screen, set when it is not fresh. */
    asOf: string | null;
    /** Server time minus local time, for status labels. */
    serverOffsetMs: number;
}

export const TODAY_REFRESH_MS = 5 * 60 * 1000;
export const TODAY_REFRESH_JITTER_MS = 60 * 1000;
/** Coming back to the page refreshes a list older than this. */
export const TODAY_RETURN_STALE_MS = 60 * 1000;

export interface TodayFlowOptions {
    userId: string;
    instituteId: string;
    initialChoice?: TodayChoice;
    fetchToday: (scope: TodayScope) => Promise<TodayResponse>;
    isOffline: (error: unknown) => boolean;
    onView: (view: TodayView) => void;
    /** Test seam. Defaults to Math.random. */
    random?: () => number;
}

export interface TodayFlow {
    start: () => void;
    stop: () => void;
    /** A manual retry, or anything else that should ask again now. */
    refresh: () => void;
    /** Coming back to a page that was hidden. */
    noteReturned: () => void;
    /** The network came back. Asks again only if the last attempt failed. */
    noteOnline: () => void;
    choose: (scope: TodayScope) => void;
    getChoice: () => TodayChoice;
}

export function createTodayFlow(options: TodayFlowOptions): TodayFlow {
    const { userId, instituteId, fetchToday, isOffline, onView } = options;
    const random = options.random ?? Math.random;

    let choice: TodayChoice = options.initialChoice ?? 'auto';
    let generation = 0;
    let stopped = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAttemptFailed = false;
    let lastSuccessAt = 0;
    const lists: Partial<Record<TodayScope, StoredTodayList>> = {};

    function known(scope: TodayScope): StoredTodayList | null {
        const list = lists[scope] ?? readTodayList(userId, instituteId, scope);
        if (!list || !isListCurrent(list)) return null;
        return list;
    }

    /** What this choice would show from what is already known, if anything. */
    function bestKnown(): { list: StoredTodayList; scope: TodayScope; fellBack: boolean } | null {
        if (choice === 'all' || choice === 'mine') {
            const list = known(choice);
            return list && list.classes.length > 0
                ? { list, scope: choice, fellBack: false }
                : null;
        }
        const mine = known('mine');
        if (mine && mine.classes.length > 0) return { list: mine, scope: 'mine', fellBack: false };
        const all = known('all');
        return all && all.classes.length > 0 ? { list: all, scope: 'all', fellBack: true } : null;
    }

    function emit(view: Omit<TodayView, 'choice'>): void {
        if (!stopped) onView({ ...view, choice });
    }

    function emitList(
        list: StoredTodayList,
        scope: TodayScope,
        fellBack: boolean,
        problem: TodayProblem | null
    ): void {
        emit({
            phase: list.classes.length > 0 ? 'list' : 'empty',
            scope,
            classes: list.classes,
            fellBack,
            truncated: list.truncated,
            problem,
            asOf: problem ? zonedTime(list.server_time_ms, list.zone_offset_ms) : null,
            serverOffsetMs: list.offset_ms,
        });
    }

    function emitBare(phase: TodayView['phase'], problem: TodayProblem | null): void {
        emit({
            phase,
            scope: choice === 'all' ? 'all' : 'mine',
            classes: [],
            fellBack: false,
            truncated: false,
            problem,
            asOf: null,
            serverOffsetMs: 0,
        });
    }

    async function ask(scope: TodayScope): Promise<StoredTodayList> {
        const body = await fetchToday(scope);
        const classes = Array.isArray(body?.classes) ? body.classes : null;
        if (!classes) throw new Error('Unexpected answer from /today');
        const now = Date.now();
        const list = makeStoredList(
            classes,
            !!body.truncated,
            typeof body.server_time_ms === 'number' ? body.server_time_ms : now,
            now
        );
        lists[scope] = list;
        writeTodayList(userId, instituteId, scope, list);
        return list;
    }

    function arm(): void {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(
            () => {
                timer = null;
                void load();
            },
            TODAY_REFRESH_MS + Math.floor(random() * TODAY_REFRESH_JITTER_MS)
        );
    }

    async function load(): Promise<void> {
        generation += 1;
        const mine = generation;
        const stale = () => stopped || mine !== generation;
        const wanted: TodayScope = choice === 'all' ? 'all' : 'mine';
        const shown = bestKnown();
        if (shown) emitList(shown.list, shown.scope, shown.fellBack, null);
        else emitBare('loading', null);
        arm();
        try {
            const first = await ask(wanted);
            if (stale()) return;
            if (choice === 'auto' && first.classes.length === 0) {
                const all = await ask('all');
                if (stale()) return;
                emitList(all, 'all', all.classes.length > 0, null);
            } else {
                emitList(first, wanted, false, null);
            }
            lastAttemptFailed = false;
            lastSuccessAt = Date.now();
        } catch (error) {
            if (stale()) return;
            lastAttemptFailed = true;
            const problem: TodayProblem = isOffline(error) ? 'offline' : 'error';
            const fallback = bestKnown();
            if (fallback) emitList(fallback.list, fallback.scope, fallback.fellBack, problem);
            else emitBare('failed', problem);
        }
    }

    return {
        start() {
            if (!stopped) return;
            stopped = false;
            void load();
        },
        stop() {
            stopped = true;
            generation += 1;
            if (timer !== null) clearTimeout(timer);
            timer = null;
        },
        refresh() {
            if (!stopped) void load();
        },
        noteReturned() {
            if (!stopped && Date.now() - lastSuccessAt > TODAY_RETURN_STALE_MS) void load();
        },
        noteOnline() {
            if (!stopped && lastAttemptFailed) void load();
        },
        choose(scope) {
            choice = scope;
            if (!stopped) void load();
        },
        getChoice() {
            return choice;
        },
    };
}
