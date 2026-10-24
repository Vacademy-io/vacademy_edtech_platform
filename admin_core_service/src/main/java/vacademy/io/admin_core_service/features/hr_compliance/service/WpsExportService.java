package vacademy.io.admin_core_service.features.hr_compliance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_compliance.dto.WpsEdrRowDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.WpsExportResponseDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.WpsFileDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.WpsSaudiRowDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.WpsSkippedRowDTO;
import vacademy.io.admin_core_service.features.hr_compliance.repository.ComplianceWpsQueryRepository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeBankDetail;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntry;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxConfiguration;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxConfigurationRepository;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.stream.Collectors;

/**
 * Gulf WPS (Wage Protection System) salary-file builder — Phase E, v1
 * layouts PENDING PORTAL VALIDATION:
 *
 * <ul>
 *   <li><b>UAE_SIF</b> — MOHRE Salary Information File: comma-separated EDR
 *       records (one per paid employee) plus one trailing SCR employer
 *       record. Not yet round-tripped through a bank/MOHRE portal validator.</li>
 *   <li><b>SAUDI_WPS</b> — Mudad-style CSV with a header block. Not yet
 *       validated against the Mudad portal.</li>
 * </ul>
 *
 * <p>Institute-level identifiers come from the tax configuration's
 * {@code statutory_settings} JSONB:
 * <ul>
 *   <li>{@code mol_establishment_id} — the employer's Ministry-of-Labour
 *       establishment id (UAE: MOHRE establishment ID; Saudi: MOL/Mudad
 *       establishment id).</li>
 *   <li>{@code employer_bank_code} — the employer's WPS agent / bank routing
 *       code (the bank that debits salaries).</li>
 *   <li>{@code wps_reference} — optional free-form employer reference.</li>
 * </ul>
 * Missing keys produce warnings and empty strings in the file — never a hard
 * failure, so HR can preview while configuration is being completed.
 *
 * <p>Per-employee routing: the EDR agent id is the employee's
 * {@code statutory_info.wps_agent_id} (their bank's WPS agent code), falling
 * back to {@code bankAccount.routingNumber}. The account identifier is
 * {@code bankAccount.iban}; employees without an IBAN are moved to the
 * skipped list and excluded from the file.
 *
 * <p>Population: non-HELD entries of the month's PROCESSED/APPROVED/PAID
 * runs (a warning flags PROCESSED — i.e. not yet approved — inclusions).
 * Multiple entries per employee (regular + off-cycle) are aggregated:
 * amounts SUM; attendance facts (working days, leave days) take the MAX
 * because they are per-month facts repeated on each entry that carries them.
 */
@Service
public class WpsExportService {

    public static final String FORMAT_UAE_SIF = "UAE_SIF";
    public static final String FORMAT_SAUDI_WPS = "SAUDI_WPS";

    /** Filable run statuses: money is determined once a run is PROCESSED. */
    private static final List<String> FILABLE_RUN_STATUSES = List.of("PROCESSED", "APPROVED", "PAID");

    private static final DateTimeFormatter ISO_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter TIME_HHMM = DateTimeFormatter.ofPattern("HHmm");

    @Autowired
    private ComplianceWpsQueryRepository wpsQueryRepository;

    @Autowired
    private TaxConfigurationRepository taxConfigurationRepository;

    @Autowired
    private UserRepository userRepository;

    // ------------------------------------------------------------------ build

