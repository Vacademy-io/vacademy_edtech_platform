package vacademy.io.auth_service.feature.panel.service;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.AdminInstituteRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.DeviceCurrentSession;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.DevicePatchRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.DeviceRowResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.EndedResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomBulkCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomBulkResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomListResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomPatchRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomRef;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.StatusResponse;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceListRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.RoomRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.SessionRow;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Institute admin endpoints. The institute being checked is the row's own wherever a row is named by
 * id, so a caller cannot reach another institute's room, panel or session by passing its id.
 */
@Service
public class PanelAdminService {

    private static final int BULK_ROOM_CAP = 200;

    private final PanelRepository repository;
    private final InstituteOAuthClientAccessGuard accessGuard;
    private final UserRoleRepository userRoleRepository;
    private final PanelDevices devices;
    private final PanelPairingService pairing;
    private final PanelTx tx;

    public PanelAdminService(PanelRepository repository, InstituteOAuthClientAccessGuard accessGuard,
            UserRoleRepository userRoleRepository, PanelDevices devices, PanelPairingService pairing, PanelTx tx) {
        this.repository = repository;
        this.accessGuard = accessGuard;
        this.userRoleRepository = userRoleRepository;
        this.devices = devices;
        this.pairing = pairing;
        this.tx = tx;
    }

    /** Ids only, from user_role. The phone resolves names itself; this makes no HTTP call. */
    public List<AdminInstituteRow> adminInstitutes(CustomUserDetails user) {
        return userRoleRepository
                .findUserRolesByUserIdAndStatusesAndRoleNames(user.getUserId(), List.of("ACTIVE"), List.of("ADMIN"))
                .stream()
                .map(role -> role.getInstituteId())
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .map(AdminInstituteRow::new)
                .toList();
    }

    // --------------------------------------------------------------- rooms ---

    public RoomListResponse listRooms(CustomUserDetails user, String instituteId) {
        return tx.run(() -> {
            accessGuard.requireInstituteAdmin(user, instituteId);
            List<RoomRow> rooms = repository.listRooms(instituteId);
            String next = rooms.stream()
                    .filter(room -> "ACTIVE".equals(room.status()) && room.deviceId() == null)
                    .map(RoomRow::id)
                    .findFirst()
                    .orElse(null);
            return new RoomListResponse(rooms.stream().map(PanelAdminService::roomResponse).toList(), next);
        });
    }

    public RoomResponse createRoom(CustomUserDetails user, RoomCreateRequest body) {
        String name = PanelPairingService.cleanRoomName(body.name());
        return tx.run(() -> {
            accessGuard.requireInstituteAdmin(user, body.instituteId());
            String id = UUID.randomUUID().toString();
            if (repository.insertRoom(id, body.instituteId(), name, user.getUserId()) == 0) {
                throw PanelPairingService.roomNameTaken();
            }
            return new RoomResponse(id, name, "ACTIVE", null);
        });
    }

    public RoomBulkResponse createRooms(CustomUserDetails user, RoomBulkCreateRequest body) {
        List<String> names = body.names() == null ? List.of() : body.names();
        if (names.size() > BULK_ROOM_CAP) {
            throw PanelApiException.badRequest("At most " + BULK_ROOM_CAP + " rooms at a time");
        }
        List<String> clean = names.stream().map(PanelPairingService::cleanRoomName).toList();
        return tx.run(() -> {
            accessGuard.requireInstituteAdmin(user, body.instituteId());
            List<RoomResponse> created = new ArrayList<>();
            List<String> skipped = new ArrayList<>();
            for (String name : clean) {
                String id = UUID.randomUUID().toString();
                if (repository.insertRoom(id, body.instituteId(), name, user.getUserId()) == 1) {
                    created.add(new RoomResponse(id, name, "ACTIVE", null));
                } else {
                    skipped.add(name);
                }
            }
            return new RoomBulkResponse(created, skipped);
        });
    }

    public RoomResponse patchRoom(CustomUserDetails user, String roomId, RoomPatchRequest body) {
        String status = body.status();
        if (status != null && !"ACTIVE".equals(status) && !"ARCHIVED".equals(status)) {
            throw PanelApiException.badRequest("Unknown status");
        }
        String name = body.name() == null ? null : PanelPairingService.cleanRoomName(body.name());
        try {
            return tx.run(() -> {
                RoomRow room = repository.findRoom(roomId).orElseThrow(() -> PanelApiException.notFound("No such room"));
                accessGuard.requireInstituteAdmin(user, room.instituteId());
                if ("ARCHIVED".equals(status)) {
                    // A claim into this room holds the same lock until its device row commits, so
                    // the live-device check below sees that device rather than an empty room.
                    repository.lockForTransaction("panel_room:" + roomId);
                }
                if (status != null && repository.setRoomStatus(roomId, status) == 0) {
                    throw new PanelApiException(HttpStatus.CONFLICT, "ROOM_HAS_DEVICE",
                            "Remove the panel from this room first");
                }
                if (name != null) {
                    repository.renameRoom(roomId, name);
                }
                return roomResponse(repository.findRoom(roomId).orElseThrow());
            });
        } catch (DuplicateKeyException e) {
            throw PanelPairingService.roomNameTaken();
        }
    }

