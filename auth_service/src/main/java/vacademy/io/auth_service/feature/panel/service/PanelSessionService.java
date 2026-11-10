package vacademy.io.auth_service.feature.panel.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Service;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ActivityEvent;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.EndedResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LoginPasswordRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.MySessionResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.NavState;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RedeemedSession;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RemoteNavRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RemoteNavResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RemoteStateResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RemoteTokenRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SessionEndRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SessionRefreshRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SessionRefreshResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncDevice;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncFlags;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncLicence;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncPolicy;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncSession;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncUpdate;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UserRef;
import vacademy.io.auth_service.feature.panel.phase2.DefaultPanelApprovalGate;
import vacademy.io.auth_service.feature.panel.phase2.NoopPanelActivityIngest;
import vacademy.io.auth_service.feature.panel.phase2.NoopPanelLicenceGate;
import vacademy.io.auth_service.feature.panel.phase2.NoopPanelReleaseOffer;
import vacademy.io.auth_service.feature.panel.phase2.PanelActivityIngest;
import vacademy.io.auth_service.feature.panel.phase2.PanelApprovalGate;
import vacademy.io.auth_service.feature.panel.phase2.PanelCompat;
import vacademy.io.auth_service.feature.panel.phase2.PanelLicenceGate;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.PanelReleaseOffer;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.SessionRow;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * A running panel session: sync, token refresh, ending it, password sign-in and the phone remote. All
 * state is in Postgres, so either pod can serve either side.
 */
@Service
public class PanelSessionService {

    private static final int MAX_TITLE = 200;
    private static final int MAX_CREDENTIAL_LENGTH = 255;
    private static final int TOKEN_BYTES = 32;
    private static final int SESSION_INSERT_ATTEMPTS = 3;
    private static final Set<String> CLIENT_END_REASONS = Set.of("SIGN_OUT", "IDLE", "CLASS_END");
    private static final Set<String> APP_CHANNELS = Set.of("PLAY", "DIRECT", "DEV");
    /** The panel's "Still teaching?" countdown that follows idle_minutes before an IDLE sign-out. */
    static final int IDLE_COUNTDOWN_S = 60;

    private final PanelRepository repository;
    private final PanelProperties properties;
    private final PanelDevices devices;
    private final PanelAccessPolicy policy;
    private final PanelTokenService tokens;
    private final PanelRateLimiter rateLimiter;
    private final PanelTx tx;
    private final UserRepository userRepository;
    private final AuthenticationManager authenticationManager;
    private final PanelPhase2Properties phase2;
    private final PanelActivityIngest activityIngest;
    private final PanelLicenceGate licence;
    private final PanelApprovalGate approval;
    private final PanelReleaseOffer releases;

    /** Phase 1 wiring, for tests: phase 2 switches off, placeholder seams, approval enforced. */
    public PanelSessionService(PanelRepository repository, PanelProperties properties, PanelDevices devices,
            PanelAccessPolicy policy, PanelTokenService tokens, PanelRateLimiter rateLimiter, PanelTx tx,
            UserRepository userRepository, AuthenticationManager authenticationManager) {
        this(repository, properties, devices, policy, tokens, rateLimiter, tx, userRepository, authenticationManager,
                PanelPhase2Properties.allOff(), new NoopPanelActivityIngest(), new NoopPanelLicenceGate(),
                new DefaultPanelApprovalGate(new PanelCompat()), new NoopPanelReleaseOffer());
    }

    @Autowired
    public PanelSessionService(PanelRepository repository, PanelProperties properties, PanelDevices devices,
            PanelAccessPolicy policy, PanelTokenService tokens, PanelRateLimiter rateLimiter, PanelTx tx,
            UserRepository userRepository, AuthenticationManager authenticationManager,
            PanelPhase2Properties phase2, PanelActivityIngest activityIngest, PanelLicenceGate licence,
            PanelApprovalGate approval, PanelReleaseOffer releases) {
        this.repository = repository;
        this.properties = properties;
        this.devices = devices;
        this.policy = policy;
        this.tokens = tokens;
        this.rateLimiter = rateLimiter;
        this.tx = tx;
        this.userRepository = userRepository;
        this.authenticationManager = authenticationManager;
        this.phase2 = phase2;
        this.activityIngest = activityIngest;
        this.licence = licence;
        this.approval = approval;
        this.releases = releases;
    }

