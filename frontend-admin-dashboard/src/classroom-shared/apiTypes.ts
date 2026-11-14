/**
 * Wire types for the Vacademy Classroom APIs, shared by the panel bundle
 * (src/panel), the phone page (src/classroom-phone) and the admin console.
 *
 * Everything here is `snake_case` exactly as it travels. The file has types and
 * small constants only, so importing it adds nothing a Chrome 66 build cares
 * about.
 *
 * Errors from every auth_service panel endpoint are `{ code, message, ... }`
 * (see PanelApiError). Clients switch on `code`, never on the message.
 */

// ---------------------------------------------------------------- paths ---

/** auth_service, no Bearer. The panel sends device credentials in the body. */
export const PANEL_PUBLIC_BASE = '/auth-service/public/v1/panel';
/** auth_service, Bearer with no `clientId` header. */
export const PANEL_BEARER_BASE = '/auth-service/v1/panel';
export const CLASSROOM_TODAY_PATH = '/admin-core-service/classroom/v1/today';
/** auth_service, Bearer, platform staff only (phase 2). No UI in this repo calls it yet. */
export const PANEL_SUPER_ADMIN_BASE = '/auth-service/super-admin/v1/panel';
export const VOLT_ADMIN_BASE = '/community-service/engage/admin';
export const PROVIDER_MEETING_BASE = '/admin-core-service/live-sessions/provider/meeting';

// --------------------------------------------------------------- errors ---

export type PanelErrorCode =
    /** 401 on any device-authenticated call. The only code that means "unpaired". */
    | 'DEVICE_REVOKED'
    /** 429 or 503 under load, with retry_after_ms. Treated like a network failure. */
    | 'BUSY'
    /** 429 from a per-minute limit, with retry_after_ms. Treated like BUSY. */
    | 'RATE_LIMITED'
    | 'PANEL_DISABLED'
    | 'SESSION_ENDED'
    | 'APPROVED_PENDING'
    | 'DEVICE_NOT_ACTIVE'
    | 'BAD_CREDENTIALS'
    | 'NOT_STAFF'
    | 'PASSWORD_DISABLED'
    | 'NOT_FOUND'
    | 'WRONG_NUMBER'
    | 'ROOM_OCCUPIED'
    | 'ROOM_OTHER_INSTITUTE'
    | 'ROOM_NAME_TAKEN'
    | 'ROOM_HAS_DEVICE'
    | 'TRY_AGAIN'
    | 'EXPIRED'
    | 'OTHER_USER'
    | 'FORBIDDEN'
    | 'UNAUTHORIZED'
    | 'BAD_REQUEST'
    | 'ERROR'
    // Phase 2. The first three reach a panel only when its app_version_code is at least
    // PANEL_FIRST_PHASE2_VERSION_CODE; older panels get PANEL_DISABLED instead.
    /** 403 at sign-in: this room has no seat while enforcement is LIVE. */
    | 'LICENCE_REQUIRED'
    /** 403 at sign-in: an installer set this panel up and the school has not approved it yet. */
    | 'AWAITING_APPROVAL'
    /** 403 at sign-in: this app build is below the required version. */
    | 'UPDATE_REQUIRED'
    /** 404 from a Bearer endpoint whose feature is switched off. The console hides that tab. */
    | 'FEATURE_OFF'
    /** 403 from /partner/**: the account holds no installer role at an active installer org. */
    | 'NOT_INSTALLER'
    /** 404 from /partner/links/redeem: unknown, used, cancelled or expired code. */
    | 'INVITE_INVALID'
    /** 409 from /admin/licence/rooms/{id}/assign: every granted seat is taken. */
    | 'NO_SEAT';

/** The first panel app build that understands LICENCE_REQUIRED, AWAITING_APPROVAL and UPDATE_REQUIRED. */
export const PANEL_FIRST_PHASE2_VERSION_CODE = 3;

