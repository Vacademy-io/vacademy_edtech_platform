package vacademy.io.auth_service.feature.panel.phase2.partner;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.DeviceClaimResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerClaimRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerCustomerRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerInstallRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerLinkRedeemRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerLinkRedeemResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerMeResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerRef;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerRoomRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomRef;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Errors;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelInputs;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerRepository.InviteRow;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerRepository.LinkRow;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerRepository.PartnerRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.NewDevice;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.PairingRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.RoomRow;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelInstituteDirectory;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;
import vacademy.io.auth_service.feature.panel.service.PanelRateLimiter;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;
import vacademy.io.auth_service.feature.panel.service.PanelTimers;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The installer's side: staff of an installer organisation set up panels at schools that linked
 * them. An installer is a user with an ACTIVE role named in panel.partners.installer-roles at the
 * organisation's own institute, read from user_role (never from token claims), while the
 * organisation is ACTIVE. Everything answers 404 FEATURE_OFF while panel.partners.enabled is false.
 *
 * <p>An installer can only reach a school through an ACTIVE link, can set up panels only while the
 * link's install window is open, never replaces a panel, and sees only the health of panels its own
 * organisation set up. Its panels wait as PENDING until a school admin approves them.
 */
@Service
public class PanelInstallerService {

    public static final int REDEEM_PER_USER_PER_HOUR = 10;
    private static final int INSTALLS_LIMIT = 500;
    private static final int NAME_FILLS_PER_LIST = 5;
    private static final int TOKEN_BYTES = 32;
    private static final int MAX_ROOM_NAME = 120;

    private final PanelPartnerRepository partners;
    private final PanelRepository panels;
    private final PanelPhase2Properties phase2;
    private final PanelProperties properties;
    private final PanelRateLimiter rateLimiter;
    private final PanelTx tx;
    private final PanelInstituteDirectory directory;
    private final UserRoleRepository userRoles;
    private final PanelPartnerNames names;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public PanelInstallerService(PanelPartnerRepository partners, PanelRepository panels,
            PanelPhase2Properties phase2, PanelProperties properties, PanelRateLimiter rateLimiter, PanelTx tx,
            PanelInstituteDirectory directory, UserRoleRepository userRoles, PanelPartnerNames names) {
        this.partners = partners;
        this.panels = panels;
        this.phase2 = phase2;
        this.properties = properties;
        this.rateLimiter = rateLimiter;
        this.tx = tx;
        this.directory = directory;
        this.userRoles = userRoles;
        this.names = names;
    }

    // -------------------------------------------------------------- who ---

    /** The organisation this user installs for, if any: the oldest ACTIVE one where they hold an installer role. */
    public Optional<PartnerRow> installerPartner(CustomUserDetails user) {
        if (user == null || user.getUserId() == null || user.getUserId().isBlank()) {
            return Optional.empty();
        }
        List<String> institutes = userRoles
                .findUserRolesByUserIdAndStatusesAndRoleNames(user.getUserId(), List.of("ACTIVE"),
                        phase2.getInstallerRoles())
                .stream()
                .map(role -> role.getInstituteId())
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .toList();
        return partners.findActivePartnerOfInstitutes(institutes);
    }

    PartnerRow requireInstaller(CustomUserDetails user) {
        return installerPartner(user).orElseThrow(PanelPhase2Errors::notInstaller);
    }

    /** No link, a revoked link, or (when installing) a closed window all read the same. */
    private static PanelApiException notLinked() {
        return new PanelApiException(HttpStatus.FORBIDDEN, PanelPhase2Errors.NOT_INSTALLER,
                "This school has not linked your organisation");
    }

    private LinkRow requireLink(PartnerRow partner, String instituteId, boolean toInstall) {
        return partners.findActiveLink(partner.id(), instituteId)
                .filter(link -> !toInstall || link.installUntilOpen())
                .orElseThrow(PanelInstallerService::notLinked);
    }

    public PartnerMeResponse me(CustomUserDetails user) {
        phase2.requirePartners();
        return tx.run(() -> {
            PartnerRow partner = requireInstaller(user);
            return new PartnerMeResponse(new PartnerRef(partner.id(), partner.name()));
        });
    }

    // ------------------------------------------------------------- links ---

