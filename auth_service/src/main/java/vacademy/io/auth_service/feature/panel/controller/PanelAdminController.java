package vacademy.io.auth_service.feature.panel.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.*;
import vacademy.io.auth_service.feature.panel.service.PanelAdminService;
import vacademy.io.auth_service.feature.panel.service.PanelPairingService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/** Rooms and panels of an institute. Every call needs an ACTIVE ADMIN role read from user_role. */
@RestController
@RequestMapping("/auth-service/v1/panel/admin")
public class PanelAdminController {

    private final PanelAdminService admin;
    private final PanelPairingService pairing;

    public PanelAdminController(PanelAdminService admin, PanelPairingService pairing) {
        this.admin = admin;
        this.pairing = pairing;
    }

    @GetMapping("/institutes")
    public List<AdminInstituteRow> institutes(@RequestAttribute("user") CustomUserDetails user) {
        return admin.adminInstitutes(user);
    }

    @PostMapping("/devices/claim")
    public DeviceClaimResponse claim(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody DeviceClaimRequest body) {
        return pairing.claim(user, body);
    }

    @GetMapping("/rooms")
    public RoomListResponse rooms(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("institute_id") String instituteId) {
        return admin.listRooms(user, instituteId);
    }

    @PostMapping("/rooms")
    public RoomResponse createRoom(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody RoomCreateRequest body) {
        return admin.createRoom(user, body);
    }

    @PostMapping("/rooms/bulk")
    public RoomBulkResponse createRooms(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody RoomBulkCreateRequest body) {
        return admin.createRooms(user, body);
    }

    @PatchMapping("/rooms/{id}")
    public RoomResponse patchRoom(@RequestAttribute("user") CustomUserDetails user, @PathVariable("id") String id,
            @RequestBody RoomPatchRequest body) {
        return admin.patchRoom(user, id, body);
    }

    @GetMapping("/devices")
    public List<DeviceRowResponse> devices(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("institute_id") String instituteId) {
        return admin.listDevices(user, instituteId);
    }

    @PatchMapping("/devices/{id}")
    public DeviceRowResponse patchDevice(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("id") String id, @RequestBody DevicePatchRequest body) {
        return admin.patchDevice(user, id, body);
    }

    @PostMapping("/devices/{id}/revoke")
    public StatusResponse revoke(@RequestAttribute("user") CustomUserDetails user, @PathVariable("id") String id) {
        return admin.revokeDevice(user, id);
    }

    @PostMapping("/sessions/{id}/end")
    public EndedResponse endSession(@RequestAttribute("user") CustomUserDetails user, @PathVariable("id") String id) {
        return admin.endSession(user, id);
    }
}
