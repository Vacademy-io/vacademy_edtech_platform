package vacademy.io.auth_service.feature.panel.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.DeviceClaimRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.DeviceClaimResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PairConfirmRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PairPollRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PairPollResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PairPreviewRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PairPreviewResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PairStartRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PairStartResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomRef;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.StatusResponse;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.NewDevice;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.PairingRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.RoomRow;
import vacademy.io.auth_service.feature.panel.phase2.NoopPanelLicenceGate;
import vacademy.io.auth_service.feature.panel.phase2.PanelLicenceGate;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Panel-generated pairing: a code on the panel, a number tap by an institute admin, a confirm on the
 * panel. Only panel_pairing is written until an admin claims, so an anonymous caller cannot create a
 * device.
 */
@Service
public class PanelPairingService {

    private static final int MAX_INSTALL_ID = 64;
    private static final int MAX_DEVICE_FIELD = 120;
    private static final int MAX_DEVICE_INFO = 600;
    private static final int MAX_ROOM_NAME = 120;
    private static final int TOKEN_BYTES = 32;
    private static final long PENDING_CAP = 10_000;
    private static final long PENDING_COUNT_TTL_MS = 10_000;
    private static final int INSERT_ATTEMPTS = 3;
    /** An institute id travels into an internal URL before the caller is authorised, so it is checked first. */
    private static final Pattern INSTITUTE_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    private final PanelRepository repository;
    private final PanelProperties properties;
    private final PanelRateLimiter rateLimiter;
    private final PanelMaintenance maintenance;
    private final PanelDevices devices;
    private final PanelTx tx;
    private final PanelInstituteDirectory directory;
    private final InstituteOAuthClientAccessGuard accessGuard;
    private final PanelLicenceGate licence;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private volatile long pendingCount;
    private volatile long pendingCountReadAt;

    /** Phase 1 wiring, for tests: the placeholder licence seam. */
    public PanelPairingService(PanelRepository repository, PanelProperties properties, PanelRateLimiter rateLimiter,
            PanelMaintenance maintenance, PanelDevices devices, PanelTx tx, PanelInstituteDirectory directory,
            InstituteOAuthClientAccessGuard accessGuard) {
        this(repository, properties, rateLimiter, maintenance, devices, tx, directory, accessGuard,
                new NoopPanelLicenceGate());
    }

    @Autowired
    public PanelPairingService(PanelRepository repository, PanelProperties properties, PanelRateLimiter rateLimiter,
            PanelMaintenance maintenance, PanelDevices devices, PanelTx tx, PanelInstituteDirectory directory,
            InstituteOAuthClientAccessGuard accessGuard, PanelLicenceGate licence) {
        this.licence = licence;
        this.repository = repository;
        this.properties = properties;
        this.rateLimiter = rateLimiter;
        this.maintenance = maintenance;
        this.devices = devices;
        this.tx = tx;
        this.directory = directory;
        this.accessGuard = accessGuard;
    }

    public PairStartResponse start(PairStartRequest body, String ip) {
        rateLimiter.checkIp("pair_start", ip, PanelRateLimiter.PAIR_START_PER_IP);
        String deviceInfo = validateStart(body);
        properties.requireEnabled();
        if (pendingCapReached()) {
            throw PanelApiException.busy(HttpStatus.SERVICE_UNAVAILABLE);
        }
        maintenance.maybePurge();
        for (int attempt = 0; attempt < INSERT_ATTEMPTS; attempt++) {
            String code = PanelSecrets.code();
            String secret = PanelSecrets.token(TOKEN_BYTES);
            PanelSecrets.MatchNumbers numbers = PanelSecrets.matchNumbers();
            int inserted = repository.insertPairing(UUID.randomUUID().toString(), PanelSecrets.sha256Hex(code),
                    PanelSecrets.sha256Hex(secret), numbers.matchCode(), numbers.options(), body.installId(),
                    deviceInfo, ip, PanelTimers.PAIR_TTL_S);
            if (inserted == 1) {
                return new PairStartResponse(secret, code, numbers.matchCode(),
                        properties.getApproveDefaultBaseUrl() + "/classroom#pair=" + code, PanelTimers.PAIR_TTL_S,
                        properties.poll(PanelTimers.PAIR_POLL_MS));
            }
        }
        throw PanelApiException.tryAgain();
    }

