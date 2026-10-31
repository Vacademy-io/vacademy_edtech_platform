package vacademy.io.admin_core_service.features.hr_compliance.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_compliance.entity.TdsChallan;
import vacademy.io.admin_core_service.features.hr_compliance.repository.TdsChallanRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Set;

/**
 * TDS challan register (Phase D): deposits recorded here are mapped into the
 * Form 24Q export. HR admin only.
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/compliance/challans")
public class TdsChallanController {

    private static final Set<String> QUARTERS = Set.of("Q1", "Q2", "Q3", "Q4");

    @Autowired
    private TdsChallanRepository challanRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping
    @Auditable(entityType = "HR_TDS_CHALLAN", action = "CREATE", entityIdExpr = "#result?.body")
    public ResponseEntity<String> createChallan(
            @RequestBody TdsChallan challan,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        if (challan.getFinancialYear() == null || !challan.getFinancialYear().matches("\\d{4}-\\d{2}")) {
            throw new VacademyException("financial_year must look like 2025-26");
        }
        if (challan.getQuarter() == null || !QUARTERS.contains(challan.getQuarter().toUpperCase())) {
            throw new VacademyException("quarter must be Q1..Q4 (FY quarters, Q1 = Apr-Jun)");
        }
        if (challan.getDepositDate() == null) {
            throw new VacademyException("deposit_date is required");
        }
        if (challan.getAmount() == null || challan.getAmount().compareTo(BigDecimal.ZERO) <= 0) {
            throw new VacademyException("amount must be positive");
        }
        challan.setId(null);
        challan.setInstituteId(instituteId); // never trust body institute
        challan.setQuarter(challan.getQuarter().toUpperCase());
        challan.setCreatedBy(user.getUserId());
        return ResponseEntity.ok(challanRepository.save(challan).getId());
    }

    @GetMapping
    public ResponseEntity<List<TdsChallan>> listChallans(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("financialYear") String financialYear,
            @RequestParam(value = "quarter", required = false) String quarter,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        List<TdsChallan> challans = quarter != null
                ? challanRepository.findByInstituteIdAndFinancialYearAndQuarterOrderByDepositDateAsc(
                        instituteId, financialYear, quarter.toUpperCase())
                : challanRepository.findByInstituteIdAndFinancialYearOrderByDepositDateAsc(instituteId, financialYear);
        return ResponseEntity.ok(challans);
    }

    @DeleteMapping("/{id}")
    @Auditable(entityType = "HR_TDS_CHALLAN", action = "DELETE", entityIdExpr = "#id")
    public ResponseEntity<String> deleteChallan(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        TdsChallan challan = challanRepository.findByIdAndInstituteId(id, instituteId)
                .orElseThrow(() -> new VacademyException("Challan not found"));
        challanRepository.delete(challan);
        return ResponseEntity.ok(id);
    }
}
