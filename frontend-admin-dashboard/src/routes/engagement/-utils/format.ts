import { getLanguageSetting } from '@/services/language-settings';
import { getBrowserTimezoneOrUndefined, normalizeTimezone } from '@/utils/timezone';
import type { EngagementPlanDTO, PlanLifecycle } from '../-types/types';

/**
 * Dates, times and counts for the engagement screens.
 *
 * Two kinds of value flow through here, and they must never be mixed up:
 * - **Calendar days and wall-clock times** of a slot ("2026-09-25", "06:00"). These are
 *   already institute-local. They are pinned to UTC and formatted in UTC, because
 *   formatting them in any other zone can shift them by a day.
 * - **Instants** (completedAt, createdAt: ISO strings with an offset). These are shown in
 *   the plan's or institute's timezone, never the browser's.
 *
 * Every formatter takes the admin's language explicitly (`i18n.language`); nothing here
 * falls back to the browser locale.
 */

const FALLBACK_LANG = 'en';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME = /^(\d{1,2}):(\d{2})/;
const DAY_MS = 86_400_000;

/** A slot's schedule fields, as both the DTO and the request carry them. */
export interface SlotSchedule {
    startDate: string;
    endDate?: string | null;
    startTime: string;
    endTime: string;
    /** Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64; null/0 = every day. */
    dowMask?: number | null;
}

// ── Timezone and "today" ─────────────────────────────────────────────────────

/** The institute's timezone from the cached language setting, normalised and resolvable. */
export function instituteTimeZone(): string {
    return normalizeTimezone(getLanguageSetting()?.timezone);
}

/**
 * Today's calendar day (yyyy-MM-dd) in `timeZone`. Plan windows live on the institute's
 * calendar, so this replaces `toISOString().slice(0, 10)`, which is the UTC day and is
 * still yesterday before 05:30 in India.
 */
export function todayInZone(
    timeZone: string = instituteTimeZone(),
    now: Date = new Date()
): string {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: normalizeTimezone(timeZone),
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(now);
        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
        return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
        return toIsoDate(now);
    }
}

/** Today on the institute's calendar. */
export function instituteToday(now: Date = new Date()): string {
    return todayInZone(instituteTimeZone(), now);
}

// ── Calendar-day arithmetic (UTC-pinned) ─────────────────────────────────────

/** "2026-09-25" → a Date at UTC midnight, or null when the string isn't a real day. */
export function parseIsoDate(iso: string | null | undefined): Date | null {
    const m = iso ? ISO_DATE.exec(iso) : null;
    if (!m) return null;
    const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return toIsoDate(date) === iso ? date : null;
}

/** A Date's UTC calendar day as yyyy-MM-dd. */
export function toIsoDate(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
    const date = parseIsoDate(iso);
    if (!date) return iso;
    return toIsoDate(new Date(date.getTime() + days * DAY_MS));
}

