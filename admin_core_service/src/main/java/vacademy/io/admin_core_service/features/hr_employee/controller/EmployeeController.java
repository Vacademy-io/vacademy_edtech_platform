package vacademy.io.admin_core_service.features.hr_employee.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_employee.dto.*;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.service.EmployeeBankService;
import vacademy.io.admin_core_service.features.hr_employee.service.EmployeeDocumentService;
import vacademy.io.admin_core_service.features.hr_employee.service.EmployeeService;
import vacademy.io.admin_core_service.features.hr_employee.service.StaffUnificationService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/employees")
public class EmployeeController {

    @Autowired
    private EmployeeService employeeService;

    @Autowired
    private EmployeeBankService employeeBankService;

    @Autowired
    private EmployeeDocumentService employeeDocumentService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Autowired
    private StaffUnificationService staffUnificationService;

    // ======================== Employee Profile ========================

    @PostMapping
    @Auditable(
            entityType = "HR_EMPLOYEE",
            action = "CREATE",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'created employee profile ' + (#dto?.employeeCode ?: '')")
    public ResponseEntity<String> createEmployee(
            @RequestBody EmployeeProfileDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String id = employeeService.createEmployee(dto, instituteId);
        return ResponseEntity.ok(id);
    }

    /**
     * The caller's OWN employee profile in this institute.
     *
     * Every other read here is keyed on an employee id, which a self-service
     * user does not have and cannot discover: the list endpoint is HR-gated on
     * purpose. Without this, an employee has no way to reach their own payslips,
     * leave balance or tax declaration. Institute membership is the only
     * requirement — the guard resolves the profile from the JWT user id, so a
     * caller can never address anyone else's record through it, and 404s for a
     * staff member who has no HR profile yet.
     */
    @GetMapping("/me")
    public ResponseEntity<EmployeeProfileDTO> getMyEmployeeProfile(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        EmployeeProfile self = hrAccessGuard.resolveSelfEmployee(user, instituteId);
        // Sensitive statutory fields stay masked: this is the employee's own
        // view, not an HR-admin one.
        return ResponseEntity.ok(employeeService.getEmployeeById(self.getId(), instituteId, false));
    }

    @GetMapping
    public ResponseEntity<Page<EmployeeProfileDTO>> getEmployees(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(defaultValue = "0") int pageNo,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        Page<EmployeeProfileDTO> employees = employeeService.getEmployees(
                instituteId, null, pageNo, pageSize, hrAccessGuard.isHrAdmin(user));
        return ResponseEntity.ok(employees);
    }

    @PostMapping("/filter")
    public ResponseEntity<Page<EmployeeProfileDTO>> getEmployeesWithFilter(
            @RequestBody EmployeeFilterDTO filterDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(defaultValue = "0") int pageNo,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        Page<EmployeeProfileDTO> employees = employeeService.getEmployees(
                instituteId, filterDTO, pageNo, pageSize, hrAccessGuard.isHrAdmin(user));
        return ResponseEntity.ok(employees);
    }

    @GetMapping("/{id}")
    public ResponseEntity<EmployeeProfileDTO> getEmployeeById(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        // HR staff may view anyone in the institute; an employee may view their own profile
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, id);
        EmployeeProfileDTO employee = employeeService.getEmployeeById(
                id, instituteId, hrAccessGuard.isHrAdmin(user));
        return ResponseEntity.ok(employee);
    }

    @PutMapping("/{id}")
    @Auditable(
            entityType = "HR_EMPLOYEE",
            action = "UPDATE",
            entityIdExpr = "#id",
            descriptionExpr = "'updated employee profile ' + #id")
    public ResponseEntity<String> updateEmployee(
            @PathVariable("id") String id,
            @RequestBody EmployeeProfileDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String updatedId = employeeService.updateEmployee(id, dto, instituteId);
        return ResponseEntity.ok(updatedId);
    }

    @PutMapping("/{id}/status")
    @Auditable(
            entityType = "HR_EMPLOYEE",
            action = "STATUS_CHANGE",
            entityIdExpr = "#id",
            descriptionExpr = "'changed employee ' + #id + ' status to ' + #statusUpdateDTO?.status")
    public ResponseEntity<String> updateEmployeeStatus(
            @PathVariable("id") String id,
            @RequestBody EmployeeStatusUpdateDTO statusUpdateDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String updatedId = employeeService.updateEmployeeStatus(id, statusUpdateDTO, instituteId);
        return ResponseEntity.ok(updatedId);
    }

    @GetMapping("/{id}/org-chart")
    public ResponseEntity<List<EmployeeProfileDTO>> getOrgChart(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        List<EmployeeProfileDTO> directReports = employeeService.getOrgChart(
                id, instituteId, hrAccessGuard.isHrAdmin(user));
        return ResponseEntity.ok(directReports);
    }

    // ======================== Staff ↔ HR bridge (Phase F1) ========================

    @GetMapping("/staff-bridge")
    public ResponseEntity<StaffBridgeResponseDTO> getStaffBridge(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "role", required = false) String role,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        StaffBridgeResponseDTO bridge = staffUnificationService.getStaffBridge(
                instituteId, role, search, page, size);
        return ResponseEntity.ok(bridge);
    }

