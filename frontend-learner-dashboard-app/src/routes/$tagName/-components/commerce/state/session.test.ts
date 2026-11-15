import { describe, expect, it, vi } from 'vitest';
import { SESSION_KEY_PREFIX, clearSession, onSessionChange, readSession, saveSession, sessionKey, sessionMatchesPhone, type KeyValueStorage } from './session';

const TOKEN = 's1.eyJpIjoiaW5zdC0xIn0.c2lnbmF0dXJl';
const NOW = Date.UTC(2026, 10, 15, 10, 0, 0);

const memory = (): KeyValueStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (k) => data.get(k) ?? null,
        setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
        removeItem: (k) => void data.delete(k),
    };
};

const throwing: KeyValueStorage = {
    getItem: () => {
        throw new Error('SecurityError');
    },
    setItem: () => {
        throw new Error('QuotaExceededError');
    },
    removeItem: () => {
        throw new Error('SecurityError');
    },
};

const verified = { shopper_session_token: TOKEN, shopper_session_expires_in: 604800, shopper_session_expires_at: null, phone_masked: '••••••3210' };

describe('shopper session storage', () => {
    it('keeps the session per institute under its own key', () => {
        const storage = memory();
        const saved = saveSession('inst-1', verified, storage, NOW);
        expect(saved).toEqual({ token: TOKEN, expiresAt: NOW + 604800 * 1000, phoneMasked: '••••••3210' });
        // Only the token, its end and the masked phone are stored: never the full number.
        expect(JSON.parse(storage.data.get(`${SESSION_KEY_PREFIX}inst-1`)!)).toEqual({ token: TOKEN, expiresAt: NOW + 604800 * 1000, phoneMasked: '••••••3210' });
        expect(Array.from(storage.data.keys())).toEqual([`${SESSION_KEY_PREFIX}inst-1`]);
        expect(sessionKey('inst-2')).toBe('cmx.session.v1.inst-2');
        expect(readSession('inst-1', storage, NOW + 1000)?.token).toBe(TOKEN);
        expect(readSession('inst-2', storage, NOW + 1000)).toBeNull();
    });

    it('never writes the learner app token keys', () => {
        const storage = memory();
        saveSession('inst-1', verified, storage, NOW);
        const keys = (storage.setItem as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
        expect(keys).toEqual(['cmx.session.v1.inst-1']);
        for (const key of keys) expect(key).not.toMatch(/accessToken|refreshToken/i);
    });

    it('drops an expired session, and removes it from storage', () => {
        const storage = memory();
        saveSession('inst-1', verified, storage, NOW);
        expect(readSession('inst-1', storage, NOW + 604800 * 1000 + 1)).toBeNull();
        expect(storage.data.size).toBe(0);
    });

    it('takes the expiry from the date when no seconds are sent', () => {
        const storage = memory();
        const at = '2026-11-22T10:00:00Z';
        const saved = saveSession('inst-1', { ...verified, shopper_session_expires_in: null, shopper_session_expires_at: at }, storage, NOW);
        expect(saved?.expiresAt).toBe(Date.parse(at));
    });

    it('stores nothing when the answer has no session (TRACK_ORDER, or no secret on the server)', () => {
        const storage = memory();
        expect(saveSession('inst-1', { shopper_session_token: null, phone_masked: null }, storage, NOW)).toBeNull();
        expect(saveSession('inst-1', { ...verified, shopper_session_token: 'eyJhbGciOiJIUzI1NiJ9.x.y' }, storage, NOW)).toBeNull();
        expect(storage.data.size).toBe(0);
    });

    it('treats a malformed record as no session and removes it', () => {
        const storage = memory();
        storage.data.set(sessionKey('inst-1'), '{not json');
        expect(readSession('inst-1', storage, NOW)).toBeNull();
        storage.data.set(sessionKey('inst-1'), JSON.stringify({ token: 'Bearer abc', expiresAt: NOW + 10_000 }));
        expect(readSession('inst-1', storage, NOW)).toBeNull();
        expect(storage.data.size).toBe(0);
    });

    it('survives a storage that throws on every call', () => {
        expect(readSession('inst-1', throwing, NOW)).toBeNull();
        expect(saveSession('inst-1', verified, throwing, NOW)).toBeNull();
        expect(() => clearSession('inst-1', throwing)).not.toThrow();
        expect(readSession('inst-1', null, NOW)).toBeNull();
    });

    it('clears on sign-out and tells the page', () => {
        const storage = memory();
        const heard = vi.fn();
        const off = onSessionChange(heard);
        saveSession('inst-1', verified, storage, NOW);
        clearSession('inst-1', storage);
        off();
        expect(storage.data.size).toBe(0);
        expect(heard).toHaveBeenCalledTimes(2);
    });

    it('counts as proof only for the number /me answered for the session', () => {
        const session = { token: TOKEN, expiresAt: NOW + 1000, phoneMasked: '••••••3210' };
        expect(sessionMatchesPhone(session, '9876543210', '9876543210')).toBe(true);
        expect(sessionMatchesPhone(session, '9876543210', '9876543211')).toBe(false);
        // Only the masked digits known (no /me answer yet): never enough.
        expect(sessionMatchesPhone(session, null, '9876543210')).toBe(false);
        expect(sessionMatchesPhone(null, '9876543210', '9876543210')).toBe(false);
    });

    it('writes an older record back without the full number', () => {
        const storage = memory();
        storage.data.set(sessionKey('inst-1'), JSON.stringify({ token: TOKEN, expiresAt: NOW + 10_000, phoneMasked: '••••••3210', phone: '9876543210' }));
        expect(readSession('inst-1', storage, NOW)).toEqual({ token: TOKEN, expiresAt: NOW + 10_000, phoneMasked: '••••••3210' });
        expect(storage.data.get(sessionKey('inst-1'))).not.toContain('9876543210');
    });
});
