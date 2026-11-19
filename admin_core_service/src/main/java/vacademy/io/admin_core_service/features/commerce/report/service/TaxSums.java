package vacademy.io.admin_core_service.features.commerce.report.service;

import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;

import java.math.BigDecimal;
import java.util.Map;

/** Taxable value and the four taxes of a group, added with a sign (+1 invoice, −1 credit note). */
final class TaxSums {

    BigDecimal taxable = BigDecimal.ZERO;
    BigDecimal cgst = BigDecimal.ZERO;
    BigDecimal sgst = BigDecimal.ZERO;
    BigDecimal igst = BigDecimal.ZERO;
    BigDecimal cess = BigDecimal.ZERO;

    void add(int sign, BigDecimal taxableValue, BigDecimal cgstValue, BigDecimal sgstValue, BigDecimal igstValue,
             BigDecimal cessValue) {
        taxable = taxable.add(signed(sign, taxableValue));
        cgst = cgst.add(signed(sign, cgstValue));
        sgst = sgst.add(signed(sign, sgstValue));
        igst = igst.add(signed(sign, igstValue));
        cess = cess.add(signed(sign, cessValue));
    }

    void add(int sign, TaxSums other) {
        add(sign, other.taxable, other.cgst, other.sgst, other.igst, other.cess);
    }

    BigDecimal tax() {
        return cgst.add(sgst).add(igst).add(cess);
    }

    BigDecimal total() {
        return taxable.add(tax());
    }

    boolean isZero() {
        return taxable.signum() == 0 && tax().signum() == 0 && cgst.signum() == 0 && sgst.signum() == 0
                && igst.signum() == 0 && cess.signum() == 0;
    }

    /** taxable_value, cgst, sgst, igst, cess into a row or totals map. */
    void putInto(Map<String, Object> row) {
        row.put("taxable_value", ReportTable.money(taxable));
        row.put("cgst", ReportTable.money(cgst));
        row.put("sgst", ReportTable.money(sgst));
        row.put("igst", ReportTable.money(igst));
        row.put("cess", ReportTable.money(cess));
    }

    BigDecimal get(String key) {
        return switch (key) {
            case "taxable_value" -> taxable;
            case "cgst" -> cgst;
            case "sgst" -> sgst;
            case "igst" -> igst;
            case "cess" -> cess;
            default -> throw new IllegalArgumentException(key);
        };
    }

    static BigDecimal signed(int sign, BigDecimal value) {
        BigDecimal v = value == null ? BigDecimal.ZERO : value;
        return sign < 0 ? v.negate() : v;
    }
}
