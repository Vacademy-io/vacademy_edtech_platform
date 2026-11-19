package vacademy.io.admin_core_service.features.commerce.report.service;

import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceReceiptService;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportCsvWriter;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyReportRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.CodOrderRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.DueRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.DueTotals;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.RtoRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.date;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.integer;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.money;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.percent;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.text;

/**
 * COD outstanding (contract 2.9) and customer dues (contract 2.10).
 *
 * <p><b>COD outstanding</b> as of a day ({@code asOf}, default today, India): a cash-on-delivery
 * order is outstanding when it was delivered by the end of that day and no remittance received
 * on or before it paid it; red after {@value #RED_FLAG_DAYS} days. Blocks: {@code outstanding},
 * {@code in_transit} (shipped, not delivered nor returned by then), {@code remittances} received
 * in the range, {@code rto} (orders shipped in the range by payment method and how many came
 * back).
 *
 * <p><b>Customer dues</b> as of now: staff orders with money due (the order desk's DUES queue).
 * Due = total − received − credit of goods returned that was not owed back as money, never below
 * 0: the same figure "Record receipt" accepts ({@link CommerceReceiptService#amountDue}). A row
 * whose due is lowered by a return carries the warning {@code DUE_REDUCED_BY_RETURN}.
 */
@Service
public class CodDuesReportService {

    public static final String COD_OUTSTANDING = "cod-outstanding";
    public static final String CUSTOMER_DUES = "customer-dues";

    /**
     * Days after delivery a COD order turns red. The order desk has no setting for it yet
     * (OPERATIONS section 5 names 10 days); one constant here until it does.
     */
    public static final int RED_FLAG_DAYS = 10;

    public static final String DUE_REDUCED_BY_RETURN = "DUE_REDUCED_BY_RETURN";

    static final ReportTable OUTSTANDING = ReportTable.of(
            text("order_number", "Order number", "ऑर्डर नंबर"),
            date("order_date", "Order date", "ऑर्डर की तारीख़"),
            text("customer", "Customer", "ग्राहक"),
            text("phone", "Phone", "फ़ोन"),
            text("courier", "Courier", "कूरियर"),
            text("tracking_number", "Tracking number", "ट्रैकिंग नंबर"),
            date("shipped_date", "Shipped on", "भेजने की तारीख़"),
            date("delivered_date", "Delivered on", "पहुँचने की तारीख़"),
            money("cod_amount", "COD amount", "COD रकम"),
            integer("days_outstanding", "Days outstanding", "कितने दिन से बकाया"),
            text("location", "Location", "जगह"));

    static final ReportTable IN_TRANSIT = ReportTable.of(
            text("order_number", "Order number", "ऑर्डर नंबर"),
            date("order_date", "Order date", "ऑर्डर की तारीख़"),
            text("customer", "Customer", "ग्राहक"),
            text("phone", "Phone", "फ़ोन"),
            text("courier", "Courier", "कूरियर"),
            text("tracking_number", "Tracking number", "ट्रैकिंग नंबर"),
            date("shipped_date", "Shipped on", "भेजने की तारीख़"),
            money("cod_amount", "COD amount", "COD रकम"),
            integer("days_in_transit", "Days in transit", "कितने दिन से रास्ते में"),
            text("location", "Location", "जगह"));

    static final ReportTable REMITTANCES = ReportTable.of(
            date("received_on", "Received on", "मिलने की तारीख़"),
            text("reference", "Reference", "संदर्भ"),
            text("courier", "Courier", "कूरियर"),
            integer("orders", "Orders", "ऑर्डर"),
            money("orders_total", "Orders total", "ऑर्डरों का जोड़"),
            money("gross", "Gross", "कुल रकम"),
            money("deductions", "Deductions", "कटौती"),
            money("net", "Net received", "शुद्ध मिली रकम"),
            text("difference_reason", "Difference reason", "अंतर का कारण"));

    static final ReportTable RTO = ReportTable.of(
            text("payment_method", "Payment method", "भुगतान का तरीका"),
            integer("shipped", "Shipped", "भेजे गए"),
            integer("rto", "Returned to origin", "वापस लौटे (RTO)"),
            percent("rto_rate", "RTO rate %", "RTO दर %"));

