package vacademy.io.auth_service.feature.panel.phase2.licence;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceAdminResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceEnforcementRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceEnforcementResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceGrantCancelRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceGrantCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceGrantDetail;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceTemplateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceTemplateResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceUsageResponse;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

/**
 * Room seats for platform staff. Every handler checks the super-admin allowlist as its first line;
 * then 404 FEATURE_OFF while panel.licence.enabled is false. API only: there is no screen for these.
 */
@RestController
@RequestMapping("/auth-service/super-admin/v1/panel")
public class PanelLicenceSuperAdminController {

    private final PanelLicenceService licence;
    private final PanelLicenceUsageService usage;

    public PanelLicenceSuperAdminController(PanelLicenceService licence, PanelLicenceUsageService usage) {
        this.licence = licence;
        this.usage = usage;
    }

    @GetMapping("/institutes/{id}/licence/enforcement")
    public LicenceEnforcementResponse enforcement(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("id") String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return licence.enforcement(instituteId);
    }

    @PutMapping("/institutes/{id}/licence/enforcement")
    public LicenceEnforcementResponse setEnforcement(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("id") String instituteId, @RequestBody(required = false) LicenceEnforcementRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return licence.setEnforcement(instituteId, body, user.getUserId());
    }

    @GetMapping("/institutes/{id}/licence")
    public LicenceAdminResponse detail(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("id") String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return licence.adminDetail(instituteId);
    }

    @PostMapping("/institutes/{id}/licence/grants")
    public LicenceGrantDetail createGrant(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("id") String instituteId, @RequestBody(required = false) LicenceGrantCreateRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return licence.createGrant(instituteId, body, user.getUserId());
    }

    @PostMapping("/licence/grants/{grant_id}/cancel")
    public LicenceGrantDetail cancelGrant(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("grant_id") String grantId, @RequestBody(required = false) LicenceGrantCancelRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return licence.cancelGrant(grantId, body, user.getUserId());
    }

    @GetMapping("/licence/templates/{key}")
    public LicenceTemplateResponse template(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("key") String key) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return licence.template(key);
    }

    @PutMapping("/licence/templates/{key}")
    public LicenceTemplateResponse putTemplate(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("key") String key, @RequestBody(required = false) LicenceTemplateRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return licence.putTemplate(key, body, user.getUserId());
    }

    @GetMapping("/licence/usage")
    public LicenceUsageResponse usage(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("month") String month, @RequestParam(value = "zone", required = false) String zone) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return usage.usage(month, zone);
    }
}