export interface PanelApiError {
    code: PanelErrorCode;
    message?: string;
    /** BUSY and RATE_LIMITED. */
    retry_after_ms?: number;
    /** SESSION_ENDED from /session/refresh. */
    reason?: PanelSessionEndReason | null;
    /** APPROVED_PENDING: keep polling this challenge. */
    challenge_id?: string;
    /** ROOM_OCCUPIED. */
    current_device?: PanelRoomCurrentDevice;
    /** NOT_STAFF from /challenge/describe. */
    institute_name?: string;
}

export function isPanelApiError(body: unknown): body is PanelApiError {
    return (
        !!body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
    );
}

// --------------------------------------------------------- shared shapes ---

export interface PanelRoomRef {
    id: string;
    name: string;
}

export interface PanelRoomCurrentDevice {
    id: string;
    model: string | null;
    last_seen_at: string | null;
}

export type PanelSessionEndReason =
    | 'SIGN_OUT'
    | 'IDLE'
    | 'CLASS_END'
    | 'ADMIN'
    | 'PHONE'
    | 'REPLACED'
    | 'SUPERSEDED'
    | 'UNBOUND'
    | 'EXPIRED'
    | 'ACCESS_REMOVED'
    | 'DEAD_MAN';

export type PanelDeviceStatus = 'CLAIMED' | 'ACTIVE' | 'REVOKED';
/** Phase 2. Every phase 1 panel is APPROVED; installer set-ups start PENDING. */
export type PanelApprovalState = 'APPROVED' | 'PENDING' | 'REJECTED';
/** Phase 2. Which build the panel runs. Null or absent counts as DIRECT on the server. */
export type PanelAppChannel = 'PLAY' | 'DIRECT' | 'DEV';
export type PanelSessionStatus = 'ACTIVE' | 'ENDED';
export type PanelChallengePurpose = 'SIGN_IN' | 'ATTACH_REMOTE';
export type PanelStartedVia = 'QR' | 'PASSWORD';

/** The panel's slide position. `index` is 0-based; the phone shows index + 1. */
export interface PanelNavState {
    index: number;
    total: number;
    title: string;
}

export interface PanelDeviceCredentials {
    device_id: string;
    device_secret: string;
}

// ------------------------------------- 7.1 public, device-authenticated ---

/** Values are self-reported by the panel; the UI labels them that way. */
export interface PanelReportedDevice {
    manufacturer?: string;
    model?: string;
    sdk_int?: number;
    webview_major?: number;
    app_version_code?: number;
}

export interface PairStartRequest {
    install_id: string;
    device: PanelReportedDevice;
}

export interface PairStartResponse {
    pair_secret: string;
    /** 8 Crockford characters with no separator. The panel displays it as K7QF-2M9X. */
    code: string;
    match_code: number;
    /** <default-base-url>/classroom#pair=<code> */
    qr_url: string;
    expires_in_s: number;
    poll_after_ms: number;
}

export interface PairPollRequest {
    pair_secret: string;
}

export type PairPollResponse =
    | { state: 'PENDING' | 'EXPIRED' | 'CANCELLED'; poll_after_ms: number }
    | {
          state: 'CLAIMED';
          device_id: string;
          device_secret: string;
          institute_id: string;
          institute_name: string | null;
          theme_code: string | null;
          room: PanelRoomRef;
          claimed_by_name: string | null;
          /** Phase 2: the installer organisation's name when an installer set this panel up. */
          installed_by?: string | null;
          poll_after_ms: number;
      };

export interface PairConfirmRequest extends PanelDeviceCredentials {
    accept: boolean;
}

export interface PairConfirmResponse {
    status: 'ACTIVE' | 'CANCELLED';
}

export interface PanelSyncRequest extends PanelDeviceCredentials {
    session_id?: string | null;
    session_token?: string | null;
    app_version_code?: number | null;
    webview_major?: number | null;
    presenting: boolean;
    /** A native meeting screen is open; the server then polls every 10 s. */
    in_meeting?: boolean;
    /** Sent while presenting. Stored only when it differs from the last value. */
    state?: PanelNavState | null;
    /**
     * Phase 2: queued "what was shown" events of the current session, at most 20 per request.
     * Acked through activity_acked_seq. Sent only with a session.
     */
    activity?: PanelActivityEvent[];
    /** Phase 2: the build's channel. Phase 1 panels omit it. */
    app_channel?: PanelAppChannel | null;
}

