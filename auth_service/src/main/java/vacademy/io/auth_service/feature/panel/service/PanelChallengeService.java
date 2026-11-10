package vacademy.io.auth_service.feature.panel.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengeApproveRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengeApprovedResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengeDeniedResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengeDescribeRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengeDescribeResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengeInfoRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengeInfoResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengePollRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengePollResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengeRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengeResponse;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.ChallengeRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.SessionRow;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * QR sign-in and the "connect phone" flow. The panel shows a challenge, a staff member's phone scans
 * and taps the matching number, and the panel redeems it with its device credentials.
 *
 * <p>Single-use rules are the conditional UPDATEs in PanelRepository. An APPROVED challenge stays
 * redeemable for 2 minutes after approved_at whatever its expires_at says, and is never touched by a
 * panel renewing its QR.
 */
@Service
public class PanelChallengeService {

    private static final int INSERT_ATTEMPTS = 3;
    private static final int CHALLENGE_TOKEN_BYTES = 16;
    private static final int REMOTE_TOKEN_BYTES = 32;
    private static final int SESSION_TOKEN_BYTES = 32;
    private static final int MAX_NAME = 255;

    private final PanelRepository repository;
    private final PanelProperties properties;
    private final PanelDevices devices;
    private final PanelAccessPolicy policy;
    private final PanelSessionService sessions;
    private final PanelTokenService tokens;
    private final PanelRateLimiter rateLimiter;
    private final PanelMaintenance maintenance;
    private final PanelInstituteDirectory directory;
    private final PanelTx tx;
    private final UserRepository userRepository;

    public PanelChallengeService(PanelRepository repository, PanelProperties properties, PanelDevices devices,
            PanelAccessPolicy policy, PanelSessionService sessions, PanelTokenService tokens,
            PanelRateLimiter rateLimiter, PanelMaintenance maintenance, PanelInstituteDirectory directory, PanelTx tx,
            UserRepository userRepository) {
        this.repository = repository;
        this.properties = properties;
        this.devices = devices;
        this.policy = policy;
        this.sessions = sessions;
        this.tokens = tokens;
        this.rateLimiter = rateLimiter;
        this.maintenance = maintenance;
        this.directory = directory;
        this.tx = tx;
        this.userRepository = userRepository;
    }

    // ------------------------------------------------------- panel: create ---

    public ChallengeResponse create(ChallengeRequest body) {
        properties.requireEnabled();
        DeviceRow device = devices.requireActive(body.deviceId(), body.deviceSecret());
        // Refused here, not only at approve, so a panel of an institute outside panel.allowed-institutes
        // shows "not available" instead of a QR code that can only ever fail.
        properties.requireInstituteAllowed(device.instituteId());
        String purpose = body.purpose();
        if (!"SIGN_IN".equals(purpose) && !"ATTACH_REMOTE".equals(purpose)) {
            throw PanelApiException.badRequest("Unknown purpose");
        }
        if ("SIGN_IN".equals(purpose)) {
            // Phase 2 approval, seat and version checks. Refused here too, so the panel shows why
            // instead of a QR code that can only fail at approve.
            sessions.requireCanStart(device);
        }
        String attachSessionId = "ATTACH_REMOTE".equals(purpose) ? requireAttachSession(device, body.sessionToken())
                : null;
        maintenance.maybePurge();
        if (device.brandingSyncedAt() == null || device.dbNow().getTime()
                - device.brandingSyncedAt().getTime() > PanelTimers.BRANDING_STALE_MS) {
            directory.refreshDeviceAsync(device.id(), device.instituteId());
        }
        String base = sessions.approveBase(device);
        return tx.run(() -> {
            repository.lockForTransaction("panel_challenge:device:" + device.id());
            for (int attempt = 0; attempt < INSERT_ATTEMPTS; attempt++) {
                clearOpenChallenges(device);
                String token = PanelSecrets.token(CHALLENGE_TOKEN_BYTES);
                String userCode = PanelSecrets.code();
                PanelSecrets.MatchNumbers numbers = PanelSecrets.matchNumbers();
                String id = UUID.randomUUID().toString();
                int inserted = repository.insertChallenge(id, device.id(), device.instituteId(), purpose,
                        attachSessionId, PanelSecrets.sha256Hex(token), PanelSecrets.sha256Hex(userCode),
                        numbers.matchCode(), numbers.options(), PanelTimers.CHALLENGE_TTL_S);
                if (inserted == 1) {
                    return new ChallengeResponse(id, base + "/classroom#c=" + token, userCode, numbers.matchCode(),
                            PanelTimers.CHALLENGE_TTL_S, properties.poll(PanelTimers.CHALLENGE_POLL_MS));
                }
            }
            throw PanelApiException.tryAgain();
        });
    }

