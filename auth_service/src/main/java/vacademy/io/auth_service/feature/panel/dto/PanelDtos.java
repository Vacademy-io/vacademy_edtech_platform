package vacademy.io.auth_service.feature.panel.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.List;
import java.util.Map;

/**
 * Request and response bodies of the panel endpoints, snake_case on the wire. The contract the
 * clients build against is frontend-admin-dashboard/src/classroom-shared/apiTypes.ts.
 *
 * <p>The shared SlowQueryLogger aspect prints the arguments of every *Service method that fails or
 * runs slow, and its slow events reach Sentry. Requests that carry a credential therefore override
 * toString, so a device secret, session or remote token, QR token, code or password cannot reach a log.
 */
public final class PanelDtos {

    private PanelDtos() {
    }

    // ------------------------------------------------------------ requests ---

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PairStartRequest(String installId, Map<String, Object> device) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PairPollRequest(String pairSecret) {
        @Override
        public String toString() {
            return "PairPollRequest[]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PairConfirmRequest(String deviceId, String deviceSecret, Boolean accept) {
        @Override
        public String toString() {
            return "PairConfirmRequest[deviceId=" + deviceId + "]";
        }
    }

    public record NavState(Integer index, Integer total, String title) {
    }

    /**
     * One "what was shown" event from the panel's queue (phase 2). seq is per session and only grows;
     * at_ms is the panel's server-corrected clock and is clamped by the server. Titles never reach a log.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ActivityEvent(Integer seq, String kind, String refId, String parentId, String title, Long atMs) {
        @Override
        public String toString() {
            return "ActivityEvent[seq=" + seq + ", kind=" + kind + "]";
        }
    }

    /**
     * activity and app_channel are phase 2 and optional: phase 1 panels never send them. app_channel
     * is PLAY, DIRECT or DEV; anything else is ignored.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SyncRequest(String deviceId, String deviceSecret, String sessionId, String sessionToken,
            Integer appVersionCode, Integer webviewMajor, Boolean presenting, NavState state, Boolean inMeeting,
            List<ActivityEvent> activity, String appChannel) {
        /** Without in_meeting, as panels that predate it send. */
        public SyncRequest(String deviceId, String deviceSecret, String sessionId, String sessionToken,
                Integer appVersionCode, Integer webviewMajor, Boolean presenting, NavState state) {
            this(deviceId, deviceSecret, sessionId, sessionToken, appVersionCode, webviewMajor, presenting, state,
                    null, null, null);
        }

        /** Phase 1 shape: no activity and no channel. */
        public SyncRequest(String deviceId, String deviceSecret, String sessionId, String sessionToken,
                Integer appVersionCode, Integer webviewMajor, Boolean presenting, NavState state,
                Boolean inMeeting) {
            this(deviceId, deviceSecret, sessionId, sessionToken, appVersionCode, webviewMajor, presenting, state,
                    inMeeting, null, null);
        }

        @Override
        public String toString() {
            return "SyncRequest[deviceId=" + deviceId + ", activity=" + (activity == null ? 0 : activity.size())
                    + "]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ChallengeRequest(String deviceId, String deviceSecret, String purpose, String sessionToken) {
        @Override
        public String toString() {
            return "ChallengeRequest[deviceId=" + deviceId + "]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ChallengePollRequest(String deviceId, String deviceSecret, String challengeId) {
        @Override
        public String toString() {
            return "ChallengePollRequest[deviceId=" + deviceId + "]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ChallengeInfoRequest(String t) {
        @Override
        public String toString() {
            return "ChallengeInfoRequest[]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SessionRefreshRequest(String deviceId, String deviceSecret, String sessionToken) {
        @Override
        public String toString() {
            return "SessionRefreshRequest[deviceId=" + deviceId + "]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SessionEndRequest(String deviceId, String deviceSecret, String sessionToken, String reason,
            List<ActivityEvent> activity) {
        /** Phase 1 shape: no activity. */
        public SessionEndRequest(String deviceId, String deviceSecret, String sessionToken, String reason) {
            this(deviceId, deviceSecret, sessionToken, reason, null);
        }

        @Override
        public String toString() {
            return "SessionEndRequest[deviceId=" + deviceId + ", activity=" + (activity == null ? 0 : activity.size())
                    + "]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LoginPasswordRequest(String deviceId, String deviceSecret, String username, String password) {
        @Override
        public String toString() {
            return "LoginPasswordRequest[deviceId=" + deviceId + "]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record RemoteNavRequest(String remoteToken, Integer delta, Long clientSeq) {
        @Override
        public String toString() {
            return "RemoteNavRequest[delta=" + delta + "]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record RemoteTokenRequest(String remoteToken) {
        @Override
        public String toString() {
            return "RemoteTokenRequest[]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PairPreviewRequest(String code) {
        @Override
        public String toString() {
            return "PairPreviewRequest[]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record DeviceClaimRequest(String code, Integer matchCode, String instituteId, String roomId,
            String newRoomName, Boolean replaceExisting) {
        @Override
        public String toString() {
            return "DeviceClaimRequest[instituteId=" + instituteId + "]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record RoomCreateRequest(String instituteId, String name) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record RoomBulkCreateRequest(String instituteId, List<String> names) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RoomPatchRequest(String name, String status) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record DevicePatchRequest(String roomId, Boolean passwordLoginAllowed) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ChallengeDescribeRequest(String t, String userCode) {
        @Override
        public String toString() {
            return "ChallengeDescribeRequest[]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ChallengeApproveRequest(String t, String userCode, Integer matchCode, Boolean deny) {
        @Override
        public String toString() {
            return "ChallengeApproveRequest[]";
        }
    }

    // ----------------------------------------------------------- responses ---

    public record RoomRef(String id, String name) {
    }

    public record UserRef(String id, String name) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PairStartResponse(String pairSecret, String code, int matchCode, String qrUrl, int expiresInS,
            int pollAfterMs) {
    }

    /** Fields past poll_after_ms are present only on state CLAIMED. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PairPollResponse(String state, int pollAfterMs, String deviceId, String deviceSecret,
            String instituteId, String instituteName, String themeCode, RoomRef room, String claimedByName,
            String installedBy) {
        /** Phase 1 shape: no installer organisation. */
        public PairPollResponse(String state, int pollAfterMs, String deviceId, String deviceSecret,
                String instituteId, String instituteName, String themeCode, RoomRef room, String claimedByName) {
            this(state, pollAfterMs, deviceId, deviceSecret, instituteId, instituteName, themeCode, room,
                    claimedByName, null);
        }

        public static PairPollResponse of(String state, int pollAfterMs) {
            return new PairPollResponse(state, pollAfterMs, null, null, null, null, null, null, null, null);
        }
    }

    public record StatusResponse(String status) {
    }

    /** approval_state is phase 2: APPROVED, PENDING or REJECTED. Omitted when null. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SyncDevice(String status, String roomName, String instituteId, String instituteName,
            String themeCode, String approveBaseUrl, boolean passwordLoginAllowed,
            @JsonInclude(JsonInclude.Include.NON_NULL) String approvalState) {
        /** Phase 1 shape: no approval state. */
        public SyncDevice(String status, String roomName, String instituteId, String instituteName,
                String themeCode, String approveBaseUrl, boolean passwordLoginAllowed) {
            this(status, roomName, instituteId, instituteName, themeCode, approveBaseUrl, passwordLoginAllowed, null);
        }
    }

    /**
     * The room's seat as a signed-out panel sees it (phase 2). Present only on a signed-out sync and
     * only while the licence feature is on. state: LICENSED, GRACE, OVER_LIMIT, UNLICENSED, EXPIRED,
     * UNMANAGED. enforced is false under SHADOW and OFF.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SyncLicence(String state, boolean enforced, String endsAt, String graceEndsAt) {
    }

    /** A newer app build for this panel's channel (phase 2). Present only on a signed-out sync. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SyncUpdate(int versionCode, String versionName, String apkUrl, String sha256, Long sizeBytes,
            boolean required) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SyncSession(String status, String endReason, long expiresInS, int navCounter, Long navAgeMs,
            boolean phoneConnected) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SyncFlags(boolean voltLiveEnabled, int bbbInAppMinWebview) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SyncPolicy(int idleMinutes, int sessionHours) {
    }

    /** licence, update and activity_acked_seq are phase 2 and omitted when null. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SyncResponse(long serverTimeMs, SyncDevice device,
            @JsonInclude(JsonInclude.Include.NON_NULL) SyncSession session, SyncFlags flags, SyncPolicy policy,
            int nextPollMs, int minAppVersionCode,
            @JsonInclude(JsonInclude.Include.NON_NULL) SyncLicence licence,
            @JsonInclude(JsonInclude.Include.NON_NULL) SyncUpdate update,
            @JsonInclude(JsonInclude.Include.NON_NULL) Integer activityAckedSeq) {
        /** Phase 1 shape. */
        public SyncResponse(long serverTimeMs, SyncDevice device, SyncSession session, SyncFlags flags,
                SyncPolicy policy, int nextPollMs, int minAppVersionCode) {
            this(serverTimeMs, device, session, flags, policy, nextPollMs, minAppVersionCode, null, null, null);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ChallengeResponse(String challengeId, String qrUrl, String userCode, int matchCode, int expiresInS,
            int pollAfterMs) {
    }

    /** Which fields appear depends on state: see ChallengePollResponse in the contract. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ChallengePollResponse(String state, Integer pollAfterMs, String scannedByName, String accessToken,
            String sessionToken, String sessionId, Integer expiresInS, Long sessionExpiresInS, UserRef user,
            String instituteId, Long serverTimeMs) {
        public static ChallengePollResponse of(String state, Integer pollAfterMs) {
            return new ChallengePollResponse(state, pollAfterMs, null, null, null, null, null, null, null, null, null);
        }

        public static ChallengePollResponse scanned(String name, int pollAfterMs) {
            return new ChallengePollResponse("SCANNED", pollAfterMs, name, null, null, null, null, null, null, null,
                    null);
        }

        public static ChallengePollResponse redeemed(RedeemedSession s) {
            return new ChallengePollResponse("REDEEMED", null, null, s.accessToken(), s.sessionToken(), s.sessionId(),
                    s.expiresInS(), s.sessionExpiresInS(), s.user(), s.instituteId(), s.serverTimeMs());
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ChallengeInfoResponse(String state, String instituteId, String instituteName, String themeCode,
            long expiresInS) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record RedeemedSession(String accessToken, String sessionToken, String sessionId, int expiresInS,
            long sessionExpiresInS, UserRef user, String instituteId, long serverTimeMs) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SessionRefreshResponse(String accessToken, int expiresInS, long sessionExpiresInS,
            long serverTimeMs) {
    }

    public record EndedResponse(boolean ended) {
    }

    public record RemoteNavResponse(boolean accepted,
            @JsonInclude(JsonInclude.Include.NON_NULL) Boolean duplicate, String status) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record RemoteStateResponse(String status, String instituteId, String roomName, Integer index, Integer total,
            String title, boolean panelOnline, long sessionExpiresInS) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PairPreviewResponse(String model, String manufacturer, Integer webviewMajor,
            List<Integer> matchOptions, long expiresInS) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminInstituteRow(String instituteId) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record DeviceClaimResponse(String deviceId, String status, RoomRef room) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record RoomResponse(String id, String name, String status, String deviceId) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record RoomListResponse(List<RoomResponse> rooms, String nextUnpairedRoomId) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record RoomBulkResponse(List<RoomResponse> created, List<String> skippedDuplicates) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record DeviceCurrentSession(String id, String userId, String userName, String startedVia, String createdAt,
            long expiresInS, String approvedIp) {
    }

    /**
     * approval_state, app_channel, installed_by (installer organisation name) and licence_state are
     * phase 2. licence_state is null while the institute's seats are unmanaged.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record DeviceRowResponse(String id, RoomRef room, String status, boolean online, String lastSeenAt,
            String lastIp, String model, String manufacturer, Integer sdkInt, Integer webviewMajor,
            Integer appVersionCode, boolean passwordLoginAllowed, String claimedByName, String claimedAt,
            DeviceCurrentSession currentSession, String approvalState, String appChannel, String installedBy,
            String licenceState) {
        /** Phase 1 shape. */
        public DeviceRowResponse(String id, RoomRef room, String status, boolean online, String lastSeenAt,
                String lastIp, String model, String manufacturer, Integer sdkInt, Integer webviewMajor,
                Integer appVersionCode, boolean passwordLoginAllowed, String claimedByName, String claimedAt,
                DeviceCurrentSession currentSession) {
            this(id, room, status, online, lastSeenAt, lastIp, model, manufacturer, sdkInt, webviewMajor,
                    appVersionCode, passwordLoginAllowed, claimedByName, claimedAt, currentSession, "APPROVED", null,
                    null, null);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ChallengeDescribeResponse(String purpose, String instituteId, String instituteName, String roomName,
            List<Integer> matchOptions, long expiresInS) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ChallengeApprovedResponse(String sessionId, String remoteToken, String roomName,
            long sessionExpiresInS) {
    }

    public record ChallengeDeniedResponse(boolean denied) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record MySessionResponse(String sessionId, String instituteId, String roomName, long sessionExpiresInS) {
    }

    // =====================================================================
    // Phase 2. Every block below is new; the owning chunk fills the service
    // behind it. Times are ISO-8601 instants, dates are yyyy-MM-dd local dates.
    // =====================================================================

    // ---------------------------------------------------- phase 2: usage ---

    /** coverage_pct is null when no counted session falls in the window. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageTotals(double panelHours, int sessions, int teachers, int roomsUsed, int roomsWithPanel,
            int idleRooms, int classesStarted, Integer coveragePct) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageDay(String date, double panelHours, int sessions, int roomsUsed) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageRoom(RoomRef room, double panelHours, int sessions, int teachers, String lastUsedAt,
            int daysUsed) {
    }

    /** One content item. ref_id, sessions and teachers are absent inside by_teacher[].top_content. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageContent(String kind, String refId, String title, int minutes, Integer sessions,
            Integer teachers) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageTeacher(UserRef user, double panelHours, int sessions, int rooms, int daysActive,
            List<UsageContent> topContent) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageIdleRoom(RoomRef room, String deviceId, String lastUsedAt, boolean online) {
    }

    /** content_recorded_from: the first local date with any recorded content; null when none. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageNotes(String contentRecordedFrom) {
    }

    /** GET /admin/usage, and the internal /usage-summary (same shape, lists capped). */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageResponse(String instituteId, String from, String to, String tz, String generatedAt,
            UsageTotals totals, List<UsageDay> byDay, List<UsageRoom> byRoom, List<UsageTeacher> byTeacher,
            List<UsageIdleRoom> idleRooms, List<UsageContent> content, UsageNotes notes) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageSessionEvent(String kind, String title, String startedAt, int minutes) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageSessionRow(String id, RoomRef room, UserRef user, String startedAt, String endAt, int minutes,
            String endReason, String startedVia, List<UsageSessionEvent> events) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageSessionsResponse(List<UsageSessionRow> sessions, int page, int size, long total) {
    }

    /** One row of GET /admin/usage/multi, which answers a JSON array of these. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UsageMultiRow(String instituteId, UsageTotals totals) {
    }

    // ---------------------------------------------- phase 2: seats (tenant) ---

    /** A grant as an institute admin sees it: no reference or note. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceGrantView(String kind, int seats, String startsAt, String endsAt, int graceDays) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceRoomRow(RoomRef room, String licenceState, String licensedAt, String deviceId) {
    }

    /**
     * GET /admin/licence. state: UNMANAGED, ACTIVE, TRIAL, GRACE, EXPIRED, NONE. enforcement: OFF,
     * SHADOW, LIVE. ends_at is null when nothing covers now; grace_ends_at is set while rooms are kept
     * by an ended grant's grace days. next_starts_at (omitted when null) is the earliest start of a
     * grant that has not started yet, so a NONE state can say when the licence starts.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceResponse(String state, String enforcement, int seatsGranted, int seatsUsed, String endsAt,
            String graceEndsAt, List<LicenceGrantView> grants, List<LicenceRoomRow> rooms,
            @JsonInclude(JsonInclude.Include.NON_NULL) String nextStartsAt) {
    }

    /** POST /admin/licence/rooms/{room_id}/assign and /release. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceRoomActionResponse(String roomId, String licenceState) {
    }

    // ----------------------------------------- phase 2: installers (tenant) ---

    /** GET /admin/partners, one row per installer organisation linked to the institute. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerLinkRow(String linkId, String partnerName, String linkedVia, String installUntil,
            String createdAt, int installs) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerInviteRequest(String instituteId, Integer installDays) {
    }

    /** GET /admin/partner-invites: an open (PENDING, unexpired) code, without the code itself. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerOpenInviteRow(String id, String createdAt, String expiresAt, int installDays,
            String createdBy) {
    }

    /** The code is shown once and never stored in clear. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerInviteResponse(String id, String code, String expiresAt) {
        @Override
        public String toString() {
            return "PartnerInviteResponse[id=" + id + "]";
        }
    }

    // ------------------------------------------------ phase 2: installer side ---

    public record PartnerRef(String id, String name) {
    }

    /** GET /partner/me. */
    public record PartnerMeResponse(PartnerRef partner) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PartnerLinkRedeemRequest(String code) {
        @Override
        public String toString() {
            return "PartnerLinkRedeemRequest[]";
        }
    }

    /** institute_name is null until the background name lookup fills it. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerLinkRedeemResponse(String linkId, String instituteId, String instituteName,
            String installUntil) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerCustomerRow(String instituteId, String instituteName, String installUntil) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerRoomRow(String id, String name, boolean hasPanel) {
    }

    /** The admin claim without replace_existing: an installer can never replace a panel. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerClaimRequest(String code, Integer matchCode, String instituteId, String roomId,
            String newRoomName) {
        @Override
        public String toString() {
            return "PartnerClaimRequest[instituteId=" + instituteId + "]";
        }
    }

    /** GET /partner/installs: health only, for panels this installer set up. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerInstallRow(String deviceId, RoomRef room, String status, String approvalState,
            boolean online, String lastSeenAt, Integer appVersionCode, Integer webviewMajor) {
    }

    // ------------------------------------------------- phase 2: super admin ---

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LicenceEnforcementRequest(String enforcement) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceEnforcementResponse(String instituteId, String enforcement) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceGrantCreateRequest(String kind, Integer seats, String startsAt, String endsAt,
            Integer graceDays, String partnerId, String externalRef, String note) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LicenceGrantCancelRequest(String note) {
    }

    /** A grant as platform staff see it, with its reference and note. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceGrantDetail(String id, String instituteId, String kind, int seats, String startsAt,
            String endsAt, int graceDays, String status, String partnerId, String externalRef, String note,
            String createdBy, String createdAt, String cancelledBy, String cancelledAt) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceAdminResponse(String instituteId, String state, String enforcement, int seatsGranted,
            int seatsUsed, String endsAt, String graceEndsAt, List<LicenceGrantDetail> grants,
            List<LicenceRoomRow> rooms, @JsonInclude(JsonInclude.Include.NON_NULL) String nextStartsAt) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceTemplateRequest(String kind, Integer seats, Integer days, Integer graceDays,
            Boolean active) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceTemplateResponse(String key, String kind, int seats, int days, int graceDays,
            boolean active, String updatedBy, String updatedAt) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerRoomCount(String partnerId, int activeLicensedRooms) {
    }

    /** Counts only. The system computes no money. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceUsageRow(String instituteId, String partnerId, String enforcement, String state,
            int seatsGrantedPeak, int licensedRoomsPeak, int licensedRoomDays, int activeLicensedRooms,
            List<PartnerRoomCount> roomsByPartner) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record LicenceUsageResponse(String month, List<LicenceUsageRow> rows) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerCreateRequest(String name, String partnerInstituteId) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PartnerPatchRequest(String status) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerResponse(String id, String name, String partnerInstituteId, String status,
            String createdAt) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerLinkCreateRequest(String instituteId, String installUntil) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PartnerLinkResponse(String id, String partnerId, String instituteId, String instituteName,
            String status, String linkedVia, String installUntil, String createdAt) {
    }

    /** PATCH /rooms/{room_id}/partner: a null partner_id clears the attribution. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record RoomPartnerPatchRequest(String partnerId) {
    }

    // ------------------------------------------------- phase 2: app releases ---

    /**
     * A new DRAFT release. For DIRECT, package_name and signing_cert_sha256 are what the build reports
     * about itself; they must equal the identity the service is configured with
     * (panel.releases.direct-package-name, panel.releases.signing-cert-sha256) or the release is refused.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ReleaseCreateRequest(String channel, Integer versionCode, String versionName, String apkUrl,
            String sha256, Long sizeBytes, Integer minSdk, Integer rolloutPercent, Boolean required, String notes,
            String packageName, String signingCertSha256) {
        /** Without the build identity: accepted only for PLAY rows. */
        public ReleaseCreateRequest(String channel, Integer versionCode, String versionName, String apkUrl,
                String sha256, Long sizeBytes, Integer minSdk, Integer rolloutPercent, Boolean required,
                String notes) {
            this(channel, versionCode, versionName, apkUrl, sha256, sizeBytes, minSdk, rolloutPercent, required, notes,
                    null, null);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ReleasePatchRequest(String status, Integer rolloutPercent, Boolean required, Boolean forceFloor) {
        /** Without force_floor: a change that would leave panels below the floor with no update is refused. */
        public ReleasePatchRequest(String status, Integer rolloutPercent, Boolean required) {
            this(status, rolloutPercent, required, null);
        }
    }

    /**
     * package_name and signing_cert_sha256 are the identity every DIRECT build is checked against
     * (null for PLAY rows). created_by is the staff user id.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ReleaseResponse(String id, String channel, int versionCode, String versionName, String apkUrl,
            String sha256, Long sizeBytes, int minSdk, int rolloutPercent, boolean required, String status,
            String notes, String createdBy, String createdAt, String publishedAt, String packageName,
            String signingCertSha256) {
    }

    // -------------------------------------------------------- phase 2: fleet ---

    /** severity: info, warn or bad. detail carries kind-specific values (last_seen_at, codes). */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record FleetAlert(String kind, String severity, String deviceId, RoomRef room, String since,
            String incidentKey, Map<String, Object> detail) {
    }

    /** GET /admin/fleet and the internal /fleet. counts is keyed by kind. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record FleetResponse(String generatedAt, Map<String, Integer> counts, List<FleetAlert> alerts) {
    }

    // ----------------------------------------------------- phase 2: internal ---

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record InternalInstituteRow(String instituteId, int roomsWithPanel, int devices, String firstPairedAt) {
    }

    /** GET /internal/panel/v1/institutes, paged at 500; has_more is true while another page exists. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record InternalInstitutesResponse(List<InternalInstituteRow> institutes, int page, boolean hasMore) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record HasPanelsResponse(boolean hasPanels) {
    }
}
