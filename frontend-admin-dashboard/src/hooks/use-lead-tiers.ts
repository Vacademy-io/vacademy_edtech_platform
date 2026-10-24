/**
 * useLeadTiers — the institute's lead tier catalog (table-backed, replaces the
 * hard-coded HOT / WARM / COLD trio).
 *
 * A tier with `min_score` is auto-derived from the lead's best score (highest
 * band whose min_score <= score wins) unless the profile carries an explicit
 * `lead_tier` override; a tier without one is manual-only. The backend seeds
 * Hot(80) / Warm(50) / Cold(0) on first access so untouched institutes behave
 * exactly as before — and LEGACY_TIERS mirrors that seed for the loading /
 * offline case so nothing ever renders "unknown".
 */
import { useMemo, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { BASE_URL } from '@/constants/urls';

// authenticatedAxiosInstance has no baseURL, so endpoints must include the backend host.
const BASE = `${BASE_URL}/admin-core-service/v1/lead-tier`;

export interface LeadTier {
    id: string;
    institute_id?: string;
    tier_key: string;
    label: string;
    color: string;
    display_order: number;
    /** Lower bound of the auto-derive band; null = manual-only tier. */
    min_score: number | null;
    is_active: boolean;
    /** Seeded default (Hot/Warm/Cold) — editable but not deletable. */
    is_system: boolean;
}

/** Draft row used by the settings editor before it's persisted (no id yet for new rows). */
export interface LeadTierDraft {
    id?: string;
    tier_key?: string;
    label: string;
    color: string;
    display_order: number;
    min_score: number | null;
    is_system?: boolean;
}

export const LEAD_TIERS_QUERY_KEY = ['lead-tiers'];

/** Mirrors the backend seed (LeadTierService.DEFAULTS). Used until the catalog loads. */
export const LEGACY_TIERS: LeadTier[] = [
    {
        id: 'HOT',
        tier_key: 'HOT',
        label: 'Hot',
        color: '#ef4444',
        display_order: 1,
        min_score: 80,
        is_active: true,
        is_system: true,
    },
    {
        id: 'WARM',
        tier_key: 'WARM',
        label: 'Warm',
        color: '#f59e0b',
        display_order: 2,
        min_score: 50,
        is_active: true,
        is_system: true,
    },
    {
        id: 'COLD',
        tier_key: 'COLD',
        label: 'Cold',
        color: '#3b82f6',
        display_order: 3,
        min_score: 0,
        is_active: true,
        is_system: true,
    },
];

export const normalizeTierKey = (v: string | null | undefined): string =>
    (v ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

/**
 * Readable label for a key with no catalog row — a tier that was deleted while leads still
 * carry it, or one added on another tab. "SUPER_HOT" → "Super Hot", so the UI never shouts a
 * raw enum at the user.
 */
const humanizeTierKey = (key: string): string =>
    key
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(' ');

export async function fetchLeadTiers(): Promise<LeadTier[]> {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return [];
    try {
        const { data } = await authenticatedAxiosInstance.get(BASE, { params: { instituteId } });
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

/** The fixed 80/50 thresholds the platform used before catalogs existed (mirrors LeadTierService.legacyTier). */
export const legacyTierKey = (score: number | null | undefined): string => {
    const s = score ?? 0;
    if (s >= 80) return 'HOT';
    if (s >= 50) return 'WARM';
    return 'COLD';
};

/** Highest banded tier whose min_score <= score; null when no tier has a band. */
export function deriveTierKey(tiers: LeadTier[], score: number | null | undefined): string | null {
    const s = score ?? 0;
    let best: LeadTier | null = null;
    for (const t of tiers) {
        if (t.min_score == null || s < t.min_score) continue;
        if (!best || t.min_score > (best.min_score ?? -1)) best = t;
    }
    return best?.tier_key ?? null;
}

export interface LeadTierCatalog {
    /** Active tiers ordered by display_order (LEGACY_TIERS until loaded / on failure). */
    tiers: LeadTier[];
    isLoading: boolean;
    /** Catalog row for a key (case/space-insensitive); undefined when unknown. */
    byKey: (key: string | null | undefined) => LeadTier | undefined;
    /** Display label for a key — falls back to the raw key so old data still shows. */
    labelFor: (key: string | null | undefined) => string;
    /** Hex colour for a key — neutral grey when unknown. */
    colorFor: (key: string | null | undefined) => string;
    /** Explicit override wins, else the score-derived band, else null. */
    resolve: (
        explicit: string | null | undefined,
        score: number | null | undefined
    ) => string | null;
}

export const UNKNOWN_TIER_COLOR = '#9ca3af';

export function useLeadTiers(options?: { skip?: boolean }): LeadTierCatalog {
    const { data, isLoading } = useQuery({
        queryKey: LEAD_TIERS_QUERY_KEY,
        queryFn: fetchLeadTiers,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        enabled: !options?.skip,
    });
    return useMemo(() => {
        const tiers = (data && data.length > 0 ? data : LEGACY_TIERS)
            .filter((t) => t.is_active !== false)
            .slice()
            .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
        const map = new Map(tiers.map((t) => [normalizeTierKey(t.tier_key), t]));
        const byKey = (key: string | null | undefined) =>
            key ? map.get(normalizeTierKey(key)) : undefined;
        return {
            tiers,
            isLoading,
            byKey,
            labelFor: (key) => {
                if (!key) return '';
                const row = byKey(key);
                return row ? row.label : humanizeTierKey(String(key));
            },
            colorFor: (key) => byKey(key)?.color || UNKNOWN_TIER_COLOR,
            resolve: (explicit, score) => {
                if (explicit && explicit.trim()) return normalizeTierKey(explicit);
                if (score == null) return null;
                // Same fallback the backend uses (LeadTierService.deriveTier): when no band
                // covers the score — e.g. the admin's lowest band starts at 20 and this lead
                // scored 10 — the legacy thresholds decide, so the list, the badge and the
                // filter can't disagree about a lead's tier.
                return deriveTierKey(tiers, score) ?? legacyTierKey(score);
            },
        };
    }, [data, isLoading]);
}

// ── Settings CRUD ────────────────────────────────────────────────────────────

async function createLeadTier(payload: LeadTierDraft): Promise<void> {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(BASE, payload, { params: { instituteId } });
}

async function updateLeadTier(id: string, payload: LeadTierDraft): Promise<void> {
    // min_score null on the wire is ignored by the partial-update endpoint, so a
    // band removed in the editor is sent as the explicit clearMinScore flag.
    await authenticatedAxiosInstance.put(`${BASE}/${id}`, payload, {
        params: { clearMinScore: payload.min_score == null },
    });
}

export async function deleteLeadTier(id: string): Promise<void> {
    await authenticatedAxiosInstance.delete(`${BASE}/${id}`);
}

/**
 * Reconcile the edited list against the server: create new rows, update changed
 * ones. display_order is re-derived from list position so drag/arrow reordering
 * in the editor sticks.
 */
export async function saveLeadTiers(edited: LeadTierDraft[]): Promise<void> {
    await Promise.all(
        edited
            .filter((t) => t.label.trim())
            .map((t, idx) => {
                const payload: LeadTierDraft = { ...t, display_order: idx + 1 };
                return t.id ? updateLeadTier(t.id, payload) : createLeadTier(payload);
            })
    );
}

/** Inline chip styling for an arbitrary hex tier colour (no design-token equivalent). */
export function tierChipStyle(color: string): CSSProperties {
    return { backgroundColor: `${color}1f`, color, borderColor: `${color}55` };
}
