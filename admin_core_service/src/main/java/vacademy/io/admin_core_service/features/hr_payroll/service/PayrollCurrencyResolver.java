package vacademy.io.admin_core_service.features.hr_payroll.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxConfiguration;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxConfigurationRepository;
import vacademy.io.admin_core_service.features.hr_tax.service.engine.TaxRegimeFactory;

/**
 * The currency an institute pays salaries in, derived from its configured tax
 * country. Payroll runs, entries and payslips all stamp a currency, and they
 * must agree — so they resolve it here rather than each defaulting on their own.
 *
 * <p>An institute that has not configured tax yet still has to be able to create
 * a payroll run (hr_payroll_run.currency is NOT NULL), so an unset or unknown
 * country falls back to {@link #FALLBACK_CURRENCY} instead of failing.
 */
@Component
public class PayrollCurrencyResolver {

    public static final String FALLBACK_CURRENCY = "INR";

    @Autowired
    private TaxConfigurationRepository taxConfigurationRepository;

    /** ISO-4217 code for the institute's payroll, never null. */
    public String resolve(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            return FALLBACK_CURRENCY;
        }
        return taxConfigurationRepository.findByInstituteId(instituteId)
                .map(TaxConfiguration::getCountryCode)
                .map(PayrollCurrencyResolver::currencyForCountry)
                .orElse(FALLBACK_CURRENCY);
    }

    /** Country → currency for the geographies payroll supports today. */
    public static String currencyForCountry(String countryCode) {
        return switch (TaxRegimeFactory.normalize(countryCode)) {
            case "IND" -> "INR";
            case "ARE" -> "AED";
            case "SAU" -> "SAR";
            default -> FALLBACK_CURRENCY;
        };
    }
}