    private String requireAttachSession(DeviceRow device, String sessionToken) {
        if (sessionToken == null || sessionToken.length() > PanelSecrets.MAX_TOKEN_LENGTH) {
            throw PanelApiException.sessionEnded(null);
        }
        SessionRow session = repository.findSessionByRefreshHash(PanelSecrets.sha256Hex(sessionToken))
                .filter(s -> device.id().equals(s.deviceId()))
                .orElseThrow(() -> PanelApiException.sessionEnded(null));
        if (!session.active()) {
            throw PanelApiException.sessionEnded(session.endReason());
        }
        if (session.pastCap()) {
            repository.endSession(session.id(), "EXPIRED", null);
            throw PanelApiException.sessionEnded("EXPIRED");
        }
        return session.id();
    }

    /**
     * PENDING and SCANNED go first, so if an approve is racing this it either already won, and the
     * APPROVED check below sees it, or it finds DEAD and fails. A fresh APPROVED answers 409 and the
     * panel resumes polling it. A stale one goes EXPIRED with the session nobody picked up.
     */
    private void clearOpenChallenges(DeviceRow device) {
        repository.killPendingOrScannedOfDevice(device.id());
        Optional<ChallengeRow> approved = repository.findApprovedChallengeOfDevice(device.id());
        if (approved.isEmpty()) {
            return;
        }
        ChallengeRow challenge = approved.get();
        if (challenge.ageMs(challenge.approvedAt()) < PanelTimers.REDEEM_WINDOW_S * 1000L) {
            throw new PanelApiException(HttpStatus.CONFLICT, "APPROVED_PENDING", "Waiting for this panel to sign in")
                    .with("challenge_id", challenge.id());
        }
        if (repository.expireApproved(challenge.id(), PanelTimers.REDEEM_WINDOW_S) == 1
                && challenge.sessionId() != null) {
            repository.endUnredeemedSession(challenge.sessionId(), "EXPIRED");
        }
    }

    // --------------------------------------------------------- panel: poll ---

    /** What a challenge reads as now. Expiry is computed here and written only when touched. */
    static String effectiveState(ChallengeRow c) {
        return switch (c.state()) {
            case "PENDING", "SCANNED" -> c.expiresAt().after(c.dbNow()) ? c.state() : "EXPIRED";
            case "APPROVED" -> c.ageMs(c.approvedAt()) < PanelTimers.REDEEM_WINDOW_S * 1000L ? "APPROVED" : "EXPIRED";
            default -> c.state();
        };
    }

    public ChallengePollResponse poll(ChallengePollRequest body) {
        DeviceRow device = devices.require(body.deviceId(), body.deviceSecret());
        int after = properties.poll(PanelTimers.CHALLENGE_POLL_MS);
        if (body.challengeId() == null || body.challengeId().length() > 36
                || PanelSecrets.hasControlChars(body.challengeId())) {
            throw noSuchChallenge();
        }
        ChallengeRow challenge = repository.findChallenge(body.challengeId())
                .filter(c -> device.id().equals(c.deviceId()))
                .orElseThrow(PanelChallengeService::noSuchChallenge);
        String state = effectiveState(challenge);
        switch (state) {
            case "PENDING":
                return ChallengePollResponse.of("PENDING", after);
            case "SCANNED":
                return ChallengePollResponse.scanned(challenge.scannedByName(), after);
            case "EXPIRED":
            case "DEAD":
                return ChallengePollResponse.of(state, after);
            default:
                break;
        }
        if ("ATTACH_REMOTE".equals(challenge.purpose())) {
            return ChallengePollResponse.of("ATTACHED", null);
        }
        return tx.run(() -> redeemInTx(challenge, after));
    }

    /**
     * APPROVED to REDEEMED, or a retry inside 60 s of the first redeem. Each one mints a new session
     * token and overwrites the hash, so only the newest response works.
     */
    private ChallengePollResponse redeemInTx(ChallengeRow challenge, int after) {
        if ("APPROVED".equals(challenge.state())) {
            repository.redeemChallenge(challenge.id(), PanelTimers.REDEEM_WINDOW_S);
        } else if (challenge.redeemedAt() == null
                || challenge.ageMs(challenge.redeemedAt()) > PanelTimers.REPEAT_WINDOW_S * 1000L) {
            return ChallengePollResponse.of("EXPIRED", after);
        }
        String sessionToken = PanelSecrets.token(SESSION_TOKEN_BYTES);
        if (challenge.sessionId() == null
                || repository.setSessionToken(challenge.sessionId(), PanelSecrets.sha256Hex(sessionToken)) == 0) {
            return ChallengePollResponse.of("DEAD", after);
        }
        SessionRow session = repository.findSession(challenge.sessionId()).orElseThrow();
        Optional<User> user = userRepository.findById(session.userId());
        if (user.isEmpty()) {
            return ChallengePollResponse.of("DEAD", after);
        }
        return ChallengePollResponse.redeemed(PanelSessionService.redeemedBody(tokens, session, user.get(), sessionToken));
    }

