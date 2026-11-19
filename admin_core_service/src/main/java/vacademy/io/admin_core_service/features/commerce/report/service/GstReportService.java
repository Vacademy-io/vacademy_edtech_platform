package vacademy.io.admin_core_service.features.commerce.report.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.common.CommerceUnits;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportCsvWriter;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportExports;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportXlsxWriter;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportReadRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.CreditNoteRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.CreditNoteTotals;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SalesRegisterRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SalesRegisterTotals;
import vacademy.io.admin_core_service.features.platform_billing.service.IndianStates;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The GST pack (contract sections 2.1 to 2.6 and 2.14): sales register, credit notes, tax by rate,
 * HSN summary, GSTR-1, documents issued and the month workbook. Every figure comes from the
 * stored documents ({@code invoice}, {@code invoice_line_item}, {@code commerce_credit_note(_line)}),
 * never from live settings. Runs inside {@link ReportRunner}'s read-only transaction.
 *
 * <p>GST reports work on one seller GSTIN: when the range holds documents of more than one and
 * none was named, 400 {@code GSTIN_REQUIRED} lists them. Tax by rate, HSN and GSTR-1 count tax
 * invoices only (bills of supply and plain invoices: warning {@code NOT_A_TAX_INVOICE}); the two
 * registers list every commerce document.
 */
@Service
public class GstReportService {

    public static final String SALES_REGISTER = "sales-register";
    public static final String CREDIT_NOTES = "credit-notes";
    public static final String TAX_BY_RATE = "tax-by-rate";
    public static final String HSN_SUMMARY = "hsn-summary";
    public static final String GSTR1 = "gstr1";
    public static final String DOCUMENTS_ISSUED = "documents-issued";
    public static final String GST_PACK = "gst-pack";

    /** The GST pack's sheets, in order. */
    public static final List<String> PACK_SHEETS = List.of("b2b", "b2cl", "b2cs", "cdnr", "cdnur", "exemp",
            "hsn(b2b)", "hsn(b2c)", "docs", "sales register", "credit notes", "tax by rate");

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final ObjectMapper JSON = new ObjectMapper();

    private final ReportReadRepository readRepository;
    private final DocumentsIssuedService documentsIssuedService;

    public GstReportService(ReportReadRepository readRepository, DocumentsIssuedService documentsIssuedService) {
        this.readRepository = readRepository;
        this.documentsIssuedService = documentsIssuedService;
    }

    // ================================================================== GSTIN and filters

    /**
     * The seller GSTIN the GST reports filter on: the one named; else the only GSTIN of the range;
     * else 400 {@code GSTIN_REQUIRED}. Null only when the range holds no document with a GSTIN.
     * Documents without a seller GSTIN (issued while unregistered) are never mixed into a GSTIN's
     * report: they are counted in warning {@code NO_GSTIN} instead.
     */
    public String resolveGstin(ReportQuery q) {
        if (q.sellerGstin() != null) {
            return q.sellerGstin();
        }
        List<String> gstins = readRepository.sellerGstins(filter(q, null, null));
        if (gstins.size() > 1) {
            throw new InvalidRequestException("GSTIN_REQUIRED: the dates hold documents of more than one GSTIN ("
                    + String.join(", ", gstins) + "); pick one");
        }
        return gstins.isEmpty() ? null : gstins.get(0);
    }

    /** Warning {@code NO_GSTIN} when the report is cut to a GSTIN and documents without one are in the range. */
    private void warnNoGstin(ReportQuery q, String gstin, ReportWarnings warnings) {
        if (gstin == null) {
            return;
        }
        long without = readRepository.documentsWithoutGstin(filter(q, null, null));
        if (without > 0) {
            warnings.add(ReportWarnings.NO_GSTIN, without + " invoices or credit notes of these dates have no seller "
                    + "GSTIN (issued while unregistered); they are not in this report", null);
        }
    }

