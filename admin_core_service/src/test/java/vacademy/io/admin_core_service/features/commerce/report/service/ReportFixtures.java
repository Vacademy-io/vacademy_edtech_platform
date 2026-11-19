package vacademy.io.admin_core_service.features.commerce.report.service;

import vacademy.io.admin_core_service.features.commerce.report.repository.ReportReadRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.CreditNoteRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.CreditNoteTotals;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocumentRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.InvoiceLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.Keyset;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.NoteLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SalesRegisterRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SalesRegisterTotals;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SeriesRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Fixed rows for the report unit tests and a repository that hands them out. Neutral names only;
 * GSTINs and rates are test values.
 */
final class ReportFixtures {

    static final String GSTIN_SELLER = "29AAAAA0000A1Z5";
    static final String GSTIN_BUYER = "33BBBBB1111B1Z5";
    static final String STATE_SELLER = "29";
    static final String STATE_OTHER = "33";
    static final LocalDate DAY = LocalDate.of(2026, 11, 10);

    private ReportFixtures() {
    }

    static BigDecimal d(String value) {
        return new BigDecimal(value);
    }

    static ReportQuery query() {
        return ReportQuery.builder()
                .instituteId("inst-1")
                .range(new ReportRange(LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 19)))
                .scope(new ReportScope(true, null, true, null))
                .today(LocalDate.of(2026, 11, 19))
                .build();
    }

    // ------------------------------------------------------------------ invoice lines

    /** A builder of {@link InvoiceLine}: an intra-state B2C tax invoice of the seller by default. */
    static final class Inv {
        String invoiceId = "inv-1";
        String number = "INV/2627-00001";
        LocalDate date = DAY;
        String documentType = "TAX_INVOICE";
        String channel = "POS";
        String locationId = "loc-1";
        String locationCode = "L1";
        String buyerGstin;
        String pos = STATE_SELLER;
        String sellerState = STATE_SELLER;
        String taxHead = "CGST_SGST";
        BigDecimal total = d("0");
        BigDecimal roundOff = d("0");
        String lineId = "line-1";
        String itemType = "COMMERCE_ITEM";
        String hsn = "5208";
        String unit = "MTR";
        BigDecimal rate = d("5");
        long quantity = 1;
        Integer scale = 1;
        String taxClass = "Cotton cloth";
        String description = "Cotton cloth";
        BigDecimal taxable = d("0");
        BigDecimal cgst = d("0");
        BigDecimal sgst = d("0");
        BigDecimal igst = d("0");
        BigDecimal cess = d("0");

        Inv id(String id, String number) {
            this.invoiceId = id;
            this.number = number;
            return this;
        }

        Inv line(String lineId) {
            this.lineId = lineId;
            return this;
        }

        Inv b2b(String gstin) {
            this.buyerGstin = gstin;
            return this;
        }

        Inv inter(String pos) {
            this.pos = pos;
            this.taxHead = "IGST";
            return this;
        }

        Inv type(String documentType) {
            this.documentType = documentType;
            return this;
        }

        Inv total(String total, String roundOff) {
            this.total = d(total);
            this.roundOff = d(roundOff);
            return this;
        }

        Inv hsn(String hsn, String unit, String rate) {
            this.hsn = hsn;
            this.unit = unit;
            this.rate = d(rate);
            return this;
        }

        Inv qty(long base, Integer scale) {
            this.quantity = base;
            this.scale = scale;
            return this;
        }

        Inv service(String itemType, String description) {
            this.itemType = itemType;
            this.description = description;
            this.taxClass = null;
            this.unit = null;
            this.scale = null;
            return this;
        }

        /** Taxable value and tax at the line's rate, split by the tax head. */
        Inv value(String taxableValue, String tax) {
            this.taxable = d(taxableValue);
            BigDecimal t = d(tax);
            if ("IGST".equals(taxHead)) {
                this.igst = t;
                this.cgst = d("0");
                this.sgst = d("0");
            } else {
                BigDecimal half = t.divide(d("2"));
                this.cgst = half;
                this.sgst = half;
                this.igst = d("0");
            }
            return this;
        }

        InvoiceLine build() {
            BigDecimal amount = taxable.add(cgst).add(sgst).add(igst).add(cess);
            return new InvoiceLine(invoiceId, number, date, documentType, channel, locationId, locationCode,
                    buyerGstin, pos, GSTIN_SELLER, sellerState, taxHead, total, roundOff, lineId, itemType, hsn, unit,
                    rate, quantity, scale, taxClass, description, taxable, cgst, sgst, igst, cess, amount);
        }
    }

    static Inv inv() {
        return new Inv();
    }

    /** A credit-note line on the invoice of {@code invoice} (same buyer, place, tax head and line kind). */
    static NoteLine note(String noteId, String noteNumber, InvoiceLine invoice, String noteTotal, String noteRoundOff,
                         long quantity, String taxable, String tax) {
        BigDecimal t = d(tax);
        BigDecimal cgst = "IGST".equals(invoice.taxHead()) ? d("0") : t.divide(d("2"));
        BigDecimal igst = "IGST".equals(invoice.taxHead()) ? t : d("0");
        BigDecimal amount = d(taxable).add(t);
        return new NoteLine(noteId, noteNumber, DAY, d(noteTotal), d(noteRoundOff), invoice.buyerGstin(),
                invoice.placeOfSupply(), invoice.sellerGstin(), invoice.invoiceId(), invoice.invoiceNumber(),
                invoice.documentDate(), invoice.documentType(), invoice.invoiceTotal(), invoice.buyerGstin(),
                invoice.taxHead(), invoice.sellerState(), invoice.placeOfSupply(), invoice.channel(),
                invoice.locationId(), invoice.locationCode(), noteId + "-line", invoice.itemType(), invoice.hsn(),
                invoice.unit(), invoice.rate(), quantity, d("12.34"), invoice.qtyScale(), invoice.taxClassName(),
                invoice.description(), d(taxable), cgst, cgst, igst, d("0"), amount);
    }

    // ------------------------------------------------------------------ repository

    /** A repository that hands out fixed rows; everything else answers empty. */
    static final class FakeRepository extends ReportReadRepository {
        final List<InvoiceLine> invoiceLines = new ArrayList<>();
        final List<NoteLine> noteLines = new ArrayList<>();
        final List<SalesRegisterRow> salesRows = new ArrayList<>();
        SalesRegisterTotals salesTotals = new SalesRegisterTotals(d("0"), d("0"), d("0"), d("0"), d("0"), d("0"),
                d("0"), 0, 0, d("0"));
        final List<CreditNoteRow> noteRows = new ArrayList<>();
        CreditNoteTotals noteTotals = new CreditNoteTotals(d("0"), d("0"), d("0"), d("0"), d("0"), d("0"), d("0"),
                d("0"), 0);
        final List<DocumentRow> inRange = new ArrayList<>();
        final List<DocumentRow> allTime = new ArrayList<>();
        final List<SeriesRow> series = new ArrayList<>();
        final Map<String, String> snapshots = new HashMap<>();
        final List<String> gstins = new ArrayList<>();
        final List<DocFilter> filters = new ArrayList<>();

        FakeRepository() {
            super(new org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate(
                    new org.springframework.jdbc.core.JdbcTemplate(
                            org.mockito.Mockito.mock(javax.sql.DataSource.class))));
        }

        @Override
        public List<String> activeLocationIds(String instituteId) {
            return List.of("loc-1", "loc-2");
        }

        @Override
        public List<String> sellerGstins(DocFilter f) {
            filters.add(f);
            return gstins;
        }

        @Override
        public void salesRegister(DocFilter f, Keyset after, Integer invoiceLimit, Consumer<SalesRegisterRow> sink) {
            filters.add(f);
            salesRows.forEach(sink);
        }

        @Override
        public SalesRegisterTotals salesRegisterTotals(DocFilter f) {
            return salesTotals;
        }

        @Override
        public void creditNotes(DocFilter f, Keyset after, Integer noteLimit, Consumer<CreditNoteRow> sink) {
            filters.add(f);
            noteRows.forEach(sink);
        }

        @Override
        public CreditNoteTotals creditNoteTotals(DocFilter f) {
            return noteTotals;
        }

        @Override
        public void invoiceLines(DocFilter f, Consumer<InvoiceLine> sink) {
            filters.add(f);
            invoiceLines.forEach(sink);
        }

        @Override
        public void noteLines(DocFilter f, Consumer<NoteLine> sink) {
            noteLines.forEach(sink);
        }

        @Override
        public Map<String, String> snapshots(String instituteId, Collection<String> invoiceIds) {
            Map<String, String> out = new HashMap<>();
            for (String id : invoiceIds) {
                if (snapshots.containsKey(id)) {
                    out.put(id, snapshots.get(id));
                }
            }
            return out;
        }

        @Override
        public void documentsInRange(DocFilter f, Consumer<DocumentRow> sink) {
            inRange.forEach(sink);
        }

        @Override
        public List<SeriesRow> series(String instituteId, Collection<String> seriesIds) {
            return series.stream().filter(s -> seriesIds.contains(s.id())).toList();
        }

        @Override
        public void seriesDocuments(String instituteId, Collection<String> seriesIds, Consumer<DocumentRow> sink) {
            allTime.stream().filter(d -> seriesIds.contains(d.seriesId())).forEach(sink);
        }
    }

    static ReportRows.SeriesRow systemSeries(String id, String documentType, String prefix, long nextValue) {
        return new SeriesRow(id, GSTIN_SELLER, "loc-1", "L1", null, null, "ALL", documentType, "SYSTEM", prefix,
                "2026-27", nextValue, null, null);
    }

    static ReportRows.SeriesRow book(String id, long from, long to) {
        return new SeriesRow(id, GSTIN_SELLER, "loc-2", "L2", null, null, "ALL", "TAX_INVOICE", "MANUAL_BOOK", "BK/",
                "2026-27", 1, from, to);
    }
}
