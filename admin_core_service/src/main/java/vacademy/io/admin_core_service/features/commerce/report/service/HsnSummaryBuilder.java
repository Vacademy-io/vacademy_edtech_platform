package vacademy.io.admin_core_service.features.commerce.report.service;

import vacademy.io.admin_core_service.features.commerce.common.CommerceUnits;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.InvoiceLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.NoteLine;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * HSN summary (contract section 2.4), net of credit notes, in two tables: B2B (the document has
 * a buyer GSTIN) and B2C. A group is HSN × UQC × rate.
 *
 * <ul>
 *   <li>Quantity: Σ base units ÷ the line's scale, exact, printed to two places; a sum that
 *       needs more places is rounded half up with warning {@code QTY_ROUNDED}.</li>
 *   <li>UQC: the stored unit code in upper case, every piece spelling the platform allows (PCS,
 *       NOS, PC, NO, PIECE, PIECES) as {@code PCS}, so the rows merge; delivery and COD-charge
 *       lines are services: UQC {@code NA}, quantity 0. A code outside the GST list: warning
 *       {@code UQC_UNKNOWN}.</li>
 *   <li>Scale: the order line's, else the invoice snapshot's (both resolved in SQL); neither:
 *       scale 1 and warning {@code SCALE_UNKNOWN}.</li>
 *   <li>Description: the current tax-class name (a label only), else the line text of a service.</li>
 *   <li>Round-off is not part of HSN values: Σ invoice round-off − Σ note round-off is given apart
 *       so that Σ total value + round-off = Σ invoice totals − Σ note totals.</li>
 * </ul>
 */
final class HsnSummaryBuilder {

    static final Set<String> SERVICE_TYPES = Set.of("COMMERCE_SHIPPING", "COMMERCE_COD_CHARGE");

    /** The GST unit quantity codes. */
    static final Set<String> GST_UQC = Set.of("BAG", "BAL", "BDL", "BKL", "BOU", "BOX", "BTL", "BUN", "CAN", "CBM",
            "CCM", "CMS", "CTN", "DOZ", "DRM", "GGK", "GMS", "GRS", "GYD", "KGS", "KLR", "KME", "LTR", "MLT", "MTR",
            "MTS", "NOS", "OTH", "PAC", "PCS", "PRS", "QTL", "ROL", "SET", "SQF", "SQM", "SQY", "TBS", "TGM", "THD",
            "TON", "TUB", "UGS", "UNT", "YDS", "NA");

    private static final class Group {
        final String hsn;
        final String uqc;
        final BigDecimal rate;
        final Set<String> descriptions = new LinkedHashSet<>();
        BigDecimal quantity = BigDecimal.ZERO;
        final TaxSums sums = new TaxSums();

        Group(String hsn, String uqc, BigDecimal rate) {
            this.hsn = hsn;
            this.uqc = uqc;
            this.rate = rate;
        }
    }

    /**
     * The piece codes the platform accepts for a counted item (and the GST code NOS): one GST UQC,
     * {@code PCS}, so one HSN at one rate is one row whatever spelling a tax class used.
     */
    static final Set<String> PIECE_ALIASES = CommerceUnits.PIECE_CODES;

    /** The GST UQC of a stored unit: upper case, piece aliases as {@code PCS}. */
    static String uqc(String unit) {
        String code = unit == null ? "" : unit.trim().toUpperCase(Locale.ROOT);
        return PIECE_ALIASES.contains(code) ? "PCS" : code;
    }

    private final ReportWarnings warnings;
    private final Map<String, Group> b2b = new TreeMap<>();
    private final Map<String, Group> b2c = new TreeMap<>();
    private final Set<String> invoicesSeen = new HashSet<>();
    private final Set<String> notesSeen = new HashSet<>();
    private BigDecimal roundOff = BigDecimal.ZERO;
    private BigDecimal documentsTotal = BigDecimal.ZERO;

    HsnSummaryBuilder(ReportWarnings warnings) {
        this.warnings = warnings;
    }

    void invoiceLine(InvoiceLine l) {
        if (invoicesSeen.add(l.invoiceId())) {
            roundOff = roundOff.add(l.roundOff());
            documentsTotal = documentsTotal.add(l.invoiceTotal());
        }
        add(hasGstin(l.buyerGstin()), 1, l.invoiceNumber(), l.itemType(), l.hsn(), l.unit(), l.rate(), l.quantity(),
                l.qtyScale(), l.taxClassName(), l.description(), l);
    }

    void noteLine(NoteLine l) {
        if (notesSeen.add(l.noteId())) {
            roundOff = roundOff.subtract(l.noteRoundOff());
            documentsTotal = documentsTotal.subtract(l.noteTotal());
        }
        add(hasGstin(l.buyerGstin()), -1, l.noteNumber(), l.itemType(), l.hsn(), l.unit(), l.rate(), l.quantity(),
                l.qtyScale(), l.taxClassName(), l.description(), l);
    }

