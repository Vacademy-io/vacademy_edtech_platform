package vacademy.io.admin_core_service.features.commerce.report.service;

import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyReportRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.DocumentRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.MoneyRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.SessionRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.date;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.integer;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.money;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.text;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.time;

/**
 * The day book (contract 2.7): what happened on one India day (or up to 31), in two kinds of
 * rows, and a footer.
 *
 * <ul>
 *   <li><b>Documents</b> ({@code documents}): invoices (live or cancelled) and credit notes by
 *       their {@code document_date}; a value, no money. {@code value} is signed (a credit note
 *       negative), so its column sums to the documents' net; a cancelled invoice keeps its number
 *       and status and its amount moves to {@code cancelled_value}. A paper bill shows when it was
 *       entered. A bill reissued with the buyer's GSTIN counts once (warning
 *       {@code REISSUE_COUNTED_ONCE}; the GST registers list the reissue note and new invoice).</li>
 *   <li><b>Money</b> ({@code money}): sale payments, receipts on credit (a RECEIVED tender of a
 *       staff order written after the order), COD collected (dated by the remittance's
 *       {@code received_on}) and what the courier kept of it (deductions, short remittance),
 *       refunds paid, counter cash in and out. A credit note used at the counter and an exchange
 *       credit are listed with their value and no money. PENDING and VOID tenders are not
 *       money.</li>
 *   <li><b>Footer</b>: money in and out by mode ({@code by_mode}); the counter sessions
 *       ({@code sessions}); and "cash at the tills" ({@code tills}): per India day and location,
 *       Σ cash counted of the sessions closed that day. A session still open shows the cash
 *       expected by the end of the range and is not in it. The total {@code cash_at_tills} is
 *       given for a one-day book only (days do not add up: the same cash is counted each day).</li>
 * </ul>
 */
@Service
public class DayBookService {

    public static final String DAY_BOOK = "day-book";

    /** Money kinds. */
    public static final String SALE_PAYMENT = "SALE_PAYMENT";
    public static final String RECEIPT_ON_CREDIT = "RECEIPT_ON_CREDIT";
    public static final String COD_COLLECTED = "COD_COLLECTED";
    public static final String CREDIT_NOTE_USED = "CREDIT_NOTE_USED";
    public static final String REFUND_PAID = "REFUND_PAID";
    public static final String EXCHANGE_CREDIT = "EXCHANGE_CREDIT";
    public static final String CASH_IN = "CASH_IN";
    public static final String CASH_OUT = "CASH_OUT";
    /** What a courier kept of a remittance: deductions, a short remittance; or paid over. */
    public static final String COD_DEDUCTION = "COD_DEDUCTION";
    public static final String COD_SHORT = "COD_SHORT";
    public static final String COD_EXCESS = "COD_EXCESS";

    /** Kinds that bring money in; {@link #MONEY_OUT} take it out; the rest are not money. */
    static final Set<String> MONEY_IN = Set.of(SALE_PAYMENT, RECEIPT_ON_CREDIT, COD_COLLECTED, CASH_IN, COD_EXCESS);
    static final Set<String> MONEY_OUT = Set.of(REFUND_PAID, CASH_OUT, COD_DEDUCTION, COD_SHORT);

    /** Shown for an event with a date and no time of its own. */
    static final String NO_TIME = "—";

    static final ReportTable DOCUMENTS = ReportTable.of(
            date("date", "Date", "तारीख़"),
            time("time", "Time", "समय"),
            text("type", "Type", "प्रकार"),
            text("number", "Number", "नंबर"),
            text("party", "Party", "पार्टी"),
            money("value", "Value (credit notes negative)", "मूल्य (क्रेडिट नोट घटाकर)"),
            money("cancelled_value", "Cancelled invoice value (not counted)", "रद्द इनवॉइस की राशि (गिनी नहीं)"),
            text("status", "Status", "स्थिति"),
            text("note", "Note", "टिप्पणी"),
            text("staff", "Staff", "कर्मचारी"),
            text("location", "Location", "जगह"));