    static DocFilter filter(ReportQuery q, String gstin, String status) {
        return new DocFilter(q.instituteId(), q.range().from(), q.range().to(), gstin,
                q.scope() == null ? null : q.scope().locationIn(), q.channel(), status);
    }

    private ReportAnswer answer(ReportQuery q, String report, String gstin) {
        ReportAnswer a = new ReportAnswer();
        a.setReport(report);
        a.setFrom(q.range().from().toString());
        a.setTo(q.range().to().toString());
        Map<String, Object> filters = q.filters();
        if (gstin != null) {
            filters.put("seller_gstin", gstin);
        }
        a.setFilters(filters);
        a.setAsOf(ZonedDateTime.now(INDIA).truncatedTo(ChronoUnit.SECONDS).toOffsetDateTime().toString());
        return a;
    }

    // ================================================================== sales register

    /** One page of the sales register (contract 2.1), with totals over the whole filter. */
    public ReportAnswer salesRegister(ReportQuery q) {
        String gstin = resolveGstin(q);
        DocFilter f = filter(q, gstin, q.status());
        int size = q.pageSize();
        List<SalesRegisterRow> fetched = new ArrayList<>();
        readRepository.salesRegister(f, ReportCursor.decode(q.cursor()), size + 1, fetched::add);
        Set<String> invoices = new LinkedHashSet<>();
        List<SalesRegisterRow> page = new ArrayList<>();
        SalesRegisterRow last = null;
        boolean more = false;
        for (SalesRegisterRow row : fetched) {
            invoices.add(row.invoiceId());
            if (invoices.size() > size) {
                more = true;
                break;
            }
            page.add(row);
            last = row;
        }
        ReportWarnings warnings = new ReportWarnings();
        warnNoGstin(q, gstin, warnings);
        ReportAnswer a = answer(q, SALES_REGISTER, gstin);
        a.setColumns(GstColumns.SALES_REGISTER.dto());
        SalesRows assembler = new SalesRows(warnings);
        for (SalesRegisterRow row : page) {
            a.getRows().add(assembler.row(row));
        }
        a.setNextCursor(more && last != null
                ? ReportCursor.encode(last.documentDate(), last.invoiceNumber(), last.invoiceId()) : null);
        SalesRegisterTotals totals = readRepository.salesRegisterTotals(f);
        a.setTotals(salesTotals(totals));
        a.setCheck(salesCheck(totals, warnings));
        a.setWarnings(warnings.list());
        return a;
    }

    /** The whole sales register as CSV or Excel, streamed; returns the rows written. */
    public int exportSalesRegister(ReportQuery q, String format, OutputStream out, int maxRows) throws IOException {
        String gstin = resolveGstin(q);
        DocFilter f = filter(q, gstin, q.status());
        if ("csv".equals(format)) {
            try (ReportCsvWriter writer = ReportCsvWriter.of(out, GstColumns.SALES_REGISTER.columns(), maxRows)) {
                SalesRows assembler = new SalesRows(new ReportWarnings());
                readRepository.salesRegister(f, null, null, row -> writer.row(assembler.row(row)));
                return writer.rows();
            }
        }
        try (ReportXlsxWriter writer = new ReportXlsxWriter(q.hindi(), maxRows)) {
            writeSalesRegisterSheet(writer, "sales register", f);
            writer.write(out);
            return writer.rows();
        }
    }

    private void writeSalesRegisterSheet(ReportXlsxWriter writer, String sheet, DocFilter f) {
        writer.sheet(sheet);
        writer.block(null, GstColumns.SALES_REGISTER.columns());
        SalesRows assembler = new SalesRows(new ReportWarnings());
        readRepository.salesRegister(f, null, null, row -> writer.row(assembler.row(row)));
        writer.totals(salesTotals(readRepository.salesRegisterTotals(f)));
    }

