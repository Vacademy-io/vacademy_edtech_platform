/**
 * Pure presentation helpers for the v2 credits popover (History v2 /
 * Analytics v2). Kept free of React so the amount/badge rules can be unit
 * tested on their own.
 */
import {
    ArrowDown,
    ArrowUp,
    Article,
    Books,
    ChartLineUp,
    ChatsCircle,
    GraduationCap,
    ListChecks,
    Megaphone,
    Phone,
    Robot,
    Sparkle,
    SpeakerHigh,
    VideoCamera,
} from '@phosphor-icons/react';
import type { UsageEventItem } from '@/services/ai-credits/usage-v2';
import { toNumber } from '@/services/ai-credits/usage-v2';

type IconType = typeof Sparkle;

export interface FeatureGroupStyle {
    icon: IconType;
    color: string;
    bgColor: string;
}

const NEUTRAL_GROUP: FeatureGroupStyle = {
    icon: Sparkle,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
};

/** Catalog feature_group → row icon (ai_use_case_catalog.feature_group). */
const FEATURE_GROUP_STYLES: Record<string, FeatureGroupStyle> = {
    calling: { icon: Phone, color: 'text-info-600', bgColor: 'bg-info-50' },
    crm: { icon: ChatsCircle, color: 'text-info-600', bgColor: 'bg-info-50' },
    analytics: { icon: ChartLineUp, color: 'text-success-600', bgColor: 'bg-success-50' },
    video: { icon: VideoCamera, color: 'text-danger-600', bgColor: 'bg-danger-50' },
    tutor: { icon: GraduationCap, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    agent: { icon: Robot, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    content: { icon: Article, color: 'text-primary-500', bgColor: 'bg-primary-50' },
    assessment: { icon: ListChecks, color: 'text-warning-600', bgColor: 'bg-warning-50' },
    kb: { icon: Books, color: 'text-success-600', bgColor: 'bg-success-50' },
    media: { icon: SpeakerHigh, color: 'text-info-600', bgColor: 'bg-info-50' },
    engagement: { icon: Megaphone, color: 'text-warning-600', bgColor: 'bg-warning-50' },
};

export function featureGroupStyle(group: string | null | undefined): FeatureGroupStyle {
    if (!group) return NEUTRAL_GROUP;
    return FEATURE_GROUP_STYLES[group] ?? NEUTRAL_GROUP;
}

/** Ledger (non-usage) rows: grants, purchases, admin adjustments, refunds. */
export interface LedgerTypeStyle {
    labelKey: string;
    color: string;
    bgColor: string;
    icon: IconType;
}

const LEDGER_TYPES: Record<string, LedgerTypeStyle> = {
    USAGE_DEDUCTION: {
        labelKey: 'ledger.usage',
        color: 'text-danger-600',
        bgColor: 'bg-danger-50',
        icon: ArrowDown,
    },
    INITIAL_GRANT: {
        labelKey: 'ledger.grant',
        color: 'text-success-600',
        bgColor: 'bg-success-50',
        icon: ArrowUp,
    },
    ADMIN_GRANT: {
        labelKey: 'ledger.adminGrant',
        color: 'text-info-600',
        bgColor: 'bg-info-50',
        icon: ArrowUp,
    },
    ADMIN_DEDUCTION: {
        labelKey: 'ledger.adminDeduction',
        color: 'text-danger-600',
        bgColor: 'bg-danger-50',
        icon: ArrowDown,
    },
    REFUND: {
        labelKey: 'ledger.refund',
        color: 'text-success-600',
        bgColor: 'bg-success-50',
        icon: ArrowUp,
    },
    PURCHASE: {
        labelKey: 'ledger.purchase',
        color: 'text-success-600',
        bgColor: 'bg-success-50',
        icon: ArrowUp,
    },
};

export function ledgerTypeStyle(type: string, amount: number): LedgerTypeStyle {
    return (
        LEDGER_TYPES[type] ?? {
            labelKey: 'ledger.transaction',
            color: amount > 0 ? 'text-success-600' : 'text-neutral-600',
            bgColor: amount > 0 ? 'bg-success-50' : 'bg-neutral-50',
            icon: amount > 0 ? ArrowUp : ArrowDown,
        }
    );
}

/**
 * What the amount column says for a usage event.
 *  - `charged`: a debit; `credits` is the positive amount taken from the wallet.
 *  - the others render a word instead of a number.
 */
export type AmountKind = 'charged' | 'included' | 'free' | 'ownKey' | 'notCharged';

export interface AmountDisplay {
    kind: AmountKind;
    credits: number;
    refunded: number;
}

export function eventAmount(event: UsageEventItem): AmountDisplay {
    const credits = toNumber(event.credits_charged);
    const refunded = toNumber(event.refunded_credits);
    const mode = (event.billing_mode || '').toUpperCase();
    const status = (event.charge_status || '').toUpperCase();

    if (status === 'DROPPED_INSUFFICIENT') return { kind: 'notCharged', credits: 0, refunded };
    if (mode === 'BYO_KEY') return { kind: 'ownKey', credits: 0, refunded };
    if ((mode === 'INCLUDED' || mode === 'ALLOWANCE') && credits <= 0) {
        return { kind: 'included', credits: 0, refunded };
    }
    if (mode === 'FREE' || credits <= 0) return { kind: 'free', credits: 0, refunded };
    // CHARGED, SPLIT (part charged), or an included/allowance row that still debited.
    return { kind: 'charged', credits, refunded };
}

/** "vendor/model-name" → "model-name"; prefers the server's short name. */
export function modelShortName(event: Pick<UsageEventItem, 'model_short' | 'model_id'>) {
    if (event.model_short) return event.model_short;
    if (event.model_id) return event.model_id.split('/').pop() || event.model_id;
    return null;
}

export interface UnitLine {
    key: string;
    labelKey: string;
    value: number;
}

const UNIT_FIELDS: { field: keyof NonNullable<UsageEventItem['units']>; labelKey: string }[] = [
    { field: 'prompt_tokens', labelKey: 'details.promptTokens' },
    { field: 'completion_tokens', labelKey: 'details.completionTokens' },
    { field: 'cached_read_tokens', labelKey: 'details.cachedTokens' },
    { field: 'image_count', labelKey: 'details.images' },
    { field: 'seconds', labelKey: 'details.seconds' },
    { field: 'minutes', labelKey: 'details.minutes' },
    { field: 'characters', labelKey: 'details.characters' },
];

/** Non-zero units only, in a fixed order. */
export function unitLines(event: UsageEventItem): UnitLine[] {
    const units = event.units || {};
    return UNIT_FIELDS.flatMap(({ field, labelKey }) => {
        const value = toNumber(units[field] ?? null);
        return value > 0 ? [{ key: field, labelKey, value }] : [];
    });
}

/** Up to `limit` primitive context entries worth showing in the expanded row. */
export function contextEntries(
    context: Record<string, unknown> | null | undefined,
    limit = 6
): [string, string][] {
    if (!context || typeof context !== 'object') return [];
    const out: [string, string][] = [];
    for (const [k, v] of Object.entries(context)) {
        if (out.length >= limit) break;
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            out.push([k.replace(/_/g, ' '), String(v)]);
        }
    }
    return out;
}

/**
 * Last `days` calendar days ending today, as YYYY-MM-DD in IST (UTC+05:30) —
 * the usage-summary `group_by=day` keys are IST days, so the gap-filled axis
 * must use the same calendar.
 */
export function lastIstDays(days: number, now: Date = new Date()): string[] {
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
    const todayIst = new Date(now.getTime() + IST_OFFSET_MS);
    const out: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(todayIst.getTime() - i * 24 * 60 * 60 * 1000);
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}
