package vacademy.io.admin_core_service.features.packages.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.packages.dto.InventoryStatsDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageSessionInventoryDTO;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository.SessionInstituteRow;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Seat and stock counts of a batch (Manage Inventory in the admin app).
 *
 * <p>Every endpoint checks that the caller is staff of an institute the package session belongs
 * to. A package can be shared by several institutes, so the caller passes
 * when they are staff of any one of them.
 */
@RestController
@RequestMapping("/admin-core-service/package-session")
@RequiredArgsConstructor
public class PackageSessionInventoryController {

    private final PackageSessionService packageSessionService;
    private final PackageSessionRepository packageSessionRepository;
    private final InstituteAccessValidator instituteAccessValidator;

    @PutMapping("/{packageSessionId}/inventory/update-capacity")
    public ResponseEntity<PackageSession> updateCapacity(@PathVariable String packageSessionId,
            @RequestBody PackageSessionInventoryDTO inventoryDTO,
            @RequestAttribute("user") CustomUserDetails user) {
        requireStaffOf(user, packageSessionId);
        return ResponseEntity.ok(packageSessionService.updateInventory(packageSessionId, inventoryDTO.getMaxSeats(), inventoryDTO.getAvailableSlots()));
    }

    @PostMapping("/{packageSessionId}/inventory/reserve")
    public ResponseEntity<String> reserveSlot(@PathVariable String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        requireStaffOf(user, packageSessionId);
        packageSessionService.reserveSlot(packageSessionId);
        return ResponseEntity.ok("Slot reserved successfully");
    }

    @PostMapping("/{packageSessionId}/inventory/release")
    public ResponseEntity<String> releaseSlot(@PathVariable String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        requireStaffOf(user, packageSessionId);
        packageSessionService.releaseSlot(packageSessionId);
        return ResponseEntity.ok("Slot released successfully");
    }

    @GetMapping("/{packageSessionId}/inventory/availability")
    public ResponseEntity<Map<String, Object>> getAvailability(@PathVariable String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        requireStaffOf(user, packageSessionId);
        return ResponseEntity.ok(packageSessionService.getAvailability(packageSessionId));
    }

    /** Ids the caller is not staff for are left out of the answer, like ids that do not exist. */
    @PostMapping("/inventory/batch-availability")
    public ResponseEntity<Map<String, Map<String, Object>>> getBatchAvailability(
            @RequestBody List<String> packageSessionIds,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(packageSessionService.getBatchAvailability(staffVisible(user, packageSessionIds)));
    }

    @GetMapping("/inventory/stats")
    public ResponseEntity<InventoryStatsDTO> getInventoryStats(@RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(packageSessionService.getInventoryStats(instituteId));
    }

    private void requireStaffOf(CustomUserDetails user, String packageSessionId) {
        if (staffVisible(user, List.of(packageSessionId)).isEmpty()) {
            throw new ForbiddenException("Access denied: this batch does not belong to your institute");
        }
    }

    /** The subset of ids whose package belongs to an institute the caller is staff of. */
    private List<String> staffVisible(CustomUserDetails user, List<String> packageSessionIds) {
        List<String> visible = new ArrayList<>();
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return visible;
        }
        Set<String> ids = new HashSet<>();
        for (String id : packageSessionIds) {
            if (id != null && !id.isBlank()) {
                ids.add(id);
            }
        }
        if (ids.isEmpty()) {
            return visible;
        }
        Map<String, Boolean> staffOfInstitute = new HashMap<>();
        Set<String> allowed = new HashSet<>();
        for (SessionInstituteRow row : packageSessionRepository.findInstitutesOfPackageSessions(ids)) {
            boolean staff = staffOfInstitute.computeIfAbsent(row.getInstituteId(), instituteId -> isStaff(user, instituteId));
            if (staff) {
                allowed.add(row.getPackageSessionId());
            }
        }
        for (String id : packageSessionIds) {
            if (id != null && allowed.contains(id) && !visible.contains(id)) {
                visible.add(id);
            }
        }
        return visible;
    }

    /**
     * Staff of the institute; the root flag is not consulted. The dashboard sends the clientId
     * header on every call, so real staff of the institute pass.
     */
    private boolean isStaff(CustomUserDetails user, String instituteId) {
        try {
            instituteAccessValidator.requireInstituteStaff(user, instituteId);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }
}