    // ---------------------------------------------------------------- sync ---

    /** PK reads, and a write only when something is due or the slide changed. */
    public SyncResponse sync(SyncRequest body, String ip) {
        // The offer, the floor and the licence answer for what the panel reports now (for example
        // the build it has just updated to), not for the row as it was before this sync wrote it.
        DeviceRow device = touchDevice(devices.require(body.deviceId(), body.deviceSecret()), body, ip);

        SyncSession session = null;
        boolean phoneSeen = false;
        Integer activityAck = null;
        if (body.sessionId() != null || body.sessionToken() != null) {
            Optional<SessionRow> row = findOwnedSession(device, body.sessionId(), body.sessionToken());
            if (row.isEmpty()) {
                session = new SyncSession("ENDED", null, 0, 0, null, false);
            } else {
                SessionRow s = row.get();
                String endReason = endedReason(s);
                if (endReason != null) {
                    session = new SyncSession("ENDED", endReason, 0, s.remoteNavCounter(), null, false);
                } else {
                    writeSync(s, body);
                    activityAck = ingestSync(device, s, body.activity());
                    phoneSeen = s.remoteSeenAt() != null && s.ageMs(s.remoteSeenAt()) < PanelTimers.PHONE_CONNECTED_MS;
                    session = new SyncSession("ACTIVE", null, s.expiresInSeconds(), s.remoteNavCounter(),
                            s.remoteNavAt() == null ? null : Long.valueOf(s.ageMs(s.remoteNavAt())), phoneSeen);
                }
            }
        }

        int nextPoll = PanelTimers.SIGNED_OUT_SYNC_MS;
        if (session != null && "ACTIVE".equals(session.status())) {
            if (Boolean.TRUE.equals(body.presenting())) {
                nextPoll = phoneSeen ? PanelTimers.PRESENTING_PHONE_SYNC_MS : PanelTimers.PRESENTING_SYNC_MS;
            } else {
                nextPoll = PanelTimers.SIGNED_IN_SYNC_MS;
            }
        }
        if (!properties.isRemoteEnabled()) {
            nextPoll = Math.max(nextPoll, PanelTimers.SIGNED_IN_SYNC_MS);
        }
        if (session != null && "ACTIVE".equals(session.status()) && Boolean.TRUE.equals(body.inMeeting())) {
            nextPoll = Math.min(nextPoll, PanelTimers.MEETING_SYNC_MS);
        }

        // Licence and update offers are for the signed-out screens only: never shown during a class.
        boolean signedIn = session != null && "ACTIVE".equals(session.status());
        SyncLicence licenceBlock = signedIn ? null : licence.syncBlock(device);
        SyncUpdate updateBlock = signedIn ? null : releases.syncBlock(device);
        Integer required = releases.requiredVersionCode(device);

        return new SyncResponse(System.currentTimeMillis(),
                new SyncDevice(device.status(), device.roomName(), device.instituteId(), device.instituteName(),
                        device.themeCode(), approveBase(device), device.passwordLoginAllowed(),
                        device.approvalState()),
                session, new SyncFlags(properties.isVoltLive(), properties.getBbbInAppMinWebview()),
                new SyncPolicy(properties.getIdleMinutes(), properties.getSessionHours()),
                properties.poll(nextPoll), required == null ? properties.getMinAppVersionCode() : required,
                licenceBlock, updateBlock, activityAck);
    }

    private Integer ingestSync(DeviceRow device, SessionRow session, List<ActivityEvent> events) {
        if (events == null || events.isEmpty() || !phase2.isUsageRecording()) {
            return null;
        }
        return activityIngest.ingestSync(device, session, events);
    }

    /** Session starts only: never from refresh, sync, the remote or ATTACH_REMOTE. */
    void requireCanStart(DeviceRow device) {
        approval.requireApproved(device);
        licence.requireCanStart(device);
        releases.requireNotBelowFloor(device);
    }