/** Phase 2. HOME closes the previous event and is never listed in reports. */
export type PanelActivityKind = 'LESSON' | 'DECK' | 'DECK_LIVE' | 'CLASS' | 'WHITEBOARD' | 'HOME';

export interface PanelActivityEvent {
    /** Per session, only grows. The server's ack is the largest seq it received. */
    seq: number;
    kind: PanelActivityKind;
    /** Slide id, presentation id or schedule id. At most 64 characters. */
    ref_id?: string | null;
    /** Chapter id, package session id or live session id. At most 64 characters. */
    parent_id?: string | null;
    /** Cut to 200 characters by the server. */
    title?: string | null;
    /** getServerNow() when it was shown. Clamped by the server to the session. */
    at_ms: number;
}

export interface PanelSyncDevice {
    status: PanelDeviceStatus;
    room_name: string | null;
    institute_id: string;
    institute_name: string | null;
    theme_code: string | null;
    /** Scheme and host, never a trailing slash. */
    approve_base_url: string;
    password_login_allowed: boolean;
    /** Phase 2. Absent from a phase 1 server. */
    approval_state?: PanelApprovalState;
}

/** Phase 2. A room's seat as a panel sees it. */
export type PanelRoomLicenceState =
    | 'LICENSED'
    | 'GRACE'
    | 'OVER_LIMIT'
    | 'UNLICENSED'
    | 'EXPIRED'
    | 'UNMANAGED';

/** Phase 2. Only on a signed-out sync, only while the licence feature is on. */
export interface PanelSyncLicence {
    state: PanelRoomLicenceState;
    /** False under SHADOW and OFF: show nothing that blocks. */
    enforced: boolean;
    ends_at: string | null;
    grace_ends_at: string | null;
}

/** Phase 2. Only on a signed-out sync of a direct-channel panel with a newer build offered. */
export interface PanelSyncUpdate {
    version_code: number;
    version_name: string;
    apk_url: string | null;
    sha256: string | null;
    size_bytes: number | null;
    /** True when this build is the minimum: sign-in is refused below it. */
    required: boolean;
}

export interface PanelSyncSession {
    status: PanelSessionStatus;
    end_reason?: PanelSessionEndReason | null;
    expires_in_s: number;
    nav_counter: number;
    /** Server now minus the last press. Null when the phone has never pressed. */
    nav_age_ms: number | null;
    phone_connected: boolean;
}

export interface PanelFlags {
    volt_live_enabled: boolean;
    bbb_in_app_min_webview: number;
}

export interface PanelPolicy {
    idle_minutes: number;
    session_hours: number;
}

export interface PanelSyncResponse {
    server_time_ms: number;
    device: PanelSyncDevice;
    session?: PanelSyncSession | null;
    flags: PanelFlags;
    policy: PanelPolicy;
    next_poll_ms: number;
    /** Phase 2: the version below which sign-in is refused (UPDATE_REQUIRED). */
    min_app_version_code: number;
    /** Phase 2, signed out only. */
    licence?: PanelSyncLicence;
    /** Phase 2, signed out only. */
    update?: PanelSyncUpdate;
    /** Phase 2: present only when the request carried activity and the server stored it. */
    activity_acked_seq?: number;
}

export interface ChallengeRequest extends PanelDeviceCredentials {
    purpose: PanelChallengePurpose;
    /** Required for ATTACH_REMOTE. */
    session_token?: string | null;
}

/** 409 from /challenge when an approved challenge is waiting to be redeemed. */
export interface ChallengeApprovedPendingError extends PanelApiError {
    code: 'APPROVED_PENDING';
    challenge_id: string;
}

export interface ChallengeResponse {
    challenge_id: string;
    /** <approve_base_url>/classroom#c=<22-char token> */
    qr_url: string;
    /** 8 characters, for the code-entry fallback. */
    user_code: string;
    /** Only shown on the panel after a scan, so a photo of the QR does not carry it. */
    match_code: number;
    expires_in_s: number;
    poll_after_ms: number;
}

