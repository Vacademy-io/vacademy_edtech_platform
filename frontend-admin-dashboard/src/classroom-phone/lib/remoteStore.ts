/**
 * The remote token on the teacher's own phone, with the client_seq it has reached.
 * The two live in one record so a new token always starts from a fresh sequence.
 */
import { useSyncExternalStore } from 'react';
import { readLocalJson, removeLocal, writeLocalJson } from './storage';

const KEY = 'classroom.remote';

export interface StoredRemote {
    token: string;
    seq: number;
    roomName: string | null;
    instituteId: string | null;
    instituteName: string | null;
    themeCode: string | null;
}

let current: StoredRemote | null = readValid();
const listeners = new Set<() => void>();

function readValid(): StoredRemote | null {
    const stored = readLocalJson<StoredRemote>(KEY);
    return stored && typeof stored.token === 'string' && stored.token ? stored : null;
}

function publish(next: StoredRemote | null): void {
    current = next;
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useRemote(): StoredRemote | null {
    return useSyncExternalStore(subscribe, () => current);
}

export function setRemote(next: Omit<StoredRemote, 'seq'>): void {
    const record: StoredRemote = { ...next, seq: 0 };
    writeLocalJson(KEY, record);
    publish(record);
}

export function clearRemote(): void {
    removeLocal(KEY);
    publish(null);
}

/** Written before the request goes out, so a reload cannot reuse a sequence number. */
export function saveSeq(token: string, seq: number): void {
    if (current?.token !== token) return;
    current = { ...current, seq };
    writeLocalJson(KEY, current);
}

export function getSeq(token: string): number {
    return current?.token === token ? current.seq : 0;
}