    public String approveBase(DeviceRow device) {
        return device.approveBaseUrl() == null ? properties.getApproveDefaultBaseUrl() : device.approveBaseUrl();
    }

    /** Writes what the panel reported and answers the row as it now stands. */
    private DeviceRow touchDevice(DeviceRow device, SyncRequest body, String ip) {
        String channel = body.appChannel() != null && APP_CHANNELS.contains(body.appChannel()) ? body.appChannel()
                : null;
        boolean seenDue = device.lastSeenAt() == null || device.dbNow().getTime()
                - device.lastSeenAt().getTime() >= PanelTimers.LAST_SEEN_WRITE_S * 1000L;
        if (seenDue) {
            repository.touchDeviceSeen(device.id(), ip, body.appVersionCode(), body.webviewMajor(), channel,
                    PanelTimers.LAST_SEEN_WRITE_S);
        } else if (changed(body.appVersionCode(), device.appVersionCode())
                || changed(body.webviewMajor(), device.webviewMajor())
                || (channel != null && !channel.equals(device.appChannel()))) {
            repository.updateDeviceVersions(device.id(), body.appVersionCode(), body.webviewMajor(), channel);
        }
        return device.withReported(body.appVersionCode(), body.webviewMajor(), channel);
    }

    private static boolean changed(Integer sent, Integer stored) {
        return sent != null && !sent.equals(stored);
    }

    private Optional<SessionRow> findOwnedSession(DeviceRow device, String sessionId, String sessionToken) {
        if (sessionId == null || sessionId.length() > 36 || sessionToken == null
                || PanelSecrets.hasControlChars(sessionId)) {
            return Optional.empty();
        }
        return repository.findSession(sessionId)
                .filter(s -> device.id().equals(s.deviceId()) && PanelSecrets.matches(sessionToken, s.refreshHash()));
    }

    /** Null while live. A session past its cap is ended here, the first time anything looks at it. */
    private String endedReason(SessionRow session) {
        if (!session.active()) {
            return session.endReason();
        }
        if (session.pastCap()) {
            repository.endSession(session.id(), "EXPIRED", null);
            return "EXPIRED";
        }
        return null;
    }

    private void writeSync(SessionRow s, SyncRequest body) {
        boolean seenDue = s.panelSeenAt() == null || s.ageMs(s.panelSeenAt()) >= PanelTimers.PANEL_SEEN_WRITE_S * 1000L;
        NavState state = body.state();
        boolean writeState = false;
        Integer index = null;
        Integer total = null;
        String title = null;
        if (Boolean.TRUE.equals(body.presenting()) && state != null) {
            index = state.index();
            total = state.total();
            title = truncateTitle(state.title());
            writeState = !Objects.equals(index, s.stateIndex()) || !Objects.equals(total, s.stateTotal())
                    || !Objects.equals(title, s.stateTitle());
        } else if (Boolean.FALSE.equals(body.presenting())) {
            writeState = s.stateIndex() != null || s.stateTotal() != null || s.stateTitle() != null;
        }
        if (seenDue || writeState) {
            repository.writeSessionSync(s.id(), seenDue, writeState, index, total, title);
        }
    }

    private static String truncateTitle(String title) {
        if (title == null) {
            return "";
        }
        return title.length() > MAX_TITLE ? title.substring(0, MAX_TITLE) : title;
    }

    // ------------------------------------------------------------- refresh ---

    private record RefreshResult(String accessToken, long sessionExpiresIn, boolean ended, String reason) {
        static RefreshResult ended(String reason) {
            return new RefreshResult(null, 0, true, reason);
        }
    }

    public SessionRefreshResponse refresh(SessionRefreshRequest body) {
        DeviceRow device = devices.require(body.deviceId(), body.deviceSecret());
        if (body.sessionToken() == null || body.sessionToken().length() > PanelSecrets.MAX_TOKEN_LENGTH) {
            throw PanelApiException.sessionEnded(null);
        }
        String hash = PanelSecrets.sha256Hex(body.sessionToken());
        RefreshResult result = tx.run(() -> refreshInTx(device, hash));
        if (result.ended()) {
            throw PanelApiException.sessionEnded(result.reason());
        }
        return new SessionRefreshResponse(result.accessToken(), PanelTokenService.ACCESS_TOKEN_TTL_SECONDS,
                result.sessionExpiresIn(), System.currentTimeMillis());
    }

