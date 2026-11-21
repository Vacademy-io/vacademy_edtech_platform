package vacademy.io.admin_core_service.features.commerce.report.service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportCsvWriter;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyReportRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.SessionRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.Keyset;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.integer;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.money;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.text;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.time;

/**
 * POS sessions (contract 2.11): the counter sessions opened in the range. A closed session's
 * figures are read from the Z-report frozen at its close ({@code pos_session.z_report_json}),
 * never recomputed; an open session is listed in block {@code open_sessions} with no totals
 * ("still open"). Totals cover the closed sessions; the {@code check} block compares their bills
 * (till bills + paper bills) with the live invoices of those sessions' orders.
 */
@Service
public class PosSessionsReportService {

    public static final String POS_SESSIONS = "pos-sessions";
    public static final String SESSIONS_DO_NOT_ADD_UP = "SESSIONS_DO_NOT_ADD_UP";
    public static final String Z_REPORT_MISSING = "Z_REPORT_MISSING";

    /** Money in the stored JSON is read as exact decimals, never through a double. */
    private static final ObjectMapper JSON = new ObjectMapper()
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    private static final Set<String> OWN_MODE_COLUMNS = Set.of("CASH", "UPI", "CARD");

    static final ReportTable CLOSED = ReportTable.of(
            text("register", "Register", "काउंटर"),
            text("location", "Location", "जगह"),
            text("cashier", "Cashier", "कैशियर"),
            time("opened", "Opened", "खुला"),
            time("closed", "Closed", "बंद"),
            money("opening_cash", "Opening cash", "शुरुआती नकद"),
            integer("bills", "Bills", "बिल"),
            money("bills_value", "Bills value", "बिलों की रकम"),
            integer("voided", "Voided bills", "रद्द बिल"),
            money("voided_value", "Voided value", "रद्द बिलों की रकम"),
            money("discounts", "Discounts", "छूट"),
            money("cash", "Cash", "नकद"),
            money("upi", "UPI", "UPI"),
            money("card", "Card", "कार्ड"),
            money("other_modes", "Other modes", "अन्य तरीके"),
            integer("returns", "Returns", "वापसी"),
            money("returns_value", "Returns credit", "वापसी का क्रेडिट"),
            money("refund_cash", "Refund cash", "नकद वापसी"),
            money("refund_upi", "Refund UPI", "UPI वापसी"),
            money("refund_bank_transfer", "Refund bank transfer", "बैंक ट्रांसफ़र वापसी"),
            money("refund_other", "Refund other", "अन्य वापसी"),
            money("cash_in", "Cash in", "नकद जमा"),
            money("cash_out", "Cash out", "नकद निकासी"),
            money("expected", "Expected cash", "अपेक्षित नकद"),
            money("counted", "Counted cash", "गिना गया नकद"),
            money("variance", "Variance", "अंतर"),
            integer("bill_book_bills", "Paper bills", "काग़ज़ी बिल"),
            money("bill_book_value", "Paper bills value", "काग़ज़ी बिलों की रकम"),
            text("first_number", "First number", "पहला नंबर"),
            text("last_number", "Last number", "आख़िरी नंबर"),
            text("close_note", "Close note", "बंद करते समय टिप्पणी"),
            text("session_id", "Session", "सत्र"));

    static final ReportTable OPEN = ReportTable.of(
            text("register", "Register", "काउंटर"),
            text("location", "Location", "जगह"),
            text("cashier", "Cashier", "कैशियर"),
            time("opened", "Opened", "खुला"),
            money("opening_cash", "Opening cash", "शुरुआती नकद"),
            text("status", "Status", "स्थिति"),
            text("session_id", "Session", "सत्र"));

    /** Money columns of a closed session row, summed into the totals. */
    static final List<String> MONEY_KEYS = List.of("opening_cash", "bills_value", "voided_value", "discounts",
            "cash", "upi", "card", "other_modes", "returns_value", "refund_cash", "refund_upi",
            "refund_bank_transfer", "refund_other", "cash_in", "cash_out", "expected", "counted", "variance",
            "bill_book_value");
    static final List<String> COUNT_KEYS = List.of("bills", "voided", "returns", "bill_book_bills");

    private final MoneyReportRepository repository;

    public PosSessionsReportService(MoneyReportRepository repository) {
        this.repository = repository;
    }

    /** The cashiers the answer names (read in the report's transaction; names outside it). */
    public List<String> staffIds(ReportQuery q) {
        return repository.sessionCashiers(MoneyReportSupport.filter(q), q.range().storedFrom(),
                q.range().storedToExclusive());
    }

    public ReportAnswer sessions(ReportQuery q) {
        return build(q, false, 0);
    }

    public int export(ReportQuery q, String format, OutputStream out, int maxRows) throws IOException {
        return MoneyReportSupport.export(build(q, true, maxRows), "closed_sessions", "Closed sessions",
                "बंद सत्र", format, q.hindi(), out, maxRows);
    }