    @Transactional(readOnly = true)
    public WpsExportResponseDTO buildExport(String instituteId, int month, int year, String formatOverride) {
        List<String> warnings = new ArrayList<>();

        TaxConfiguration config = resolveConfig(instituteId, formatOverride, warnings);
        String format = resolveFormat(config, formatOverride);
        String expectedCurrency = FORMAT_UAE_SIF.equals(format) ? "AED" : "SAR";

        Map<String, Object> settings = config == null ? null : config.getStatutorySettings();
        String establishmentId = requiredSetting(settings, "mol_establishment_id",
                "employer establishment id (MOHRE/MOL)", warnings);
        String employerBankCode = requiredSetting(settings, "employer_bank_code",
                "employer WPS agent/bank routing code", warnings);
        String wpsReference = optionalSetting(settings, "wps_reference");

        List<PayrollEntry> entries = wpsQueryRepository.findPayableEntries(
                instituteId, month, year, FILABLE_RUN_STATUSES);
        Map<String, BigDecimal> basicByEntry = FORMAT_SAUDI_WPS.equals(format)
                ? loadBasicByEntry(instituteId, month, year)
                : Map.of();

        // ---- aggregate per employee across the month's filable runs
        Map<String, EmpAgg> byEmployee = new LinkedHashMap<>();
        boolean sawProcessedRun = false;
        boolean sawMixedCurrency = false;
        for (PayrollEntry entry : entries) {
            EmployeeProfile employee = entry.getEmployee();
            if ("PROCESSED".equals(entry.getPayrollRun().getStatus())) {
                sawProcessedRun = true;
            }
            EmpAgg agg = byEmployee.computeIfAbsent(employee.getId(), k -> new EmpAgg(employee));
            agg.fixedIncome = agg.fixedIncome.add(nvl(entry.getTotalEarnings()));
            agg.variableIncome = agg.variableIncome
                    .add(nvl(entry.getOtherEarnings()))
                    .add(nvl(entry.getReimbursements()));
            agg.deductions = agg.deductions.add(nvl(entry.getTotalDeductions()));
            agg.netPay = agg.netPay.add(nvl(entry.getNetPay()));
            agg.basic = agg.basic.add(nvl(basicByEntry.get(entry.getId())));

            Integer workingDays = entry.getTotalWorkingDays();
            if (workingDays != null && (agg.workingDays == null || workingDays > agg.workingDays)) {
                agg.workingDays = workingDays;
            }
            BigDecimal leave = nvl(entry.getDaysOnLeave());
            if (leave.compareTo(agg.leaveDays) > 0) {
                agg.leaveDays = leave;
            }
            if (agg.bankAccount == null) {
                agg.bankAccount = entry.getBankAccount();
            }
            String entryCurrency = firstNonBlank(entry.getCurrency(), entry.getPayrollRun().getCurrency());
            if (entryCurrency != null) {
                if (agg.currency == null) {
                    agg.currency = entryCurrency;
                } else if (!agg.currency.equalsIgnoreCase(entryCurrency)) {
                    sawMixedCurrency = true;
                }
            }
        }
        if (sawProcessedRun) {
            warnings.add("Includes payroll run(s) still in PROCESSED status (not yet approved); "
                    + "re-generate after approval before submitting to the bank/portal.");
        }

        Map<String, String> nameMap = buildUserNameMap(byEmployee.values().stream()
                .map(a -> a.employee.getUserId()).distinct().collect(Collectors.toList()));

        LocalDate periodStart = LocalDate.of(year, month, 1);
        LocalDate periodEnd = periodStart.withDayOfMonth(periodStart.lengthOfMonth());

        List<WpsEdrRowDTO> edrRows = new ArrayList<>();
        List<WpsSaudiRowDTO> saudiRows = new ArrayList<>();
        List<WpsSkippedRowDTO> skipped = new ArrayList<>();
        TreeSet<String> missingPersonId = new TreeSet<>();
        TreeSet<String> missingGosi = new TreeSet<>();
        TreeSet<String> missingAgent = new TreeSet<>();
        TreeSet<String> basicFallback = new TreeSet<>();
        String fileCurrency = null;
        boolean currencyMismatch = false;

        for (EmpAgg agg : byEmployee.values()) {
            String employeeCode = nvlStr(agg.employee.getEmployeeCode());
            String name = nameMap.getOrDefault(agg.employee.getUserId(), "");
            String iban = agg.bankAccount == null ? null : agg.bankAccount.getIban();
            if (iban == null || iban.isBlank()) {
                skipped.add(WpsSkippedRowDTO.builder()
                        .employeeCode(employeeCode)
                        .employeeName(name)
                        .reason(agg.bankAccount == null
                                ? "No bank account on payroll entry — excluded from WPS file"
                                : "Missing IBAN on bank account — excluded from WPS file")
                        .build());
                continue;
            }
            iban = iban.trim();

            // statutory_info is decrypted by the entity converter.
            Map<String, Object> statutory = agg.employee.getStatutoryInfo();
            String agentId = firstNonBlank(str(statutory, "wps_agent_id"),
                    agg.bankAccount.getRoutingNumber());
            if (agentId == null) {
                agentId = "";
                missingAgent.add(labelOf(employeeCode, name));
            }

            String rowCurrency = agg.currency;
            if (rowCurrency != null) {
                if (fileCurrency == null) {
                    fileCurrency = rowCurrency.toUpperCase();
                }
                if (!expectedCurrency.equalsIgnoreCase(rowCurrency)) {
                    currencyMismatch = true;
                }
            }

            if (FORMAT_UAE_SIF.equals(format)) {
                String personId = str(statutory, "mol_person_id");
                if (personId == null) {
                    personId = employeeCode;
                    missingPersonId.add(labelOf(employeeCode, name));
                }
                edrRows.add(WpsEdrRowDTO.builder()
                        .employeeCode(employeeCode)
                        .employeeName(name)
                        .personId(personId)
                        .agentId(agentId)
                        .iban(iban)
                        .payStartDate(ISO_DATE.format(periodStart))
                        .payEndDate(ISO_DATE.format(periodEnd))
                        .daysInPeriod(agg.workingDays != null ? agg.workingDays : periodStart.lengthOfMonth())
                        .fixedIncome(scale2(agg.fixedIncome))
                        .variableIncome(scale2(agg.variableIncome))
                        .leaveDays(agg.leaveDays.setScale(0, RoundingMode.HALF_UP).intValue())
                        .netPay(scale2(agg.netPay))
                        .currency(rowCurrency)
                        .build());
            } else {
                String employeeId = str(statutory, "gosi_number");
                if (employeeId == null) {
                    employeeId = employeeCode;
                    missingGosi.add(labelOf(employeeCode, name));
                }
                // Basic salary is recovered from the entry's BASIC component;
                // when the structure defines none, totalEarnings stands in
                // (documented on WpsSaudiRowDTO) and the employee is flagged.
                BigDecimal basic = agg.basic;
                if (basic.compareTo(BigDecimal.ZERO) == 0) {
                    basic = agg.fixedIncome;
                    basicFallback.add(labelOf(employeeCode, name));
                }
                saudiRows.add(WpsSaudiRowDTO.builder()
                        .employeeCode(employeeCode)
                        .employeeName(name)
                        .employeeId(employeeId)
                        .iban(iban)
                        .bankCode(agentId)
                        .basicSalary(scale2(basic))
                        .housingAllowance(scale2(BigDecimal.ZERO))
                        .otherEarnings(scale2(agg.variableIncome))
                        .deductions(scale2(agg.deductions))
                        .netSalary(scale2(agg.netPay))
                        .currency(rowCurrency)
                        .build());
            }
        }
        edrRows.sort(Comparator.comparing(r -> nvlStr(r.getEmployeeCode())));
        saudiRows.sort(Comparator.comparing(r -> nvlStr(r.getEmployeeCode())));

        if (!missingPersonId.isEmpty()) {
            warnings.add("statutory_info.mol_person_id missing for " + missingPersonId.size()
                    + " employee(s) — employeeCode used as the EDR person id: "
                    + String.join(", ", missingPersonId));
        }
        if (!missingGosi.isEmpty()) {
            warnings.add("statutory_info.gosi_number missing for " + missingGosi.size()
                    + " employee(s) — employeeCode used as the employee id: "
                    + String.join(", ", missingGosi));
        }
        if (!missingAgent.isEmpty()) {
            warnings.add("No WPS agent/routing code (statutory_info.wps_agent_id or bank routing number) for "
                    + missingAgent.size() + " employee(s) — blank in file: "
                    + String.join(", ", missingAgent));
        }
        if (!basicFallback.isEmpty()) {
            warnings.add("No BASIC salary component found for " + basicFallback.size()
                    + " employee(s) — totalEarnings reported as basic salary: "
                    + String.join(", ", basicFallback));
        }
        if (sawMixedCurrency) {
            warnings.add("Entries with differing currencies were aggregated for at least one employee; "
                    + "verify the payroll run currency setup.");
        }
        if (currencyMismatch) {
            warnings.add("Payroll currency differs from the expected " + expectedCurrency
                    + " for format " + format + " — the WPS portal/bank may reject the file.");
        }
        if (fileCurrency == null) {
            fileCurrency = expectedCurrency;
        }

        int included = FORMAT_UAE_SIF.equals(format) ? edrRows.size() : saudiRows.size();
        BigDecimal totalNet = FORMAT_UAE_SIF.equals(format)
                ? sum(edrRows.stream().map(WpsEdrRowDTO::getNetPay).collect(Collectors.toList()))
                : sum(saudiRows.stream().map(WpsSaudiRowDTO::getNetSalary).collect(Collectors.toList()));

        return WpsExportResponseDTO.builder()
                .format(format)
                .instituteId(instituteId)
                .month(month)
                .year(year)
                .countryCode(config == null ? null : config.getCountryCode())
                .establishmentId(establishmentId)
                .employerBankCode(employerBankCode)
                .wpsReference(wpsReference)
                .edrRows(FORMAT_UAE_SIF.equals(format) ? edrRows : null)
                .saudiRows(FORMAT_SAUDI_WPS.equals(format) ? saudiRows : null)
                .skipped(skipped)
                .warnings(warnings)
                .employeeCount(included)
                .totalNetPay(scale2(totalNet))
                .currency(fileCurrency)
                .build();
    }