    /** Failing any check ends the session with that reason and commits, then answers SESSION_ENDED. */
    private RefreshResult refreshInTx(DeviceRow device, String tokenHash) {
        Optional<SessionRow> found = repository.findSessionByRefreshHash(tokenHash)
                .filter(s -> device.id().equals(s.deviceId()));
        if (found.isEmpty()) {
            return RefreshResult.ended(null);
        }
        SessionRow session = found.get();
        String ended = endedReason(session);
        if (ended != null) {
            return RefreshResult.ended(ended);
        }
        if (session.ageMs(session.lastRefreshedAt()) > PanelTimers.DEAD_MAN_MS) {
            return endWith(session, "DEAD_MAN");
        }
        if (!"ACTIVE".equals(device.status())) {
            return endWith(session, "UNBOUND");
        }
        try {
            policy.check(session.userId(), session.instituteId(), device.instituteName());
        } catch (PanelApiException | VacademyException e) {
            return endWith(session, "ACCESS_REMOVED");
        }
        Optional<User> user = userRepository.findById(session.userId());
        if (user.isEmpty() || repository.markRefreshed(session.id()) == 0) {
            return RefreshResult.ended(null);
        }
        String jwt = tokens.mint(user.get(), session.instituteId(), session.id());
        return new RefreshResult(jwt, session.expiresInSeconds(), false, null);
    }

    private RefreshResult endWith(SessionRow session, String reason) {
        repository.endSession(session.id(), reason, null);
        return RefreshResult.ended(reason);
    }

    // ------------------------------------------------------------ session ---

    public EndedResponse end(SessionEndRequest body) {
        DeviceRow device = devices.require(body.deviceId(), body.deviceSecret());
        if (body.reason() == null || !CLIENT_END_REASONS.contains(body.reason())) {
            throw PanelApiException.badRequest("Unknown reason");
        }
        if (body.sessionToken() != null) {
            if (body.sessionToken().length() <= PanelSecrets.MAX_TOKEN_LENGTH) {
                repository.findSessionByRefreshHash(PanelSecrets.sha256Hex(body.sessionToken()))
                        .filter(s -> device.id().equals(s.deviceId()))
                        .ifPresent(s -> endFromPanel(device, s, body));
            }
        } else {
            repository.endActiveSessionOfDevice(device.id(), body.reason(), null);
        }
        return new EndedResponse(true);
    }

    /**
     * Activity first, so the events of the last minutes land before the session closes. With
     * recording on, an IDLE end also records active_until, idle_minutes plus the countdown back.
     */
    private void endFromPanel(DeviceRow device, SessionRow session, SessionEndRequest body) {
        if (phase2.isUsageRecording() && body.activity() != null && !body.activity().isEmpty()) {
            activityIngest.ingestEnd(device, session, body.activity());
        }
        if (phase2.isUsageRecording() && "IDLE".equals(body.reason())) {
            repository.endSessionWithActiveUntil(session.id(), body.reason(), null,
                    properties.getIdleMinutes() * 60 + IDLE_COUNTDOWN_S);
        } else {
            repository.endSession(session.id(), body.reason(), null);
        }
    }

