package vacademy.io.admin_core_service.features.commerce.report.service;

import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentNumberAllocator;
import vacademy.io.admin_core_service.features.commerce.document.service.FinancialYear;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportReadRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocumentRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SeriesRow;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Documents issued (GSTR-1 table 13; contract section 2.6).
 *
 * <ul>
 *   <li><b>System numbers:</b> one row per series row (one financial year) with a document in the
 *       range: from and to number, total, cancelled, net. Each listed series is checked for gaps
 *       over all time: {@code next_value − 1} must equal the documents of the series in
 *       {@code invoice}, {@code commerce_credit_note} and {@code stock_transfer} and the highest
 *       sequence; a missing number is warning {@code SERIES_GAP}. A number between the range's
 *       first and last whose document is dated outside the range (a back-dated credit note) is
 *       listed as "dated in another period", not as missing.</li>
 *   <li><b>Paper bill books:</b> one row per book with an entry dated in the range: first and last
 *       page entered, total, cancelled (voided bills) and the pages "not entered": pages between
 *       the lowest and the highest page ever entered in the book that have no bill.</li>
 * </ul>
 */
@Service
public class DocumentsIssuedService {

    static final String SYSTEM = "SYSTEM";
    static final String MANUAL_BOOK = "MANUAL_BOOK";
    /** Numbers listed in one cell before "…". */
    static final int LIST_CAP = 50;

    private final ReportReadRepository readRepository;

    public DocumentsIssuedService(ReportReadRepository readRepository) {
        this.readRepository = readRepository;
    }

    /** The two blocks. */
    public record Blocks(List<Map<String, Object>> systemRows, Map<String, Object> systemTotals,
                         List<Map<String, Object>> bookRows, Map<String, Object> bookTotals) {

        public ReportDtos.Section system(String key, String label, String labelHi) {
            return new ReportDtos.Section(key, label, labelHi, ReportTable.dto(GstColumns.DOCS), systemRows,
                    systemTotals);
        }

        public ReportDtos.Section books(String key, String label, String labelHi) {
            return new ReportDtos.Section(key, label, labelHi, ReportTable.dto(GstColumns.BILL_BOOKS), bookRows,
                    bookTotals);
        }
    }

    /** Reads and builds both blocks for the filter's range, GSTIN and location. */
    public Blocks blocks(DocFilter filter, ReportWarnings warnings) {
        List<DocumentRow> inRange = new ArrayList<>();
        readRepository.documentsInRange(filter, row -> {
            if (row.seriesId() != null) {
                inRange.add(row);
            }
        });
        Set<String> seriesIds = new LinkedHashSet<>();
        for (DocumentRow row : inRange) {
            seriesIds.add(row.seriesId());
        }
        List<SeriesRow> series = readRepository.series(filter.instituteId(), seriesIds);
        Map<String, List<DocumentRow>> allTime = new HashMap<>();
        readRepository.seriesDocuments(filter.instituteId(), seriesIds,
                row -> allTime.computeIfAbsent(row.seriesId(), k -> new ArrayList<>()).add(row));
        Map<String, List<DocumentRow>> rangeBySeries = new HashMap<>();
        for (DocumentRow row : inRange) {
            rangeBySeries.computeIfAbsent(row.seriesId(), k -> new ArrayList<>()).add(row);
        }

        List<Map<String, Object>> systemRows = new ArrayList<>();
        List<Map<String, Object>> bookRows = new ArrayList<>();
        long[] systemSums = new long[3];
        long[] bookSums = new long[4];
        for (SeriesRow s : series) {
            List<DocumentRow> range = rangeBySeries.getOrDefault(s.id(), List.of());
            List<DocumentRow> all = allTime.getOrDefault(s.id(), List.of());
            if (MANUAL_BOOK.equals(s.kind())) {
                Map<String, Object> row = bookRow(s, range, all);
                bookRows.add(row);
                bookSums[0] += (long) row.get("total");
                bookSums[1] += (long) row.get("cancelled");
                bookSums[2] += (long) row.get("net_issued");
                bookSums[3] += (long) row.get("not_entered_count");
            } else {
                Map<String, Object> row = systemRow(s, range, all, filter.from(), filter.to(), warnings);
                systemRows.add(row);
                systemSums[0] += (long) row.get("total");
                systemSums[1] += (long) row.get("cancelled");
                systemSums[2] += (long) row.get("net_issued");
            }
        }
        Map<String, Object> systemTotals = new LinkedHashMap<>();
        systemTotals.put("total", systemSums[0]);
        systemTotals.put("cancelled", systemSums[1]);
        systemTotals.put("net_issued", systemSums[2]);
        Map<String, Object> bookTotals = new LinkedHashMap<>();
        bookTotals.put("total", bookSums[0]);
        bookTotals.put("cancelled", bookSums[1]);
        bookTotals.put("net_issued", bookSums[2]);
        bookTotals.put("not_entered_count", bookSums[3]);
        return new Blocks(systemRows, systemTotals, bookRows, bookTotals);
    }

