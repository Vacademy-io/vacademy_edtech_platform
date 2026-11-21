package vacademy.io.admin_core_service.features.hr_compliance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_compliance.dto.PfEcrResponseDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.PfEcrRowDTO;
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

/**
 * Monthly EPFO ECR (Electronic Challan cum Return) builder — v1, PENDING
 * EPFO PORTAL VALIDATION: the line layout follows the published ECR v2
 * text-file spec ({@code #~#}-separated, one line per member) but has not yet
 * been round-tripped through the unified portal's file validator.
 *
 * <p>Wage-base recovery: payroll stores only the deducted PF amount per
 * entry. The engine computes employee PF as 12% of min(basic, 15,000)
 * rounded HALF_UP to the rupee, so the base is recovered as
 * {@code wageBase = round(pfAmount / 0.12)} and the EPS (8.33%) / employer
 * EPF (12% − EPS) split is re-derived from that base with the engine's own
 * rounding (HALF_UP to the rupee, EPS rate 0.0833).
 */
@Service
public class PfEcrService {

    private static final BigDecimal PF_RATE = new BigDecimal("0.12");
    private static final BigDecimal EPS_RATE = new BigDecimal("0.0833");

    /** Employee-side PF component code aliases (PayrollCalculationService.STATUTORY_ALIASES). */
    private static final Set<String> PF_EMPLOYEE_CODES = Set.of("PF", "EPF", "PF_EMP", "PROVIDENT_FUND");

    /** Filable run statuses: money is determined once a run is PROCESSED. */
    private static final List<String> FILABLE_RUN_STATUSES = List.of("PROCESSED", "APPROVED", "PAID");

    @Autowired
    private ComplianceStatutoryQueryRepository statutoryQueryRepository;

    @Autowired
    private TaxConfigurationRepository taxConfigurationRepository;

    @Autowired
    private UserRepository userRepository;

    @Transactional(readOnly = true)
    public PfEcrResponseDTO buildReturn(String instituteId, int month, int year) {
        List<String> warnings = new ArrayList<>();
        String establishmentId = resolveEstablishmentId(instituteId, warnings);

        List<PayrollEntryComponent> components = statutoryQueryRepository.findStatutoryComponents(
                instituteId, month, year, FILABLE_RUN_STATUSES, PF_EMPLOYEE_CODES);

        // Aggregate per employee across the month's filable runs (regular +
        // off-cycle). Amounts and gross SUM across entries; NCP days take the
        // MAX across entries because attendance is a per-month fact repeated
        // on each entry that carries it — summing would double-count.
        Map<String, MemberAgg> byEmployee = new LinkedHashMap<>();
        boolean sawProcessedRun = false;
        for (PayrollEntryComponent component : components) {
            PayrollEntry entry = component.getPayrollEntry();
            EmployeeProfile employee = entry.getEmployee();
            if ("PROCESSED".equals(entry.getPayrollRun().getStatus())) {
                sawProcessedRun = true;
            }
            MemberAgg agg = byEmployee.computeIfAbsent(employee.getId(), k -> new MemberAgg(employee));
            agg.pfAmount = agg.pfAmount.add(nvl(component.getAmount()));
            if (agg.seenEntryIds.add(entry.getId())) {
                agg.gross = agg.gross.add(nvl(entry.getGrossSalary()));
                BigDecimal absent = nvl(entry.getDaysAbsent());
                if (absent.compareTo(agg.daysAbsent) > 0) {
                    agg.daysAbsent = absent;
                }
            }
        }
        if (sawProcessedRun) {
            warnings.add("Includes payroll run(s) still in PROCESSED status (not yet approved); "
                    + "re-generate after approval before filing.");
        }

        Map<String, String> nameMap = buildUserNameMap(byEmployee.values().stream()
                .map(a -> a.employee.getUserId()).distinct().collect(Collectors.toList()));

        List<PfEcrRowDTO> rows = new ArrayList<>();
        List<PfEcrResponseDTO.SkippedRow> skipped = new ArrayList<>();
        for (MemberAgg agg : byEmployee.values()) {
            String name = nameMap.getOrDefault(agg.employee.getUserId(), "");
            String uan = agg.employee.getUanNumber(); // decrypted by the entity converter
            if (uan == null || uan.isBlank()) {
                skipped.add(PfEcrResponseDTO.SkippedRow.builder()
                        .employeeCode(agg.employee.getEmployeeCode())
                        .employeeName(name)
                        .reason("Missing UAN — excluded from ECR file")
                        .build());
                continue;
            }
            // Recover the PF wage base from the deducted amount and re-derive
            // the EPS / employer-EPF split with the engine's rounding.
            BigDecimal epfContri = agg.pfAmount.setScale(0, RoundingMode.HALF_UP);
            BigDecimal wageBase = agg.pfAmount.divide(PF_RATE, 0, RoundingMode.HALF_UP);
            BigDecimal eps = wageBase.multiply(EPS_RATE).setScale(0, RoundingMode.HALF_UP);
            BigDecimal employerTotal = wageBase.multiply(PF_RATE).setScale(0, RoundingMode.HALF_UP);
            BigDecimal diff = employerTotal.subtract(eps);

            rows.add(PfEcrRowDTO.builder()
                    .employeeCode(agg.employee.getEmployeeCode())
                    .uan(uan.trim())
                    .memberName(name)
                    .grossWages(agg.gross.setScale(0, RoundingMode.HALF_UP))
                    .epfWages(wageBase)
                    .epsWages(wageBase)
                    .edliWages(wageBase)
                    .epfContriRemitted(epfContri)
                    .epsContriRemitted(eps)
                    .epfEpsDiffRemitted(diff)
                    .ncpDays(agg.daysAbsent.setScale(0, RoundingMode.HALF_UP).intValue())
                    .refundOfAdvances(BigDecimal.ZERO)
                    .build());
        }
        rows.sort(Comparator.comparing(r -> nvlStr(r.getEmployeeCode())));

        return PfEcrResponseDTO.builder()
                .instituteId(instituteId)
                .month(month)
                .year(year)
                .pfEstablishmentId(establishmentId)
                .rows(rows)
                .skipped(skipped)
                .warnings(warnings)
                .memberCount(rows.size())
                .totalEpfWages(sum(rows, PfEcrRowDTO::getEpfWages))
                .totalEpfContri(sum(rows, PfEcrRowDTO::getEpfContriRemitted))
                .totalEpsContri(sum(rows, PfEcrRowDTO::getEpsContriRemitted))
                .totalEpfEpsDiff(sum(rows, PfEcrRowDTO::getEpfEpsDiffRemitted))
                .build();
    }

