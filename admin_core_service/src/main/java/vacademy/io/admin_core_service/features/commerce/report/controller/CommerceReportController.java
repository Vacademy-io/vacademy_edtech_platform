package vacademy.io.admin_core_service.features.commerce.report.controller;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosUserNames;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.service.CodDuesReportService;
import vacademy.io.admin_core_service.features.commerce.report.service.DayBookService;
import vacademy.io.admin_core_service.features.commerce.report.service.GstReportService;
import vacademy.io.admin_core_service.features.commerce.report.service.PaymentModesService;
import vacademy.io.admin_core_service.features.commerce.report.service.PosSessionsReportService;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportAccess;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportQuery;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRange;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRunner;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportScope;
import vacademy.io.admin_core_service.features.commerce.report.service.SalesReportService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * {@code GET /admin-core-service/commerce/v1/reports/{name}} (contract section 6.1). Parameters:
 * {@code instituteId}; {@code from}, {@code to} (India dates) or {@code month=YYYY-MM};
 * {@code locationId}, {@code channel}, {@code sellerGstin}, {@code status}, {@code b2clLimit},
 * {@code cursor}, {@code size}, {@code groupBy}, {@code asOf}; {@code format=json|csv|xlsx};
 * {@code lang=hi|en} (Excel header labels; else the Accept-Language header).
 *
 * <p>Access: {@link ReportAccess} first (feature, role, location), then the range and filters,
 * then the read inside {@link ReportRunner} (replica, statement timeout; exports one at a time
 * and audited). Errors: 400 {@code VALIDATION}, {@code GSTIN_REQUIRED}, {@code EXPORT_TOO_LARGE};
 * 403 {@code FEATURE_DISABLED}, {@code ROLE_NOT_ALLOWED}, {@code LOCATION_NOT_ALLOWED}; 404
 * {@code REPORT_NOT_FOUND}; 429 {@code REPORT_BUSY}; 503 {@code REPORT_TIMEOUT}.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/reports")
public class CommerceReportController {