    private static RoomResponse roomResponse(RoomRow room) {
        return new RoomResponse(room.id(), room.name(), room.status(), room.deviceId());
    }

    // ------------------------------------------------------------- devices ---

    public List<DeviceRowResponse> listDevices(CustomUserDetails user, String instituteId) {
        return tx.run(() -> {
            accessGuard.requireInstituteAdmin(user, instituteId);
            return repository.listDevices(instituteId, null).stream().map(PanelAdminService::deviceResponse).toList();
        });
    }

    public DeviceRowResponse patchDevice(CustomUserDetails user, String deviceId, DevicePatchRequest body) {
        try {
            return tx.run(() -> {
                DeviceRow device = repository.findDevice(deviceId)
                        .orElseThrow(() -> PanelApiException.notFound("No such panel"));
                accessGuard.requireInstituteAdmin(user, device.instituteId());
                if ("REVOKED".equals(device.status())) {
                    throw PanelApiException.deviceNotActive();
                }
                if (body.roomId() != null && !body.roomId().equals(device.roomId())) {
                    RoomRow room = pairing.requireRoomOf(device.instituteId(), body.roomId());
                    repository.lockForTransaction("panel_room:" + room.id());
                    if (repository.findLiveDeviceInRoom(room.id()).isPresent()) {
                        throw PanelPairingService.roomOccupied(repository.findLiveDeviceInRoom(room.id()));
                    }
                    repository.moveDevice(deviceId, room.id());
                    repository.moveActiveSessionsOfDevice(deviceId, room.id());
                }
                if (body.passwordLoginAllowed() != null) {
                    repository.setPasswordLoginAllowed(deviceId, body.passwordLoginAllowed());
                }
                return deviceResponse(repository.listDevices(device.instituteId(), deviceId).get(0));
            });
        } catch (DuplicateKeyException e) {
            throw PanelPairingService.roomOccupied(repository.findLiveDeviceInRoom(body.roomId()));
        }
    }

    public StatusResponse revokeDevice(CustomUserDetails user, String deviceId) {
        return tx.run(() -> {
            DeviceRow device = repository.findDevice(deviceId)
                    .orElseThrow(() -> PanelApiException.notFound("No such panel"));
            accessGuard.requireInstituteAdmin(user, device.instituteId());
            devices.revokeInTx(deviceId, user.getUserId());
            return new StatusResponse("REVOKED");
        });
    }

    public EndedResponse endSession(CustomUserDetails user, String sessionId) {
        return tx.run(() -> {
            SessionRow session = repository.findSession(sessionId)
                    .orElseThrow(() -> PanelApiException.notFound("No such session"));
            accessGuard.requireInstituteAdmin(user, session.instituteId());
            repository.endSession(sessionId, "ADMIN", user.getUserId());
            return new EndedResponse(true);
        });
    }

    private static DeviceRowResponse deviceResponse(DeviceListRow row) {
        DeviceRow d = row.device();
        boolean online = d.lastSeenAt() != null
                && d.dbNow().getTime() - d.lastSeenAt().getTime() < PanelTimers.DEVICE_ONLINE_MS;
        DeviceCurrentSession current = null;
        if (row.sessionId() != null) {
            current = new DeviceCurrentSession(row.sessionId(), row.sessionUserId(), row.sessionUserName(),
                    row.sessionStartedVia(), row.sessionCreatedAt().toInstant().toString(),
                    Math.max(0, (row.sessionExpiresAt().getTime() - d.dbNow().getTime()) / 1000), row.approvedIp());
        }
        return new DeviceRowResponse(d.id(), new RoomRef(d.roomId(), d.roomName()), d.status(), online,
                d.lastSeenAt() == null ? null : d.lastSeenAt().toInstant().toString(), d.lastIp(), d.model(),
                d.manufacturer(), d.sdkInt(), d.webviewMajor(), d.appVersionCode(), d.passwordLoginAllowed(),
                d.claimedByName(), d.claimedAt().toInstant().toString(), current);
    }
}