    /**
     * Sales register rows from the groups: invoice number, date, round-off, total, payment mode
     * and status on the first row of an invoice only; the other invoice cells on every row.
     * A cancelled invoice keeps its number, date and status, but its money cells are empty: its
     * total is in {@code cancelled_value} (first row), so the sum of any money column of the file
     * equals the register's totals (live invoices only).
     */
    static final class SalesRows {
        private final ReportWarnings warnings;
        private String invoiceId;
        private String customer;

        SalesRows(ReportWarnings warnings) {
            this.warnings = warnings;
        }

        Map<String, Object> row(SalesRegisterRow r) {
            boolean first = !r.invoiceId().equals(invoiceId);
            if (first) {
                invoiceId = r.invoiceId();
                customer = buyerName(r.snapshotJson());
                if (r.cancelled() && r.cancelledOn() != null && r.documentDate() != null
                        && YearMonth.from(r.cancelledOn()).isAfter(YearMonth.from(r.documentDate()))) {
                    warnings.add(ReportWarnings.CANCELLED_AFTER_MONTH,
                            "cancelled on " + r.cancelledOn() + ", after the month of the invoice", r.invoiceNumber());
                }
            }
            Map<String, Object> row = ReportTable.row();
            row.put("invoice_number", first ? r.invoiceNumber() : null);
            row.put("paper_bill_number", r.paperNumber());
            row.put("date", first && r.documentDate() != null ? r.documentDate().toString() : null);
            row.put("document_type", r.documentType());
            row.put("channel", r.channel());
            row.put("location", r.locationCode());
            row.put("order_number", r.orderNumber());
            row.put("customer", customer);
            row.put("buyer_gstin", r.buyerGstin());
            row.put("place_of_supply", placeOfSupply(r.placeOfSupply()));
            row.put("hsn", r.hsn());
            row.put("rate", ReportTable.rate(r.rate()));
            boolean live = !r.cancelled();
            row.put("taxable_value", live ? ReportTable.money(r.taxable()) : null);
            row.put("cgst", live ? ReportTable.money(r.cgst()) : null);
            row.put("sgst", live ? ReportTable.money(r.sgst()) : null);
            row.put("igst", live ? ReportTable.money(r.igst()) : null);
            row.put("cess", live ? ReportTable.money(r.cess()) : null);
            row.put("round_off", first && live ? ReportTable.money(r.roundOff()) : null);
            row.put("invoice_total", first && live ? ReportTable.money(r.invoiceTotal()) : null);
            row.put("cancelled_value", first && !live ? ReportTable.money(r.invoiceTotal()) : null);
            row.put("payment_mode", first ? r.paymentModes() : null);
            row.put("status", first ? (live ? "ACTIVE" : "CANCELLED") : null);
            row.put("seller_gstin", r.sellerGstin());
            return row;
        }
    }

    private static Map<String, Object> salesTotals(SalesRegisterTotals t) {
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("taxable_value", ReportTable.money(t.taxable()));
        totals.put("cgst", ReportTable.money(t.cgst()));
        totals.put("sgst", ReportTable.money(t.sgst()));
        totals.put("igst", ReportTable.money(t.igst()));
        totals.put("cess", ReportTable.money(t.cess()));
        totals.put("round_off", ReportTable.money(t.roundOff()));
        totals.put("invoice_total", ReportTable.money(t.invoiceTotal()));
        totals.put("invoices", t.invoices());
        totals.put("cancelled_invoices", t.cancelledInvoices());
        totals.put("cancelled_total", ReportTable.money(t.cancelledTotal()));
        totals.put("cancelled_value", ReportTable.money(t.cancelledTotal()));
        return totals;
    }