    static final ReportTable MONEY = ReportTable.of(
            date("date", "Date", "तारीख़"),
            time("time", "Time", "समय"),
            text("type", "Type", "प्रकार"),
            text("number", "Number", "नंबर"),
            text("party", "Party", "पार्टी"),
            text("payment_mode", "Payment mode", "भुगतान का तरीका"),
            money("value", "Value (not money)", "मूल्य (पैसा नहीं)"),
            money("amount_in", "Amount in", "आई रकम"),
            money("amount_out", "Amount out", "गई रकम"),
            text("reference", "Reference", "संदर्भ"),
            text("staff", "Staff", "कर्मचारी"),
            text("location", "Location", "जगह"));

    static final ReportTable BY_MODE = ReportTable.of(
            text("payment_mode", "Payment mode", "भुगतान का तरीका"),
            money("amount_in", "Amount in", "आई रकम"),
            money("amount_out", "Amount out", "गई रकम"),
            money("net", "Net", "शुद्ध"));

    static final ReportTable SESSIONS = ReportTable.of(
            date("date", "Opened on", "खुलने की तारीख़"),
            text("register", "Register", "काउंटर"),
            text("location", "Location", "जगह"),
            text("cashier", "Cashier", "कैशियर"),
            text("status", "Status", "स्थिति"),
            time("opened", "Opened", "खुला"),
            time("closed", "Closed", "बंद"),
            money("opening_cash", "Opening cash", "शुरुआती नकद"),
            money("expected", "Expected cash", "अपेक्षित नकद"),
            money("counted", "Counted cash", "गिना गया नकद"),
            money("variance", "Variance", "अंतर"),
            money("cash_at_till", "Cash at the till (closed in these dates)", "काउंटर पर नकद (इन तारीख़ों में बंद)"),
            text("note", "Note", "टिप्पणी"));

    static final ReportTable TILLS = ReportTable.of(
            date("date", "Closed on", "बंद होने की तारीख़"),
            text("location", "Location", "जगह"),
            integer("sessions", "Sessions closed", "बंद सत्र"),
            money("cash_at_tills", "Cash at the tills", "काउंटरों पर नकद"));

    private final MoneyReportRepository repository;

    public DayBookService(MoneyReportRepository repository) {
        this.repository = repository;
    }

    /** The staff the day book names (read before the report's transaction ends; names outside it). */
    public List<String> staffIds(ReportQuery q) {
        return repository.dayBookStaff(MoneyReportSupport.filter(q), q.range().storedFrom(),
                q.range().storedToExclusive());
    }

    public ReportAnswer dayBook(ReportQuery q) {
        return build(q, false, 0);
    }

    public int export(ReportQuery q, String format, OutputStream out, int maxRows) throws IOException {
        ReportAnswer a = build(q, true, maxRows);
        return MoneyReportSupport.export(a, "documents", "Documents", "दस्तावेज़", format, q.hindi(), out, maxRows);
    }