    @PostMapping("/from-staff")
    @Auditable(
            entityType = "HR_EMPLOYEE",
            action = "CREATE_FROM_STAFF",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'created employee profile from staff user ' + (#dto?.userId ?: '')")
    public ResponseEntity<String> createEmployeeFromStaff(
            @RequestBody EmployeeProfileDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String id = staffUnificationService.createEmployeeFromStaff(dto, instituteId);
        return ResponseEntity.ok(id);
    }

    // ======================== Bank Details ========================

    @PostMapping("/{id}/bank-details")
    @Auditable(
            entityType = "HR_EMPLOYEE_BANK",
            action = "CREATE",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'added bank detail for employee ' + #id")
    public ResponseEntity<String> addBankDetail(
            @PathVariable("id") String id,
            @RequestBody EmployeeBankDetailDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, id);
        String bankId = employeeBankService.addBankDetail(id, dto, instituteId);
        return ResponseEntity.ok(bankId);
    }

    @GetMapping("/{id}/bank-details")
    public ResponseEntity<List<EmployeeBankDetailDTO>> getBankDetails(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, id);
        List<EmployeeBankDetailDTO> bankDetails = employeeBankService.getBankDetails(id, instituteId);
        return ResponseEntity.ok(bankDetails);
    }

    @PutMapping("/{id}/bank-details/{bid}")
    @Auditable(
            entityType = "HR_EMPLOYEE_BANK",
            action = "UPDATE",
            entityIdExpr = "#bid",
            descriptionExpr = "'updated bank detail ' + #bid + ' for employee ' + #id")
    public ResponseEntity<String> updateBankDetail(
            @PathVariable("id") String id,
            @PathVariable("bid") String bid,
            @RequestBody EmployeeBankDetailDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, id);
        String updatedId = employeeBankService.updateBankDetail(id, bid, dto, instituteId);
        return ResponseEntity.ok(updatedId);
    }

    // ======================== Documents ========================

    @PostMapping("/{id}/documents")
    @Auditable(
            entityType = "HR_EMPLOYEE_DOCUMENT",
            action = "CREATE",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'uploaded document ' + (#dto?.documentName ?: '') + ' for employee ' + #id")
    public ResponseEntity<String> addDocument(
            @PathVariable("id") String id,
            @RequestBody EmployeeDocumentDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, id);
        String docId = employeeDocumentService.addDocument(id, dto, instituteId);
        return ResponseEntity.ok(docId);
    }

    @GetMapping("/{id}/documents")
    public ResponseEntity<List<EmployeeDocumentDTO>> getDocuments(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, id);
        List<EmployeeDocumentDTO> documents = employeeDocumentService.getDocuments(id, instituteId);
        return ResponseEntity.ok(documents);
    }

    @DeleteMapping("/{id}/documents/{did}")
    @Auditable(
            entityType = "HR_EMPLOYEE_DOCUMENT",
            action = "DELETE",
            entityIdExpr = "#did",
            descriptionExpr = "'deleted document ' + #did + ' of employee ' + #id")
    public ResponseEntity<Void> deleteDocument(
            @PathVariable("id") String id,
            @PathVariable("did") String did,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        employeeDocumentService.deleteDocument(id, did, instituteId);
        return ResponseEntity.ok().build();
    }
}