    private static Map<String, Object> salesCheck(SalesRegisterTotals t, ReportWarnings warnings) {
        BigDecimal tax = t.cgst().add(t.sgst()).add(t.igst()).add(t.cess());
        BigDecimal difference = t.taxable().add(tax).add(t.roundOff()).subtract(t.invoiceTotal());
        Map<String, Object> check = new LinkedHashMap<>();
        check.put("rule", "taxable value + tax + round-off = invoice totals (live invoices)");
        check.put("taxable_value", ReportTable.money(t.taxable()));
        check.put("tax", ReportTable.money(tax));
        check.put("round_off", ReportTable.money(t.roundOff()));
        check.put("invoice_total", ReportTable.money(t.invoiceTotal()));
        check.put("difference", ReportTable.money(difference));
        if (difference.signum() != 0) {
            warnings.add(ReportWarnings.REGISTER_DOES_NOT_ADD_UP,
                    "the register differs from the invoice totals by " + ReportTable.money(difference), null);
        }
        return check;
    }

    // ================================================================== credit notes

    /** One page of the credit-note register (contract 2.2), with totals over the whole filter. */
    public ReportAnswer creditNotes(ReportQuery q) {
        String gstin = resolveGstin(q);
        DocFilter f = filter(q, gstin, null);
        int size = q.pageSize();
        List<CreditNoteRow> fetched = new ArrayList<>();
        readRepository.creditNotes(f, ReportCursor.decode(q.cursor()), size + 1, fetched::add);
        Set<String> notes = new LinkedHashSet<>();
        List<CreditNoteRow> page = new ArrayList<>();
        CreditNoteRow last = null;
        boolean more = false;
        for (CreditNoteRow row : fetched) {
            notes.add(row.noteId());
            if (notes.size() > size) {
                more = true;
                break;
            }
            page.add(row);
            last = row;
        }
        ReportWarnings warnings = new ReportWarnings();
        warnNoGstin(q, gstin, warnings);
        ReportAnswer a = answer(q, CREDIT_NOTES, gstin);
        a.setColumns(GstColumns.CREDIT_NOTES.dto());
        NoteRows assembler = new NoteRows(warnings);
        for (CreditNoteRow row : page) {
            a.getRows().add(assembler.row(row));
        }
        a.setNextCursor(more && last != null
                ? ReportCursor.encode(last.noteDate(), last.noteNumber(), last.noteId()) : null);
        CreditNoteTotals totals = readRepository.creditNoteTotals(f);
        a.setTotals(noteTotals(totals));
        a.setCheck(noteCheck(totals, warnings));
        a.setWarnings(warnings.list());
        return a;
    }

    /** The whole credit-note register as CSV or Excel, streamed. */
    public int exportCreditNotes(ReportQuery q, String format, OutputStream out, int maxRows) throws IOException {
        String gstin = resolveGstin(q);
        DocFilter f = filter(q, gstin, null);
        if ("csv".equals(format)) {
            try (ReportCsvWriter writer = ReportCsvWriter.of(out, GstColumns.CREDIT_NOTES.columns(), maxRows)) {
                NoteRows assembler = new NoteRows(new ReportWarnings());
                readRepository.creditNotes(f, null, null, row -> writer.row(assembler.row(row)));
                return writer.rows();
            }
        }
        try (ReportXlsxWriter writer = new ReportXlsxWriter(q.hindi(), maxRows)) {
            writeCreditNotesSheet(writer, "credit notes", f);
            writer.write(out);
            return writer.rows();
        }
    }

    private void writeCreditNotesSheet(ReportXlsxWriter writer, String sheet, DocFilter f) {
        writer.sheet(sheet);
        writer.block(null, GstColumns.CREDIT_NOTES.columns());
        NoteRows assembler = new NoteRows(new ReportWarnings());
        readRepository.creditNotes(f, null, null, row -> writer.row(assembler.row(row)));
        writer.totals(noteTotals(readRepository.creditNoteTotals(f)));
    }

    /** Credit-note rows: number, date, round-off and note total on the note's first row only. */
    static final class NoteRows {
        private final ReportWarnings warnings;
        private String noteId;