    ReportAnswer build(ReportQuery q, boolean export, int maxRows) {
        DocFilter f = MoneyReportSupport.filter(q);
        Map<String, String> locations = MoneyReportSupport.locationNames(repository.locations(q.instituteId()));
        ReportWarnings warnings = new ReportWarnings();
        ReportAnswer a = MoneyReportSupport.answer(q, DAY_BOOK);

        MoneyReportSupport.RowBudget budget = new MoneyReportSupport.RowBudget(export, maxRows);
        // Documents.
        MoneyReportSupport.Rows documents = new MoneyReportSupport.Rows(budget);
        DocumentTotals docTotals = new DocumentTotals();
        repository.documentRows(f, row -> {
            docTotals.add(row);
            documents.add(documentRow(q, row, locations));
        });
        documents.warnIfCut(warnings, "documents");

        // Money.
        MoneyReportSupport.Rows money = new MoneyReportSupport.Rows(budget);
        MoneyTotals moneyTotals = new MoneyTotals();
        boolean[] cod = {false};
        repository.moneyRows(f, q.range().storedFrom(), q.range().storedToExclusive(), row -> {
            moneyTotals.add(row);
            cod[0] |= COD_COLLECTED.equals(row.kind());
            money.add(moneyRow(q, row, locations));
        });
        money.warnIfCut(warnings, "money");
        if (cod[0] && f.locationIn() != null) {
            warnings.add(ReportWarnings.COD_GROSS, "COD is shown at the order amount: what the courier kept "
                    + "(deductions, short remittance) has no location and shows in the all-locations day book", null);
        }
        for (String pair : repository.reissuesInRange(f)) {
            warnings.add(ReportWarnings.REISSUE_COUNTED_ONCE, "a bill reissued with the buyer's GSTIN counts once "
                    + "here (the first bill); the GST registers list its credit note and new invoice", pair);
        }

        // Sessions footer and cash at the tills: per India day and location, the sessions closed that day.
        boolean oneDay = q.range().from().equals(q.range().to());
        List<Map<String, Object>> sessions = new ArrayList<>();
        Map<String, BigDecimal> tillCash = new java.util.TreeMap<>();
        Map<String, Long> tillSessions = new java.util.TreeMap<>();
        repository.footerSessions(f, q.range().storedFrom(), q.range().storedToExclusive(), s -> {
            Map<String, Object> row = sessionRow(q, s, locations);
            if (row.get("cash_at_till") != null) {
                String key = s.closedDay() + "\u0000" + MoneyReportSupport.locationName(locations, s.locationId());
                tillCash.merge(key, (BigDecimal) row.get("cash_at_till"), BigDecimal::add);
                tillSessions.merge(key, 1L, Long::sum);
            }
            sessions.add(row);
        });
        List<Map<String, Object>> tills = new ArrayList<>();
        BigDecimal tillTotal = BigDecimal.ZERO;
        for (Map.Entry<String, BigDecimal> e : tillCash.entrySet()) {
            String[] parts = e.getKey().split("\u0000", 2);
            Map<String, Object> row = ReportTable.row();
            row.put("date", parts[0]);
            row.put("location", parts[1]);
            row.put("sessions", tillSessions.get(e.getKey()));
            row.put("cash_at_tills", ReportTable.money(e.getValue()));
            tills.add(row);
            tillTotal = tillTotal.add(e.getValue());
        }
        BigDecimal cashAtTills = oneDay ? ReportTable.money(tillTotal) : null;

        Map<String, Object> documentTotals = docTotals.totals();
        Map<String, Object> moneyTotalsMap = moneyTotals.totals();
        Map<String, Object> sessionTotals = MoneyReportSupport.totals();
        if (oneDay) {
            sessionTotals.put("cash_at_till", cashAtTills);
        }
        sessionTotals.put("sessions", (long) sessions.size());
        Map<String, Object> tillTotals = MoneyReportSupport.totals();
        tillTotals.put("sessions", tillSessions.values().stream().mapToLong(Long::longValue).sum());
        if (oneDay) {
            tillTotals.put("cash_at_tills", cashAtTills);
        }

        a.getSections().add(MoneyReportSupport.section("documents", "Documents", "दस्तावेज़", DOCUMENTS,
                documents.list(), documentTotals));
        a.getSections().add(MoneyReportSupport.section("money", "Money", "पैसा", MONEY, money.list(),
                moneyTotalsMap));
        a.getSections().add(MoneyReportSupport.section("by_mode", "By payment mode", "भुगतान के तरीके से",
                BY_MODE, moneyTotals.byModeRows(), moneyTotals.byModeTotals()));
        a.getSections().add(MoneyReportSupport.section("sessions", "Counter sessions", "काउंटर सत्र", SESSIONS,
                sessions, sessionTotals));
        a.getSections().add(MoneyReportSupport.section("tills", "Cash at the tills", "काउंटरों पर नकद", TILLS,
                tills, tillTotals));

        Map<String, Object> totals = MoneyReportSupport.totals();
        totals.put("invoices", documentTotals.get("invoices"));
        totals.put("invoices_value", documentTotals.get("invoices_value"));
        totals.put("credit_notes", documentTotals.get("credit_notes"));
        totals.put("credit_notes_value", documentTotals.get("credit_notes_value"));
        totals.put("documents_net", documentTotals.get("net"));
        totals.put("amount_in", moneyTotalsMap.get("amount_in"));
        totals.put("amount_out", moneyTotalsMap.get("amount_out"));
        totals.put("net_money", moneyTotalsMap.get("net_money"));
        totals.put("cash_at_tills", cashAtTills);
        a.setTotals(totals);
        a.setWarnings(warnings.list());
        return a;
    }

    // ------------------------------------------------------------------ rows

