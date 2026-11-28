package vacademy.io.admin_core_service.features.commerce.stock.controller;

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
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Stock locations ({@code /commerce/v1/locations}). Any commerce staff may
 * read the list; a store manager (or institute ADMIN) creates and edits. A manager who is not
 * an ADMIN edits only a location they are assigned to.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/locations")
@RequiredArgsConstructor
public class StockLocationController {

    private final CommerceAccessGuard accessGuard;
    private final StockAccess stockAccess;
    private final StockLocationService locationService;

    /** At most 500 locations exist per institute, so the list is returned whole. */
    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestParam("instituteId") String instituteId) {
        // A shop with the billing counter only (no stock module): its managers read the locations.
        accessGuard.requireEither(user, instituteId, CommerceFeature.INVENTORY, StockAccess.ANY_STAFF,
                CommerceFeature.POS, Set.of(CommerceRole.STORE_MANAGER));
        Set<String> assigned = stockAccess.visibleLocationIds(user, instituteId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (StockLocation location : locationService.list(instituteId)) {
            Map<String, Object> row = StockLocationService.view(location);
            row.put("assigned", assigned == null || assigned.contains(location.getId()));
            out.add(row);
        }
        return ResponseEntity.ok(out);
    }

    @GetMapping("/{locationId}")
    public ResponseEntity<Map<String, Object>> get(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam("instituteId") String instituteId,
                                                   @PathVariable("locationId") String locationId) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.ANY_STAFF);
        return ResponseEntity.ok(StockLocationService.view(locationService.get(instituteId, locationId)));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @RequestBody LocationRequest request) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.MANAGER);
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }
        return ResponseEntity.ok(StockLocationService.view(
                locationService.create(instituteId, user.getUserId(), StockAccess.isAdmin(user), request)));
    }

    @PutMapping("/{locationId}")
    public ResponseEntity<Map<String, Object>> update(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @PathVariable("locationId") String locationId,
                                                      @RequestBody LocationRequest request) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, StockAccess.MANAGER, locationId);
        return ResponseEntity.ok(StockLocationService.view(
                locationService.update(instituteId, user.getUserId(), locationId, request)));
    }
}
