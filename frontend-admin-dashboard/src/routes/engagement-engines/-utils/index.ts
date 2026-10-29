import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { buildChannelMeta, CHANNEL_ORDER } from '../-constants';
import type { ChannelKey, ChannelsConfig, EngagementEngine, QuietHours } from '../-types';

export function safeParse<T>(raw: string | undefined | null, fallback: T): T {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

/**
 * How often an engine revisits a person, in words: "Daily", "Every 3 days", "Weekly", or
 * "Every 36 hours". `t` must be bound to engagementEnginesConstants.
 */
export function cadenceText(hours: number | string | undefined, t: TFunction): string {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) return '—';
    if (h % 24 !== 0) return t('cadence.hours', { count: h });
    const days = h / 24;
    if (days === 1) return t('cadence.daily');
    if (days === 7) return t('cadence.weekly');
    return t('cadence.days', { count: days });
}

/** Monday to Saturday, ISO numbering (1 = Monday): the default days for a new engine. */
export const DEFAULT_SEND_DAYS = [1, 2, 3, 4, 5, 6];
/** The default send time for a new engine (11:00). */
export const DEFAULT_SEND_HOUR = 11;
/** Planned messages go out within this many minutes of the send time (backend WINDOW). */
export const SEND_WINDOW_MINUTES = 60;

const hhmm = (h: number, m: number) =>
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** "11:00–12:00", or "Any time" when the engine has no send time. `t`: engagementEnginesConstants. */
export function sendWindowText(qh: QuietHours, t: TFunction): string {
    if (qh.sendHour == null) return t('schedule.anyTime');
    const start = qh.sendHour * 60 + (qh.sendMinute ?? 0);
    const end = (start + SEND_WINDOW_MINUTES) % (24 * 60);
    return `${hhmm(qh.sendHour, qh.sendMinute ?? 0)}–${hhmm(Math.floor(end / 60), end % 60)}`;
}

/** "Every day", "Mon–Sat", "Mon–Fri" or "Mon, Wed, Fri". `t`: engagementEnginesConstants. */
export function sendDaysText(days: number[] | undefined, t: TFunction): string {
    const set = [...new Set((days ?? []).filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b);
    if (set.length === 0 || set.length === 7) return t('schedule.everyDay');
    const contiguous = set.every((d, i) => i === 0 || d === (set[i - 1] ?? 0) + 1);
    if (contiguous && set.length >= 3) {
        return `${t(`schedule.day.${set[0]}`)}–${t(`schedule.day.${set[set.length - 1]}`)}`;
    }
    return set.map((d) => t(`schedule.day.${d}`)).join(', ');
}

/** "Every 2 days · 11:00–12:00 · Mon–Sat": the whole schedule in one line. */
export function scheduleText(cadenceHours: number | string | undefined, qh: QuietHours, t: TFunction) {
    return [cadenceText(cadenceHours, t), sendWindowText(qh, t), sendDaysText(qh.days, t)].join(' · ');
}

export function enabledChannels(engine: Pick<EngagementEngine, 'channels'>): ChannelKey[] {
    const cfg = safeParse<ChannelsConfig>(engine.channels, {});
    return CHANNEL_ORDER.filter((c) => cfg[c]?.enabled);
}

/** Threads `t` in from the calling component (module-scope, not a hook) — mirrors the
 *  `buildXxx(t)` convention in ../-constants, whose channel meta this reads. */
export function channelLabels(engine: Pick<EngagementEngine, 'channels'>, t: TFunction): string[] {
    const meta = buildChannelMeta(t);
    return enabledChannels(engine).map((c) => meta[c].label);
}

export function whatsappEnabled(engine: Pick<EngagementEngine, 'channels'>): boolean {
    return safeParse<ChannelsConfig>(engine.channels, {}).WHATSAPP?.enabled === true;
}

/**
 * Channels the engine actually auto-sends on: BOTH enabled AND auto (mirrors the backend, which
 * never picks a non-enabled channel — so a stale {enabled:false,auto:true} must not count).
 */
export function autoSendChannels(engine: Pick<EngagementEngine, 'channels'>): ChannelKey[] {
    const cfg = safeParse<ChannelsConfig>(engine.channels, {});
    return CHANNEL_ORDER.filter((c) => cfg[c]?.enabled && cfg[c]?.auto);
}

/**
 * Module-scope, no React context available here (plain util called across many components) — uses
 * the i18next singleton directly per the admin i18n rollout's "module-scope strings with no React
 * context" convention. Not reactive to a runtime language switch without a remount of the caller;
 * accepted tradeoff for this non-component context (same as Payment/utils/utils.ts).
 */
export function formatDateTime(iso?: string): string {
    if (!iso) return i18n.t('engagementEnginesUtils:noDate');
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return i18n.t('engagementEnginesUtils:noDate');
    return d.toLocaleString(i18n.language, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
