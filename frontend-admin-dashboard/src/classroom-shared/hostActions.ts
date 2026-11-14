/**
 * "Start as host" logic shared by the panel and the phone page.
 *
 * Follows routes/study-library/live-session/-hooks/useHostJoin.ts, which cannot
 * be imported here: it pulls the router and the admin axios instance. This copy
 * takes an HTTP function and RETURNS what should happen, so the caller decides
 * how to open a URL and how to ask the teacher. Nothing here touches window,
 * the router, a toast or any browser API a Chrome 66 WebView lacks.
 *
 * Provider resolution per session:
 *   BBB / Zoom / Google Meet / Zoho  a real host action
 *   anything else with a meeting URL open that external link
 *   nothing                          null, the caller decides the fallback
 */
import { PROVIDER_MEETING_BASE } from './apiTypes';
import type { BbbJoinResponse, GoogleMeetJoinResponse, SessionLinksResponse } from './apiTypes';

/**
 * GET against the backend. `path` starts with /admin-core-service/...; the
 * function adds the base URL, Bearer and clientId. It may reject on a non-2xx
 * status, as axios does, or resolve with `status` set, as a fetch wrapper would.
 */
export type HostHttpGet = (
    path: string,
    params: Record<string, string | boolean>
) => Promise<{ status?: number; data: unknown }>;

export type HostProvider = 'bbb' | 'zoom' | 'meet' | 'zoho';

export type HostActionResult =
    /** Open this URL at top level (or PanelDevice.openMeeting). Never put it in a QR. */
    | {
          kind: 'open-url';
          provider: HostProvider | 'external';
          url: string;
          /** Zoho: no host link exists, this is the class link. */
          noHostLink?: boolean;
          /** Meet: the account the teacher should be signed in to for host controls. */
          cohostEmail?: string | null;
          /** Meet: the account the teacher should be signed in to for recording. */
          organizerEmail?: string | null;
      }
    /** Zoom: go to the in-app host route on this host, which fetches its own signature once. */
    | { kind: 'open-route'; provider: 'zoom'; path: string }
    /** BBB room is over. Ask, then call startBbb(scheduleId, true). */
    | { kind: 'meeting-ended'; provider: 'bbb'; scheduleId: string }
    /** BBB refused to recreate because the current room is still in use. */
    | { kind: 'recreate-blocked'; provider: 'bbb'; message: string | null }
    /** Meet space still provisioning after every retry. */
    | { kind: 'provisioning'; provider: 'meet' }
    /** The server answered but gave no usable URL. */
    | { kind: 'no-url'; provider: HostProvider }
    /** Request failed. `status` is null for a network failure. */
    | { kind: 'failed'; provider: HostProvider; status: number | null };

export interface HostTarget {
    sessionId: string;
    scheduleId: string;
    /** `link_type`: 'bbb' | 'zoom' | 'google meet' | 'zoho' | 'youtube' | ... */
    linkType?: string | null;
    /** `streaming_type`. Checked as well: these two columns were historically swapped. */
    streamingType?: string | null;
    /** A class URL for providers we cannot host, also the Zoho fallback. */
    externalLink?: string | null;
}

export interface HostAction {
    /** 'host' starts the meeting as moderator. 'external' only opens a URL. */
    kind: 'host' | 'external';
    provider: HostProvider | 'external';
    run: () => Promise<HostActionResult>;
}

export type HostProgress =
    /** Meet told us a co-host was just added; waiting for Google to apply it. */
    | 'COHOST_SETTLING'
    /** Meet answered 409; waiting before asking again. */
    | 'PROVISIONING';

export interface HostActionsOptions {
    onProgress?: (progress: HostProgress) => void;
    /** Test seam. Defaults to setTimeout. */
    wait?: (ms: number) => Promise<void>;
}

/**
 * Google needs a few seconds to apply a co-host it was just told about; a Meet
 * tab opened sooner treats the teacher as a participant and parks them in the lobby.
 */
export const COHOST_SETTLE_MS = 5000;
export const MEET_PROVISIONING_RETRY_MS = 5000;
/** Attempts after the first 409, so a teacher waits at most 15 s before seeing a message. */
export const MEET_PROVISIONING_RETRIES = 3;

