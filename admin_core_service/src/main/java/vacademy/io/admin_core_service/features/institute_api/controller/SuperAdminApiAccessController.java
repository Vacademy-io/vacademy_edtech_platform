package vacademy.io.admin_core_service.features.institute_api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.institute_api.dto.BulkEnableApiAccessRequest;
import vacademy.io.admin_core_service.features.institute_api.dto.IssueApiKeyRequest;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiKey;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiAccessService;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Platform-staff endpoints for partner-API access (spec 10.7 admin_core table, T1.4):
 * enable/disable per institute and product, bulk enable, issue a key for an institute
 * (vendor-led onboarding), revoke one, revoke all (kill-switch).
 *
 * <p>Every route calls {@code SuperAdminAuthUtil.requireSuperAdmin} first: the
 * SUPER_ADMIN_USER_IDS allowlist only, no root-user bypass (gate G2).
 */
@RestController
@RequestMapping("/admin-core-service/super-admin/v1")
@RequiredArgsConstructor
public class SuperAdminApiAccessController {

    private final InstituteApiAccessService accessService;
    private final InstituteApiKeyService keyService;

    @GetMapping("/institutes/{instituteId}/api-access")
    public ResponseEntity<Map<String, Object>> getAccess(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(accessService.overview(instituteId));
    }

    @PutMapping("/institutes/{instituteId}/api-access/{product}")
    public ResponseEntity<Map<String, Object>> updateAccess(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @PathVariable("product") String product,
            @RequestBody(required = false) JsonNode body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(InstituteApiAccessService.toView(
                accessService.update(instituteId, product, body, user)));
    }

    @PostMapping("/api-access/bulk-enable")
    public ResponseEntity<Map<String, Object>> bulkEnable(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestBody(required = false) BulkEnableApiAccessRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        if (body == null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Request body is required.");
        }
        return ResponseEntity.ok(accessService.bulkEnable(
                body.getInstituteIds(), body.getProduct(), body.getSegment(), body.getReason(), user));
    }

    /** Issue a key for the institute; the plaintext is in this response only. */
    @PostMapping("/institutes/{instituteId}/api-keys")
    public ResponseEntity<Map<String, Object>> issueKey(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @RequestBody(required = false) IssueApiKeyRequest body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        if (body != null && body.getInstituteId() != null && !body.getInstituteId().isBlank()
                && !body.getInstituteId().trim().equals(instituteId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "institute_id in the body differs from the path.");
        }
        InstituteApiKeyService.IssuedKey issued =
                keyService.issue(instituteId, body, user, InstituteApiKey.VIA_SUPER_ADMIN);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(InstituteApiKeyAdminController.issuedView(issued));
    }

    @PostMapping("/institutes/{instituteId}/api-keys/{keyId}/revoke")
    public ResponseEntity<Map<String, Object>> revokeKey(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @PathVariable("keyId") String keyId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return InstituteApiKeyAdminController.revokeResponse(keyService.revoke(instituteId, keyId, user));
    }

    /** Kill-switch: revokes every active key of the institute. Optional body {"reason": "..."}. */
    @PostMapping("/institutes/{instituteId}/api-keys/revoke-all")
    public ResponseEntity<Map<String, Object>> revokeAll(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @RequestBody(required = false) JsonNode body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        String reason = body != null && body.hasNonNull("reason") ? body.get("reason").asText() : null;
        int n = keyService.revokeAll(instituteId, user, reason);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("revoked_count", n);
        return ResponseEntity.ok(out);
    }
}
