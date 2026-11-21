package vacademy.io.admin_core_service.features.hr_compliance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_compliance.dto.PtReturnResponseDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.PtReturnRowDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.PtReturnSlabSummaryDTO;
import vacademy.io.admin_core_service.features.hr_compliance.repository.ComplianceStatutoryQueryRepository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntry;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntryComponent;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxConfiguration;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxConfigurationRepository;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * Monthly Professional Tax return builder (v1 CSV — state PT return formats
 * differ; this produces the slab-count summary every state form asks for plus
 * an employee annexure).
 *
 * <p>Slabs are derived empirically: PT is a flat slab amount per employee per
 * month, so grouping the month's distinct PT deduction amounts IS the slab
 * summary (count of employees + total per amount) without re-encoding every
 * state's slab table here.
 */
@Service
public class PtReturnService {

    /** PT code aliases (PayrollCalculationService.STATUTORY_ALIASES). */
    private static final Set<String> PT_CODES = Set.of("PT", "PROF_TAX", "PROFESSIONAL_TAX");

    private static final List<String> FILABLE_RUN_STATUSES = List.of("PROCESSED", "APPROVED", "PAID");

    @Autowired
    private ComplianceStatutoryQueryRepository statutoryQueryRepository;

    @Autowired
    private TaxConfigurationRepository taxConfigurationRepository;

    @Autowired
    private UserRepository userRepository;

    @Transactional(readOnly = true)
    public PtReturnResponseDTO buildReturn(String instituteId, int month, int year) {
        List<String> warnings = new ArrayList<>();
        TaxConfiguration config = taxConfigurationRepository
                .findByInstituteIdAndCountryCode(instituteId, "IN").orElse(null);
        String stateCode = "";
        String registrationNumber = "";
        if (config == null) {
            warnings.add("No India (IN) tax configuration found for this institute; "
                    + "state code and PT registration number are blank.");
        } else {
            stateCode = config.getStateCode() == null ? "" : config.getStateCode().trim();
            if (stateCode.isBlank()) {
                warnings.add("state_code is not set on the tax configuration.");
            }
            Map<String, Object> settings = config.getStatutorySettings();
            Object reg = settings == null ? null : settings.get("pt_registration_number");
            if (reg == null || reg.toString().isBlank()) {
                warnings.add("statutory_settings.pt_registration_number is not configured; "
                        + "set it in the tax configuration before filing.");
            } else {
                registrationNumber = reg.toString().trim();
            }
        }

        List<PayrollEntryComponent> components = statutoryQueryRepository.findStatutoryComponents(
                instituteId, month, year, FILABLE_RUN_STATUSES, PT_CODES);

        // Aggregate per employee across the month's filable runs (PT is a flat
        // monthly amount; multiple entries for the same employee — e.g. an
        // off-cycle run that also deducted PT — sum, matching what was
        // actually deducted and must be remitted).
        Map<String, PtAgg> byEmployee = new LinkedHashMap<>();
        boolean sawProcessedRun = false;
        for (PayrollEntryComponent component : components) {
            PayrollEntry entry = component.getPayrollEntry();
            EmployeeProfile employee = entry.getEmployee();
            if ("PROCESSED".equals(entry.getPayrollRun().getStatus())) {
                sawProcessedRun = true;
            }
            PtAgg agg = byEmployee.computeIfAbsent(employee.getId(), k -> new PtAgg(employee));
            agg.ptAmount = agg.ptAmount.add(nvl(component.getAmount()));
            if (agg.seenEntryIds.add(entry.getId())) {
                agg.gross = agg.gross.add(nvl(entry.getGrossSalary()));
            }
        }
        if (sawProcessedRun) {
            warnings.add("Includes payroll run(s) still in PROCESSED status (not yet approved); "
                    + "re-generate after approval before filing.");
        }

        Map<String, String> nameMap = buildUserNameMap(byEmployee.values().stream()
                .map(a -> a.employee.getUserId()).distinct().collect(Collectors.toList()));

        List<PtReturnRowDTO> rows = new ArrayList<>();
        for (PtAgg agg : byEmployee.values()) {
            rows.add(PtReturnRowDTO.builder()
                    .employeeCode(agg.employee.getEmployeeCode())
                    .name(nameMap.getOrDefault(agg.employee.getUserId(), ""))
                    .grossSalary(agg.gross.setScale(2, RoundingMode.HALF_UP))
                    .ptAmount(agg.ptAmount.setScale(2, RoundingMode.HALF_UP))
                    .build());
        }
        rows.sort(Comparator.comparing(r -> r.getEmployeeCode() == null ? "" : r.getEmployeeCode()));

        // Slab-wise summary: distinct PT amounts, ascending.
        Map<BigDecimal, List<PtReturnRowDTO>> byAmount = rows.stream()
                .collect(Collectors.groupingBy(PtReturnRowDTO::getPtAmount, TreeMap::new, Collectors.toList()));
        List<PtReturnSlabSummaryDTO> slabs = byAmount.entrySet().stream()
                .map(e -> PtReturnSlabSummaryDTO.builder()
                        .ptAmount(e.getKey())
                        .employeeCount(e.getValue().size())
                        .totalAmount(e.getKey().multiply(BigDecimal.valueOf(e.getValue().size()))
                                .setScale(2, RoundingMode.HALF_UP))
                        .build())
                .collect(Collectors.toList());

        BigDecimal grandTotal = rows.stream().map(PtReturnRowDTO::getPtAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add).setScale(2, RoundingMode.HALF_UP);

        return PtReturnResponseDTO.builder()
                .instituteId(instituteId)
                .month(month)
                .year(year)
                .stateCode(stateCode)
                .ptRegistrationNumber(registrationNumber)
                .slabs(slabs)
                .rows(rows)
                .warnings(warnings)
                .employeeCount(rows.size())
                .grandTotalPt(grandTotal)
                .build();
    }

