package vacademy.io.auth_service.feature.panel.phase2.partner;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.DeviceRowResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerInviteRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerInviteResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerLinkRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerOpenInviteRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.StatusResponse;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Installers and approvals for an institute admin. Each call needs an ACTIVE ADMIN role at the
 * row's own institute; 404 FEATURE_OFF while panel.partners.enabled is false, except approve and
 * reject, which settle panels already waiting whatever the switch.
 */
@RestController
@RequestMapping("/auth-service/v1/panel/admin")
public class PanelPartnerAdminController {

    private final PanelPartnerAdminService admin;

    public PanelPartnerAdminController(PanelPartnerAdminService admin) {
        this.admin = admin;
    }

    @GetMapping("/partners")
    public List<PartnerLinkRow> partners(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("institute_id") String instituteId) {
        return admin.links(user, instituteId);
    }

    @PostMapping("/partner-invites")
    public PartnerInviteResponse invite(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody(required = false) PartnerInviteRequest body) {
        return admin.createInvite(user, body);
    }

    @GetMapping("/partner-invites")
    public List<PartnerOpenInviteRow> openInvites(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("institute_id") String instituteId) {
        return admin.openInvites(user, instituteId);
    }

    @PostMapping("/partner-invites/{id}/cancel")
    public StatusResponse cancelInvite(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("id") String inviteId) {
        return admin.cancelInvite(user, inviteId);
    }

    @PostMapping("/partners/{link_id}/revoke")
    public StatusResponse revokeLink(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("link_id") String linkId) {
        return admin.revokeLink(user, linkId);
    }

    @PostMapping("/devices/{id}/approve")
    public DeviceRowResponse approve(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("id") String deviceId) {
        return admin.approve(user, deviceId);
    }

    @PostMapping("/devices/{id}/reject")
    public StatusResponse reject(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("id") String deviceId) {
        return admin.reject(user, deviceId);
    }
}
