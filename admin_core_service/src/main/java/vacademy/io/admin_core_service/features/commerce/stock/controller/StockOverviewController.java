package vacademy.io.admin_core_service.features.commerce.stock.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ApproversAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Caller;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.LowAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.OverviewAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.VariantsAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockOverviewService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * The stock reads of the inventory screens: overview, low stock, the variant picker, the
 * approvers of a location and the movement export ({@code /commerce/v1/stock/...}).
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/stock")
@RequiredArgsConstructor
public class StockOverviewController {

    private final StockOpsAccess access;
    private final StockOverviewService overviewService;

    @GetMapping("/overview")
    public ResponseEntity<OverviewAnswer> overview(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam("instituteId") String instituteId,
                                                   @RequestParam(value = "locationIds", required = false) String locationIds,
                                                   @RequestParam(value = "q", required = false) String q,
                                                   @RequestParam(value = "filter", required = false) String filter,
                                                   @RequestParam(value = "collectionId", required = false) String collectionId,
                                                   @RequestParam(value = "page", defaultValue = "0") int page,
                                                   @RequestParam(value = "size", defaultValue = "50") int size) {
        access.require(user, instituteId, StockOpsAccess.STOCK_READERS);
        Set<String> named = new LinkedHashSet<>();
        if (locationIds != null) {
            for (String id : locationIds.split(",")) {
                if (!id.isBlank()) {
                    named.add(id.trim());
                }
            }
        }
        if (named.size() > StockOverviewService.MAX_LOCATIONS) {
            throw new InvalidRequestException("VALIDATION: at most " + StockOverviewService.MAX_LOCATIONS
                    + " locations at once");
        }
        for (String id : named) {
            access.requireAt(user, instituteId, StockOpsAccess.STOCK_READERS, id);
        }
        Caller caller = access.caller(user, instituteId);
        return ResponseEntity.ok(overviewService.overview(instituteId, new ArrayList<>(named),
                caller.visibleLocationIds(), q, filter, collectionId, page, size));
    }

    @GetMapping("/low")
    public ResponseEntity<LowAnswer> low(@RequestAttribute("user") CustomUserDetails user,
                                         @RequestParam("instituteId") String instituteId,
                                         @RequestParam(value = "locationId", required = false) String locationId,
                                         @RequestParam(value = "kind", required = false) String kind,
                                         @RequestParam(value = "page", defaultValue = "0") int page,
                                         @RequestParam(value = "size", defaultValue = "50") int size) {
        boolean online = kind != null && "OUT_ONLINE".equalsIgnoreCase(kind.trim());
        if (online || locationId == null || locationId.isBlank()) {
            access.require(user, instituteId, StockOpsAccess.STOCK_READERS);
        } else {
            access.requireAt(user, instituteId, StockOpsAccess.STOCK_READERS, locationId.trim());
        }
        return ResponseEntity.ok(overviewService.low(instituteId, locationId == null ? null : locationId.trim(), kind,
                access.caller(user, instituteId).visibleLocationIds(), page, size));
    }

    @GetMapping("/variants")
    public ResponseEntity<VariantsAnswer> variants(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam("instituteId") String instituteId,
                                                   @RequestParam(value = "q", required = false) String q,
                                                   @RequestParam(value = "locationId", required = false) String locationId,
                                                   @RequestParam(value = "includeUntracked", defaultValue = "false")
                                                   boolean includeUntracked) {
        if (locationId != null && !locationId.isBlank()) {
            access.requireAt(user, instituteId, StockOpsAccess.STOCK_READERS, locationId.trim());
        } else {
            access.require(user, instituteId, StockOpsAccess.STOCK_READERS);
        }
        return ResponseEntity.ok(overviewService.variants(instituteId, q, locationId, includeUntracked));
    }

    @GetMapping("/approvers")
    public ResponseEntity<ApproversAnswer> approvers(@RequestAttribute("user") CustomUserDetails user,
                                                     @RequestParam("instituteId") String instituteId,
                                                     @RequestParam("locationId") String locationId) {
        access.requireAt(user, instituteId, StockOpsAccess.STOCK_STAFF, locationId);
        return ResponseEntity.ok(overviewService.approvers(instituteId, locationId.trim()));
    }

    @GetMapping("/movements/export")
    public ResponseEntity<byte[]> export(@RequestAttribute("user") CustomUserDetails user,
                                         @RequestParam("instituteId") String instituteId,
                                         @RequestParam(value = "locationId", required = false) String locationId,
                                         @RequestParam(value = "packageSessionId", required = false) String packageSessionId,
                                         @RequestParam(value = "type", required = false) String type,
                                         @RequestParam(value = "from", required = false)
                                         @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                         @RequestParam(value = "to", required = false)
                                         @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        Set<String> locations;
        if (locationId != null && !locationId.isBlank()) {
            access.requireAt(user, instituteId, StockOpsAccess.STOCK_READERS, locationId.trim());
            locations = Set.of(locationId.trim());
        } else {
            access.require(user, instituteId, StockOpsAccess.STOCK_READERS);
            locations = access.caller(user, instituteId).visibleLocationIds();
        }
        StockOverviewService.Export export = overviewService.exportMovements(instituteId, locations,
                packageSessionId, type, from, to, StockAccess.seesCost(user));
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + export.fileName() + "\"")
                .cacheControl(CacheControl.noStore())
                .body(export.csv());
    }
}
