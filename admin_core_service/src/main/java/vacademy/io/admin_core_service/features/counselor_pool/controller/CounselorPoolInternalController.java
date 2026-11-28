package vacademy.io.admin_core_service.features.counselor_pool.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.counselor_pool.service.CounselorPoolService;

import java.util.List;
import java.util.Map;

/**
 * Service-to-service entry for pool membership changes. Guarded by the HMAC
 * {@code /admin-core-service/internal/**} filter, never reachable with a user JWT.
 *
 * auth_service calls this after an admin disables, deletes or cancels members in
 * Institute → Teams, so a member who lost access stops getting new leads.
 */
@RestController
@RequestMapping("/admin-core-service/internal/counselor-pool/v1")
@RequiredArgsConstructor
public class CounselorPoolInternalController {

    private final CounselorPoolService counselorPoolService;

    @PostMapping("/deactivate-members")
    public ResponseEntity<Map<String, Integer>> deactivateMembers(@RequestParam String instituteId,
                                                                  @RequestBody List<String> userIds) {
        int rows = counselorPoolService.deactivateMembershipsForRemovedMembers(instituteId, userIds);
        return ResponseEntity.ok(Map.of("pool_memberships_deactivated", rows));
    }
}
