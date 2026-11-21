package vacademy.io.admin_core_service.features.commerce.report.service;

import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyReportRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.MoneyRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.date;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.money;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.text;

/**
 * Payment modes (contract 2.8): money by India day and location, read from the same money events
 * as the day book ({@link MoneyReportRepository#moneyRows}), so the two always agree.
 *
 * <p>Columns: money received by mode (cash, UPI, card, bank transfer, cheque, gateway, COD
 * collected) and their sum {@code received}; credit notes used at the counter (not money);
 * refunds paid by method and their sum {@code refunded}; counter cash in and out; what couriers
 * kept of COD remittances received ({@code cod_deductions}: deductions and short remittances, an
 * over-payment negative; dated by the remittance, no location); and {@code net_money} = received
 * − cod_deductions + cash in − refunded − cash out (= the day book's net money). A
 * location-limited view books COD at the order amount (warning {@code COD_GROSS}).
 * Block {@code paid_not_invoiced}: orders with money received in the range and no live invoice
 * at the range end (prepaid orders not packed yet), so money can be tied to sales.
 */
@Service
public class PaymentModesService {

    public static final String PAYMENT_MODES = "payment-modes";

    /** Tender mode → column of money received. */
    static final Map<String, String> RECEIVED_COLUMNS = Map.of(
            "CASH", "cash", "UPI", "upi", "CARD", "card", "BANK_TRANSFER", "bank_transfer",
            "CHEQUE", "cheque", "GATEWAY", "gateway", "COD", "cod_collected");
    /** Refund method → column of refunds paid. */
    static final Map<String, String> REFUND_COLUMNS = Map.of(
            "CASH", "refund_cash", "UPI", "refund_upi", "BANK_TRANSFER", "refund_bank_transfer",
            "GATEWAY", "refund_gateway");

    static final ReportTable TABLE = ReportTable.of(
            date("date", "Date", "तारीख़"),
            text("location", "Location", "जगह"),
            money("cash", "Cash", "नकद"),
            money("upi", "UPI", "UPI"),
            money("card", "Card", "कार्ड"),
            money("bank_transfer", "Bank transfer", "बैंक ट्रांसफ़र"),
            money("cheque", "Cheque", "चेक"),
            money("gateway", "Online payment", "ऑनलाइन भुगतान"),
            money("cod_collected", "COD collected", "COD वसूली"),
            money("received", "Received", "मिली रकम"),
            money("cod_deductions", "COD kept by the courier", "कूरियर की कटौती (COD)"),
            money("credit_note_used", "Credit note used (not money)", "क्रेडिट नोट से (पैसा नहीं)"),
            money("refund_cash", "Refund cash", "नकद वापसी"),
            money("refund_upi", "Refund UPI", "UPI वापसी"),
            money("refund_bank_transfer", "Refund bank transfer", "बैंक ट्रांसफ़र वापसी"),
            money("refund_gateway", "Refund online", "ऑनलाइन वापसी"),
            money("refunded", "Refunded", "लौटाई रकम"),
            money("cash_in", "Cash in", "नकद जमा"),
            money("cash_out", "Cash out", "नकद निकासी"),
            money("net_money", "Net money", "शुद्ध पैसा"));

    static final ReportTable PAID_NOT_INVOICED = ReportTable.of(
            text("order_number", "Order number", "ऑर्डर नंबर"),
            date("order_date", "Order date", "ऑर्डर की तारीख़"),
            text("channel", "Channel", "चैनल"),
            text("status", "Order status", "ऑर्डर की स्थिति"),
            text("customer", "Customer", "ग्राहक"),
            text("location", "Location", "जगह"),
            money("received", "Received", "मिली रकम"));

    private static final List<String> MONEY_KEYS = List.of("cash", "upi", "card", "bank_transfer", "cheque",
            "gateway", "cod_collected", "received", "cod_deductions", "credit_note_used", "refund_cash", "refund_upi",
            "refund_bank_transfer", "refund_gateway", "refunded", "cash_in", "cash_out", "net_money");

    private final MoneyReportRepository repository;

    public PaymentModesService(MoneyReportRepository repository) {
        this.repository = repository;
    }

    public ReportAnswer paymentModes(ReportQuery q) {
        return build(q, false, 0);
    }

    public int export(ReportQuery q, String format, OutputStream out, int maxRows) throws IOException {
        return MoneyReportSupport.export(build(q, true, maxRows), "days", "Payment modes", "भुगतान के तरीके",
                format, q.hindi(), out, maxRows);
    }

