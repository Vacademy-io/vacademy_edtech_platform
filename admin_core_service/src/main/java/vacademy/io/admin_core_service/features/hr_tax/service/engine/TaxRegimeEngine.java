package vacademy.io.admin_core_service.features.hr_tax.service.engine;

import java.util.List;

/**
 * Country tax engine (Strategy). Implementations must be pure functions of
 * {@link TaxInput} — no repository access — so they stay unit-testable against
 * hand-computed statutory scenarios.
 */
public interface TaxRegimeEngine {

    /** ISO-3166 alpha-3 country code this engine handles (e.g. "IND"). */
    String getCountryCode();

    /**
     * Income-tax withholding for the month, computed as a YTD true-up: project
     * the full year, compute annual liability, subtract tax already withheld,
     * spread the remainder over the months left (current included).
     */
    TaxResult calculateMonthlyTax(TaxInput input);

    /**
     * Statutory schemes for the month (India: EPF, ESI, PT), each with the
     * employee deduction and employer contribution. Payroll materializes these
     * as system salary components — UNLESS the employee's salary structure
     * already carries a component with the same code (template-managed
     * statutory wins; no double deduction).
     */
    List<StatutoryItem> calculateStatutory(TaxInput input);
}