    /**
     * Single use, 10 attempts an hour per user. The code is consumed only for an installer, so
     * someone without the role cannot burn a school's code. A second code from the same school
     * extends the existing link's install window rather than adding a link.
     */
    public PartnerLinkRedeemResponse redeem(CustomUserDetails user, PartnerLinkRedeemRequest body) {
        phase2.requirePartners();
        rateLimiter.check("partner_redeem", user.getUserId(), REDEEM_PER_USER_PER_HOUR, PanelRateLimiter.HOUR_MS);
        String code = PanelSecrets.normaliseCode(body == null ? null : body.code());
        if (code == null) {
            throw PanelPhase2Errors.inviteInvalid();
        }
        String codeHash = PanelSecrets.sha256Hex(code);
        LinkRow link = tx.run(() -> {
            PartnerRow partner = requireInstaller(user);
            InviteRow invite = partners.consumeInvite(codeHash, partner.id())
                    .orElseThrow(PanelPhase2Errors::inviteInvalid);
            panels.lockForTransaction("panel_partner_link:" + partner.id() + ":" + invite.instituteId());
            Optional<LinkRow> existing = partners.findActiveLink(partner.id(), invite.instituteId());
            String linkId;
            if (existing.isEmpty() && partners.revokedSinceInvite(partner.id(), invite.instituteId(), invite.id())) {
                // A code created before the school revoked this organisation does not link it again.
                partners.cancelConsumedInvite(invite.id());
                return null;
            }
            if (existing.isPresent()) {
                linkId = existing.get().id();
                partners.extendLinkByDays(linkId, invite.installDays());
            } else {
                linkId = UUID.randomUUID().toString();
                if (partners.insertLink(linkId, partner.id(), invite.instituteId(), "SCHOOL_CODE", null,
                        invite.installDays(), user.getUserId()) == 0) {
                    throw PanelApiException.tryAgain();
                }
            }
            return partners.findLink(linkId).orElseThrow();
        });
        if (link == null) {
            throw PanelPhase2Errors.inviteInvalid();
        }
        // After the commit, and off the request thread: see PanelPartnerNames.
        if (link.instituteName() == null) {
            names.fillAsync(link.id(), link.instituteId());
        }
        return new PartnerLinkRedeemResponse(link.id(), link.instituteId(), link.instituteName(),
                PanelInputs.iso(link.installUntil()));
    }

    public List<PartnerCustomerRow> customers(CustomUserDetails user) {
        phase2.requirePartners();
        List<LinkRow> links = tx.run(() -> partners.listActiveLinksOfPartner(requireInstaller(user).id()));
        links.stream().filter(link -> link.instituteName() == null).limit(NAME_FILLS_PER_LIST)
                .forEach(link -> names.fillAsync(link.id(), link.instituteId()));
        return links.stream()
                .map(link -> new PartnerCustomerRow(link.instituteId(), link.instituteName(),
                        PanelInputs.iso(link.installUntil())))
                .toList();
    }

    /** Names and whether a panel is there: nothing else about the school's rooms. */
    public List<PartnerRoomRow> rooms(CustomUserDetails user, String instituteId) {
        phase2.requirePartners();
        PanelInputs.instituteId(instituteId);
        return tx.run(() -> {
            requireLink(requireInstaller(user), instituteId, true);
            return panels.listRooms(instituteId).stream()
                    .filter(room -> "ACTIVE".equals(room.status()))
                    .map(room -> new PartnerRoomRow(room.id(), room.name(), room.deviceId() != null))
                    .toList();
        });
    }

    /** Health only: no teachers, no sessions, no usage. */
    public List<PartnerInstallRow> installs(CustomUserDetails user, String instituteId) {
        phase2.requirePartners();
        PanelInputs.instituteId(instituteId);
        return tx.run(() -> {
            PartnerRow partner = requireInstaller(user);
            requireLink(partner, instituteId, false);
            return partners.listInstalls(partner.id(), instituteId, INSTALLS_LIMIT).stream()
                    .map(row -> new PartnerInstallRow(row.deviceId(), new RoomRef(row.roomId(), row.roomName()),
                            row.status(), row.approvalState(),
                            row.lastSeenAt() != null && row.dbNow().getTime() - row.lastSeenAt().getTime()
                                    < PanelTimers.DEVICE_ONLINE_MS,
                            PanelInputs.iso(row.lastSeenAt()), row.appVersionCode(), row.webviewMajor()))
                    .toList();
        });
    }

    // ------------------------------------------------------------- claim ---

    private record ClaimResult(boolean wrongNumber, DeviceClaimResponse response) {
    }

