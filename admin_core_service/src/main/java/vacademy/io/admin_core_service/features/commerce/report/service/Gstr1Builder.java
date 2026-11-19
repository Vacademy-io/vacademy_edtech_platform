package vacademy.io.admin_core_service.features.commerce.report.service;

import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.InvoiceLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.NoteLine;
import vacademy.io.admin_core_service.features.commerce.report.service.Gstr1Classifier.ExempBucket;
import vacademy.io.admin_core_service.features.commerce.report.service.Gstr1Classifier.Section;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * The value sections of GSTR-1 (b2b, b2cl, b2cs with the credit notes netted into it, cdnr,
 * cdnur, exemp) and the check block (contract section 2.5). The HSN and documents sheets come
 * from {@link HsnSummaryBuilder} and {@link DocumentsIssuedService}.
 */
final class Gstr1Builder {

    static final List<String> CHECK_COLUMNS = List.of("taxable_value", "cgst", "sgst", "igst", "cess");

    /** One document × rate row. */
    private static final class DocRate {
        String documentId;
        String number;
        LocalDate date;
        String gstin;
        String placeOfSupply;
        BigDecimal value;
        BigDecimal rate;
        String originalId;
        String originalNumber;
        LocalDate originalDate;
        final TaxSums sums = new TaxSums();
    }

    private final BigDecimal b2clLimit;
    private final ReportWarnings warnings;

    private final Map<String, DocRate> b2b = new LinkedHashMap<>();
    private final Map<String, DocRate> b2cl = new LinkedHashMap<>();
    /** B2C small rows: place of supply, then rate (numeric). */
    private record B2csKey(String placeOfSupply, BigDecimal rate) implements Comparable<B2csKey> {
        @Override
        public int compareTo(B2csKey o) {
            int c = placeOfSupply.compareTo(o.placeOfSupply);
            return c != 0 ? c : rate.compareTo(o.rate);
        }
    }

    private final Map<B2csKey, TaxSums> b2cs = new TreeMap<>();
    private final Map<String, DocRate> b2csNotes = new LinkedHashMap<>();
    private final Map<String, DocRate> cdnr = new LinkedHashMap<>();
    private final Map<String, DocRate> cdnur = new LinkedHashMap<>();
    private final Map<ExempBucket, TaxSums> exemp = new EnumMap<>(ExempBucket.class);

    private final TaxSums invoiceDocuments = new TaxSums();
    private final TaxSums noteDocuments = new TaxSums();
    private final Set<String> notTaxInvoices = new HashSet<>();
    private final Set<String> notTaxNotes = new HashSet<>();

    Gstr1Builder(BigDecimal b2clLimit, ReportWarnings warnings) {
        this.b2clLimit = b2clLimit;
        this.warnings = warnings;
        for (ExempBucket bucket : ExempBucket.values()) {
            exemp.put(bucket, new TaxSums());
        }
    }

    void invoiceLine(InvoiceLine l) {
        boolean inter = Gstr1Classifier.interState(l.taxHead(), l.placeOfSupply(), l.sellerState());
        Section section = Gstr1Classifier.invoiceLine(l.documentType(), l.buyerGstin(), inter, l.invoiceTotal(),
                l.rate(), b2clLimit);
        if (section == Section.NONE) {
            notTaxInvoices.add(l.invoiceId());
            return;
        }
        invoiceDocuments.add(1, l.taxable(), l.cgst(), l.sgst(), l.igst(), l.cess());
        switch (section) {
            case B2B, B2CL -> {
                Map<String, DocRate> target = section == Section.B2B ? b2b : b2cl;
                DocRate row = target.computeIfAbsent(l.invoiceId() + "|" + ReportTable.rate(l.rate()), k -> {
                    DocRate r = new DocRate();
                    r.documentId = l.invoiceId();
                    r.number = l.invoiceNumber();
                    r.date = l.documentDate();
                    r.gstin = l.buyerGstin();
                    r.placeOfSupply = l.placeOfSupply();
                    r.value = l.invoiceTotal();
                    r.rate = ReportTable.rate(l.rate());
                    return r;
                });
                row.sums.add(1, l.taxable(), l.cgst(), l.sgst(), l.igst(), l.cess());
            }
            case B2CS -> b2cs.computeIfAbsent(b2csKey(l.placeOfSupply(), l.rate()), k -> new TaxSums())
                    .add(1, l.taxable(), l.cgst(), l.sgst(), l.igst(), l.cess());
            case EXEMP -> exemp.get(Gstr1Classifier.exempBucket(hasGstin(l.buyerGstin()), inter))
                    .add(1, l.taxable(), l.cgst(), l.sgst(), l.igst(), l.cess());
            default -> {
            }
        }
    }

