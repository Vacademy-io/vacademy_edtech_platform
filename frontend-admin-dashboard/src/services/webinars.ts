import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { WEBINARS_BASE_URL } from '@/constants/urls';

/** A webinar published from the health-check dashboard. Times are ISO-8601 instants (UTC). */
export interface WebinarDto {
    id: string;
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    /** Link admins open to join; null until the super admin adds it. */
    joinUrl: string | null;
    /** Recording, once added: an uploaded video file or any video link. */
    recordingUrl: string | null;
    active: boolean;
}

export type WebinarPhase = 'live' | 'upcoming' | 'past';

/** LIVE from start until end. Same rule as the health-check Webinars page. */
export function webinarPhase(
    w: Pick<WebinarDto, 'startsAt' | 'endsAt'>,
    now: number
): WebinarPhase {
    if (now >= Date.parse(w.endsAt)) return 'past';
    if (now >= Date.parse(w.startsAt)) return 'live';
    return 'upcoming';
}

/**
 * Only absolute http(s) links are opened. The API already refuses anything else; this keeps a
 * javascript: link from ever reaching window.open should a bad row get in some other way.
 */
export function safeLink(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
    } catch {
        return null;
    }
}

/**
 * Published webinars, newest first. Unlike the Training/roadmap bodies this is fetched as soon as
 * the dock shows: the rail has to know on every page whether a webinar is live right now. The list
 * is a few dozen short rows.
 */
export function useWebinars(enabled: boolean) {
    return useQuery({
        queryKey: ['webinars'],
        queryFn: async () =>
            (await authenticatedAxiosInstance.get<WebinarDto[]>(WEBINARS_BASE_URL)).data,
        staleTime: 5 * 60 * 1000,
        // Mounted on every admin page: one retry, not the default three, if the call fails.
        retry: 1,
        enabled,
    });
}

/** While nothing starts or ends within the hour, re-read the clock at least this often. */
const MAX_WAIT_MS = 5 * 60 * 1000;
/** Inside the last hour before a start, re-read every minute so "Starts in N min" stays right. */
const SOON_WAIT_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The current time, re-read exactly when the next webinar starts or ends, so the rail and the
 * panel flip to LIVE (and back) on time without polling every few seconds. With no webinar ahead
 * there is nothing that can change, so no timer runs at all.
 */
export function useWebinarClock(webinars: WebinarDto[] | undefined): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const current = Date.now();
        // New or refetched data after a quiet spell: catch the clock up first (this effect
        // runs again with the fresh value), or a webinar already under way reads as upcoming.
        if (current - now > 1000) {
            setNow(current);
            return;
        }
        const next = (webinars ?? [])
            .flatMap((w) => [Date.parse(w.startsAt), Date.parse(w.endsAt)])
            .filter((t) => t > current)
            .reduce((a, b) => Math.min(a, b), Infinity);
        if (!Number.isFinite(next)) return;
        const cap = next - current <= HOUR_MS ? SOON_WAIT_MS : MAX_WAIT_MS;
        const wait = Math.min(cap, Math.max(1000, next - current + 500));
        const id = window.setTimeout(() => setNow(Date.now()), wait);
        return () => window.clearTimeout(id);
    }, [webinars, now]);
    return now;
}
