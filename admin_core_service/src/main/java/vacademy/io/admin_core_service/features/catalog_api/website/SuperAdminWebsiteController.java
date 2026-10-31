package vacademy.io.admin_core_service.features.catalog_api.website;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.List;
import java.util.Map;

/**
 * Platform-staff view of approved websites: list (all institutes or one), revoke (the host stops
 * opening the Catalogue API origin lock and the institute cannot add it again), restore.
 *
 * <p>Every route calls {@code SuperAdminAuthUtil.requireSuperAdmin} first: the
 * SUPER_ADMIN_USER_IDS allowlist only, no root-user bypass.
 */
@RestController
@RequestMapping("/admin-core-service/super-admin/v1/websites")
@RequiredArgsConstructor
public class SuperAdminWebsiteController {

    private final InstituteWebsiteService websiteService;

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(value = "instituteId", required = false) String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(websiteService.listAll(instituteId).stream()
                .map(InstituteWebsiteService::superAdminView)
                .toList());
    }

    /** Body {"reason": "..."} (required). */
    @PostMapping("/{websiteId}/revoke")
    public ResponseEntity<Map<String, Object>> revoke(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("websiteId") String websiteId,
            @RequestBody(required = false) JsonNode body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        String reason = body != null && body.hasNonNull("reason") ? body.get("reason").asText() : null;
        return ResponseEntity.ok(InstituteWebsiteService.superAdminView(websiteService.revoke(websiteId, reason, user)));
    }

    @PostMapping("/{websiteId}/restore")
    public ResponseEntity<Map<String, Object>> restore(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("websiteId") String websiteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(InstituteWebsiteService.superAdminView(websiteService.restore(websiteId, user)));
    }
}