    /** CSV: header block (state + registration), slab summary, employee annexure, grand total. */
    public String buildCsv(PtReturnResponseDTO response) {
        StringBuilder sb = new StringBuilder();
        sb.append("Professional Tax Return,").append(response.getMonth())
                .append("/").append(response.getYear()).append("\r\n");
        sb.append("State Code,").append(csv(response.getStateCode())).append("\r\n");
        sb.append("PT Registration Number,").append(csv(response.getPtRegistrationNumber())).append("\r\n");
        sb.append("\r\n");

        sb.append("Slab Summary\r\n");
        sb.append("PT Amount,Employee Count,Total\r\n");
        for (PtReturnSlabSummaryDTO slab : response.getSlabs()) {
            sb.append(String.join(",",
                    plain(slab.getPtAmount()),
                    String.valueOf(slab.getEmployeeCount() == null ? 0 : slab.getEmployeeCount()),
                    plain(slab.getTotalAmount())));
            sb.append("\r\n");
        }
        sb.append("\r\n");

        sb.append("Employee Details\r\n");
        sb.append("Employee Code,Name,Gross Salary,PT Amount\r\n");
        for (PtReturnRowDTO row : response.getRows()) {
            sb.append(String.join(",",
                    csv(row.getEmployeeCode()),
                    csv(row.getName()),
                    plain(row.getGrossSalary()),
                    plain(row.getPtAmount())));
            sb.append("\r\n");
        }
        sb.append("\r\n");
        sb.append("Grand Total,,,").append(plain(response.getGrandTotalPt())).append("\r\n");
        return sb.toString();
    }

    private Map<String, String> buildUserNameMap(List<String> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        List<User> users = userRepository.findByIdIn(userIds);
        return users.stream().collect(Collectors.toMap(
                User::getId,
                u -> u.getFullName() != null ? u.getFullName() : u.getUsername(),
                (a, b) -> a));
    }

    private static String csv(String value) {
        if (value == null) {
            return "";
        }
        String cleaned = value.replace("\r", " ").replace("\n", " ");
        if (cleaned.contains(",") || cleaned.contains("\"")) {
            return "\"" + cleaned.replace("\"", "\"\"") + "\"";
        }
        return cleaned;
    }

    private static String plain(BigDecimal value) {
        return value == null ? "0.00" : value.toPlainString();
    }

    private static BigDecimal nvl(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static final class PtAgg {
        private final EmployeeProfile employee;
        private final Set<String> seenEntryIds = new HashSet<>();
        private BigDecimal ptAmount = BigDecimal.ZERO;
        private BigDecimal gross = BigDecimal.ZERO;

        private PtAgg(EmployeeProfile employee) {
            this.employee = employee;
        }
    }
}
