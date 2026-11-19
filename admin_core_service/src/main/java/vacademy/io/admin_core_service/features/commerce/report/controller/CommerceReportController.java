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
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.service.GstReportService;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportAccess;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportQuery;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRange;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRunner;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportScope;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Locale;
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

    private final ReportAccess access;
    private final ReportRunner runner;
    private final StockClock clock;
    private final GstReportService gst;

    public CommerceReportController(ReportAccess access, ReportRunner runner, StockClock clock,
                                    GstReportService gst) {
        this.access = access;
        this.runner = runner;
        this.clock = clock;
        this.gst = gst;
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
                : ReportRange.of(from, to, today, ReportRange.MAX_DAYS);
        ReportQuery query = ReportQuery.builder()
                .instituteId(instituteId)
                .range(range)
                .scope(scope)
                .channel(channel(channel))
                .sellerGstin(gstin(sellerGstin))
                .status(status(status))
                .b2clLimit(limit(b2clLimit))
                .cursor(cursor)
                .size(size == null ? 0 : size)
                .hindi(hindi(lang, acceptLanguage))
                .groupBy(groupBy == null || groupBy.isBlank() ? null : groupBy.trim())
                .asOf(asOf)
                .today(today)
                .month(month == null || month.isBlank() ? null : month.trim())
                .build();

        if ("json".equals(fmt)) {
            ReportAnswer answer = runner.screen(() -> json(name, query));
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(answer);
        }
        String fileFormat = fmt;
        ReportRunner.ExportResult file = runner.export(
                new ReportRunner.ExportAudit(instituteId, user.getUserId(), scope.locationId(), name,
                        range.from().toString(), range.to().toString(), query.filters(), fileFormat),
                (out, maxRows) -> export(name, query, fileFormat, out, maxRows));
        String fileName = name + "-" + range.from() + "-" + range.to() + "." + fileFormat;
        return ResponseEntity.ok()
                .contentType("csv".equals(fileFormat) ? CSV : XLSX)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                .cacheControl(CacheControl.noStore())
                .body(file.bytes());
    }

    /** The JSON answer of a report (inside the runner's transaction). */
    ReportAnswer json(String name, ReportQuery q) {
        return switch (name) {
            case GstReportService.SALES_REGISTER -> gst.salesRegister(q);
            case GstReportService.CREDIT_NOTES -> gst.creditNotes(q);
            case GstReportService.TAX_BY_RATE -> gst.taxByRate(q);
            case GstReportService.HSN_SUMMARY -> gst.hsnSummary(q);
            case GstReportService.GSTR1 -> gst.gstr1(q);
            case GstReportService.DOCUMENTS_ISSUED -> gst.documentsIssued(q);
            default -> throw notBuilt(name);
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

    static BigDecimal limit(String limit) {
        if (limit == null || limit.isBlank()) {
            return null;
        }
        try {
            BigDecimal value = new BigDecimal(limit.trim());
            if (value.signum() < 0) {
                throw new NumberFormatException("negative");
            }
            return value;
        } catch (NumberFormatException e) {
            throw new InvalidRequestException("VALIDATION: b2clLimit must be an amount in rupees");
        }
    }

    static boolean hindi(String lang, String acceptLanguage) {
        if (lang != null && !lang.isBlank()) {
            return lang.trim().toLowerCase(Locale.ROOT).startsWith("hi");
        }
        return acceptLanguage != null && acceptLanguage.trim().toLowerCase(Locale.ROOT).startsWith("hi");
    }
}
