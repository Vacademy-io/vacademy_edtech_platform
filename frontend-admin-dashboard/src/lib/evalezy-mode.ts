import { shouldForceEvalezyShell } from '@/native/flavor';

/**
 * Evalezy = the AI copy-check app: pick an assessment, scan or upload the answer
 * copies, the AI checks them, download the checked copies as a zip. It is the
 * SAME admin portal (same bundle, login and APIs) held inside the `/evalezy`
 * shell, so nothing else of the portal shows. It is on when:
 *   - the bundle is the Evalezy app (flavor `evalezy`, see flavor.config.ts), or
 *   - the site is opened on an `evalezy.` host (evalezy.vacademy.io).
 * Whether an institute's admins may use it is the institute's setting
 * (Settings → Assessment → Evalezy app), checked inside the shell.
 */
export const EVALEZY_HOME = '/evalezy';

/** First host label is `evalezy` (evalezy.vacademy.io, or a stage copy of it). */
export const isEvalezyHost = (hostname?: string): boolean => {
    const host = hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '');
    return host.toLowerCase().split('.')[0] === 'evalezy';
};

export const isEvalezyMode = (): boolean => shouldForceEvalezyShell() || isEvalezyHost();

/** Portal pages an Evalezy user may still open (the shell links to them). */
const ALLOWED_PREFIXES = [
    EVALEZY_HOME,
    '/login',
    // One checked copy, opened from the batch list.
    '/assessment/evaluation-ai/',
];

const isUnder = (pathname: string, prefix: string) =>
    pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

/**
 * Where a portal URL goes inside Evalezy, or null when it may open as is.
 * The "copies checked" email links to the assessment's submissions tab with
 * `?intake=<batchId>`; that becomes the same assessment in the shell.
 */
export const evalezyPathFor = (pathname: string, search = ''): string | null => {
    if (ALLOWED_PREFIXES.some((prefix) => isUnder(pathname, prefix))) return null;
    const assessment = pathname.match(
        /^\/assessment\/assessment-list\/assessment-details\/([^/]+)(?:\/|$)/
    );
    if (assessment?.[1]) {
        const intake = new URLSearchParams(search).get('intake');
        const query = intake ? `?intake=${encodeURIComponent(intake)}` : '';
        return `${EVALEZY_HOME}/${encodeURIComponent(assessment[1])}${query}`;
    }
    return EVALEZY_HOME;
};