export interface ChallengePollRequest extends PanelDeviceCredentials {
    challenge_id: string;
}

export interface PanelUserRef {
    id: string;
    name: string;
}

/** Tokens returned once to the panel. Same body for /session/login-password. */
export interface PanelRedeemedSession {
    access_token: string;
    session_token: string;
    session_id: string;
    expires_in_s: number;
    session_expires_in_s: number;
    user: PanelUserRef;
    institute_id: string;
    server_time_ms: number;
}

export type ChallengePollResponse =
    | { state: 'PENDING' | 'EXPIRED' | 'DEAD'; poll_after_ms: number }
    | { state: 'SCANNED'; scanned_by_name: string | null; poll_after_ms: number }
    | { state: 'ATTACHED' }
    | ({ state: 'REDEEMED' } & PanelRedeemedSession);

export type PanelChallengeState =
    | 'PENDING'
    | 'SCANNED'
    | 'APPROVED'
    | 'REDEEMED'
    | 'DEAD'
    | 'EXPIRED';

export interface ChallengeInfoRequest {
    t: string;
}

/** Public by design: no room, no number, nothing about any user. */
export interface ChallengeInfoResponse {
    state: PanelChallengeState;
    institute_id: string;
    institute_name: string | null;
    theme_code: string | null;
    expires_in_s: number;
}

export interface SessionRefreshRequest extends PanelDeviceCredentials {
    session_token: string;
}

export interface SessionRefreshResponse {
    access_token: string;
    expires_in_s: number;
    session_expires_in_s: number;
    server_time_ms: number;
}

/** 401 from /session/refresh. The only refresh failure that signs a panel out. */
export interface SessionEndedError extends PanelApiError {
    code: 'SESSION_ENDED';
    reason: PanelSessionEndReason | null;
}

export type PanelClientEndReason = 'SIGN_OUT' | 'IDLE' | 'CLASS_END';

export interface SessionEndRequest extends PanelDeviceCredentials {
    session_token?: string | null;
    reason: PanelClientEndReason;
    /** Phase 2: the session's last queued events, stored before it ends. */
    activity?: PanelActivityEvent[];
}

export interface EndedResponse {
    ended: true;
}

export interface SessionLoginPasswordRequest extends PanelDeviceCredentials {
    username: string;
    password: string;
}

export type SessionLoginPasswordResponse = PanelRedeemedSession;

export interface RemoteNavRequest {
    remote_token: string;
    delta: 1 | -1;
    /** max(lastSeq + 1, Date.now()). A retry reuses the same value. */
    client_seq: number;
}

export interface RemoteNavResponse {
    accepted: boolean;
    /** A retry of a press the server already counted. Treat as delivered. */
    duplicate?: true;
    status: PanelSessionStatus;
}

export interface RemoteTokenRequest {
    remote_token: string;
}

export interface RemoteStateResponse {
    status: PanelSessionStatus;
    institute_id: string | null;
    room_name: string | null;
    /** Null index means the panel has no remote target on this screen. */
    index: number | null;
    total: number | null;
    title: string | null;
    panel_online: boolean;
    session_expires_in_s: number;
}

// ------------------------------------------------------------ 7.2 Bearer ---

export interface PairPreviewRequest {
    code: string;
}

export interface PairPreviewResponse {
    model: string | null;
    manufacturer: string | null;
    webview_major: number | null;
    match_options: number[];
    expires_in_s: number;
}

export interface AdminInstituteRow {
    institute_id: string;
}

export interface DeviceClaimRequest {
    code: string;
    match_code: number;
    institute_id: string;
    room_id?: string;
    new_room_name?: string;
    replace_existing: boolean;
}

export interface DeviceClaimResponse {
    device_id: string;
    status: 'CLAIMED';
    room: PanelRoomRef;
}

export type ClassroomRoomStatus = 'ACTIVE' | 'ARCHIVED';

export interface ClassroomRoom {
    id: string;
    name: string;
    status: ClassroomRoomStatus;
    device_id?: string | null;
}

