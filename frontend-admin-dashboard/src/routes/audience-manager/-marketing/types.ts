/**
 * Types for the marketing screens (Ad performance + Social posts). They mirror the
 * admin_core_service DTOs under /admin-core-service/v1/marketing/* field for field;
 * the backend serialises snake_case, so these do too.
 */

// ── Shared enums ────────────────────────────────────────────────────────────

/** One OAuth grant kind. META_SOCIAL covers Facebook Pages and their linked Instagram. */
export type MarketingProvider = 'META_ADS' | 'META_SOCIAL' | 'GOOGLE_ADS' | 'GOOGLE_BUSINESS';

/** Report platform keys. YOUTUBE = Google campaigns of channel VIDEO. */
export type AdPlatform = 'META' | 'GOOGLE' | 'YOUTUBE';

/** Where an ad account lives (an account is never YOUTUBE; that is a report slice). */
export type AdAccountPlatform = 'META' | 'GOOGLE';

export type SocialPlatform = 'FACEBOOK' | 'INSTAGRAM' | 'GOOGLE_BUSINESS' | 'YOUTUBE';

/** Every platform PlatformIcon / platformLabel know how to draw. */
export type MarketingPlatform = AdPlatform | SocialPlatform;

export type MarketingConnectionStatus = 'ACTIVE' | 'RECONNECT_NEEDED' | 'REVOKED';
export type AdAccountStatus = 'ACTIVE' | 'ERROR' | 'DISCONNECTED';
export type AdSyncStatus = 'OK' | 'FAILED';
export type SocialAccountStatus = 'ACTIVE' | 'RECONNECT_NEEDED' | 'DISCONNECTED';

export type SocialPostStatus =
    | 'DRAFT'
    | 'NEEDS_APPROVAL'
    | 'SCHEDULED'
    | 'PUBLISHING'
    | 'POSTED'
    | 'PARTIAL'
    | 'FAILED'
    | 'CANCELLED';

export type SocialPostTargetStatus = 'PENDING' | 'PUBLISHING' | 'POSTED' | 'FAILED' | 'SKIPPED';
export type SocialPostSource = 'MANUAL' | 'AGENT';
export type SocialPostAction = 'DRAFT' | 'SUBMIT' | 'SCHEDULE' | 'POST_NOW';
export type SocialMediaType = 'IMAGE' | 'VIDEO';

// ── OAuth + account selection (§4.1) ────────────────────────────────────────

export interface InitiateOAuthResponse {
    oauth_url: string;
    session_key: string;
}

export type ConnectOptionKind = 'AD_ACCOUNT' | 'FACEBOOK_PAGE' | 'INSTAGRAM' | 'GBP_LOCATION';

export interface ConnectOption {
    external_id: string;
    name: string | null;
    subtitle: string | null;
    kind: ConnectOptionKind | string;
    currency: string | null;
    time_zone: string | null;
    login_customer_id: string | null;
    already_connected: boolean;
    selectable: boolean;
    warning: string | null;
}

export interface ConnectOptionsResponse {
    provider: MarketingProvider;
    connection_id: string;
    account_name: string | null;
    options: ConnectOption[];
}

export interface SelectConnectOptionsResponse {
    created: number;
    ad_accounts: AdAccount[];
    social_accounts: SocialAccount[];
}

// ── Ads (§4.2) ──────────────────────────────────────────────────────────────

export interface AdAccount {
    id: string;
    platform: AdAccountPlatform;
    external_account_id: string;
    name: string | null;
    currency: string | null;
    time_zone: string | null;
    status: AdAccountStatus;
    status_detail: string | null;
    last_synced_at: string | null;
    last_sync_status: AdSyncStatus | null;
    connection_status: MarketingConnectionStatus | null;
    synced_from: string | null;
}

export interface SyncAllResponse {
    queued: number;
}

export interface AdPerformanceTotals {
    spend: number;
    clicks: number;
    impressions: number;
    enquiries: number;
    admissions: number;
    cost_per_enquiry: number | null;
    cost_per_admission: number | null;
}

export interface AdPerformancePlatform extends AdPerformanceTotals {
    platform: AdPlatform;
    /** Leads the ad platform itself reports (Meta lead actions / Google conversions). */
    platform_leads: number;
    /** Ad accounts that contributed spend to this platform row. */
    accounts: number;
}