    void noteLine(NoteLine l) {
        boolean inter = Gstr1Classifier.interState(l.invoiceTaxHead(), l.invoicePlaceOfSupply(),
                l.invoiceSellerState());
        Section invoiceClass = Gstr1Classifier.invoiceClass(l.invoiceDocumentType(), l.invoiceBuyerGstin(), inter,
                l.invoiceTotal(), b2clLimit);
        Section section = Gstr1Classifier.noteLine(invoiceClass, l.buyerGstin(), l.rate());
        if (section == Section.NONE) {
            notTaxNotes.add(l.noteId());
            return;
        }
        noteDocuments.add(1, l.taxable(), l.cgst(), l.sgst(), l.igst(), l.cess());
        switch (section) {
            case CDNR, CDNUR, B2CS -> {
                Map<String, DocRate> target = section == Section.CDNR ? cdnr : section == Section.CDNUR ? cdnur
                        : b2csNotes;
                DocRate row = target.computeIfAbsent(l.noteId() + "|" + ReportTable.rate(l.rate()), k -> {
                    DocRate r = new DocRate();
                    r.documentId = l.noteId();
                    r.number = l.noteNumber();
                    r.date = l.noteDate();
                    r.gstin = l.buyerGstin();
                    r.placeOfSupply = l.placeOfSupply() != null ? l.placeOfSupply() : l.invoicePlaceOfSupply();
                    r.value = l.noteTotal();
                    r.rate = ReportTable.rate(l.rate());
                    r.originalId = l.invoiceId();
                    r.originalNumber = l.invoiceNumber();
                    r.originalDate = l.invoiceDate();
                    return r;
                });
                row.sums.add(1, l.taxable(), l.cgst(), l.sgst(), l.igst(), l.cess());
                if (section == Section.B2CS) {
                    b2cs.computeIfAbsent(b2csKey(row.placeOfSupply, l.rate()), k -> new TaxSums())
                            .add(-1, l.taxable(), l.cgst(), l.sgst(), l.igst(), l.cess());
                }
            }
            case EXEMP -> exemp.get(Gstr1Classifier.exempBucket(hasGstin(l.buyerGstin()), inter))
                    .add(-1, l.taxable(), l.cgst(), l.sgst(), l.igst(), l.cess());
            default -> {
            }
        }
    }

    /** Invoice ids whose buyer name a section prints (b2b, and the invoices of cdnr notes). */
    Set<String> receiverInvoiceIds() {
        Set<String> ids = new LinkedHashSet<>();
        b2b.values().forEach(r -> ids.add(r.documentId));
        cdnr.values().forEach(r -> ids.add(r.originalId));
        return ids;
    }

    /** Documents left out because they are not tax invoices (and notes on them). */
    int notTaxInvoiceCount() {
        return notTaxInvoices.size() + notTaxNotes.size();
    }

