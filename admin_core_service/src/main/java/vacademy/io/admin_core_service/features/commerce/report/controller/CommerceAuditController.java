package vacademy.io.admin_core_service.features.commerce.report.controller;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosUserNames;
import vacademy.io.admin_core_service.features.commerce.report.service.CommerceAuditQueryService;
import vacademy.io.admin_core_service.features.commerce.report.service.CommerceAuditQueryService.ApprovalEntry;
import vacademy.io.admin_core_service.features.commerce.report.service.CommerceAuditQueryService.AuditEntry;
import vacademy.io.admin_core_service.features.commerce.report.service.CommerceAuditQueryService.AuditQuery;
import vacademy.io.admin_core_service.features.commerce.report.service.CommerceAuditQueryService.Page;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportAccess;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRange;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRunner;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportScope;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The audit list (contract 6.4), read-only:
 * <ul>
 *   <li>{@code GET /admin-core-service/commerce/v1/audit}: {@code instituteId}, {@code from},
 *       {@code to} (India dates, at most 366 days; default this month), {@code actorUserId},
 *       {@code locationId}, {@code kind}, {@code reference} (a document number), {@code cursor},
 *       {@code size} (≤ 200), {@code format=json|csv}. Answer {@code {rows, next_cursor, from, to}}.</li>
 *   <li>{@code GET /audit/approvals}: PIN approvals, same dates, {@code reference}, paging.</li>
 *   <li>{@code GET /audit/kinds}: {@code {kinds: [...]}}.</li>
 * </ul>
 * Feature {@code commerce.tax_reports} or {@code commerce.orders}; store manager or accountant
 * (institute ADMIN always). Rows with a location only for the caller's locations; rows without
 * one for ADMIN and staff of every location. Staff names are read after the read-only
 * transaction, never inside it. A CSV download is audited like a report export.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/audit")
public class CommerceAuditController {

    private final ReportAccess access;
    private final ReportRunner runner;
    private final StockClock clock;
    private final CommerceAuditQueryService audit;
    private final PosUserNames userNames;

    public CommerceAuditController(ReportAccess access, ReportRunner runner, StockClock clock,
                                   CommerceAuditQueryService audit, PosUserNames userNames) {
        this.access = access;
        this.runner = runner;
        this.clock = clock;
        this.audit = audit;
        this.userNames = userNames;
    }

    @GetMapping
    public ResponseEntity<?> list(@RequestAttribute("user") CustomUserDetails user,
                                  @RequestParam("instituteId") String instituteId,
                                  @RequestParam(value = "from", required = false)
                                  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                  @RequestParam(value = "to", required = false)
                                  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                  @RequestParam(value = "actorUserId", required = false) String actorUserId,
                                  @RequestParam(value = "locationId", required = false) String locationId,
                                  @RequestParam(value = "kind", required = false) String kind,
                                  @RequestParam(value = "reference", required = false) String reference,
                                  @RequestParam(value = "cursor", required = false) String cursor,
                                  @RequestParam(value = "size", required = false) Integer size,
                                  @RequestParam(value = "format", required = false) String format) {
        ReportScope scope = access.require(ReportAccess.Kind.AUDIT, user, instituteId, locationId);
        String fmt = format == null || format.isBlank() ? "json" : format.trim().toLowerCase(Locale.ROOT);
        if (!fmt.equals("json") && !fmt.equals("csv")) {
            throw new InvalidRequestException("VALIDATION: format must be json or csv");
        }
        AuditQuery q = query(instituteId, from, to, scope, actorUserId, kind, reference, cursor, size);
        if ("json".equals(fmt)) {
            Page<AuditEntry> page = runner.screen(() -> audit.audit(q));
            CommerceAuditQueryService.fillNames(page, userNames.names(CommerceAuditQueryService.userIds(page)));
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(page);
        }
        List<String> actors = runner.screen(() -> audit.actors(q));
        Map<String, String> names = userNames.names(actors);
        Map<String, Object> filters = new LinkedHashMap<>();
        putIf(filters, "actor_user_id", q.actorUserId());
        putIf(filters, "location_id", scope.locationId());
        putIf(filters, "kind", q.kind());
        putIf(filters, "reference", q.reference());
        ReportRunner.ExportResult file = runner.export(
                new ReportRunner.ExportAudit(instituteId, user.getUserId(), scope.locationId(),
                        CommerceAuditQueryService.AUDIT, q.range().from().toString(), q.range().to().toString(),
                        filters, "csv"),
                (out, maxRows) -> audit.exportCsv(q, names, out, maxRows));
        String fileName = "audit-" + q.range().from() + "-" + q.range().to() + ".csv";
        return ResponseEntity.ok()
                .contentType(CommerceReportController.CSV)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                .cacheControl(CacheControl.noStore())
                .body(file.bytes());
    }

    @GetMapping("/approvals")
    public ResponseEntity<Page<ApprovalEntry>> approvals(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestParam("instituteId") String instituteId,
                                                         @RequestParam(value = "from", required = false)
                                                         @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                         @RequestParam(value = "to", required = false)
                                                         @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                                         @RequestParam(value = "locationId", required = false)
                                                         String locationId,
                                                         @RequestParam(value = "reference", required = false)
                                                         String reference,
                                                         @RequestParam(value = "cursor", required = false) String cursor,
                                                         @RequestParam(value = "size", required = false) Integer size) {
        ReportScope scope = access.require(ReportAccess.Kind.AUDIT, user, instituteId, locationId);
        AuditQuery q = query(instituteId, from, to, scope, null, null, reference, cursor, size);
        Page<ApprovalEntry> page = runner.screen(() -> audit.approvals(q));
        CommerceAuditQueryService.fillNames(page, userNames.names(CommerceAuditQueryService.userIds(page)));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(page);
    }

    @GetMapping("/kinds")
    public ResponseEntity<CommerceAuditQueryService.Kinds> kinds(@RequestAttribute("user") CustomUserDetails user,
                                                                 @RequestParam("instituteId") String instituteId) {
        access.require(ReportAccess.Kind.AUDIT, user, instituteId, null);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(runner.screen(() -> audit.kinds(instituteId)));
    }

    private AuditQuery query(String instituteId, LocalDate from, LocalDate to, ReportScope scope, String actorUserId,
                             String kind, String reference, String cursor, Integer size) {
        ReportRange range = ReportRange.of(from, to, clock.today(instituteId), ReportRange.MAX_DAYS);
        return new AuditQuery(instituteId, range, scope, blank(actorUserId, 36, "actorUserId"),
                upper(blank(kind, 32, "kind")), blank(reference, 100, "reference"), cursor,
                size == null ? 0 : size);
    }

    private static String blank(String value, int max, String field) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.length() > max) {
            throw new InvalidRequestException("VALIDATION: " + field + " is at most " + max + " characters");
        }
        return trimmed;
    }

    private static String upper(String value) {
        return value == null ? null : value.toUpperCase(Locale.ROOT);
    }

    private static void putIf(Map<String, Object> map, String key, Object value) {
        if (value != null) {
            map.put(key, value);
        }
    }
}
