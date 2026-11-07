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
    | 'ERROR';

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
    min_app_version_code: number;
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
