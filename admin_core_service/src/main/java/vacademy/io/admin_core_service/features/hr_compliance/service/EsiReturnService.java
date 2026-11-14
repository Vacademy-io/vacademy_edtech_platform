package vacademy.io.admin_core_service.features.hr_compliance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_compliance.dto.EsiReturnResponseDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.EsiReturnRowDTO;
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
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Monthly ESIC contribution return builder (v1 — CSV mirroring the portal's
 * monthly-contribution columns; not yet validated against an ESIC portal
 * upload).
 *
 * <p>"Days worked" judgment call: ESIC asks for the number of days for which
 * wages were PAYABLE, which includes paid leave. PayrollEntry keeps
 * days_present / days_on_leave / days_absent separately, so paid days =
 * round HALF_UP(days_present + days_on_leave). Unpaid absence (days_absent)
 * is what reduced the wage and is correctly excluded.
 */
@Service
public class EsiReturnService {

    /** Employee-side ESI code aliases (PayrollCalculationService.STATUTORY_ALIASES). */
    private static final Set<String> ESI_EMPLOYEE_CODES = Set.of("ESI", "ESI_EMP");

    /** Employer-side aliases: the engine writes <code>_ER</code>-suffixed twins. */
    private static final Set<String> ESI_EMPLOYER_CODES = Set.of("ESI_ER", "ESI_EMP_ER");

    private static final List<String> FILABLE_RUN_STATUSES = List.of("PROCESSED", "APPROVED", "PAID");

    @Autowired
    private ComplianceStatutoryQueryRepository statutoryQueryRepository;

    @Autowired
    private TaxConfigurationRepository taxConfigurationRepository;

    @Autowired
    private UserRepository userRepository;

    @Transactional(readOnly = true)
    public EsiReturnResponseDTO buildReturn(String instituteId, int month, int year) {
        List<String> warnings = new ArrayList<>();
        String employerCode = resolveEmployerCode(instituteId, warnings);

        Set<String> allCodes = Stream.concat(ESI_EMPLOYEE_CODES.stream(), ESI_EMPLOYER_CODES.stream())
                .collect(Collectors.toSet());
        List<PayrollEntryComponent> components = statutoryQueryRepository.findStatutoryComponents(
                instituteId, month, year, FILABLE_RUN_STATUSES, allCodes);

        // Aggregate per employee across the month's filable runs. Contribution
        // amounts and gross SUM across entries; paid days take the MAX across
        // entries (attendance is a per-month fact repeated per entry that
        // carries it — summing would double-count off-cycle runs).
        Map<String, IpAgg> byEmployee = new LinkedHashMap<>();
        boolean sawProcessedRun = false;
        for (PayrollEntryComponent component : components) {
            PayrollEntry entry = component.getPayrollEntry();
            EmployeeProfile employee = entry.getEmployee();
            if ("PROCESSED".equals(entry.getPayrollRun().getStatus())) {
                sawProcessedRun = true;
            }
            IpAgg agg = byEmployee.computeIfAbsent(employee.getId(), k -> new IpAgg(employee));
            String code = component.getComponent().getCode() == null
                    ? "" : component.getComponent().getCode().toUpperCase();
            if (ESI_EMPLOYEE_CODES.contains(code)) {
                agg.employeeContribution = agg.employeeContribution.add(nvl(component.getAmount()));
                agg.hasEmployeeSide = true;
            } else if (ESI_EMPLOYER_CODES.contains(code)) {
                agg.employerContribution = agg.employerContribution.add(nvl(component.getAmount()));
            }
            if (agg.seenEntryIds.add(entry.getId())) {
                agg.gross = agg.gross.add(nvl(entry.getGrossSalary()));
                BigDecimal paidDays = nvl(entry.getDaysPresent()).add(nvl(entry.getDaysOnLeave()));
                if (paidDays.compareTo(agg.paidDays) > 0) {
                    agg.paidDays = paidDays;
                }
            }
        }
        if (sawProcessedRun) {
            warnings.add("Includes payroll run(s) still in PROCESSED status (not yet approved); "
                    + "re-generate after approval before filing.");
        }

        Map<String, String> nameMap = buildUserNameMap(byEmployee.values().stream()
                .map(a -> a.employee.getUserId()).distinct().collect(Collectors.toList()));

        List<EsiReturnRowDTO> rows = new ArrayList<>();
        List<EsiReturnResponseDTO.SkippedRow> skipped = new ArrayList<>();
        for (IpAgg agg : byEmployee.values()) {
            if (!agg.hasEmployeeSide) {
                // Employer-side component with no IP deduction — not an insured
                // person's contribution line for this month.
                continue;
            }
            String name = nameMap.getOrDefault(agg.employee.getUserId(), "");
            String ipNumber = resolveIpNumber(agg.employee);
            if (ipNumber == null || ipNumber.isBlank()) {
                skipped.add(EsiReturnResponseDTO.SkippedRow.builder()
                        .employeeCode(agg.employee.getEmployeeCode())
                        .employeeName(name)
                        .reason("Missing ESI IP number (statutory_info esi_number/ip_number) — excluded from return file")
                        .build());
                continue;
            }
            rows.add(EsiReturnRowDTO.builder()
                    .employeeCode(agg.employee.getEmployeeCode())
                    .ipNumber(ipNumber.trim())
                    .name(name)
                    .daysWorked(agg.paidDays.setScale(0, RoundingMode.HALF_UP).intValue())
                    .monthlyWage(agg.gross.setScale(2, RoundingMode.HALF_UP))
                    .ipContribution(agg.employeeContribution.setScale(2, RoundingMode.HALF_UP))
                    .employerContribution(agg.employerContribution.setScale(2, RoundingMode.HALF_UP))
                    .build());
        }
        rows.sort(Comparator.comparing(r -> r.getEmployeeCode() == null ? "" : r.getEmployeeCode()));

        return EsiReturnResponseDTO.builder()
                .instituteId(instituteId)
                .month(month)
                .year(year)
                .esiEmployerCode(employerCode)
                .rows(rows)
                .skipped(skipped)
                .warnings(warnings)
                .ipCount(rows.size())
                .totalWages(sum(rows, EsiReturnRowDTO::getMonthlyWage))
                .totalIpContribution(sum(rows, EsiReturnRowDTO::getIpContribution))
                .totalEmployerContribution(sum(rows, EsiReturnRowDTO::getEmployerContribution))
                .build();
    }