    static Map<String, Object> documentRow(ReportQuery q, DocumentRow d, Map<String, String> locations) {
        Map<String, Object> row = ReportTable.row();
        boolean paper = d.paperNumber() != null && !d.paperNumber().isBlank();
        row.put("date", d.day() == null ? null : d.day().toString());
        // A document dated another day than it was keyed (a paper bill, a back-dated note) has no time of its own.
        boolean sameDay = d.day() != null && d.day().equals(d.enteredOn());
        row.put("time", sameDay && !paper ? d.time() : NO_TIME);
        row.put("type", "CREDIT_NOTE".equals(d.kind()) ? "CREDIT_NOTE" : paper ? "PAPER_BILL" : d.documentType());
        row.put("number", paper ? d.paperNumber() : d.number());
        row.put("party", d.party());
        boolean note = "CREDIT_NOTE".equals(d.kind());
        BigDecimal value = ReportTable.money(d.value());
        row.put("value", d.cancelled() ? null : note && value != null ? value.negate() : value);
        row.put("cancelled_value", d.cancelled() ? value : null);
        row.put("status", d.cancelled() ? "CANCELLED" : "ACTIVE");
        String text = null;
        if (paper) {
            text = "paper bill, entered on " + d.enteredOn() + (d.number() == null ? "" : " as " + d.number());
        } else if (!sameDay && d.enteredOn() != null) {
            text = "entered on " + d.enteredOn();
        }
        row.put("note", text);
        row.put("staff", q.staffName(d.staffId()));
        row.put("location", MoneyReportSupport.locationName(locations, d.locationId()));
        row.put("row_kind", "DOCUMENT");
        return row;
    }

    static Map<String, Object> moneyRow(ReportQuery q, MoneyRow m, Map<String, String> locations) {
        Map<String, Object> row = ReportTable.row();
        row.put("date", m.day() == null ? null : m.day().toString());
        row.put("time", dateOnly(m) ? NO_TIME : m.time());
        row.put("type", m.kind());
        row.put("number", m.number());
        row.put("party", m.party());
        row.put("payment_mode", m.mode());
        BigDecimal amount = ReportTable.money(m.amount());
        row.put("value", MONEY_IN.contains(m.kind()) || MONEY_OUT.contains(m.kind()) ? null : amount);
        row.put("amount_in", MONEY_IN.contains(m.kind()) ? amount : null);
        row.put("amount_out", MONEY_OUT.contains(m.kind()) ? amount : null);
        row.put("reference", m.reference());
        row.put("staff", q.staffName(m.staffId()));
        row.put("location", MoneyReportSupport.locationName(locations, m.locationId()));
        row.put("row_kind", "MONEY");
        return row;
    }

    /**
     * An event with a typed date and no time of its own: COD collected (remittance date), a
     * receipt dated by the staff (India midnight), a refund with a paid-on date, a cash movement
     * dated another day than it was keyed.
     */
    static boolean dateOnly(MoneyRow m) {
        if (COD_COLLECTED.equals(m.kind()) || "REMITTANCE".equals(m.source())) {
            return true;
        }
        if (RECEIPT_ON_CREDIT.equals(m.kind())) {
            return m.time() != null && m.time().endsWith(" 00:00");
        }
        if ("REFUND".equals(m.source())) {
            return m.typedDay() != null;
        }
        if ("CASH_MOVEMENT".equals(m.source())) {
            return m.typedDay() != null && m.time() != null && !m.time().startsWith(m.typedDay().toString());
        }
        return false;
    }

    static Map<String, Object> sessionRow(ReportQuery q, SessionRow s, Map<String, String> locations) {
        Map<String, Object> row = ReportTable.row();
        boolean open = "OPEN".equals(s.status());
        row.put("date", s.openedDay() == null ? null : s.openedDay().toString());
        row.put("register", s.registerCode());
        row.put("location", MoneyReportSupport.locationName(locations, s.locationId()));
        row.put("cashier", q.staffName(s.cashierId()));
        row.put("status", s.status());
        row.put("opened", s.openedAt());
        row.put("closed", s.closedAt());
        row.put("opening_cash", ReportTable.moneyOrZero(s.openingCash()));
        BigDecimal expected = open ? s.expectedSoFar() : s.expectedCash();
        row.put("expected", ReportTable.money(expected));
        row.put("counted", open ? null : ReportTable.money(s.countedCash()));
        row.put("variance", open ? null : ReportTable.money(s.variance()));
        boolean closedInRange = !open && s.closedDay() != null && !s.closedDay().isBefore(q.range().from())
                && !s.closedDay().isAfter(q.range().to());
        row.put("cash_at_till", closedInRange ? ReportTable.moneyOrZero(s.countedCash()) : null);
        row.put("note", open ? "still open: cash expected by the end of " + q.range().to()
                : !closedInRange ? "closed on " + s.closedDay() + ", after these dates" : s.closeNote());
        return row;
    }