    // ------------------------------------------------------------------- files

    /** Renders the downloadable salary file for an already-built export. */
    public WpsFileDTO buildFile(WpsExportResponseDTO response) {
        if (FORMAT_UAE_SIF.equals(response.getFormat())) {
            return buildUaeSifFile(response);
        }
        return buildSaudiFile(response);
    }

    /**
     * UAE SIF v1 (pending MOHRE/bank portal validation). CRLF-terminated,
     * comma-separated records:
     * <pre>
     * EDR,&lt;personId&gt;,&lt;agentId&gt;,&lt;IBAN&gt;,&lt;payStart YYYY-MM-DD&gt;,&lt;payEnd YYYY-MM-DD&gt;,
     *     &lt;daysInPeriod&gt;,&lt;fixedIncome 2dp&gt;,&lt;variableIncome 2dp&gt;,&lt;leaveDays&gt;
     * SCR,&lt;molEstablishmentId&gt;,&lt;employerBankCode&gt;,&lt;creationDate YYYY-MM-DD&gt;,
     *     &lt;creationTime HHmm&gt;,&lt;salaryMonth MMYYYY&gt;,&lt;edrCount&gt;,&lt;totalSalary 2dp&gt;,&lt;currency&gt;
     * </pre>
     * WPS reconciles the SALARY actually paid, so the SCR total is the sum of
     * net pay across the EDR records.
     */
    private WpsFileDTO buildUaeSifFile(WpsExportResponseDTO response) {
        StringBuilder sb = new StringBuilder();
        for (WpsEdrRowDTO row : response.getEdrRows()) {
            sb.append(String.join(",",
                    "EDR",
                    csv(row.getPersonId()),
                    csv(row.getAgentId()),
                    csv(row.getIban()),
                    csv(row.getPayStartDate()),
                    csv(row.getPayEndDate()),
                    String.valueOf(row.getDaysInPeriod() == null ? 0 : row.getDaysInPeriod()),
                    amount(row.getFixedIncome()),
                    amount(row.getVariableIncome()),
                    String.valueOf(row.getLeaveDays() == null ? 0 : row.getLeaveDays())));
            sb.append("\r\n");
        }
        LocalDateTime now = LocalDateTime.now();
        String salaryMonth = String.format("%02d%04d", response.getMonth(), response.getYear());
        sb.append(String.join(",",
                "SCR",
                csv(response.getEstablishmentId()),
                csv(response.getEmployerBankCode()),
                ISO_DATE.format(now.toLocalDate()),
                TIME_HHMM.format(now),
                salaryMonth,
                String.valueOf(response.getEdrRows().size()),
                amount(response.getTotalNetPay()),
                csv(response.getCurrency())));
        sb.append("\r\n");

        return WpsFileDTO.builder()
                .filename("sif_" + filenameToken(response.getEstablishmentId()) + "_" + salaryMonth + ".sif")
                .mediaType("text/plain")
                .content(sb.toString())
                .build();
    }

