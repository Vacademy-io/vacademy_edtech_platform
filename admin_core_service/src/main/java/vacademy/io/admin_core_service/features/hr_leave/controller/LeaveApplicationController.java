package vacademy.io.admin_core_service.features.hr_leave.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_leave.dto.*;
import vacademy.io.admin_core_service.features.hr_leave.service.CompOffService;
import vacademy.io.admin_core_service.features.hr_leave.service.LeaveApplicationService;
import vacademy.io.admin_core_service.features.hr_leave.service.LeaveBalanceService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Authorization is enforced inside the services via {@code HrAccessGuard}:
 * every method validates institute membership, role, and entity-to-institute
 * ownership before touching data — controllers stay thin.
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/leaves")
public class LeaveApplicationController {

    @Autowired
    private LeaveApplicationService leaveApplicationService;

    @Autowired
    private LeaveBalanceService leaveBalanceService;

    @Autowired
    private CompOffService compOffService;

    // --- Leave Application endpoints ---

    @PostMapping("/apply")
    public ResponseEntity<String> applyLeave(@RequestBody LeaveApplyDTO dto,
                                              @RequestParam String instituteId,
                                              @RequestAttribute("user") CustomUserDetails user) {
        String id = leaveApplicationService.applyLeave(dto, instituteId, user);
        return ResponseEntity.ok(id);
    }

    @GetMapping("/applications")
    public ResponseEntity<Page<LeaveApplicationDTO>> getLeaveApplications(
            @RequestParam String instituteId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String employeeId,
            @RequestParam(defaultValue = "0") int pageNo,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        Page<LeaveApplicationDTO> page = leaveApplicationService.getLeaveApplications(
                instituteId, status, employeeId, pageNo, pageSize, user);
        return ResponseEntity.ok(page);
    }

    @PutMapping("/applications/{id}/action")
    public ResponseEntity<String> approveRejectLeave(@PathVariable String id,
                                                      @RequestBody LeaveActionDTO actionDTO,
                                                      @RequestParam String instituteId,
                                                      @RequestAttribute("user") CustomUserDetails user) {
        String resultId = leaveApplicationService.approveRejectLeave(id, actionDTO, instituteId, user);
        return ResponseEntity.ok(resultId);
    }

    @PutMapping("/applications/{id}/cancel")
    public ResponseEntity<String> cancelLeave(@PathVariable String id,
                                               @RequestParam String instituteId,
                                               @RequestAttribute("user") CustomUserDetails user) {
        String resultId = leaveApplicationService.cancelLeave(id, instituteId, user);
        return ResponseEntity.ok(resultId);
    }

    @GetMapping("/applications/pending")
    public ResponseEntity<List<LeaveApplicationDTO>> getPendingForManager(
            @RequestParam String instituteId,
            @RequestParam(required = false) String approverId,
            @RequestAttribute("user") CustomUserDetails user) {
        List<LeaveApplicationDTO> pending = leaveApplicationService.getPendingForManager(
                instituteId, approverId, user);
        return ResponseEntity.ok(pending);
    }

    // --- Leave Balance endpoints ---

    @GetMapping("/balances")
    public ResponseEntity<List<LeaveBalanceDTO>> getBalances(@RequestParam(required = false) String employeeId,
                                                              @RequestParam Integer year,
                                                              @RequestParam String instituteId,
                                                              @RequestAttribute("user") CustomUserDetails user) {
        List<LeaveBalanceDTO> balances = leaveBalanceService.getBalances(employeeId, year, instituteId, user);
        return ResponseEntity.ok(balances);
    }

    @PutMapping("/balances/{id}/adjust")
    @Auditable(
            entityType = "HR_LEAVE_BALANCE",
            action = "ADJUST",
            entityIdExpr = "#id",
            descriptionExpr = "'adjusted leave balance by ' + #dto?.adjustment + (#dto?.reason != null ? ' (' + #dto.reason + ')' : '')")
    public ResponseEntity<String> adjustBalance(@PathVariable String id,
                                                 @RequestBody LeaveBalanceAdjustDTO dto,
                                                 @RequestParam String instituteId,
                                                 @RequestAttribute("user") CustomUserDetails user) {
        String resultId = leaveBalanceService.adjustBalance(id, dto, instituteId, user);
        return ResponseEntity.ok(resultId);
    }

    @PostMapping("/accrue")
    @Auditable(
            entityType = "HR_LEAVE",
            action = "ACCRUE",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'triggered monthly leave accrual'")
    public ResponseEntity<String> accrueLeaves(@RequestParam String instituteId,
                                                @RequestAttribute("user") CustomUserDetails user) {
        String result = leaveBalanceService.accrueLeaves(instituteId, user);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/year-end-process")
    @Auditable(
            entityType = "HR_LEAVE",
            action = "YEAR_END",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'ran year-end leave process for year ' + #year")
    public ResponseEntity<String> yearEndProcess(@RequestParam String instituteId,
                                                  @RequestParam Integer year,
                                                  @RequestAttribute("user") CustomUserDetails user) {
        String result = leaveBalanceService.yearEndProcess(instituteId, year, user);
        return ResponseEntity.ok(result);
    }

    // --- Compensatory Off endpoints ---

    @PostMapping("/comp-off")
    public ResponseEntity<String> requestCompOff(@RequestBody CompOffDTO dto,
                                                  @RequestParam String instituteId,
                                                  @RequestAttribute("user") CustomUserDetails user) {
        String id = compOffService.requestCompOff(dto, instituteId, user);
        return ResponseEntity.ok(id);
    }

    @PutMapping("/comp-off/{id}/action")
    public ResponseEntity<String> approveRejectCompOff(@PathVariable String id,
                                                        @RequestBody CompOffActionDTO actionDTO,
                                                        @RequestParam String instituteId,
                                                        @RequestAttribute("user") CustomUserDetails user) {
        String resultId = compOffService.approveRejectCompOff(id, actionDTO, instituteId, user);
        return ResponseEntity.ok(resultId);
    }

    @GetMapping("/comp-off")
    public ResponseEntity<List<CompOffDTO>> getCompOffs(@RequestParam String employeeId,
                                                         @RequestParam String instituteId,
                                                         @RequestAttribute("user") CustomUserDetails user) {
        List<CompOffDTO> compOffs = compOffService.getCompOffs(employeeId, instituteId, user);
        return ResponseEntity.ok(compOffs);
    }
}