export interface RoomListResponse {
    rooms: ClassroomRoom[];
    next_unpaired_room_id: string | null;
}

export interface RoomCreateRequest {
    institute_id: string;
    name: string;
}

export interface RoomBulkCreateRequest {
    institute_id: string;
    /** Cap 200. */
    names: string[];
}

export interface RoomBulkCreateResponse {
    created: ClassroomRoom[];
    skipped_duplicates: string[];
}

export interface RoomPatchRequest {
    name?: string;
    status?: ClassroomRoomStatus;
}

export interface PanelDeviceCurrentSession {
    id: string;
    user_id: string;
    user_name: string | null;
    started_via: PanelStartedVia;
    created_at: string;
    expires_in_s: number;
    approved_ip: string | null;
}

export interface PanelDeviceRow {
    id: string;
    room: PanelRoomRef;
    status: PanelDeviceStatus;
    /** Last seen under 7 minutes ago. */
    online: boolean;
    last_seen_at: string | null;
    last_ip: string | null;
    model: string | null;
    manufacturer: string | null;
    sdk_int: number | null;
    webview_major: number | null;
    app_version_code: number | null;
    password_login_allowed: boolean;
    claimed_by_name: string | null;
    claimed_at: string;
    current_session?: PanelDeviceCurrentSession | null;
    /** Phase 2. Absent from a phase 1 server; treat absent as APPROVED. */
    approval_state?: PanelApprovalState;
    app_channel?: PanelAppChannel | null;
    /** Phase 2: installer organisation name, when an installer set the panel up. */
    installed_by?: string | null;
    /** Phase 2: null while the institute's seats are unmanaged. */
    licence_state?: PanelRoomLicenceState | null;
}

export interface DevicePatchRequest {
    room_id?: string;
    password_login_allowed?: boolean;
}

export interface DeviceRevokeResponse {
    status: 'REVOKED';
}

/** Exactly one of `t` (QR token) or `user_code` (typed fallback). */
export type ChallengeHandle = { t: string; user_code?: never } | { user_code: string; t?: never };

export type ChallengeDescribeRequest = ChallengeHandle;

export interface ChallengeDescribeResponse {
    purpose: PanelChallengePurpose;
    institute_id: string;
    institute_name: string | null;
    room_name: string | null;
    match_options: number[];
    expires_in_s: number;
}

export type ChallengeApproveRequest = ChallengeHandle &
    ({ match_code: number; deny?: never } | { deny: true; match_code?: never });

export interface ChallengeApprovedResponse {
    session_id: string;
    remote_token: string;
    room_name: string | null;
    session_expires_in_s: number;
}

export interface ChallengeDeniedResponse {
    denied: true;
}

export type ChallengeApproveResponse = ChallengeApprovedResponse | ChallengeDeniedResponse;

export interface MySessionResponse {
    session_id: string;
    institute_id: string;
    room_name: string | null;
    session_expires_in_s: number;
}

// ======================================================= phase 2, Bearer ===
// Every endpoint below answers 404 FEATURE_OFF while its feature is off. Times are
// ISO-8601 instants; `from`, `to` and `date` are yyyy-MM-dd local dates.

// ------------------------------------------------ usage (/admin/usage*) ---

export interface PanelUsageQuery {
    institute_id: string;
    from: string;
    to: string;
    /** IANA zone; an unknown zone falls back to Asia/Kolkata. */
    tz: string;
}

export interface PanelUsageTotals {
    panel_hours: number;
    sessions: number;
    teachers: number;
    rooms_used: number;
    rooms_with_panel: number;
    idle_rooms: number;
    classes_started: number;
    /** Share of sessions with any recorded content. Null when there were no sessions. */
    coverage_pct: number | null;
}

export interface PanelUsageDay {
    date: string;
    panel_hours: number;
    sessions: number;
    rooms_used: number;
}

export interface PanelUsageRoom {
    room: PanelRoomRef;
    panel_hours: number;
    sessions: number;
    teachers: number;
    last_used_at: string | null;
    days_used: number;
}

