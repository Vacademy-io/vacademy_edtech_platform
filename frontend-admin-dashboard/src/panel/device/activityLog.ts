/**
 * Phase 2: the queue of "what was shown" events (lesson slide, deck, live deck, class,
 * whiteboard, home) that rides on /sync and /session/end. No request of its own.
 *
 * - One session at a time, persisted under PANEL_STORAGE_KEYS.activity as
 *   {session_id, next_seq, items, dropped, last_key}, so a restart keeps what was not sent.
 * - seq starts at 1 per session and only grows. The server acks the largest seq it
 *   received; ackActivity drops everything up to it.
 * - Bounded: at most ACTIVITY_PER_SESSION events per session (the server keeps no more),
 *   and never more than that many queued. Anything past the bound only counts as dropped,
 *   so a panel that is offline for days stores the same few kilobytes.
 * - Coalescing: the same thing shown twice in a row is one event, and an unsent event
 *   replaced within ACTIVITY_COALESCE_MS (flicking through slides) is overwritten.
 * - A session change drops the old queue. Before that, lib/session sends it with
 *   /session/end (drainForEnd, in batches), and an end that could not be delivered keeps
 *   its session's queue until the sync loop delivers it (panel.pendingEnd.session_id).
 *   A new sign-in before that delivery abandons the old queue: that is the intended limit.
 * - When the server keeps answering without an ack (recording switched off), events are
 *   re-offered only every ACTIVITY_UNACKED_RETRY_MS instead of on every sync. Only an
 *   answer counts (noteActivityUnacked): a failed request never starts that backoff.
 * - Times are kept on the local clock and moved to the server's (getServerNow) when they
 *   are drained. The sync loop is reached through a dynamic import, started only once a
 *   session exists, so the screens that log stay free of it.
 *
 * Never throws: recording what was shown must never break what is being shown.
 */
import { useEffect } from 'react';
import type { PanelActivityEvent, PanelActivityKind } from '@/classroom-shared/apiTypes';
import { PANEL_STORAGE_KEYS } from '../config';
import { readJson, removeKey, writeJson } from '../lib/storage';
import { readSessionMeta } from './store';

export interface ActivityInput {
    kind: PanelActivityKind;
    ref_id?: string | null;
    parent_id?: string | null;
    title?: string | null;
}

/** Most events one /sync carries. */
export const ACTIVITY_PER_SYNC = 20;
/** Most events one session records; the server stores no more than this either. */
export const ACTIVITY_PER_SESSION = 100;
/** An unsent event replaced this soon after it was logged is overwritten, not kept. */
export const ACTIVITY_COALESCE_MS = 5000;
/** Sends without an ack after which the queue is offered only this often. */
export const ACTIVITY_UNACKED_SENDS = 3;
export const ACTIVITY_UNACKED_RETRY_MS = 5 * 60 * 1000;

const ID_MAX = 64;
const TITLE_MAX = 200;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

interface ActivityQueue {
    session_id: string;
    next_seq: number;
    items: PanelActivityEvent[];
    /** Events not kept because the session's budget was used up. */
    dropped: number;
    /** kind|ref_id|parent_id of the last event logged, sent or not. */
    last_key: string | null;
}

let cache: ActivityQueue | null | undefined;
/** Largest seq handed to a request; an event at or below it may already be stored. */
let offeredSeq = 0;
/** Answers without an ack in a row, and when the last of them came (monotonic). */
let unackedSends = 0;
let lastNoAckMono = -Infinity;

let serverNow: (() => number) | null = null;
let clockLoading = false;

function loadClock(): void {
    if (serverNow || clockLoading) return;
    clockLoading = true;
    import('./syncLoop')
        .then((module) => {
            serverNow = module.getServerNow;
        })
        .catch(() => {
            clockLoading = false;
        });
}

/** Server time minus local time, 0 until the sync loop is reachable. */
function clockOffset(): number {
    return serverNow ? serverNow() - Date.now() : 0;
}

function isQueue(value: unknown): value is ActivityQueue {
    const queue = value as ActivityQueue | null;
    return (
        !!queue &&
        typeof queue.session_id === 'string' &&
        typeof queue.next_seq === 'number' &&
        Array.isArray(queue.items)
    );
}

