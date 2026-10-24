/**
 * "Start as host" for a live session, for every provider we can host into.
 *
 * This used to live inline in the session detail page, which meant the list
 * cards had no way to start a class — you had to open a session first. It also
 * meant Zoho sessions had no host entry point anywhere: the detail page's
 * resolver returned null for them and fell back to the participant link, even
 * though the backend has had a pre-signed Zoho start link all along
 * (`meeting/session-links` → `hostUrl`). Both call sites now share this hook,
 * so a provider added here shows up on the card and the detail page at once.
 *
 * Resolution order per session:
 *   BBB / Zoom / Google Meet / Zoho → a real host action
 *   anything else with a meeting URL → open that external link
 *   nothing                          → null, caller decides the fallback
 */
import { useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { StreamingPlatform } from '../-constants/enums';

/** What the resolver needs to know about a session. Deliberately structural so
 *  both the list card (flat search row) and the detail page (schedule object)
 *  can satisfy it without adapters. */
export interface HostJoinTarget {
    sessionId: string;
    scheduleId: string;
    /** `link_type` — 'bbb' | 'zoom' | 'google meet' | 'zoho' | 'youtube' | … */
    linkType?: string | null;
    /** custom_meeting_link ?? default_meet_link, for providers we can't host. */
    meetingLink?: string | null;
    /** Day-level default class link, used when there is no meeting link. */
    defaultClassLink?: string | null;
}

export type HostActionKind = 'host' | 'external';

export interface HostAction {
    /** 'host' → we start the meeting as moderator. 'external' → we just open a URL. */
    kind: HostActionKind;
    run: () => void | Promise<void>;
}

const norm = (value?: string | null) => (value ?? '').trim().toLowerCase();

const isBbb = (linkType?: string | null) => {
    const v = norm(linkType);
    return v === StreamingPlatform.BBB || v === 'bbb_meeting';
};
const isZoom = (linkType?: string | null) => {
    const v = norm(linkType);
    return v === StreamingPlatform.ZOOM || v === 'zoom_meeting';
};
const isMeet = (linkType?: string | null) => {
    const v = norm(linkType);
    return v === StreamingPlatform.MEET || v === 'google_meet' || v === 'googlemeet';
};
const isZoho = (linkType?: string | null) => {
    const v = norm(linkType);
    return v === StreamingPlatform.ZOHO || v === 'zoho_meeting';
};

/** Only ever hand window.open an http(s) URL — a null/garbage host link must
 *  not open about:blank or, worse, a javascript: URL from stored data. */
const openExternal = (url?: string | null): boolean => {
    const trimmed = (url ?? '').trim();
    if (!/^https?:\/\//i.test(trimmed)) return false;
    window.open(trimmed, '_blank', 'noopener,noreferrer');
    return true;
};

export function useHostJoin() {
    const navigate = useNavigate();

    /**
     * BBB: the backend auto-creates the room if it doesn't exist yet, so this
     * genuinely starts the class. The two non-happy-path statuses are not
     * errors and must keep their behaviour — MEETING_ENDED offers a fresh room,
     * RECREATE_BLOCKED refuses to strand learners already sitting in the old one.
     */
    const startBbb = useCallback(async (scheduleId: string, recreate = false): Promise<void> => {
        try {
            const response = await authenticatedAxiosInstance.get(
                `${BASE_URL}/admin-core-service/live-sessions/provider/meeting/join`,
                { params: { scheduleId, role: 'MODERATOR', recreate } }
            );

            if (response.data?.status === 'MEETING_ENDED') {
                const confirmed = window.confirm(
                    'This meeting has ended.\n\nDo you want to start a new meeting for this session?'
                );
                if (confirmed) await startBbb(scheduleId, true);
                return;
            }

            if (response.data?.status === 'RECREATE_BLOCKED') {
                toast.error(
                    response.data?.message ||
                        'This class is still active. Please join the existing class instead of starting a new one.'
                );
                return;
            }

            if (!openExternal(response.data?.joinUrl)) {
                toast.error('Failed to get host join URL');
            }
        } catch (err) {
            console.error('Failed to join as host:', err);
            toast.error('Failed to start session. Please try again.');
        }
    }, []);

    /**
     * Zoom: go to the in-app host embed route, which mounts the Web Meeting SDK
     * with role=1 and a ZAK minted per request. Deliberately NOT the stored
     * start url — that ZAK expires in ~2h, so on a recurring session it is dead
     * long before the class runs.
     */
    const startZoom = useCallback(
        (sessionId: string, scheduleId: string) => {
            navigate({
                to: '/study-library/live-session/host/$scheduleId',
                params: { scheduleId },
                search: { sessionId },
            });
        },
        [navigate]
    );

    /** Google Meet is a plain URL join; the organizer reminder matters because
     *  auto-recording only fires when the host is signed in as the organizer. */
    const startMeet = useCallback(async (scheduleId: string): Promise<void> => {
        try {
            const response = await authenticatedAxiosInstance.get(
                `${BASE_URL}/admin-core-service/live-sessions/provider/meeting/google-meet-join`,
                { params: { scheduleId } }
            );
            const organizerEmail = response.data?.organizerEmail;
            const cohostEmail = response.data?.cohostEmail;
            if (openExternal(response.data?.joinUrl)) {
                if (cohostEmail) {
                    toast.info(`Open Meet signed in to ${cohostEmail} to get host controls.`);
                } else if (organizerEmail) {
                    toast.info(`Open Meet signed in to ${organizerEmail} so the session records.`);
                }
            } else {
                toast.error('Failed to get the Google Meet link');
            }
        } catch (err) {
            console.error('Failed to start Google Meet as host:', err);
            toast.error('Failed to start session. Please try again.');
        }
    }, []);

    /**
     * Zoho: `hostUrl` is a pre-signed startLink that drops the host straight in
     * without the name/email form. It is null when the occurrence was never
     * provisioned, which is why the fallback to the participant link matters —
     * a dead button at class time is the worst outcome here.
     */
    const startZoho = useCallback(
        async (scheduleId: string, fallbackLink?: string | null): Promise<void> => {
            try {
                const response = await authenticatedAxiosInstance.get(
                    `${BASE_URL}/admin-core-service/live-sessions/provider/meeting/session-links`,
                    { params: { scheduleId } }
                );
                if (openExternal(response.data?.hostUrl)) return;
                if (openExternal(response.data?.joinUrl) || openExternal(fallbackLink)) {
                    toast.info('Opened the class link — no host link is available for this session.');
                    return;
                }
                toast.error('Failed to get the host link for this session');
            } catch (err) {
                console.error('Failed to start Zoho meeting as host:', err);
                if (openExternal(fallbackLink)) return;
                toast.error('Failed to start session. Please try again.');
            }
        },
        []
    );

    /**
     * The single source of truth for "what does the primary button on this
     * session do?". Returns null only when there is neither a host flow nor any
     * URL to open, so the caller can fall back to opening the session page.
     */
    const resolveHostAction = useCallback(
        (target: HostJoinTarget): HostAction | null => {
            const { sessionId, scheduleId, linkType, meetingLink, defaultClassLink } = target;
            const externalLink = meetingLink || defaultClassLink;

            if (scheduleId) {
                if (isBbb(linkType)) return { kind: 'host', run: () => startBbb(scheduleId) };
                if (isZoom(linkType))
                    return { kind: 'host', run: () => startZoom(sessionId, scheduleId) };
                if (isMeet(linkType)) return { kind: 'host', run: () => startMeet(scheduleId) };
                if (isZoho(linkType))
                    return { kind: 'host', run: () => startZoho(scheduleId, externalLink) };
            }

            // YouTube, "other", or any custom/external link an institute pasted
            // in: there is no host role to claim, but the class still has a URL
            // and opening it from the card beats making someone dig for it.
            if (/^https?:\/\//i.test((externalLink ?? '').trim())) {
                return {
                    kind: 'external',
                    run: () => {
                        openExternal(externalLink);
                    },
                };
            }

            return null;
        },
        [startBbb, startZoom, startMeet, startZoho]
    );

    return useMemo(
        () => ({ resolveHostAction, startBbb, startZoom, startMeet, startZoho }),
        [resolveHostAction, startBbb, startZoom, startMeet, startZoho]
    );
}