/** Whole days from `from` to `to` (negative when `to` is earlier); NaN for a bad date. */
export function daysBetween(from: string, to: string): number {
    const a = parseIsoDate(from);
    const b = parseIsoDate(to);
    if (!a || !b) return Number.NaN;
    return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

// ── Weekdays ─────────────────────────────────────────────────────────────────

/** Every weekday bit, Monday first. */
export const WEEKDAY_BITS = [1, 2, 4, 8, 16, 32, 64] as const;
export const EVERY_DAY_MASK = 127;

/** The dowMask bit of a calendar day. */
export function weekdayBit(iso: string): number {
    const date = parseIsoDate(iso);
    if (!date) return 0;
    const day = date.getUTCDay(); // 0 = Sunday
    return day === 0 ? 64 : 1 << (day - 1);
}

/** True when a mask means "every day" (null, 0, or all seven bits). */
export function isEveryDay(mask: number | null | undefined): boolean {
    return !mask || (mask & EVERY_DAY_MASK) === EVERY_DAY_MASK;
}

/** Weekday names for chips, Monday first, in the admin's language. */
export function weekdayLabels(
    lang: string,
    style: 'narrow' | 'short' | 'long' = 'short'
): { bit: number; label: string }[] {
    const fmt = dateFormat(lang, { weekday: style, timeZone: 'UTC' });
    // 2024-01-01 was a Monday.
    return WEEKDAY_BITS.map((bit, i) => ({
        bit,
        label: fmt.format(new Date(Date.UTC(2024, 0, 1 + i))),
    }));
}

/** "Mon, Wed, Fri"; empty when the mask means every day. */
export function formatWeekdays(mask: number | null | undefined, lang: string): string {
    if (isEveryDay(mask)) return '';
    const days = weekdayLabels(lang)
        .filter(({ bit }) => ((mask ?? 0) & bit) !== 0)
        .map(({ label }) => label);
    return listFormat(lang, days);
}

// ── Slot schedule ────────────────────────────────────────────────────────────

/** The last day a slot runs: its endDate, or its startDate for a one-day slot. */
export function slotLastDate(slot: Pick<SlotSchedule, 'startDate' | 'endDate'>): string {
    return slot.endDate && slot.endDate >= slot.startDate ? slot.endDate : slot.startDate;
}

/** True when the slot runs on this calendar day (inside its range, on a masked weekday). */
export function slotRunsOn(slot: SlotSchedule, iso: string): boolean {
    if (iso < slot.startDate || iso > slotLastDate(slot)) return false;
    return isEveryDay(slot.dowMask) || ((slot.dowMask ?? 0) & weekdayBit(iso)) !== 0;
}

/** Every day the slot runs, oldest first, capped so a runaway range can't hang the UI. */
export function slotRunDates(slot: SlotSchedule, limit = 400): string[] {
    const out: string[] = [];
    const last = slotLastDate(slot);
    if (!parseIsoDate(slot.startDate) || !parseIsoDate(last)) return out;
    for (let day = slot.startDate, n = 0; day <= last && n < limit; day = addDays(day, 1), n++) {
        if (slotRunsOn(slot, day)) out.push(day);
    }
    return out;
}

/** Where a slot sits relative to today, for the Past / Today / Upcoming grouping. */
export function slotPhase(slot: SlotSchedule, today: string): 'PAST' | 'TODAY' | 'UPCOMING' {
    if (slotRunsOn(slot, today)) return 'TODAY';
    return slotLastDate(slot) < today ? 'PAST' : 'UPCOMING';
}

/** The first and last day a plan runs, from the list summary or its slots. */
export function planDateRange(
    plan: Pick<EngagementPlanDTO, 'firstDate' | 'lastDate' | 'slots'> &
        Partial<Pick<EngagementPlanDTO, 'scheduleMode'>>
): { first: string; last: string } | null {
    // A join-based plan's slot dates are "Day N" placeholders, not calendar days.
    if (plan.scheduleMode === 'RELATIVE') return null;
    if (plan.firstDate && plan.lastDate) return { first: plan.firstDate, last: plan.lastDate };
    const slots = plan.slots ?? [];
    if (slots.length === 0) return null;
    let first = slots[0]!.startDate;
    let last = slotLastDate(slots[0]!);
    for (const slot of slots) {
        if (slot.startDate < first) first = slot.startDate;
        const end = slotLastDate(slot);
        if (end > last) last = end;
    }
    return { first, last };
}

/**
 * Where a plan stands today. Uses the server's `todayState` when present, otherwise
 * derives it from the status and dates. "Today" is the server's `today` when sent,
 * else today in the plan's own timezone (its windows resolve there), else the
 * institute's. Returns null for a published plan whose dates
 * are unknown (the old list endpoint sends no slots), so the caller can show the plain
 * status instead of guessing.
 */
export function planLifecycle(
    plan: Pick<EngagementPlanDTO, 'status' | 'todayState' | 'firstDate' | 'lastDate' | 'slots'> &
        Partial<Pick<EngagementPlanDTO, 'today' | 'timezone' | 'scheduleMode'>>,
    today: string = plan.today || todayInZone(plan.timezone || instituteTimeZone())
): PlanLifecycle | null {
    if (plan.todayState) return plan.todayState;
    if (plan.status === 'ARCHIVED' || plan.status === 'DELETED') return 'ARCHIVED';
    if (plan.status === 'DRAFT') return 'DRAFT';
    // Each learner runs a join-based plan on their own days; published = running.
    if (plan.scheduleMode === 'RELATIVE') return 'RUNNING';
    const range = planDateRange(plan);
    if (!range) return null;
    if (today < range.first) return 'UPCOMING';
    if (today > range.last) return 'ENDED';
    return 'RUNNING';
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** "Thu, 25 Sep" for a calendar day. `year` adds the year; `weekday: false` drops the day name. */
export function formatDay(
    iso: string,
    lang: string,
    options: { weekday?: boolean; year?: boolean } = {}
): string {
    const date = parseIsoDate(iso);
    if (!date) return iso;
    return dateFormat(lang, {
        weekday: options.weekday === false ? undefined : 'short',
        day: 'numeric',
        month: 'short',
        year: options.year ? 'numeric' : undefined,
        timeZone: 'UTC',
    }).format(date);
}

/** "24–26 Sep" (or "30 Sep – 2 Oct"); a single day when both ends match. */
export function formatDayRange(first: string, last: string, lang: string): string {
    const a = parseIsoDate(first);
    const b = parseIsoDate(last);
    if (!a || !b) return [first, last].filter(Boolean).join(' – ');
    if (first === last) return formatDay(first, lang, { weekday: false });
    const fmt = dateFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const ranged = fmt as Intl.DateTimeFormat & {
        formatRange?: (start: Date, end: Date) => string;
    };
    try {
        if (typeof ranged.formatRange === 'function') return ranged.formatRange(a, b);
    } catch {
        // Fall through to the joined form.
    }
    return `${fmt.format(a)} – ${fmt.format(b)}`;
}

/** A wall-clock "06:00" (or "06:00:00") in the admin's locale, e.g. "6:00 am" or "06:00". */
export function formatTime(hhmm: string | null | undefined, lang: string): string {
    const m = hhmm ? WALL_TIME.exec(hhmm) : null;
    if (!m) return hhmm ?? '';
    const date = new Date(Date.UTC(1970, 0, 1, Number(m[1]), Number(m[2])));
    return dateFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date);
}

export function formatTimeRange(start: string, end: string, lang: string): string {
    return `${formatTime(start, lang)}–${formatTime(end, lang)}`;
}

/**
 * One line for a slot's schedule: "Thu, 25 Sep · 06:00–20:00", or for a range
 * "24–26 Sep · Mon, Wed · 06:00–20:00". When `timeZone` (the plan's) differs from the
 * admin's own zone its short name is appended, so a teacher abroad isn't misled.
 */
export function formatSlotWindow(slot: SlotSchedule, lang: string, timeZone?: string): string {
    const last = slotLastDate(slot);
    const days =
        last === slot.startDate
            ? formatDay(slot.startDate, lang)
            : formatDayRange(slot.startDate, last, lang);
    const parts = [days];
    const weekdays = last === slot.startDate ? '' : formatWeekdays(slot.dowMask, lang);
    if (weekdays) parts.push(weekdays);
    let window = formatTimeRange(slot.startTime, slot.endTime, lang);
    if (timeZone) {
        const zone = normalizeTimezone(timeZone);
        if (zone !== getBrowserTimezoneOrUndefined()) {
            const short = timeZoneShortName(zone, lang);
            if (short) window = `${window} (${short})`;
        }
    }
    parts.push(window);
    return parts.join(' · ');
}

/** An instant as "25 Sep, 14:05" in the given zone (the plan's, else the institute's). */
export function formatDateTime(
    instant: string | null | undefined,
    lang: string,
    timeZone: string = instituteTimeZone()
): string {
    if (!instant) return '';
    const date = new Date(instant);
    if (Number.isNaN(date.getTime())) return instant;
    return dateFormat(lang, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: normalizeTimezone(timeZone),
    }).format(date);
}

