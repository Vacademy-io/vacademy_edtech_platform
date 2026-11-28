package vacademy.io.admin_core_service.features.commerce.media;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Staff commands for image renditions: the backfill for imported images, a retry for one
 * image, and the counts the editor shows while images are processing.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/media/renditions")
@RequiredArgsConstructor
public class CommerceRenditionController {

    private static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER);

    private final CommerceRenditionService renditionService;
    private final CommerceAccessGuard commerceAccessGuard;

    @PostMapping("/backfill")
    public ResponseEntity<Map<String, Object>> backfill(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "packageId", required = false) String packageId,
            @RequestParam(value = "force", defaultValue = "false") boolean force,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        Map<String, Object> answer = new LinkedHashMap<>();
        answer.put("queued", renditionService.requeue(instituteId, user.getUserId(), packageId, force));
        return ResponseEntity.accepted().body(answer);
    }

    @PostMapping("/{mediaRowId}/retry")
    public ResponseEntity<Map<String, Object>> retry(
            @PathVariable("mediaRowId") String mediaRowId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        renditionService.retryOne(instituteId, user.getUserId(), mediaRowId);
        Map<String, Object> answer = new LinkedHashMap<>();
        answer.put("status", CommerceRenditionState.PENDING);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(answer);
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Long>> status(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(renditionService.statusCounts(instituteId));
    }
}