        NoteRows(ReportWarnings warnings) {
            this.warnings = warnings;
        }

        Map<String, Object> row(CreditNoteRow r) {
            boolean first = !r.noteId().equals(noteId);
            noteId = r.noteId();
            int scale = 1;
            if (r.qtyScale() != null) {
                scale = Math.max(r.qtyScale(), 1);
            } else if (!r.service()) {
                warnings.add(ReportWarnings.SCALE_UNKNOWN, "the line's quantity scale is unknown; counted as 1",
                        r.noteNumber());
            }
            Map<String, Object> row = ReportTable.row();
            row.put("note_number", first ? r.noteNumber() : null);
            row.put("note_date", first && r.noteDate() != null ? r.noteDate().toString() : null);
            row.put("invoice_number", r.invoiceNumber());
            row.put("invoice_date", r.invoiceDate() == null ? null : r.invoiceDate().toString());
            row.put("return_number", r.returnNumber());
            row.put("buyer_gstin", r.buyerGstin());
            row.put("place_of_supply", placeOfSupply(r.placeOfSupply()));
            row.put("hsn", r.hsn());
            row.put("rate", ReportTable.rate(r.rate()));
            row.put("quantity", BigDecimal.valueOf(r.quantity()).divide(BigDecimal.valueOf(scale), MathContext.DECIMAL64));
            row.put("unit", r.unit());
            row.put("quantity_text", CommerceUnits.quantity(r.quantity(), scale, r.unit()));
            BigDecimal perUnit = CommerceUnits.perUnit(r.unitPrice(), scale);
            row.put("rate_per_unit", perUnit);
            row.put("rate_text", perUnit == null ? null
                    : "₹" + perUnit.toPlainString() + CommerceUnits.rateSuffix(scale, r.unit()));
            row.put("taxable_value", ReportTable.money(r.taxable()));
            row.put("cgst", ReportTable.money(r.cgst()));
            row.put("sgst", ReportTable.money(r.sgst()));
            row.put("igst", ReportTable.money(r.igst()));
            row.put("cess", ReportTable.money(r.cess()));
            row.put("amount", ReportTable.money(r.amount()));
            row.put("round_off", first ? ReportTable.money(r.roundOff()) : null);
            row.put("note_total", first ? ReportTable.money(r.noteTotal()) : null);
            row.put("reason", r.reason());
            row.put("channel", r.channel());
            row.put("location", r.locationCode());
            row.put("seller_gstin", r.sellerGstin());
            return row;
        }
    }

    private static Map<String, Object> noteTotals(CreditNoteTotals t) {
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("taxable_value", ReportTable.money(t.taxable()));
        totals.put("cgst", ReportTable.money(t.cgst()));
        totals.put("sgst", ReportTable.money(t.sgst()));
        totals.put("igst", ReportTable.money(t.igst()));
        totals.put("cess", ReportTable.money(t.cess()));
        totals.put("amount", ReportTable.money(t.amount()));
        totals.put("round_off", ReportTable.money(t.roundOff()));
        totals.put("note_total", ReportTable.money(t.noteTotal()));
        totals.put("notes", t.notes());
        return totals;
    }

    private static Map<String, Object> noteCheck(CreditNoteTotals t, ReportWarnings warnings) {
        BigDecimal difference = t.amount().add(t.roundOff()).subtract(t.noteTotal());
        Map<String, Object> check = new LinkedHashMap<>();
        check.put("rule", "line amounts + round-off = note totals");
        check.put("amount", ReportTable.money(t.amount()));
        check.put("round_off", ReportTable.money(t.roundOff()));
        check.put("note_total", ReportTable.money(t.noteTotal()));
        check.put("difference", ReportTable.money(difference));
        if (difference.signum() != 0) {
            warnings.add(ReportWarnings.REGISTER_DOES_NOT_ADD_UP,
                    "the note lines differ from the note totals by " + ReportTable.money(difference), null);
        }
        return check;
    }