/** "3 hours ago" / "yesterday" for an instant, in the admin's language. */
export function formatRelative(
    instant: string | null | undefined,
    lang: string,
    now: Date = new Date()
): string {
    if (!instant) return '';
    const then = new Date(instant).getTime();
    if (Number.isNaN(then)) return '';
    const seconds = Math.round((then - now.getTime()) / 1000);
    const abs = Math.abs(seconds);
    let rtf: Intl.RelativeTimeFormat;
    try {
        rtf = new Intl.RelativeTimeFormat(lang || FALLBACK_LANG, { numeric: 'auto' });
    } catch {
        rtf = new Intl.RelativeTimeFormat(FALLBACK_LANG, { numeric: 'auto' });
    }
    if (abs < 60) return rtf.format(seconds, 'second');
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
    if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
    return rtf.format(Math.round(seconds / 86_400), 'day');
}

/** A duration as "2 min 5 sec" / "1 hr 3 min"; empty for a missing or negative value. */
export function formatDuration(ms: number | null | undefined, lang: string): string {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const unit = (value: number, name: 'hour' | 'minute' | 'second') =>
        numberFormat(lang, { style: 'unit', unit: name, unitDisplay: 'short' }).format(value);
    if (hours > 0)
        return minutes > 0
            ? `${unit(hours, 'hour')} ${unit(minutes, 'minute')}`
            : unit(hours, 'hour');
    if (minutes > 0)
        return seconds > 0
            ? `${unit(minutes, 'minute')} ${unit(seconds, 'second')}`
            : unit(minutes, 'minute');
    return unit(seconds, 'second');
}

