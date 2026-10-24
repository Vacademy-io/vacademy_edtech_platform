package vacademy.io.admin_core_service.features.hr_compliance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.hr_compliance.dto.Form24QChallanDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.Form24QDeducteeRowDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.Form24QDeductorDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.Form24QResponseDTO;
import vacademy.io.admin_core_service.features.hr_compliance.entity.TdsChallan;
import vacademy.io.admin_core_service.features.hr_compliance.repository.ComplianceTaxQueryRepository;
import vacademy.io.admin_core_service.features.hr_compliance.repository.TdsChallanRepository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxComputation;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxConfiguration;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxConfigurationRepository;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Form 24Q quarterly TDS return assembly (Phase D).
 *
 * Data derivation: monthly income / TDS amounts are cumulative deltas over the
 * FULL FY series of hr_tax_computation rows (per employee, FY order Apr..Mar),
 * because e.g. July's monthly figure = July cumulative - June cumulative even
 * though only Jul/Aug/Sep land in Q2's annexure. One annexure row is emitted
 * per employee per quarter month with TDS &gt; 0, under section 192.
 */
@Service
public class Form24QService {

    /** Salary TDS section for every annexure row. */
    private static final String SECTION_192 = "192";

    /** FY quarters: Q1 = Apr-Jun ... Q4 = Jan-Mar (calendar year = FY start year + 1). */
    private static final Map<String, int[]> QUARTER_MONTHS = Map.of(
            "Q1", new int[]{4, 5, 6},
            "Q2", new int[]{7, 8, 9},
            "Q3", new int[]{10, 11, 12},
            "Q4", new int[]{1, 2, 3});

    @Autowired
    private ComplianceTaxQueryRepository complianceTaxQueryRepository;

    @Autowired
    private TdsChallanRepository tdsChallanRepository;

    @Autowired
    private TaxConfigurationRepository taxConfigurationRepository;

    @Autowired
    private UserRepository userRepository;

