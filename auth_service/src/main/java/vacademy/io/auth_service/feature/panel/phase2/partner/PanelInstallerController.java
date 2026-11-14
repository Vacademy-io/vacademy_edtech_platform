package vacademy.io.auth_service.feature.panel.phase2.partner;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.DeviceClaimResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerClaimRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerCustomerRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerInstallRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerLinkRedeemRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerLinkRedeemResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerMeResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerRoomRow;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Installer endpoints, for an installer's own phone. Every call needs an installer role at an ACTIVE
 * installer organisation (403 NOT_INSTALLER otherwise); 404 FEATURE_OFF while panel.partners.enabled
 * is false. A panel-session token is refused here by PanelBearerGuard, like every Bearer panel path.
 */
@RestController
@RequestMapping("/auth-service/v1/panel/partner")
public class PanelInstallerController {

    private final PanelInstallerService installers;

    public PanelInstallerController(PanelInstallerService installers) {
        this.installers = installers;
    }

    @GetMapping("/me")
    public PartnerMeResponse me(@RequestAttribute("user") CustomUserDetails user) {
        return installers.me(user);
    }

    @PostMapping("/links/redeem")
    public PartnerLinkRedeemResponse redeem(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody(required = false) PartnerLinkRedeemRequest body) {
        return installers.redeem(user, body);
    }

    @GetMapping("/customers")
    public List<PartnerCustomerRow> customers(@RequestAttribute("user") CustomUserDetails user) {
        return installers.customers(user);
    }

    @GetMapping("/rooms")
    public List<PartnerRoomRow> rooms(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("institute_id") String instituteId) {
        return installers.rooms(user, instituteId);
    }

    @PostMapping("/devices/claim")
    public DeviceClaimResponse claim(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody(required = false) PartnerClaimRequest body) {
        return installers.claim(user, body);
    }

    @GetMapping("/installs")
    public List<PartnerInstallRow> installs(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("institute_id") String instituteId) {
        return installers.installs(user, instituteId);
    }
}