    // ------------------------------------------------------------------ system series

    Map<String, Object> systemRow(SeriesRow s, List<DocumentRow> range, List<DocumentRow> all, LocalDate from,
                                  LocalDate to, ReportWarnings warnings) {
        long minSeq = Long.MAX_VALUE;
        long maxSeq = Long.MIN_VALUE;
        long cancelled = 0;
        for (DocumentRow doc : range) {
            long seq = parseSequence(doc.number(), s.prefix(), s.financialYear());
            if (seq < 0) {
                warnings.add(ReportWarnings.NUMBER_NOT_PARSED, "the number does not follow its series", doc.number());
            } else {
                minSeq = Math.min(minSeq, seq);
                maxSeq = Math.max(maxSeq, seq);
            }
            if (doc.cancelled()) {
                cancelled++;
            }
        }

        BitSet present = new BitSet();
        long highest = 0;
        List<String> otherPeriod = new ArrayList<>();
        for (DocumentRow doc : all) {
            long seq = parseSequence(doc.number(), s.prefix(), s.financialYear());
            if (seq < 0) {
                warnings.add(ReportWarnings.NUMBER_NOT_PARSED, "the number does not follow its series", doc.number());
                continue;
            }
            if (seq <= Integer.MAX_VALUE) {
                present.set((int) seq);
            }
            highest = Math.max(highest, seq);
            boolean outside = doc.date() == null || doc.date().isBefore(from) || doc.date().isAfter(to);
            if (outside && minSeq != Long.MAX_VALUE && seq >= minSeq && seq <= maxSeq) {
                otherPeriod.add(doc.number());
            }
        }
        long expected = s.nextValue() - 1;
        List<Long> missing = missing(expected, present);
        List<String> problems = new ArrayList<>();
        if (!missing.isEmpty()) {
            problems.add("missing " + join(numbers(s, missing)));
        }
        if (highest > expected) {
            problems.add("numbers above the counter (" + expected + "): highest " + highest);
        }
        if (all.size() != expected && missing.isEmpty() && highest <= expected) {
            problems.add(all.size() + " documents for " + expected + " numbers");
        }
        String gap = problems.isEmpty() ? "none" : String.join("; ", problems);
        if (!problems.isEmpty()) {
            warnings.add(ReportWarnings.SERIES_GAP, gap, label(s));
        }

        Map<String, Object> row = ReportTable.row();
        row.put("nature", nature(s.documentType()));
        row.put("document_type", s.documentType());
        row.put("prefix", s.prefix());
        row.put("financial_year", s.financialYear());
        row.put("location", s.locationCode());
        row.put("register", s.registerName());
        row.put("from_number", minSeq == Long.MAX_VALUE ? null : format(s, minSeq));
        row.put("to_number", maxSeq == Long.MIN_VALUE ? null : format(s, maxSeq));
        row.put("total", (long) range.size());
        row.put("cancelled", cancelled);
        row.put("net_issued", range.size() - cancelled);
        row.put("issued_all_time", (long) all.size());
        row.put("gap", gap);
        row.put("dated_in_other_period", otherPeriod.isEmpty() ? null : join(otherPeriod));
        return row;
    }

    /** Sequences 1..{@code expected} not present, ascending. */
    static List<Long> missing(long expected, BitSet present) {
        List<Long> out = new ArrayList<>();
        if (expected <= 0) {
            return out;
        }
        int limit = (int) Math.min(expected, Integer.MAX_VALUE);
        for (int seq = present.nextClearBit(1); seq >= 1 && seq <= limit; seq = present.nextClearBit(seq + 1)) {
            out.add((long) seq);
        }
        return out;
    }