    public Form24QResponseDTO buildForm24Q(String instituteId, String financialYear, String quarter) {
        String q = quarter != null ? quarter.toUpperCase() : "";
        int[] months = QUARTER_MONTHS.get(q);
        if (months == null) {
            throw new VacademyException("quarter must be Q1..Q4 (FY quarters, Q1 = Apr-Jun)");
        }

        List<String> warnings = new ArrayList<>();
        Form24QDeductorDTO deductor = loadDeductor(instituteId, warnings);

        // ---- deductee annexure: cumulative deltas over each employee's FY series
        List<TaxComputation> allComputations = complianceTaxQueryRepository
                .findAllByInstituteAndFinancialYear(instituteId, financialYear);

        Map<String, List<TaxComputation>> byEmployee = allComputations.stream()
                .collect(Collectors.groupingBy(c -> c.getEmployee().getId(), LinkedHashMap::new,
                        Collectors.toList()));

        List<Form24QDeducteeRowDTO> rows = new ArrayList<>();
        BigDecimal totalTds = BigDecimal.ZERO;
        for (List<TaxComputation> series : byEmployee.values()) {
            series.sort(Comparator.comparingInt(c -> Form16Service.fyIndex(c.getMonth())));
            EmployeeProfile employee = series.get(0).getEmployee();

            BigDecimal prevIncome = BigDecimal.ZERO;
            BigDecimal prevTds = BigDecimal.ZERO;
            for (TaxComputation c : series) {
                BigDecimal cumIncome = nvl(c.getActualIncomeTillDate());
                BigDecimal cumTds = nvl(c.getActualTaxDeducted());
                BigDecimal incomePaid = cumIncome.subtract(prevIncome);
                BigDecimal tdsDeducted = cumTds.subtract(prevTds);
                prevIncome = cumIncome;
                prevTds = cumTds;

                if (!inQuarter(months, c.getMonth()) || tdsDeducted.signum() <= 0) {
                    continue;
                }
                rows.add(Form24QDeducteeRowDTO.builder()
                        .employeeId(employee.getId())
                        .pan(nvlStr(employee.getPanNumber()))
                        .employeeCode(nvlStr(employee.getEmployeeCode()))
                        .month(c.getMonth())
                        .year(c.getYear() != null ? c.getYear() : calendarYearFor(financialYear, c.getMonth()))
                        .monthName(Form16Service.monthName(c.getMonth()))
                        .incomePaid(incomePaid)
                        .tdsDeducted(tdsDeducted)
                        .section(SECTION_192)
                        .build());
                totalTds = totalTds.add(tdsDeducted);

                if (!StringUtils.hasText(employee.getPanNumber())) {
                    String code = StringUtils.hasText(employee.getEmployeeCode())
                            ? employee.getEmployeeCode() : employee.getId();
                    String w = "PAN missing for employee " + code + " — 24Q annexure rows need a valid PAN";
                    if (!warnings.contains(w)) warnings.add(w);
                }
            }
        }

        // Fill names in one batch, then sort the annexure by name + FY month
        Map<String, String> nameByUserId = buildUserNameMap(byEmployee.values().stream()
                .map(s -> s.get(0).getEmployee().getUserId()).distinct().collect(Collectors.toList()));
        Map<String, String> userIdByEmployeeId = byEmployee.values().stream()
                .collect(Collectors.toMap(s -> s.get(0).getEmployee().getId(),
                        s -> nvlStr(s.get(0).getEmployee().getUserId()), (a, b) -> a));
        for (Form24QDeducteeRowDTO row : rows) {
            row.setName(nameByUserId.getOrDefault(userIdByEmployeeId.getOrDefault(row.getEmployeeId(), ""), ""));
        }
        rows.sort(Comparator.comparing(Form24QDeducteeRowDTO::getName)
                .thenComparing(r -> Form16Service.fyIndex(r.getMonth())));

        // ---- challans for the quarter
        List<TdsChallan> challans = tdsChallanRepository
                .findByInstituteIdAndFinancialYearAndQuarterOrderByDepositDateAsc(instituteId, financialYear, q);
        BigDecimal challanTotal = challans.stream()
                .map(c -> nvl(c.getAmount()))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (challans.isEmpty() && totalTds.signum() > 0) {
            warnings.add("No TDS challans recorded for " + q + " FY " + financialYear
                    + " — record deposits in the challan register before filing");
        }

        boolean mismatch = totalTds.compareTo(challanTotal) != 0;
        if (mismatch) {
            warnings.add("Quarter TDS deducted (" + totalTds.toPlainString() + ") does not match challan deposits ("
                    + challanTotal.toPlainString() + ")");
        }

        return Form24QResponseDTO.builder()
                .financialYear(financialYear)
                .quarter(q)
                .deductor(deductor)
                .challans(challans.stream().map(this::toChallanDTO).collect(Collectors.toList()))
                .deducteeRows(rows)
                .totalTdsDeducted(totalTds)
                .totalChallanAmount(challanTotal)
                .mismatch(mismatch)
                .warnings(warnings)
                .build();
    }

    /**
     * CSV rendering of the 24Q data. v1 PREPARER-INPUT format: a commented
     * header block, a challan section and a deductee annexure section. This is
     * NOT the FVU e-TDS binary — the CSV feeds a return preparer / RPU-style
     * utility which produces the actual e-TDS file.
     */
    public String toCsv(Form24QResponseDTO data) {
        StringBuilder sb = new StringBuilder();
        sb.append("# FORM 24Q PREPARER INPUT (v1) - feed to a TDS return preparer utility;"
                + " this file is NOT the FVU e-TDS format\n");
        sb.append("# Financial Year: ").append(data.getFinancialYear())
                .append("  Quarter: ").append(data.getQuarter()).append("\n");
        if (data.getWarnings() != null) {
            for (String w : data.getWarnings()) {
                sb.append("# WARNING: ").append(w.replace("\n", " ")).append("\n");
            }
        }
        sb.append("\n[DEDUCTOR]\n");
        sb.append(csv("Deductor Name", "TAN", "PAN", "Address", "Financial Year", "Quarter")).append("\n");
        Form24QDeductorDTO d = data.getDeductor();
        sb.append(csv(d.getName(), d.getTan(), d.getPan(), d.getAddress(),
                data.getFinancialYear(), data.getQuarter())).append("\n");

        sb.append("\n[CHALLANS]\n");
        sb.append(csv("Sr No", "Deposit Date", "BSR Code", "Challan Serial", "Amount", "Interest", "Fee")).append("\n");
        int sr = 1;
        for (Form24QChallanDTO c : data.getChallans()) {
            sb.append(csv(String.valueOf(sr++),
                    c.getDepositDate() != null ? c.getDepositDate().toString() : "",
                    nvlStr(c.getBsrCode()), nvlStr(c.getChallanSerial()),
                    plain(c.getAmount()), plain(c.getInterest()), plain(c.getFee()))).append("\n");
        }

        sb.append("\n[DEDUCTEE ANNEXURE]\n");
        sb.append(csv("Sr No", "PAN", "Name", "Employee Code", "Month", "Year", "Section",
                "Income Paid", "TDS Deducted")).append("\n");
        sr = 1;
        for (Form24QDeducteeRowDTO r : data.getDeducteeRows()) {
            sb.append(csv(String.valueOf(sr++), nvlStr(r.getPan()), nvlStr(r.getName()),
                    nvlStr(r.getEmployeeCode()), nvlStr(r.getMonthName()),
                    r.getYear() != null ? String.valueOf(r.getYear()) : "",
                    nvlStr(r.getSection()), plain(r.getIncomePaid()), plain(r.getTdsDeducted()))).append("\n");
        }

        sb.append("\n[TOTALS]\n");
        sb.append(csv("Quarter TDS Deducted", "Challan Deposits", "Mismatch")).append("\n");
        sb.append(csv(plain(data.getTotalTdsDeducted()), plain(data.getTotalChallanAmount()),
                String.valueOf(data.isMismatch()))).append("\n");
        return sb.toString();
    }