/** ref_id, sessions and teachers are absent inside by_teacher[].top_content. */
export interface PanelUsageContent {
    kind: Exclude<PanelActivityKind, 'HOME'>;
    ref_id?: string | null;
    title: string | null;
    minutes: number;
    sessions?: number;
    teachers?: number;
}

export interface PanelUsageTeacher {
    user: PanelUserRef;
    panel_hours: number;
    sessions: number;
    rooms: number;
    days_active: number;
    top_content: PanelUsageContent[];
}

export interface PanelUsageIdleRoom {
    room: PanelRoomRef;
    device_id: string;
    last_used_at: string | null;
    online: boolean;
}

/** GET /admin/usage. content is the top 20, top_content the top 3. */
export interface PanelUsageResponse {
    institute_id: string;
    from: string;
    to: string;
    tz: string;
    generated_at: string;
    totals: PanelUsageTotals;
    by_day: PanelUsageDay[];
    by_room: PanelUsageRoom[];
    by_teacher: PanelUsageTeacher[];
    idle_rooms: PanelUsageIdleRoom[];
    content: PanelUsageContent[];
    /** content_recorded_from: first local date with recorded content; null when none. */
    notes: { content_recorded_from: string | null };
}

export interface PanelUsageSessionsQuery extends PanelUsageQuery {
    room_id?: string;
    user_id?: string;
    page?: number;
    /** At most 200. */
    size?: number;
}

export interface PanelUsageSessionEvent {
    kind: Exclude<PanelActivityKind, 'HOME'>;
    title: string | null;
    started_at: string;
    minutes: number;
}

export interface PanelUsageSessionRow {
    id: string;
    room: PanelRoomRef;
    user: PanelUserRef;
    started_at: string;
    /** The effective end, never the raw ended_at. */
    end_at: string;
    minutes: number;
    end_reason: PanelSessionEndReason | null;
    started_via: PanelStartedVia;
    events: PanelUsageSessionEvent[];
}

/** GET /admin/usage/sessions. Also the source of the CSV export. */
export interface PanelUsageSessionsResponse {
    sessions: PanelUsageSessionRow[];
    page: number;
    size: number;
    total: number;
}

/** GET /admin/usage/multi?institute_ids=a,b&from&to&tz: the caller must be ADMIN of every id (max 50). */
export interface PanelUsageMultiRow {
    institute_id: string;
    totals: PanelUsageTotals;
}
export type PanelUsageMultiResponse = PanelUsageMultiRow[];

// -------------------------------------------- seats (/admin/licence*) ---

export type PanelLicenceEnforcement = 'OFF' | 'SHADOW' | 'LIVE';
export type PanelInstituteLicenceState =
    | 'UNMANAGED'
    | 'ACTIVE'
    | 'TRIAL'
    | 'GRACE'
    | 'EXPIRED'
    | 'NONE';
export type PanelLicenceGrantKind = 'TRIAL' | 'PAID' | 'COMPLIMENTARY';

export interface PanelLicenceGrantView {
    kind: PanelLicenceGrantKind;
    seats: number;
    starts_at: string;
    ends_at: string;
    grace_days: number;
}

export interface PanelLicenceRoomRow {
    room: PanelRoomRef;
    licence_state: PanelRoomLicenceState;
    licensed_at: string | null;
    device_id: string | null;
}

/** GET /admin/licence?institute_id. */
export interface PanelLicenceResponse {
    state: PanelInstituteLicenceState;
    enforcement: PanelLicenceEnforcement;
    seats_granted: number;
    seats_used: number;
    ends_at: string | null;
    grace_ends_at: string | null;
    grants: PanelLicenceGrantView[];
    rooms: PanelLicenceRoomRow[];
}

/** POST /admin/licence/rooms/{room_id}/assign (409 NO_SEAT) and /release, body {}. */
export interface PanelLicenceRoomActionResponse {
    room_id: string;
    licence_state: PanelRoomLicenceState;
}

// ------------------------------------- approvals and installers (admin) ---

/** POST /admin/devices/{id}/approve answers PanelDeviceRow; /reject answers DeviceRevokeResponse. */
export type PanelDeviceApproveResponse = PanelDeviceRow;

