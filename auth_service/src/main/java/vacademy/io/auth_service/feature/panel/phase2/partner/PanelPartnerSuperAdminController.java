package vacademy.io.auth_service.feature.panel.phase2.partner;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerLinkCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerLinkResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerPatchRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomPartnerPatchRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.StatusResponse;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.List;

/**
 * Installer organisations for platform staff. Every handler checks the super-admin allowlist as its
 * first line; then 404 FEATURE_OFF while panel.partners.enabled is false. API only.
 */
@RestController
@RequestMapping("/auth-service/super-admin/v1/panel")
public class PanelPartnerSuperAdminController {

    private final PanelPartnerStaffService staff;

    public PanelPartnerSuperAdminController(PanelPartnerStaffService staff) {
        this.staff = staff;
    }

    @GetMapping("/partners")
    public List<PartnerResponse> partners(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return staff.list();
    }

    @PostMapping("/partners")
    public PartnerResponse create(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody(required = false) PartnerCreateRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return staff.create(body, user.getUserId());
    }

    @PatchMapping("/partners/{id}")
    public PartnerResponse patch(@RequestAttribute("user") CustomUserDetails user, @PathVariable("id") String id,
            @RequestBody(required = false) PartnerPatchRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return staff.patch(id, body);
    }

    @PostMapping("/partners/{id}/links")
    public PartnerLinkResponse link(@RequestAttribute("user") CustomUserDetails user, @PathVariable("id") String id,
            @RequestBody(required = false) PartnerLinkCreateRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return staff.link(id, body, user.getUserId());
    }

    @PostMapping("/partner-links/{link_id}/revoke")
    public PartnerLinkResponse revokeLink(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("link_id") String linkId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return staff.revokeLink(linkId, user.getUserId());
    }

    @PatchMapping("/rooms/{room_id}/partner")
    public StatusResponse roomPartner(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("room_id") String roomId, @RequestBody(required = false) RoomPartnerPatchRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return staff.setRoomPartner(roomId, body);
    }
}
