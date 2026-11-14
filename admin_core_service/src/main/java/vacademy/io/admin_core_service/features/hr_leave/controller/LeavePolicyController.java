package vacademy.io.admin_core_service.features.hr_leave.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.hr_leave.dto.LeavePolicyDTO;
import vacademy.io.admin_core_service.features.hr_leave.service.LeavePolicyService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Authorization is enforced inside the service via {@code HrAccessGuard}:
 * create/update are HR-admin only, listing is open to institute members.
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/leaves/policies")
public class LeavePolicyController {

    @Autowired
    private LeavePolicyService leavePolicyService;

    @PostMapping
    public ResponseEntity<String> createLeavePolicy(@RequestBody LeavePolicyDTO dto,
                                                     @RequestParam String instituteId,
                                                     @RequestAttribute("user") CustomUserDetails user) {
        String id = leavePolicyService.createLeavePolicy(dto, instituteId, user);
        return ResponseEntity.ok(id);
    }

    @GetMapping
    public ResponseEntity<List<LeavePolicyDTO>> getLeavePolicies(@RequestParam String instituteId,
                                                                  @RequestAttribute("user") CustomUserDetails user) {
        List<LeavePolicyDTO> policies = leavePolicyService.getLeavePolicies(instituteId, user);
        return ResponseEntity.ok(policies);
    }

    @PutMapping("/{id}")
    public ResponseEntity<String> updateLeavePolicy(@PathVariable String id,
                                                     @RequestBody LeavePolicyDTO dto,
                                                     @RequestParam String instituteId,
                                                     @RequestAttribute("user") CustomUserDetails user) {
        String updatedId = leavePolicyService.updateLeavePolicy(id, dto, instituteId, user);
        return ResponseEntity.ok(updatedId);
    }
}
