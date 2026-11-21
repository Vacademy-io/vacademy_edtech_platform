/**
 * PDFs and scene JSON: the saved copy first. On a miss the player opens the signed URL as
 * it always has, and a copy is saved behind it, so a first open is exactly as fast and can
 * fail in exactly the same ways as before. Keyed by file id; a signed URL expires.
 */
import {
    filesCacheName,
    MAX_FILE_BYTES,
    readEntry,
    removeEntry,
    writeEntry,
    type WriteResult,
} from './cacheStore';
import { offlineUseExpired } from './lock';
import { getWipeGeneration } from './wipe';

/** The viewer gets a head start on a shared connection. */
const COPY_DELAY_MS = 3000;
const COPY_RETRY_DELAYS_MS = [5000, 15000];
const MAX_WAITING_COPIES = 4;

/** An object URL for the saved copy, or null. The caller revokes it. */
export async function openSavedFile(fileId: string): Promise<string | null> {
    const cacheName = filesCacheName();
    if (!cacheName || offlineUseExpired()) return null;
    const found = await readEntry(cacheName, fileId);
    if (!found) return null;
    try {
        return URL.createObjectURL(await found.blob());
    } catch (error) {
        console.warn('[panel/offline] could not open saved file', error);
        return null;
    }
}

/** The copy turned out to be unreadable: the next open goes to the network. */
export function dropSavedFile(fileId: string): Promise<void> {
    const cacheName = filesCacheName();
    return cacheName ? removeEntry(cacheName, fileId) : Promise.resolve();
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchForCopy(url: string): Promise<Response> {
    const response = await fetch(url, { cache: 'force-cache' });
    if (response.status !== 200) throw new Error(`File HTTP ${response.status}`);
    const headers = new Headers();
    const type = response.headers.get('Content-Type');
    const length = response.headers.get('Content-Length');
    if (type) headers.set('Content-Type', type);
    if (length) headers.set('Content-Length', length);
    // A plain same-origin response: a stored Vary or CORS type cannot get in the way of a match.
    return new Response(response.body, { status: 200, headers });
}

interface WaitingCopy {
    cacheName: string;
    fileId: string;
    url: string;
    /** A wipe since this copy was asked for cancels it. */
    generation: number;
}

async function copyOne({ cacheName, fileId, url, generation }: WaitingCopy): Promise<WriteResult> {
    let result: WriteResult = 'failed';
    for (let attempt = 0; attempt <= COPY_RETRY_DELAYS_MS.length; attempt += 1) {
        result = await writeEntry(cacheName, fileId, {
            produce: () => fetchForCopy(url),
            maxBytes: MAX_FILE_BYTES,
            generation,
        });
        if (result !== 'failed') return result;
        const delay = COPY_RETRY_DELAYS_MS[attempt];
        if (delay === undefined || navigator.onLine === false) return result;
        await wait(delay);
    }
    return result;
}

const waiting: WaitingCopy[] = [];
/** Files not worth trying again in this run of the app: too big, no room, or no network. */
const attempted = new Set<string>();
let copying = false;

function attemptId(cacheName: string, fileId: string): string {
    return `${cacheName}/${fileId}`;
}

async function drain(): Promise<void> {
    if (copying) return;
    copying = true;
    await wait(COPY_DELAY_MS);
    let next = waiting.shift();
    while (next) {
        try {
            const result = await copyOne(next);
            // A saved file can be evicted or wiped later, and must then be saved again, as
            // can one a wipe cancelled.
            if (result === 'saved' || next.generation !== getWipeGeneration()) {
                attempted.delete(attemptId(next.cacheName, next.fileId));
            }
        } catch (error) {
            console.warn('[panel/offline] copy skipped', next.fileId, error);
        }
        next = waiting.shift();
    }
    copying = false;
}

/** One copy at a time. */
export function saveFileCopy(fileId: string, url: string): void {
    const cacheName = filesCacheName();
    if (!cacheName) return;
    const id = attemptId(cacheName, fileId);
    if (attempted.has(id)) return;
    attempted.add(id);
    waiting.push({ cacheName, fileId, url, generation: getWipeGeneration() });
    if (waiting.length > MAX_WAITING_COPIES) {
        const dropped = waiting.shift();
        if (dropped) attempted.delete(attemptId(dropped.cacheName, dropped.fileId));
    }
    void drain();
}

/** A dropped copy may be saved again. */
export function forgetCopyAttempt(fileId: string): void {
    const cacheName = filesCacheName();
    if (cacheName) attempted.delete(attemptId(cacheName, fileId));
}