const norm = (value?: string | null) => (value ?? '').trim().toLowerCase();

const isBbb = (value?: string | null) => {
    const v = norm(value);
    return v === 'bbb' || v === 'bbb_meeting';
};
const isZoom = (value?: string | null) => {
    const v = norm(value);
    return v === 'zoom' || v === 'zoom_meeting';
};
const isMeet = (value?: string | null) => {
    const v = norm(value);
    // gmeet is LinkType.GMEET, stored as is.
    return v === 'google meet' || v === 'google_meet' || v === 'googlemeet' || v === 'gmeet';
};
const isZoho = (value?: string | null) => {
    const v = norm(value);
    return v === 'zoho' || v === 'zoho_meeting';
};

function providerOf(value?: string | null): HostProvider | null {
    if (isBbb(value)) return 'bbb';
    if (isZoom(value)) return 'zoom';
    if (isMeet(value)) return 'meet';
    if (isZoho(value)) return 'zoho';
    return null;
}

/** Checks `link_type` first, then `streaming_type`. */
export function detectHostProvider(
    linkType?: string | null,
    streamingType?: string | null
): HostProvider | null {
    return providerOf(linkType) ?? providerOf(streamingType);
}

/** Only ever hand back an http(s) URL: stored data must not become javascript: or about:blank. */
export function isHttpUrl(url?: string | null): url is string {
    return /^https?:\/\//i.test((url ?? '').trim());
}

function statusOfError(error: unknown): number | null {
    const err = error as { response?: { status?: unknown }; status?: unknown } | null | undefined;
    const status = err?.response?.status ?? err?.status;
    return typeof status === 'number' ? status : null;
}

function defaultWait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export interface HostActions {
    resolveHostAction: (target: HostTarget) => HostAction | null;
    startBbb: (scheduleId: string, recreate?: boolean) => Promise<HostActionResult>;
    startZoom: (sessionId: string, scheduleId: string) => HostActionResult;
    startMeet: (scheduleId: string) => Promise<HostActionResult>;
    startZoho: (scheduleId: string, fallbackLink?: string | null) => Promise<HostActionResult>;
}