    /**
     * Saudi WPS v1, Mudad-style CSV (pending Mudad validation): a commented
     * header block (establishment id + salary month), then a column-header
     * line, then one row per employee.
     */
    private WpsFileDTO buildSaudiFile(WpsExportResponseDTO response) {
        String salaryMonth = String.format("%02d%04d", response.getMonth(), response.getYear());
        StringBuilder sb = new StringBuilder();
        sb.append("#FORMAT,SAUDI_WPS_V1 (pending Mudad validation)\r\n");
        sb.append("#ESTABLISHMENT_ID,").append(csv(response.getEstablishmentId())).append("\r\n");
        sb.append("#EMPLOYER_BANK_CODE,").append(csv(response.getEmployerBankCode())).append("\r\n");
        sb.append("#SALARY_MONTH,").append(String.format("%02d-%04d", response.getMonth(), response.getYear()))
                .append("\r\n");
        sb.append("#GENERATED_AT,").append(ISO_DATE.format(LocalDate.now())).append("\r\n");
        sb.append("EmployeeId,EmployeeName,IBAN,BankCode,BasicSalary,HousingAllowance,")
                .append("OtherEarnings,Deductions,NetSalary\r\n");
        for (WpsSaudiRowDTO row : response.getSaudiRows()) {
            sb.append(String.join(",",
                    csv(row.getEmployeeId()),
                    csv(row.getEmployeeName()),
                    csv(row.getIban()),
                    csv(row.getBankCode()),
                    amount(row.getBasicSalary()),
                    amount(row.getHousingAllowance()),
                    amount(row.getOtherEarnings()),
                    amount(row.getDeductions()),
                    amount(row.getNetSalary())));
            sb.append("\r\n");
        }
        return WpsFileDTO.builder()
                .filename("wps_" + filenameToken(response.getEstablishmentId()) + "_" + salaryMonth + ".csv")
                .mediaType("text/csv")
                .content(sb.toString())
                .build();
    }

