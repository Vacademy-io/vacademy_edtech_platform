/**
 * Schedules are entered in the INSTITUTE's timezone and stored as true UTC
 * instants (spec 8.3 ScheduleEditor, risk R9). The admin's browser zone is
 * never used, and nothing is sent as a naive local string.
 *
 * `wall` values are what a `datetime-local` input holds: "2026-12-01T19:00".
 */

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The zone's UTC offset in ms at `instant` (positive east of UTC). */
function offsetAt(zone: string, instant: number): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(
        get('year'),
        get('month') - 1,
        get('day'),
        get('hour'),
        get('minute'),
        get('second')
    );
    // Drop the milliseconds the parts cannot carry.
    return asUtc - (instant - (instant % 1000));
}

/** "2026-12-01T19:00" in `zone` → "2026-12-01T13:30:00.000Z". Null for an empty or bad value. */
export function wallToInstant(wall: string | null | undefined, zone: string): string | null {
    const m = wall ? WALL.exec(wall) : null;
    if (!m) return null;
    const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
    // Two passes settle the offset across a DST change.
    let instant = guess - offsetAt(zone, guess);
    instant = guess - offsetAt(zone, instant);
    return new Date(instant).toISOString();
}

/** An instant → the wall-clock "YYYY-MM-DDTHH:mm" it shows in `zone`. */
export function instantToWall(iso: string | null | undefined, zone: string): string {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    const local = new Date(t + offsetAt(zone, t));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(
        local.getUTCHours()
    )}:${pad(local.getUTCMinutes())}`;
}

/** "IST", "GMT+4", … for labels next to the inputs. */
export function zoneLabel(zone: string, at: Date = new Date(), locale = 'en-IN'): string {
    try {
        const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
            .formatToParts(at)
            .find((p) => p.type === 'timeZoneName');
        return part?.value ?? zone;
    } catch {
        return zone;
    }
}

/** "30 Nov, 7:00 pm" in the institute zone. */
export function formatInZone(
    iso: string | null | undefined,
    zone: string,
    locale = 'en-IN',
    withTime = true
): string {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    return new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        day: 'numeric',
        month: 'short',
        ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    }).format(new Date(t));
}

export type WindowState = 'always' | 'scheduled' | 'running' | 'ended';

/** Where `now` falls in a [starts_at, ends_at) window. */
export function windowState(
    startsAt: string | null | undefined,
    endsAt: string | null | undefined,
    now: number = Date.now()
): WindowState {
    const s = startsAt ? Date.parse(startsAt) : NaN;
    const e = endsAt ? Date.parse(endsAt) : NaN;
    if (Number.isNaN(s) && Number.isNaN(e)) return 'always';
    if (!Number.isNaN(e) && now >= e) return 'ended';
    if (!Number.isNaN(s) && now < s) return 'scheduled';
    return 'running';
}

/** True when both bounds are set and the start is not before the end. */
export function isWindowInverted(
    startsAt: string | null | undefined,
    endsAt: string | null | undefined
): boolean {
    if (!startsAt || !endsAt) return false;
    const s = Date.parse(startsAt);
    const e = Date.parse(endsAt);
    return !Number.isNaN(s) && !Number.isNaN(e) && s >= e;
}