    // ================================================================== summaries

    /** Tax by rate, HSN and GSTR-1 from one pass over the lines of the range. */
    private final class Summary {
        final ReportWarnings warnings = new ReportWarnings();
        final TaxByRateBuilder taxByRate = new TaxByRateBuilder();
        final HsnSummaryBuilder hsn = new HsnSummaryBuilder(warnings);
        final Gstr1Builder gstr1;
        final DocFilter filter;

        Summary(ReportQuery q, String gstin) {
            this.filter = filter(q, gstin, null);
            warnNoGstin(q, gstin, warnings);
            this.gstr1 = new Gstr1Builder(q.b2clLimitOrDefault(), warnings);
            readRepository.invoiceLines(filter, line -> {
                gstr1.invoiceLine(line);
                if (Gstr1Classifier.TAX_INVOICE.equals(line.documentType())) {
                    taxByRate.invoiceLine(line);
                    hsn.invoiceLine(line);
                }
            });
            readRepository.noteLines(filter, line -> {
                gstr1.noteLine(line);
                if (Gstr1Classifier.TAX_INVOICE.equals(line.invoiceDocumentType())) {
                    taxByRate.noteLine(line);
                    hsn.noteLine(line);
                }
            });
            int left = gstr1.notTaxInvoiceCount();
            if (left > 0) {
                warnings.add(ReportWarnings.NOT_A_TAX_INVOICE, left + " documents are bills of supply or plain"
                        + " invoices (or credit notes on them); they are left out of GSTR-1, HSN and tax by rate", null);
            }
        }

        ReportDtos.Section hsnB2b() {
            return hsn.b2b("hsn_b2b", "HSN B2B", "HSN B2B");
        }

        ReportDtos.Section hsnB2c() {
            return hsn.b2c("hsn_b2c", "HSN B2C", "HSN B2C");
        }
    }

    /** Tax by rate (contract 2.3): invoices, credit notes and net blocks. */
    public ReportAnswer taxByRate(ReportQuery q) {
        String gstin = resolveGstin(q);
        return taxByRate(q, gstin, new Summary(q, gstin));
    }

    private ReportAnswer taxByRate(ReportQuery q, String gstin, Summary s) {
        ReportAnswer a = answer(q, TAX_BY_RATE, gstin);
        a.setSections(s.taxByRate.sections());
        Map<String, Object> totals = new LinkedHashMap<>();
        TaxSums net = s.taxByRate.netTotal();
        net.putInto(totals);
        totals.put("total_tax", ReportTable.money(net.tax()));
        a.setTotals(totals);
        a.setWarnings(s.warnings.list());
        return a;
    }

    /** HSN summary (contract 2.4): B2B and B2C tables and the round-off line. */
    public ReportAnswer hsnSummary(ReportQuery q) {
        String gstin = resolveGstin(q);
        Summary s = new Summary(q, gstin);
        ReportAnswer a = answer(q, HSN_SUMMARY, gstin);
        a.getSections().add(s.hsnB2b());
        a.getSections().add(s.hsnB2c());
        Map<String, Object> roundOffRow = ReportTable.row();
        roundOffRow.put("description", "Round-off (not part of HSN values)");
        roundOffRow.put("total_value", ReportTable.money(s.hsn.roundOff()));
        Map<String, Object> roundOffTotals = new LinkedHashMap<>();
        roundOffTotals.put("total_value", ReportTable.money(s.hsn.roundOff()));
        a.getSections().add(new ReportDtos.Section("round_off", "Round-off", "राउंड-ऑफ़",
                ReportTable.dto(GstColumns.HSN_ROUND_OFF), new ArrayList<>(List.of(roundOffRow)), roundOffTotals));

        TaxSums sums = s.hsn.sums();
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("total_value", ReportTable.money(s.hsn.totalValue()));
        sums.putInto(totals);
        totals.put("round_off", ReportTable.money(s.hsn.roundOff()));
        totals.put("documents_total", ReportTable.money(s.hsn.documentsTotal()));
        a.setTotals(totals);

        BigDecimal difference = s.hsn.totalValue().add(s.hsn.roundOff()).subtract(s.hsn.documentsTotal());
        Map<String, Object> check = new LinkedHashMap<>();
        check.put("rule", "total value + round-off = invoice totals - credit note totals");
        check.put("total_value", ReportTable.money(s.hsn.totalValue()));
        check.put("round_off", ReportTable.money(s.hsn.roundOff()));
        check.put("documents_total", ReportTable.money(s.hsn.documentsTotal()));
        check.put("difference", ReportTable.money(difference));
        if (difference.signum() != 0) {
            s.warnings.add(ReportWarnings.HSN_DOES_NOT_ADD_UP,
                    "the HSN values differ from the document totals by " + ReportTable.money(difference), null);
        }
        a.setCheck(check);
        a.setWarnings(s.warnings.list());
        return a;
    }

