package vacademy.io.admin_core_service.features.hr_compliance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.hr_compliance.dto.Form16DataDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.Form16MonthlyRowDTO;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_payslip.service.HrFileStorageService;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxComputation;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxConfiguration;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxComputationRepository;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxConfigurationRepository;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxDeclarationRepository;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.time.Month;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Form 16 Part B (Annexure) assembly (Phase D).
 *
 * Data derivation: hr_tax_computation stores CUMULATIVE actual_income_till_date
 * and actual_tax_deducted per employee/FY/month. Monthly amounts are the deltas
 * between consecutive present months in FY order (Apr..Mar); the first present
 * month's delta is its cumulative itself. Months with no computation row are
 * simply absent. Annual figures (taxable income, slab tax, cess, ...) come from
 * the LAST computed month's computation_details — the engine's projection,
 * which equals actuals once March is computed.
 */
@Service
public class Form16Service {

    private static final DecimalFormat MONEY = new DecimalFormat("#,##0.00");

    @Autowired
    private TaxComputationRepository taxComputationRepository;

    @Autowired
    private TaxConfigurationRepository taxConfigurationRepository;

    @Autowired
    private TaxDeclarationRepository taxDeclarationRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private HrFileStorageService hrFileStorageService;

    /** The validated employee comes from HrAccessGuard.requireSelfOrHrStaff — never re-fetched here. */
    public Form16DataDTO buildForm16(EmployeeProfile employee, String instituteId, String financialYear) {
        List<TaxComputation> computations = taxComputationRepository
                .findByEmployee_IdAndFinancialYearOrderByMonthAsc(employee.getId(), financialYear);
        if (computations.isEmpty()) {
            throw new VacademyException("No tax computations found for this employee in FY " + financialYear
                    + " — Form 16 cannot be generated");
        }

        // Repository orders by raw calendar month (1..12); re-sort into FY order Apr..Mar.
        computations.sort(Comparator.comparingInt(c -> fyIndex(c.getMonth())));
        TaxComputation last = computations.get(computations.size() - 1);

        List<String> warnings = new ArrayList<>();

        // Monthly actuals from cumulative deltas
        List<Form16MonthlyRowDTO> monthlyRows = new ArrayList<>();
        BigDecimal prevIncome = BigDecimal.ZERO;
        BigDecimal prevTds = BigDecimal.ZERO;
        BigDecimal grossSalaryPaid = BigDecimal.ZERO;
        for (TaxComputation c : computations) {
            BigDecimal cumIncome = nvl(c.getActualIncomeTillDate());
            BigDecimal cumTds = nvl(c.getActualTaxDeducted());
            BigDecimal incomePaid = cumIncome.subtract(prevIncome);
            BigDecimal tdsDeducted = cumTds.subtract(prevTds);
            monthlyRows.add(Form16MonthlyRowDTO.builder()
                    .month(c.getMonth())
                    .year(c.getYear())
                    .monthName(monthName(c.getMonth()))
                    .incomePaid(incomePaid)
                    .tdsDeducted(tdsDeducted)
                    .build());
            grossSalaryPaid = grossSalaryPaid.add(incomePaid);
            prevIncome = cumIncome;
            prevTds = cumTds;
        }

        // Annual figures from the last computed month's engine breakdown
        Map<String, Object> details = last.getComputationDetails() != null
                ? last.getComputationDetails() : Map.of();

        Map<String, BigDecimal> chapterVIA = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : details.entrySet()) {
            if (e.getKey().startsWith("deduction")) {
                BigDecimal v = toBigDecimal(e.getValue());
                if (v != null) chapterVIA.put(e.getKey(), v);
            }
        }

        String regime = details.get("regime") instanceof String s && StringUtils.hasText(s)
                ? s
                : taxDeclarationRepository.findByEmployee_IdAndFinancialYear(employee.getId(), financialYear)
                        .map(d -> d.getRegime() != null ? d.getRegime() : "").orElse("");

        if (fyIndex(last.getMonth()) < 11) {
            warnings.add("FY " + financialYear + " is computed only through " + monthName(last.getMonth())
                    + " — annual figures (taxable income, tax liability) are projections, not final actuals");
        }
        if (!StringUtils.hasText(employee.getPanNumber())) {
            warnings.add("Employee PAN is not on record — Form 16 requires the deductee PAN");
        }

        Map<String, String> deductor = loadDeductorSettings(instituteId, warnings);