    // --------------------------------------------------------------- helpers

    private Form24QDeductorDTO loadDeductor(String instituteId, List<String> warnings) {
        Map<String, Object> settings = taxConfigurationRepository
                .findByInstituteIdAndCountryCode(instituteId, "IN")
                .or(() -> taxConfigurationRepository.findAllByInstituteIdAndStatus(instituteId, "ACTIVE")
                        .stream().findFirst())
                .map(TaxConfiguration::getStatutorySettings)
                .orElse(null);

        Map<String, String> values = new LinkedHashMap<>();
        for (String key : List.of("deductor_name", "deductor_address", "employer_pan", "tan")) {
            Object v = settings != null ? settings.get(key) : null;
            String s = v != null ? v.toString().trim() : "";
            values.put(key, s);
            if (s.isEmpty()) {
                warnings.add("Statutory setting '" + key
                        + "' is not configured in tax configuration statutory_settings");
            }
        }
        return Form24QDeductorDTO.builder()
                .name(values.get("deductor_name"))
                .address(values.get("deductor_address"))
                .pan(values.get("employer_pan"))
                .tan(values.get("tan"))
                .build();
    }

    private Form24QChallanDTO toChallanDTO(TdsChallan c) {
        return Form24QChallanDTO.builder()
                .id(c.getId())
                .depositDate(c.getDepositDate())
                .bsrCode(c.getBsrCode())
                .challanSerial(c.getChallanSerial())
                .amount(c.getAmount())
                .interest(c.getInterest())
                .fee(c.getFee())
                .build();
    }

    private Map<String, String> buildUserNameMap(List<String> userIds) {
        List<String> ids = userIds.stream().filter(StringUtils::hasText).collect(Collectors.toList());
        if (ids.isEmpty()) return Map.of();
        List<User> users = userRepository.findByIdIn(ids);
        return users.stream().collect(Collectors.toMap(
                User::getId,
                u -> u.getFullName() != null ? u.getFullName() : nvlStr(u.getUsername()),
                (a, b) -> a));
    }

    private static boolean inQuarter(int[] months, Integer month) {
        if (month == null) return false;
        for (int m : months) {
            if (m == month) return true;
        }
        return false;
    }

    /** Months 4-12 fall in the FY start year; months 1-3 in start year + 1. */
    static int calendarYearFor(String financialYear, Integer month) {
        int startYear;
        try {
            startYear = Integer.parseInt(financialYear.substring(0, 4));
        } catch (Exception e) {
            return 0;
        }
        return (month != null && month >= 4) ? startYear : startYear + 1;
    }

    private static String csv(String... cells) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cells.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(escapeCsv(cells[i]));
        }
        return sb.toString();
    }

    private static String escapeCsv(String s) {
        if (s == null) return "";
        if (s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r")) {
            return "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }

    private static String plain(BigDecimal v) {
        return v != null ? v.toPlainString() : "0";
    }

    private static BigDecimal nvl(BigDecimal v) {
        return v != null ? v : BigDecimal.ZERO;
    }

    private static String nvlStr(String v) {
        return v != null ? v : "";
    }
}
