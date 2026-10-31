package vacademy.io.admin_core_service.features.hr_leave.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.hr_leave.dto.LeaveTypeDTO;
import vacademy.io.admin_core_service.features.hr_leave.service.LeaveTypeService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Authorization is enforced inside the service via {@code HrAccessGuard}:
 * create/update are HR-admin only, listing is open to institute members.
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/leaves/types")
public class LeaveTypeController {

    @Autowired
    private LeaveTypeService leaveTypeService;

    @PostMapping
    public ResponseEntity<String> createLeaveType(@RequestBody LeaveTypeDTO dto,
                                                   @RequestParam String instituteId,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        String id = leaveTypeService.createLeaveType(dto, instituteId, user);
        return ResponseEntity.ok(id);
    }

    @GetMapping
    public ResponseEntity<List<LeaveTypeDTO>> getLeaveTypes(@RequestParam String instituteId,
                                                             @RequestAttribute("user") CustomUserDetails user) {
        List<LeaveTypeDTO> leaveTypes = leaveTypeService.getLeaveTypes(instituteId, user);
        return ResponseEntity.ok(leaveTypes);
    }

    @PutMapping("/{id}")
    public ResponseEntity<String> updateLeaveType(@PathVariable String id,
                                                   @RequestBody LeaveTypeDTO dto,
                                                   @RequestParam String instituteId,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        String updatedId = leaveTypeService.updateLeaveType(id, dto, instituteId, user);
        return ResponseEntity.ok(updatedId);
    }
}