        return Form16DataDTO.builder()
                .employeeId(employee.getId())
                .employeeName(resolveEmployeeName(employee.getUserId()))
                .employeeCode(nvlStr(employee.getEmployeeCode()))
                .employeePan(nvlStr(employee.getPanNumber()))
                .deductorName(deductor.get("deductor_name"))
                .deductorTan(deductor.get("tan"))
                .deductorPan(deductor.get("employer_pan"))
                .deductorAddress(deductor.get("deductor_address"))
                .financialYear(financialYear)
                .regime(regime)
                .grossSalaryPaid(grossSalaryPaid)
                .standardDeduction(toBigDecimal(details.get("standardDeduction")))
                .hraExemption(toBigDecimal(details.get("hraExemption")))
                .totalExemptions(nvl(last.getTotalExemptions()))
                .chapterVIADeductions(chapterVIA)
                .taxableIncome(toBigDecimal(details.get("taxableIncome")))
                .slabTax(toBigDecimal(details.get("slabTax")))
                .taxAfterRebate(toBigDecimal(details.get("taxAfterRebate")))
                .surcharge(toBigDecimal(details.get("surcharge")))
                .cess(toBigDecimal(details.get("cess")))
                .totalTaxLiability(nvl(last.getProjectedAnnualTax()))
                .totalTdsDeducted(nvl(last.getActualTaxDeducted()))
                .lastComputedMonth(last.getMonth())
                .monthlyDetails(monthlyRows)
                .warnings(warnings)
                .build();
    }

    /** Renders the Part B data as a printable PDF (openhtmltopdf via HrFileStorageService). */
    public byte[] renderForm16Pdf(Form16DataDTO data) {
        return hrFileStorageService.htmlToPdf(buildForm16Html(data));
    }

    // ------------------------------------------------------------------ html

    private String buildForm16Html(Form16DataDTO d) {
        StringBuilder sb = new StringBuilder();
        sb.append("<html><head><meta charset=\"UTF-8\"/><style>")
                .append("body{font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#1a1a1a;margin:24px;}")
                .append("h1{font-size:16px;text-align:center;margin:0 0 2px 0;}")
                .append("h2{font-size:12px;margin:16px 0 6px 0;border-bottom:1px solid #444;padding-bottom:3px;}")
                .append(".note{font-size:9px;color:#555;text-align:center;margin-bottom:14px;}")
                .append("table{width:100%;border-collapse:collapse;margin-bottom:8px;}")
                .append("td,th{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top;}")
                .append("th{background:#efefef;}")
                .append(".num{text-align:right;}")
                .append(".total td{font-weight:bold;background:#f7f7f7;}")
                .append(".warn{color:#8a5a00;font-size:9px;margin-top:10px;}")
                .append("</style></head><body>");

        sb.append("<h1>FORM 16 - PART B (Annexure)</h1>");
        sb.append("<div class=\"note\">Part A of Form 16 is issued from TRACES. This Part B is "
                + "system-generated from payroll tax computations for verification purposes.</div>");

        sb.append("<h2>Deductor / Deductee</h2><table>");
        row2(sb, "Deductor (Employer)", esc(d.getDeductorName()), "Employee Name", esc(d.getEmployeeName()));
        row2(sb, "TAN", esc(d.getDeductorTan()), "Employee Code", esc(d.getEmployeeCode()));
        row2(sb, "Employer PAN", esc(d.getDeductorPan()), "Employee PAN", esc(d.getEmployeePan()));
        row2(sb, "Address", esc(d.getDeductorAddress()), "Financial Year", esc(d.getFinancialYear()));
        row2(sb, "Tax Regime", esc(d.getRegime()), "", "");
        sb.append("</table>");

        sb.append("<h2>1. Gross Salary and Monthly Detail</h2><table>")
                .append("<tr><th>Month</th><th class=\"num\">Salary Paid (Rs.)</th><th class=\"num\">TDS Deducted (Rs.)</th></tr>");
        if (d.getMonthlyDetails() != null) {
            for (Form16MonthlyRowDTO m : d.getMonthlyDetails()) {
                sb.append("<tr><td>").append(esc(m.getMonthName())).append(" ").append(m.getYear())
                        .append("</td><td class=\"num\">").append(money(m.getIncomePaid()))
                        .append("</td><td class=\"num\">").append(money(m.getTdsDeducted()))
                        .append("</td></tr>");
            }
        }
        sb.append("<tr class=\"total\"><td>Total</td><td class=\"num\">").append(money(d.getGrossSalaryPaid()))
                .append("</td><td class=\"num\">").append(money(d.getTotalTdsDeducted())).append("</td></tr>")
                .append("</table>");

        sb.append("<h2>2. Exemptions and Deductions</h2><table>");
        moneyRow(sb, "Standard Deduction (Sec 16)", d.getStandardDeduction());
        moneyRow(sb, "HRA Exemption (Sec 10(13A))", d.getHraExemption());
        if (d.getChapterVIADeductions() != null) {
            for (Map.Entry<String, BigDecimal> e : d.getChapterVIADeductions().entrySet()) {
                moneyRow(sb, esc(chapterVIALabel(e.getKey())), e.getValue());
            }
        }
        moneyRow(sb, "Total Exemptions and Deductions", d.getTotalExemptions());
        sb.append("</table>");

        sb.append("<h2>3. Tax on Total Income</h2><table>");
        moneyRow(sb, "Taxable Income", d.getTaxableIncome());
        moneyRow(sb, "Tax on Taxable Income (slab)", d.getSlabTax());
        moneyRow(sb, "Tax after Rebate (Sec 87A)", d.getTaxAfterRebate());
        moneyRow(sb, "Surcharge", d.getSurcharge());
        moneyRow(sb, "Health and Education Cess (4%)", d.getCess());
        moneyRow(sb, "Total Tax Liability", d.getTotalTaxLiability());
        moneyRow(sb, "Total TDS Deducted (Sec 192)", d.getTotalTdsDeducted());
        sb.append("</table>");

        if (d.getWarnings() != null && !d.getWarnings().isEmpty()) {
            sb.append("<div class=\"warn\">");
            for (String w : d.getWarnings()) {
                sb.append("&#9888; ").append(esc(w)).append("<br/>");
            }
            sb.append("</div>");
        }

        sb.append("</body></html>");
        return sb.toString();
    }

    private static void row2(StringBuilder sb, String l1, String v1, String l2, String v2) {
        sb.append("<tr><th style=\"width:18%\">").append(l1).append("</th><td style=\"width:32%\">").append(v1)
                .append("</td><th style=\"width:18%\">").append(l2).append("</th><td>").append(v2)
                .append("</td></tr>");
    }

    private static void moneyRow(StringBuilder sb, String label, BigDecimal value) {
        sb.append("<tr><td>").append(label).append("</td><td class=\"num\" style=\"width:30%\">")
                .append(money(value)).append("</td></tr>");
    }

    private static String chapterVIALabel(String key) {
        return switch (key) {
            case "deduction80c" -> "Deduction under Sec 80C";
            case "deduction80d" -> "Deduction under Sec 80D";
            case "deduction80ccd2" -> "Deduction under Sec 80CCD(2)";
            default -> key;
        };
    }

    // --------------------------------------------------------------- helpers

    private Map<String, String> loadDeductorSettings(String instituteId, List<String> warnings) {
        Map<String, Object> settings = taxConfigurationRepository
                .findByInstituteIdAndCountryCode(instituteId, "IN")
                .or(() -> taxConfigurationRepository.findAllByInstituteIdAndStatus(instituteId, "ACTIVE")
                        .stream().findFirst())
                .map(TaxConfiguration::getStatutorySettings)
                .orElse(null);

        Map<String, String> out = new LinkedHashMap<>();
        for (String key : List.of("deductor_name", "deductor_address", "employer_pan", "tan")) {
            Object v = settings != null ? settings.get(key) : null;
            String s = v != null ? v.toString().trim() : "";
            out.put(key, s);
            if (s.isEmpty()) {
                warnings.add("Statutory setting '" + key
                        + "' is not configured in tax configuration statutory_settings");
            }
        }
        return out;
    }

    private String resolveEmployeeName(String userId) {
        if (!StringUtils.hasText(userId)) return "";
        List<User> users = userRepository.findByIdIn(List.of(userId));
        if (users.isEmpty()) return "";
        User u = users.get(0);
        return u.getFullName() != null ? u.getFullName() : nvlStr(u.getUsername());
    }

    /** FY position of a calendar month: Apr=0 ... Mar=11 (TDS months belong to the FY Apr-Mar). */
    static int fyIndex(Integer month) {
        int m = month != null ? month : 1;
        return m >= 4 ? m - 4 : m + 8;
    }

    static String monthName(Integer month) {
        if (month == null || month < 1 || month > 12) return "";
        return Month.of(month).getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
    }

    static BigDecimal toBigDecimal(Object value) {
        if (value == null) return null;
        if (value instanceof BigDecimal bd) return bd;
        try {
            return new BigDecimal(value.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static BigDecimal nvl(BigDecimal v) {
        return v != null ? v : BigDecimal.ZERO;
    }

    private static String nvlStr(String v) {
        return v != null ? v : "";
    }

    private static String money(BigDecimal v) {
        return v != null ? MONEY.format(v) : "-";
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
