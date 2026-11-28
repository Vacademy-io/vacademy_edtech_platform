package vacademy.io.auth_service.feature.demo.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.demo.dto.DemoProvisionRequest;
import vacademy.io.auth_service.feature.demo.dto.DemoProvisionResponse;
import vacademy.io.auth_service.feature.demo.entity.InstituteTrial;
import vacademy.io.auth_service.feature.demo.service.DemoProvisionService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

/**
 * Provisioning a demo workspace from a quote.
 *
 * Authenticated on purpose — these paths are deliberately NOT in
 * {@code ApplicationSecurityConfig}'s permitAll list, unlike the public signup route.
 * Platform staff only: every handler calls {@link SuperAdminAuthUtil#requireSuperAdmin}.
 */
@RestController
@RequestMapping("/auth-service/super-admin/v1/demo")
public class DemoProvisionController {

    @Autowired
    private DemoProvisionService provisionService;

    /** Creates the institute, the root admin and the trial expiry in one go. */
    @PostMapping("/provision")
    public ResponseEntity<DemoProvisionResponse> provision(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestBody DemoProvisionRequest request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(provisionService.provision(request, user.getUserId()));
    }

    /** Moves a trial's end date — the way to give a prospect a few more days. */
    @PutMapping("/{instituteId}/expiry")
    public ResponseEntity<InstituteTrial> extend(@RequestAttribute("user") CustomUserDetails user,
                                                 @PathVariable String instituteId,
                                                 @RequestParam String expiresAt) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(provisionService.extend(instituteId, expiresAt));
    }
}
