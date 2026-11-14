package vacademy.io.admin_core_service.features.hr_payroll.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_payroll.dto.PayrollAdjustmentDTO;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollAdjustment;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollAdjustmentRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Variable-pay input API (Phase C7): HR admins register per-employee monthly
 * earnings/deductions (bonus, incentive, recovery) which payroll consumes for
 * the matching run scope. CRM incentives and F&F both create rows here.
 */
@Service
public class PayrollAdjustmentService {

    private static final Set<String> TYPES = Set.of("EARNING", "DEDUCTION");
    private static final Set<String> SCOPES = Set.of("REGULAR", "OFF_CYCLE", "FNF", "BONUS");

    @Autowired
    private PayrollAdjustmentRepository adjustmentRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Transactional
    public String createAdjustment(PayrollAdjustmentDTO dto, String instituteId,
                                   CustomUserDetails user, String source) {
        EmployeeProfile employee = hrAccessGuard.requireSelfOrHrStaff(user, instituteId, dto.getEmployeeId());
        if (!hrAccessGuard.isHrAdmin(user)) {
            throw new VacademyException("Only HR admins can create payroll adjustments");
        }
        if (dto.getMonth() == null || dto.getMonth() < 1 || dto.getMonth() > 12
                || dto.getYear() == null || dto.getYear() < 2000 || dto.getYear() > 2100) {
            throw new VacademyException("Valid month and year are required");
        }
        if (dto.getType() == null || !TYPES.contains(dto.getType().toUpperCase())) {
            throw new VacademyException("Adjustment type must be EARNING or DEDUCTION");
        }
        if (dto.getAmount() == null || dto.getAmount().compareTo(BigDecimal.ZERO) <= 0) {
            throw new VacademyException("Adjustment amount must be positive");
        }
        if (dto.getLabel() == null || dto.getLabel().isBlank()) {
            throw new VacademyException("Adjustment label is required");
        }

        String scope = dto.getRunScope() == null || dto.getRunScope().isBlank()
                ? "REGULAR" : dto.getRunScope().toUpperCase();
        if (!SCOPES.contains(scope)) {
            throw new VacademyException("run_scope must be one of " + SCOPES);
        }

        PayrollAdjustment adj = new PayrollAdjustment();
        adj.setInstituteId(instituteId);
        adj.setEmployeeId(employee.getId());
        adj.setMonth(dto.getMonth());
        adj.setYear(dto.getYear());
        adj.setType(dto.getType().toUpperCase());
        adj.setCode(sanitizeCode(dto.getCode() != null && !dto.getCode().isBlank()
                ? dto.getCode() : dto.getLabel()));
        adj.setLabel(dto.getLabel().trim());
        adj.setAmount(dto.getAmount().setScale(2, java.math.RoundingMode.HALF_UP));
        adj.setCurrency(dto.getCurrency() != null && dto.getCurrency().matches("[A-Za-z]{3}")
                ? dto.getCurrency().toUpperCase() : "INR");
        adj.setRunScope(scope);
        adj.setSource(source != null ? source : "MANUAL");
        adj.setNotes(dto.getNotes());
        adj.setCreatedBy(user.getUserId());
        return adjustmentRepository.save(adj).getId();
    }

    @Transactional(readOnly = true)
    public List<PayrollAdjustmentDTO> getAdjustments(String instituteId, Integer year, Integer month) {
        return adjustmentRepository.findByInstituteIdAndYearAndMonthOrderByCreatedAtAsc(instituteId, year, month)
                .stream().map(this::toDTO).collect(Collectors.toList());
    }

    @Transactional
    public void deleteAdjustment(String id, String instituteId) {
        PayrollAdjustment adj = adjustmentRepository.findByIdAndInstituteId(id, instituteId)
                .orElseThrow(() -> new VacademyException("Adjustment not found"));
        if (adj.getPayrollEntryId() != null) {
            throw new VacademyException("Adjustment already consumed by a payroll run; reject that run first");
        }
        adjustmentRepository.delete(adj);
    }

    /** Uppercase snake component code, max 30 chars (component.code column limit). */
    static String sanitizeCode(String raw) {
        String code = raw.trim().toUpperCase().replaceAll("[^A-Z0-9]+", "_")
                .replaceAll("^_+|_+$", "");
        if (code.isEmpty()) code = "ADJUSTMENT";
        return code.length() > 30 ? code.substring(0, 30) : code;
    }

    private PayrollAdjustmentDTO toDTO(PayrollAdjustment a) {
        return PayrollAdjustmentDTO.builder()
                .id(a.getId())
                .employeeId(a.getEmployeeId())
                .month(a.getMonth())
                .year(a.getYear())
                .type(a.getType())
                .code(a.getCode())
                .label(a.getLabel())
                .amount(a.getAmount())
                .currency(a.getCurrency())
                .runScope(a.getRunScope())
                .source(a.getSource())
                .notes(a.getNotes())
                .payrollEntryId(a.getPayrollEntryId())
                .build();
    }
}
