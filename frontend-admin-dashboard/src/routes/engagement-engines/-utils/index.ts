import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { buildChannelMeta, CHANNEL_ORDER } from '../-constants';
import type { ChannelKey, ChannelsConfig, EngagementEngine } from '../-types';

export function safeParse<T>(raw: string | undefined | null, fallback: T): T {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
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