    // ------------------------------------------------------------------ totals

    /** Documents: live invoices (count, value), cancelled (count, value), credit notes, net. */
    static final class DocumentTotals {
        long invoices;
        long cancelled;
        long notes;
        BigDecimal invoicesValue = BigDecimal.ZERO;
        BigDecimal notesValue = BigDecimal.ZERO;
        BigDecimal cancelledValue = BigDecimal.ZERO;

        void add(DocumentRow d) {
            if ("CREDIT_NOTE".equals(d.kind())) {
                notes++;
                notesValue = notesValue.add(d.value());
            } else if (d.cancelled()) {
                cancelled++;
                cancelledValue = cancelledValue.add(d.value());
            } else {
                invoices++;
                invoicesValue = invoicesValue.add(d.value());
            }
        }

        Map<String, Object> totals() {
            Map<String, Object> t = MoneyReportSupport.totals();
            t.put("invoices", invoices);
            t.put("invoices_value", ReportTable.money(invoicesValue));
            t.put("cancelled_count", cancelled);
            t.put("credit_notes", notes);
            t.put("credit_notes_value", ReportTable.money(notesValue));
            t.put("net", ReportTable.money(invoicesValue.subtract(notesValue)));
            // The sums of the two money columns: value (credit notes negative) and cancelled_value.
            t.put("value", ReportTable.money(invoicesValue.subtract(notesValue)));
            t.put("cancelled_value", ReportTable.money(cancelledValue));
            return t;
        }
    }

    /** Money: in, out and net, and the same by payment mode. */
    static final class MoneyTotals {
        BigDecimal in = BigDecimal.ZERO;
        BigDecimal out = BigDecimal.ZERO;
        BigDecimal notMoney = BigDecimal.ZERO;
        final Map<String, BigDecimal[]> byMode = new LinkedHashMap<>();

        void add(MoneyRow m) {
            boolean isIn = MONEY_IN.contains(m.kind());
            boolean isOut = MONEY_OUT.contains(m.kind());
            if (!isIn && !isOut) {
                notMoney = notMoney.add(m.amount());
                return;
            }
            BigDecimal[] mode = byMode.computeIfAbsent(m.mode(), k -> new BigDecimal[]{BigDecimal.ZERO,
                    BigDecimal.ZERO});
            if (isIn) {
                in = in.add(m.amount());
                mode[0] = mode[0].add(m.amount());
            } else {
                out = out.add(m.amount());
                mode[1] = mode[1].add(m.amount());
            }
        }

        Map<String, Object> totals() {
            Map<String, Object> t = MoneyReportSupport.totals();
            t.put("value", ReportTable.money(notMoney));
            t.put("amount_in", ReportTable.money(in));
            t.put("amount_out", ReportTable.money(out));
            t.put("net_money", ReportTable.money(in.subtract(out)));
            return t;
        }

        List<Map<String, Object>> byModeRows() {
            List<Map<String, Object>> rows = new ArrayList<>();
            byMode.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(e -> {
                Map<String, Object> row = ReportTable.row();
                row.put("payment_mode", e.getKey());
                row.put("amount_in", ReportTable.money(e.getValue()[0]));
                row.put("amount_out", ReportTable.money(e.getValue()[1]));
                row.put("net", ReportTable.money(e.getValue()[0].subtract(e.getValue()[1])));
                rows.add(row);
            });
            return rows;
        }

        Map<String, Object> byModeTotals() {
            Map<String, Object> t = MoneyReportSupport.totals();
            t.put("amount_in", ReportTable.money(in));
            t.put("amount_out", ReportTable.money(out));
            t.put("net", ReportTable.money(in.subtract(out)));
            return t;
        }
    }
}
