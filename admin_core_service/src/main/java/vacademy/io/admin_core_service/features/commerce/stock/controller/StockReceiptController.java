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

import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptActionRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptCostRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockReceipt;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockReceiptService;

import java.util.Map;
import java.util.Set;

/**
 * Goods receipts ({@code /commerce/v1/stock/receipts}). Manager and
 * warehouse staff receive at their own locations; the accountant reads the list. Reversal is
 * for the manager; a cost is typed by the manager or the accountant and is never sent to
 * warehouse staff.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/stock/receipts")
@RequiredArgsConstructor
public class StockReceiptController {

    private final CommerceAccessGuard accessGuard;
    private final StockAccess stockAccess;
    private final StockReceiptService receiptService;

    @GetMapping
    public ResponseEntity<Page<Map<String, Object>>> list(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "locationId", required = false) String locationId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "billStatus", required = false) String billStatus,
            @RequestParam(value = "supplierId", required = false) String supplierId,
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
        boolean withCost = StockAccess.seesCost(user);
        return ResponseEntity.ok(receiptService.list(instituteId, locations, status, billStatus, supplierId, page, size)
                .map(receipt -> receiptService.view(instituteId, receipt, withCost, false)));
    }

    @GetMapping("/{receiptId}")
    public ResponseEntity<Map<String, Object>> get(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam("instituteId") String instituteId,
                                                   @PathVariable("receiptId") String receiptId) {
        StockReceipt receipt = guarded(user, instituteId, receiptId, StockAccess.STOCK_READERS);
        return ResponseEntity.ok(receiptService.view(instituteId, receipt, StockAccess.seesCost(user), true));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @RequestBody ReceiptRequest request) {
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.STOCK_STAFF,
                request.getLocationId());
        boolean withCost = StockAccess.seesCost(user);
        StockReceipt receipt = receiptService.create(instituteId, user.getUserId(), withCost, request);
        return ResponseEntity.ok(receiptService.view(instituteId, receipt, withCost, true));
    }

    @PostMapping("/{receiptId}/reverse")
    public ResponseEntity<Map<String, Object>> reverse(@RequestAttribute("user") CustomUserDetails user,
                                                       @RequestParam("instituteId") String instituteId,
                                                       @PathVariable("receiptId") String receiptId,
                                                       @RequestBody ReceiptActionRequest request) {
        guarded(user, instituteId, receiptId, StockAccess.MANAGER);
        StockReceipt receipt = receiptService.reverse(instituteId, user.getUserId(), receiptId,
                request == null ? null : request.getReason());
        return ResponseEntity.ok(receiptService.view(instituteId, receipt, true, true));
    }

    @PatchMapping("/{receiptId}/cost")
    public ResponseEntity<Map<String, Object>> cost(@RequestAttribute("user") CustomUserDetails user,
                                                    @RequestParam("instituteId") String instituteId,
                                                    @PathVariable("receiptId") String receiptId,
                                                    @RequestBody ReceiptCostRequest request) {
        guarded(user, instituteId, receiptId, StockAccess.COST_WRITERS);
        StockReceipt receipt = receiptService.typeCost(instituteId, user.getUserId(), receiptId, request);
        return ResponseEntity.ok(receiptService.view(instituteId, receipt, true, true));
    }

    /** "No bill will come", one or many. Each receipt is checked against the caller's locations. */
    @PostMapping("/no-bill")
    public ResponseEntity<Map<String, Object>> noBill(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @RequestBody ReceiptActionRequest request) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.COST_WRITERS);
        if (request == null || request.getReceiptIds() == null || request.getReceiptIds().isEmpty()) {
            throw new InvalidRequestException("receipt_ids is required");
        }
        if (request.getReceiptIds().size() > 200) {
            throw new InvalidRequestException("At most 200 receipts at once");
        }
        Set<String> visible = stockAccess.visibleLocationIds(user, instituteId);
        if (visible != null) {
            for (String id : request.getReceiptIds()) {
                StockReceipt receipt = receiptService.get(instituteId, id == null ? "" : id.trim());
                if (!visible.contains(receipt.getLocationId())) {
                    accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.COST_WRITERS,
                            receipt.getLocationId());
                }
            }
        }
        int closed = receiptService.markNoBill(instituteId, user.getUserId(), request.getReceiptIds(),
                request.getReason());
        return ResponseEntity.ok(Map.of("closed", closed));
    }

    /** Membership, feature and role first; then the receipt of this institute; then its location. */
    private StockReceipt guarded(CustomUserDetails user, String instituteId, String receiptId,
                                 Set<vacademy.io.admin_core_service.features.commerce.security.CommerceRole> roles) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, roles);
        StockReceipt receipt = receiptService.get(instituteId, receiptId);
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, roles, receipt.getLocationId());
        return receipt;
    }
}
