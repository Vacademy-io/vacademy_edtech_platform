package vacademy.io.admin_core_service.features.commerce.tax.calc;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * TEST DATA ONLY. PLACEHOLDER RATES, HSN CODES AND SLAB LIMITS.
 *
 * <p>Nothing in this class is tax advice or a real rate for any institute. The numbers were
 * chosen to exercise every rule of the calculator (a slab that changes above a unit price, a
 * zero rate, a cess, a rate that changes on a date). Real rates are set by each institute.
 * No migration and no production code reads this class, and every code here ends in {@code _TEST}.
 */
public final class TestTaxData {

    public static final LocalDate DATE_TEST = LocalDate.of(2026, 11, 14);
    private static final LocalDate FROM_TEST = LocalDate.of(2026, 4, 1);

    private TestTaxData() {
    }

    /** TEST: 5% up to a unit value of 1000.00, 12% from 1000.01. */
    public static TaxClassRef slabbedClassTest() {
        return TaxClassRef.builder().id("tc-slab-TEST").code("slabbed_TEST").hsnCode("0000").unit("PCS")
                .rules(List.of(
                        rule("0.00", "1000.00", "5", "0", FROM_TEST, null),
                        rule("1000.01", null, "12", "0", FROM_TEST, null)))
                .build();
    }

    /** TEST: the same slabs for goods sold by length. */
    public static TaxClassRef measuredClassTest() {
        return TaxClassRef.builder().id("tc-mtr-TEST").code("measured_TEST").hsnCode("0001").unit("MTR")
                .rules(List.of(
                        rule("0.00", "1000.00", "5", "0", FROM_TEST, null),
                        rule("1000.01", null, "12", "0", FROM_TEST, null)))
                .build();
    }

    /** TEST: a flat 18% (used for shipping and the COD charge). */
    public static TaxClassRef flatClassTest() {
        return TaxClassRef.builder().id("tc-flat-TEST").code("flat_TEST").hsnCode("9999").unit("PCS")
                .rules(List.of(rule("0.00", null, "18", "0", FROM_TEST, null)))
                .build();
    }

    /** TEST: taxed at zero. */
    public static TaxClassRef zeroClassTest() {
        return TaxClassRef.builder().id("tc-zero-TEST").code("zero_TEST").hsnCode("0002").unit("PCS")
                .rules(List.of(rule("0.00", null, "0", "0", FROM_TEST, null)))
                .build();
    }

    /** TEST: 28% with a 12% cess. */
    public static TaxClassRef cessClassTest() {
        return TaxClassRef.builder().id("tc-cess-TEST").code("cess_TEST").hsnCode("0003").unit("PCS")
                .rules(List.of(rule("0.00", null, "28", "12", FROM_TEST, null)))
                .build();
    }

    /** TEST: 12% until 2026-09-30, 5% from 2026-10-01. */
    public static TaxClassRef datedClassTest() {
        return TaxClassRef.builder().id("tc-dated-TEST").code("dated_TEST").hsnCode("0004").unit("PCS")
                .rules(List.of(
                        rule("0.00", null, "12", "0", FROM_TEST, LocalDate.of(2026, 9, 30)),
                        rule("0.00", null, "5", "0", LocalDate.of(2026, 10, 1), null)))
                .build();
    }

    public static TaxRateRule rule(String min, String max, String rate, String cess, LocalDate from, LocalDate to) {
        return TaxRateRule.builder()
                .minUnitPrice(new BigDecimal(min))
                .maxUnitPrice(max == null ? null : new BigDecimal(max))
                .ratePercent(new BigDecimal(rate))
                .cessPercent(new BigDecimal(cess))
                .effectiveFrom(from)
                .effectiveTo(to)
                .build();
    }
}