    private void add(boolean registered, int sign, String documentNumber, String itemType, String hsn, String unit,
                     BigDecimal rate, long quantity, Integer qtyScale, String taxClassName, String description,
                     Object line) {
        String hsnCode = hsn == null ? "" : hsn.trim();
        if (hsnCode.isEmpty()) {
            warnings.add(ReportWarnings.HSN_MISSING, "a line has no HSN code", documentNumber);
        } else if (hsnCode.replaceAll("[^0-9]", "").length() < 4) {
            warnings.add(ReportWarnings.HSN_SHORT, "HSN code has fewer than 4 digits", hsnCode);
        }
        boolean service = itemType != null && SERVICE_TYPES.contains(itemType);
        String uqc;
        BigDecimal displayQuantity;
        if (service) {
            uqc = "NA";
            displayQuantity = BigDecimal.ZERO;
        } else {
            uqc = uqc(unit);
            if (!GST_UQC.contains(uqc)) {
                warnings.add(ReportWarnings.UQC_UNKNOWN, "unit is not a GST UQC code; map it before filing",
                        uqc.isEmpty() ? "(blank)" : uqc);
            }
            int scale = 1;
            if (qtyScale == null) {
                warnings.add(ReportWarnings.SCALE_UNKNOWN, "the line's quantity scale is unknown; counted as 1",
                        documentNumber);
            } else {
                scale = Math.max(qtyScale, 1);
            }
            displayQuantity = BigDecimal.valueOf(quantity).divide(BigDecimal.valueOf(scale), MathContext.DECIMAL64);
        }
        BigDecimal shownRate = ReportTable.rate(rate);
        String key = hsnCode + "\u0000" + uqc + "\u0000" + String.format(Locale.ROOT, "%012.4f", shownRate);
        Group group = (registered ? b2b : b2c).computeIfAbsent(key, k -> new Group(hsnCode, uqc, shownRate));
        group.quantity = group.quantity.add(sign < 0 ? displayQuantity.negate() : displayQuantity);
        if (line instanceof InvoiceLine l) {
            group.sums.add(sign, l.taxable(), l.cgst(), l.sgst(), l.igst(), l.cess());
        } else if (line instanceof NoteLine l) {
            group.sums.add(sign, l.taxable(), l.cgst(), l.sgst(), l.igst(), l.cess());
        }
        if (taxClassName != null && !taxClassName.isBlank()) {
            group.descriptions.add(taxClassName.trim());
        } else if (service && description != null && !description.isBlank()) {
            group.descriptions.add(description.trim());
        }
    }

    ReportDtos.Section b2b(String key, String label, String labelHi) {
        return section(key, label, labelHi, b2b);
    }

    ReportDtos.Section b2c(String key, String label, String labelHi) {
        return section(key, label, labelHi, b2c);
    }

    /** Σ invoice round-off − Σ note round-off. */
    BigDecimal roundOff() {
        return roundOff;
    }

    /** Σ invoice totals − Σ note totals. */
    BigDecimal documentsTotal() {
        return documentsTotal;
    }

    /** Σ total value of both tables. */
    BigDecimal totalValue() {
        BigDecimal sum = BigDecimal.ZERO;
        for (Group g : b2b.values()) {
            sum = sum.add(g.sums.total());
        }
        for (Group g : b2c.values()) {
            sum = sum.add(g.sums.total());
        }
        return sum;
    }

    /** The sums of both tables (the cross-check with tax by rate and GSTR-1). */
    TaxSums sums() {
        TaxSums total = new TaxSums();
        b2b.values().forEach(g -> total.add(1, g.sums));
        b2c.values().forEach(g -> total.add(1, g.sums));
        return total;
    }

    private ReportDtos.Section section(String key, String label, String labelHi, Map<String, Group> groups) {
        List<Map<String, Object>> rows = new ArrayList<>();
        TaxSums total = new TaxSums();
        BigDecimal totalValue = BigDecimal.ZERO;
        for (Group g : groups.values()) {
            BigDecimal printed = g.quantity.setScale(2, RoundingMode.HALF_UP);
            if (g.quantity.stripTrailingZeros().scale() > 2) {
                warnings.add(ReportWarnings.QTY_ROUNDED, "quantity rounded to 2 places", g.hsn + " " + g.uqc);
            }
            Map<String, Object> row = ReportTable.row();
            row.put("hsn", g.hsn);
            row.put("description", g.descriptions.isEmpty() ? null : String.join("; ", g.descriptions));
            row.put("uqc", g.uqc);
            row.put("quantity", printed);
            row.put("total_value", ReportTable.money(g.sums.total()));
            row.put("rate", g.rate);
            row.put("taxable_value", ReportTable.money(g.sums.taxable));
            row.put("igst", ReportTable.money(g.sums.igst));
            row.put("cgst", ReportTable.money(g.sums.cgst));
            row.put("sgst", ReportTable.money(g.sums.sgst));
            row.put("cess", ReportTable.money(g.sums.cess));
            rows.add(row);
            total.add(1, g.sums);
            totalValue = totalValue.add(g.sums.total());
        }
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("total_value", ReportTable.money(totalValue));
        totals.put("taxable_value", ReportTable.money(total.taxable));
        totals.put("igst", ReportTable.money(total.igst));
        totals.put("cgst", ReportTable.money(total.cgst));
        totals.put("sgst", ReportTable.money(total.sgst));
        totals.put("cess", ReportTable.money(total.cess));
        return new ReportDtos.Section(key, label, labelHi, ReportTable.dto(GstColumns.HSN_ROWS), rows, totals);
    }

    private static boolean hasGstin(String gstin) {
        return gstin != null && !gstin.isBlank();
    }
}
