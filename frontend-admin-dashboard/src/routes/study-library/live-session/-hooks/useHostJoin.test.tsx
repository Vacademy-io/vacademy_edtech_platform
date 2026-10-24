/**
 * "Start as Host" is the one button that must not be wrong at class time, so
 * this pins down the two things that decide what it does: which provider gets
 * which endpoint, and when the button is offered at all.
 *
 * The time gate matters because on BBB and Zoom starting really does create the
 * meeting room — an ungated button on a three-weeks-out class is a footgun.
 */
import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { toast } from 'sonner';
import { useHostJoin } from './useHostJoin';
import { isHostWindowOpen, DEFAULT_HOST_LEAD_MINUTES } from '../-utils/live-sesstions';

const get = authenticatedAxiosInstance.get as unknown as Mock;
const openSpy = vi.fn();

const base = { sessionId: 'sess-1', scheduleId: 'sched-1' };
const resolver = () => renderHook(() => useHostJoin()).result.current.resolveHostAction;

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('open', openSpy);
});

describe('useHostJoin — provider routing', () => {
    it('sends BBB to the moderator join endpoint', async () => {
        get.mockResolvedValue({ data: { joinUrl: 'https://bbb.example.com/join?x=1' } });
        const action = resolver()({ ...base, linkType: 'bbb' });

        expect(action?.kind).toBe('host');
        await action?.run();

        expect(get).toHaveBeenCalledWith(
            expect.stringContaining('/provider/meeting/join'),
            { params: { scheduleId: 'sched-1', role: 'MODERATOR', recreate: false } }
        );
        expect(openSpy).toHaveBeenCalledWith(
            'https://bbb.example.com/join?x=1',
            '_blank',
            'noopener,noreferrer'
        );
    });

    it('sends Zoom to the in-app host route, never an external URL', async () => {
        const action = resolver()({ ...base, linkType: 'zoom' });

        expect(action?.kind).toBe('host');
        await action?.run();

        expect(navigate).toHaveBeenCalledWith({
            to: '/study-library/live-session/host/$scheduleId',
            params: { scheduleId: 'sched-1' },
            search: { sessionId: 'sess-1' },
        });
        expect(get).not.toHaveBeenCalled();
        expect(openSpy).not.toHaveBeenCalled();
    });

    it('sends Google Meet to the meet-join endpoint', async () => {
        get.mockResolvedValue({ data: { joinUrl: 'https://meet.google.com/abc-defg-hij' } });
        await resolver()({ ...base, linkType: 'google meet' })?.run();

        expect(get).toHaveBeenCalledWith(
            expect.stringContaining('/provider/meeting/google-meet-join'),
            { params: { scheduleId: 'sched-1' } }
        );
    });

    it('sends Zoho to session-links and opens the pre-signed host URL', async () => {
        get.mockResolvedValue({
            data: { hostUrl: 'https://meeting.zoho.com/start/xyz', joinUrl: 'https://z/join' },
        });
        const action = resolver()({ ...base, linkType: 'zoho' });

        expect(action?.kind).toBe('host');
        await action?.run();

        expect(get).toHaveBeenCalledWith(
            expect.stringContaining('/provider/meeting/session-links'),
            { params: { scheduleId: 'sched-1' } }
        );
        expect(openSpy).toHaveBeenCalledWith(
            'https://meeting.zoho.com/start/xyz',
            '_blank',
            'noopener,noreferrer'
        );
    });

    it('accepts the enum-style link types the backend also emits', () => {
        expect(resolver()({ ...base, linkType: 'BBB_MEETING' })?.kind).toBe('host');
        expect(resolver()({ ...base, linkType: 'ZOOM_MEETING' })?.kind).toBe('host');
        expect(resolver()({ ...base, linkType: 'GOOGLE_MEET' })?.kind).toBe('host');
        expect(resolver()({ ...base, linkType: 'ZOHO_MEETING' })?.kind).toBe('host');
    });
});