    /** GSTR-1 (contract 2.5): every section for one GSTIN and range, and the check block. */
    public ReportAnswer gstr1(ReportQuery q) {
        String gstin = resolveGstin(q);
        return gstr1(q, gstin, new Summary(q, gstin));
    }

    private ReportAnswer gstr1(ReportQuery q, String gstin, Summary s) {
        ReportAnswer a = answer(q, GSTR1, gstin);
        a.getFilters().put("b2cl_limit", q.b2clLimitOrDefault().toPlainString());
        Map<String, String> names = receiverNames(q.instituteId(), s.gstr1.receiverInvoiceIds());
        a.getSections().addAll(s.gstr1.sections(names));
        a.getSections().add(s.hsnB2b());
        a.getSections().add(s.hsnB2c());
        DocumentsIssuedService.Blocks docs = documentsIssuedService.blocks(s.filter, s.warnings);
        a.getSections().add(docs.system("docs", "Documents", "दस्तावेज़"));
        a.getSections().add(docs.books("docs_bill_books", "Paper bill books", "काग़ज़ी बिल बुक"));
        a.setCheck(s.gstr1.check(Gstr1Builder.documents(readRepository.taxInvoiceDocumentSums(s.filter))));
        a.setWarnings(s.warnings.list());
        return a;
    }

    /** Documents issued (contract 2.6): system numbers and paper bill books. */
    public ReportAnswer documentsIssued(ReportQuery q) {
        String gstin = resolveGstin(q);
        ReportWarnings warnings = new ReportWarnings();
        warnNoGstin(q, gstin, warnings);
        DocumentsIssuedService.Blocks docs = documentsIssuedService.blocks(filter(q, gstin, null), warnings);
        ReportAnswer a = answer(q, DOCUMENTS_ISSUED, gstin);
        a.getSections().add(docs.system("system", "System numbers", "सिस्टम नंबर"));
        a.getSections().add(docs.books("bill_books", "Paper bill books", "काग़ज़ी बिल बुक"));
        a.setWarnings(warnings.list());
        return a;
    }

    /** A summary answer as CSV or Excel. */
    public int exportAnswer(ReportAnswer answer, String format, boolean hindi, OutputStream out, int maxRows)
            throws IOException {
        return "csv".equals(format) ? ReportExports.csv(answer, out, maxRows)
                : ReportExports.xlsx(answer, hindi, out, maxRows);
    }

    // ================================================================== GST pack

