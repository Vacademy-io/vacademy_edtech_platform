/**
 * The same token cookies as the admin app on this host, with the same options as
 * lib/auth/sessionUtility.ts (exact host, 7 days). sessionUtility itself is not
 * imported: it brings axios and analytics. There is no refresh logic on this page.
 */
import { useSyncExternalStore } from 'react';
import Cookies from 'js-cookie';
import { jwtDecode } from 'jwt-decode';
import { TokenKey } from '@/constants/auth/tokens';

const COOKIE_DAYS = 7;

export interface PhoneTokenClaims {
    exp?: number;
    iat?: number;
    fullname?: string;
    username?: string;
    email?: string;
    user?: string;
}

export function getAccessToken(): string | null {
    return Cookies.get(TokenKey.accessToken) ?? null;
}

export function decodeClaims(token: string | null): PhoneTokenClaims | null {
    if (!token) return null;
    try {
        return jwtDecode<PhoneTokenClaims>(token);
    } catch {
        return null;
    }
}

/** The signed-in user's id from the JWT, or null. */
export function currentUserId(): string | null {
    return decodeClaims(getAccessToken())?.user ?? null;
}

/** A first guess only: it reads the phone's clock. The server has the final word. */
export function looksExpired(token: string | null, nowMs = Date.now()): boolean {
    const exp = decodeClaims(token)?.exp;
    if (typeof exp !== 'number') return true;
    return exp * 1000 <= nowMs;
}

function cookieOptions(): Cookies.CookieAttributes {
    return {
        secure: window.location.hostname.includes(
            import.meta.env.VITE_SHARED_DOMAIN?.replace('.', '') || 'vacademy.io'
        ),
        sameSite: 'lax',
        expires: COOKIE_DAYS,
    };
}

function writeTokens(accessToken: string, refreshToken: string | null | undefined): void {
    Cookies.set(TokenKey.accessToken, accessToken, cookieOptions());
    if (refreshToken) Cookies.set(TokenKey.refreshToken, refreshToken, cookieOptions());
}

function removeTokens(): void {
    Cookies.remove(TokenKey.accessToken);
    Cookies.remove(TokenKey.refreshToken);
}

// ---------------------------------------------------------------- store ---

export interface PhoneAuthState {
    signedIn: boolean;
    name: string | null;
}

function readState(): PhoneAuthState {
    const token = getAccessToken();
    if (!token || looksExpired(token)) return { signedIn: false, name: null };
    return { signedIn: true, name: displayName(token) };
}

function displayName(token: string): string | null {
    const claims = decodeClaims(token);
    return claims?.fullname || claims?.username || claims?.email || null;
}

let state = readState();
const listeners = new Set<() => void>();

function publish(next: PhoneAuthState): void {
    state = next;
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useAuth(): PhoneAuthState {
    return useSyncExternalStore(subscribe, () => state);
}

/**
 * Trusts a token the server just issued even if the phone's clock calls it expired,
 * so a wrong clock cannot trap a teacher on the sign-in form.
 */
export function completeSignIn(accessToken: string, refreshToken?: string | null): void {
    writeTokens(accessToken, refreshToken);
    publish({ signedIn: true, name: displayName(accessToken) });
}

/** The server refused the JWT. Sends the teacher back to the sign-in form. */
export function expireSignIn(): void {
    removeTokens();
    publish({ signedIn: false, name: null });
}
