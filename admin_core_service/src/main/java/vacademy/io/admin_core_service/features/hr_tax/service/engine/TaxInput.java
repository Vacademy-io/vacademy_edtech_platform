package vacademy.io.admin_core_service.features.hr_tax.service.engine;

import lombok.Builder;
import lombok.Getter;

import java.math.BigDecimal;
import java.util.Map;

/**
 * Everything a country engine needs to compute one payroll month's withholding
 * and statutory contributions for one employee. Built by PayrollCalculationService.
 *
 * Money semantics: "ForMonth" values are attendance/joining-prorated actuals for
 * the payroll month; "MonthlyFull" values are the un-prorated structure amounts
 * used for forward projection. YTD values cover the financial year up to but
 * EXCLUDING the current month.
 */
@Getter
@Builder
public class TaxInput {

    private final String financialYear;      // e.g. "2025-26"
    private final int month;                 // payroll month 1-12
    private final int year;                  // payroll calendar year

    /** Payroll months of this FY remaining AFTER this one (0 for the last FY month). */
    private final int monthsRemainingAfterCurrent;

    private final BigDecimal grossForMonth;
    private final BigDecimal grossMonthlyFull;
    private final BigDecimal basicForMonth;
    private final BigDecimal basicMonthlyFull;

    /** Annual HRA component per the salary structure (un-prorated), null if none. */
    private final BigDecimal hraReceivedAnnual;

    /** Taxable income already paid this FY (excluding this month). */
    private final BigDecimal ytdTaxableIncome;
    /** Income tax already withheld this FY (excluding this month). */
    private final BigDecimal ytdTaxDeducted;

    /** OLD | NEW (defaulted by the engine when null). */
    private final String regime;

    /**
     * Declaration items ALREADY FILTERED by the caller's verification policy —
     * the engine trusts these amounts but still applies statutory caps and
     * computes exemptions (HRA etc.) itself; it never honors a self-declared
     * exemption amount directly.
     */
    private final Map<String, Object> declarations;

    /** Institute tax rules JSONB (may hold per-FY overrides); never null (empty ok). */
    private final Map<String, Object> taxRules;
    /** Institute statutory settings JSONB; never null (empty ok). */
    private final Map<String, Object> statutorySettings;

    /** State for professional tax etc., may be null. */
    private final String stateCode;

    /**
     * Gross at the start of the current ESI contribution period (Apr/Oct), for
     * the stickiness rule; null when unknown (engine falls back to grossMonthlyFull).
     */
    private final BigDecimal esiGrossAtPeriodStart;

    /**
     * Employee nationality (free text from the profile), for nationality-gated
     * schemes: GPSSA applies to UAE/GCC nationals, GOSI splits Saudi nationals
     * vs expats. Null-safe — engines treat null as expat/non-national.
     */
    private final String nationality;

    /**
     * Completed years of service as of the payroll month (fractional), for
     * tenure-banded accruals: UAE EOSB 21 vs 30 days/year at the 5-year mark,
     * Saudi EOSB half- vs full-month. Null treated as 0.
     */
    private final BigDecimal serviceYears;
}