    /** All length checks happen before any database call. Returns the serialized device report. */
    private String validateStart(PairStartRequest body) {
        String installId = body.installId();
        if (installId == null || installId.isBlank() || installId.length() > MAX_INSTALL_ID
                || PanelSecrets.hasControlChars(installId)) {
            throw PanelApiException.badRequest("Invalid device details");
        }
        Map<String, Object> device = body.device() == null ? Map.of() : body.device();
        if (text(device.get("manufacturer")).map(String::length).orElse(0) > MAX_DEVICE_FIELD
                || text(device.get("model")).map(String::length).orElse(0) > MAX_DEVICE_FIELD) {
            throw PanelApiException.badRequest("Invalid device details");
        }
        String serialized;
        try {
            serialized = objectMapper.writeValueAsString(device);
        } catch (JsonProcessingException e) {
            throw PanelApiException.badRequest("Invalid device details");
        }
        if (serialized.length() > MAX_DEVICE_INFO) {
            throw PanelApiException.badRequest("Invalid device details");
        }
        return serialized;
    }

    /** True while more panels are waiting to pair than the cap allows. Answers, never throws. */
    public boolean pendingCapReached() {
        return cachedPendingCount() > PENDING_CAP;
    }

    /** Counted at most once per 10 s per pod, so the cap never costs a query per request. */
    private long cachedPendingCount() {
        long now = System.currentTimeMillis();
        if (now - pendingCountReadAt >= PENDING_COUNT_TTL_MS) {
            pendingCountReadAt = now;
            pendingCount = repository.countLivePendingPairings();
        }
        return pendingCount;
    }

    public PairPollResponse poll(PairPollRequest body) {
        int after = properties.poll(PanelTimers.PAIR_POLL_MS);
        String secret = body.pairSecret();
        if (secret == null || secret.length() > PanelSecrets.MAX_TOKEN_LENGTH) {
            return PairPollResponse.of("EXPIRED", after);
        }
        Optional<PairingRow> found = repository.findPairingBySecretHash(PanelSecrets.sha256Hex(secret));
        if (found.isEmpty()) {
            return PairPollResponse.of("EXPIRED", after);
        }
        PairingRow pairing = found.get();
        return switch (pairing.state()) {
            case "CANCELLED" -> PairPollResponse.of("CANCELLED", after);
            case "PENDING" -> PairPollResponse.of(pairing.unexpired() ? "PENDING" : "EXPIRED", after);
            case "CLAIMED" -> tx.run(() -> mintDeviceSecret(pairing, after));
            default -> PairPollResponse.of("EXPIRED", after);
        };
    }

    /** The first poll after a claim mints the secret. A retry inside 60 s overwrites it. */
    private PairPollResponse mintDeviceSecret(PairingRow pairing, int after) {
        if (repository.markPairingPickedUp(pairing.id(), PanelTimers.REPEAT_WINDOW_S) == 0) {
            return PairPollResponse.of("EXPIRED", after);
        }
        String secret = PanelSecrets.token(TOKEN_BYTES);
        if (repository.setClaimedDeviceSecret(pairing.deviceId(), PanelSecrets.sha256Hex(secret)) == 0) {
            return PairPollResponse.of("EXPIRED", after);
        }
        DeviceRow device = repository.findDevice(pairing.deviceId()).orElseThrow();
        return new PairPollResponse("CLAIMED", after, device.id(), secret, device.instituteId(),
                device.instituteName(), device.themeCode(), new RoomRef(device.roomId(), device.roomName()),
                device.claimedByName(), device.installedByName());
    }