export function createHostActions(
    http: HostHttpGet,
    options: HostActionsOptions = {}
): HostActions {
    const wait = options.wait ?? defaultWait;
    const progress = options.onProgress ?? (() => undefined);

    /**
     * BBB: the backend auto-creates the room if it does not exist yet, so this
     * genuinely starts the class. MEETING_ENDED offers a fresh room,
     * RECREATE_BLOCKED refuses to strand learners already in the old one. Neither
     * is an error.
     */
    const startBbb = async (scheduleId: string, recreate = false): Promise<HostActionResult> => {
        try {
            const { data } = await http(`${PROVIDER_MEETING_BASE}/join`, {
                scheduleId,
                role: 'MODERATOR',
                recreate,
            });
            const body = (data ?? {}) as BbbJoinResponse;
            if (body.status === 'MEETING_ENDED') {
                return { kind: 'meeting-ended', provider: 'bbb', scheduleId };
            }
            if (body.status === 'RECREATE_BLOCKED') {
                return {
                    kind: 'recreate-blocked',
                    provider: 'bbb',
                    message: body.message ?? null,
                };
            }
            if (!isHttpUrl(body.joinUrl)) return { kind: 'no-url', provider: 'bbb' };
            return { kind: 'open-url', provider: 'bbb', url: body.joinUrl.trim() };
        } catch (error) {
            return { kind: 'failed', provider: 'bbb', status: statusOfError(error) };
        }
    };

    /**
     * Zoom: the in-app host route mounts the Web Meeting SDK with a ZAK minted
     * per request. Deliberately NOT the stored start url, and deliberately no
     * signature fetch here: the signature is one-shot, so whoever fetches it
     * must be the one who uses it.
     */
    const startZoom = (sessionId: string, scheduleId: string): HostActionResult => ({
        kind: 'open-route',
        provider: 'zoom',
        path: `/study-library/live-session/host/${encodeURIComponent(
            scheduleId
        )}?sessionId=${encodeURIComponent(sessionId)}`,
    });

    /** Google Meet is a plain URL join, after a 409 wait and a co-host wait when they apply. */
    const startMeet = async (scheduleId: string): Promise<HostActionResult> => {
        for (let attempt = 0; ; attempt += 1) {
            let status: number | null;
            let body: GoogleMeetJoinResponse = {};
            try {
                const response = await http(`${PROVIDER_MEETING_BASE}/google-meet-join`, {
                    scheduleId,
                });
                status = response.status ?? 200;
                body = (response.data ?? {}) as GoogleMeetJoinResponse;
            } catch (error) {
                status = statusOfError(error);
            }
            if (status === 409) {
                if (attempt >= MEET_PROVISIONING_RETRIES) {
                    return { kind: 'provisioning', provider: 'meet' };
                }
                progress('PROVISIONING');
                await wait(MEET_PROVISIONING_RETRY_MS);
                continue;
            }
            if (status === null || status < 200 || status >= 300) {
                return { kind: 'failed', provider: 'meet', status };
            }
            if (!isHttpUrl(body.joinUrl)) return { kind: 'no-url', provider: 'meet' };
            if (body.cohostJustAdded) {
                progress('COHOST_SETTLING');
                await wait(COHOST_SETTLE_MS);
            }
            return {
                kind: 'open-url',
                provider: 'meet',
                url: body.joinUrl.trim(),
                cohostEmail: body.cohostEmail ?? null,
                organizerEmail: body.organizerEmail ?? null,
            };
        }
    };

    /**
     * Zoho: `hostUrl` is a pre-signed start link. It is null when the occurrence
     * was never provisioned, which is why the fallback to the participant link
     * matters: a dead button at class time is the worst outcome here.
     */
    const startZoho = async (
        scheduleId: string,
        fallbackLink?: string | null
    ): Promise<HostActionResult> => {
        try {
            const { data } = await http(`${PROVIDER_MEETING_BASE}/session-links`, { scheduleId });
            const body = (data ?? {}) as SessionLinksResponse;
            if (isHttpUrl(body.hostUrl)) {
                return { kind: 'open-url', provider: 'zoho', url: body.hostUrl.trim() };
            }
            const classLink = isHttpUrl(body.joinUrl) ? body.joinUrl : fallbackLink;
            if (isHttpUrl(classLink)) {
                return {
                    kind: 'open-url',
                    provider: 'zoho',
                    url: classLink.trim(),
                    noHostLink: true,
                };
            }
            return { kind: 'no-url', provider: 'zoho' };
        } catch (error) {
            if (isHttpUrl(fallbackLink)) {
                return {
                    kind: 'open-url',
                    provider: 'zoho',
                    url: fallbackLink.trim(),
                    noHostLink: true,
                };
            }
            return { kind: 'failed', provider: 'zoho', status: statusOfError(error) };
        }
    };

    /**
     * The single source of truth for what the primary button on a class does.
     * Null only when there is neither a host flow nor a URL to open.
     */
    const resolveHostAction = (target: HostTarget): HostAction | null => {
        const { sessionId, scheduleId, linkType, streamingType, externalLink } = target;
        if (scheduleId) {
            const provider = detectHostProvider(linkType, streamingType);
            if (provider === 'bbb') {
                return { kind: 'host', provider, run: () => startBbb(scheduleId) };
            }
            if (provider === 'zoom') {
                return {
                    kind: 'host',
                    provider,
                    run: () => Promise.resolve(startZoom(sessionId, scheduleId)),
                };
            }
            if (provider === 'meet') {
                return { kind: 'host', provider, run: () => startMeet(scheduleId) };
            }
            if (provider === 'zoho') {
                return { kind: 'host', provider, run: () => startZoho(scheduleId, externalLink) };
            }
        }
        // YouTube, "other", or any custom link an institute pasted in: there is
        // no host role to claim, but the class still has a URL.
        if (isHttpUrl(externalLink)) {
            const url = externalLink.trim();
            return {
                kind: 'external',
                provider: 'external',
                run: () => Promise.resolve({ kind: 'open-url', provider: 'external', url }),
            };
        }
        return null;
    };

    return { resolveHostAction, startBbb, startZoom, startMeet, startZoho };
}
