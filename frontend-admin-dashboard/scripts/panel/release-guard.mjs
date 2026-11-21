/**
 * What a release panel bundle must not contain: the Phase 0 password login, or a backend
 * URL on this machine or a private network (a VITE_BACKEND_URL left over from lab work,
 * in the shell or in a .env file). verify-panel-dist.mjs runs this over every chunk.
 */

/** Phase 0 posts to login-root; a release build drops that whole path. */
const LEGACY_LOGIN = /login-root/g;

/**
 * An http(s) URL on a loopback or private address. A bare "http://localhost" with no port
 * or path is left alone: axios ships one as a fallback origin.
 */
const PRIVATE_URL =
    /https?:\/\/(?:(?:localhost|0\.0\.0\.0|\[::1\])(?=[:/])|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})[^\s"'`]*/g;

/**
 * @param {string} source one chunk's text
 * @returns {{ kind: 'legacy-login' | 'private-backend', detail: string }[]}
 */
export function findReleaseProblems(source) {
    const problems = [];
    const logins = source.match(LEGACY_LOGIN);
    if (logins) {
        problems.push({ kind: 'legacy-login', detail: `login-root ×${logins.length}` });
    }
    const urls = source.match(PRIVATE_URL);
    if (urls) {
        const unique = Array.from(new Set(urls)).slice(0, 3);
        problems.push({ kind: 'private-backend', detail: unique.join(' ') });
    }
    return problems;
}