    /**
     * Call inside a transaction. Ends the session this device holds and any session this user holds
     * elsewhere, then inserts the new one. Competing sign-ins for this device or user wait on the locks
     * here, always device first then user so they cannot deadlock, and so each ends the one before it.
     * The partial unique indexes stay as the backstop. A user starts at most
     * panel.limits.session-starts-per-user-per-hour sessions an hour on each pod (default 20).
     */
    public String startSessionInTx(DeviceRow device, String userId, String startedVia, String refreshHash,
            String remoteHash) {
        rateLimiter.check("session_start", userId, properties.getSessionStartsPerUserPerHour(),
                PanelRateLimiter.HOUR_MS);
        repository.lockForTransaction("panel_session:device:" + device.id());
        repository.lockForTransaction("panel_session:user:" + userId);
        String sessionId = UUID.randomUUID().toString();
        for (int attempt = 0; attempt < SESSION_INSERT_ATTEMPTS; attempt++) {
            repository.endActiveSessionOfDevice(device.id(), "REPLACED", null);
            repository.endActiveSessionOfUser(userId, "SUPERSEDED");
            int inserted = repository.insertSession(sessionId, device.id(), device.instituteId(), device.roomId(),
                    userId, startedVia, refreshHash, remoteHash, properties.getSessionHours());
            if (inserted == 1) {
                return sessionId;
            }
        }
        throw PanelApiException.tryAgain();
    }

    /** Static on purpose: this takes a plain token, and the shared logging aspect prints arguments of proxied calls. */
    static RedeemedSession redeemedBody(PanelTokenService tokens, SessionRow session, User user, String sessionToken) {
        return new RedeemedSession(tokens.mint(user, session.instituteId(), session.id()), sessionToken, session.id(),
                PanelTokenService.ACCESS_TOKEN_TTL_SECONDS, session.expiresInSeconds(),
                new UserRef(user.getId(), user.getFullName()), session.instituteId(), System.currentTimeMillis());
    }

    /**
     * Off per panel until an admin turns it on. Authenticates the same way as a normal password login
     * and never touches the user's refresh_token row, so it signs nobody out elsewhere.
     */
    public RedeemedSession loginPassword(LoginPasswordRequest body) {
        properties.requireEnabled();
        DeviceRow device = devices.requireActive(body.deviceId(), body.deviceSecret());
        if (!device.passwordLoginAllowed()) {
            throw new PanelApiException(HttpStatus.FORBIDDEN, "PASSWORD_DISABLED",
                    "Password sign-in is off for this panel");
        }
        properties.requireInstituteAllowed(device.instituteId());
        requireCanStart(device);
        String username = body.username() == null ? "" : body.username();
        String password = body.password();
        if (username.isBlank() || password == null || username.length() > MAX_CREDENTIAL_LENGTH
                || password.length() > MAX_CREDENTIAL_LENGTH || PanelSecrets.hasControlChars(username)) {
            throw badCredentials();
        }
        // Keyed by a fixed-size hash, so the limiter holds no caller-chosen text.
        rateLimiter.check("login_password_device", device.id(), PanelRateLimiter.LOGIN_PASSWORD_PER_DEVICE);
        rateLimiter.check("login_password", device.id() + ":" + PanelSecrets.sha256Hex(username.toLowerCase(Locale.ROOT)),
                PanelRateLimiter.LOGIN_PASSWORD_PER_KEY);
        CustomUserDetails principal = authenticate(device.instituteId(), username, password);
        return tx.run(() -> {
            policy.check(principal.getUserId(), device.instituteId(), device.instituteName());
            User user = userRepository.findById(principal.getUserId()).orElseThrow(PanelSessionService::badCredentials);
            String sessionToken = PanelSecrets.token(TOKEN_BYTES);
            String sessionId = startSessionInTx(device, user.getId(), "PASSWORD",
                    PanelSecrets.sha256Hex(sessionToken), null);
            SessionRow session = repository.findSession(sessionId).orElseThrow();
            return redeemedBody(tokens, session, user, sessionToken);
        });
    }

    private CustomUserDetails authenticate(String instituteId, String username, String password) {
        try {
            Authentication authentication = authenticationManager
                    .authenticate(new UsernamePasswordAuthenticationToken(instituteId + "@" + username, password));
            if (authentication.isAuthenticated() && authentication.getPrincipal() instanceof CustomUserDetails details) {
                return details;
            }
        } catch (AuthenticationException e) {
            throw badCredentials();
        }
        throw badCredentials();
    }

    private static PanelApiException badCredentials() {
        return new PanelApiException(HttpStatus.UNAUTHORIZED, "BAD_CREDENTIALS", "Wrong username or password");
    }

