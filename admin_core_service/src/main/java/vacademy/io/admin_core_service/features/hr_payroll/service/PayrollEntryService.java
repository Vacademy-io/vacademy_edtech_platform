package vacademy.io.admin_core_service.features.hr_payroll.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_payroll.dto.HoldReleaseDTO;
import vacademy.io.admin_core_service.features.hr_payroll.dto.PayrollEntryComponentDTO;
import vacademy.io.admin_core_service.features.hr_payroll.dto.PayrollEntryDTO;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntry;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntryComponent;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollRun;
import vacademy.io.admin_core_service.features.hr_payroll.enums.PayrollEntryStatus;
import vacademy.io.admin_core_service.features.hr_payroll.enums.PayrollStatus;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollEntryComponentRepository;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollEntryRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
public class PayrollEntryService {

    @Autowired
    private PayrollEntryRepository payrollEntryRepository;

    @Autowired
    private PayrollEntryComponentRepository payrollEntryComponentRepository;

    @Autowired
    private PayrollRunService payrollRunService;

    @Transactional(readOnly = true)
    public List<PayrollEntryDTO> getEntriesByRun(String payrollRunId, String instituteId) {
        // Scoped load throws if the run isn't in the validated institute
        payrollRunService.loadScoped(payrollRunId, instituteId);
        List<PayrollEntry> entries = payrollEntryRepository.findByPayrollRunIdOrderByEmployeeEmployeeCodeAsc(payrollRunId);
        return entries.stream().map(this::toDTO).collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public PayrollEntryDTO getEntryById(String id, String instituteId) {
        return toDTO(loadScoped(id, instituteId));
    }

    @Transactional
    public String holdEntry(String id, String instituteId, HoldReleaseDTO holdDTO) {
        PayrollEntry entry = loadScoped(id, instituteId);
        requireMutableRun(entry);

        if (!PayrollEntryStatus.CALCULATED.name().equals(entry.getStatus())) {
            throw new VacademyException("Only CALCULATED entries can be held. Current status: " + entry.getStatus());
        }

        entry.setStatus(PayrollEntryStatus.HELD.name());
        entry.setHoldReason(holdDTO.getHoldReason());
        payrollEntryRepository.save(entry);

        payrollRunService.recomputeTotals(entry.getPayrollRun());
        return entry.getId();
    }

    @Transactional
    public String releaseEntry(String id, String instituteId) {
        PayrollEntry entry = loadScoped(id, instituteId);
        requireMutableRun(entry);

        if (!PayrollEntryStatus.HELD.name().equals(entry.getStatus())) {
            throw new VacademyException("Only HELD entries can be released. Current status: " + entry.getStatus());
        }

        entry.setStatus(PayrollEntryStatus.CALCULATED.name());
        entry.setHoldReason(null);
        payrollEntryRepository.save(entry);

        payrollRunService.recomputeTotals(entry.getPayrollRun());
        return entry.getId();
    }

    private PayrollEntry loadScoped(String id, String instituteId) {
        PayrollEntry entry = payrollEntryRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Payroll entry not found"));
        PayrollRun run = entry.getPayrollRun();
        if (run == null || !Objects.equals(run.getInstituteId(), instituteId)) {
            throw new VacademyException("Payroll entry not found");
        }
        return entry;
    }

    /** Hold/release must not rewrite history on a PAID or CANCELLED run. */
    private void requireMutableRun(PayrollEntry entry) {
        String runStatus = entry.getPayrollRun().getStatus();
        if (PayrollStatus.PAID.name().equals(runStatus) || PayrollStatus.CANCELLED.name().equals(runStatus)) {
            throw new VacademyException("Cannot modify entries of a " + runStatus + " payroll run");
        }
    }

    private PayrollEntryDTO toDTO(PayrollEntry entry) {
        List<PayrollEntryComponent> components = payrollEntryComponentRepository.findByPayrollEntryId(entry.getId());

        List<PayrollEntryComponentDTO> componentDTOs = components.stream()
                .map(c -> PayrollEntryComponentDTO.builder()
                        .componentId(c.getComponent() != null ? c.getComponent().getId() : null)
                        .componentName(c.getComponent() != null ? c.getComponent().getName() : "System")
                        .componentCode(c.getComponent() != null ? c.getComponent().getCode() : null)
                        .componentType(c.getComponentType())
                        .amount(c.getAmount())
                        .build())
                .collect(Collectors.toList());

        return PayrollEntryDTO.builder()
                .id(entry.getId())
                .payrollRunId(entry.getPayrollRun().getId())
                .employeeId(entry.getEmployee().getId())
                .employeeCode(entry.getEmployee().getEmployeeCode())
                .grossSalary(entry.getGrossSalary())
                .totalEarnings(entry.getTotalEarnings())
                .totalDeductions(entry.getTotalDeductions())
                .totalEmployerContributions(entry.getTotalEmployerContributions())
                .netPay(entry.getNetPay())
                .totalWorkingDays(entry.getTotalWorkingDays())
                .daysPresent(entry.getDaysPresent())
                .daysAbsent(entry.getDaysAbsent())
                .daysOnLeave(entry.getDaysOnLeave())
                .daysHoliday(entry.getDaysHoliday())
                .overtimeHours(entry.getOvertimeHours())
                .arrears(entry.getArrears())
                .reimbursements(entry.getReimbursements())
                .loanDeduction(entry.getLoanDeduction())
                .currency(entry.getCurrency() != null ? entry.getCurrency() : "INR")
                .status(entry.getStatus())
                .components(componentDTOs)
                .build();
    }
}
