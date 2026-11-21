package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Form 16 Part B (Annexure) data for one employee + financial year, assembled
 * from the hr_tax_computation cumulative series. Part A (challan-wise TRACES
 * certificate) is NOT produced here — this Part B is system-generated for
 * verification against the TRACES download.
 *
 * PAN appears unmasked: the endpoint is guarded by requireSelfOrHrStaff, so
 * only HR staff or the employee themselves can read it.
 */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Form16DataDTO {

    // Employee (deductee)
    private String employeeId;
    private String employeeName;
    private String employeeCode;
    private String employeePan;

    // Deductor (employer) — from hr_tax_configuration.statutory_settings
    private String deductorName;
    private String deductorTan;
    private String deductorPan;
    private String deductorAddress;

    private String financialYear;
    private String regime;

    /** Gross salary paid in the FY = sum of the monthly cumulative deltas. */
    private BigDecimal grossSalaryPaid;

    // Exemptions (from the LAST computed month's computation_details)
    private BigDecimal standardDeduction;
    private BigDecimal hraExemption;
    private BigDecimal totalExemptions;

    /** Chapter VI-A deductions from the engine breakdown (deduction80c, deduction80d, ...). */
    private Map<String, BigDecimal> chapterVIADeductions;

    // Tax on total income (annual figures from the last computed month)
    private BigDecimal taxableIncome;
    private BigDecimal slabTax;
    private BigDecimal taxAfterRebate;
    private BigDecimal surcharge;
    private BigDecimal cess;
    private BigDecimal totalTaxLiability;

    /** Total TDS actually deducted in the FY (last month's cumulative actual_tax_deducted). */
    private BigDecimal totalTdsDeducted;

    /** Month of the last computation present (FY order); annual figures are projections until March. */
    private Integer lastComputedMonth;

    private List<Form16MonthlyRowDTO> monthlyDetails;

    /** Non-fatal issues: unconfigured statutory settings, missing PAN, incomplete FY, ... */
    private List<String> warnings;
}