    // --------------------------------------------------------- public info ---

    public ChallengeInfoResponse info(ChallengeInfoRequest body, String ip) {
        rateLimiter.checkIp("challenge_info", ip, PanelRateLimiter.CHALLENGE_INFO_PER_IP);
        ChallengeRow challenge = byToken(body.t()).orElseThrow(() -> expired(HttpStatus.NOT_FOUND));
        Optional<DeviceRow> device = repository.findDevice(challenge.deviceId());
        return new ChallengeInfoResponse(effectiveState(challenge), challenge.instituteId(),
                device.map(DeviceRow::instituteName).orElse(null), device.map(DeviceRow::themeCode).orElse(null),
                challenge.expiresInSeconds());
    }

    // --------------------------------------------------------- phone: scan ---

    public ChallengeDescribeResponse describe(CustomUserDetails user, ChallengeDescribeRequest body) {
        rateLimiter.check("describe", user.getUserId(), PanelRateLimiter.DESCRIBE_PER_USER);
        return tx.run(() -> {
            ChallengeRow challenge = find(body.t(), body.userCode()).orElseThrow(() -> expired(HttpStatus.NOT_FOUND));
            String state = effectiveState(challenge);
            if (!"PENDING".equals(state) && !"SCANNED".equals(state)) {
                throw expired(HttpStatus.NOT_FOUND);
            }
            DeviceRow device = repository.findDevice(challenge.deviceId()).orElseThrow();
            properties.requireInstituteAllowed(challenge.instituteId());
            policy.check(user.getUserId(), challenge.instituteId(), device.instituteName());
            if ("ATTACH_REMOTE".equals(challenge.purpose())) {
                requireSameUser(challenge, user);
            }
            if (repository.markScanned(challenge.id(), firstName(user), PanelTimers.SCANNED_FLOOR_S,
                    PanelTimers.SCANNED_CEILING_S) == 0) {
                throw expired(HttpStatus.NOT_FOUND);
            }
            ChallengeRow scanned = repository.findChallenge(challenge.id()).orElseThrow();
            return new ChallengeDescribeResponse(challenge.purpose(), challenge.instituteId(), device.instituteName(),
                    device.roomName(), PanelSecrets.parseOptions(challenge.matchOptions()),
                    scanned.expiresInSeconds());
        });
    }

    private void requireSameUser(ChallengeRow challenge, CustomUserDetails user) {
        Optional<SessionRow> session = challenge.sessionId() == null ? Optional.empty()
                : repository.findSession(challenge.sessionId());
        if (session.isEmpty() || !user.getUserId().equals(session.get().userId())) {
            throw PanelApiException.otherUser();
        }
    }

    private static String firstName(CustomUserDetails user) {
        String name = user.getFullName() == null || user.getFullName().isBlank() ? user.getUsername()
                : user.getFullName().trim();
        if (name == null) {
            return null;
        }
        String first = name.split("\\s+")[0];
        return first.length() > MAX_NAME ? first.substring(0, MAX_NAME) : first;
    }

    // ------------------------------------------------------ phone: approve ---

    private record ApproveResult(boolean wrongNumber, Object body) {
    }

    /**
     * @return ChallengeApprovedResponse or ChallengeDeniedResponse
     */
    public Object approve(CustomUserDetails user, ChallengeApproveRequest body, String ip) {
        if ((body.t() == null || body.t().isEmpty()) && body.userCode() != null) {
            rateLimiter.check("approve_code", user.getUserId(), PanelRateLimiter.APPROVE_CODE_PER_USER);
        }
        boolean deny = Boolean.TRUE.equals(body.deny());
        if (!deny && body.matchCode() == null) {
            throw PanelApiException.badRequest("match_code or deny is required");
        }
        ApproveResult result = tx.run(() -> approveInTx(user, body, deny, ip));
        if (result.wrongNumber()) {
            throw new PanelApiException(HttpStatus.CONFLICT, "WRONG_NUMBER", "That number did not match");
        }
        return result.body();
    }

