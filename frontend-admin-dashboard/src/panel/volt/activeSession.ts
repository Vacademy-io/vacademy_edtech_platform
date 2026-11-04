/**
 * The panel's open live session, persisted in localStorage
 * (PANEL_STORAGE_KEYS.voltActiveSession) so a crashed, slept or restarted panel
 * can Resume or End it. While the key exists the shell suspends the 3 h idle
 * sign-out and asks "End the live session and sign out?".
 *
 * Kept free of React and of the Excalidraw graph so the shell can import it
 * lazily from a sign-out handler (see endActiveVoltSession).
 */
import { PANEL_STORAGE_KEYS } from '../config';
import { getCurrentUser } from '../lib/session';
import { readJson, removeKey, writeJson } from '../lib/storage';
import { createSession, finishSession, isServerRejection } from './voltApi';
import type { VoltLiveSession, VoltSessionOptions } from './types';

export interface ActiveVoltSession {
    sessionId: string;
    inviteCode: string;
    presentationId: string;
    title: string;
    status: 'waiting' | 'live';
    /** Position in the panel's slide list (also the server's slide index). */
    slideIndex: number;
    showLeaderboard: boolean;
    defaultSecondsForQuestion: number;
    createdAt: number;
    /** Teacher who started it; idle sign-out ignores records of another user (SEC-2). */
    userId?: string;
}

const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((listener) => listener());
}

export function subscribeActiveSession(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function isRecord(value: unknown): value is ActiveVoltSession {
    const record = value as ActiveVoltSession | null;
    return (
        !!record &&
        typeof record.sessionId === 'string' &&
        typeof record.inviteCode === 'string' &&
        typeof record.presentationId === 'string'
    );
}

export function readActiveSession(): ActiveVoltSession | null {
    const value = readJson<unknown>(PANEL_STORAGE_KEYS.voltActiveSession);
    if (!isRecord(value)) return null;
    return {
        ...value,
        title: value.title || '',
        status: value.status === 'live' ? 'live' : 'waiting',
        slideIndex: typeof value.slideIndex === 'number' ? value.slideIndex : 0,
        showLeaderboard: value.showLeaderboard !== false,
        defaultSecondsForQuestion:
            typeof value.defaultSecondsForQuestion === 'number'
                ? value.defaultSecondsForQuestion
                : 0,
    };
}

export function writeActiveSession(record: ActiveVoltSession): void {
    writeJson(PANEL_STORAGE_KEYS.voltActiveSession, record);
    notify();
}

export function updateActiveSession(
    sessionId: string,
    patch: Partial<Omit<ActiveVoltSession, 'sessionId'>>
): void {
    const current = readActiveSession();
    if (!current || current.sessionId !== sessionId) return;
    writeActiveSession({ ...current, ...patch });
}

export function clearActiveSession(sessionId?: string): void {
    const current = readActiveSession();
    if (sessionId && current && current.sessionId !== sessionId) return;
    removeKey(PANEL_STORAGE_KEYS.voltActiveSession);
    notify();
}

/**
 * Session DTOs returned by create, kept in memory so the live view does not
 * have to re-read them right after creating (they carry the session's slide
 * list with real option ids for the response overlay).
 */
const sessionCache = new Map<string, VoltLiveSession>();

export function cacheSession(session: VoltLiveSession): void {
    sessionCache.set(session.session_id, session);
}

export function getCachedSession(sessionId: string): VoltLiveSession | undefined {
    return sessionCache.get(sessionId);
}

/** Create a live session and remember it as the panel's active session. */
export async function createLiveSession(
    presentationId: string,
    title: string,
    options: Partial<VoltSessionOptions>
): Promise<ActiveVoltSession> {
    const session = await createSession(presentationId, options);
    cacheSession(session);
    const record: ActiveVoltSession = {
        sessionId: session.session_id,
        inviteCode: session.invite_code,
        presentationId,
        title,
        status: 'waiting',
        slideIndex: 0,
        showLeaderboard:
            session.show_results_at_last_slide ?? options.show_results_at_last_slide ?? true,
        defaultSecondsForQuestion:
            session.default_seconds_for_question ?? options.default_seconds_for_question ?? 0,
        createdAt: Date.now(),
        userId: getCurrentUser()?.id || undefined,
    };
    writeActiveSession(record);
    return record;
}

/**
 * Finish the session on the server and forget it. A server-side rejection
 * (unknown or already finished session) counts as ended; a network failure
 * rethrows and keeps the record so the teacher can try again.
 */
export async function endSession(sessionId: string): Promise<void> {
    try {
        await finishSession(sessionId);
    } catch (error) {
        if (!isServerRejection(error)) throw error;
        console.warn('[panel/volt] finish rejected; treating the session as ended', error);
    }
    sessionCache.delete(sessionId);
    clearActiveSession(sessionId);
}

/**
 * Sign-out hook: end whatever live session the panel has open (call while the
 * token is still valid). Never throws; on failure the record is dropped anyway
 * because nobody will be signed in to resume it.
 */
export async function endActiveVoltSession(): Promise<void> {
    const record = readActiveSession();
    if (!record) return;
    try {
        await endSession(record.sessionId);
    } catch (error) {
        console.error('[panel/volt] could not end the live session at sign-out', error);
        clearActiveSession(record.sessionId);
    }
}