    /**
     * The admin claim without replace: the same code and number check, but the panel lands PENDING
     * with the organisation recorded, and the room is attributed to it if it had no attribution.
     */
    public DeviceClaimResponse claim(CustomUserDetails user, PartnerClaimRequest body) {
        phase2.requirePartners();
        rateLimiter.check("partner_claim", user.getUserId(), PanelRateLimiter.CLAIM_PER_USER);
        if (body == null || body.matchCode() == null) {
            throw PanelApiException.badRequest("institute_id and match_code are required");
        }
        String instituteId = PanelInputs.instituteId(body.instituteId());
        properties.requireInstituteAllowed(instituteId);
        // The HTTP wait comes before any repository call on this thread: see PanelInstituteDirectory.
        PanelInstituteDirectory.Snapshot snapshot = directory.get(instituteId)
                .orElseThrow(PanelApiException::tryAgain);
        ClaimResult result = tx.run(() -> claimInTx(user, body, instituteId, snapshot));
        if (result.wrongNumber()) {
            throw new PanelApiException(HttpStatus.CONFLICT, "WRONG_NUMBER", "That number did not match");
        }
        return result.response();
    }

    private ClaimResult claimInTx(CustomUserDetails user, PartnerClaimRequest body, String instituteId,
            PanelInstituteDirectory.Snapshot snapshot) {
        PartnerRow partner = requireInstaller(user);
        requireLink(partner, instituteId, true);

        RoomRow existingRoom = null;
        String newRoomName = null;
        if (body.roomId() != null && !body.roomId().isBlank()) {
            existingRoom = panels.findRoom(body.roomId())
                    .filter(room -> instituteId.equals(room.instituteId()))
                    .orElseThrow(() -> new PanelApiException(HttpStatus.FORBIDDEN, "ROOM_OTHER_INSTITUTE",
                            "This room is not in this institute"));
            if (!"ACTIVE".equals(existingRoom.status())) {
                throw PanelApiException.badRequest("This room is archived");
            }
        } else {
            newRoomName = PanelInputs.text(body.newRoomName(), MAX_ROOM_NAME, "Room name");
        }

        String code = PanelSecrets.normaliseCode(body.code());
        if (code == null) {
            throw noPanelShowingCode();
        }
        String codeHash = PanelSecrets.sha256Hex(code);
        PairingRow pairing = panels.findPairingByCodeHash(codeHash)
                .filter(row -> "PENDING".equals(row.state()) && row.unexpired())
                .orElseThrow(PanelInstallerService::noPanelShowingCode);
        if (pairing.matchCode() != body.matchCode()) {
            panels.cancelPendingPairing(codeHash);
            return new ClaimResult(true, null);
        }

        if (existingRoom != null) {
            // Same lock as the admin claim and archive: a racing claim reads the winner as the occupant.
            panels.lockForTransaction("panel_room:" + existingRoom.id());
            if (panels.findLiveDeviceInRoom(existingRoom.id()).isPresent()) {
                throw roomOccupied();
            }
        }

        String deviceId = UUID.randomUUID().toString();
        if (panels.claimPairing(codeHash, body.matchCode(), deviceId) == 0) {
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
            if (panels.insertRoom(roomId, instituteId, roomName, user.getUserId()) == 0) {
                throw new PanelApiException(HttpStatus.CONFLICT, "ROOM_NAME_TAKEN", "A room with this name exists");
            }
        }

        Map<String, Object> reported = parseDevice(pairing.deviceInfo());
        int inserted = panels.insertDevice(new NewDevice(deviceId, instituteId, roomId,
                PanelSecrets.sha256Hex(PanelSecrets.token(TOKEN_BYTES)), pairing.installId(),
                snapshot.instituteName(), snapshot.themeCode(), snapshot.approveBaseUrl(),
                text(reported.get("manufacturer")), text(reported.get("model")), number(reported.get("sdk_int")),
                number(reported.get("webview_major")), number(reported.get("app_version_code")), user.getUserId(),
                user.getFullName()));
        if (inserted == 0) {
            throw roomOccupied();
        }
        partners.markInstalledBy(deviceId, partner.id());
        partners.attributeRoomIfUnset(roomId, partner.id());
        return new ClaimResult(false, new DeviceClaimResponse(deviceId, "CLAIMED", new RoomRef(roomId, roomName)));
    }

    /** No details about the panel already there: the installer only learns the room is taken. */
    private static PanelApiException roomOccupied() {
        return new PanelApiException(HttpStatus.CONFLICT, "ROOM_OCCUPIED",
                "Ask the school to remove the old panel first");
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

    private static String text(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static Integer number(Object value) {
        return value instanceof Number n ? Integer.valueOf(n.intValue()) : null;
    }
}