    static final ReportTable DUES = ReportTable.of(
            text("customer", "Customer", "ग्राहक"),
            text("phone", "Phone", "फ़ोन"),
            text("order_number", "Order number", "ऑर्डर नंबर"),
            date("order_date", "Order date", "ऑर्डर की तारीख़"),
            text("location", "Location", "जगह"),
            money("total", "Total", "कुल"),
            money("received", "Received", "मिली रकम"),
            money("credited_by_returns", "Credited by returns", "वापसी से घटा"),
            money("due", "Due", "बकाया"),
            integer("days_outstanding", "Days outstanding", "कितने दिन से बकाया"));

    private final MoneyReportRepository repository;

    public CodDuesReportService(MoneyReportRepository repository) {
        this.repository = repository;
    }

    // ================================================================== COD outstanding

    /** The as-of day: the one asked (not after today), else today. */
    static LocalDate asOf(ReportQuery q) {
        LocalDate asOf = q.asOf() == null ? q.today() : q.asOf();
        if (asOf.isAfter(q.today())) {
            throw new InvalidRequestException("VALIDATION: asOf must not be after today");
        }
        return asOf;
    }

    public ReportAnswer codOutstanding(ReportQuery q) {
        return cod(q, false, 0);
    }

    public int exportCod(ReportQuery q, String format, OutputStream out, int maxRows) throws IOException {
        return MoneyReportSupport.export(cod(q, true, maxRows), "outstanding", "COD outstanding", "COD बकाया",
                format, q.hindi(), out, maxRows);
    }