    public StatusResponse confirm(PairConfirmRequest body) {
        DeviceRow device = devices.require(body.deviceId(), body.deviceSecret());
        if (body.accept() == null) {
            throw PanelApiException.badRequest("accept is required");
        }
        if (body.accept()) {
            if ("CLAIMED".equals(device.status())) {
                // Only the call that moved CLAIMED to ACTIVE tells the seat logic, in the same transaction.
                tx.run(() -> {
                    if (repository.confirmDevice(device.id()) == 1) {
                        licence.onActivated(device);
                    }
                    return null;
                });
            }
            return new StatusResponse("ACTIVE");
        }
        if ("ACTIVE".equals(device.status())) {
            throw new PanelApiException(HttpStatus.CONFLICT, "DEVICE_NOT_ACTIVE", "This panel is already confirmed");
        }
        tx.run(() -> {
            devices.revokeInTx(device.id(), null);
            repository.cancelPairingOfDevice(device.id());
            return null;
        });
        return new StatusResponse("CANCELLED");
    }

    public PairPreviewResponse preview(CustomUserDetails user, PairPreviewRequest body) {
        rateLimiter.check("pair_preview", user.getUserId(), PanelRateLimiter.PAIR_PREVIEW_PER_USER);
        String code = PanelSecrets.normaliseCode(body.code());
        if (code == null) {
            throw noPanelShowingCode();
        }
        PairingRow pairing = repository.findPairingByCodeHash(PanelSecrets.sha256Hex(code))
                .filter(row -> "PENDING".equals(row.state()) && row.unexpired())
                .orElseThrow(PanelPairingService::noPanelShowingCode);
        Map<String, Object> reported = parseDevice(pairing.deviceInfo());
        return new PairPreviewResponse(text(reported.get("model")).orElse(null),
                text(reported.get("manufacturer")).orElse(null), number(reported.get("webview_major")),
                PanelSecrets.parseOptions(pairing.matchOptions()), pairing.expiresInSeconds());
    }

    private record ClaimResult(boolean wrongNumber, DeviceClaimResponse response) {
    }

    public DeviceClaimResponse claim(CustomUserDetails user, DeviceClaimRequest body) {
        rateLimiter.check("claim", user.getUserId(), PanelRateLimiter.CLAIM_PER_USER);
        String instituteId = body.instituteId();
        if (instituteId == null || !INSTITUTE_ID.matcher(instituteId).matches() || body.matchCode() == null) {
            throw PanelApiException.badRequest("institute_id and match_code are required");
        }
        properties.requireInstituteAllowed(instituteId);
        // The HTTP wait comes before any repository call on this thread: see PanelInstituteDirectory.
        PanelInstituteDirectory.Snapshot snapshot = directory.get(instituteId)
                .orElseThrow(PanelApiException::tryAgain);
        ClaimResult result = tx.run(() -> claimInTx(user, body, snapshot));
        if (result.wrongNumber()) {
            throw new PanelApiException(HttpStatus.CONFLICT, "WRONG_NUMBER", "That number did not match");
        }
        return result.response();
    }