    ReportAnswer build(ReportQuery q, boolean export, int maxRows) {
        DocFilter f = MoneyReportSupport.filter(q);
        Map<String, String> locations = MoneyReportSupport.locationNames(repository.locations(q.instituteId()));
        ReportWarnings warnings = new ReportWarnings();
        ReportAnswer a = MoneyReportSupport.answer(q, POS_SESSIONS);
        a.setColumns(CLOSED.dto());

        // Sessions are few (registers × days): every session of the range is read, the totals cover
        // all closed ones, and the page is cut in Java after the cursor (opened_at, id).
        List<SessionRow> closed = new ArrayList<>();
        List<Map<String, Object>> open = new ArrayList<>();
        repository.sessionsOpenedIn(f, q.range().storedFrom(), q.range().storedToExclusive(), s -> {
            if ("CLOSED".equals(s.status())) {
                closed.add(s);
            } else {
                open.add(openRow(q, s, locations));
            }
        });

        Map<String, BigDecimal> moneySums = new LinkedHashMap<>();
        Map<String, Long> countSums = new LinkedHashMap<>();
        MONEY_KEYS.forEach(k -> moneySums.put(k, BigDecimal.ZERO));
        COUNT_KEYS.forEach(k -> countSums.put(k, 0L));
        BigDecimal billsAndBook = BigDecimal.ZERO;
        List<Map<String, Object>> rows = new ArrayList<>();
        for (SessionRow s : closed) {
            Map<String, Object> row = closedRow(q, s, locations, warnings);
            for (String key : MONEY_KEYS) {
                Object value = row.get(key);
                if (value instanceof BigDecimal amount) {
                    moneySums.merge(key, amount, BigDecimal::add);
                }
            }
            for (String key : COUNT_KEYS) {
                Object value = row.get(key);
                if (value instanceof Number n) {
                    countSums.merge(key, n.longValue(), Long::sum);
                }
            }
            billsAndBook = billsAndBook.add((BigDecimal) row.get("bills_value"))
                    .add((BigDecimal) row.get("bill_book_value"));
            rows.add(row);
        }

        if (export) {
            if (rows.size() > maxRows) {
                throw ReportCsvWriter.tooLarge(maxRows);
            }
            a.setRows(rows);
        } else {
            page(q, a, closed, rows);
        }

        Map<String, Object> totals = MoneyReportSupport.totals();
        for (String key : CLOSED.columns().stream().map(ReportTable.Column::key).toList()) {
            if (moneySums.containsKey(key)) {
                totals.put(key, ReportTable.money(moneySums.get(key)));
            } else if (countSums.containsKey(key)) {
                totals.put(key, countSums.get(key));
            }
        }
        totals.put("closed_sessions", (long) closed.size());
        totals.put("open_sessions", (long) open.size());
        a.setTotals(totals);

        List<String> closedIds = closed.stream().map(SessionRow::id).toList();
        BigDecimal invoices = ReportTable.moneyOrZero(repository.liveInvoicesOfSessions(q.instituteId(), closedIds));
        BigDecimal bills = ReportTable.money(billsAndBook);
        BigDecimal difference = bills.subtract(invoices);
        Map<String, Object> check = new LinkedHashMap<>();
        check.put("rule", "bills value + paper bills value of closed sessions = live invoices of their orders");
        check.put("bills_value", bills);
        check.put("invoices_total", invoices);
        check.put("difference", ReportTable.money(difference));
        if (difference.signum() != 0) {
            warnings.add(SESSIONS_DO_NOT_ADD_UP, "the Z-reports differ from the invoices of their sessions by "
                    + ReportTable.money(difference), null);
        }
        a.setCheck(check);

        Map<String, Object> openTotals = MoneyReportSupport.totals();
        openTotals.put("open_sessions", (long) open.size());
        a.getSections().add(MoneyReportSupport.section("open_sessions", "Still open", "अभी खुले सत्र", OPEN, open,
                openTotals));
        a.setWarnings(warnings.list());
        return a;
    }

    /** The page after the cursor; {@code next_cursor} when more follow. */
    private static void page(ReportQuery q, ReportAnswer a, List<SessionRow> closed, List<Map<String, Object>> rows) {
        Keyset after = ReportCursor.decode(q.cursor());
        int size = q.pageSize();
        int start = 0;
        if (after != null) {
            start = closed.size();
            for (int i = 0; i < closed.size(); i++) {
                SessionRow s = closed.get(i);
                int c = s.openedAtRaw().compareTo(after.number());
                if (c > 0 || (c == 0 && s.id().compareTo(after.id()) > 0)) {
                    start = i;
                    break;
                }
            }
        }
        int end = Math.min(closed.size(), start + size);
        a.setRows(new ArrayList<>(rows.subList(start, end)));
        if (end < closed.size()) {
            SessionRow last = closed.get(end - 1);
            a.setNextCursor(ReportCursor.encode(last.openedDay(), last.openedAtRaw(), last.id()));
        }
    }