    /**
     * The month workbook for the CA (contract 2.14): the GSTR-1 sheets, then the sales register,
     * the credit notes and tax by rate. Sheet order: {@link #PACK_SHEETS}.
     */
    public int gstPack(ReportQuery q, OutputStream out, int maxRows) throws IOException {
        String gstin = resolveGstin(q);
        ReportQuery named = q.toBuilder().sellerGstin(gstin).build();
        // One pass over the lines of the month serves GSTR-1 and tax by rate.
        Summary summary = new Summary(named, gstin);
        ReportAnswer gstr1 = gstr1(named, gstin, summary);
        ReportAnswer taxByRate = taxByRate(named, gstin, summary);
        Map<String, ReportDtos.Section> sections = new HashMap<>();
        for (ReportDtos.Section section : gstr1.getSections()) {
            sections.put(section.getKey(), section);
        }
        DocFilter f = filter(named, gstin, null);
        try (ReportXlsxWriter writer = new ReportXlsxWriter(q.hindi(), maxRows)) {
            sheet(writer, "b2b", sections.get("b2b"));
            sheet(writer, "b2cl", sections.get("b2cl"));
            sheet(writer, "b2cs", sections.get("b2cs"));
            ReportExports.addSection(writer, q.hindi() ? "B2C छोटे में घटाए क्रेडिट नोट" : "Credit notes netted here",
                    sections.get("b2cs_credit_notes"));
            sheet(writer, "cdnr", sections.get("cdnr"));
            sheet(writer, "cdnur", sections.get("cdnur"));
            sheet(writer, "exemp", sections.get("exemp"));
            sheet(writer, "hsn(b2b)", sections.get("hsn_b2b"));
            sheet(writer, "hsn(b2c)", sections.get("hsn_b2c"));
            sheet(writer, "docs", sections.get("docs"));
            ReportExports.addSection(writer, q.hindi() ? "काग़ज़ी बिल बुक" : "Paper bill books",
                    sections.get("docs_bill_books"));
            writeSalesRegisterSheet(writer, "sales register", f);
            writeCreditNotesSheet(writer, "credit notes", f);
            writer.sheet("tax by rate");
            for (ReportDtos.Section section : taxByRate.getSections()) {
                ReportExports.addSection(writer, q.hindi() ? section.getLabelHi() : section.getLabel(), section);
            }
            writer.write(out);
            return writer.rows();
        } catch (UncheckedIOException e) {
            throw e.getCause();
        }
    }

    private static void sheet(ReportXlsxWriter writer, String name, ReportDtos.Section section) {
        writer.sheet(name);
        ReportExports.addSection(writer, null, section);
    }

    // ================================================================== text helpers

    /** The state code and its name ("<code>-<state>"); the bare code when the name is unknown. */
    public static String placeOfSupply(String stateCode) {
        if (stateCode == null || stateCode.isBlank()) {
            return null;
        }
        String name = IndianStates.nameFor(stateCode.trim());
        return name == null ? stateCode.trim() : stateCode.trim() + "-" + name;
    }

    /** The buyer name of an invoice snapshot (parsed here, never in SQL); null when absent. */
    static String buyerName(String snapshotJson) {
        if (snapshotJson == null || snapshotJson.isBlank()) {
            return null;
        }
        try {
            JsonNode name = JSON.readTree(snapshotJson).path("buyer_name");
            return name.isTextual() ? name.asText() : null;
        } catch (IOException e) {
            return null;
        }
    }

    private Map<String, String> receiverNames(String instituteId, Set<String> invoiceIds) {
        Map<String, String> names = new HashMap<>();
        if (invoiceIds.isEmpty()) {
            return names;
        }
        readRepository.snapshots(instituteId, invoiceIds).forEach((id, json) -> names.put(id, buyerName(json)));
        return names;
    }

    /** Lower-case format name: json, csv or xlsx; 400 {@code VALIDATION} otherwise. */
    public static String format(String format) {
        String value = format == null || format.isBlank() ? "json" : format.trim().toLowerCase(Locale.ROOT);
        if (!value.equals("json") && !value.equals("csv") && !value.equals("xlsx")) {
            throw new InvalidRequestException("VALIDATION: format must be json, csv or xlsx");
        }
        return value;
    }
}
