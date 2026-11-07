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

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SyncRequest(String deviceId, String deviceSecret, String sessionId, String sessionToken,
            Integer appVersionCode, Integer webviewMajor, Boolean presenting, NavState state, Boolean inMeeting) {
        /** Without in_meeting, as panels that predate it send. */
        public SyncRequest(String deviceId, String deviceSecret, String sessionId, String sessionToken,
                Integer appVersionCode, Integer webviewMajor, Boolean presenting, NavState state) {
            this(deviceId, deviceSecret, sessionId, sessionToken, appVersionCode, webviewMajor, presenting, state,
                    null);
        }

        @Override
        public String toString() {
            return "SyncRequest[deviceId=" + deviceId + "]";
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
    public record SessionEndRequest(String deviceId, String deviceSecret, String sessionToken, String reason) {
        @Override
        public String toString() {
            return "SessionEndRequest[deviceId=" + deviceId + "]";
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
            String instituteId, String instituteName, String themeCode, RoomRef room, String claimedByName) {
        public static PairPollResponse of(String state, int pollAfterMs) {
            return new PairPollResponse(state, pollAfterMs, null, null, null, null, null, null, null);
        }
    }

    public record StatusResponse(String status) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SyncDevice(String status, String roomName, String instituteId, String instituteName,
            String themeCode, String approveBaseUrl, boolean passwordLoginAllowed) {
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

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SyncResponse(long serverTimeMs, SyncDevice device,
            @JsonInclude(JsonInclude.Include.NON_NULL) SyncSession session, SyncFlags flags, SyncPolicy policy,
            int nextPollMs, int minAppVersionCode) {
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

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record DeviceRowResponse(String id, RoomRef room, String status, boolean online, String lastSeenAt,
            String lastIp, String model, String manufacturer, Integer sdkInt, Integer webviewMajor,
            Integer appVersionCode, boolean passwordLoginAllowed, String claimedByName, String claimedAt,
            DeviceCurrentSession currentSession) {
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
}
