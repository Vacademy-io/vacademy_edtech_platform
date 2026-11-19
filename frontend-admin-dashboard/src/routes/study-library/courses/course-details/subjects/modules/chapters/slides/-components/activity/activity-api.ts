import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

const ROOT = `${BASE_URL}/admin-core-service/slide-activity/admin/v1`;

export interface ActivityBatch {
    packageSessionId: string;
    name: string | null;
}

export interface PollResults {
    options: { id: string; text: string }[];
    counts: Record<string, number>;
    totalVotes: number;
    batches: ActivityBatch[];
}

export interface GameScoreRow {
    userId: string;
    name: string | null;
    bestScore: number | null;
    lastScore: number | null;
    maxScore: number | null;
    attempts: number;
    updatedAt: string | null;
}

export interface GameResults {
    rows: GameScoreRow[];
    maxScore: number | null;
    batches: ActivityBatch[];
}

export async function fetchPollResults(
    slideId: string,
    packageSessionId?: string
): Promise<PollResults> {
    const { data } = await authenticatedAxiosInstance.get<PollResults>(`${ROOT}/poll/results`, {
        params: {
            slideId,
            instituteId: getCurrentInstituteId(),
            packageSessionId: packageSessionId || undefined,
        },
    });
    return data;
}

export async function fetchGameScores(
    slideId: string,
    packageSessionId?: string
): Promise<GameResults> {
    const { data } = await authenticatedAxiosInstance.get<GameResults>(`${ROOT}/game/scores`, {
        params: {
            slideId,
            instituteId: getCurrentInstituteId(),
            packageSessionId: packageSessionId || undefined,
        },
    });
    return data;
}

// ── "Count as engagement" ────────────────────────────────────────────────────

/** A course slide's engagement setting (SlideEngagementService.AdminView). */
export interface SlideEngagementSetting {
    slideId: string;
    /** The slide's type can be an engagement at all. */
    eligible: boolean;
    enabled: boolean;
    points: number;
    /** Learners in this institute who have earned these points. */
    earnedCount: number;
    /** Badges & Rewards is on; off means nobody earns points anywhere. */
    gamificationOn: boolean;
}

export async function fetchSlideEngagement(slideId: string): Promise<SlideEngagementSetting> {
    const { data } = await authenticatedAxiosInstance.get<SlideEngagementSetting>(`${ROOT}/engagement`, {
        params: { slideId, instituteId: getCurrentInstituteId() },
    });
    return data;
}

export async function saveSlideEngagement(
    slideId: string,
    change: { enabled?: boolean; points?: number }
): Promise<SlideEngagementSetting> {
    const { data } = await authenticatedAxiosInstance.put<SlideEngagementSetting>(
        `${ROOT}/engagement`,
        { slideId, ...change },
        { params: { instituteId: getCurrentInstituteId() } }
    );
    return data;
}