    /**
     * ECR v2 text file: one {@code #~#}-separated line per member with a UAN.
     * Members in the skipped list are NOT written — the portal rejects lines
     * without a valid UAN.
     */
    public String buildEcrFile(PfEcrResponseDTO response) {
        StringBuilder sb = new StringBuilder();
        for (PfEcrRowDTO row : response.getRows()) {
            sb.append(String.join("#~#",
                    row.getUan(),
                    sanitizeEcrField(row.getMemberName()),
                    plain(row.getGrossWages()),
                    plain(row.getEpfWages()),
                    plain(row.getEpsWages()),
                    plain(row.getEdliWages()),
                    plain(row.getEpfContriRemitted()),
                    plain(row.getEpsContriRemitted()),
                    plain(row.getEpfEpsDiffRemitted()),
                    String.valueOf(row.getNcpDays() == null ? 0 : row.getNcpDays()),
                    plain(row.getRefundOfAdvances())));
            sb.append("\r\n");
        }
        return sb.toString();
    }

    private String resolveEstablishmentId(String instituteId, List<String> warnings) {
        TaxConfiguration config = taxConfigurationRepository
                .findByInstituteIdAndCountryCode(instituteId, "IN").orElse(null);
        if (config == null) {
            warnings.add("No India (IN) tax configuration found for this institute; "
                    + "PF establishment id is blank.");
            return "";
        }
        Map<String, Object> settings = config.getStatutorySettings();
        Object value = settings == null ? null : settings.get("pf_establishment_id");
        if (value == null || value.toString().isBlank()) {
            warnings.add("statutory_settings.pf_establishment_id is not configured; "
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

    /** ECR fields must not contain the #~# separator or line breaks. */
    private static String sanitizeEcrField(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("#", " ").replace("~", " ")
                .replace("\r", " ").replace("\n", " ").trim();
    }

    private static String plain(BigDecimal value) {
        return value == null ? "0" : value.toPlainString();
    }

    private static BigDecimal nvl(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static String nvlStr(String value) {
        return value == null ? "" : value;
    }

    private static BigDecimal sum(List<PfEcrRowDTO> rows,
                                  java.util.function.Function<PfEcrRowDTO, BigDecimal> getter) {
        return rows.stream().map(getter).filter(java.util.Objects::nonNull)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static final class MemberAgg {
        private final EmployeeProfile employee;
        private final Set<String> seenEntryIds = new HashSet<>();
        private BigDecimal pfAmount = BigDecimal.ZERO;
        private BigDecimal gross = BigDecimal.ZERO;
        private BigDecimal daysAbsent = BigDecimal.ZERO;

        private MemberAgg(EmployeeProfile employee) {
            this.employee = employee;
        }
    }
}