export type PanelPartnerLinkVia = 'SCHOOL_CODE' | 'SUPER_ADMIN';

/** GET /admin/partners?institute_id answers an array of these. */
export interface PanelPartnerLinkRow {
    link_id: string;
    partner_name: string;
    linked_via: PanelPartnerLinkVia;
    install_until: string | null;
    created_at: string;
    installs: number;
}

/** POST /admin/partner-invites. install_days 1 to 90. */
export interface PanelPartnerInviteRequest {
    institute_id: string;
    install_days: number;
}

/** The code is shown once. */
export interface PanelPartnerInviteResponse {
    id: string;
    code: string;
    expires_at: string;
}

/** POST /admin/partner-invites/{id}/cancel and /admin/partners/{link_id}/revoke. */
export interface PanelStatusResponse<S extends string = string> {
    status: S;
}

// ------------------------------------------ installer (/partner/**) ---

export interface PanelPartnerRef {
    id: string;
    name: string;
}

/** GET /partner/me, or 403 NOT_INSTALLER. */
export interface PanelPartnerMeResponse {
    partner: PanelPartnerRef;
}

/** POST /partner/links/redeem. Rate limited per user. */
export interface PanelPartnerLinkRedeemRequest {
    code: string;
}

export interface PanelPartnerLinkRedeemResponse {
    link_id: string;
    institute_id: string;
    /** Null until the name is filled in the background. */
    institute_name: string | null;
    install_until: string | null;
}

/** GET /partner/customers answers an array of these. */
export interface PanelPartnerCustomerRow {
    institute_id: string;
    institute_name: string | null;
    install_until: string | null;
}

/** GET /partner/rooms?institute_id answers an array of these. */
export interface PanelPartnerRoomRow {
    id: string;
    name: string;
    has_panel: boolean;
}

/** POST /partner/devices/claim: the admin claim without replace_existing. Answers DeviceClaimResponse. */
export interface PanelPartnerClaimRequest {
    code: string;
    match_code: number;
    institute_id: string;
    room_id?: string;
    new_room_name?: string;
}

/** GET /partner/installs?institute_id: health only, for panels this installer set up. */
export interface PanelPartnerInstallRow {
    device_id: string;
    room: PanelRoomRef;
    status: PanelDeviceStatus;
    approval_state: PanelApprovalState;
    online: boolean;
    last_seen_at: string | null;
    app_version_code: number | null;
    webview_major: number | null;
}

// ----------------------------------------------- fleet (/admin/fleet) ---

export type PanelFleetAlertKind =
    | 'OFFLINE'
    | 'NOT_CONFIRMED'
    | 'AWAITING_APPROVAL'
    | 'UPDATE_REQUIRED'
    | 'APP_OUTDATED'
    | 'WEBVIEW_OLD'
    | 'UNUSED'
    | 'LICENCE_ROOM'
    | 'LICENCE_ENDING';

export type PanelFleetSeverity = 'info' | 'warn' | 'bad';

export interface PanelFleetAlert {
    /** A newer server may send a kind this bundle does not know: handle any string. */
    kind: PanelFleetAlertKind | (string & Record<never, never>);
    severity: PanelFleetSeverity;
    /** Null for institute-wide alerts (LICENCE_ENDING). */
    device_id: string | null;
    room: PanelRoomRef | null;
    since: string | null;
    incident_key: string;
    detail: Record<string, string | number | boolean | null>;
}

/** GET /admin/fleet?institute_id. counts is keyed by kind. */
export interface PanelFleetResponse {
    generated_at: string;
    counts: Partial<Record<PanelFleetAlertKind, number>>;
    alerts: PanelFleetAlert[];
}

// ----------------------------------- platform staff (PANEL_SUPER_ADMIN_BASE) ---

export interface PanelLicenceEnforcementRequest {
    enforcement: PanelLicenceEnforcement;
}

export interface PanelLicenceGrantCreateRequest {
    kind: PanelLicenceGrantKind;
    seats: number;
    starts_at: string;
    ends_at: string;
    grace_days: number;
    partner_id?: string | null;
    /** Free text reference; never an amount. */
    external_ref?: string | null;
    note?: string | null;
}