function load(): ActivityQueue | null {
    if (cache === undefined) {
        const stored = readJson<unknown>(PANEL_STORAGE_KEYS.activity);
        if (isQueue(stored)) {
            const items = stored.items.slice(-ACTIVITY_PER_SESSION);
            const largest = maxSeq(items);
            cache = {
                ...stored,
                items,
                next_seq: Math.max(stored.next_seq, largest + 1),
                dropped: stored.dropped || 0,
                last_key: stored.last_key ?? null,
            };
            // Whether these were sent before the restart is unknown: never coalesce over them.
            offeredSeq = Math.max(offeredSeq, largest);
        } else {
            cache = null;
        }
    }
    return cache;
}

function maxSeq(items: PanelActivityEvent[]): number {
    let largest = 0;
    for (const item of items) if (item.seq > largest) largest = item.seq;
    return largest;
}

function save(queue: ActivityQueue | null): void {
    cache = queue;
    if (!queue) {
        removeKey(PANEL_STORAGE_KEYS.activity);
        return;
    }
    if (writeJson(PANEL_STORAGE_KEYS.activity, queue)) return;
    // Storage is full. Keep at least the seq counter, so a restart never numbers a new
    // event with a seq the server may already hold: it would be taken as a repeat.
    console.warn('[panel/activity] queue not stored; keeping only its seq counter');
    writeJson(PANEL_STORAGE_KEYS.activity, { ...queue, items: [] });
}

function resetSendState(): void {
    offeredSeq = 0;
    unackedSends = 0;
    lastNoAckMono = -Infinity;
}

function shiftToServerClock(batch: PanelActivityEvent[]): PanelActivityEvent[] {
    const offset = Math.round(clockOffset());
    return batch.map((event) => ({ ...event, at_ms: event.at_ms + offset }));
}

function cleanId(value: string | null | undefined): string | null {
    if (!value) return null;
    const clean = value.replace(CONTROL_CHARS, '');
    // A cut id points at nothing; better none.
    return clean && clean.length <= ID_MAX ? clean : null;
}

function cleanTitle(value: string | null | undefined): string | null {
    if (!value) return null;
    const clean = value.replace(CONTROL_CHARS, ' ').trim();
    return clean ? clean.slice(0, TITLE_MAX) : null;
}

/** Records that something was shown. A no-op without a session. Never throws. */
export function logActivity(input: ActivityInput): void {
    try {
        const meta = readSessionMeta();
        if (!meta) return;
        loadClock();
        let queue = load();
        if (!queue || queue.session_id !== meta.session_id) {
            resetSendState();
            queue = {
                session_id: meta.session_id,
                next_seq: 1,
                items: [],
                dropped: 0,
                last_key: null,
            };
        }
        const refId = cleanId(input.ref_id);
        const parentId = cleanId(input.parent_id);
        const key = `${input.kind}|${refId ?? ''}|${parentId ?? ''}`;
        if (key === queue.last_key) return;
        // HOME only closes what was open before it.
        if (input.kind === 'HOME' && (!queue.last_key || queue.last_key.indexOf('HOME|') === 0)) {
            return;
        }
        const atMs = Date.now();
        const event: PanelActivityEvent = {
            seq: queue.next_seq,
            kind: input.kind,
            ref_id: refId,
            parent_id: parentId,
            title: cleanTitle(input.title),
            at_ms: atMs,
        };
        const last = queue.items.length > 0 ? queue.items[queue.items.length - 1] : undefined;
        let items = queue.items;
        let nextSeq = queue.next_seq;
        let dropped = queue.dropped;
        if (last && last.seq > offeredSeq && atMs - last.at_ms < ACTIVITY_COALESCE_MS) {
            // Never sent and barely seen: this one takes its place and its seq.
            items = items.slice(0, -1).concat({ ...event, seq: last.seq });
        } else if (nextSeq > ACTIVITY_PER_SESSION) {
            dropped += 1;
        } else {
            items = items.concat(event).slice(-ACTIVITY_PER_SESSION);
            nextSeq += 1;
        }
        save({ ...queue, items, next_seq: nextSeq, dropped, last_key: key });
    } catch (error) {
        console.warn('[panel/activity] not recorded', error);
    }
}