    private ClaimResult claimInTx(CustomUserDetails user, DeviceClaimRequest body,
            PanelInstituteDirectory.Snapshot snapshot) {
        String instituteId = body.instituteId();
        accessGuard.requireInstituteAdmin(user, instituteId);

        RoomRow existingRoom = null;
        String newRoomName = null;
        if (body.roomId() != null && !body.roomId().isBlank()) {
            existingRoom = requireRoomOf(instituteId, body.roomId());
        } else {
            newRoomName = cleanRoomName(body.newRoomName());
        }

        String code = PanelSecrets.normaliseCode(body.code());
        if (code == null) {
            throw noPanelShowingCode();
        }
        String codeHash = PanelSecrets.sha256Hex(code);
        PairingRow pairing = repository.findPairingByCodeHash(codeHash)
                .filter(row -> "PENDING".equals(row.state()) && row.unexpired())
                .orElseThrow(PanelPairingService::noPanelShowingCode);
        if (pairing.matchCode() != body.matchCode()) {
            repository.cancelPendingPairing(codeHash);
            return new ClaimResult(true, null);
        }

        if (existingRoom != null) {
            // Two claims of one room queue here, so the loser reads the winner as the occupant.
            repository.lockForTransaction("panel_room:" + existingRoom.id());
            Optional<DeviceRow> occupant = repository.findLiveDeviceInRoom(existingRoom.id());
            if (occupant.isPresent()) {
                if (!Boolean.TRUE.equals(body.replaceExisting())) {
                    throw roomOccupied(occupant);
                }
                devices.revokeInTx(occupant.get().id(), user.getUserId());
            }
        }

        String deviceId = UUID.randomUUID().toString();
        if (repository.claimPairing(codeHash, body.matchCode(), deviceId) == 0) {
            throw noPanelShowingCode();
        }

        String roomId;
        String roomName;
        if (existingRoom != null) {
            roomId = existingRoom.id();
            roomName = existingRoom.name();
        } else {
            roomId = UUID.randomUUID().toString();
            roomName = newRoomName;
            if (repository.insertRoom(roomId, instituteId, roomName, user.getUserId()) == 0) {
                throw roomNameTaken();
            }
        }

        Map<String, Object> reported = parseDevice(pairing.deviceInfo());
        int inserted = repository.insertDevice(new NewDevice(deviceId, instituteId, roomId,
                PanelSecrets.sha256Hex(PanelSecrets.token(TOKEN_BYTES)), pairing.installId(),
                snapshot.instituteName(), snapshot.themeCode(), snapshot.approveBaseUrl(),
                text(reported.get("manufacturer")).orElse(null), text(reported.get("model")).orElse(null),
                number(reported.get("sdk_int")), number(reported.get("webview_major")),
                number(reported.get("app_version_code")), user.getUserId(), user.getFullName()));
        if (inserted == 0) {
            throw roomOccupied(repository.findLiveDeviceInRoom(roomId));
        }
        return new ClaimResult(false, new DeviceClaimResponse(deviceId, "CLAIMED", new RoomRef(roomId, roomName)));
    }

    // -------------------------------------------------- shared with rooms ---

    public RoomRow requireRoomOf(String instituteId, String roomId) {
        RoomRow room = repository.findRoom(roomId)
                .filter(row -> instituteId.equals(row.instituteId()))
                .orElseThrow(() -> new PanelApiException(HttpStatus.FORBIDDEN, "ROOM_OTHER_INSTITUTE",
                        "This room is not in this institute"));
        if (!"ACTIVE".equals(room.status())) {
            throw PanelApiException.badRequest("This room is archived");
        }
        return room;
    }

    static String cleanRoomName(String raw) {
        String clean = raw == null ? "" : raw.trim();
        if (clean.isEmpty() || clean.length() > MAX_ROOM_NAME) {
            throw PanelApiException.badRequest("Room name must be 1 to 120 characters");
        }
        return clean;
    }

    static PanelApiException roomNameTaken() {
        return new PanelApiException(HttpStatus.CONFLICT, "ROOM_NAME_TAKEN", "A room with this name exists");
    }

    static PanelApiException roomOccupied(Optional<DeviceRow> occupant) {
        PanelApiException error = new PanelApiException(HttpStatus.CONFLICT, "ROOM_OCCUPIED",
                "This room already has a panel");
        occupant.ifPresent(device -> {
            Map<String, Object> current = new HashMap<>();
            current.put("id", device.id());
            current.put("model", device.model());
            current.put("last_seen_at", device.lastSeenAt() == null ? null : iso(device.lastSeenAt().toInstant()));
            error.with("current_device", current);
        });
        return error;
    }

    static String iso(Instant instant) {
        return instant.toString();
    }

    private static PanelApiException noPanelShowingCode() {
        return PanelApiException.notFound("No panel is showing this code");
    }

    private Map<String, Object> parseDevice(String deviceInfo) {
        if (deviceInfo == null) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(deviceInfo, new TypeReference<>() {
            });
        } catch (JsonProcessingException e) {
            return Map.of();
        }
    }

    private static Optional<String> text(Object value) {
        return value == null ? Optional.empty() : Optional.of(String.valueOf(value));
    }

    private static Integer number(Object value) {
        return value instanceof Number n ? Integer.valueOf(n.intValue()) : null;
    }
}