export function formatNumber(value: number, lang: string): string {
    return numberFormat(lang, {}).format(value);
}

/** A 0–1 ratio as "67%". */
export function formatPercent(ratio: number, lang: string, fractionDigits = 0): string {
    if (!Number.isFinite(ratio)) return '';
    return numberFormat(lang, {
        style: 'percent',
        maximumFractionDigits: fractionDigits,
    }).format(ratio);
}

/** "1 / 2" with locale digits. */
export function formatFraction(part: number, whole: number, lang: string): string {
    return `${formatNumber(part, lang)} / ${formatNumber(whole, lang)}`;
}

// ── Plurals ──────────────────────────────────────────────────────────────────

/**
 * The CLDR plural category for a count ("one", "other", "few"…). i18next already picks
 * `_one`/`_other` keys from `{ count }`; use this only where a key is built by hand.
 */
export function pluralCategory(count: number, lang: string): Intl.LDMLPluralRule {
    try {
        return new Intl.PluralRules(lang || FALLBACK_LANG).select(count);
    } catch {
        return new Intl.PluralRules(FALLBACK_LANG).select(count);
    }
}

/** `${base}_${category}` for a count, e.g. pluralKey('wizard.days', 1, 'en') → 'wizard.days_one'. */
export function pluralKey(base: string, count: number, lang: string): string {
    return `${base}_${pluralCategory(count, lang)}`;
}

// ── internals ────────────────────────────────────────────────────────────────

function dateFormat(lang: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    try {
        return new Intl.DateTimeFormat(lang || FALLBACK_LANG, options);
    } catch {
        return new Intl.DateTimeFormat(FALLBACK_LANG, options);
    }
}

function numberFormat(lang: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
    try {
        return new Intl.NumberFormat(lang || FALLBACK_LANG, options);
    } catch {
        return new Intl.NumberFormat(FALLBACK_LANG, options);
    }
}

function listFormat(lang: string, items: string[]): string {
    try {
        return new Intl.ListFormat(lang || FALLBACK_LANG, { style: 'short', type: 'unit' }).format(
            items
        );
    } catch {
        return items.join(', ');
    }
}

function timeZoneShortName(timeZone: string, lang: string): string {
    try {
        const parts = dateFormat(lang, { timeZone, timeZoneName: 'short' }).formatToParts(
            new Date()
        );
        return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    } catch {
        return '';
    }
}