    ReportAnswer build(ReportQuery q, boolean export, int maxRows) {
        DocFilter f = MoneyReportSupport.filter(q);
        Map<String, String> locations = MoneyReportSupport.locationNames(repository.locations(q.instituteId()));
        ReportWarnings warnings = new ReportWarnings();
        ReportAnswer a = MoneyReportSupport.answer(q, PAYMENT_MODES);

        Map<String, Map<String, BigDecimal>> byDayLocation = new TreeMap<>();
        Map<String, BigDecimal> totals = emptyMoney();
        boolean[] cod = {false};
        repository.moneyRows(f, q.range().storedFrom(), q.range().storedToExclusive(), m -> {
            cod[0] |= DayBookService.COD_COLLECTED.equals(m.kind());
            String key = m.day() + "\u0000" + MoneyReportSupport.locationName(locations, m.locationId());
            Map<String, BigDecimal> row = byDayLocation.computeIfAbsent(key, k -> emptyMoney());
            add(row, m);
            add(totals, m);
        });
        MoneyReportSupport.RowBudget budget = new MoneyReportSupport.RowBudget(export, maxRows);
        MoneyReportSupport.Rows rows = new MoneyReportSupport.Rows(budget);
        for (Map.Entry<String, Map<String, BigDecimal>> e : byDayLocation.entrySet()) {
            String[] parts = e.getKey().split("\u0000", 2);
            Map<String, Object> row = ReportTable.row();
            row.put("date", LocalDate.parse(parts[0]).toString());
            row.put("location", parts[1]);
            putMoney(row, e.getValue());
            rows.add(row);
        }
        rows.warnIfCut(warnings, "days");
        if (cod[0] && f.locationIn() != null) {
            warnings.add(ReportWarnings.COD_GROSS, "COD is shown at the order amount: what the courier kept "
                    + "(deductions, short remittance) has no location and shows in the all-locations view", null);
        }
        a.setColumns(TABLE.dto());
        a.setRows(rows.list());

        // Paid, not yet invoiced.
        MoneyReportSupport.Rows paid = new MoneyReportSupport.Rows(budget);
        BigDecimal[] paidTotal = {BigDecimal.ZERO};
        long[] paidOrders = {0};
        repository.paidNotInvoiced(f, q.range().storedFrom(), q.range().storedToExclusive(), r -> {
            Map<String, Object> row = ReportTable.row();
            row.put("order_number", r.orderNumber());
            row.put("order_date", r.orderDate() == null ? null : r.orderDate().toString());
            row.put("channel", r.channel());
            row.put("status", r.status());
            row.put("customer", r.customer());
            row.put("location", MoneyReportSupport.locationName(locations, r.locationId()));
            row.put("received", ReportTable.money(r.received()));
            paidTotal[0] = paidTotal[0].add(r.received());
            paidOrders[0]++;
            paid.add(row);
        });
        paid.warnIfCut(warnings, "paid_not_invoiced");
        Map<String, Object> paidTotals = MoneyReportSupport.totals();
        paidTotals.put("received", ReportTable.money(paidTotal[0]));
        paidTotals.put("orders", paidOrders[0]);
        a.getSections().add(MoneyReportSupport.section("paid_not_invoiced", "Paid, not yet invoiced",
                "पैसा मिला, बिल अभी नहीं बना", PAID_NOT_INVOICED, paid.list(), paidTotals));

        Map<String, Object> top = new LinkedHashMap<>();
        putMoney(top, totals);
        top.put("paid_not_invoiced", ReportTable.money(paidTotal[0]));
        a.setTotals(top);
        a.setWarnings(warnings.list());
        return a;
    }

    static Map<String, BigDecimal> emptyMoney() {
        Map<String, BigDecimal> m = new LinkedHashMap<>();
        for (String key : MONEY_KEYS) {
            m.put(key, BigDecimal.ZERO);
        }
        return m;
    }

    /** Adds one money event to a row of sums. */
    static void add(Map<String, BigDecimal> row, MoneyRow m) {
        BigDecimal amount = m.amount();
        switch (m.kind()) {
            case DayBookService.SALE_PAYMENT, DayBookService.RECEIPT_ON_CREDIT, DayBookService.COD_COLLECTED -> {
                String column = RECEIVED_COLUMNS.get(m.mode());
                if (column != null) {
                    row.merge(column, amount, BigDecimal::add);
                }
                // A tender mode with no column of its own is still money received.
                row.merge("received", amount, BigDecimal::add);
                row.merge("net_money", amount, BigDecimal::add);
            }
            case DayBookService.CREDIT_NOTE_USED -> row.merge("credit_note_used", amount, BigDecimal::add);
            case DayBookService.REFUND_PAID -> {
                String column = REFUND_COLUMNS.get(m.mode());
                if (column != null) {
                    row.merge(column, amount, BigDecimal::add);
                }
                row.merge("refunded", amount, BigDecimal::add);
                row.merge("net_money", amount.negate(), BigDecimal::add);
            }
            case DayBookService.CASH_IN -> {
                row.merge("cash_in", amount, BigDecimal::add);
                row.merge("net_money", amount, BigDecimal::add);
            }
            case DayBookService.CASH_OUT -> {
                row.merge("cash_out", amount, BigDecimal::add);
                row.merge("net_money", amount.negate(), BigDecimal::add);
            }
            case DayBookService.COD_DEDUCTION, DayBookService.COD_SHORT -> {
                row.merge("cod_deductions", amount, BigDecimal::add);
                row.merge("net_money", amount.negate(), BigDecimal::add);
            }
            case DayBookService.COD_EXCESS -> {
                row.merge("cod_deductions", amount.negate(), BigDecimal::add);
                row.merge("net_money", amount, BigDecimal::add);
            }
            default -> {
                // EXCHANGE_CREDIT: not money (its credit note is used on the new bill).
            }
        }
    }

    private static void putMoney(Map<String, Object> out, Map<String, BigDecimal> sums) {
        for (String key : MONEY_KEYS) {
            out.put(key, ReportTable.money(sums.getOrDefault(key, BigDecimal.ZERO)));
        }
    }
}
