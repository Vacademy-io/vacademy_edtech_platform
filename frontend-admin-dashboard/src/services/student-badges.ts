import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { BASE_URL } from '@/constants/urls';
import type { BadgeDefinitionConfig } from '@/routes/settings/-constants/badge-config';

const BASE = `${BASE_URL}/admin-core-service/learner-badge`;

/** How a learner_badge row came to exist. */
export type LearnerBadgeSource = 'MANUAL' | 'AUTO';

/** A badge held by a learner (server-persisted record, ACTIVE unless revoked). */
export interface LearnerBadgeAward {
    id: string;
    userId: string;
    instituteId: string;
    badgeId: string;
    badgeName?: string | null;
    badgeIcon?: string | null;
    badgeDescription?: string | null;
    reason?: string | null;
    status: 'ACTIVE' | 'REVOKED' | string;
    /**
     * MANUAL = staff-awarded, AUTO = synced from the learner app's client-computed unlock.
     * Absent on backends older than this field — treat as MANUAL (the column default, and the
     * only source that existed before sync shipped).
     */
    source?: LearnerBadgeSource | string | null;
    awardedByUserId?: string | null;
    awardedAt?: string | null;
}

/** Resolve the source of an award, defaulting older payloads to MANUAL. */
export function awardSource(award: Pick<LearnerBadgeAward, 'source'>): LearnerBadgeSource {
    return award.source === 'AUTO' ? 'AUTO' : 'MANUAL';
}

export interface AwardBadgePayload {
    userIds: string[];
    badgeId: string;
    badgeName?: string;
    badgeIcon?: string;
    badgeDescription?: string;
    reason?: string;
}

/** Per-learner outcome of an award call. */
export type AwardOutcomeStatus = 'NEW' | 'ALREADY_ACTIVE' | 'UPGRADED_FROM_AUTO' | 'NOT_ENROLLED';

export interface AwardBadgeOutcome {
    userId: string;
    status: AwardOutcomeStatus | string;
    /** Null for NOT_ENROLLED — nothing was written for that user. */
    badge: LearnerBadgeAward | null;
}

export interface AwardBadgeResponse {
    results: AwardBadgeOutcome[];
    /** Learners who did not hold the badge before this call. */
    awardedCount: number;
    /** Learners who already held an active staff award — left untouched. */
    alreadyHadCount: number;
    /** Learners whose auto-unlocked row was upgraded into a staff award (reason + issuer kept). */
    upgradedCount: number;
    /** Ids with no enrollment/contact row in this institute — skipped, never written or notified. */
    notEnrolledCount: number;
    /** False when the institute's badges master toggle is off — no learner notification was sent. */
    notified: boolean;
}

/** Largest batch the server accepts per call; the bulk dialog chunks below this. */
export const AWARD_BATCH_LIMIT = 500;

/** List a learner's active badges (staff-awarded and auto-synced). */
export async function getStudentAwardedBadges(userId: string): Promise<LearnerBadgeAward[]> {
    const instituteId = getCurrentInstituteId();
    const { data } = await authenticatedAxiosInstance<LearnerBadgeAward[]>({
        method: 'GET',
        url: `${BASE}/institutes/${instituteId}/users/${userId}`,
    });
    return data ?? [];
}

/** Award a catalogue badge to one or more learners. Idempotent per learner. */
export async function awardBadge(payload: AwardBadgePayload): Promise<AwardBadgeResponse> {
    const instituteId = getCurrentInstituteId();
    const { data } = await authenticatedAxiosInstance<AwardBadgeResponse>({
        method: 'POST',
        url: `${BASE}/institutes/${instituteId}/award`,
        data: payload,
        headers: { 'Content-Type': 'application/json' },
    });
    return normalizeAwardResponse(data);
}

/**
 * Accept both the envelope and the legacy bare-array shape (a backend that predates the
 * envelope) so a frontend-first deploy degrades to "everyone counted as awarded".
 */
export function normalizeAwardResponse(data: unknown): AwardBadgeResponse {
    if (Array.isArray(data)) {
        const results: AwardBadgeOutcome[] = (data as LearnerBadgeAward[]).map((b) => ({
            userId: b.userId,
            status: 'NEW',
            badge: b,
        }));
        return {
            results,
            awardedCount: results.length,
            alreadyHadCount: 0,
            upgradedCount: 0,
            notEnrolledCount: 0,
            notified: true,
        };
    }
    const d = (data ?? {}) as Partial<AwardBadgeResponse>;
    const results = Array.isArray(d.results) ? d.results : [];
    return {
        results,
        awardedCount: d.awardedCount ?? results.filter((r) => r.status === 'NEW').length,
        alreadyHadCount:
            d.alreadyHadCount ?? results.filter((r) => r.status === 'ALREADY_ACTIVE').length,
        upgradedCount:
            d.upgradedCount ?? results.filter((r) => r.status === 'UPGRADED_FROM_AUTO').length,
        notEnrolledCount:
            d.notEnrolledCount ?? results.filter((r) => r.status === 'NOT_ENROLLED').length,
        notified: d.notified !== false,
    };
}

/** Revoke a learner's active badge (the row is kept for audit, status → REVOKED). */
export async function revokeBadge(userId: string, badgeId: string): Promise<void> {
    const instituteId = getCurrentInstituteId();
    const params = new URLSearchParams();
    params.set('userId', userId);
    params.set('badgeId', badgeId);
    await authenticatedAxiosInstance({
        method: 'POST',
        url: `${BASE}/institutes/${instituteId}/revoke?${params.toString()}`,
    });
}

/** Fields the admin supplies when creating a catalogue badge from the award flow. */
export interface CreateCatalogueBadgePayload {
    /** Omit to let the server mint `badge_<uuid>`. */
    id?: string;
    name: string;
    description?: string;
    icon?: string;
    /** Defaults to `manual` server-side. */
    trigger?: BadgeDefinitionConfig['trigger'];
    threshold?: number;
    enabled?: boolean;
    hidden?: boolean;
}

export interface CatalogueBadgeResponse {
    /** The definition as persisted (server-normalised). */
    badge: BadgeDefinitionConfig;
    /** The institute's full badge list after the write (defaults materialised if it was empty). */
    badges: BadgeDefinitionConfig[];
    /** The institute's badges master toggle. */
    enabled: boolean;
}

/**
 * Append (or replace by id) ONE badge in the institute's BADGES_REWARDS_SETTING catalogue,
 * server-side. Unlike the Settings page this never rewrites the whole blob from client state,
 * so a stale tab cannot drop badges created elsewhere. Institute-admin only.
 */
export async function createCatalogueBadge(
    payload: CreateCatalogueBadgePayload
): Promise<CatalogueBadgeResponse> {
    const instituteId = getCurrentInstituteId();
    const { data } = await authenticatedAxiosInstance<CatalogueBadgeResponse>({
        method: 'POST',
        url: `${BASE}/institutes/${instituteId}/catalogue`,
        data: payload,
        headers: { 'Content-Type': 'application/json' },
    });
    return data;
}