    /** The value sections in GSTR-1 order: b2b, b2cl, b2cs, b2cs_credit_notes, cdnr, cdnur, exemp. */
    List<ReportDtos.Section> sections(Map<String, String> receiverNames) {
        List<ReportDtos.Section> out = new ArrayList<>();
        out.add(docRateSection("b2b", "B2B", "B2B", GstColumns.B2B, b2b, r -> {
            Map<String, Object> row = ReportTable.row();
            row.put("gstin_of_recipient", r.gstin);
            row.put("receiver_name", receiverNames.get(r.documentId));
            row.put("invoice_number", r.number);
            row.put("invoice_date", str(r.date));
            row.put("invoice_value", ReportTable.money(r.value));
            row.put("place_of_supply", GstReportService.placeOfSupply(r.placeOfSupply));
            row.put("reverse_charge", "N");
            row.put("applicable_tax_rate", null);
            row.put("invoice_type", "Regular B2B");
            row.put("ecommerce_gstin", null);
            return row;
        }));
        out.add(docRateSection("b2cl", "B2C large", "B2C बड़े", GstColumns.B2CL, b2cl, r -> {
            Map<String, Object> row = ReportTable.row();
            row.put("invoice_number", r.number);
            row.put("invoice_date", str(r.date));
            row.put("invoice_value", ReportTable.money(r.value));
            row.put("place_of_supply", GstReportService.placeOfSupply(r.placeOfSupply));
            row.put("applicable_tax_rate", null);
            row.put("ecommerce_gstin", null);
            return row;
        }));
        out.add(b2csSection());
        out.add(docRateSection("b2cs_credit_notes", "Credit notes netted in B2C small", "B2C छोटे में घटाए क्रेडिट नोट",
                GstColumns.B2CS_NOTES, b2csNotes, r -> {
                    Map<String, Object> row = ReportTable.row();
                    row.put("note_number", r.number);
                    row.put("note_date", str(r.date));
                    row.put("original_invoice_number", r.originalNumber);
                    row.put("place_of_supply", GstReportService.placeOfSupply(r.placeOfSupply));
                    return row;
                }));
        out.add(docRateSection("cdnr", "Credit notes (registered)", "क्रेडिट नोट (पंजीकृत)", GstColumns.CDNR, cdnr,
                r -> {
                    Map<String, Object> row = ReportTable.row();
                    row.put("gstin_of_recipient", r.gstin);
                    row.put("receiver_name", receiverNames.get(r.originalId));
                    row.put("note_number", r.number);
                    row.put("note_date", str(r.date));
                    row.put("note_type", "C");
                    row.put("place_of_supply", GstReportService.placeOfSupply(r.placeOfSupply));
                    row.put("reverse_charge", "N");
                    row.put("note_supply_type", "Regular B2B");
                    row.put("note_value", ReportTable.money(r.value));
                    row.put("applicable_tax_rate", null);
                    row.put("original_invoice_number", r.originalNumber);
                    row.put("original_invoice_date", str(r.originalDate));
                    return row;
                }));
        out.add(docRateSection("cdnur", "Credit notes (unregistered)", "क्रेडिट नोट (अपंजीकृत)", GstColumns.CDNUR,
                cdnur, r -> {
                    Map<String, Object> row = ReportTable.row();
                    row.put("ur_type", "B2CL");
                    row.put("note_number", r.number);
                    row.put("note_date", str(r.date));
                    row.put("note_type", "C");
                    row.put("place_of_supply", GstReportService.placeOfSupply(r.placeOfSupply));
                    row.put("note_value", ReportTable.money(r.value));
                    row.put("applicable_tax_rate", null);
                    row.put("original_invoice_number", r.originalNumber);
                    row.put("original_invoice_date", str(r.originalDate));
                    return row;
                }));
        out.add(exempSection());
        return out;
    }

    /**
     * The check: per column, b2b + b2cl + b2cs (net) + exemp (net) − cdnr − cdnur against Σ live
     * tax-invoice lines − Σ their credit-note lines. {@code difference} is the sum of the absolute
     * differences; non-zero adds warning {@code GSTR1_DOES_NOT_ADD_UP}.
     */
    Map<String, Object> check() {
        TaxSums sections = new TaxSums();
        b2b.values().forEach(r -> sections.add(1, r.sums));
        b2cl.values().forEach(r -> sections.add(1, r.sums));
        b2cs.values().forEach(s -> sections.add(1, s));
        exemp.values().forEach(s -> sections.add(1, s));
        cdnr.values().forEach(r -> sections.add(-1, r.sums));
        cdnur.values().forEach(r -> sections.add(-1, r.sums));
        TaxSums documents = new TaxSums();
        documents.add(1, invoiceDocuments);
        documents.add(-1, noteDocuments);

        List<Map<String, Object>> columns = new ArrayList<>();
        BigDecimal difference = BigDecimal.ZERO;
        for (String key : CHECK_COLUMNS) {
            BigDecimal s = sections.get(key);
            BigDecimal d = documents.get(key);
            BigDecimal diff = s.subtract(d);
            difference = difference.add(diff.abs());
            Map<String, Object> column = new LinkedHashMap<>();
            column.put("key", key);
            column.put("sections", ReportTable.money(s));
            column.put("documents", ReportTable.money(d));
            column.put("difference", ReportTable.money(diff));
            columns.add(column);
        }
        Map<String, Object> check = new LinkedHashMap<>();
        check.put("rule", "b2b + b2cl + b2cs + exemp - cdnr - cdnur = invoices - credit notes");
        check.put("columns", columns);
        check.put("difference", ReportTable.money(difference));
        if (difference.signum() != 0) {
            warnings.add(ReportWarnings.GSTR1_DOES_NOT_ADD_UP,
                    "the GSTR-1 sections differ from the documents by " + ReportTable.money(difference), null);
        }
        return check;
    }

