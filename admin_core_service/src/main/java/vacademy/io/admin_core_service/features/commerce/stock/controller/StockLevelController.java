package vacademy.io.admin_core_service.features.commerce.stock.controller;

import org.springframework.data.domain.Page;
import org.springframework.format.annotation.DateTimeFormat;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import vacademy.io.admin_core_service.features.commerce.stock.dto.AdjustmentRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReorderLevelRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StandardCostRequest;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockAdjustmentService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCostService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPostResult;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockQueryService;

import java.time.LocalDate;
import java.util.Map;
import java.util.Set;

/**
 * Stock levels, the ledger, adjustments and standard cost
 * ({@code /commerce/v1/stock/...}). Manager and warehouse staff at their own locations; the
 * accountant reads. Cost is never sent to warehouse staff.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/stock")
@RequiredArgsConstructor
public class StockLevelController {

    private final CommerceAccessGuard accessGuard;
    private final StockAccess stockAccess;
    private final StockQueryService queryService;
    private final StockAdjustmentService adjustmentService;
    private final StockLedgerService ledger;
    private final StockCostService costService;

    @GetMapping("/levels")
    public ResponseEntity<Page<Map<String, Object>>> levels(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "locationId", required = false) String locationId,
            @RequestParam(value = "packageSessionId", required = false) String packageSessionId,
            @RequestParam(value = "lowOnly", defaultValue = "false") boolean lowOnly,
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size) {
        Set<String> locations = locationsFor(user, instituteId, locationId);
        return ResponseEntity.ok(queryService.levels(instituteId, locations, packageSessionId, lowOnly, q, page, size));
    }

    @GetMapping("/movements")
    public ResponseEntity<Page<Map<String, Object>>> movements(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "locationId", required = false) String locationId,
            @RequestParam(value = "packageSessionId", required = false) String packageSessionId,
            @RequestParam(value = "type", required = false) String type,
            @RequestParam(value = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(value = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size) {
        Set<String> locations = locationsFor(user, instituteId, locationId);
        return ResponseEntity.ok(queryService.movements(instituteId, locations, packageSessionId, type, from, to,
                StockAccess.seesCost(user), page, size));
    }

    @PostMapping("/adjustments")
    public ResponseEntity<Map<String, Object>> adjust(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @RequestBody AdjustmentRequest request) {
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.STOCK_STAFF,
                request.getLocationId());
        StockPostResult result = adjustmentService.adjust(instituteId, user.getUserId(),
                StockAccess.isManager(user), request);
        Map<String, Object> out = StockQueryService.movementView(result.movement(), StockAccess.seesCost(user));
        out.put("created", result.created());
        out.put("sellable_shortfall", result.sellableShortfall());
        return ResponseEntity.ok(out);
    }

    @PutMapping("/levels/reorder-level")
    public ResponseEntity<Map<String, Object>> reorderLevel(@RequestAttribute("user") CustomUserDetails user,
                                                            @RequestParam("instituteId") String instituteId,
                                                            @RequestBody ReorderLevelRequest request) {
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.MANAGER,
                request.getLocationId());
        ledger.setReorderLevel(instituteId, request.getLocationId(), request.getPackageSessionId(),
                request.getReorderLevel());
        return ResponseEntity.ok(Map.of("updated", true));
    }

    /** "Set standard cost" for one or many items; also what the item-costs import calls. */
    @PutMapping("/standard-costs")
    public ResponseEntity<Map<String, Object>> standardCosts(@RequestAttribute("user") CustomUserDetails user,
                                                             @RequestParam("instituteId") String instituteId,
                                                             @RequestBody StandardCostRequest request) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.COST_WRITERS);
        return ResponseEntity.ok(Map.of("updated", costService.setStandardCosts(instituteId, user.getUserId(), request)));
    }

    /**
     * With a location: the caller must be assigned to it. Without one: an institute ADMIN sees
     * every location, anyone else the locations they are assigned to.
     */
    private Set<String> locationsFor(CustomUserDetails user, String instituteId, String locationId) {
        if (locationId != null && !locationId.isBlank()) {
            accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.STOCK_READERS,
                    locationId.trim());
            return Set.of(locationId.trim());
        }
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.STOCK_READERS);
        return stockAccess.visibleLocationIds(user, instituteId);
    }
}
