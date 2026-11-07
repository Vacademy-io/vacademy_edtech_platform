import { describe, expect, it } from 'vitest';
import { looksExpired } from './auth';
import { isSignInFailure } from './http';

const NOW = 1_800_000_000_000;
const jwt = (claims: Record<string, number>) =>
    `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`;
const live = jwt({ exp: NOW / 1000 + 600, iat: NOW / 1000 - 3600 });
const justIssued = jwt({ exp: NOW / 1000 + 600, iat: NOW / 1000 - 5 });
const expired = jwt({ exp: NOW / 1000 - 1, iat: NOW / 1000 - 3600 });

describe('looksExpired', () => {
    it('reads exp, and treats anything unreadable as expired', () => {
        expect(looksExpired(live, NOW)).toBe(false);
        expect(looksExpired(expired, NOW)).toBe(true);
        expect(looksExpired('junk', NOW)).toBe(true);
        expect(looksExpired(null, NOW)).toBe(true);
    });
});

describe('isSignInFailure', () => {
    it('a refusal from the error dispatch is not expiry for a token just issued', () => {
        const refusal = { error: 'ACCESS_DENIED', path: '/error' };
        expect(isSignInFailure(403, refusal, justIssued, false, NOW)).toBe(false);
        expect(isSignInFailure(403, refusal, justIssued, true, NOW)).toBe(false);
    });

    it('the same refusal is expiry for an older token, whatever the phone clock says', () => {
        const refusal = { error: 'ACCESS_DENIED', path: '/error' };
        expect(isSignInFailure(403, refusal, live, false, NOW)).toBe(true);
        expect(isSignInFailure(403, refusal, expired, false, NOW)).toBe(true);
    });

    it.each([401, 403, 510, 511])('%i with a JWT that looks expired', (status) => {
        expect(isSignInFailure(status, null, expired, false, NOW)).toBe(true);
    });

    it('accepts the server saying so, even when the phone clock disagrees', () => {
        expect(isSignInFailure(510, { ex: 'Expired Token' }, live, false, NOW)).toBe(true);
        expect(isSignInFailure(500, { ex: 'Expired Token' }, live, false, NOW)).toBe(true);
        expect(isSignInFailure(403, { code: 'UNAUTHORIZED' }, live, true, NOW)).toBe(true);
    });

    it('leaves a plain refusal naming its own path to the other rules', () => {
        const body = { error: 'ACCESS_DENIED', path: '/admin-core-service/classroom/v1/today' };
        expect(isSignInFailure(403, body, live, false, NOW)).toBe(false);
    });

    it('accepts a plain 500 only when the JWT looks expired', () => {
        expect(isSignInFailure(500, null, expired, true, NOW)).toBe(true);
    });

    it('never treats a panel answer as a bad JWT', () => {
        for (const code of ['NOT_STAFF', 'OTHER_USER', 'FORBIDDEN', 'ROOM_OTHER_INSTITUTE']) {
            expect(isSignInFailure(403, { code }, expired, true, NOW)).toBe(false);
        }
        expect(isSignInFailure(409, { code: 'EXPIRED' }, expired, true, NOW)).toBe(false);
    });

    it('sends a bare refusal on a panel path to sign-in, unless the token is brand new', () => {
        expect(isSignInFailure(403, null, live, true, NOW)).toBe(true);
        expect(isSignInFailure(403, null, justIssued, true, NOW)).toBe(false);
    });

    it('leaves a bare refusal from admin_core alone while the JWT looks valid', () => {
        expect(isSignInFailure(403, null, live, false, NOW)).toBe(false);
    });

    it('ignores other statuses', () => {
        expect(isSignInFailure(502, null, expired, true, NOW)).toBe(false);
        expect(isSignInFailure(500, null, live, true, NOW)).toBe(false);
        expect(isSignInFailure(429, { code: 'BUSY' }, expired, true, NOW)).toBe(false);
    });
});
