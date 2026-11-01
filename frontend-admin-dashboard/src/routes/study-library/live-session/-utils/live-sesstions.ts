import { format, parse } from 'date-fns';
import { DraftSession, LiveSession } from '../-services/utils';

export const getSessionJoinLink = (session: LiveSession | DraftSession, baseUrl: string) => {
    const normalizedBase = baseUrl
        ? (baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`)
        : '';
    if (session.access_level === 'private') {
        return `${normalizedBase}/study-library/live-class/embed?sessionId=${session.schedule_id}`;
    } else return `${normalizedBase}/register/live-class?sessionId=${session.session_id}`;
};

/**
 * Display helpers for the list cards.
 *
 * The past and draft cards used to print `${meeting_date} ${start_time}` —
 * i.e. the raw API strings, "2026-03-09 11:00:00" — straight into the UI.
 * These normalise them to the same shapes the live/upcoming card renders via
 * date-fns-tz, so a session reads identically on every tab.
 */

/** "2026-03-09" (or an ISO timestamp) → "Mon, 09 Mar 2026". Returns null for
 *  empty input and echoes anything unparseable rather than showing a crash. */
export const formatMeetingDate = (value?: string | null): string | null => {
    if (!value) return null;
    const parsed = parse(value.slice(0, 10), 'yyyy-MM-dd', new Date());
    return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'EEE, dd MMM yyyy');
};

/** "11:00:00", "11:00:00+05:30" or "2026-03-09T11:00:00Z" → "11:00 AM". */
export const formatClockTime = (value?: string | null): string | null => {
    if (!value) return null;
    const afterT = value.includes('T') ? (value.split('T')[1] ?? value) : value;
    const hhmm = afterT.replace(/[+-]\d{2}:\d{2}$|Z$/, '').slice(0, 5);
    const parsed = parse(hhmm, 'HH:mm', new Date());
    return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'h:mm a');
};

/** "11:00 AM – 12:15 PM", or just the start when there is no end time. */
export const formatTimeRange = (start?: string | null, end?: string | null): string | null => {
    const from = formatClockTime(start);
    const to = formatClockTime(end);
    if (!from) return to;
    return to ? `${from} – ${to}` : from;
};

/**
 * Lead time used when a session carries no waiting-room window of its own.
 * Long enough for a teacher to open the room before learners arrive, short
 * enough that a class three weeks out is not one stray click from a created
 * meeting (on BBB and Zoom, "start as host" really does create the room).
 */
export const DEFAULT_HOST_LEAD_MINUTES = 15;

/**
 * Is it reasonable to offer "Start as Host" for this occurrence right now?
 *
 * Open from (start − lead) through the session's end, where `lead` is the
 * session's own waiting-room window when it has one. `end` is the same bound
 * the list uses to decide LIVE vs PAST, so the button cannot outlive the tab
 * the card is sitting on.
 */
/**
 * How far off is this class, in plain words, for the "start it early?" prompt.
 * Returns null once the class is near enough that no warning is warranted.
 */
export const describeTimeUntilStart = (start: Date, now: Date = new Date()): string | null => {
    if (Number.isNaN(start.getTime())) return null;
    const ms = start.getTime() - now.getTime();
    if (ms <= 0) return null;
    const mins = Math.round(ms / 60_000);
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'}`;
};

export const isHostWindowOpen = (
    start: Date,
    end: Date,
    waitingRoomMinutes?: number | null,
    now: Date = new Date()
): boolean => {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    const lead =
        waitingRoomMinutes && waitingRoomMinutes > 0
            ? waitingRoomMinutes
            : DEFAULT_HOST_LEAD_MINUTES;
    const opensAt = new Date(start.getTime() - lead * 60_000);
    return now >= opensAt && now <= end;
};