    // ------------------------------------------------------- format resolution

    /**
     * Picks the Gulf tax configuration the export is driven by. With an
     * explicit format override the matching config is used if present (else
     * null + warning); without one, exactly one of the institute's configs
     * must be a Gulf country (ARE/SAU after alias normalization).
     */
    private TaxConfiguration resolveConfig(String instituteId, String formatOverride, List<String> warnings) {
        List<TaxConfiguration> configs = taxConfigurationRepository.findAllByInstituteId(instituteId);
        TaxConfiguration uae = null;
        TaxConfiguration saudi = null;
        for (TaxConfiguration config : configs) {
            String code = normalizeCountry(config.getCountryCode());
            if ("ARE".equals(code)) uae = config;
            if ("SAU".equals(code)) saudi = config;
        }
        String override = normalizeFormat(formatOverride);
        if (override != null) {
            TaxConfiguration match = FORMAT_UAE_SIF.equals(override) ? uae : saudi;
            if (match == null) {
                warnings.add("No " + (FORMAT_UAE_SIF.equals(override) ? "UAE (ARE)" : "Saudi (SAU)")
                        + " tax configuration found for this institute; employer identifiers are blank.");
            }
            return match;
        }
        if (uae != null && saudi != null) {
            throw new VacademyException("Institute has both UAE and Saudi tax configurations; "
                    + "pass format=UAE_SIF or format=SAUDI_WPS");
        }
        if (uae == null && saudi == null) {
            throw new VacademyException("No UAE (ARE/UAE) or Saudi (SAU/KSA) tax configuration found "
                    + "for this institute; configure one or pass format=UAE_SIF / format=SAUDI_WPS");
        }
        return uae != null ? uae : saudi;
    }

    private String resolveFormat(TaxConfiguration config, String formatOverride) {
        String override = normalizeFormat(formatOverride);
        if (override != null) {
            return override;
        }
        // resolveConfig guarantees a Gulf config when no override is given.
        return "ARE".equals(normalizeCountry(config.getCountryCode())) ? FORMAT_UAE_SIF : FORMAT_SAUDI_WPS;
    }

    /** Accepts the documented values plus common aliases; null when absent. */
    private static String normalizeFormat(String format) {
        if (format == null || format.isBlank()) {
            return null;
        }
        return switch (format.trim().toUpperCase()) {
            case "UAE_SIF", "SIF", "UAE", "AE", "ARE", "MOHRE" -> FORMAT_UAE_SIF;
            case "SAUDI_WPS", "SAUDI", "KSA", "SA", "SAU", "MUDAD" -> FORMAT_SAUDI_WPS;
            default -> throw new VacademyException("Unknown WPS format '" + format
                    + "' — use UAE_SIF or SAUDI_WPS");
        };
    }

