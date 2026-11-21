import { nanoid } from 'nanoid';
import { PANEL_STORAGE_KEYS } from '../config';

/** Writes larger than this are skipped (a full localStorage throws on old WebViews). */
const MAX_WRITE_CHARS = 2 * 1024 * 1024;

export function readString(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function writeString(key: string, value: string): boolean {
    if (value.length > MAX_WRITE_CHARS) {
        console.warn(`[panel/storage] skipped write of ${key}: ${value.length} chars`);
        return false;
    }
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn(`[panel/storage] write of ${key} failed`, error);
        return false;
    }
}

export function removeKey(key: string): void {
    try {
        window.localStorage.removeItem(key);
    } catch {
        /* ignore */
    }
}

export function readJson<T>(key: string): T | null {
    const raw = readString(key);
    if (raw === null) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export function writeJson(key: string, value: unknown): boolean {
    let raw: string;
    try {
        raw = JSON.stringify(value);
    } catch {
        return false;
    }
    return writeString(key, raw);
}

/** A stable per-install id (generated on first run). */
export function getDeviceId(): string {
    const existing = readString(PANEL_STORAGE_KEYS.deviceId);
    if (existing) return existing;
    const id = `panel-${nanoid(16)}`;
    writeString(PANEL_STORAGE_KEYS.deviceId, id);
    return id;
}