export interface AdPerformanceDaily {
    /** yyyy-MM-dd */
    day: string;
    platform: AdPlatform;
    spend: number;
    enquiries: number;
    admissions: number;
}

export interface AdPerformanceCampaign {
    platform: AdPlatform;
    /** null = "Other / not matched" row for that platform. */
    campaign_id: string | null;
    campaign_name: string | null;
    /** META, or the Google advertising_channel_type (SEARCH, PERFORMANCE_MAX, VIDEO, …). */
    channel: string | null;
    spend: number;
    clicks: number;
    impressions: number;
    enquiries: number;
    admissions: number;
    cost_per_enquiry: number | null;
    cost_per_admission: number | null;
}

export interface AdPerformanceUnattributed {
    enquiries: number;
    admissions: number;
}

/** Advice only — the product never moves budget itself. */
export interface AdPerformanceSuggestion {
    best_platform: AdPlatform;
    best_cost_per_admission: number;
    worst_platform: AdPlatform;
    worst_cost_per_admission: number | null;
    suggested_amount: number;
}

export interface AdPerformance {
    /** yyyy-MM-dd, inclusive */
    from: string;
    /** yyyy-MM-dd, inclusive */
    to: string;
    currency: string | null;
    mixed_currency: boolean;
    totals: AdPerformanceTotals;
    platforms: AdPerformancePlatform[];
    daily: AdPerformanceDaily[];
    campaigns: AdPerformanceCampaign[];
    unattributed: AdPerformanceUnattributed;
    suggestion: AdPerformanceSuggestion | null;
    accounts: AdAccount[];
    last_synced_at: string | null;
}

// ── Social (§4.3) ───────────────────────────────────────────────────────────

export interface SocialAccount {
    id: string;
    platform: SocialPlatform;
    external_id: string;
    name: string | null;
    handle: string | null;
    avatar_url: string | null;
    followers_count: number | null;
    status: SocialAccountStatus;
    status_detail: string | null;
    connection_status: MarketingConnectionStatus | null;
}

export interface SocialPostMedia {
    file_id: string;
    type: SocialMediaType;
    name: string | null;
    /** Public preview URL resolved by the server; null when it could not be resolved. */
    url: string | null;
}

/** Media as sent in a create/update request (the server resolves URLs itself). */
export type SocialPostMediaInput = Omit<SocialPostMedia, 'url'>;

/** Per-network text that replaces `body` for that platform. */
export type SocialPostOverrides = Partial<Record<SocialPlatform, string>>;

export interface SocialPostTarget {
    id: string;
    social_account_id: string;
    platform: SocialPlatform;
    account_name: string | null;
    status: SocialPostTargetStatus;
    permalink: string | null;
    error_message: string | null;
    posted_at: string | null;
}

export interface SocialPost {
    id: string;
    title: string | null;
    body: string | null;
    link_url: string | null;
    media: SocialPostMedia[];
    overrides: SocialPostOverrides;
    /** ISO instant, null for an unscheduled draft. */
    scheduled_at: string | null;
    status: SocialPostStatus;
    source: SocialPostSource;
    created_by_user_id: string | null;
    approved_by_user_id: string | null;
    approved_at: string | null;
    last_error: string | null;
    published_at: string | null;
    created_at: string;
    targets: SocialPostTarget[];
}

export interface SocialPostRequest {
    title: string | null;
    body: string | null;
    link_url: string | null;
    media: SocialPostMediaInput[];
    overrides: SocialPostOverrides;
    account_ids: string[];
    /** ISO instant or null. Required for SCHEDULE. */
    scheduled_at: string | null;
    action: SocialPostAction;
    source?: SocialPostSource;
}

export interface ListSocialPostsParams {
    /** yyyy-MM-dd; server default today − 7. */
    from?: string;
    /** yyyy-MM-dd; server default today + 60. */
    to?: string;
    status?: SocialPostStatus | string;
}

export interface AiDraftRequest {
    brief: string;
    platforms: SocialPlatform[];
    tone?: string;
    language?: string;
}

export interface AiDraftResponse {
    title: string | null;
    body: string | null;
    overrides: SocialPostOverrides;
}
