package vacademy.io.admin_core_service.features.commerce.stock.controller;

import org.springframework.data.domain.Page;
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

import vacademy.io.admin_core_service.features.commerce.stock.service.StockQueryService;

import java.util.Map;
import java.util.Set;

/**
 * Pieces and the scan lookup ({@code /commerce/v1/pieces} and
 * {@code /commerce/v1/scan/{code}}). The scan is open to any commerce staff, and what it
 * returns depends on the role: piece status and location for staff who handle goods, cost for
 * the manager and the accountant only.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1")
@RequiredArgsConstructor
public class StockPieceController {

    private final CommerceAccessGuard accessGuard;
    private final StockAccess stockAccess;
    private final StockQueryService queryService;

    @GetMapping("/pieces")
    public ResponseEntity<Page<Map<String, Object>>> pieces(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "locationId", required = false) String locationId,
            @RequestParam(value = "packageSessionId", required = false) String packageSessionId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size) {
        Set<String> locations;
        if (locationId != null && !locationId.isBlank()) {
            accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.STOCK_READERS,
                    locationId.trim());
            locations = Set.of(locationId.trim());
        } else {
            accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.STOCK_READERS);
            locations = stockAccess.visibleLocationIds(user, instituteId);
        }
        return ResponseEntity.ok(queryService.pieces(instituteId, locations, packageSessionId, status,
                StockAccess.seesCost(user), page, size));
    }

    @GetMapping("/pieces/{pieceId}")
    public ResponseEntity<Map<String, Object>> piece(@RequestAttribute("user") CustomUserDetails user,
                                                     @RequestParam("instituteId") String instituteId,
                                                     @PathVariable("pieceId") String pieceId) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.STOCK_READERS);
        return ResponseEntity.ok(queryService.piece(instituteId, stockAccess.visibleLocationIds(user, instituteId),
                pieceId, StockAccess.seesCost(user)));
    }

    @GetMapping("/scan/{code}")
    public ResponseEntity<Map<String, Object>> scan(@RequestAttribute("user") CustomUserDetails user,
                                                    @RequestParam("instituteId") String instituteId,
                                                    @PathVariable("code") String code) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.ANY_STAFF);
        return ResponseEntity.ok(queryService.scan(instituteId, code, StockAccess.seesStock(user),
                StockAccess.seesCost(user)));
    }
}