    static final MediaType CSV = new MediaType("text", "csv", StandardCharsets.UTF_8);
    static final MediaType XLSX = MediaType.parseMediaType(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    private static final Set<String> CHANNELS = Set.of("ONLINE", "ADMIN", "POS");
    /** Reports that name staff (cashier, staff column, staff grouping). */
    private static final Set<String> NAMES_STAFF = Set.of(DayBookService.DAY_BOOK,
            PosSessionsReportService.POS_SESSIONS, SalesReportService.SALES);

    private final ReportAccess access;
    private final ReportRunner runner;
    private final StockClock clock;
    private final GstReportService gst;
    private final DayBookService dayBook;
    private final PaymentModesService paymentModes;
    private final CodDuesReportService codDues;
    private final PosSessionsReportService sessions;
    private final SalesReportService sales;
    private final PosUserNames userNames;

    public CommerceReportController(ReportAccess access, ReportRunner runner, StockClock clock,
                                    GstReportService gst, DayBookService dayBook,
                                    PaymentModesService paymentModes, CodDuesReportService codDues,
                                    PosSessionsReportService sessions, SalesReportService sales,
                                    PosUserNames userNames) {
        this.access = access;
        this.runner = runner;
        this.clock = clock;
        this.gst = gst;
        this.dayBook = dayBook;
        this.paymentModes = paymentModes;
        this.codDues = codDues;
        this.sessions = sessions;
        this.sales = sales;
        this.userNames = userNames;
    }

    /**
     * The places the caller may report on, and what they may open:
     * {@code {places: [{id, code, name, gstin, status}], all_places, gst_reports, tax_reports, orders}}.
     * Any report feature, a reader role (as the audit list).
     */
    @GetMapping("/places")
    public ResponseEntity<ReportAccess.Places> places(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam("instituteId") String instituteId) {
        ReportAccess.Places places = runner.screenRequest(() -> access.places(user, instituteId));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(places);
    }

    @GetMapping("/{name}")
    public ResponseEntity<?> report(@RequestAttribute("user") CustomUserDetails user,
                                    @PathVariable("name") String name,
                                    @RequestParam("instituteId") String instituteId,
                                    @RequestParam(value = "from", required = false)
                                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                    @RequestParam(value = "to", required = false)
                                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                    @RequestParam(value = "month", required = false) String month,
                                    @RequestParam(value = "locationId", required = false) String locationId,
                                    @RequestParam(value = "channel", required = false) String channel,
                                    @RequestParam(value = "sellerGstin", required = false) String sellerGstin,
                                    @RequestParam(value = "status", required = false) String status,
                                    @RequestParam(value = "b2clLimit", required = false) String b2clLimit,
                                    @RequestParam(value = "cursor", required = false) String cursor,
                                    @RequestParam(value = "size", required = false) Integer size,
                                    @RequestParam(value = "groupBy", required = false) String groupBy,
                                    @RequestParam(value = "asOf", required = false)
                                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf,
                                    @RequestParam(value = "format", required = false) String format,
                                    @RequestParam(value = "lang", required = false) String lang,
                                    @RequestHeader(value = HttpHeaders.ACCEPT_LANGUAGE, required = false)
                                    String acceptLanguage) {
        ReportAccess.Kind kind = ReportAccess.kindOf(name);
        if (kind == null) {
            throw new ResourceNotFoundException("REPORT_NOT_FOUND: there is no report called " + name);
        }
        ReportScope scope = access.require(kind, user, instituteId, locationId);
        Filters filters = FILTERS.get(name);
        ReportParams.refuse(ReportParams.given(locationId) && !filters.location(), "locationId", name);
        ReportParams.refuse(ReportParams.given(channel) && !filters.channel(), "channel", name);
        ReportParams.refuse(ReportParams.given(sellerGstin) && kind != ReportAccess.Kind.GST, "sellerGstin", name);
        ReportParams.refuse(ReportParams.given(status) && !GstReportService.SALES_REGISTER.equals(name), "status",
                name);
        ReportParams.refuse(ReportParams.given(b2clLimit) && !GstReportService.GSTR1.equals(name)
                && !GstReportService.GST_PACK.equals(name), "b2clLimit", name);
        ReportParams.refuse(ReportParams.given(groupBy) && !SalesReportService.SALES.equals(name)
                && !SalesReportService.PRODUCTS.equals(name), "groupBy", name);
        ReportParams.refuse(asOf != null && !CodDuesReportService.COD_OUTSTANDING.equals(name), "asOf", name);
        String fmt = GstReportService.format(format);
        if (GstReportService.GST_PACK.equals(name)) {
            if (format != null && !format.isBlank() && !"xlsx".equals(fmt)) {
                throw new InvalidRequestException("VALIDATION: the GST pack is an Excel workbook (format=xlsx)");
            }
            fmt = "xlsx";
        }
        LocalDate today = clock.today(instituteId);
        ReportRange range = month != null && !month.isBlank()
                ? ReportRange.month(month, today)
                : DayBookService.DAY_BOOK.equals(name)
                ? ReportRange.ofOrToday(from, to, today, ReportRange.DAY_BOOK_MAX_DAYS)
                : ReportRange.of(from, to, today, ReportRange.MAX_DAYS);
        if (DayBookService.DAY_BOOK.equals(name) && range.days() > ReportRange.DAY_BOOK_MAX_DAYS) {
            throw new InvalidRequestException("VALIDATION: the range is at most " + ReportRange.DAY_BOOK_MAX_DAYS
                    + " days");
        }
        String group = ReportParams.text(groupBy, 32, "groupBy");
        ReportQuery query = ReportQuery.builder()
                .instituteId(instituteId)
                .range(range)
                .scope(scope)
                .channel(channel(channel))
                .sellerGstin(gstin(sellerGstin))
                .status(status(status))
                .b2clLimit(ReportParams.b2clLimit(b2clLimit))
                .cursor(ReportParams.text(cursor, 400, "cursor"))
                .size(ReportParams.size(size))
                .hindi(hindi(lang, acceptLanguage))
                .groupBy(group == null ? null : SalesReportService.SALES.equals(name)
                        ? SalesReportService.salesGroup(group) : SalesReportService.productGroup(group))
                .asOf(ReportRange.checkedDay(asOf, today, "asOf"))
                .today(today)
                .month(month == null || month.isBlank() ? null : month.trim())
                .build();

        if ("json".equals(fmt)) {
            // One screen slot and one deadline for the whole request: the staff ids, their names
            // (account service, never inside a report transaction) and the report.
            ReportQuery asked = query;
            ReportAnswer answer = runner.screenRequest(() -> {
                ReportQuery q = named(name, asked);
                return runner.screen(() -> json(name, q));
            });
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(answer);
        }
        ReportQuery q = named(name, query);
        String fileFormat = fmt;
        ReportRunner.ExportResult file = runner.export(
                new ReportRunner.ExportAudit(instituteId, user.getUserId(), scope.locationId(), name,
                        range.from().toString(), range.to().toString(), q.filters(), fileFormat),
                (out, maxRows) -> export(name, q, fileFormat, out, maxRows));
        String fileName = name + "-" + range.from() + "-" + range.to() + "." + fileFormat;
        return ResponseEntity.ok()
                .contentType("csv".equals(fileFormat) ? CSV : XLSX)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                .cacheControl(CacheControl.noStore())
                .body(file.bytes());
    }

    /** The query with the names of the staff the report names (ids read in a short read, names outside it). */
    private ReportQuery named(String name, ReportQuery query) {
        if (!NAMES_STAFF.contains(name)) {
            return query;
        }
        List<String> staff = runner.screen(() -> staffIds(name, query));
        return staff.isEmpty() ? query : query.toBuilder().staffNames(userNames.names(staff)).build();
    }

    /** Which of the location and channel filters a report takes (the others are refused, never ignored). */
    record Filters(boolean location, boolean channel) {
    }

    /**
     * GSTR-1, the HSN summary and the GST pack are whole returns of a GSTIN: a location or channel
     * would give a partial return that still "adds up", so they take neither. The money, counter,
     * COD and dues reports have no channel. Documents issued is per series: a location, no channel.
     */
    static final Map<String, Filters> FILTERS = Map.ofEntries(
            Map.entry(GstReportService.SALES_REGISTER, new Filters(true, true)),
            Map.entry(GstReportService.CREDIT_NOTES, new Filters(true, true)),
            Map.entry(GstReportService.TAX_BY_RATE, new Filters(true, true)),
            Map.entry(GstReportService.HSN_SUMMARY, new Filters(false, false)),
            Map.entry(GstReportService.GSTR1, new Filters(false, false)),
            Map.entry(GstReportService.DOCUMENTS_ISSUED, new Filters(true, false)),
            Map.entry(GstReportService.GST_PACK, new Filters(false, false)),
            Map.entry(DayBookService.DAY_BOOK, new Filters(true, false)),
            Map.entry(PaymentModesService.PAYMENT_MODES, new Filters(true, false)),
            Map.entry(CodDuesReportService.COD_OUTSTANDING, new Filters(true, false)),
            Map.entry(CodDuesReportService.CUSTOMER_DUES, new Filters(true, false)),
            Map.entry(PosSessionsReportService.POS_SESSIONS, new Filters(true, false)),
            Map.entry(SalesReportService.SALES, new Filters(true, true)),
            Map.entry(SalesReportService.PRODUCTS, new Filters(true, true)));

    /** The JSON answer of a report (inside the runner's transaction). */
    ReportAnswer json(String name, ReportQuery q) {
        return switch (name) {
            case GstReportService.SALES_REGISTER -> gst.salesRegister(q);
            case GstReportService.CREDIT_NOTES -> gst.creditNotes(q);
            case GstReportService.TAX_BY_RATE -> gst.taxByRate(q);
            case GstReportService.HSN_SUMMARY -> gst.hsnSummary(q);
            case GstReportService.GSTR1 -> gst.gstr1(q);
            case GstReportService.DOCUMENTS_ISSUED -> gst.documentsIssued(q);
            case DayBookService.DAY_BOOK -> dayBook.dayBook(q);
            case PaymentModesService.PAYMENT_MODES -> paymentModes.paymentModes(q);
            case CodDuesReportService.COD_OUTSTANDING -> codDues.codOutstanding(q);
            case CodDuesReportService.CUSTOMER_DUES -> codDues.customerDues(q);
            case PosSessionsReportService.POS_SESSIONS -> sessions.sessions(q);
            case SalesReportService.SALES -> sales.sales(q);
            case SalesReportService.PRODUCTS -> sales.products(q);
            default -> throw notBuilt(name);
        };
    }

    /** The staff a report names (empty for reports that name none); read inside a short read-only transaction. */
    List<String> staffIds(String name, ReportQuery q) {
        return switch (name) {
            case DayBookService.DAY_BOOK -> dayBook.staffIds(q);
            case PosSessionsReportService.POS_SESSIONS -> sessions.staffIds(q);
            case SalesReportService.SALES -> sales.staffIds(q);
            default -> List.of();
        };
    }

    /** The CSV or Excel file of a report (inside the runner's export transaction). */
    int export(String name, ReportQuery q, String format, OutputStream out, int maxRows) throws IOException {
        return switch (name) {
            case GstReportService.SALES_REGISTER -> gst.exportSalesRegister(q, format, out, maxRows);
            case GstReportService.CREDIT_NOTES -> gst.exportCreditNotes(q, format, out, maxRows);
            case GstReportService.TAX_BY_RATE, GstReportService.HSN_SUMMARY, GstReportService.GSTR1,
                 GstReportService.DOCUMENTS_ISSUED -> gst.exportAnswer(json(name, q), format, q.hindi(), out, maxRows);
            case GstReportService.GST_PACK -> gst.gstPack(q, out, maxRows);
            case DayBookService.DAY_BOOK -> dayBook.export(q, format, out, maxRows);
            case PaymentModesService.PAYMENT_MODES -> paymentModes.export(q, format, out, maxRows);
            case CodDuesReportService.COD_OUTSTANDING -> codDues.exportCod(q, format, out, maxRows);
            case CodDuesReportService.CUSTOMER_DUES -> codDues.exportDues(q, format, out, maxRows);
            case PosSessionsReportService.POS_SESSIONS -> sessions.export(q, format, out, maxRows);
            case SalesReportService.SALES -> sales.exportSales(q, format, out, maxRows);
            case SalesReportService.PRODUCTS -> sales.exportProducts(q, format, out, maxRows);
            default -> throw notBuilt(name);
        };
    }

    private static ResourceNotFoundException notBuilt(String name) {
        return new ResourceNotFoundException("REPORT_NOT_FOUND: there is no report called " + name);
    }

    // ------------------------------------------------------------------ parameters

    static String channel(String channel) {
        if (channel == null || channel.isBlank()) {
            return null;
        }
        String value = channel.trim().toUpperCase(Locale.ROOT);
        if (!CHANNELS.contains(value)) {
            throw new InvalidRequestException("VALIDATION: channel must be ONLINE, ADMIN or POS");
        }
        return value;
    }

    static String status(String status) {
        if (status == null || status.isBlank() || "ALL".equalsIgnoreCase(status.trim())) {
            return null;
        }
        String value = status.trim().toUpperCase(Locale.ROOT);
        if (!value.equals("ACTIVE") && !value.equals("CANCELLED")) {
            throw new InvalidRequestException("VALIDATION: status must be ACTIVE, CANCELLED or ALL");
        }
        return value;
    }

    static String gstin(String gstin) {
        if (gstin == null || gstin.isBlank()) {
            return null;
        }
        String value = gstin.trim().toUpperCase(Locale.ROOT);
        if (!value.matches("^[0-9A-Z]{15}$")) {
            throw new InvalidRequestException("VALIDATION: sellerGstin is not a GSTIN");
        }
        return value;
    }

    static boolean hindi(String lang, String acceptLanguage) {
        if (lang != null && !lang.isBlank()) {
            return lang.trim().toLowerCase(Locale.ROOT).startsWith("hi");
        }
        return acceptLanguage != null && acceptLanguage.trim().toLowerCase(Locale.ROOT).startsWith("hi");
    }
}