    // -------------------------------------------------------------- remote ---

    public RemoteNavResponse remoteNav(RemoteNavRequest body) {
        Integer delta = body.delta();
        Long seq = body.clientSeq();
        if (delta == null || (delta != 1 && delta != -1) || seq == null || seq <= 0) {
            throw PanelApiException.badRequest("delta must be 1 or -1, with a client_seq");
        }
        if (body.remoteToken() == null || body.remoteToken().length() > PanelSecrets.MAX_TOKEN_LENGTH) {
            return new RemoteNavResponse(false, null, "ENDED");
        }
        String hash = PanelSecrets.sha256Hex(body.remoteToken());
        if (!properties.isRemoteEnabled()) {
            boolean live = repository.findSessionByRemoteHash(hash).map(s -> endedReason(s) == null).orElse(false);
            return new RemoteNavResponse(false, null, live ? "ACTIVE" : "ENDED");
        }
        if (repository.remoteNav(hash, delta, seq) == 1) {
            return new RemoteNavResponse(true, null, "ACTIVE");
        }
        Optional<SessionRow> row = repository.findSessionByRemoteHash(hash);
        if (row.isPresent() && endedReason(row.get()) == null && row.get().remoteClientSeq() >= seq) {
            // A retry after a lost response. Refusing it would make the teacher tap again and move twice.
            return new RemoteNavResponse(true, true, "ACTIVE");
        }
        return new RemoteNavResponse(false, null, "ENDED");
    }

    public RemoteStateResponse remoteState(RemoteTokenRequest body) {
        Optional<SessionRow> row = body.remoteToken() == null
                || body.remoteToken().length() > PanelSecrets.MAX_TOKEN_LENGTH
                        ? Optional.empty()
                        : repository.findSessionByRemoteHash(PanelSecrets.sha256Hex(body.remoteToken()));
        if (row.isEmpty() || endedReason(row.get()) != null) {
            return new RemoteStateResponse("ENDED", row.map(SessionRow::instituteId).orElse(null), null, null, null,
                    null, false, 0);
        }
        SessionRow s = row.get();
        if (s.remoteSeenAt() == null || s.ageMs(s.remoteSeenAt()) >= PanelTimers.REMOTE_SEEN_WRITE_S * 1000L) {
            repository.touchRemoteSeen(s.id(), PanelTimers.REMOTE_SEEN_WRITE_S);
        }
        String roomName = repository.findDevice(s.deviceId()).map(DeviceRow::roomName).orElse(null);
        boolean online = s.panelSeenAt() != null && s.ageMs(s.panelSeenAt()) < PanelTimers.PANEL_ONLINE_MS;
        return new RemoteStateResponse("ACTIVE", s.instituteId(), roomName, s.stateIndex(), s.stateTotal(),
                s.stateTitle(), online, s.expiresInSeconds());
    }

    public EndedResponse remoteEnd(RemoteTokenRequest body) {
        if (body.remoteToken() != null && body.remoteToken().length() <= PanelSecrets.MAX_TOKEN_LENGTH) {
            repository.findSessionByRemoteHash(PanelSecrets.sha256Hex(body.remoteToken()))
                    .ifPresent(s -> repository.endSession(s.id(), "PHONE", null));
        }
        return new EndedResponse(true);
    }

    // ---------------------------------------------------------- my session ---

    public Optional<MySessionResponse> mySession(CustomUserDetails user) {
        Optional<SessionRow> row = repository.findActiveSessionOfUser(user.getUserId());
        if (row.isEmpty() || endedReason(row.get()) != null) {
            return Optional.empty();
        }
        SessionRow s = row.get();
        String roomName = repository.findDevice(s.deviceId()).map(DeviceRow::roomName).orElse(null);
        return Optional.of(new MySessionResponse(s.id(), s.instituteId(), roomName, s.expiresInSeconds()));
    }

    public EndedResponse mySessionEnd(CustomUserDetails user) {
        repository.findActiveSessionOfUser(user.getUserId())
                .ifPresent(s -> repository.endSession(s.id(), "PHONE", user.getUserId()));
        return new EndedResponse(true);
    }
}
