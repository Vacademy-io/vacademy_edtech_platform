package vacademy.io.admin_core_service.features.commerce.security;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAccess;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockAccess;
import vacademy.io.admin_core_service.features.commerce.security.dto.StaffLocationsRequest;
import vacademy.io.admin_core_service.features.commerce.security.dto.StaffPinRequest;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Staff set-up ({@code /commerce/v1/staff} and {@code /staff/pin}):
 * which locations a staff member may act at, and the manager's own PIN. Store manager or
 * institute ADMIN only. An institute ADMIN assigns any location to anyone. A store manager
 * assigns and removes only locations they are assigned to themselves, and never changes
 * their own list: otherwise a manager of one shop could make themselves manager of all.
 * Roles themselves are granted in auth_service, not here.
 *
 * <p>{@code /staff/scope}: whether a manager or accountant acts for every location in the accounts
 * work; set by an institute ADMIN only. The PIN routes open under the billing counter or the accounts
 * feature (unlocking the books is approved with the manager's PIN).
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/staff")
@RequiredArgsConstructor
public class CommerceStaffController {

    private static final Set<CommerceRole> MANAGER = Set.of(CommerceRole.STORE_MANAGER);

    private final CommerceAccessGuard accessGuard;
    private final CommerceStaffService staffService;
    private final StockLocationService stockLocationService;

    @GetMapping("/locations")
    public ResponseEntity<Map<String, Object>> locations(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestParam("instituteId") String instituteId,
                                                         @RequestParam("userId") String staffUserId) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, MANAGER);
        return ResponseEntity.ok(locationsView(staffUserId, staffService.locationIds(instituteId, staffUserId)));
    }

    @PutMapping("/locations")
    public ResponseEntity<Map<String, Object>> setLocations(@RequestAttribute("user") CustomUserDetails user,
                                                            @RequestParam("instituteId") String instituteId,
                                                            @RequestBody StaffLocationsRequest request) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, MANAGER);
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }
        // Every id must be a stock location of this institute: an assignment to a foreign or
        // made-up id is refused before anything is written.
        stockLocationService.requireLocationsOfInstitute(instituteId, request.getLocationIds());
        if (!StockAccess.isAdmin(user)) {
            // A store manager is not an institute admin: they hand out only what they hold.
            staffService.requireManagerMayAssign(instituteId, user.getUserId(), request.getUserId(),
                    request.getLocationIds());
        }
        List<String> saved = staffService.setLocations(instituteId, user.getUserId(), request.getUserId(),
                request.getLocationIds());
        return ResponseEntity.ok(locationsView(request.getUserId(), saved));
    }

    @GetMapping("/pin")
    public ResponseEntity<Map<String, Object>> pinStatus(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestParam("instituteId") String instituteId) {
        requirePinAccess(user, instituteId);
        return ResponseEntity.ok(Map.of("has_pin", staffService.hasPin(instituteId, user.getUserId())));
    }

    /** Sets the caller's own PIN; nobody can set a PIN for someone else. */
    @PutMapping("/pin")
    public ResponseEntity<Map<String, Object>> setPin(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @RequestBody StaffPinRequest request) {
        requirePinAccess(user, instituteId);
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }
        staffService.setOwnPin(instituteId, user.getUserId(), request.getPin());
        return ResponseEntity.ok(Map.of("has_pin", true));
    }

    @GetMapping("/scope")
    public ResponseEntity<Map<String, Object>> scope(@RequestAttribute("user") CustomUserDetails user,
                                                     @RequestParam("instituteId") String instituteId,
                                                     @RequestParam("userId") String staffUserId) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ADMIN_ONLY);
        return ResponseEntity.ok(staffService.scope(instituteId, staffUserId));
    }

    @PutMapping("/scope")
    public ResponseEntity<Map<String, Object>> setScope(@RequestAttribute("user") CustomUserDetails user,
                                                        @RequestParam("instituteId") String instituteId,
                                                        @RequestBody StaffScopeRequest request) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ADMIN_ONLY);
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }
        return ResponseEntity.ok(staffService.setScope(instituteId, user.getUserId(), request.getUserId(),
                request.getAllLocations()));
    }

    /** Body of PUT /commerce/v1/staff/scope. */
    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StaffScopeRequest {
        private String userId;
        private Boolean allLocations;
    }

    private void requirePinAccess(CustomUserDetails user, String instituteId) {
        accessGuard.requireEither(user, instituteId, CommerceFeature.POS, MANAGER, CommerceFeature.ACCOUNTS, MANAGER);
    }

    private static Map<String, Object> locationsView(String staffUserId, List<String> locationIds) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user_id", staffUserId);
        out.put("location_ids", locationIds);
        return out;
    }
}