    /** CSV download: skipped employees (no IP number) are excluded from the file. */
    public String buildCsv(EsiReturnResponseDTO response) {
        StringBuilder sb = new StringBuilder();
        sb.append("IP Number,IP Name,No Of Days,Monthly Wage,IP Contribution,Employer Contribution\r\n");
        for (EsiReturnRowDTO row : response.getRows()) {
            sb.append(String.join(",",
                    csv(row.getIpNumber()),
                    csv(row.getName()),
                    String.valueOf(row.getDaysWorked() == null ? 0 : row.getDaysWorked()),
                    plain(row.getMonthlyWage()),
                    plain(row.getIpContribution()),
                    plain(row.getEmployerContribution())));
            sb.append("\r\n");
        }
        return sb.toString();
    }

    /** IP number lives in the decrypted statutory_info map: esi_number, fallback ip_number. */
    private static String resolveIpNumber(EmployeeProfile employee) {
        Map<String, Object> info = employee.getStatutoryInfo();
        if (info == null) {
            return null;
        }
        Object value = info.get("esi_number");
        if (value == null || value.toString().isBlank()) {
            value = info.get("ip_number");
        }
        return value == null ? null : value.toString();
    }

    private String resolveEmployerCode(String instituteId, List<String> warnings) {
        TaxConfiguration config = taxConfigurationRepository
                .findByInstituteIdAndCountryCode(instituteId, "IN").orElse(null);
        if (config == null) {
            warnings.add("No India (IN) tax configuration found for this institute; "
                    + "ESI employer code is blank.");
            return "";
        }
        Map<String, Object> settings = config.getStatutorySettings();
        Object value = settings == null ? null : settings.get("esi_employer_code");
        if (value == null || value.toString().isBlank()) {
            warnings.add("statutory_settings.esi_employer_code is not configured; "
                    + "set it in the tax configuration before filing.");
            return "";
        }
        return value.toString().trim();
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

    private static BigDecimal sum(List<EsiReturnRowDTO> rows,
                                  java.util.function.Function<EsiReturnRowDTO, BigDecimal> getter) {
        return rows.stream().map(getter).filter(java.util.Objects::nonNull)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static final class IpAgg {
        private final EmployeeProfile employee;
        private final Set<String> seenEntryIds = new HashSet<>();
        private boolean hasEmployeeSide = false;
        private BigDecimal employeeContribution = BigDecimal.ZERO;
        private BigDecimal employerContribution = BigDecimal.ZERO;
        private BigDecimal gross = BigDecimal.ZERO;
        private BigDecimal paidDays = BigDecimal.ZERO;

        private IpAgg(EmployeeProfile employee) {
            this.employee = employee;
        }
    }
}