    ReportAnswer cod(ReportQuery q, boolean export, int maxRows) {
        LocalDate asOf = asOf(q);
        DocFilter f = MoneyReportSupport.filter(q);
        Map<String, String> locations = MoneyReportSupport.locationNames(repository.locations(q.instituteId()));
        ReportWarnings warnings = new ReportWarnings();
        ReportAnswer a = MoneyReportSupport.answer(q, COD_OUTSTANDING);
        a.getFilters().put("as_of", asOf.toString());
        a.getFilters().put("red_flag_days", RED_FLAG_DAYS);

        MoneyReportSupport.Rows outstanding = new MoneyReportSupport.Rows(export, maxRows);
        Sum owed = new Sum();
        long[] red = {0};
        repository.codOutstanding(f, asOf, StockClock.storedStartOf(asOf.plusDays(1)), r -> {
            Map<String, Object> row = codRow(r, locations);
            long days = r.deliveredOn() == null ? 0 : Math.max(0, ChronoUnit.DAYS.between(r.deliveredOn(), asOf));
            row.put("days_outstanding", days);
            boolean flag = days > RED_FLAG_DAYS;
            row.put("red_flag", flag);
            if (flag) {
                red[0]++;
            }
            owed.add(r.codAmount());
            outstanding.add(row);
        });
        outstanding.warnIfCut(warnings, "outstanding");

        MoneyReportSupport.Rows transit = new MoneyReportSupport.Rows(export, maxRows);
        Sum moving = new Sum();
        repository.codInTransit(f, StockClock.storedStartOf(asOf.plusDays(1)), r -> {
            Map<String, Object> row = codRow(r, locations);
            row.remove("delivered_date");
            row.put("days_in_transit", r.shippedOn() == null ? 0
                    : Math.max(0, ChronoUnit.DAYS.between(r.shippedOn(), asOf)));
            moving.add(r.codAmount());
            transit.add(row);
        });
        transit.warnIfCut(warnings, "in_transit");

        MoneyReportSupport.Rows remittances = new MoneyReportSupport.Rows(export, maxRows);
        BigDecimal[] remitted = {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO};
        long[] remittedOrders = {0, 0};
        repository.remittances(f, r -> {
            Map<String, Object> row = ReportTable.row();
            row.put("received_on", r.receivedOn() == null ? null : r.receivedOn().toString());
            row.put("reference", r.reference());
            row.put("courier", r.courier());
            row.put("orders", (long) r.orders());
            row.put("orders_total", ReportTable.money(r.ordersTotal()));
            row.put("gross", ReportTable.money(r.gross()));
            row.put("deductions", ReportTable.money(r.deductions()));
            row.put("net", ReportTable.money(r.net()));
            row.put("difference_reason", r.differenceReason());
            remitted[0] = remitted[0].add(r.ordersTotal());
            remitted[1] = remitted[1].add(r.gross());
            remitted[2] = remitted[2].add(r.deductions());
            remitted[3] = remitted[3].add(r.net());
            remittedOrders[0] += r.orders();
            remittedOrders[1]++;
            remittances.add(row);
        });
        remittances.warnIfCut(warnings, "remittances");
        if (f.locationIn() != null && remittedOrders[1] > 0) {
            warnings.add("REMITTANCE_HAS_NO_LOCATION", "a remittance has no location: the remittances that paid "
                    + "an order of your locations are listed whole", null);
        }

        List<Map<String, Object>> rto = new ArrayList<>();
        long shipped = 0;
        long back = 0;
        for (RtoRow r : repository.rto(f, q.range().storedFrom(), q.range().storedToExclusive())) {
            Map<String, Object> row = ReportTable.row();
            row.put("payment_method", r.paymentMethod());
            row.put("shipped", r.shipped());
            row.put("rto", r.rto());
            row.put("rto_rate", rate(r.rto(), r.shipped()));
            shipped += r.shipped();
            back += r.rto();
            rto.add(row);
        }

        Map<String, Object> outstandingTotals = MoneyReportSupport.totals();
        outstandingTotals.put("cod_amount", ReportTable.money(owed.amount));
        outstandingTotals.put("orders", owed.count);
        outstandingTotals.put("red_flag_orders", red[0]);
        Map<String, Object> transitTotals = MoneyReportSupport.totals();
        transitTotals.put("cod_amount", ReportTable.money(moving.amount));
        transitTotals.put("orders", moving.count);
        Map<String, Object> remittanceTotals = MoneyReportSupport.totals();
        remittanceTotals.put("orders", remittedOrders[0]);
        remittanceTotals.put("orders_total", ReportTable.money(remitted[0]));
        remittanceTotals.put("gross", ReportTable.money(remitted[1]));
        remittanceTotals.put("deductions", ReportTable.money(remitted[2]));
        remittanceTotals.put("net", ReportTable.money(remitted[3]));
        remittanceTotals.put("remittances", remittedOrders[1]);
        Map<String, Object> rtoTotals = MoneyReportSupport.totals();
        rtoTotals.put("shipped", shipped);
        rtoTotals.put("rto", back);
        rtoTotals.put("rto_rate", rate(back, shipped));

        a.getSections().add(MoneyReportSupport.section("outstanding", "Outstanding", "बकाया", OUTSTANDING,
                outstanding.list(), outstandingTotals));
        a.getSections().add(MoneyReportSupport.section("in_transit", "In transit", "रास्ते में", IN_TRANSIT,
                transit.list(), transitTotals));
        a.getSections().add(MoneyReportSupport.section("remittances", "Remittances received",
                "कूरियर से मिली रकम", REMITTANCES, remittances.list(), remittanceTotals));
        a.getSections().add(MoneyReportSupport.section("rto", "Returned to origin (RTO) rate", "RTO दर", RTO, rto,
                rtoTotals));

        Map<String, Object> totals = MoneyReportSupport.totals();
        totals.put("outstanding_count", owed.count);
        totals.put("outstanding_amount", ReportTable.money(owed.amount));
        totals.put("red_flag_count", red[0]);
        totals.put("in_transit_count", moving.count);
        totals.put("in_transit_amount", ReportTable.money(moving.amount));
        totals.put("gross", ReportTable.money(remitted[1]));
        totals.put("deductions", ReportTable.money(remitted[2]));
        totals.put("net", ReportTable.money(remitted[3]));
        a.setTotals(totals);
        a.setWarnings(warnings.list());
        return a;
    }

    private static Map<String, Object> codRow(CodOrderRow r, Map<String, String> locations) {
        Map<String, Object> row = ReportTable.row();
        row.put("order_number", r.orderNumber());
        row.put("order_date", day(r.orderDate()));
        row.put("customer", r.customer());
        row.put("phone", r.phone());
        row.put("courier", r.courier());
        row.put("tracking_number", r.trackingNumber());
        row.put("shipped_date", day(r.shippedOn()));
        row.put("delivered_date", day(r.deliveredOn()));
        row.put("cod_amount", ReportTable.money(r.codAmount()));
        row.put("location", MoneyReportSupport.locationName(locations, r.locationId()));
        return row;
    }