    private ApproveResult approveInTx(CustomUserDetails user, ChallengeApproveRequest body, boolean deny, String ip) {
        String userId = user.getUserId();
        ChallengeRow challenge = find(body.t(), body.userCode()).orElseThrow(() -> expired(HttpStatus.CONFLICT));
        if (isRepeat(challenge, userId)) {
            return repeatApprove(challenge, deny);
        }
        DeviceRow device = repository.findDevice(challenge.deviceId()).orElseThrow();
        String state = effectiveState(challenge);
        if (!"ACTIVE".equals(device.status()) || (!"PENDING".equals(state) && !"SCANNED".equals(state))) {
            throw expired(HttpStatus.CONFLICT);
        }
        properties.requireInstituteAllowed(challenge.instituteId());
        policy.check(userId, challenge.instituteId(), device.instituteName());
        if (deny) {
            repository.killChallenge(challenge.id());
            return new ApproveResult(false, new ChallengeDeniedResponse(true));
        }
        if (body.matchCode() != challenge.matchCode()) {
            repository.killChallenge(challenge.id());
            return new ApproveResult(true, null);
        }

        String remoteToken = PanelSecrets.token(REMOTE_TOKEN_BYTES);
        String remoteHash = PanelSecrets.sha256Hex(remoteToken);
        boolean attach = "ATTACH_REMOTE".equals(challenge.purpose());
        String sessionId;
        if (attach) {
            requireSameUser(challenge, user);
            sessionId = challenge.sessionId();
            if (repository.approveChallenge(challenge.id(), "REDEEMED", userId, ip) == 0) {
                return lostApproveRace(challenge.id(), userId, deny);
            }
            if (repository.setRemoteToken(sessionId, remoteHash) == 0) {
                throw expired(HttpStatus.CONFLICT);
            }
        } else {
            // Checked again at approve: the seat or approval can change while the QR is up.
            sessions.requireCanStart(device);
            if (repository.approveChallenge(challenge.id(), "APPROVED", userId, ip) == 0) {
                return lostApproveRace(challenge.id(), userId, deny);
            }
            sessionId = sessions.startSessionInTx(device, userId, "QR", null, remoteHash);
            repository.setChallengeSession(challenge.id(), sessionId);
        }
        policy.activateInvitedRoles(userId, challenge.instituteId());
        SessionRow session = repository.findSession(sessionId).orElseThrow();
        return new ApproveResult(false, new ChallengeApprovedResponse(sessionId, remoteToken, device.roomName(),
                session.expiresInSeconds()));
    }

    /** Same user, within 60 s of approved_at: the first response was probably lost on the way back. */
    private static boolean isRepeat(ChallengeRow c, String userId) {
        return ("APPROVED".equals(c.state()) || "REDEEMED".equals(c.state())) && userId.equals(c.approvedUserId())
                && c.approvedAt() != null && c.ageMs(c.approvedAt()) <= PanelTimers.REPEAT_WINDOW_S * 1000L;
    }

    private ApproveResult repeatApprove(ChallengeRow challenge, boolean deny) {
        if (deny) {
            throw expired(HttpStatus.CONFLICT);
        }
        String remoteToken = PanelSecrets.token(REMOTE_TOKEN_BYTES);
        if (challenge.sessionId() == null
                || repository.setRemoteToken(challenge.sessionId(), PanelSecrets.sha256Hex(remoteToken)) == 0) {
            throw expired(HttpStatus.CONFLICT);
        }
        SessionRow session = repository.findSession(challenge.sessionId()).orElseThrow();
        String roomName = repository.findDevice(session.deviceId()).map(DeviceRow::roomName).orElse(null);
        return new ApproveResult(false,
                new ChallengeApprovedResponse(session.id(), remoteToken, roomName, session.expiresInSeconds()));
    }

    /** The conditional UPDATE found nothing to move. Two taps from one phone both succeed; anyone else lost. */
    private ApproveResult lostApproveRace(String challengeId, String userId, boolean deny) {
        ChallengeRow current = repository.findChallenge(challengeId).orElseThrow(() -> expired(HttpStatus.CONFLICT));
        if (isRepeat(current, userId)) {
            return repeatApprove(current, deny);
        }
        throw expired(HttpStatus.CONFLICT);
    }

    // ------------------------------------------------------------- lookups ---

    private Optional<ChallengeRow> find(String t, String userCode) {
        if (t != null && !t.isEmpty()) {
            return byToken(t);
        }
        String code = PanelSecrets.normaliseCode(userCode);
        return code == null ? Optional.empty() : repository.findChallengeByUserCodeHash(PanelSecrets.sha256Hex(code));
    }

    private Optional<ChallengeRow> byToken(String t) {
        if (t == null || t.isEmpty() || t.length() > PanelSecrets.MAX_TOKEN_LENGTH) {
            return Optional.empty();
        }
        return repository.findChallengeByTokenHash(PanelSecrets.sha256Hex(t));
    }

    private static PanelApiException expired(HttpStatus status) {
        return new PanelApiException(status, "EXPIRED", "This code has expired");
    }

    private static PanelApiException noSuchChallenge() {
        return PanelApiException.notFound("No such challenge");
    }
}