    /** Same alias normalization as hr_tax's TaxRegimeFactory (institutes configure aliases). */
    private static String normalizeCountry(String countryCode) {
        if (countryCode == null) return "";
        return switch (countryCode.trim().toUpperCase()) {
            case "UAE", "AE" -> "ARE";
            case "KSA", "SA", "SAUDI" -> "SAU";
            default -> countryCode.trim().toUpperCase();
        };
    }

    // ---------------------------------------------------------------- helpers

    private Map<String, BigDecimal> loadBasicByEntry(String instituteId, int month, int year) {
        Map<String, BigDecimal> basicByEntry = new HashMap<>();
        for (Object[] row : wpsQueryRepository.findBasicAmountsByEntry(
                instituteId, month, year, FILABLE_RUN_STATUSES)) {
            String entryId = (String) row[0];
            BigDecimal amount = nvl((BigDecimal) row[1]);
            basicByEntry.merge(entryId, amount, BigDecimal::add);
        }
        return basicByEntry;
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

    private static String requiredSetting(Map<String, Object> settings, String key,
                                          String label, List<String> warnings) {
        Object value = settings == null ? null : settings.get(key);
        if (value == null || value.toString().isBlank()) {
            warnings.add("statutory_settings." + key + " (" + label
                    + ") is not configured; blank in the file — set it before submitting.");
            return "";
        }
        return value.toString().trim();
    }

    private static String optionalSetting(Map<String, Object> settings, String key) {
        Object value = settings == null ? null : settings.get(key);
        return value == null ? "" : value.toString().trim();
    }

    /** Trimmed string value of a statutory_info key; null when absent/blank. */
    private static String str(Map<String, Object> map, String key) {
        Object value = map == null ? null : map.get(key);
        if (value == null) return null;
        String s = value.toString().trim();
        return s.isEmpty() ? null : s;
    }

    private static String firstNonBlank(String a, String b) {
        if (a != null && !a.isBlank()) return a.trim();
        if (b != null && !b.isBlank()) return b.trim();
        return null;
    }

    private static String labelOf(String employeeCode, String name) {
        return employeeCode != null && !employeeCode.isBlank() ? employeeCode
                : (name == null || name.isBlank() ? "(unknown)" : name);
    }

    /** CSV field: no commas or line breaks (WPS records are comma-separated). */
    private static String csv(String value) {
        if (value == null) {
            return "";
        }
        return value.replace(",", " ").replace("\r", " ").replace("\n", " ").trim();
    }

    /** Amounts as plain 2-decimal strings (no grouping, no exponent). */
    private static String amount(BigDecimal value) {
        return nvl(value).setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    /** Filename-safe token from a configured id (may be blank). */
    private static String filenameToken(String value) {
        String token = value == null ? "" : value.replaceAll("[^A-Za-z0-9_-]", "");
        return token.isEmpty() ? "UNSET" : token;
    }

    private static BigDecimal scale2(BigDecimal value) {
        return nvl(value).setScale(2, RoundingMode.HALF_UP);
    }

    private static BigDecimal sum(List<BigDecimal> values) {
        return values.stream().filter(java.util.Objects::nonNull)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static BigDecimal nvl(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static String nvlStr(String value) {
        return value == null ? "" : value;
    }

    /** Per-employee aggregation across the month's filable payroll entries. */
    private static final class EmpAgg {
        private final EmployeeProfile employee;
        private EmployeeBankDetail bankAccount;
        private BigDecimal fixedIncome = BigDecimal.ZERO;
        private BigDecimal variableIncome = BigDecimal.ZERO;
        private BigDecimal deductions = BigDecimal.ZERO;
        private BigDecimal netPay = BigDecimal.ZERO;
        private BigDecimal basic = BigDecimal.ZERO;
        private Integer workingDays;
        private BigDecimal leaveDays = BigDecimal.ZERO;
        private String currency;

        private EmpAgg(EmployeeProfile employee) {
            this.employee = employee;
        }
    }
}