    // ------------------------------------------------------------------ sections

    private interface Head {
        Map<String, Object> cells(DocRate r);
    }

    private ReportDtos.Section docRateSection(String key, String label, String labelHi,
                                              List<ReportTable.Column> columns, Map<String, DocRate> groups,
                                              Head head) {
        List<DocRate> sorted = new ArrayList<>(groups.values());
        sorted.sort(Comparator.comparing((DocRate r) -> r.date, Comparator.nullsFirst(Comparator.naturalOrder()))
                .thenComparing(r -> r.number, Comparator.nullsFirst(Comparator.naturalOrder()))
                .thenComparing(r -> r.rate));
        List<Map<String, Object>> rows = new ArrayList<>();
        TaxSums total = new TaxSums();
        Map<String, BigDecimal> documentValues = new LinkedHashMap<>();
        for (DocRate r : sorted) {
            Map<String, Object> row = head.cells(r);
            row.put("rate", r.rate);
            r.sums.putInto(row);
            rows.add(row);
            total.add(1, r.sums);
            documentValues.putIfAbsent(r.documentId, r.value == null ? BigDecimal.ZERO : r.value);
        }
        Map<String, Object> totals = new LinkedHashMap<>();
        total.putInto(totals);
        totals.put("documents", (long) documentValues.size());
        totals.put("documents_value", ReportTable.money(documentValues.values().stream()
                .reduce(BigDecimal.ZERO, BigDecimal::add)));
        return new ReportDtos.Section(key, label, labelHi, ReportTable.dto(columns), rows, totals);
    }

    private ReportDtos.Section b2csSection() {
        List<Map<String, Object>> rows = new ArrayList<>();
        TaxSums total = new TaxSums();
        for (Map.Entry<B2csKey, TaxSums> e : b2cs.entrySet()) {
            String placeOfSupply = e.getKey().placeOfSupply();
            Map<String, Object> row = ReportTable.row();
            row.put("type", "OE");
            row.put("place_of_supply", GstReportService.placeOfSupply(placeOfSupply.isEmpty() ? null : placeOfSupply));
            row.put("applicable_tax_rate", null);
            row.put("rate", e.getKey().rate());
            row.put("ecommerce_gstin", null);
            e.getValue().putInto(row);
            rows.add(row);
            total.add(1, e.getValue());
        }
        Map<String, Object> totals = new LinkedHashMap<>();
        total.putInto(totals);
        return new ReportDtos.Section("b2cs", "B2C small", "B2C छोटे", ReportTable.dto(GstColumns.B2CS), rows,
                totals);
    }

    private ReportDtos.Section exempSection() {
        List<Map<String, Object>> rows = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO;
        boolean any = false;
        for (ExempBucket bucket : ExempBucket.values()) {
            TaxSums sums = exemp.get(bucket);
            Map<String, Object> row = ReportTable.row();
            row.put("description", bucket.description());
            row.put("nil_or_exempt", ReportTable.money(sums.taxable));
            row.put("non_gst", ReportTable.money(BigDecimal.ZERO));
            rows.add(row);
            total = total.add(sums.taxable);
            any |= !sums.isZero();
        }
        if (any) {
            warnings.add(ReportWarnings.ZERO_RATE_SPLIT_UNKNOWN,
                    "0% lines are shown in one column: the data cannot tell nil-rated from exempt; the CA splits them",
                    null);
        }
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("nil_or_exempt", ReportTable.money(total));
        totals.put("non_gst", ReportTable.money(BigDecimal.ZERO));
        return new ReportDtos.Section("exemp", "0% supplies", "0% आपूर्ति", ReportTable.dto(GstColumns.EXEMP), rows,
                totals);
    }

    private static B2csKey b2csKey(String placeOfSupply, BigDecimal rate) {
        return new B2csKey(placeOfSupply == null ? "" : placeOfSupply, ReportTable.rate(rate));
    }

    private static boolean hasGstin(String gstin) {
        return gstin != null && !gstin.isBlank();
    }

    private static String str(LocalDate date) {
        return date == null ? null : date.toString();
    }
}