    /** {@code part} of {@code whole} in percent, two places; 0 when nothing was shipped. */
    static BigDecimal rate(long part, long whole) {
        if (whole <= 0) {
            return BigDecimal.ZERO.setScale(2);
        }
        return BigDecimal.valueOf(part).multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(whole), 2, RoundingMode.HALF_UP);
    }

    // ================================================================== customer dues

    public ReportAnswer customerDues(ReportQuery q) {
        DocFilter f = MoneyReportSupport.filter(q);
        Map<String, String> locations = MoneyReportSupport.locationNames(repository.locations(q.instituteId()));
        ReportWarnings warnings = new ReportWarnings();
        ReportAnswer a = MoneyReportSupport.answer(q, CUSTOMER_DUES);
        a.setColumns(DUES.dto());
        int size = q.pageSize();
        List<DueRow> fetched = new ArrayList<>();
        repository.dues(f, ReportCursor.decode(q.cursor()), size + 1, fetched::add);
        boolean more = fetched.size() > size;
        List<DueRow> page = more ? fetched.subList(0, size) : fetched;
        for (DueRow r : page) {
            a.getRows().add(dueRow(q, r, locations, warnings));
        }
        DueRow last = page.isEmpty() ? null : page.get(page.size() - 1);
        a.setNextCursor(more && last != null
                ? ReportCursor.encode(last.orderDate(), last.orderNumber(), last.orderId()) : null);
        a.setTotals(dueTotals(repository.dueTotals(f)));
        a.setWarnings(warnings.list());
        return a;
    }

    public int exportDues(ReportQuery q, String format, OutputStream out, int maxRows) throws IOException {
        DocFilter f = MoneyReportSupport.filter(q);
        Map<String, String> locations = MoneyReportSupport.locationNames(repository.locations(q.instituteId()));
        ReportAnswer a = MoneyReportSupport.answer(q, CUSTOMER_DUES);
        a.setColumns(DUES.dto());
        ReportWarnings ignored = new ReportWarnings();
        repository.dues(f, null, null, r -> {
            if (a.getRows().size() >= maxRows) {
                throw ReportCsvWriter.tooLarge(maxRows);
            }
            a.getRows().add(dueRow(q, r, locations, ignored));
        });
        a.setTotals(dueTotals(repository.dueTotals(f)));
        return MoneyReportSupport.export(a, "dues", "Customer dues", "ग्राहकों का बकाया", format, q.hindi(), out,
                maxRows);
    }

    static Map<String, Object> dueRow(ReportQuery q, DueRow r, Map<String, String> locations,
                                      ReportWarnings warnings) {
        Map<String, Object> row = ReportTable.row();
        row.put("customer", r.customer());
        row.put("phone", r.phone());
        row.put("order_number", r.orderNumber());
        row.put("order_date", day(r.orderDate()));
        row.put("location", MoneyReportSupport.locationName(locations, r.locationId()));
        row.put("total", ReportTable.money(r.total()));
        row.put("received", ReportTable.money(r.received()));
        row.put("credited_by_returns", ReportTable.money(r.creditedByReturns()));
        BigDecimal due = CommerceReceiptService.amountDue(r.total(), r.received(), r.creditedByReturns());
        row.put("due", ReportTable.money(due));
        row.put("days_outstanding", r.orderDate() == null ? 0L
                : Math.max(0, ChronoUnit.DAYS.between(r.orderDate(), q.today())));
        if (r.creditedByReturns().signum() > 0) {
            warnings.add(DUE_REDUCED_BY_RETURN, "goods returned before payment lower the due by "
                    + ReportTable.money(r.creditedByReturns()) + "; Record receipt asks for the lowered amount",
                    r.orderNumber());
        }
        return row;
    }

    static Map<String, Object> dueTotals(DueTotals t) {
        Map<String, Object> totals = MoneyReportSupport.totals();
        totals.put("total", ReportTable.money(t.total()));
        totals.put("received", ReportTable.money(t.received()));
        totals.put("credited_by_returns", ReportTable.money(t.creditedByReturns()));
        totals.put("due", ReportTable.money(t.due()));
        totals.put("orders", t.orders());
        totals.put("customers", t.customers());
        return totals;
    }

    private static String day(LocalDate date) {
        return date == null ? null : date.toString();
    }

    /** A count and an amount. */
    private static final class Sum {
        long count;
        BigDecimal amount = BigDecimal.ZERO;

        void add(BigDecimal value) {
            count++;
            amount = amount.add(value == null ? BigDecimal.ZERO : value);
        }
    }
}
