/**
 * Pure helpers for the Social accounts & posts screen: month windows, status tones,
 * per-network text limits and the client-side mirror of the server's post validation
 * (§4.3), so the composer can explain a problem before the request is sent.
 */
import type { PillTone } from '@/components/shared/crm-enhance/screen-header';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import type {
    SocialAccount,
    SocialMediaType,
    SocialPlatform,
    SocialPost,
    SocialPostStatus,
} from '../../-marketing/types';

// ── Roles ────────────────────────────────────────────────────────────────────

/** Institute admins can connect accounts, approve, schedule and post now. */
export function isCurrentUserAdmin(): boolean {
    return getRolesForCurrentInstitute().includes('ADMIN');
}

// ── Months (yyyy-MM, local time) ────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

export function toMonthKey(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** First day of a yyyy-MM month (local); falls back to the current month. */
export function parseMonthKey(month: string | undefined): Date {
    if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [y, m] = month.split('-').map(Number);
        if (y && m && m >= 1 && m <= 12) return new Date(y, m - 1, 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function shiftMonth(month: Date, delta: number): Date {
    return new Date(month.getFullYear(), month.getMonth() + delta, 1);
}

/** yyyy-MM-dd for a local date. */
export function toDayKey(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Inclusive yyyy-MM-dd window covering the whole month. */
export function monthWindow(month: Date): { from: string; to: string } {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    return { from: toDayKey(first), to: toDayKey(last) };
}

/** HH:mm for a local date. */
export function toTimeKey(date: Date): string {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local yyyy-MM-dd + HH:mm → ISO instant; null when either part is missing/invalid. */
export function localToIso(day: string, time: string): string | null {
    if (!day || !time) return null;
    const date = new Date(`${day}T${time}:00`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The date a post sits on in the calendar: its schedule, else when it was created. */
export function postDate(post: SocialPost): Date {
    return new Date(post.scheduled_at ?? post.created_at);
}

export function sortPostsByDate(posts: SocialPost[]): SocialPost[] {
    return [...posts].sort((a, b) => postDate(a).getTime() - postDate(b).getTime());
}

// ── Statuses ─────────────────────────────────────────────────────────────────

export const STATUS_TONE: Record<SocialPostStatus, PillTone> = {
    DRAFT: 'neutral',
    NEEDS_APPROVAL: 'warning',
    SCHEDULED: 'success',
    PUBLISHING: 'primary',
    POSTED: 'info',
    PARTIAL: 'danger',
    FAILED: 'danger',
    CANCELLED: 'neutral',
};

/** Calendar filter chips; each maps to one or more post statuses. */
export const STATUS_FILTERS = [
    'ALL',
    'NEEDS_APPROVAL',
    'SCHEDULED',
    'DRAFT',
    'POSTED',
    'FAILED',
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

const FILTER_STATUSES: Record<Exclude<StatusFilter, 'ALL'>, SocialPostStatus[]> = {
    NEEDS_APPROVAL: ['NEEDS_APPROVAL'],
    SCHEDULED: ['SCHEDULED', 'PUBLISHING'],
    DRAFT: ['DRAFT'],
    POSTED: ['POSTED'],
    FAILED: ['FAILED', 'PARTIAL'],
};

export function toStatusFilter(value: string | undefined): StatusFilter {
    return (STATUS_FILTERS as readonly string[]).includes(value ?? '')
        ? (value as StatusFilter)
        : 'ALL';
}

export function matchesFilter(post: SocialPost, filter: StatusFilter): boolean {
    if (filter === 'ALL') return true;
    return FILTER_STATUSES[filter].includes(post.status);
}

/** Statuses the server lets a post be edited from (PUT /posts/{id}). */
export const EDITABLE: ReadonlySet<SocialPostStatus> = new Set([
    'DRAFT',
    'NEEDS_APPROVAL',
    'SCHEDULED',
    'FAILED',
]);

/** Statuses a non-admin author may delete their own post in (DELETABLE_BY_AUTHOR). */
export const AUTHOR_DELETABLE: ReadonlySet<SocialPostStatus> = new Set([
    'DRAFT',
    'NEEDS_APPROVAL',
    'CANCELLED',
    'FAILED',
]);

/** The first error worth showing for a failed / partial post. */
export function postError(post: SocialPost): string | null {
    if (post.last_error) return post.last_error;
    return post.targets.find((target) => target.error_message)?.error_message ?? null;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

/** True when the account can be posted to right now. */
export function isAccountUsable(account: SocialAccount): boolean {
    return (
        account.status === 'ACTIVE' &&
        account.connection_status !== 'RECONNECT_NEEDED' &&
        account.connection_status !== 'REVOKED'
    );
}

// ── Composer limits + validation ─────────────────────────────────────────────

/** Text limits per network (server enforces Instagram and Google Business). */
export const TEXT_LIMIT: Record<SocialPlatform, number> = {
    FACEBOOK: 63206,
    INSTAGRAM: 2200,
    GOOGLE_BUSINESS: 1500,
    YOUTUBE: 5000,
};

export const MAX_MEDIA = 10;
/** Instagram's own ceiling for a photo; larger images fail at publish time. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const YOUTUBE_TITLE_LIMIT = 100;

export interface ComposerMedia {
    /** Stable key for React (file id once uploaded, a local id while uploading). */
    key: string;
    file_id: string | null;
    type: SocialMediaType;
    name: string;
    /** Object URL for a fresh upload, or the server preview URL for saved media. */
    previewUrl: string | null;
    /** True for an object URL this screen created (and must revoke). */
    localPreview: boolean;
    uploading: boolean;
    failed: boolean;
}

export interface ComposerSnapshot {
    title: string;
    body: string;
    linkUrl: string;
    media: ComposerMedia[];
    platforms: SocialPlatform[];
    accountCount: number;
    overridesOn: boolean;
    overrides: Partial<Record<SocialPlatform, string>>;
}

/** The text a network will receive: its override when tailored and non-blank, else the body. */
export function effectiveText(snapshot: ComposerSnapshot, platform: SocialPlatform): string {
    const override = snapshot.overridesOn ? snapshot.overrides[platform] : undefined;
    return override && override.trim() ? override : snapshot.body;
}

/** Characters as a person counts them (an emoji is one), like the server's length(). */
export const charCount = (value: string): number => [...value].length;

/** `text + "\n\n" + link` when both are present (SocialPostRules.withLink). */
export function withLink(text: string, link: string): string {
    const t = text.trim();
    const l = link.trim();
    if (!l) return t;
    if (!t) return l;
    return `${t}\n\n${l}`;
}

/** Instagram captions and YouTube descriptions carry the link as text. */
const LINK_IN_TEXT: ReadonlySet<SocialPlatform> = new Set(['INSTAGRAM', 'YOUTUBE']);

/**
 * What the server measures against TEXT_LIMIT for a network: the trimmed text, plus the
 * link on Instagram and YouTube.
 */
export function measuredText(snapshot: ComposerSnapshot, platform: SocialPlatform): string {
    const text = effectiveText(snapshot, platform).trim();
    return LINK_IN_TEXT.has(platform) ? withLink(text, snapshot.linkUrl) : text;
}

export const INSTAGRAM_HASHTAGS_MAX = 30;
const HASHTAG = /(?<![\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu;

export function countHashtags(value: string): number {
    return value.match(HASHTAG)?.length ?? 0;
}

/** YouTube title as the server builds it: the title, else the start of the text, minus < >. */
function youtubeTitle(title: string, text: string): string {
    const source = title.trim() || [...text.trim().replace(/\s+/g, ' ')].slice(0, 90).join('');
    return source.replace(/[<>]/g, '').trim();
}

/** One validation problem: an i18n key under `composer.issues.*` plus its values. */
export interface ComposerIssue {
    key: string;
    values?: Record<string, string | number>;
}

export function isValidUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Mirrors the server's rules for a post that will be published. `platformName` is a
 * key-safe platform id; the UI resolves names when it renders the issue.
 */
export function validateForPublish(snapshot: ComposerSnapshot): ComposerIssue[] {
    const issues: ComposerIssue[] = [];
    const { platforms, media } = snapshot;
    const ready = media.filter((m) => m.file_id && !m.uploading && !m.failed);
    const videos = ready.filter((m) => m.type === 'VIDEO').length;
    const images = ready.filter((m) => m.type === 'IMAGE').length;

    if (snapshot.accountCount === 0) issues.push({ key: 'noAccount' });
    if (media.some((m) => m.uploading)) issues.push({ key: 'uploading' });
    if (media.some((m) => m.failed)) issues.push({ key: 'uploadFailed' });
    if (ready.length > MAX_MEDIA) issues.push({ key: 'tooManyMedia', values: { max: MAX_MEDIA } });
    if (videos > 0 && images > 0) issues.push({ key: 'mixedMedia' });
    if (videos > 1) issues.push({ key: 'oneVideo' });
    if (snapshot.linkUrl.trim() && !isValidUrl(snapshot.linkUrl.trim()))
        issues.push({ key: 'badLink' });

    for (const platform of platforms) {
        const text = effectiveText(snapshot, platform).trim();
        const measured = measuredText(snapshot, platform);
        if (charCount(measured) > TEXT_LIMIT[platform]) {
            issues.push({
                key:
                    LINK_IN_TEXT.has(platform) && snapshot.linkUrl.trim()
                        ? 'tooLongWithLink'
                        : 'tooLong',
                values: { platform, max: String(TEXT_LIMIT[platform]) },
            });
        }
        if (platform === 'INSTAGRAM' && ready.length === 0) issues.push({ key: 'instagramMedia' });
        if (platform === 'INSTAGRAM' && countHashtags(measured) > INSTAGRAM_HASHTAGS_MAX)
            issues.push({ key: 'tooManyHashtags', values: { max: INSTAGRAM_HASHTAGS_MAX } });
        if (platform === 'YOUTUBE' && (videos !== 1 || images > 0))
            issues.push({ key: 'youtubeVideo' });
        if (platform === 'GOOGLE_BUSINESS' && videos > 0) issues.push({ key: 'googleNoVideo' });
        // Facebook takes text, a link or media; Google Business always needs text.
        if (platform === 'FACEBOOK' && !text && !snapshot.linkUrl.trim() && ready.length === 0)
            issues.push({ key: 'needsText', values: { platform } });
        if (platform === 'GOOGLE_BUSINESS' && !text) issues.push({ key: 'googleNeedsText' });
        if (platform === 'YOUTUBE' && !youtubeTitle(snapshot.title, text))
            issues.push({ key: 'youtubeTitle' });
    }
    if (snapshot.title.length > 255) issues.push({ key: 'titleTooLong' });
    return issues;
}

/** A draft only needs somewhere to go and something in it. */
export function validateForDraft(snapshot: ComposerSnapshot): ComposerIssue[] {
    const issues: ComposerIssue[] = [];
    if (snapshot.accountCount === 0) issues.push({ key: 'noAccount' });
    if (!snapshot.title.trim() && !snapshot.body.trim() && snapshot.media.length === 0)
        issues.push({ key: 'empty' });
    if (snapshot.media.some((m) => m.uploading)) issues.push({ key: 'uploading' });
    if (snapshot.title.length > 255) issues.push({ key: 'titleTooLong' });
    return issues;
}