    static Map<String, Object> openRow(ReportQuery q, SessionRow s, Map<String, String> locations) {
        Map<String, Object> row = ReportTable.row();
        row.put("register", s.registerCode());
        row.put("location", MoneyReportSupport.locationName(locations, s.locationId()));
        row.put("cashier", q.staffName(s.cashierId()));
        row.put("opened", s.openedAt());
        row.put("opening_cash", ReportTable.moneyOrZero(s.openingCash()));
        row.put("status", "OPEN");
        row.put("session_id", s.id());
        return row;
    }

    /** A closed session's row: every figure from its stored Z-report. */
    static Map<String, Object> closedRow(ReportQuery q, SessionRow s, Map<String, String> locations,
                                         ReportWarnings warnings) {
        JsonNode z = parse(s.zReportJson());
        if (z == null) {
            warnings.add(Z_REPORT_MISSING, "a closed session has no stored Z-report; its figures are left empty",
                    s.registerCode() + " " + s.openedAt());
            z = JSON.createObjectNode();
        }
        Map<String, Object> row = ReportTable.row();
        row.put("register", s.registerCode());
        row.put("location", MoneyReportSupport.locationName(locations, s.locationId()));
        row.put("cashier", q.staffName(s.cashierId()));
        row.put("opened", s.openedAt());
        row.put("closed", s.closedAt());
        row.put("opening_cash", amount(z.path("opening_cash")));
        row.put("bills", count(z.path("bills")));
        row.put("bills_value", total(z.path("bills")));
        row.put("voided", count(z.path("voided")));
        row.put("voided_value", total(z.path("voided")));
        row.put("discounts", amount(z.path("discounts")));
        BigDecimal other = BigDecimal.ZERO;
        Map<String, BigDecimal> modes = new LinkedHashMap<>();
        for (JsonNode mode : z.path("by_mode")) {
            String name = mode.path("mode").asText("");
            BigDecimal value = amount(mode.path("amount"));
            if (OWN_MODE_COLUMNS.contains(name)) {
                modes.merge(name, value, BigDecimal::add);
            } else {
                other = other.add(value);
            }
        }
        row.put("cash", ReportTable.moneyOrZero(modes.get("CASH")));
        row.put("upi", ReportTable.moneyOrZero(modes.get("UPI")));
        row.put("card", ReportTable.moneyOrZero(modes.get("CARD")));
        row.put("other_modes", ReportTable.money(other));
        row.put("returns", z.path("returns").path("count").asLong(0));
        row.put("returns_value", amount(z.path("returns").path("credit")));
        Map<String, BigDecimal> refunds = new LinkedHashMap<>();
        BigDecimal refundOther = BigDecimal.ZERO;
        for (JsonNode refund : z.path("refunds")) {
            String method = refund.path("method").asText("");
            BigDecimal value = amount(refund.path("amount"));
            if ("CASH".equals(method) || "UPI".equals(method) || "BANK_TRANSFER".equals(method)) {
                refunds.merge(method, value, BigDecimal::add);
            } else {
                refundOther = refundOther.add(value);
            }
        }
        row.put("refund_cash", ReportTable.moneyOrZero(refunds.get("CASH")));
        row.put("refund_upi", ReportTable.moneyOrZero(refunds.get("UPI")));
        row.put("refund_bank_transfer", ReportTable.moneyOrZero(refunds.get("BANK_TRANSFER")));
        row.put("refund_other", ReportTable.money(refundOther));
        row.put("cash_in", amount(z.path("cash_in")));
        row.put("cash_out", amount(z.path("cash_out")));
        row.put("expected", amount(z.path("expected_cash")));
        row.put("counted", amount(z.path("counted_cash")));
        row.put("variance", amount(z.path("variance")));
        row.put("bill_book_bills", count(z.path("bill_book")));
        row.put("bill_book_value", total(z.path("bill_book")));
        row.put("first_number", textOrNull(z.path("first_invoice_number")));
        row.put("last_number", textOrNull(z.path("last_invoice_number")));
        row.put("close_note", s.closeNote());
        row.put("session_id", s.id());
        return row;
    }

    static JsonNode parse(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            JsonNode node = JSON.readTree(json);
            return node != null && node.isObject() ? node : null;
        } catch (IOException e) {
            return null;
        }
    }

    private static BigDecimal amount(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return ReportTable.moneyOrZero(null);
        }
        try {
            return ReportTable.money(node.isNumber() ? node.decimalValue() : new BigDecimal(node.asText()));
        } catch (NumberFormatException e) {
            return ReportTable.moneyOrZero(null);
        }
    }

    private static long count(JsonNode countTotal) {
        return countTotal.path("count").asLong(0);
    }

    private static BigDecimal total(JsonNode countTotal) {
        return amount(countTotal.path("total"));
    }

    private static String textOrNull(JsonNode node) {
        return node == null || node.isMissingNode() || node.isNull() ? null : node.asText();
    }
}