    /**
     * The sequence of a document number of a SYSTEM series: the number must be
     * {@code prefix + FinancialYear.token(fy) + "-" + digits}; -1 when it is not.
     */
    public static long parseSequence(String number, String prefix, String financialYear) {
        if (number == null || prefix == null || financialYear == null) {
            return -1;
        }
        String head;
        try {
            head = prefix + FinancialYear.token(financialYear) + "-";
        } catch (IllegalArgumentException e) {
            return -1;
        }
        if (!number.startsWith(head) || number.length() == head.length()) {
            return -1;
        }
        String digits = number.substring(head.length());
        if (!digits.matches("^[0-9]{1,18}$")) {
            return -1;
        }
        return Long.parseLong(digits);
    }

    // ------------------------------------------------------------------ bill books

    Map<String, Object> bookRow(SeriesRow s, List<DocumentRow> range, List<DocumentRow> all) {
        TreeSet<Long> rangePages = new TreeSet<>();
        long cancelled = 0;
        for (DocumentRow doc : range) {
            long page = page(doc, s);
            if (page >= 0) {
                rangePages.add(page);
            }
            if (doc.cancelled()) {
                cancelled++;
            }
        }
        Set<Long> allPages = new TreeSet<>();
        for (DocumentRow doc : all) {
            long page = page(doc, s);
            if (page >= 0) {
                allPages.add(page);
            }
        }
        List<Long> notEntered = notEntered(allPages);
        Map<String, Object> row = ReportTable.row();
        row.put("prefix", s.prefix());
        row.put("financial_year", s.financialYear());
        row.put("location", s.locationCode());
        row.put("book_range", s.bookFrom() + "–" + s.bookTo());
        row.put("from_page", rangePages.isEmpty() ? null : String.valueOf(rangePages.first()));
        row.put("to_page", rangePages.isEmpty() ? null : String.valueOf(rangePages.last()));
        row.put("total", (long) range.size());
        row.put("cancelled", cancelled);
        row.put("net_issued", range.size() - cancelled);
        row.put("not_entered_count", (long) notEntered.size());
        List<String> pages = new ArrayList<>(notEntered.size());
        for (Long page : notEntered) {
            pages.add(String.valueOf(page));
        }
        row.put("not_entered", pages.isEmpty() ? null : join(pages));
        return row;
    }

    /** Pages between the lowest and the highest page entered that have no bill. */
    public static List<Long> notEntered(Collection<Long> pagesEntered) {
        List<Long> out = new ArrayList<>();
        if (pagesEntered.isEmpty()) {
            return out;
        }
        TreeSet<Long> pages = new TreeSet<>(pagesEntered);
        for (long page = pages.first(); page <= pages.last(); page++) {
            if (!pages.contains(page)) {
                out.add(page);
            }
        }
        return out;
    }

    /** The paper page of a bill-book entry: the typed number, else the sequence of the stored number. */
    private static long page(DocumentRow doc, SeriesRow s) {
        if (doc.page() != null && doc.page().matches("^[0-9]{1,18}$")) {
            return Long.parseLong(doc.page());
        }
        return parseSequence(doc.number(), s.prefix(), s.financialYear());
    }

    // ------------------------------------------------------------------ text

    /** GSTR-1 table 13 nature of a series' documents. */
    static String nature(String documentType) {
        if (documentType == null) {
            return null;
        }
        return switch (documentType) {
            case "CREDIT_NOTE" -> "Credit Note";
            case "DELIVERY_CHALLAN" -> "Delivery Challan in cases other than by way of supply";
            default -> "Invoices for outward supply";
        };
    }

    private static String label(SeriesRow s) {
        try {
            return s.prefix() + FinancialYear.token(s.financialYear());
        } catch (IllegalArgumentException e) {
            return s.prefix() + s.financialYear();
        }
    }

    private static String format(SeriesRow s, long seq) {
        try {
            return DocumentNumberAllocator.format(s.prefix(), s.financialYear(), seq);
        } catch (IllegalArgumentException e) {
            return String.valueOf(seq);
        }
    }

    private static List<String> numbers(SeriesRow s, List<Long> seqs) {
        List<String> out = new ArrayList<>(seqs.size());
        for (Long seq : seqs) {
            out.add(format(s, seq));
        }
        return out;
    }

    /** At most {@link #LIST_CAP} items, then "… (N more)". */
    static String join(List<String> items) {
        if (items.size() <= LIST_CAP) {
            return String.join(", ", items);
        }
        return String.join(", ", items.subList(0, LIST_CAP)) + " … (" + (items.size() - LIST_CAP) + " more)";
    }
}