describe('useHostJoin — Zoho degradation', () => {
    it('falls back to the class link when the occurrence has no host URL', async () => {
        get.mockResolvedValue({ data: {} });
        await resolver()({
            ...base,
            linkType: 'zoho',
            meetingLink: 'https://meeting.zoho.com/join/fallback',
        })?.run();

        expect(openSpy).toHaveBeenCalledWith(
            'https://meeting.zoho.com/join/fallback',
            '_blank',
            'noopener,noreferrer'
        );
        expect(toast.info).toHaveBeenCalled();
    });

    it('falls back to the class link when session-links itself fails', async () => {
        get.mockRejectedValue(new Error('boom'));
        await resolver()({
            ...base,
            linkType: 'zoho',
            meetingLink: 'https://meeting.zoho.com/join/fallback',
        })?.run();

        expect(openSpy).toHaveBeenCalledWith(
            'https://meeting.zoho.com/join/fallback',
            '_blank',
            'noopener,noreferrer'
        );
    });

    it('never opens a blank tab when there is no link at all', async () => {
        get.mockResolvedValue({ data: {} });
        await resolver()({ ...base, linkType: 'zoho' })?.run();

        expect(openSpy).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
    });
});

describe('useHostJoin — external links', () => {
    it('offers YouTube and other custom links as a plain external open', () => {
        const action = resolver()({
            ...base,
            linkType: 'youtube',
            meetingLink: 'https://youtube.com/live/abc',
        });

        expect(action?.kind).toBe('external');
        action?.run();
        expect(openSpy).toHaveBeenCalledWith(
            'https://youtube.com/live/abc',
            '_blank',
            'noopener,noreferrer'
        );
    });

    it('uses the day-level default class link when there is no meeting link', () => {
        const action = resolver()({
            ...base,
            linkType: 'other',
            defaultClassLink: 'https://example.com/class',
        });

        expect(action?.kind).toBe('external');
    });

    it('returns null when a session has nothing to open', () => {
        expect(resolver()({ ...base, linkType: 'other' })).toBeNull();
    });

    it('refuses a non-http link rather than opening it', () => {
        // eslint-disable-next-line no-script-url
        const action = resolver()({
            ...base,
            linkType: 'other',
            meetingLink: 'javascript:alert(1)',
        });
        expect(action).toBeNull();
    });
});

describe('isHostWindowOpen', () => {
    const start = new Date('2026-03-09T11:00:00Z');
    const end = new Date('2026-03-09T12:15:00Z');

    it('is open while the class is running', () => {
        expect(isHostWindowOpen(start, end, null, new Date('2026-03-09T11:30:00Z'))).toBe(true);
    });

    it('opens the default lead time before start', () => {
        const justInside = new Date(start.getTime() - (DEFAULT_HOST_LEAD_MINUTES - 1) * 60_000);
        expect(isHostWindowOpen(start, end, null, justInside)).toBe(true);
    });

    it('stays shut for a class that is still far away', () => {
        expect(isHostWindowOpen(start, end, null, new Date('2026-03-09T10:00:00Z'))).toBe(false);
        expect(isHostWindowOpen(start, end, null, new Date('2026-02-16T11:00:00Z'))).toBe(false);
    });

    it("honours the session's own waiting-room window when it has one", () => {
        const fortyMinsEarly = new Date('2026-03-09T10:20:00Z');
        expect(isHostWindowOpen(start, end, null, fortyMinsEarly)).toBe(false);
        expect(isHostWindowOpen(start, end, 60, fortyMinsEarly)).toBe(true);
    });

    it('closes once the session is over', () => {
        expect(isHostWindowOpen(start, end, null, new Date('2026-03-09T12:16:00Z'))).toBe(false);
    });

    it('is shut rather than throwing on an unparseable time', () => {
        expect(isHostWindowOpen(new Date('nope'), end, null, start)).toBe(false);
    });
});