export interface PanelLicenceGrantDetail extends PanelLicenceGrantView {
    id: string;
    institute_id: string;
    status: 'ACTIVE' | 'CANCELLED';
    partner_id: string | null;
    external_ref: string | null;
    note: string | null;
    created_by: string;
    created_at: string;
    cancelled_by: string | null;
    cancelled_at: string | null;
}

export type PanelReleaseChannel = 'PLAY' | 'DIRECT';
export type PanelReleaseStatus = 'DRAFT' | 'LIVE' | 'PULLED';

export interface PanelReleaseRow {
    id: string;
    channel: PanelReleaseChannel;
    version_code: number;
    version_name: string;
    apk_url: string | null;
    sha256: string | null;
    size_bytes: number | null;
    min_sdk: number;
    rollout_percent: number;
    required: boolean;
    status: PanelReleaseStatus;
    notes: string | null;
    created_by: string;
    created_at: string;
    published_at: string | null;
    /** DIRECT only: the build identity every direct release is checked against. Null for PLAY. */
    package_name: string | null;
    signing_cert_sha256: string | null;
}

/**
 * POST /releases. Always created as DRAFT. A DIRECT release needs apk_url (https, allowed host),
 * sha256, size_bytes, package_name and signing_cert_sha256; a PLAY row carries no apk_url.
 */
export interface PanelReleaseCreateRequest {
    channel: PanelReleaseChannel;
    version_code: number;
    version_name: string;
    apk_url?: string | null;
    sha256?: string | null;
    size_bytes?: number | null;
    min_sdk?: number;
    rollout_percent?: number;
    required?: boolean;
    notes?: string | null;
    package_name?: string | null;
    signing_cert_sha256?: string | null;
}

/** PATCH /releases/{id}. Status moves DRAFT to LIVE, DRAFT or LIVE to PULLED; PULLED is final. */
export interface PanelReleasePatchRequest {
    status?: PanelReleaseStatus;
    rollout_percent?: number;
    required?: boolean;
}

// ----------------------------------------------------- 7.3 admin_core ---

export type TodayScope = 'mine' | 'all';

export interface TodayInstructor {
    user_id: string;
    name: string | null;
}

export interface TodayClass {
    schedule_id: string;
    session_id: string;
    title: string | null;
    subject: string | null;
    batches: string[];
    meeting_date: string;
    starts_at_ms: number;
    /** Null when the class has no end time: the end-of-class bar never fires. */
    ends_at_ms?: number | null;
    /** HH:mm in the session's zone, computed on the server. Display this, never reformat. */
    time_label: string;
    timezone: string | null;
    link_type: string | null;
    streaming_type: string | null;
    live_now: boolean;
    instructors: TodayInstructor[];
    /** Only for providers we cannot host. Never carries moderator data. */
    external_link?: string | null;
}

export interface TodayResponse {
    server_time_ms: number;
    classes: TodayClass[];
    truncated: boolean;
}

/** GET /meeting/join?scheduleId&role=MODERATOR&recreate */
export interface BbbJoinResponse {
    status?: 'MEETING_ENDED' | 'RECREATE_BLOCKED' | 'NOT_STARTED' | string;
    message?: string;
    joinUrl?: string;
}

/** GET /meeting/google-meet-join?scheduleId. 409 while the space is provisioning. */
export interface GoogleMeetJoinResponse {
    joinUrl?: string;
    organizerEmail?: string | null;
    cohostEmail?: string | null;
    cohostJustAdded?: boolean;
}

/** GET /meeting/session-links?scheduleId */
export interface SessionLinksResponse {
    hostUrl?: string | null;
    joinUrl?: string | null;
}

// ----------------------------------------------- 7.4 community_service ---

/** POST /engage/admin/v2/create. `presenter_key` goes in X-Presenter-Token and on SSE as ?presenter_token=. */
export interface VoltV2CreateResponse<LiveSessionDto = unknown> {
    session: LiveSessionDto;
    presenter_key: string;
}