/**
 * Up to ACTIVITY_PER_SYNC queued events of this session, oldest first. Never removes them.
 * A queue that belongs to another session is dropped: it already had its try at session end.
 * Inside the no-ack backoff this returns nothing; noteActivityUnacked starts it.
 */
export function drainForSync(sessionId: string): PanelActivityEvent[] {
    try {
        loadClock();
        const queue = load();
        if (!queue) return [];
        if (queue.session_id !== sessionId) {
            resetSendState();
            save(null);
            return [];
        }
        if (queue.items.length === 0) return [];
        if (
            unackedSends >= ACTIVITY_UNACKED_SENDS &&
            performance.now() - lastNoAckMono < ACTIVITY_UNACKED_RETRY_MS
        ) {
            return [];
        }
        const batch = queue.items.slice(0, ACTIVITY_PER_SYNC);
        offeredSeq = Math.max(offeredSeq, maxSeq(batch));
        return shiftToServerClock(batch);
    } catch (error) {
        console.warn('[panel/activity] drain failed', error);
        return [];
    }
}

/**
 * For /session/end: up to ACTIVITY_PER_SYNC events of this session, oldest first, whatever
 * the no-ack backoff says, since this may be the last chance to send them. Never removes
 * them (ackActivity does, after a delivered end) and never drops another session's queue.
 */
export function drainForEnd(sessionId: string): PanelActivityEvent[] {
    try {
        loadClock();
        const queue = load();
        if (!queue || queue.session_id !== sessionId || queue.items.length === 0) return [];
        const batch = queue.items.slice(0, ACTIVITY_PER_SYNC);
        offeredSeq = Math.max(offeredSeq, maxSeq(batch));
        return shiftToServerClock(batch);
    } catch (error) {
        console.warn('[panel/activity] drain failed', error);
        return [];
    }
}

/**
 * The server answered a sync that carried this session's events without an ack, which is
 * what it does while recording is off. After ACTIVITY_UNACKED_SENDS of these in a row the
 * queue is offered only every ACTIVITY_UNACKED_RETRY_MS. A failed request is not an answer.
 */
export function noteActivityUnacked(sessionId: string): void {
    try {
        const queue = load();
        if (!queue || queue.session_id !== sessionId) return;
        unackedSends += 1;
        lastNoAckMono = performance.now();
    } catch (error) {
        console.warn('[panel/activity] note failed', error);
    }
}

/** Forgets this session's queue once nothing of it is left to send. Another session's stays. */
export function discardActivity(sessionId: string): void {
    try {
        const queue = load();
        if (!queue || queue.session_id !== sessionId) return;
        resetSendState();
        save(null);
    } catch (error) {
        console.warn('[panel/activity] discard failed', error);
    }
}

/**
 * The server stored everything of this session up to and including seq: drop those
 * events. An ack for another session than the queued one changes nothing.
 */
export function ackActivity(sessionId: string, seq: number): void {
    try {
        const queue = load();
        if (!queue || queue.session_id !== sessionId || typeof seq !== 'number') return;
        unackedSends = 0;
        save({ ...queue, items: queue.items.filter((item) => item.seq > seq) });
    } catch (error) {
        console.warn('[panel/activity] ack failed', error);
    }
}

/** For tests and Diagnostics: what is waiting and what the budget turned away. */
export function getActivityStats(): { sessionId: string | null; queued: number; dropped: number } {
    const queue = load();
    return {
        sessionId: queue ? queue.session_id : null,
        queued: queue ? queue.items.length : 0,
        dropped: queue ? queue.dropped : 0,
    };
}

/**
 * Logs `input` when the screen shows it, and again whenever kind, ref_id or parent_id
 * change. Pass null while there is nothing to report yet (still loading).
 */
export function useActivityLog(input: ActivityInput | null): void {
    const kind = input ? input.kind : null;
    const refId = input ? input.ref_id ?? null : null;
    const parentId = input ? input.parent_id ?? null : null;
    const title = input ? input.title ?? null : null;
    useEffect(() => {
        if (kind) logActivity({ kind, ref_id: refId, parent_id: parentId, title });
        // The title is what was on screen when it opened; a later rename is not a new event.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, refId, parentId]);
}
