package vacademy.io.admin_core_service.features.white_label.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.white_label.dto.*;
import vacademy.io.admin_core_service.features.white_label.service.WhiteLabelService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * White-Label Setup Controller.
 *
 * All endpoints require the caller to be an authenticated institute member
 * (enforced by the gateway + the service-layer assertInstituteAccess check).
 *
 * Intentionally NOT under /admin/* so the institute admin dashboard can call it
 * without needing an elevated super-admin role — but the service still verifies
 * that the caller belongs to the exact instituteId they are setting up.
 */
@RestController
@RequestMapping("/admin-core-service/institute/white-label/v1")
@RequiredArgsConstructor
public class WhiteLabelController {

    private final WhiteLabelService whiteLabelService;

    /**
     * Fully automates the white-label setup for an institute:
     * 1. Creates / updates Cloudflare DNS CNAME records
     * 2. Upserts domain routing rows (LEARNER, ADMIN, TEACHER)
     * 3. Updates learner_portal_base_url, admin_portal_base_url,
     * teacher_portal_base_url
     * on the institutes table
     *
     * Security: the authenticated user MUST belong to the instituteId being
     * configured.
     */
    @PostMapping("/setup")
    public ResponseEntity<WhiteLabelSetupResponse> setup(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestBody WhiteLabelSetupRequest request) {

        WhiteLabelSetupResponse response = whiteLabelService.setup(user, instituteId, request);
        return ResponseEntity.ok(response);
    }

    /**
     * Returns current white-label configuration for the institute.
     * Safe read-only endpoint.
     */
    @GetMapping("/status")
    public ResponseEntity<WhiteLabelStatusResponse> getStatus(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {

        WhiteLabelStatusResponse response = whiteLabelService.getStatus(user, instituteId);
        return ResponseEntity.ok(response);
    }

    /**
     * Returns the institute's custom live-class host, or null when it serves live
     * classes from the platform default domain.
     */
    @GetMapping("/live-session-domain")
    public ResponseEntity<java.util.Map<String, String>> getLiveSessionDomain(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {

        return ResponseEntity.ok(whiteLabelService.getLiveSessionDomain(user, instituteId));
    }

    /**
     * Sets the institute's custom live-class host, e.g.
     * {@code {"domain": "meet.zoeedtech.com"}}. Pass null or an empty string to
     * clear it and fall back to the platform default.
     *
     * The host must also resolve to the primary BBB pool server and be covered by
     * that server's certificate — this endpoint only records the intent.
     */
    @PutMapping("/live-session-domain")
    public ResponseEntity<java.util.Map<String, String>> setLiveSessionDomain(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestBody java.util.Map<String, String> body) {

        String domain = body == null ? null : body.get("domain");
        return ResponseEntity.ok(whiteLabelService.setLiveSessionDomain(user, instituteId, domain));
    }
}
